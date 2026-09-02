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
import { schwerpunkt, sohlenWelt, vAdd, vSub, vScale, qRot, qconj } from './kinematik.js';
import { G, KONTAKT_SCHWELLE_ANTEIL, BODEN_TOLERANZ_ANTEIL } from '../validate/physics.js';
import { poseZuFk, kopierePose, optimiere, ANKER_TOLERANZ_ANTEIL } from './ik.js';
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
  const aktiveAnker = halteAnker(ctx, { ...tl, anchors: anker }, frames, bericht);

  // ── Rang 2 zuletzt: was noch im Boden steckt, wird angehoben und gemeldet ──
  bodenfreiheit(ctx, frames, bericht);

  // ── Ankerbericht am Endstand: eine Anhebung steht dort als Grund ────────
  berichteAnker(ctx, aktiveAnker, frames, bericht);

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
 * WORAUF die Parabel liegt, entscheidet der Aufrufer. Auf die Wurzelhoehe
 * gelegt stimmt sie nur bei gehaltener Flugpose; gemessen wird der
 * Schwerpunkt. Deshalb ruft wurfSchwerpunktbahn() sie mit den SCHWERPUNKTEN
 * der beiden Schluesselbilder und zieht den Posenabstand wieder ab.
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
 * Verankert jede Kanalkurve am vorigen Schlüsselbild und am Timeline-Ende.
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
 * Verankert heißt: vor dem ersten eigenen Schlüsselbild bekommt der Kanal die
 * Ausgangshaltung. Nach seinem letzten eigenen Schlüsselbild erhält er am
 * letzten Timeline-Frame denselben Wert. Ein fremdes Schlüsselbild beendet
 * den Kanal damit nicht; erst sein nächster eigener Wert ändert ihn.
 *
 * @param {Map<string, Array>} kurven     aus baueKurven, wird an Ort verändert
 * @param {object} overrides              timeline.overrides
 * @param {(k: string) => number} basiswert  Wert des Kanals in der Ausgangshaltung
 * @param {number} endeFrame              letzter gültiger Timeline-Frame
 * @returns {number} wie viele Kurven verankert wurden
 */
export function verankereKurven(kurven, overrides, basiswert, endeFrame) {
  const anker = Object.entries(overrides ?? {})
    .map(([key, ov]) => ({ frame: Number(key), ov }))
    .filter((a) => Number.isInteger(a.frame)
      && a.ov && a.ov.joints && Object.keys(a.ov.joints).length > 0)
    .map((a) => ({ frame: a.frame, ease: EASE[a.ov.ease] ? a.ov.ease : 'smooth', haltung: a.ov.haltung === true }))
    .sort((a, b) => a.frame - b.frame);
  const ende = Number.isInteger(endeFrame) && endeFrame >= 0 ? endeFrame : null;

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

    // HALTUNGS-SCHLÜSSELBILDER (set_pose, `haltung: true`): ein solches
    // Schlüsselbild ist die GANZE Haltung. Ein Kanal, den es nicht nennt,
    // steht dort in der Ruhelage — so wie ein Animator ein Schlüsselbild
    // liest. Ein Nachtrag per set_joint (ohne die Marke) lässt die übrigen
    // Kanäle in Ruhe.
    //
    // Lauf 10 vom 2. September 2026: toes_l.bend 35 auf Frame 36 gesetzt
    // (Absprung), in keinem der acht späteren Schlüsselbilder genannt — der
    // Kanal blieb bis Frame 95 auf 35°, die Zehenspitze stand die ganze
    // Landung über 6 cm im Boden. Der Agent hatte das nie gewollt und
    // konnte es nicht sehen.
    const eigene = new Set(liste.map((s) => s.frame));
    for (const h of anker) {
      if (!h.haltung || eigene.has(h.frame)) continue;
      liste.push({ frame: h.frame, grad: basis, ease: h.ease });
      getan = true;
    }
    liste.sort((a, b) => a.frame - b.frame);

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
    // Gehalten heißt: dieselbe Zahl noch einmal am Ende der Timeline. Ein
    // Schlüsselbild für Knie oder Hüfte darf den Ellbogen nicht wegnehmen.
    const letzterEigener = liste[liste.length - 1];
    if (ende !== null && ende > letzterEigener.frame) {
      liste.push({ frame: ende, grad: letzterEigener.grad, ease: letzterEigener.ease });
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
    tl.frameCount - 1,
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

  // ── Durchgang 1: Haltung und Wurzel OHNE Höhe ─────────────────────────────
  //
  // Die Höhe kommt zuletzt, weil sie von der fertigen Haltung abhängt: wo der
  // tiefste Punkt der Figur liegt, weiß man erst, wenn Knie, Hüfte und
  // Drehung stehen. Deshalb werden hier nur Entwürfe gesammelt.
  const entwuerfe = [];
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
    for (const achse of ['x', 'z']) {
      const wert = kurvenWert(wurzelkurven.get(achse), f);
      if (wert === null) continue;
      pose.wpos[{ x: 0, z: 2 }[achse]] = wert;
      getroffen += 1;
    }
    const dx = kurvenWert(wurzelkurven.get('drehX'), f);
    const dy = kurvenWert(wurzelkurven.get('drehY'), f);
    const dz = kurvenWert(wurzelkurven.get('drehZ'), f);
    if (dx !== null || dy !== null || dz !== null) {
      // pose.waxis ist Achse mal Winkel in Grad um pose.pivot. Die drei
      // Eulerwinkel werden dafuer in eine Achse-Winkel-Darstellung gebracht.
      //
      // Der Drehpunkt liegt im BIND-Raum (poseKnochen in kinematik.js dreht
      // die Bind-Positionen um den Pivot und addiert erst danach die
      // Wurzelverschiebung; verben.js rechnet seinen Schwerpunkt-Pivot
      // genauso zurueck). Das Bind-Becken ist damit „ums Becken drehen".
      //
      // Vorher stand hier pose.wpos, die WELT-Position. Gemessen im Lauf vom
      // 1. September 2026 (Session 5c6a601a): bei root.pos [0, 1.5, 0] und
      // −90° landete das Becken bei y = 1,98 m statt 1,5 m, bei z = 2 stand der
      // Kopf 2 m tiefer als bei z = 0 — die Figur drehte um die Weltachse und
      // hob sich um (I−R)·(wpos − p0). Der Agent hat daraufhin den Anlauf
      // 4 m hinter den Ursprung verlegt.
      pose.waxis = eulerZuAchsenwinkel(dx ?? 0, dy ?? 0, dz ?? 0);
      pose.pivot = [...skel.byId.get(skel.rollenKnochen.pelvis).wPos];
      getroffen += 1;
    }
    if (getroffen === 0) continue;
    // Der Bewegungszustand VOR dem Überschreiben: ein Frame aus einem
    // Flug-Verb bleibt in der Luft, auch wenn der Agent dort einen Arm setzt.
    entwuerfe.push({ frame, pose, verbFlug: frame.contact === 'flug' });
  }

  // ── Durchgang 2: die Höhe — Boden, gesetzt oder angehoben ─────────────────
  const schluessel = hoehenSchluessel(skel, tl.overrides, wurzelkurven.get('y'), entwuerfe, tl.fps);
  // Frames, deren Bodenwert die Figur unter die gesetzte Bahn gezogen hätte:
  // der Agent erfährt es, statt es im Bild zu suchen (siehe hoehenSchluessel).
  for (const v of schluessel.verworfen ?? []) {
    bericht.lucken.push({
      meldung: `Frame ${v.frame} hat Gelenke, aber keine Höhe: die gesetzte Bahn liegt dort bei `
        + `${v.gesetzt.toFixed(3)} m, am Boden stünde die Figur bei ${v.bodenwert.toFixed(3)} m. `
        + `Die gesetzte Bahn gilt — soll die Figur hier stehen, setze die Höhe ausdrücklich `
        + `(set_pose mit root.pos).`,
    });
  }
  for (const v of schluessel.imFlug ?? []) {
    bericht.hinweise.push(`Frame ${v.frame} hat Gelenke, aber keine Wurzelposition, und liegt im Flug `
      + `zwischen ${v.von} (wurf) und ${v.bis}: die Wurfbahn trägt die Haltung, die Höhe kommt aus der `
      + `Parabel. Soll die Figur hier stehen, setze root.pos mit y = null (set_pose).`);
  }
  const bilanz = { boden: [], gesetzt: [] };
  let geschrieben = 0;
  // Wurfstrecken auf den Schwerpunkt legen. Zwei Bahnen, weil waehleHoehe für
  // Frames aus einem Flug-Verb nur die ausdrücklich gesetzten Schlüssel gelten
  // lässt — die Korrektur muss auf derselben Schlüsselmenge rechnen wie die
  // Kurve, die sie ersetzt.
  const wurfbahn = wurfSchwerpunktbahn(skel, schluessel, entwuerfe, tl.fps);
  const wurfbahnFlug = wurfSchwerpunktbahn(
    skel, schluessel.filter((s) => s.explizit), entwuerfe, tl.fps,
  );
  for (const e of entwuerfe) {
    const f = e.frame.frame;
    const wahl = waehleHoehe(schluessel, f, e.verbFlug, tl.fps);
    const pose = e.pose;
    if (wahl.quelle === 'kurve') {
      const ausWurf = (e.verbFlug ? wurfbahnFlug : wurfbahn).get(f);
      pose.wpos[1] = ausWurf ?? wahl.y;
    }
    let kn = poseZuFk(skel, pose);
    if (wahl.quelle === 'boden') {
      // Tiefsten Punkt auf die Bodenebene — hinauf wie hinab, je nachdem, ob
      // die Beinkette kürzer (Hocke) oder länger (Zehenstand) wurde.
      const { abstand, teil } = bodenabstand(skel, kn);
      pose.wpos[1] -= abstand;
      kn = poseZuFk(skel, pose);
      e.frame.hoehe = { quelle: 'boden', absenkung_m: +abstand.toFixed(4), teil };
      bilanz.boden.push({ frame: f, absenkung: abstand });
    } else if (wahl.quelle === 'kurve' && wahl.ausBoden) {
      // Überblendet zwischen zwei BODEN-Schlüsseln: die Höhe kommt weiterhin
      // vom Boden, nur nicht mehr in jedem Frame neu gemessen. Der Frame
      // bleibt darum ein Boden-Frame — daran hängt, dass die IK das Becken
      // senken darf (wurzelFrei 'y') und dass die Rückmeldung von einer
      // Absenkung spricht statt von einer gesetzten Höhe.
      const { abstand, teil } = bodenabstand(skel, kn);
      e.frame.hoehe = { quelle: 'boden', absenkung_m: +abstand.toFixed(4), teil };
      bilanz.boden.push({ frame: f, absenkung: abstand });
    } else if (wahl.quelle === 'kurve') {
      // Gesetzte Höhe gilt — auch wenn sie im Boden steckt. Anheben (Rang 2)
      // kommt erst NACH den Fußankern in bodenfreiheit(): ein freies Bein
      // darf vorher nachgeben.
      e.frame.hoehe = { quelle: 'gesetzt', gesetzt_m: +pose.wpos[1].toFixed(4) };
      bilanz.gesetzt.push({ frame: f });
    } else {
      e.frame.hoehe = { quelle: 'phase' };
    }
    ueberschreibeFrame(ctx, skel, e.frame, pose, kn);
    geschrieben += 1;
  }

  bericht.hinweise.push(`${gueltig.size} Gelenkkanäle und ${wurzelkurven.size} Wurzelkanäle `
    + `aus ${gesetzteSchluessel(tl.overrides)} Schlüsselbildern über Frames ${von}–${bis} `
    + `überblendet (${geschrieben} Frames gesetzt, ${verankert} Kanäle am Nachbar-Schlüsselbild `
    + 'verankert).');
  berichteHoehe(skel, bilanz, bericht);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bodenstand — der Boden ist der Normalzustand der Wurzelhöhe
// ─────────────────────────────────────────────────────────────────────────────
//
// Bühnenlauf vom 2. September 2026, Befund A: jede Beinpose verkürzte die
// Beinkette, die Wurzel blieb, die Figur schwebte. Eine normale Hocke
// (knee.bend 60, hip.flex 50) hing am Xbot 15,5 cm über dem Boden; der Agent
// riet die Absenkung (0,79 m) und steckte damit 11 cm im Boden. Für beides
// kam dieselbe Meldung, und weil „Flug" galt, fielen Balance und Rutschen
// still aus.
//
// Regel seitdem: ohne gesetzte Höhe stellt der Löser den tiefsten Punkt der
// Figur auf die Bodenebene. Eine Zahl in root.pos[1] hebt sie ausdrücklich an
// (Sprung, Salto); unter den Boden geht es nie — Rang 2 aus plan.md 6.4, der
// Löser hebt an und meldet den Betrag.

/**
 * Tiefster Punkt der Figur über der Bodenebene, in Metern. Negativ heißt: im
 * Boden.
 *
 * Gezählt werden Sohlenpunkte UND Knochen mit Haut — genau die Menge, die die
 * Physikprüfung auf Bodendurchdringung prüft. Nur Sohlen reichen nicht: am
 * Xbot sitzen die Zehenknochen in der Bind-Pose exakt auf der Bodenebene
 * (−0,3 mm), die Sohlenpunkte 1,2 bis 2,4 cm darüber. Wer auf die Sohlen
 * absenkt, drückt die Zehen 1,5 cm in den Boden — knapp unter der Toleranz
 * von 1,8 cm, aber falsch.
 *
 * @returns {{abstand: number, teil: string}} Abstand und der tiefste Punkt
 */
/** Die vorderen Sohlenpunkte, umgerechnet auf den Zehenknochen (erstes Kind
 *  des Fußknochens): [{id, zehe, local}]. Einmal je Skelett aus der Bind-Pose
 *  gerechnet; ohne Zehenknochen leer. */
function zehenSohlen(skel) {
  if (skel._zehenSohlen) return skel._zehenSohlen;
  const out = [];
  for (const s of skel.soles ?? []) {
    if (!/front/.test(s.id)) continue;
    const fuss = skel.byId.get(s.bone);
    const zehe = fuss?.kinder?.[0];
    const z = zehe ? skel.byId.get(zehe) : null;
    if (!fuss || !z || !fuss.wQuat || !z.wQuat) continue;
    // Weltpunkt in der Bind-Pose (wie sohlenWelt), dann in den Zehenknochen.
    const stabF = fuss.weltmassstab ?? 1, stabZ = z.weltmassstab ?? 1;
    const welt = vAdd(fuss.wPos, vScale(qRot(fuss.wQuat, s.local), stabF));
    const local = vScale(qRot(qconj(z.wQuat), vSub(welt, z.wPos)), 1 / stabZ);
    out.push({ id: s.id, zehe, local });
  }
  skel._zehenSohlen = out;
  return out;
}

export function bodenabstand(skel, kn) {
  const boden = skel.groundY ?? 0;
  const haut = Array.isArray(skel.profile?.skinnedBones) && skel.profile.skinnedBones.length > 0
    ? new Set(skel.profile.skinnedBones)
    : null;
  let tiefste = Infinity;
  let teil = null;
  for (const s of sohlenWelt(skel, kn)) {
    if (s.pos[1] < tiefste) { tiefste = s.pos[1]; teil = s.id; }
  }
  // Die vorderen Sohlenpunkte liegen an der Zehenspitze, hängen im Profil
  // aber starr am Fußknochen: beugt der Agent die Zehen, gehen sie nicht
  // mit. Lauf 10 vom 2. September 2026: toes_l.bend 35, Zehenspitze 6 cm im
  // Boden, Sohlen melden 0 cm. Für die Bodenstellung werden die vorderen
  // Punkte deshalb zusätzlich am ZEHENknochen mitgeführt (Bind-Versatz zum
  // Zehenknochen, einmal je Skelett gerechnet). Nur hier — Profil, IK und
  // Physik rechnen weiter mit dem Fußknochen, sonst passen ihre Ableitungen
  // nicht mehr zusammen (ik.js hat dieselbe Sohlenrechnung).
  for (const z of zehenSohlen(skel)) {
    const zb = kn.get(z.zehe);
    if (!zb) continue;
    const stab = skel.byId.get(z.zehe)?.weltmassstab ?? 1;
    const y = vAdd(zb.pos, vScale(qRot(zb.quat, z.local), stab))[1];
    if (y < tiefste) { tiefste = y; teil = `${z.id}/zehe`; }
  }
  for (const [id, b] of kn) {
    if (haut && !haut.has(id)) continue;
    if (b.pos[1] < tiefste) { tiefste = b.pos[1]; teil = id; }
  }
  if (!Number.isFinite(tiefste)) return { abstand: 0, teil: null };
  return { abstand: tiefste - boden, teil };
}

/**
 * Die Schlüssel der Höhenkurve: jedes Schlüsselbild des Agenten, entweder
 * mit seiner gesetzten Höhe (explizit) oder mit der Höhe, bei der seine
 * Haltung auf dem Boden steht (Boden-Schlüssel).
 *
 * Damit kann die Kurve zwischen einem Boden-Schlüssel und einer gesetzten
 * Höhe laufen — der Absprung braucht keine geratene Höhe mehr: Frame 8 ohne
 * Höhe (steht), Frame 12 mit 1,5 m und ease wurf ergibt die Parabel vom
 * Boden zum Scheitel.
 *
 * EIN BODEN-SCHLÜSSEL GILT NUR, WENN ER DIE FIGUR NICHT UNTER EINE BEREITS
 * GESETZTE FLUGBAHN ZIEHT.
 *
 * Gemessen am Agentenlauf vom 2. September 2026 (Lauf 8): der Agent besserte
 * mit `set_joint` zwei Ellbogenwinkel auf Frame 55 und 61 nach — mitten im
 * Salto. `set_joint` legt dort ein Override an; das Override hat Gelenke, also
 * wurde daraus ein Boden-Schlüssel, und die Figur klappte in einem Frame vom
 * Scheitel auf den Boden:
 *
 *   Frame 54   Becken 1,407 m
 *   Frame 55   Becken 0,046 m   ← Boden-Schlüssel aus einer Ellbogenkorrektur
 *   Frame 58   Becken 1,754 m
 *
 * Die Ballistikprüfung meldete 1721 m/s²; nach dem Löschen der beiden
 * Overrides 5 m/s². Aus Sicht des Agenten hat eine Armkorrektur die Figur
 * zweimal pro Salto auf den Boden geworfen, ohne dass eine Antwort das gesagt
 * hätte.
 *
 * Deshalb: liegt der Frame zwischen gesetzten Höhen und behauptet der
 * Bodenwert eine Höhe mehr als die Bodentoleranz UNTER der gesetzten Bahn,
 * wird er kein Schlüssel — der Agent hat den Verlauf dort schon bestimmt, ein
 * Gelenknachtrag darf ihn nicht kippen. Umgekehrt (Bodenwert über der Bahn)
 * bleibt der Schlüssel: dort steckte die Figur sonst im Boden.
 *
 * @returns {Array<{frame, grad, ease, explizit}>} aufsteigend nach Frame
 */
function hoehenSchluessel(skel, overrides, yKurve, entwuerfe, fps) {
  const explizit = new Map((yKurve ?? []).map((s) => [s.frame, s]));
  // Die gesetzten Höhen als eigene Kurve — an ihr wird jeder Boden-Schlüssel
  // gemessen, bevor er gilt.
  const gesetzteKurve = [...explizit.values()]
    .map((s) => ({ frame: s.frame, grad: s.grad, ease: s.ease ?? 'smooth' }))
    .sort((a, b) => a.frame - b.frame);
  const einbruchTol = skel.height * BODEN_TOLERANZ_ANTEIL;
  const liste = [];
  const verworfen = [];
  const imFlug = [];
  // Wer trägt eine eigene Höhenentscheidung? Eine gesetzte Höhe, oder eine
  // Wurzel mit pos — auch y = null, denn "auf dem Boden" ist eine Entscheidung.
  // Eine Wurzel, die nur dreht (drehGrad ohne pos), entscheidet nichts über
  // die Höhe.
  const tragend = [];
  for (const [key, ov] of Object.entries(overrides ?? {})) {
    const f = Number(key);
    if (!Number.isInteger(f) || !ov) continue;
    if (explizit.has(f) || (ov.root && ov.root.pos)) {
      tragend.push({ frame: f, ease: EASE[ov.ease] ? ov.ease : 'smooth' });
    }
  }
  tragend.sort((a, b) => a.frame - b.frame);
  for (const [key, ov] of Object.entries(overrides ?? {})) {
    const f = Number(key);
    if (!Number.isInteger(f) || !ov) continue;
    const hatGelenke = ov.joints && Object.keys(ov.joints).length > 0;
    if (!hatGelenke && !ov.root) continue;
    const ease = EASE[ov.ease] ? ov.ease : 'smooth';
    const ex = explizit.get(f);
    if (ex) {
      liste.push({ frame: f, grad: ex.grad, ease, explizit: true });
      continue;
    }
    // Eine Haltung ohne eigene Höhe zwischen einem wurf-Schlüssel und dem
    // nächsten Höhenschlüssel ist eine FLUGPOSE (Tuck im Salto, Schwungbein im
    // Sprung). Sie wird kein Boden-Schlüssel — sonst zöge sie die Figur mitten
    // im Flug auf den Boden — sondern folgt der Wurfbahn des umgebenden
    // Segments (wurfSchwerpunktbahn).
    //
    // Gemessen am 2. September 2026 nach Agentenlauf 9: Absprung Frame 34
    // (1,13 m, wurf), Tuck Frame 44 ohne Wurzel, Landung Frame 55 am Boden —
    // Wurzel bei 44 auf 0,56 m, Schwerpunkt 0,68 m, tiefer als beim Absprung.
    // MIT Höhe bei 44 dagegen zwei Parabeln mit Knick, 28 m/s² Ballistik.
    // Der Agent hatte keinen Weg, der beides vermeidet.
    if (!(ov.root && ov.root.pos)) {
      let davor = null, danach = null;
      for (const t of tragend) {
        if (t.frame < f) davor = t;
        if (t.frame > f && !danach) danach = t;
      }
      if (davor && danach && davor.ease === 'wurf') {
        imFlug.push({ frame: f, von: davor.frame, bis: danach.frame });
        continue;
      }
    }
    const e = entwuerfe.find((x) => x.frame.frame === f);
    if (!e) continue;
    const kn = poseZuFk(skel, e.pose);
    const { abstand } = bodenabstand(skel, kn);
    const bodenwert = e.pose.wpos[1] - abstand;
    const gesetzt = kurvenWert(gesetzteKurve, f, { hoehenachse: true, fps });
    if (gesetzt !== null && bodenwert < gesetzt - einbruchTol) {
      verworfen.push({ frame: f, bodenwert, gesetzt });
      continue;
    }
    liste.push({ frame: f, grad: bodenwert, ease, explizit: false });
  }
  liste.sort((a, b) => a.frame - b.frame);
  liste.verworfen = verworfen;
  liste.imFlug = imFlug;
  return liste;
}

/**
 * Welche Höhe ein Frame bekommt.
 *
 *   boden  — der tiefste Punkt kommt auf die Bodenebene (kein gesetzter
 *            Schlüssel in Reichweite: zwischen zwei Boden-Schlüsseln, vor dem
 *            ersten, nach dem letzten)
 *   kurve  — die Höhenkurve gilt (auf oder zwischen gesetzten Schlüsseln;
 *            Boden-Schlüssel liefern dabei ihren Bodenwert)
 *   phase  — Finger weg: der Frame stammt aus einem Flug-Verb und hat keine
 *            gesetzte Höhe
 *
 * Nach dem letzten gesetzten Schlüssel gilt wieder der Boden — so wie die
 * Gelenkkurven dort auf die Ausgangslage zurückfallen. Die Höhe hält nicht
 * länger als die Haltung, zu der sie gehört.
 *
 * ZWISCHEN ZWEI SCHLÜSSELBILDERN WIRD ÜBERBLENDET, AUCH BEI BODEN-SCHLÜSSELN.
 *
 * Vorher galt zwischen zwei Boden-Schlüsseln `boden`, also: in jedem Frame den
 * tiefsten Punkt der interpolierten Haltung neu auf die Bodenebene setzen. Das
 * überträgt jede Zwischenstellung der Beine unmittelbar auf die Wurzelhöhe —
 * und zwischen zwei Schrittposen läuft die Interpolation durch eine Stellung,
 * in der beide Beine gestreckt nach unten zeigen. Die Figur ist dort
 * „länger", wird tiefer gestellt und schnellt am nächsten Schlüsselbild
 * zurück.
 *
 * Gemessen am Anlauf des Agentenlaufs vom 2. September 2026, Frames 14–19:
 *
 *   f15 (Schlüsselbild)   Absenkung  7,7 cm
 *   f16                              9,0 cm
 *   f17                             11,9 cm
 *   f18                             17,3 cm     ← gestreckte Zwischenstellung
 *   f19 (Schlüsselbild)              7,1 cm     ← 10,3 cm Sprung in einem Frame
 *
 * Bei 30 fps sind das 3 m/s nach oben, ohne dass ein Schritt stattfindet. Über
 * die ganze Bewegung: 21 solcher Sprünge, 17 davon an einem Schlüsselbild.
 * Ältere Läufe hatten null davon — dort setzte der Agent die Höhe selbst, und
 * eine gesetzte Höhe wird überblendet.
 *
 * Deshalb gilt die Kurve auch zwischen Boden-Schlüsseln: an den
 * Schlüsselbildern steht die Figur exakt auf dem Boden (der Schlüssel trägt
 * genau diesen Wert), dazwischen wird überblendet wie bei jedem anderen Kanal
 * auch. Was dabei einsinkt, hebt bodenfreiheit() an (Rang 2, plan.md 6.4).
 */
function waehleHoehe(schluessel, f, verbFlug, fps) {
  const kurve = (liste) => ({ quelle: 'kurve', y: kurvenWert(liste, f, { hoehenachse: true, fps }) });
  if (verbFlug) {
    const gesetzt = schluessel.filter((s) => s.explizit);
    const y = kurvenWert(gesetzt, f, { hoehenachse: true, fps });
    return y === null ? { quelle: 'phase' } : { quelle: 'kurve', y };
  }
  if (schluessel.length === 0) return { quelle: 'boden' };
  let davor = null, danach = null;
  for (const s of schluessel) {
    if (s.frame <= f) davor = s;
    if (s.frame >= f && !danach) danach = s;
  }
  // Auf einem Boden-Schlüssel selbst gilt der gemessene Boden: dort steht die
  // Haltung, und ihr tiefster Punkt gehört exakt auf die Bodenebene.
  if (davor && davor.frame === f) return davor.explizit ? kurve(schluessel) : { quelle: 'boden' };
  // Dazwischen wird überblendet — auch von Boden-Schlüssel zu Boden-Schlüssel.
  //
  // `ausBoden` merkt sich, WOHER die überblendete Höhe kommt: liegt zwischen
  // zwei Boden-Schlüsseln, hat der Agent hier keine Höhe gewollt, sondern der
  // Boden sie bestimmt. Der Frame bleibt deshalb ein Boden-Frame — sonst
  // verlöre die IK die Erlaubnis, das Becken zu senken (wurzelFrei 'y' in
  // halteAnker), und ein haltbarer Fußanker risse ohne Not ab.
  if (davor && danach) {
    const w = kurve(schluessel);
    w.ausBoden = !davor.explizit && !danach.explizit;
    return w;
  }
  return { quelle: 'boden' };
}

/**
 * Die Wurzelhöhen einer `wurf`-Strecke, so gelegt, dass der SCHWERPUNKT der
 * Wurfparabel folgt.
 *
 * `wurfHoehe()` legt die Parabel auf die Wurzel. Gemessen wird aber der
 * Schwerpunkt (src/validate/physics.js, Prüfung 5) — und der hängt nur dann
 * starr an der Wurzel, wenn sich die Pose im Flug nicht ändert. Sobald sie es
 * tut (Tuck im Salto, Schwungbein im Laufschritt), wandert er dagegen, und die
 * Prüfung meldet eine Beschleunigung, die die Bewegung nicht hat.
 *
 * Gemessen in Agentenlauf 7 vom 2. September 2026 (Session f64b54b5): 63 m/s²
 * im Salto, 50 bis 104 m/s² in gewöhnlichen Laufschritten. Der Agent hat den
 * Abstand zur Sollparabel dreimal von Hand nachgemessen und die Wurzelhöhen
 * nachgezogen — rund ein Viertel seiner Laufzeit, ohne die Prüfung je zu
 * bestehen. Eine Steuergröße, mit der er sie hätte treffen können, gab es nicht.
 *
 * Die Rechnung braucht keine Iteration: eine Wurzelverschiebung nimmt den
 * Schwerpunkt eins zu eins mit. Der Abstand `com − wpos[1]` hängt allein an der
 * Pose (die Drehung läuft um einen Pivot im Bind-Raum, die Wurzelverschiebung
 * kommt erst danach dazu). Also einmal je Frame messen, Parabel durch die beiden
 * Schwerpunkte der Schlüsselbilder legen, Abstand abziehen.
 *
 * Die gesetzten Schlüsselbilder bleiben dabei WURZELHÖHEN und werden exakt
 * getroffen: an den Enden ist der abgezogene Abstand derselbe, mit dem die
 * Parabel gebaut wurde. Bei gehaltener Pose kommt Frame für Frame heraus, was
 * `wurfHoehe()` schon immer geliefert hat.
 *
 * @param {object} skel        Skelett
 * @param {Array}  schluessel  Höhenschlüssel (aus hoehenSchluessel), aufsteigend
 * @param {Array}  entwuerfe   Posen aus Durchgang 1
 * @param {number} fps         Framerate
 * @returns {Map<number, number>} Frame → Wurzelhöhe in Metern; Frames ohne
 *          Eintrag behalten die gewöhnliche Höhenkurve
 */
function wurfSchwerpunktbahn(skel, schluessel, entwuerfe, fps) {
  const bahn = new Map();
  if (!(fps > 0) || schluessel.length < 2) return bahn;

  // Abstand Schwerpunkt − Wurzelhöhe, je Frame einmal gemessen.
  const gemessen = new Map();
  const abstand = (f) => {
    if (gemessen.has(f)) return gemessen.get(f);
    const e = entwuerfe.find((x) => x.frame.frame === f);
    const wert = e ? schwerpunkt(skel, poseZuFk(skel, e.pose)).com[1] - e.pose.wpos[1] : null;
    gemessen.set(f, wert);
    return wert;
  };

  for (let i = 0; i + 1 < schluessel.length; i++) {
    const a = schluessel[i], b = schluessel[i + 1];
    if (a.ease !== 'wurf') continue;
    const relA = abstand(a.frame), relB = abstand(b.frame);
    // Ohne Pose an einem Ende ist der Schwerpunkt dort unbekannt: dann bleibt
    // es bei der alten Bahn auf der Wurzel, statt eine Höhe zu raten.
    if (relA === null || relB === null) continue;
    const T = (b.frame - a.frame) / fps;
    const com0 = a.grad + relA, com1 = b.grad + relB;
    for (const e of entwuerfe) {
      const f = e.frame.frame;
      if (f < a.frame || f > b.frame) continue;
      const relF = abstand(f);
      if (relF === null) continue;
      bahn.set(f, wurfHoehe(com0, com1, T, (f - a.frame) / fps) - relF);
    }
  }
  return bahn;
}

/** Bilanz der Höhenentscheidung in den Bericht: Zahlen, kein „Bodenkontakt". */
function berichteHoehe(skel, bilanz, bericht) {
  const cm = (m) => (m * 100).toFixed(1).replace('.', ',');
  const teile = [];
  if (bilanz.boden.length > 0) {
    const werte = bilanz.boden.map((b) => b.absenkung);
    const lo = Math.min(...werte), hi = Math.max(...werte);
    teile.push(`${bilanz.boden.length} Frames auf den Boden gestellt (Wurzel um `
      + (Math.abs(hi - lo) < 5e-4 ? `${cm(hi)} cm` : `${cm(lo)} bis ${cm(hi)} cm`)
      + ' abgesenkt)');
  }
  if (bilanz.gesetzt.length > 0) {
    const fr = bilanz.gesetzt.map((g) => g.frame);
    teile.push(`${bilanz.gesetzt.length} Frames auf gesetzter Höhe (Frames `
      + `${Math.min(...fr)}–${Math.max(...fr)}; dort gilt root.pos, nicht der Boden)`);
  }
  if (teile.length > 0) bericht.hinweise.push(`Wurzelhöhe: ${teile.join('; ')}.`);
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
 * Gelenkgrenzen bleiben hart (das macht optimiere).
 *
 * Die Wurzel: hat der Agent eine Höhe gesetzt, bleibt sie fest — er bestimmt,
 * WO die Figur steht. Steht die Figur auf dem Boden (keine Höhe gesetzt,
 * Bühnenlauf 2. September 2026, Befund A), darf das Becken SINKEN, damit das
 * Standbein den Anker erreicht: bei 22 cm Schritt und 0,95 m Beinlänge sind
 * das 2,6 cm — die das Becken beim Gehen auch wirklich sinkt. Seitlich oder
 * vorwärts wandert sie nie (wurzelFrei: 'y').
 *
 * Alle Anker eines Frames werden GEMEINSAM gelöst. Verankert wird der Fuß
 * an ZWEI Punkten, Fußknochen und Zehenknochen, beide dort, wo sie im ersten
 * Frame der Spanne standen. Damit ist die Fußlage mitverankert: das
 * Sprunggelenk hält die Sohle flach, statt die Zehen mit dem geneigten
 * Unterschenkel in den Boden zu kippen (gemessen am Xbot: nur der Fußknochen
 * als Anker ließ sole_l_front_in bei 22 cm Schritt 4 cm einsinken; Bodenziele
 * als Ausgleich kämpften mit dem Anker um 0,16 cm und ließen 0,75 cm Rest).
 *
 * Das FREIE Bein fasst dieser Lauf nicht an. Versucht wurde es (Bodenziele
 * und Kanäle des freien Beins mit in die Optimierung): ein gestrecktes Bein
 * ist eine Singularität, Knie und Hüfte heben den Fuß in erster Ordnung
 * nicht, und die IK wich über hip.spread bis −16° seitlich aus — je nach
 * Startwert 0,0 bis 2,5 cm Rest. Steckt das freie Bein im Boden, ist das die
 * Haltung des Agenten: bodenfreiheit() hebt an (Rang 2), und berichteAnker()
 * nennt diese Anhebung als Grund, warum der Anker verfehlt wurde.
 *
 * Läuft NACH wendeOverridesAn: sonst schreiben die Haltungen den Anker wieder weg.
 * Der Bericht kommt aus berichteAnker(), NACH bodenfreiheit(): gemessen wird,
 * was am Ende dasteht, nicht, was die Optimierung zwischendurch erreicht hatte.
 *
 * @returns {object[]} die aufgelösten Anker mit Messwerten je Frame, für berichteAnker
 */
/** Welche Beinkanäle die Anker-IK bewegen darf und was das Zehenziel hält
 *  ('voll' Ort, 'hoehe' nur Höhe, 'keine' kein Zehenziel). */
/** Frames, über die die IK-Korrektur eines Ankers vor und hinter seiner
 *  Spanne ausläuft (4 Frames = 0,13 s bei 30 fps). */
export const ANKER_AUSBLENDEN = 4;

export const ANKER_KETTE = {
  kanal: /^(hip_[lr]\.(flex|spread)|knee_[lr]\.bend|ankle_[lr]\.point)$/,
  zehe: 'voll',
};

function halteAnker(ctx, tl, frames, bericht) {
  const { skel } = ctx;
  const anker = Array.isArray(tl.anchors) ? tl.anchors : [];
  if (anker.length === 0) return [];

  const vomAgenten = new Set(baueKurven(tl.overrides).keys());

  // ── Anker auflösen: Knochen, Kette, Sollort ─────────────────────────────
  const aktive = [];
  for (const a of anker) {
    const knochen = skel.rollenKnochen?.[a.foot];
    if (!knochen) {
      bericht.lucken.push({
        meldung: `Anker für „${a.foot}“: diese Rolle ist am Modell nicht zugeordnet `
          + `(${Object.keys(skel.rollenKnochen ?? {}).length} Rollen bekannt)`,
      });
      continue;
    }

    // Die Kette vom Becken zu diesem Fuß — aber NUR die Kanäle, die der Agent
    // nie angefasst hat.
    //
    // Vorher standen alle hip/knee/ankle-Kanäle der Seite zur Verfügung, die
    // gesetzten mit Gewicht 4 gegen den Anker mit 100. Das ist 25 zu 1: der
    // Anker gewann jedes Mal, und die Handschrift des Agenten wurde
    // weggebogen. Gemessen an Frame 58 des Laufs vom 1. September 2026: der
    // Agent setzte hip_r.flex 20, heraus kam 20.6 — dazu spread -7.7 und
    // twist 0.3 auf Kanälen, die er nie genannt hatte. Aus seiner Sicht ging
    // die Figur in eine Haltung und wurde wieder herausgerissen.
    //
    // Gesetzt heißt jetzt fest. Reicht der Rest nicht, um den Fuß zu halten,
    // steht das als Konflikt im Bericht — der Löser darf scheitern, aber er
    // darf die Vorgabe nicht umschreiben (AGENTS.md, "Der Löser korrigiert,
    // der Validator prüft die Nachbedingung").
    const seite = a.foot.endsWith('_l') ? '_l' : '_r';
    // IK-Kanäle sind NUR die Beugekette in der Schrittebene plus Spreizen:
    // hip.flex, hip.spread, knee.bend, ankle.point. Nie hip.twist, nie
    // ankle.tilt — unabhängig davon, ob der Agent sie gesetzt hat.
    //
    // Vorher nahm Durchgang 1 alle Kanäle, die der Agent nie genannt hatte.
    // In Lauf 10 (2. September 2026) hatte Claude flex, bend und point in
    // jedem Schlüsselbild gesetzt; übrig blieben spread, twist und tilt —
    // die IK hielt den Fuß, indem sie das Bein verdrehte und den Knöchel
    // seitlich kippte: ankle_l.tilt −50° auf Frame 18, +27° auf Frame 19.
    // Reichte das nicht, sprang Durchgang 2 mit allen Kanälen an, und die
    // Lösung wechselte von Frame zu Frame zwischen beiden Welten:
    // ankle_r.point +62° in einem Frame. Nachgerechnet am Lauf: 19 Sprünge
    // über 15° je Frame mit Ankern, 3 ohne.
    //
    // Jetzt ein Durchgang mit fester Kette. Die gesetzten Werte sind die
    // weiche Vorgabe (haltung); was davon abweicht, steht als "verbogen" im
    // Bericht. Ein Fuß, der am Boden steht, verlangt genau diese Beugung.
    const beinKanaele = Object.keys(skel.dofs).filter(
      (k) => k.split('.')[0].endsWith(seite) && ANKER_KETTE.kanal.test(k));
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

    // Sollort: wo der Fuß im ERSTEN Frame der Spanne steht. Der Agent hat ihn
    // dort hingestellt; ab da bleibt er. Der Zehenknochen (erstes Kind des
    // Fußknochens) kommt als zweiter Anker dazu, damit die Fußlage steht.
    //
    // `ortFrame` verschiebt diesen Bezug, ohne die Spanne zu verschieben. Der
    // Handler setzt es, wenn ein Anker einen bestehenden ersetzt: aus 40–78
    // wird 50–72, der Fuß soll aber dort bleiben, wo er in Frame 40 stand.
    // Ohne dieses Feld nähme der Anker die Position aus Frame 50 — am Xbot
    // 11 cm weiter vorn (src/solver/anker-ortframe.test.mjs). Ist der genannte
    // Frame nicht gelöst, fällt der Bezug auf den Spannenanfang zurück und der
    // Bericht sagt es; still danebenzugreifen wäre der schlimmere Fall.
    let bezug = inSpanne[0];
    if (Number.isInteger(a.ortFrame) && a.ortFrame !== inSpanne[0].frame) {
      const gemeint = frames.find((f) => f.frame === a.ortFrame && f.loeserPose);
      if (gemeint) bezug = gemeint;
      else {
        bericht.lucken.push({
          meldung: `Anker für „${a.foot}“ über Frames ${a.von}–${a.bis}: ortFrame ${a.ortFrame} `
            + `ist nicht gelöst (Timeline 0–${frames.length - 1}), der Ort kommt aus Frame ${inSpanne[0].frame}`,
        });
      }
    }
    const soll = bezug.positions?.[knochen];
    if (!soll) continue;
    const zehe = (skel.byId.get(knochen)?.kinder ?? [])[0] ?? null;
    const sollZehe = zehe ? bezug.positions?.[zehe] ?? null : null;

    aktive.push({
      a, knochen, seite, beinKanaele, frei, inSpanne, soll, zehe, sollZehe,
      verbogeneFrames: 0,
      proFrame: new Map(),   // frame -> {anGrenze, geprueft}, für den Bericht
    });
  }
  if (aktive.length === 0) return [];

  // ── Je Frame EIN Lauf über alle aktiven Anker ───────────────────────────
  const alleFrames = new Map();
  for (const x of aktive) for (const f of x.inSpanne) alleFrames.set(f.frame, f);
  // Wie weit das Becken in einem Ankerframe gegenüber seiner Bodenhöhe
  // verschoben wurde — Grundlage für das Ausblenden hinter der Spanne.
  const beckenversatz = new Map();

  for (const f of [...alleFrames.values()].sort((p, q) => p.frame - q.frame)) {
    const hier = aktive.filter((x) => f.frame >= x.a.von && f.frame <= x.a.bis);
    // Ohne gesetzte Höhe steht die Figur auf dem Boden — dann darf das Becken
    // sinken (wurzelFrei 'y'). Mit gesetzter Höhe bleibt es, wo der Agent es
    // hingestellt hat.
    const wurzelFrei = f.hoehe?.quelle === 'boden' ? 'y' : false;
    const yVorher = f.loeserPose.wpos[1];

    // Die gesetzte Haltung ist die WEICHE Vorgabe, gegen die optimiert wird.
    //
    // Ohne sie behandelt die IK die Beinwinkel als völlig frei und sucht
    // irgendeine Lösung, die den Fuß hält. Gemessen am Lauf vom
    // 1. September 2026: 11 gesetzte Beinwinkel wurden um mehr als 10 Grad
    // verbogen, bei hip_r.flex auf Frame 19 sogar das Vorzeichen gedreht —
    // der Agent wollte das Bein nach hinten, die IK zog es nach vorn. Aus
    // seiner Sicht ging die Figur in eine Haltung und wurde wieder
    // herausgerissen.
    //
    // `haltung` hält die FREIEN Kanäle nahe an ihrer Ausgangslage, damit
    // die IK sie nicht grundlos verdreht (GEWICHT.anker 100 gegen
    // GEWICHT.haltung 1, siehe ik.js). Die gesetzten Kanäle sind gar nicht
    // erst in `kanaele` — sie können nicht mehr verbogen werden.
    // Zwei Durchgänge, in dieser Reihenfolge:
    //
    //   1. NUR die Kanäle, die der Agent nie angefasst hat. Wo der Fuß
    //      damit steht, bleibt seine Haltung unberührt — er hat sie so
    //      gewollt.
    //   2. Reicht das nicht, kommen die gesetzten dazu. Dann wird verbogen,
    //      aber der Betrag steht im Bericht. Stumm umschreiben wäre das,
    //      was den Agenten vorher aus seinen eigenen Haltungen gerissen hat.
    const lauf = (kanaele) => {
      if (kanaele.length === 0) return null;
      const haltung = {};
      for (const k of kanaele) haltung[k] = f.loeserPose.dofs[k] ?? 0;
      // Das Zehenziel hält nur die HÖHE der Zehe (Fuß bleibt flach). Seine
      // Lage in der Ebene folgt der Fußstellung aus der Haltung: ohne twist
      // und tilt in der Kette (siehe beinKanaele) könnte die IK sie ohnehin
      // nur erzwingen, indem sie den Fußknochen vom Anker wegzieht — gemessen
      // 1,8 bis 2,2 cm Versatz bei 22 cm Wurzelfahrt.
      const knVor = ANKER_KETTE.zehe === 'hoehe' ? poseZuFk(skel, f.loeserPose) : null;
      const ziele = {
        anker: hier.flatMap((x) => {
          if (!x.sollZehe || ANKER_KETTE.zehe === 'keine') return [{ knochen: x.knochen, soll: [...x.soll], id: x.a.foot }];
          const zeheIst = knVor ? knVor.get(x.zehe)?.pos : null;
          const sollZ = zeheIst ? [zeheIst[0], x.sollZehe[1], zeheIst[2]] : [...x.sollZehe];
          return [
            { knochen: x.knochen, soll: [...x.soll], id: x.a.foot },
            { knochen: x.zehe, soll: sollZ, id: `${x.a.foot}/zehe` },
          ];
        }),
        com: null, boden: [], haltung,
      };
      // Kopie: optimiere() arbeitet auf der übergebenen Pose. Ohne sie
      // startet der zweite Durchgang auf dem Ergebnis des ersten.
      const erg = optimiere(skel, kopierePose(f.loeserPose), ziele, kanaele, { wurzelFrei });
      const kn = poseZuFk(skel, erg.pose);
      const reste = hier.map((x) => {
        const ist = kn.get(x.knochen)?.pos;
        return ist ? Math.hypot(ist[0] - x.soll[0], ist[1] - x.soll[1], ist[2] - x.soll[2]) : Infinity;
      });
      return { erg, kn, reste, rest: Math.max(...reste), kanaele };
    };

    // Schwelle für Durchgang 2 ist DIESELBE, ab der ein Anker als gehalten
    // gilt (ANKER_TOLERANZ_ANTEIL, ik.js). Vorher standen hier 2 % der
    // Körperhöhe (3,6 cm am Xbot) — Durchgang 2 sprang damit erst an, wenn
    // der Fuß fünfmal weiter weg war, als der Bericht „gehalten" nennt.
    // Ein Durchgang über die feste Kette (siehe beinKanaele oben). Der
    // frühere zweite Durchgang ist weg: der Wechsel zwischen zwei
    // Lösungswelten von Frame zu Frame war die Quelle der Knöchelsprünge.
    const eigeneAlle = [...new Set(hier.flatMap((x) => x.beinKanaele))];
    const treffer = lauf(eigeneAlle);
    if (!treffer) continue;
    // Verbogen heißt: ein vom Agenten GESETZTER Kanal der Kette weicht um
    // mehr als ein Grad von seiner Vorgabe ab.
    const verbogen = eigeneAlle.some((k) => vomAgenten.has(k)
      && Math.abs((treffer.erg.pose.dofs[k] ?? 0) - (f.loeserPose.dofs[k] ?? 0)) > 1);
    // Was die IK je Anker an seiner Kette und an der Wurzelhöhe geändert
    // hat — Grundlage für das Ein- und Ausblenden an den Spannenrändern.
    for (const x of hier) {
      const d = {};
      for (const k of x.beinKanaele) d[k] = (treffer.erg.pose.dofs[k] ?? 0) - (f.loeserPose.dofs[k] ?? 0);
      (x.ikDelta ??= new Map()).set(f.frame, { dofs: d, y: treffer.erg.pose.wpos[1] - yVorher });
    }
    ueberschreibeFrame(ctx, skel, f, treffer.erg.pose, treffer.kn);
    if (wurzelFrei && f.hoehe) {
      // Das Becken ist gesunken (oder gestiegen): die Absenkung im Frame
      // zählt das mit, damit die Rückmeldung die ganze Zahl nennt.
      f.hoehe.absenkung_m = +(f.hoehe.absenkung_m + (yVorher - treffer.erg.pose.wpos[1])).toFixed(4);
      // Für das Ausblenden hinter der Spanne: um wie viel dieser Frame
      // gegenüber seiner Bodenhöhe angehoben oder gesenkt wurde.
      beckenversatz.set(f.frame, treffer.erg.pose.wpos[1] - yVorher);
    }

    for (const x of hier) {
      if (verbogen) x.verbogeneFrames += 1;
      // Warum das mitgeschleppt wird: der Konfliktgrund darf nicht geraten
      // werden. „Beinkette reicht nicht" gilt nur, wenn ein Kanal der Kette
      // WIRKLICH an seiner Gelenkgrenze klebt — das misst vermessen() in
      // ik.js als an_grenze. Vorher stand der Satz pauschal in jedem
      // Konflikt; am Xbot war er bei 22 cm Wurzelfahrt schlicht falsch
      // (hip_l.flex stand bei −1,8° von −30° Grenze, das Bein reichte
      // mühelos — die Ursache war ein Gewichtsfehler in der IK).
      //
      // Wie viele Kanäle DIESER Kette im gewinnenden Durchgang beweglich
      // waren: Durchgang 1 prüft nur die freien; „0 von 6 an der Grenze"
      // wäre dort falsch gezählt, weil 1 Kanal gar nicht mitgerechnet wurde.
      x.proFrame.set(f.frame, {
        anGrenze: (treffer.erg.fehler.an_grenze ?? []).filter((g) => x.beinKanaele.includes(g.key)),
        geprueft: treffer.kanaele.filter((k) => x.beinKanaele.includes(k)).length,
      });
    }
  }

  // ── Ein- und Ausblenden an den Spannenrändern ─────────────────────────
  //
  // Innerhalb der Spanne biegt die IK Hüfte, Knie und Knöchel, damit der Fuß
  // steht; einen Frame dahinter galt wieder die rohe Haltung. Lauf 10 vom
  // 2. September 2026, nachgerechnet: ankle_r.point +62° auf Frame 16, dem
  // ersten Frame nach dem Anker 9–15; sechs solcher Sprünge über 15° im
  // Anlauf. Die Korrektur des Randframes läuft deshalb über ANKER_AUSBLENDEN
  // Frames vor und hinter der Spanne aus — für die Kette wie für die
  // Wurzelhöhe (nur, wo der Boden sie bestimmt).
  //
  // Je ANKER, nicht je Frame: die Spannen eines Laufs stoßen aneinander
  // (foot_r 9–15, foot_l 16–22). Der Frame hinter dem rechten Anker ist vom
  // linken belegt — die rechte Kette läuft trotzdem dort aus; nur die
  // Wurzelhöhe bleibt, wo ein anderer Anker sie hält.
  {
    const byFrame = new Map(frames.map((f) => [f.frame, f]));
    for (const x of aktive) {
      if (!x.ikDelta) continue;
      const eigene = new Set(x.inSpanne.map((f) => f.frame));
      for (const [nr, delta] of x.ikDelta) {
        for (const richtung of [1, -1]) {
          if (eigene.has(nr + richtung)) continue;   // eigene Spanne läuft weiter
          for (let j = 1; j <= ANKER_AUSBLENDEN; j++) {
            const ziel = byFrame.get(nr + richtung * j);
            if (!ziel || !ziel.loeserPose || eigene.has(ziel.frame)) break;
            const w = 1 - j / (ANKER_AUSBLENDEN + 1);
            const pose = kopierePose(ziel.loeserPose);
            for (const [k, v] of Object.entries(delta.dofs)) {
              const d = skel.dofs[k];
              const wert = (pose.dofs[k] ?? 0) + v * w;
              pose.dofs[k] = d ? Math.min(d.grenze[1], Math.max(d.grenze[0], wert)) : wert;
            }
            if (!alleFrames.has(ziel.frame) && ziel.hoehe?.quelle === 'boden') pose.wpos[1] += delta.y * w;
            ueberschreibeFrame(ctx, skel, ziel, pose, poseZuFk(skel, pose));
          }
        }
      }
    }
  }
  meldeAnkerabriss(skel, frames, alleFrames, beckenversatz, bericht);
  return aktive;
}

/**
 * BENANNTER VERFAHRENSPARAMETER: ab welchem Beckensprung am Ende einer
 * Ankerspanne gemeldet wird — Anteil der Körperhöhe.
 *
 * 2 % sind am Xbot 3,6 cm in einem Frame, bei 30 fps gut 1 m/s. Darunter geht
 * ein Übergang in der Bewegung unter; darüber sieht man ihn.
 */
export const ANKERABRISS_ANTEIL = 0.02;

/**
 * Springt das Becken am Ende einer Ankerspanne? Dann sagen, um wie viel.
 *
 * Während ein Fuß verankert ist, senkt oder hebt die IK das Becken, damit der
 * Fuß stehen bleibt. Im ersten Frame nach der Spanne hält niemand mehr etwas,
 * und die Figur steht wieder auf ihrer Bodenhöhe — der Unterschied fällt in
 * einem einzigen Frame an.
 *
 * Gemessen am Agentenlauf vom 2. September 2026: Anker `foot_r 11–18`, größter
 * Ruck der ganzen Bewegung auf Frame 19 mit 16,2 cm. Dieselbe Bewegung ohne
 * Anker gerechnet: größter Ruck 7,9 cm. Der Agent hat das im Bild gesucht und
 * nicht gefunden, weil nichts es ihm gesagt hat.
 *
 * Der Löser gleicht das NICHT aus. Das Becken nach der Spanne weiter gesenkt
 * zu halten wäre eine erfundene Haltung, und ausgleichen hieße die Vorgabe
 * umschreiben (AGENTS.md: der Löser korrigiert, er erfindet nicht). Was der
 * Agent braucht, ist die Zahl: dann verlängert er die Spanne, setzt die
 * Zwischenhaltung anders oder nimmt den Sprung bewusst in Kauf.
 */
function meldeAnkerabriss(skel, frames, ankerFrames, beckenversatz, bericht) {
  if (beckenversatz.size === 0) return;
  const schwelle = skel.height * ANKERABRISS_ANTEIL;
  for (const [nr, versatz] of beckenversatz) {
    if (ankerFrames.has(nr + 1)) continue;            // Spanne läuft weiter
    const danach = frames.find((f) => f.frame === nr + 1);
    if (!danach) continue;                            // Spanne endet am Ende der Timeline
    if (Math.abs(versatz) < schwelle) continue;
    bericht.hinweise.push(`Anker endet auf Frame ${nr}: das Becken stand dort `
      + `${(Math.abs(versatz) * 100).toFixed(1).replace('.', ',')} cm `
      + `${versatz < 0 ? 'tiefer' : 'höher'} als ohne Anker, und auf Frame ${nr + 1} `
      + `fällt das in einem Frame weg. Soll der Übergang weich sein, verlängere die `
      + `Ankerspanne oder setze auf Frame ${nr + 1} eine Haltung, die die Höhe trägt.`);
  }
}


/**
 * Bericht je Anker — gemessen am ENDSTAND der Frames, also nach bodenfreiheit().
 *
 * Warum nicht schon in halteAnker: dort hielt die Optimierung den Fuß auf
 * 0,1 cm, dann hob bodenfreiheit die Wurzel um 2,8 cm an, weil das freie
 * Bein im Boden stand — und der Fuß stand 2,7 cm neben dem Anker, während der
 * Bericht „gehalten" sagte. Zwei Wahrheiten. Jetzt wird am Ende nachgemessen,
 * und eine Anhebung steht als Grund im Konflikt.
 */
function berichteAnker(ctx, aktive, frames, bericht) {
  const { skel } = ctx;
  for (const x of aktive) {
    const { a, knochen, frei, beinKanaele, inSpanne, verbogeneFrames, soll } = x;
    let groesster = 0;
    let schlimmsterFrame = a.von;
    for (const f0 of inSpanne) {
      const f = frames.find((q) => q.frame === f0.frame) ?? f0;
      const ist = f.positions?.[knochen];
      if (!ist) continue;
      const rest = Math.hypot(ist[0] - soll[0], ist[1] - soll[1], ist[2] - soll[2]);
      if (rest > groesster) { groesster = rest; schlimmsterFrame = f.frame; }
    }
    const stat = x.proFrame.get(schlimmsterFrame) ?? { anGrenze: [], geprueft: 0 };
    const anGrenze = stat.anGrenze;
    const geprueft = stat.geprueft;
    const hoehe = frames.find((q) => q.frame === schlimmsterFrame)?.hoehe;
    const angehoben = hoehe?.angehoben_m > 0 ? hoehe : null;

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
    if (groesster > skel.height * ANKER_TOLERANZ_ANTEIL) {
      // Der Grund wird GEMESSEN, nicht behauptet. Drei Fälle, die sich am
      // Xbot alle zeigen lassen:
      //
      //   angehoben → bodenfreiheit hat die Wurzel nach dem Anker angehoben,
      //     weil ein anderes Körperteil im Boden stand (Rang 2 vor Rang 3).
      //     Gemessen: 22 cm Schritt mit gestrecktem freiem Bein, rechte Zehe
      //     2,8 cm im Boden, Anker danach 2,7 cm verfehlt.
      //
      //   an_grenze nicht leer → die Kette ist wirklich am Anschlag. Gemessen:
      //     50 cm Wurzelfahrt, hip_l.flex an der Grenze −30°, 14,5 cm Rest.
      //   an_grenze leer → die Gelenke haben Luft, die Optimierung kommt
      //     trotzdem nicht näher heran. Gemessen: 25 cm Wurzelfahrt,
      //     hip_l.flex bei −15,0° von −30° Grenze, 2,3 cm Rest. Hier wäre
      //     „Beinkette reicht nicht" eine Fehldiagnose.
      const amAnschlag = anGrenze.length > 0;
      const alleFrei = geprueft >= beinKanaele.length;
      const cm = (m) => (m * 100).toFixed(1).replace('.', ',');
      const grund = angehoben
        ? `die Wurzel wurde in diesem Frame um ${cm(angehoben.angehoben_m)} cm angehoben, `
          + `weil ${angehoben.teil} sonst im Boden stünde`
          + (angehoben.quelle === 'angehoben' ? ` (bei root.pos y = ${angehoben.gesetzt_m.toFixed(3)} m)` : '')
          + ' — Bodenkontakt geht vor Fußanker (plan.md 6.4)'
        : amAnschlag
        ? `Beinkette am Anschlag: ${anGrenze.map((g) => `${g.key} steht bei `
          + `${g.wert.toFixed(1)}° an der Grenze ${g.grenze}°`).join(', ')}`
        : `kein Gelenk an der Grenze (0 von ${geprueft} beweglichen Kanälen), `
          + `die Optimierung blieb ${(groesster * 100).toFixed(1)} cm vor dem Anker stehen`;
      const rat = angehoben
        ? 'halte das freie Bein über dem Boden (Knie beugen, Hüfte anheben) oder setze root.pos höher'
        : amAnschlag || alleFrei
        ? 'setze die Wurzel näher an den Fuß oder verkürze die Ankerspanne'
        : `gib der Kette mehr Spielraum: nur ${frei.length} von ${beinKanaele.length} `
          + 'Beinkanälen sind frei, die übrigen hast du auf Schlüsselbildern festgelegt';
      bericht.konflikt.push({
        frame: schlimmsterFrame, verb: 'anker', bedingung: 'fussanker', einheit: 'm',
        soll: 0, erreicht: +groesster.toFixed(4), betrag: +groesster.toFixed(4),
        an_grenze: anGrenze.map((g) => g.key),
        grund,
        meldung: `Anker ${a.foot} über Frames ${a.von}–${a.bis} auf Frame ${schlimmsterFrame} `
          + `um ${(groesster * 100).toFixed(1)} cm verfehlt (erlaubt sind `
          + `${(skel.height * ANKER_TOLERANZ_ANTEIL * 100).toFixed(1)} cm) — ${grund}; ${rat}`,
      });
    }
  }
}

/**
 * Rang 2 aus plan.md 6.4, als letzter Schritt: kein Körperteil unter dem Boden.
 *
 * Läuft nach den Ankern, damit ein freies Bein erst nachgeben darf, bevor
 * die ganze Figur angehoben wird. Was hier noch im Boden steckt, hat der
 * Agent mit root.pos so gesetzt — die Wurzel wird angehoben, und der Betrag
 * steht als Konflikt im Bericht, nicht stillschweigend.
 *
 * Frames aus Flug-Verben (hoehe.quelle 'phase') und Frames ohne gelöste Pose
 * bleiben unangetastet.
 */
function bodenfreiheit(ctx, frames, bericht) {
  const { skel } = ctx;
  // Gemeldet wird erst ab der Toleranz, unter der auch der Validator schweigt
  // (1 % Körperhöhe, 1,8 cm am Xbot). Darunter wird still nachgezogen: ein
  // Fußanker, der die Zehe 2 mm eintaucht, ist kein Konflikt, sondern Rauschen.
  const meldeAb = skel.height * BODEN_TOLERANZ_ANTEIL;
  const angehoben = [];
  for (const f of frames) {
    if (!f.loeserPose || !f.hoehe || f.hoehe.quelle === 'phase') continue;
    const abstand = f.bodenabstand_m ?? 0;
    if (abstand >= -1e-6) continue;
    const pose = kopierePose(f.loeserPose);
    const soll = pose.wpos[1];
    pose.wpos[1] -= abstand;
    const kn = poseZuFk(skel, pose);
    const teil = bodenabstand(skel, poseZuFk(skel, f.loeserPose)).teil;
    ueberschreibeFrame(ctx, skel, f, pose, kn);
    if (f.hoehe.quelle === 'boden') {
      // Der Fußanker hat das Becken sinken lassen, und ein anderes Körperteil
      // — meist das freie Bein — steckte danach im Boden. Die Absenkung zählt
      // das mit; ab der Toleranz steht die Anhebung am Frame, damit
      // berichteAnker sie als Grund nennen kann. Kein eigener Konflikt: der
      // Agent hat hier keine Höhe gesetzt, die falsch sein könnte.
      f.hoehe.absenkung_m = +(f.hoehe.absenkung_m + abstand).toFixed(4);
      if (-abstand >= meldeAb) {
        f.hoehe.angehoben_m = +(-abstand).toFixed(4);
        f.hoehe.teil = teil;
      }
      continue;
    }
    if (-abstand < meldeAb) continue;
    f.hoehe = { quelle: 'angehoben', angehoben_m: +(-abstand).toFixed(4), gesetzt_m: +soll.toFixed(4), teil };
    angehoben.push({ frame: f.frame, anhebung: -abstand, soll, teil });
  }
  if (angehoben.length === 0) return;

  const cm = (m) => (m * 100).toFixed(1).replace('.', ',');
  const schlimmst = angehoben.reduce((p, q) => (q.anhebung > p.anhebung ? q : p));
  const weitere = angehoben.length - 1;
  bericht.konflikt.push({
    frame: schlimmst.frame, verb: 'keyframe', bedingung: 'boden', einheit: 'm',
    soll: +schlimmst.soll.toFixed(4), erreicht: +(schlimmst.soll + schlimmst.anhebung).toFixed(4),
    betrag: +schlimmst.anhebung.toFixed(4),
    grund: 'Bodenkontakt (Rang 2, plan.md 6.4): kein Körperteil unter dem Boden',
    meldung: `Wurzel auf Frame ${schlimmst.frame} um ${cm(schlimmst.anhebung)} cm angehoben: `
      + `bei root.pos y = ${schlimmst.soll.toFixed(3)} m stünde ${schlimmst.teil} `
      + `${cm(schlimmst.anhebung)} cm im Boden`
      + (weitere > 0 ? ` (ebenso in ${weitere} weiteren Frames)` : '')
      + ' — für einen Stand lass die Höhe weg (y = null), der Löser stellt die Figur ab',
  });
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
  frame.bodenabstand_m = +bodenabstand(skel, kn).abstand.toFixed(4);
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
    bodenabstand_m: +bodenabstand(skel, kn).abstand.toFixed(4),
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
