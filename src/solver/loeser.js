// AP5 — Phasenlöser: Einstiegspunkt. Nimmt RigProfile, Skeleton und eine
// Timeline-artige Phasenliste und liefert gelöste Frames plus Bericht.
//
// Aufruf (so bauen AP6/AP7/AP8):
//
//   import { loadGLB } from '../scene/load.js';
//   import { measureRigProfile } from '../rig/measure.js';
//   import { erfasseBind, baueSkeleton } from './solver/kinematik.js';
//   import { loeseBewegung } from './solver/loeser.js';
//
//   const gltf   = await loadGLB(puffer);
//   const profil = measureRigProfile(gltf);
//   const skel   = baueSkeleton(profil, erfasseBind(gltf.scene));
//   const { frames, bericht } = loeseBewegung(profil, skel, timeline);
//
// Die Frames sind doppelt verwendbar:
//   • als solved.frames nach plan.md 5.2: { root:{pos,quat}, joints:{name:quat} }
//   • direkt als Eingabe für die AP4-Physikprüfung pruefePhysik(profil, frames, fps):
//     jedes Frame trägt positions (Knochen→Weltmeter), com, contact und anchored.
//
// Einheiten der Phasenparameter (plan.md 5.5 — dieselben wie add_phase):
//   Tiefe  : Anteil der Körperhöhe            (crouch.tiefe, land.tiefe)
//   Tempo  : Körperhöhen pro Sekunde          (takeoff.vy)
//   Winkel : Grad                              (takeoff.spinX/Y/Z, spinGrad)
//   Zeit   : Frames ganzzahlig, [from, to)    (timeline-Vertrag)
//
// Was der Löser NICHT stillschweigend tut:
//   • gebaute Verben lösen; alles andere bleibt Lücke im Bericht mit Zahl
//   • Overrides auf Gelenkebene werden nach dem Lösen gesetzt und hart auf
//     die gemessene Grenze geklemmt — die Abweichung steht im Bericht
//   • set_target-Ziele können nicht aufgelöst werden, solange kein
//     Endeffektor-Verb gebaut ist: Lücke mit Framezahl, kein Raten

import { validateRigProfile } from '../contracts/rig-profile.js';
import { validateTimeline } from '../contracts/timeline.js';
import { schwerpunkt, sohlenWelt } from './kinematik.js';
import { G, KONTAKT_SCHWELLE_ANTEIL } from '../validate/physics.js';
import { poseZuFk, kopierePose, optimiere } from './ik.js';
import {
  vermesseAusgangslage, startZustand,
  phaseCrouch, phaseTakeoff, phaseAirborne, phaseLand,
} from './verben.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Verben, die dieser Löser baut (plan.md 6.3: Reihenfolge des Auftrags). */
export const GEBAUTE_VERBEN = ['crouch', 'takeoff', 'airborne', 'land'];

/** Alle Verben des Inventars — fehlende werden als Lücke gemeldet. */
export const PHASE_INVENTAR = [
  'stand', 'crouch', 'swing_arms', 'takeoff', 'airborne',
  'land', 'step', 'reach', 'turn', 'settle',
];

const VERBN = {
  crouch: phaseCrouch,
  takeoff: phaseTakeoff,
  airborne: phaseAirborne,
  land: phaseLand,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hauptfunktion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Löst eine Timeline (phases + fps + frameCount, plan.md 5.2) gegen Profil
 * und Skelett.
 *
 * @param {object} profile  RigProfile (plan.md 5.1)
 * @param {object} skel     baueSkeleton(profil, erfasseBind(scene))
 * @param {object} timeline { schemaVersion?, fps, frameCount, phases, overrides? }
 * @param {object} [opts]   { drehimpulsKorrektur: bool } globaler Testhaken
 * @returns {{frames: object[], bericht: object}}
 */
export function loeseBewegung(profile, skel, timeline, opts = {}) {
  // ── Eingaben mit Verträgen prüfen — AP1-Prüfer nutzen, nicht nachbauen ──
  if (!profile || typeof profile !== 'object') {
    throw new Error(`Löser abgelehnt: RigProfile ist ${profile === null ? 'null' : typeof profile}`);
  }
  const pv = validateRigProfile(profile);
  if (!pv.ok) {
    throw new Error(`Löser abgelehnt: RigProfile ungültig (${pv.errors.length} Fehler, erster: ${pv.errors[0].field} — ${pv.errors[0].message})`);
  }
  if (!skel || !skel.byId) {
    throw new Error(`Löser abgelehnt: Skeleton fehlt — baueSkeleton(profile, erfasseBind(scene)) zuerst aufrufen (bekommen: ${skel === null ? 'null' : typeof skel})`);
  }
  if (!timeline || typeof timeline !== 'object') {
    throw new Error(`Löser abgelehnt: Timeline ist ${timeline === null ? 'null' : typeof timeline}`);
  }
  const tl = {
    schemaVersion: timeline.schemaVersion ?? 1,
    fps: timeline.fps,
    frameCount: timeline.frameCount,
    rotationFormat: timeline.rotationFormat ?? 'quaternion',
    phases: timeline.phases ?? [],
    overrides: timeline.overrides ?? {},
  };
  // Anker reisen NEBEN dem geprueften Vertrag mit: validateTimeline kennt sie
  // nicht, und ein unbekanntes Feld darf den Vertrag nicht kippen. Sie werden
  // nach der Pruefung wieder angehaengt, damit halteAnker sie findet.
  const anker = Array.isArray(timeline.anchors) ? timeline.anchors : [];
  const tv = validateTimeline(tl);
  if (!tv.ok) {
    throw new Error(`Löser abgelehnt: Timeline ungültig (${tv.errors.length} Fehler, erster: ${tv.errors[0].field} — ${tv.errors[0].message})`);
  }

  const phasen = tl.phases.slice().sort((a, b) => a.from - b.from);

  // ── Vermessung + Zustand ────────────────────────────────────────────────
  const vorgang = vermesseAusgangslage(skel);
  const ctx = { skel, profile, fps: tl.fps, opts, vorgang };
  const z = startZustand(skel, vorgang);
  const frames = [];
  const bericht = {
    frameCount: tl.frameCount,
    fps: tl.fps,
    koerperhoehe: skel.height,
    phasen: [],
    konflikt: [],          // geopferte Bedingungen — mit Betrag, plan.md 6.4
    lucken: [],            // unverbaute Verben / nicht umsetzbareOverrides
    hinweise: [],
    bewegung: null,        // am Ende nachgemessen: Der Löser muss Bewegung zeigen
    konfiguration: {
      verben: GEBAUTE_VERBEN,
      maxAbsenkung_m: +vorgang.maxAbsenkung.toFixed(4),
      sohlenVersatz_m: +vorgang.sohlenVersatz.toFixed(4),
    },
  };

  // ── Frames vor der ersten Phase: Bind-Stand halten ──────────────────────
  let cursor = 0;
  const holdPhase = { id: 'halt', verb: 'halt' };
  const halteBis = (ziel) => {
    for (; cursor < ziel && cursor < tl.frameCount; cursor++) {
      frames.push(halteFrame(ctx, z, holdPhase, cursor));
    }
  };

  // ── Phasen in Zeitreihenfolge ───────────────────────────────────────────
  for (const phase of phasen) {
    if (!GEBAUTE_VERBEN.includes(phase.verb)) {
      halteBis(Math.min(phase.to, tl.frameCount));
      const n = Math.max(0, Math.min(phase.to, tl.frameCount) - Math.max(phase.from, cursor));
      bericht.lucken.push({
        phase: phase.id, verb: phase.verb, from: phase.from, to: phase.to,
        meldung: `Verb „${phase.verb}“ ist noch nicht gebaut (Inventar plan.md 6.3, umgesetzt: ${GEBAUTE_VERBEN.join(', ')}) — ${n} Frames bleiben gehalten statt geraten`,
      });
      cursor = Math.max(cursor, Math.min(phase.to, tl.frameCount));
      continue;
    }
    halteBis(phase.from);
    if (phase.from < cursor) {
      bericht.hinweise.push(`Phase ${phase.id} (${phase.verb}, ${phase.from}–${phase.to}) überlappt die vorherige bis Frame ${cursor} — spätere Phase gewinnt ab Frame ${cursor}`);
    }
    const r = { ...phase };
    const before = frames.length;
    VERBN[phase.verb](ctx, r, z, frames, bericht);
    cursor = Math.max(cursor, Math.min(phase.to, tl.frameCount));
    bericht.phasen.push({
      id: phase.id, verb: phase.verb, from: phase.from, to: phase.to,
      state: z.kontakt ? 'kontakt' : 'flug',
      frames: frames.length - before,
    });
  }
  halteBis(tl.frameCount);

  // ── Overrides (Ebene 2/3): nach dem Lösen setzen, hart klemmen ──────────
  wendeOverridesAn(ctx, z, tl, frames, bericht);

  // ── Fußanker: NACH den Haltungen, sonst schreiben sie ihn wieder weg ────
  halteAnker(ctx, { ...tl, anchors: anker }, frames, bericht);

  // ── Nachmessen: hat die Timeline Bewegung? (Fehlerfreiheit ist kein Erfolg)
  bericht.bewegung = bewegeKennzahlen(frames);

  return { frames, bericht };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schlüsselbilder und Überblendung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zeitprofil einer Überblendung. `t` läuft von 0 bis 1.
 *
 * `smooth` ist smoothstep (3t²−2t³): Anfangs- und Endgeschwindigkeit sind
 * null, die Bewegung setzt sich an und kommt zur Ruhe. Rein lineare
 * Übergänge zwischen zwei Haltungen starten und stoppen abrupt — genau der
 * „harte Übergang", der im Vorabtest (plan.md 3.2) als Mangel notiert wurde.
 * `hold` hält den Ausgangswert bis zum nächsten Schlüsselbild und springt
 * dort — für harte Schnitte, die gewollt sind.
 */
export const EASE = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  hold: () => 0,
  // `wurf` hat kein Zeitprofil auf [0,1]: die Bahn haengt von der Dauer und von
  // g ab, nicht nur vom Anteil. Sie wird in wurfHoehe() gerechnet; hier steht
  // linear, damit alles, was nicht die Hoehe ist (Seitwaerts, Gelenkwinkel),
  // gleichfoermig laeuft — ohne Luftwiderstand ist das genau richtig.
  wurf: (t) => t,
};

/**
 * Hoehe im freien Fall zwischen zwei Schluesselbildern.
 *
 * Zwischen zwei gesetzten Hoehen gibt es genau EINE Parabel, die beide trifft
 * und dabei konstant mit g nach unten beschleunigt. Ihre Anfangsgeschwindigkeit
 * ergibt sich aus den beiden Hoehen und der Dauer:
 *
 *     y(t) = y0 + v0·t − ½·g·t²      mit  v0 = (y1 − y0 + ½·g·T²) / T
 *
 * Damit ist die zweite Ableitung ueberall exakt −g. Genau das prueft die
 * Ballistikschicht, und genau daran scheiterte die weiche Ueberblendung: sie
 * schwingt zwischen den Frames durch, und die zweite Differenz verstaerkt das
 * bei 30 fps um den Faktor 900.
 *
 * @param {number} y0  Hoehe am ersten Schluesselbild, Meter
 * @param {number} y1  Hoehe am zweiten, Meter
 * @param {number} T   Dauer dazwischen, Sekunden
 * @param {number} t   verstrichene Zeit seit dem ersten, Sekunden
 * @returns {number} Hoehe in Metern
 */
export function wurfHoehe(y0, y1, T, t) {
  if (!(T > 0)) return y1;
  const v0 = (y1 - y0 + 0.5 * G * T * T) / T;
  return y0 + v0 * t - 0.5 * G * t * t;
}

/**
 * Baut aus den gesetzten Frames je Freiheitsgrad eine eigene Kurve.
 *
 * Jeder Kanal hat seine eigene Schlüsselliste — so, wie ein Animator je Kanal
 * setzt. Ein Schlüsselbild, das nur den Ellbogen nennt, legt den Arm nicht
 * fest; die Armkurve läuft unabhängig weiter.
 *
 * @param {object} overrides  timeline.overrides
 * @returns {Map<string, Array<{frame:number, grad:number, ease:string}>>}
 *          Schlüssel ist `gelenk.kanal`, Liste aufsteigend nach Frame
 */
export function baueKurven(overrides) {
  const kurven = new Map();
  for (const [key, ov] of Object.entries(overrides ?? {})) {
    const f = Number(key);
    if (!Number.isInteger(f) || !ov || typeof ov.joints !== 'object' || !ov.joints) continue;
    const ease = EASE[ov.ease] ? ov.ease : 'smooth';
    for (const [gelenk, kanaele] of Object.entries(ov.joints)) {
      for (const [kanal, grad] of Object.entries(kanaele ?? {})) {
        if (typeof grad !== 'number' || !Number.isFinite(grad)) continue;
        const k = `${gelenk}.${kanal}`;
        if (!kurven.has(k)) kurven.set(k, []);
        kurven.get(k).push({ frame: f, grad, ease });
      }
    }
  }
  for (const liste of kurven.values()) liste.sort((a, b) => a.frame - b.frame);
  return kurven;
}

/**
 * Dieselbe Kurvenlogik fuer die Wurzel: wo die Figur steht und wohin sie
 * schaut.
 *
 * Ohne diese Kurven bleibt die Figur an dem Ort, den die Phasen bestimmt
 * haben — bei einer reinen Schluesselbild-Timeline also in der Ausgangslage.
 * Der Agent konnte damit keinen Sprung bauen: Gelenkwinkel allein heben
 * niemanden vom Boden, und im Lauf endete es mit "die Figur hebt nie ab".
 *
 * Vier Kanaele, jeder mit eigener Schluesselliste wie bei den Gelenken:
 * x, y, z der Beckenposition in Metern, turn als Drehung um die Hochachse
 * in Grad.
 *
 * @param {object} overrides  timeline.overrides
 * @returns {Map<string, Array<{frame:number, grad:number, ease:string}>>}
 */
export function baueWurzelkurven(overrides) {
  const kurven = new Map();
  const lege = (kanal, frame, wert, ease) => {
    if (typeof wert !== 'number' || !Number.isFinite(wert)) return;
    if (!kurven.has(kanal)) kurven.set(kanal, []);
    kurven.get(kanal).push({ frame, grad: wert, ease });
  };
  for (const [key, ov] of Object.entries(overrides ?? {})) {
    const f = Number(key);
    if (!Number.isInteger(f) || !ov || !ov.root || typeof ov.root !== 'object') continue;
    const ease = EASE[ov.ease] ? ov.ease : 'smooth';
    const pos = ov.root.pos;
    if (Array.isArray(pos) && pos.length === 3) {
      lege('x', f, pos[0], ease);
      lege('y', f, pos[1], ease);
      lege('z', f, pos[2], ease);
    }
    // Drehung: je Achse eine eigene Kurve. Bewusst in Eulerwinkeln und nicht
    // als Quaternion-Slerp interpoliert — sonst wird aus einer vollen
    // Umdrehung eine Nullbewegung (plan.md 5.2). 0 nach -360 bleibt so ein
    // ganzer Ueberschlag.
    lege('drehX', f, ov.root.drehGrad?.x, ease);
    lege('drehY', f, ov.root.drehGrad?.y ?? ov.root.turnGrad, ease);
    lege('drehZ', f, ov.root.drehGrad?.z, ease);
  }
  for (const liste of kurven.values()) liste.sort((a, b) => a.frame - b.frame);
  return kurven;
}

/**
 * Verankert jede Kanalkurve an den benachbarten Schlüsselbildern.
 *
 * Ohne das springt ein Kanal, statt zu blenden. Gemessen am Agentenlauf vom
 * 1. September 2026: Frame 19 setzte `spine.bend`, Frame 26 zusätzlich
 * `spine.side` und `pelvis.roll`. Die zwei neuen Kanäle hatten nur EIN
 * Schlüsselbild — ihre Kurve galt damit nur auf Frame 26 selbst. Ergebnis:
 * die Neigung des Oberkörpers stand bis Frame 25 bei 1,8° und schlug auf
 * Frame 26 auf 12,3° um. Ein Frame, 10,5° — eine Stufe, keine Bewegung.
 *
 * Isoliert nachgestellt: ein Kanal, der nur auf Frame 30 steht, ergab
 * 5,9° über die Frames 0 bis 29, dann 16,7° auf Frame 30, dann wieder 5,9°.
 *
 * Verankert heißt: der Kanal bekommt am nächstgelegenen Schlüsselbild davor
 * und dahinter eine Stützstelle mit dem Wert, den er ohne Schlüsselbild hätte
 * (die Ausgangshaltung). Dazwischen blendet er wie jeder andere Kanal. Über
 * das nächste Schlüsselbild hinaus wirkt er weiterhin NICHT — die Regel aus
 * kurvenWert bleibt: was außerhalb steht, gehört den Phasen.
 *
 * @param {Map<string, Array>} kurven     aus baueKurven, wird an Ort verändert
 * @param {object} overrides              timeline.overrides
 * @param {(k: string) => number} basiswert  Wert des Kanals in der Ausgangshaltung
 * @returns {number} wie viele Kurven verankert wurden
 */
export function verankereKurven(kurven, overrides, basiswert) {
  const anker = Object.entries(overrides ?? {})
    .map(([key, ov]) => ({ frame: Number(key), ov }))
    .filter((a) => Number.isInteger(a.frame)
      && a.ov && a.ov.joints && Object.keys(a.ov.joints).length > 0)
    .map((a) => ({ frame: a.frame, ease: EASE[a.ov.ease] ? a.ov.ease : 'smooth' }))
    .sort((a, b) => a.frame - b.frame);
  if (anker.length < 2) return 0;

  let verankert = 0;
  for (const [k, liste] of kurven) {
    if (!liste || liste.length === 0) continue;
    // Ein Kanal, den die Ausgangshaltung nicht nennt, steht in der Ruhelage.
    // Ohne diesen Rueckfall verankert nichts: die Basispose fuehrt nur die
    // Freiheitsgrade, die eine Phase belegt hat — bei einer reinen
    // Schluesselbild-Timeline sind das null.
    const roh = basiswert(k);
    const basis = typeof roh === 'number' && Number.isFinite(roh) ? roh : 0;

    let getan = false;

    // VORNE: einblenden. Vor seinem ersten Schluesselbild gab es den Kanal
    // nicht, also kommt er aus der Ruhelage. Ohne diese Stuetzstelle springt er
    // (gemessen: 1,8 Grad auf Frame 25, 12,3 Grad auf Frame 26).
    const davor = anker.filter((a) => a.frame < liste[0].frame).pop();
    if (davor) {
      liste.unshift({ frame: davor.frame, grad: basis, ease: davor.ease });
      getan = true;
    }

    // HINTEN: HALTEN, nicht ausblenden.
    //
    // Der erste Anlauf setzte hier ebenfalls die Ruhelage — und riss damit
    // jede Haltung wieder ein. Setzt der Agent auf Frame 30 pelvis.tilt = 5
    // und nennt den Kanal auf Frame 36 nicht mehr, dann WILL er die Neigung
    // behalten; er wiederholt nicht jeden Kanal in jedem Schluesselbild. Mit
    // der Ruhelage als Stuetzstelle wanderte der Wert zwischen 30 und 36 auf
    // null zurueck: die Figur ging in eine Haltung und wurde wieder
    // herausgezogen. Im Bild sah das aus wie Zucken.
    //
    // Gehalten heisst: dieselbe Zahl noch einmal. Die Kurve laeuft flach
    // weiter bis zum naechsten Schluesselbild und endet dort — was danach
    // kommt, gehoert weiter den Phasen (Regel aus kurvenWert).
    const letzterEigener = liste[liste.length - 1];
    const danach = anker.find((a) => a.frame > letzterEigener.frame);
    if (danach) {
      liste.push({ frame: danach.frame, grad: letzterEigener.grad, ease: letzterEigener.ease });
      getan = true;
    }
    if (getan) verankert += 1;
  }
  return verankert;
}

/**
 * Tangente eines Schluesselbilds fuer die weiche Ueberblendung.
 *
 * Warum es sie gibt: `smooth` war smoothstep, t²(3−2t). Dessen Ableitung ist
 * an BEIDEN Enden null — jeder Kanal blieb also an jedem Schluesselbild kurz
 * stehen und lief wieder an. Gemessen am Anlauf des Laufs vom 1. September
 * 2026, Fusshoehe foot_l ueber die Frames 3–15 mit Schluesselbildern auf
 * 3, 5, 7, 11, 13, 15:
 *
 *     F4 → F5   +112,9 mm      (volle Fahrt)
 *     F5 → F6    +15,2 mm      (Key auf F5: Vollbremsung, Faktor 7)
 *     F8 → F9     −2,7 mm      (praktisch Stillstand)
 *
 * Schwankung zwischen 2,7 und 112,9 mm je Frame, Faktor 42, dazu vier
 * Richtungswechsel in zwoelf Frames. Ein menschlicher Schwungfuss hat EINE
 * Kurve: hoch, Scheitel, runter.
 *
 * Die Tangente kommt aus den NACHBARN (Catmull-Rom bei ungleichen
 * Abstaenden), damit der Wert durch das Schluesselbild hindurchlaeuft statt
 * dort anzuhalten. Das ist dieselbe Rechnung, die Maya und Blender „Auto"
 * bzw. „Spline" nennen.
 *
 * Sie ist MONOTON gedeckelt (Fritsch–Carlson): wo die beiden angrenzenden
 * Sekanten das Vorzeichen wechseln, wird die Tangente null. Ohne diesen
 * Deckel schwingt Catmull-Rom an Wendepunkten ueber — bei 30 fps verstaerkt
 * die zweite Differenz das um den Faktor 900, und Ballistik- wie
 * Bodenpruefung melden Fehler, die die Bewegung nicht hat (siehe
 * wurfHoehe()).
 *
 * @param {Array<{frame:number, grad:number, ease:string}>} liste  Schluessel, aufsteigend
 * @param {number} i  Index des Schluesselbilds
 * @returns {number} Steigung in Grad (bzw. Metern) je Frame
 */
export function tangente(liste, i) {
  const p = liste[i];
  const vor = i > 0 ? liste[i - 1] : null;
  const nach = i < liste.length - 1 ? liste[i + 1] : null;

  // `hold` heisst: der Wert steht bis zum naechsten Schluessel. Ein Anlaufen
  // aus dem Stillstand ist dort gewollt, keine Steifheit.
  if (vor && vor.ease === 'hold') return 0;
  if (p.ease === 'hold') return 0;

  const sekante = (a, b) => (b.frame > a.frame ? (b.grad - a.grad) / (b.frame - a.frame) : 0);
  const dVor = vor ? sekante(vor, p) : null;
  const dNach = nach ? sekante(p, nach) : null;

  if (dVor === null && dNach === null) return 0;
  if (dVor === null) return dNach;   // erstes Schluesselbild: einseitig
  if (dNach === null) return dVor;   // letztes Schluesselbild: einseitig

  // Vorzeichenwechsel oder Plateau: Scheitelpunkt, Tangente null. Genau das
  // haelt den Ueberschwinger heraus.
  if (dVor * dNach <= 0) return 0;

  // Catmull-Rom ueber die gesamte Nachbarspanne, dann auf das Dreifache der
  // kleineren Sekante gedeckelt — die Monotoniebedingung von Fritsch-Carlson.
  const roh = (nach.grad - vor.grad) / (nach.frame - vor.frame);
  const deckel = 3 * Math.min(Math.abs(dVor), Math.abs(dNach));
  return Math.sign(roh) * Math.min(Math.abs(roh), deckel);
}

/**
 * Wert einer Kurve in einem Frame, oder null außerhalb ihrer Spanne.
 *
 * Die Kurve gilt von ihrem ersten bis zu ihrem letzten Schlüsselbild. Davor
 * und danach steht, was die Phasen gerechnet haben — sonst überschriebe ein
 * einzelner gesetzter Winkel stillschweigend die ganze Zeitachse. Wer die
 * Haltung bis zum Ende halten will, setzt dort ein Schlüsselbild.
 */
export function kurvenWert(liste, f, { hoehenachse = false, fps = 0 } = {}) {
  if (!liste || liste.length === 0) return null;
  if (f < liste[0].frame || f > liste[liste.length - 1].frame) return null;
  let i = 0;
  while (i < liste.length - 1 && liste[i + 1].frame <= f) i += 1;
  const a = liste[i];
  if (a.frame === f) return a.grad;
  const b = liste[i + 1];
  if (!b) return a.grad;
  const spanne = b.frame - a.frame;
  const t = spanne > 0 ? (f - a.frame) / spanne : 1;
  // Freier Fall: nur auf der Hoehenachse, und dort als echte Parabel statt als
  // Anteil. fps wird gebraucht, weil die Bahn von der DAUER abhaengt, nicht
  // vom Bruchteil der Strecke.
  if (a.ease === 'wurf' && hoehenachse && fps > 0) {
    const T = spanne / fps;
    return wurfHoehe(a.grad, b.grad, T, t * T);
  }
  // Weiche Ueberblendung laeuft als Hermite-Kurve DURCH die Schluesselbilder,
  // statt an jedem auf null zu bremsen. linear, hold und wurf bleiben, was sie
  // sind: der Agent hat sie ausdruecklich gewaehlt.
  if ((a.ease ?? 'smooth') === 'smooth') {
    const dt = spanne;
    const m0 = tangente(liste, i) * dt;
    const m1 = tangente(liste, i + 1) * dt;
    const s2 = t * t, s3 = s2 * t;
    return (2 * s3 - 3 * s2 + 1) * a.grad
         + (s3 - 2 * s2 + t) * m0
         + (-2 * s3 + 3 * s2) * b.grad
         + (s3 - s2) * m1;
  }
  const form = EASE[a.ease] ?? EASE.smooth;
  return a.grad + (b.grad - a.grad) * form(t);
}

/**
 * Drei Eulerwinkel in Grad (Reihenfolge x, y, z) zu Achse mal Winkel in Grad.
 *
 * Der Loeser stellt die Ganzkoerperdrehung als `waxis` dar: ein Vektor, dessen
 * Laenge der Winkel in Grad ist. Der Agent denkt aber in Achsen — Salto,
 * Drehung, Kippen. Diese Funktion ist die Uebersetzung dazwischen.
 *
 * Ueber 360 Grad hinaus wird NICHT normiert: eine Umdrehung von -720 Grad ist
 * ein doppelter Ueberschlag und muss als solcher stehenbleiben, sonst wird aus
 * zwei Salti ein Stillstand.
 */
export function eulerZuAchsenwinkel(xGrad, yGrad, zGrad) {
  const r = Math.PI / 180;
  const gesamt = Math.hypot(xGrad, yGrad, zGrad);
  if (gesamt < 1e-9) return [0, 0, 0];

  // Nur eine Achse belegt: direkt durchreichen, ohne Umweg ueber Quaternionen.
  // Das haelt volle Umdrehungen exakt und ist der haeufige Fall.
  const belegt = [xGrad, yGrad, zGrad].filter((g) => Math.abs(g) > 1e-9);
  if (belegt.length === 1) return [xGrad, yGrad, zGrad];

  // Mehrachsig: ueber Quaternionen zusammensetzen (x, dann y, dann z).
  const halb = (g) => (g * r) / 2;
  const q = [0, 0, 0, 1];
  const mul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  let erg = q;
  const achsen = [[1, 0, 0, xGrad], [0, 1, 0, yGrad], [0, 0, 1, zGrad]];
  for (const [ax, ay, az, g] of achsen) {
    if (Math.abs(g) < 1e-9) continue;
    const sh = Math.sin(halb(g));
    erg = mul(erg, [ax * sh, ay * sh, az * sh, Math.cos(halb(g))]);
  }
  const w = Math.min(1, Math.max(-1, erg[3]));
  const winkel = 2 * Math.acos(w) / r;
  const sin = Math.sqrt(Math.max(0, 1 - w * w));
  if (sin < 1e-9) return [0, 0, 0];
  return [erg[0] / sin * winkel, erg[1] / sin * winkel, erg[2] / sin * winkel];
}

// ─────────────────────────────────────────────────────────────────────────────
// Override-Ebene
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setzt die Schlüsselbilder um — samt Überblendung dazwischen.
 *
 * Vorher stanzte diese Stelle jeden gesetzten Frame einzeln in die fertige
 * Bewegung: ein Winkel auf Frame 10 und einer auf Frame 30 ergaben zwei
 * veränderte Frames, dazwischen stand unverändert das Ergebnis der Phasen.
 * Damit war kein Bewegungsablauf zu bauen — nur einzelne Standbilder.
 *
 * Jetzt trägt jeder Freiheitsgrad eine eigene Kurve (baueKurven) und wird
 * über seine Spanne hinweg ausgewertet. Was außerhalb aller Kurven liegt,
 * bleibt unberührt: Phasen und Schlüsselbilder stehen nebeneinander.
 *
 * Gelenkgrenzen bleiben hart (plan.md 6.4, Rang 1). Geklemmt wird der
 * ausgewertete Wert, gemeldet wird an den gesetzten Frames — sonst stünde
 * dieselbe Überschreitung in jedem Frame der Überblendung.
 */
function wendeOverridesAn(ctx, z, tl, frames, bericht) {
  const { skel } = ctx;

  // Ziele (Ebene 2) und Frames außerhalb der Timeline: unverändert melden.
  for (const [key, ov] of Object.entries(tl.overrides ?? {})) {
    const f = Number(key);
    if (!frames.find((x) => x.frame === f)) {
      bericht.lucken.push({
        frame: f,
        meldung: `Override für Frame ${f}: kein gelöster Frame — Timeline endet bei ${tl.frameCount - 1}`,
      });
      continue;
    }
    if (ov && (ov.targets || ov.pos)) {
      bericht.lucken.push({
        frame: f,
        meldung: `Override für Frame ${f} setzt ein Ziel (set_target, plan.md 5.5 Nr. 10): `
          + `Endeffektor-Ziele löst der Löser erst mit den Verben reach/step — `
          + `${Object.keys(ov).join(', ')} unverändert gelassen`,
      });
    }
  }

  const kurven = baueKurven(tl.overrides);
  const wurzelkurven = baueWurzelkurven(tl.overrides);
  if (kurven.size === 0 && wurzelkurven.size === 0) return;

  // Kurven ohne Entsprechung im vermessenen Profil fallen hier raus — einmal
  // gemeldet, nicht je Frame.
  const gueltig = new Map();
  for (const [k, liste] of kurven) {
    const d = skel.dofs[k];
    if (!d) {
      bericht.lucken.push({
        key: k,
        meldung: `Override-Gelenk „${k}“ nicht im Profil `
          + `(${Object.keys(skel.dofs).length} Freiheitsgrade durchsucht)`,
      });
      continue;
    }
    gueltig.set(k, { liste, d });
    for (const s of liste) {
      const gek = Math.min(d.grenze[1], Math.max(d.grenze[0], s.grad));
      if (Math.abs(gek - s.grad) > 1e-6) {
        bericht.konflikt.push({
          frame: s.frame, verb: 'keyframe', bedingung: 'gelenkwinkel', einheit: 'grad',
          soll: s.grad, erreicht: gek, betrag: Math.abs(s.grad - gek),
          grund: `Gelenkgrenze ${d.grenze.join('…')}° (Rang 1, nie verletzt)`,
          meldung: `Schlüsselbild ${k} Frame ${s.frame}: verlangte ${s.grad}°, `
            + `geklemmt auf ${gek}° — Gelenkgrenze lässt ${d.grenze[0]}…${d.grenze[1]}° zu`,
        });
      }
    }
  }
  if (gueltig.size === 0 && wurzelkurven.size === 0) return;

  // Erst nach der Klemmprüfung verankern: die Ankerpunkte kommen aus der
  // Ausgangshaltung und sind keine Forderung des Agenten — eine Klemmmeldung
  // über sie wäre eine Meldung über etwas, das niemand verlangt hat.
  const verankert = verankereKurven(
    new Map([...gueltig].map(([k, v]) => [k, v.liste])),
    tl.overrides,
    (k) => z.pose.dofs[k],
  );

  // Spanne über alle Kurven — Gelenke UND Wurzel: nur darin wird geschrieben.
  let von = Infinity, bis = -Infinity;
  for (const { liste } of gueltig.values()) {
    von = Math.min(von, liste[0].frame);
    bis = Math.max(bis, liste[liste.length - 1].frame);
  }
  for (const liste of wurzelkurven.values()) {
    von = Math.min(von, liste[0].frame);
    bis = Math.max(bis, liste[liste.length - 1].frame);
  }

  let geschrieben = 0;
  for (const frame of frames) {
    const f = frame.frame;
    if (f < von || f > bis) continue;
    const pose = kopierePose(z.pose);
    let getroffen = 0;
    for (const [k, { liste, d }] of gueltig) {
      const wert = kurvenWert(liste, f);
      if (wert === null) continue;
      pose.dofs[k] = Math.min(d.grenze[1], Math.max(d.grenze[0], wert));
      getroffen += 1;
    }
    // Wurzel: Position in Metern, Drehung in Grad um die Hochachse. Nur
    // ueberschrieben, wo eine Kurve gilt — sonst bleibt der Wert der Phasen.
    for (const achse of ['x', 'y', 'z']) {
      const wert = kurvenWert(wurzelkurven.get(achse), f,
        { hoehenachse: achse === 'y', fps: tl.fps });
      if (wert === null) continue;
      pose.wpos[{ x: 0, y: 1, z: 2 }[achse]] = wert;
      getroffen += 1;
    }
    const dx = kurvenWert(wurzelkurven.get('drehX'), f);
    const dy = kurvenWert(wurzelkurven.get('drehY'), f);
    const dz = kurvenWert(wurzelkurven.get('drehZ'), f);
    if (dx !== null || dy !== null || dz !== null) {
      // pose.waxis ist Achse mal Winkel in Grad um pose.pivot. Die drei
      // Eulerwinkel werden dafuer in eine Achse-Winkel-Darstellung gebracht.
      pose.waxis = eulerZuAchsenwinkel(dx ?? 0, dy ?? 0, dz ?? 0);
      pose.pivot = [...pose.wpos];
      getroffen += 1;
    }
    if (getroffen === 0) continue;
    ueberschreibeFrame(ctx, skel, frame, pose, poseZuFk(skel, pose));
    geschrieben += 1;
  }

  bericht.hinweise.push(`${gueltig.size} Gelenkkanäle und ${wurzelkurven.size} Wurzelkanäle `
    + `aus ${gesetzteSchluessel(tl.overrides)} Schlüsselbildern über Frames ${von}–${bis} `
    + `überblendet (${geschrieben} Frames gesetzt, ${verankert} Kanäle am Nachbar-Schlüsselbild `
    + 'verankert).');
}

/** Wie viele Frames eine Haltung tragen — für die Meldung. */
function gesetzteSchluessel(overrides) {
  return Object.values(overrides ?? {})
    .filter((o) => o && o.joints && Object.keys(o.joints).length > 0).length;
}

/**
 * Misst, ob die Figur in dieser Pose den Boden beruehrt.
 *
 * Warum das hier stehen muss: Beim Ueberschreiben eines Frames wurden bisher
 * Positionen, Schwerpunkt, Gelenke und Wurzel neu gerechnet — `contact` blieb
 * stehen. Der Validator glaubt dem gesetzten Feld mehr als der gemessenen
 * Sohlenhoehe (src/validate/physics.js, phaseOf). Nachgemessen am Xbot: Wurzel
 * von 1,04 m auf 2,04 m gehoben, Schwerpunkt danach 2,07 m ueber dem Boden —
 * der Frame meldete weiter "kontakt". Damit griffen Flugpruefungen nie, und
 * Balance- und Rutschpruefungen liefen auf eine fliegende Figur.
 *
 * Gemessen wird an denselben Sohlenpunkten und mit derselben Schwelle wie in
 * der Physikpruefung: beruehrt der tiefste Sohlenpunkt den Boden bis auf
 * KONTAKT_SCHWELLE_ANTEIL der Koerperhoehe, ist es Kontakt.
 *
 * @param {object} skel  Skelett mit soles und height
 * @param {Map} kn       Vorwaertskinematik dieser Pose
 * @returns {'kontakt'|'flug'}
 */
function messeKontakt(skel, kn) {
  const sohlen = sohlenWelt(skel, kn);
  if (sohlen.length === 0) return 'kontakt';
  const boden = skel.profile?.world?.groundY ?? 0;
  const schwelle = (skel.height ?? 1) * KONTAKT_SCHWELLE_ANTEIL;
  const tiefste = Math.min(...sohlen.map((s) => s.pos[1]));
  return (tiefste - boden) <= schwelle ? 'kontakt' : 'flug';
}

/** Pose-Änderung in einen fertigen Frame zurückschreiben. */
/**
 * Hält festgenagelte Füße an ihrem Ort — die Antwort auf „der Fuß rutscht".
 *
 * Warum es das braucht, gemessen an zwei Agentenläufen am 1. September 2026:
 * der Agent setzt Gelenkwinkel und wird an Weltpositionen gemessen. Damit ein
 * Standfuß beim Gehen stehen bleibt, müsste er die Beinkette im Kopf rechnen —
 * für jeden Frame, während sich das Becken bewegt. Er hat es versucht: 213
 * Sekunden für einen Block, und danach rutschten die Füße immer noch bis 31 cm.
 *
 * Diese Rechnung ist die Aufgabe des Lösers. hold_foot setzt den Anker, hier
 * wird er durchgesetzt: für jeden Frame der Spanne wird die Beinkette so
 * optimiert, dass der Fuß dort bleibt, wo er zu Beginn der Spanne stand.
 * Gelenkgrenzen bleiben hart (das macht optimiere), die Wurzel bleibt fest —
 * der Agent bestimmt weiter, WO die Figur steht.
 *
 * Läuft NACH wendeOverridesAn: sonst schreiben die Haltungen den Anker wieder weg.
 *
 * Was nicht erreicht wurde, steht mit Betrag im Bericht. Ein Anker, der nicht
 * zu halten ist (Bein zu kurz), wird gemeldet, nicht stillschweigend verfehlt.
 */
function halteAnker(ctx, tl, frames, bericht) {
  const { skel } = ctx;
  const anker = Array.isArray(tl.anchors) ? tl.anchors : [];
  if (anker.length === 0) return;

  for (const a of anker) {
    const knochen = skel.rollenKnochen?.[a.foot];
    if (!knochen) {
      bericht.lucken.push({
        meldung: `Anker für „${a.foot}“: diese Rolle ist am Modell nicht zugeordnet `
          + `(${Object.keys(skel.rollenKnochen ?? {}).length} Rollen bekannt)`,
      });
      continue;
    }

    // Die Kette vom Becken zu diesem Fuß — aber NUR die Kanaele, die der Agent
    // nie angefasst hat.
    //
    // Vorher standen alle hip/knee/ankle-Kanaele der Seite zur Verfuegung, die
    // gesetzten mit Gewicht 4 gegen den Anker mit 100. Das ist 25 zu 1: der
    // Anker gewann jedes Mal, und die Handschrift des Agenten wurde
    // weggebogen. Gemessen an Frame 58 des Laufs vom 1. September 2026: der
    // Agent setzte hip_r.flex 20, heraus kam 20.6 — dazu spread -7.7 und
    // twist 0.3 auf Kanaelen, die er nie genannt hatte. Aus seiner Sicht ging
    // die Figur in eine Haltung und wurde wieder herausgerissen.
    //
    // Gesetzt heisst jetzt fest. Reicht der Rest nicht, um den Fuss zu halten,
    // steht das als Konflikt im Bericht — der Loeser darf scheitern, aber er
    // darf die Vorgabe nicht umschreiben (AGENTS.md, "Der Loeser korrigiert,
    // der Validator prueft die Nachbedingung").
    const vomAgenten = new Set(baueKurven(tl.overrides).keys());
    const seite = a.foot.endsWith('_l') ? '_l' : '_r';
    const beinKanaele = Object.keys(skel.dofs).filter(
      (k) => /^(hip|knee|ankle)/.test(k) && k.split('.')[0].endsWith(seite));
    const frei = beinKanaele.filter((k) => !vomAgenten.has(k));
    if (beinKanaele.length === 0) {
      bericht.lucken.push({ meldung: `Anker für „${a.foot}“: 0 Beingelenke gefunden` });
      continue;
    }

    const inSpanne = frames.filter((f) => f.frame >= a.von && f.frame <= a.bis && f.loeserPose);
    if (inSpanne.length === 0) {
      bericht.lucken.push({
        meldung: `Anker für „${a.foot}“ über Frames ${a.von}–${a.bis}: 0 gelöste Frames darin`,
      });
      continue;
    }

    // Sollort: wo der Fuss im ERSTEN Frame der Spanne steht. Der Agent hat ihn
    // dort hingestellt; ab da bleibt er.
    const soll = inSpanne[0].positions?.[knochen];
    if (!soll) continue;

    let groesster = 0;
    let verbogeneFrames = 0;
    for (const f of inSpanne) {
      // Die gesetzte Haltung ist die WEICHE Vorgabe, gegen die optimiert wird.
      //
      // Ohne sie behandelt die IK die Beinwinkel als voellig frei und sucht
      // irgendeine Loesung, die den Fuss haelt. Gemessen am Lauf vom
      // 1. September 2026: 11 gesetzte Beinwinkel wurden um mehr als 10 Grad
      // verbogen, bei hip_r.flex auf Frame 19 sogar das Vorzeichen gedreht —
      // der Agent wollte das Bein nach hinten, die IK zog es nach vorn. Aus
      // seiner Sicht ging die Figur in eine Haltung und wurde wieder
      // herausgerissen.
      //
      // `haltung` haelt die FREIEN Kanaele nahe an ihrer Ausgangslage, damit
      // die IK sie nicht grundlos verdreht (GEWICHT.anker 100 gegen
      // GEWICHT.haltung 4, siehe ik.js). Die gesetzten Kanaele sind gar nicht
      // erst in `kette` — sie koennen nicht mehr verbogen werden.
      // Zwei Durchgaenge, in dieser Reihenfolge:
      //
      //   1. NUR die Kanaele, die der Agent nie angefasst hat. Wo der Fuss
      //      damit steht, bleibt seine Haltung unberuehrt — er hat sie so
      //      gewollt.
      //   2. Reicht das nicht, kommen die gesetzten dazu. Dann wird verbogen,
      //      aber der Betrag steht im Bericht. Stumm umschreiben waere das,
      //      was den Agenten vorher aus seinen eigenen Haltungen gerissen hat.
      const lauf = (kanaele) => {
        if (kanaele.length === 0) return null;
        const haltung = {};
        for (const k of kanaele) haltung[k] = f.loeserPose.dofs[k] ?? 0;
        const ziele = { anker: [{ knochen, soll: [...soll], id: a.foot }], com: null, boden: [], haltung };
        // Kopie: optimiere() arbeitet auf der uebergebenen Pose. Ohne sie
        // startet der zweite Durchgang auf dem Ergebnis des ersten.
        const erg = optimiere(skel, kopierePose(f.loeserPose), ziele, kanaele, { wurzelFrei: false });
        const kn = poseZuFk(skel, erg.pose);
        const ist = kn.get(knochen)?.pos;
        const rest = ist ? Math.hypot(ist[0] - soll[0], ist[1] - soll[1], ist[2] - soll[2]) : Infinity;
        return { erg, kn, rest };
      };

      const toleranz = skel.height * 0.02;
      let treffer = lauf(frei);
      if (!treffer || treffer.rest > toleranz) {
        const voll = lauf(beinKanaele);
        if (voll && (!treffer || voll.rest < treffer.rest)) {
          treffer = voll;
          verbogeneFrames += 1;
        }
      }
      if (!treffer) continue;
      ueberschreibeFrame(ctx, skel, f, treffer.erg.pose, treffer.kn);
      groesster = Math.max(groesster, treffer.rest);
    }

    bericht.hinweise.push(`Anker ${a.foot} über Frames ${a.von}–${a.bis} gehalten `
      + `(${inSpanne.length} Frames, ${frei.length} freie Gelenke, `
      + `größte verbleibende Abweichung ${(groesster * 100).toFixed(1)} cm).`);
    if (verbogeneFrames > 0) {
      bericht.hinweise.push(`Dafür mussten in ${verbogeneFrames} von ${inSpanne.length} Frames `
        + `auch von dir gesetzte Beinwinkel nachgeben — die freien Kanäle `
        + `(${frei.length} von ${beinKanaele.length}) reichten dort nicht aus. `
        + 'Willst du deine Winkel unangetastet, verkürze die Ankerspanne oder '
        + 'stelle die Wurzel näher an den Fuß.');
    }
    if (groesster > skel.height * 0.02) {
      bericht.konflikt.push({
        frame: a.von, verb: 'anker', bedingung: 'fussanker', einheit: 'm',
        soll: 0, erreicht: +groesster.toFixed(4), betrag: +groesster.toFixed(4),
        grund: 'Beinkette reicht nicht bis zum Ankerpunkt',
        meldung: `Anker ${a.foot} über Frames ${a.von}–${a.bis} um bis zu `
          + `${(groesster * 100).toFixed(1)} cm verfehlt — die Wurzel steht zu weit weg, `
          + 'setze sie näher oder verkürze die Ankerspanne',
      });
    }
  }
}

function ueberschreibeFrame(ctx, skel, frame, pose, kn) {
  const com = schwerpunkt(skel, kn).com;
  const positionen = {};
  for (const [id, b] of kn) positionen[id] = [...b.pos];
  const joints = {};
  for (const [name, j] of Object.entries(skel.profile.joints)) {
    const b = kn.get(j.bone);
    if (b) joints[name] = [...b.quat];
  }
  frame.positions = positionen;
  frame.solePositions = sohlenVerzeichnis(skel, kn);
  frame.com = [...com];
  frame.joints = joints;
  frame.root = { pos: [...pose.wpos], quat: [...(wurzelQ(pose))] };
  // Die gefahrenen Gelenkwinkel in Grad. Ohne sie kann der Agent nur ablesen,
  // WO Koerperteile stehen, nicht WIE die Gelenke stehen — er sieht seine
  // eigene Haltung nicht und kann sie nicht gezielt nachbessern.
  frame.dofs = { ...pose.dofs };
  // Der Bewegungszustand wird MITGERECHNET, nicht uebernommen: eine Haltung,
  // die die Figur vom Boden hebt, muss auch als Flug gelten.
  frame.contact = messeKontakt(skel, kn);
  frame.loeserPose = kopierePose(pose);
  frame.override = true;
}

function wurzelQ(pose) {
  const w = Math.hypot(...pose.waxis);
  return w > 1e-12 ? quatAchseWinkel(pose.waxis, w) : [0, 0, 0, 1];
}

function quatAchseWinkel(achse, grad) {
  const l = Math.hypot(achse[0], achse[1], achse[2]) || 1;
  const h = (grad * Math.PI / 180) / 2;
  const s = Math.sin(h);
  return [achse[0] / l * s, achse[1] / l * s, achse[2] / l * s, Math.cos(h)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Halteframe (Bind-Pose oder letzte Pose, phasenzustandstreue Markierung)
// ─────────────────────────────────────────────────────────────────────────────

function halteFrame(ctx, z, phase, f) {
  const { skel } = ctx;
  const kn = poseZuFk(skel, z.pose);
  const com = schwerpunkt(skel, kn).com;
  const positionen = {};
  for (const [id, b] of kn) positionen[id] = [...b.pos];
  const joints = {};
  for (const [name, j] of Object.entries(skel.profile.joints)) {
    const b = kn.get(j.bone);
    if (b) joints[name] = [...b.quat];
  }
  return {
    frame: f,
    phase: phase.id,
    root: { pos: [...z.pose.wpos], quat: [...wurzelQ(z.pose)] },
    joints,
    positions: positionen,
    solePositions: sohlenVerzeichnis(skel, kn),
    com: [...com],
    dofs: { ...z.pose.dofs },
    contact: z.kontakt ? 'kontakt' : 'flug',
    anchored: z.kontakt ? soleIds(skel, z.anker) : [],
    geschwindigkeit: [...z.comVel],
  };
}

/**
 * Weltpositionen der Sohlenpunkte als {id: [x,y,z]} fuer einen Frame.
 *
 * Warum das an den Frame gehoert: die Physikpruefung entschied ueber
 * Bodenkontakt bisher mit `bonesOf(f)[s.bone]` — also mit der Position des
 * FUSSKNOCHENS, fuer alle vier Sohlen desselben Fusses dieselbe. Der lokale
 * Versatz s.local wurde nie angewendet. Am Xbot liegt der Fussknochen 7,2 cm
 * ueber der Sohle; die Kontaktschwelle von 3,5 % der Koerperhoehe (6,3 cm)
 * gleicht genau diesen Rechenfehler aus, statt eine Toleranz zu sein.
 *
 * Mit den echten Sohlenpunkten braucht die Pruefung keine aufgeblasene
 * Schwelle mehr und kann sagen, welcher Fuss traegt — statt nur, ob die Figur
 * irgendwo den Boden beruehrt.
 */
function sohlenVerzeichnis(skel, kn) {
  const out = {};
  for (const s of sohlenWelt(skel, kn)) out[s.id] = [...s.pos];
  return out;
}

function soleIds(skel, anker) {
  const out = [];
  for (const a of anker) for (const s of skel.soles) if (s.bone === a.knochen) out.push(s.id);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bewegungsnachweis — Zahlen statt Eindrücken
// ─────────────────────────────────────────────────────────────────────────────

function bewegeKennzahlen(frames) {
  if (frames.length < 2) {
    return { frames: frames.length, meldung: 'zu wenige Frames für Bewegungsmessung' };
  }
  let comWeg = 0, maxSpeed = 0, toteFrames = 0;
  let rotWeg = 0;
  let kontaktwechsel = 0;
  let letzter = null;
  let qVorher = frames[0].root?.quat ?? null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].com, b = frames[i].com;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    comWeg += d;
    maxSpeed = Math.max(maxSpeed, d);
    if (d < 1e-5) toteFrames++;
    const rq = frames[i].root?.quat;
    if (rq && qVorher) {
      // Winkel zwischen aufeinanderfolgenden Wurzelquaternionen:
      // 2·atan2(|q₁⁻¹q₂|_vektor, q₁⁻¹q₂_skalar) — Betragsaddition,
      // Vorzeichensprünge (359°→−1°) zählen als Bewegung, nicht als Stillstand.
      const inv = [-qVorher[0], -qVorher[1], -qVorher[2], qVorher[3]];
      const dqx = inv[3]*rq[0] + inv[0]*rq[3] + inv[1]*rq[2] - inv[2]*rq[1];
      const dqy = inv[3]*rq[1] - inv[0]*rq[2] + inv[1]*rq[3] + inv[2]*rq[0];
      const dqz = inv[3]*rq[2] + inv[0]*rq[1] - inv[1]*rq[0] + inv[2]*rq[3];
      const dqw = inv[3]*rq[3] - inv[0]*rq[0] - inv[1]*rq[1] - inv[2]*rq[2];
      rotWeg += 2 * Math.atan2(Math.hypot(dqx, dqy, dqz), dqw) * 180 / Math.PI;
    }
    if (rq) qVorher = rq;
    if (letzter && frames[i].contact !== letzter) kontaktwechsel++;
    letzter = frames[i].contact;
  }
  return {
    frames: frames.length,
    schwerpunktWeg_m: +comWeg.toFixed(4),
    starksteFrameBewegung_m: +maxSpeed.toFixed(4),
    toteFrames,
    wurzelDrehungWeg_grad: +rotWeg.toFixed(1),
    kontaktwechsel,
  };
}
