// AP5 — Phasenlöser: crouch, takeoff, airborne, land (abgenommen) plus
// stand, swing_arms (AP5.2, gleiche Bauweise).
//
// Kernidee (plan.md 6.3): Eine Phase ist keine Pose, sondern ein Parametersatz:
// Sollbahn des Schwerpunkts, verankerte Kontaktpunkte, Streckungsgrad,
// Rumpforientierung, Drehimpuls. Dieses Modul rechnet pro Frame aus der
// Sollbahn eine Pose — mit der numerischen IK aus ./ik.js, die die Wirkung
// der Gelenke ausschließlich aus der gemessenen Forward-Kinematik kennt.
// Kein Gelenkwinkel und keine Körperlänge wird getippt (AGENTS.md, Regel 1);
// die einzigen Zahlen in diesem File sind die BENANNTEN Verfahrensparameter
// unten und zeitliche Rampenformen (ease).
//
// Ansteuerung bei Kontaktphasen (crouch, takeoff-Druck, land-Abfedern):
//   1. IK: Beingelenke holen die verankerten Sprunggelenke zurück zu ihren
//      Ankern (harte Gelenkgrenzen, plan.md 6.4 Rang 1).
//   2. Nachmessen: der Schwerpunkt der gelösten Pose wird per FK gemessen.
//   3. Nachsteuerung: Sitzt der Schwerpunkt nicht auf der Sollbahn, wird das
//      Becken nachgezogen — solange, bis either die Bahn passt oder der
//      Fußanker ausbricht (Rang 3 vor Rang 4: die Bahn wird zuletzt geopfert).
//   4. Bericht: Was übrig bleibt, steht als geopferte Bedingung MIT BETRAG
//      und benanntem Grund im Konfliktbericht.
// Die Vorsteuerung statt reiner Gewichtsabwägung ist nötig, weil eine
// durchgestreckte Beinkette singulär ist: in erster Ordnung bewegt keine
// Gelenkrotation das Sprunggelenk entlang der Beinachse — endliche Faltung
// entsteht nur aus endlich gesetztem Becken.
//
// Flug (airborne, plan.md 6.5): Der Schwerpunkt folgt exakt der Parabel; die
// Pose wird gegen den Schwerpunkt montiert (Verschiebung = Soll minus
// gemessener Schwerpunkt der gedrehten Pose). Die Drehung: pro Frame wird
// das Trägheitsmoment aus den GEMESSENEN Segmentmassen um die Achse durch den
// Schwerpunkt gerechnet; ω(t) = L/I(t) mit konstantem L, und L wird so
// gewählt, dass die Drehung am Phasenende den Sollwinkel exakt trifft.
// Abschaltbar (Testhaken) — dann bleibt ω auf dem Freisetzungswert und der
// Endwinkel weicht messbar ab.

import { schwerpunkt, sohlenWelt, traegheit, vAdd, vSub, vScale, vLen, qFromAxisAngle, knochenPfad } from './kinematik.js';
import { kopierePose, optimiere, poseZuFk, gelenkKette, vermessen, bindPose } from './ik.js';
import { G } from '../validate/physics.js';   // AP4-Modul nutzen, nicht nachbauen

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Iterationen der Schwerpunkt-Nachsteuerung je Frame. Erreicht ein Frame den
 *  Deckel, fehlt die Sollbahn weiter — der Rest wird berichtet, nicht
 *  verschluckt. */
export const KORREKTURSCHRITTE = 24;

/** Kleinste Schrittdämpfung der Nachsteuerung, bevor aufgegeben wird.
 *  Bricht der Fußanker oder verletzt ein Knochen den Boden, wird der Schritt
 *  halbiert statt der ganze Vorgang verworfen — sonst meldet der Löser bei
 *  einer zu tiefen Vorgabe „0 cm erreicht" statt der tatsächlich haltbaren
 *  Tiefe. 1/32 der vollen Schrittweite ist die Abbruchgrenze. */
export const MIN_DAEMPFUNG = 1 / 32;

/** Zielgenauigkeit der Schwerpunktbahn, Anteil der Körperhöhe (≈ 8 mm bei 1,60 m). */
export const COM_ZIEL_ANTEIL = 0.005;

/** Anteil der Körperhöhe, den das Becken je Nachsteueriteration höchstens
 *  nachgezogen wird — Schutz vor Overshoot an der Strecksingularität. */
export const NACHSTEU_ANTEIL = 0.25;

/** Bruchteil des Schwerpunktfehls, der je Iteration als Beckenkorrektur
 *  angesetzt wird. 0,9: gedämpfter Newton-Schritt auf einem nahezu linearen
 *  Zusammenhang (Absenkung ≈ Schwerpunktverlust). */
export const NACHSTEU_VERST = 0.9;

/** Grenze, ab der der Fußanker als gebrochen gilt — Anteil der Körperhöhe.
 *  Straffer als die Rutschschwelle der AP4-Physik (0,015): der Löser opfert
 *  die Bahn eher, als dass die Physik je Rutschen melden könnte. */
export const ANKER_GRENZE_ANTEIL = 0.006;

/** Stil amplitude je Verb, Anteil der GEMESSENEN Grenzspanne (0..1):
 *  Arme anziehen in der Hocke, Schwung im Absprung, Auslage in der Landung. */
export const HALTUNG_ANT = { hocke: 0.18, schwung: 0.35, landung: 0.30 };

// ─────────────────────────────────────────────────────────────────────────────
// Zeitprofile
// ─────────────────────────────────────────────────────────────────────────────

const ease = (t) => t * t * (3 - 2 * t);        // Sanftanlauf/-auslauf (Absenken)
const easeOut = (t) => 1 - (1 - t) * (1 - t);   // Ausklingen (Abfedern)
/** Quadratische Rampe: konstante Beschleunigung aus dem Stand — genau das
 *  physikalische Profil des Absprungdrucks; v(1) = 2·hub. */
const ramp2 = (t) => t * t;

// ─────────────────────────────────────────────────────────────────────────────
// Einmalige Vermessung des startfähigen Zustands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst am Skelett, was alle Verben brauchen: Bind-Schwerpunkt, Fußanker,
 * freie Beingelenke, Sohlen-Versatz zum Boden und — per Löserdurchlauf,
 * nicht per Annahme — die tiefste mit verankerten Füßen haltbare Hocke.
 */
/**
 * Baut Anker aus gemessenen Sohlenpunkten: knochenfester Punkt (`lokal`, in
 * Knochen-Einheiten wie im Profil) plus sein Sollort in Weltmetern.
 *
 * @param {object[]} sohlenPos Ergebnis von sohlenWelt(skel, kn)
 * @param {number[]} [versatz] Verschiebung aller Sollorte in Weltmetern
 */
export function sohlenAnker(skel, sohlenPos, versatz = [0, 0, 0]) {
  const lokalById = new Map(skel.soles.map((s) => [s.id, s]));
  return sohlenPos.map((s) => {
    const def = lokalById.get(s.id);
    if (!def) {
      throw new Error(`Sohlenanker „${s.id}“ nicht unter ${skel.soles.length} Profil-Sohlen gefunden`);
    }
    return { id: s.id, knochen: s.bone, lokal: [...def.local], soll: vAdd(s.pos, versatz) };
  });
}

export function vermesseAusgangslage(skel) {
  const fuss = [skel.rollenKnochen.foot_l, skel.rollenKnochen.foot_r];
  const start = bindPose(skel);
  const kn0 = poseZuFk(skel, start);
  const com0 = schwerpunkt(skel, kn0).com;
  const gelenke = gelenkKette(skel, fuss);
  if (gelenke.length < 2) {
    throw new Error(`Beingelenkkette liefert nur ${gelenke.length} Freiheitsgrade — Löser kann keine Kontaktphase fahren`);
  }
  const sohlen = sohlenWelt(skel, kn0);
  // Verankert wird die SOHLE, nicht der Fußursprung: ein Anker allein am
  // Knochenursprung lässt den Fuß frei kippen. Jeder Sohlenpunkt aus dem
  // Profil (plan.md 5.1) wird knochenfest mitgeführt (`lokal`), sein Sollort
  // ist seine gemessene Bind-Weltlage.
  const anker = sohlenAnker(skel, sohlen);
  const tiefsteSohle = Math.min(...sohlen.map((s) => s.pos[1]));
  const sohlenVersatz = tiefsteSohle - skel.groundY;

  // Tiefste haltbare Hocke: Ziel tief setzen, Nachsteuerung stoppt von selbst,
  // wenn der Fußanker ausbricht; gemessener Schwerpunkt ergibt die Grenze.
  const tiefer = steuereKontakt(skel, start, gelenke, anker,
    [com0[0], com0[1] - 1.2 * skel.height, com0[2]], {});
  const maxAbsenkung = Math.max(0, com0[1] - tiefer.com[1]);

  return {
    fuss, start, kn0, com0, gelenke, anker, sohlenVersatz, maxAbsenkung,
    tieferPose: tiefer.pose,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ein Kontaktframe: Füße verankern, Schwerpunkt nachsteuern, Balance halten
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Löst einen Frame mit Bodenkontakt.
 *
 * @param {object[]} anker    [{knochen, soll:[x,y,z]}] feste Fußanker (Welt, m)
 * @param {number[]} comSoll  Soll-Schwerpunkt (Welt, m)
 * @param {object}   haltung  Gelenk-Vorgaben {schlüssel: grad} vor der IK
 * @param {object}   [opt]    { balanceXZ, iterationen }
 * @returns {{pose, com, fehler, verankertFest}}
 */
export function steuereKontakt(skel, poseVor, gelenke, anker, comSoll, haltung, opt = {}) {
  const iterationen = opt.iterationen ?? 40;
  let pose = kopierePose(poseVor);
  for (const [k, v] of Object.entries(haltung ?? {})) {
    if (skel.dofs[k]) pose.dofs[k] = v;
  }
  const ziele = { anker, com: null, boden: [], haltung: {} };
  const ankerGrenze = skel.height * ANKER_GRENZE_ANTEIL;
  const bodenGrenze = skel.groundY - skel.height * 0.01;

  // Knochen, deren Absinken unter den Boden den Schritt verwirft (Rang 2,
  // plan.md 6.4): alle Segment-Endpunkte — gemessene Geometrie, keine Liste.
  const pruefKnochen = new Set();
  for (const s of skel.segments) { pruefKnochen.add(s.from); pruefKnochen.add(s.to); }

  /** Prüft einen Schritt: Bodenverletzung oder unmonotone Schwerpunktwirkung. */
  function ablehnung(p, comVorher, schrittY) {
    const kn = poseZuFk(skel, p);
    for (const id of pruefKnochen) {
      const pos = kn.get(id);
      if (pos && pos.pos[1] < bodenGrenze) {
        return { grund: 'boden', text: `Knochen ${id} läge ${((bodenGrenze - pos.pos[1]) * 100).toFixed(1)} cm unter dem Boden` };
      }
    }
    const com = schwerpunkt(skel, kn).com;
    // Monotonie: eine Abwärtssteuerung, die den Schwerpunkt hebt (oder
    // umgekehrt), ist kein Absenken, sondern Ausweichen in Gelenkrichtungen,
    // die das Profil für diese Bewegung nicht hergibt.
    if (Math.abs(schrittY) > 1e-6) {
      const wirkung = com[1] - comVorher[1];
      // Gleiches Vorzeichen wie die Steuerung = die Kette gibt nach.
      // Gegenrichtung = Ausweichen, und der Schritt wird verworfen.
      if (Math.sign(schrittY) * wirkung < -skel.height * 1e-4) {
        return {
          grund: 'unmonoton',
          text: `Becken um ${(Math.abs(schrittY) * 100).toFixed(1)} cm ${schrittY < 0 ? 'ab' : 'auf'}wärts gesteuert, der Schwerpunkt antwortete mit ${(Math.abs(wirkung) * 100).toFixed(1)} cm in die Gegenrichtung`,
        };
      }
    }
    return null;
  }

  // Füße zurück ans Band.
  let r = optimiere(skel, pose, ziele, gelenke, { iterationen, wurzelFrei: false });
  pose = r.pose;
  let fehler = r.fehler;
  let com = schwerpunkt(skel, poseZuFk(skel, pose)).com;
  let abGrund = null;
  let abText = null;
  // Schrittdämpfung: ein verworfener Schritt halbiert sie, statt den ganzen
  // Vorgang abzubrechen. So endet eine unerreichbare Vorgabe bei der tiefsten
  // HALTBAREN Pose — Rangfolge plan.md 6.4: Boden (2) und Fußanker (3) stehen
  // über der Schwerpunktbahn (4), die Bahn wird zuletzt geopfert.
  let daempfung = 1;

  for (let k = 0; k < KORREKTURSCHRITTE; k++) {
    const fehlY = comSoll[1] - com[1];
    const fehlX = comSoll[0] - com[0];
    const fehlZ = comSoll[2] - com[2];
    if (Math.abs(fehlY) < skel.height * COM_ZIEL_ANTEIL
      && Math.hypot(fehlX, fehlZ) < skel.height * COM_ZIEL_ANTEIL) {
      return { pose, com, fehler, verankertFest: true, grund: abGrund, text: abText };
    }
    if (daempfung < MIN_DAEMPFUNG) break;

    const neu = kopierePose(pose);
    const schritt = skel.height * NACHSTEU_ANTEIL * daempfung;
    // Balance: der Soll-Schwerpunkt liegt bei allen Kontaktverben über der
    // Stützfläche — xz-Korrektur folgt dem Soll, nicht einer zweiten Annahme.
    const dy = clamp(fehlY * NACHSTEU_VERST * daempfung, -schritt, schritt);
    neu.wpos[1] += dy;
    neu.wpos[0] += clamp(fehlX * NACHSTEU_VERST * daempfung, -schritt, schritt);
    neu.wpos[2] += clamp(fehlZ * NACHSTEU_VERST * daempfung, -schritt, schritt);
    const rNeu = optimiere(skel, neu, ziele, gelenke, { iterationen, wurzelFrei: false });
    const ankerWeg = Math.max(0, ...rNeu.fehler.anker.map((a) => a.betrag_m));

    // Fußanker gebrochen (Rang 3) oder Boden verletzt (Rang 2): Schritt
    // verwerfen, Dämpfung halbieren, Grund für den Bericht merken.
    if (ankerWeg > ankerGrenze) {
      abGrund = 'fußanker';
      abText = `Fußanker wich ${(ankerWeg * 100).toFixed(1)} cm aus, erlaubt sind ${(ankerGrenze * 100).toFixed(1)} cm`;
      daempfung /= 2;
      continue;
    }
    const abgelehnt = ablehnung(rNeu.pose, com, dy);
    if (abgelehnt) {
      abGrund = abgelehnt.grund;
      abText = abgelehnt.text;
      daempfung /= 2;
      continue;
    }

    pose = rNeu.pose;
    fehler = rNeu.fehler;
    com = schwerpunkt(skel, poseZuFk(skel, pose)).com;
  }

  const ankerWeg = Math.max(0, ...fehler.anker.map((a) => a.betrag_m));
  return {
    pose, com, fehler,
    verankertFest: ankerWeg <= ankerGrenze, grund: abGrund, text: abText,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function mittelpunkt(punkte) {
  if (punkte.length === 0) throw new Error('Stützmittelpunkt: 0 Kontaktpunkte übergeben');
  const s = [0, 0, 0];
  for (const p of punkte) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
  return vScale(s, 1 / punkte.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phasenzustand und Frame-Ausgabe
// ─────────────────────────────────────────────────────────────────────────────

/** Startzustand: Bind-Stand, beide Füße verankert, keine Bewegung. */
export function startZustand(skel, vorgang) {
  return {
    pose: kopierePose(vorgang.start),
    kontakt: true,
    anker: vorgang.anker.map((a) => ({ id: a.id, knochen: a.knochen, lokal: a.lokal ? [...a.lokal] : undefined, soll: [...a.soll] })),
    com: [...vorgang.com0],
    comVel: [0, 0, 0],
    spinGrad: 0,
    spinAchse: [1, 0, 0],
    pivot: [...vorgang.com0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// crouch — Schwerpunkt sinkt um die verlangte Tiefe, Füße bleiben stehen
// params: { tiefe | depth: Anteil der Körperhöhe }
// ─────────────────────────────────────────────────────────────────────────────

export function phaseCrouch(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const tiefeAnteil = phase.params?.tiefe ?? phase.params?.depth;
  if (typeof tiefeAnteil !== 'number' || !Number.isFinite(tiefeAnteil) || tiefeAnteil <= 0) {
    throw new Error(`crouch-Phase ${phase.id}: Parameter tiefe ist ${JSON.stringify(tiefeAnteil)}: erwartet Zahl > 0 als Anteil der Körperhöhe (${skel.height.toFixed(2)} m)`);
  }
  const comStart = [...z.com];
  const zielDrop = tiefeAnteil * skel.height;
  let dropErreicht = 0;
  let letzterGrund = '';
  let ankerBruch = false;

  for (let f = phase.from; f < phase.to; f++) {
    const n = phase.to - phase.from;
    const t = n > 1 ? (f - phase.from + 1) / n : 1;
    const comSoll = [comStart[0], comStart[1] - zielDrop * ease(t), comStart[2]];
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, haltungCrouch(skel, t));
    z.pose = r.pose;
    z.com = r.com;
    dropErreicht = Math.max(dropErreicht, comStart[1] - r.com[1]);
    ankerBruch = ankerBruch || !r.verankertFest;
    letzterGrund = r.text ?? begruendung(skel, r.pose, vorgang.gelenke);
    frames.push(frameKontakt(ctx, z, phase, f, r.fehler));
  }

  const fehl = zielDrop - dropErreicht;
  if (fehl > skel.height * COM_ZIEL_ANTEIL) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'crouch', frame: phase.to - 1,
      bedingung: 'schwerpunktbahn', einheit: 'm',
      soll: zielDrop, erreicht: dropErreicht, betrag: fehl,
      grund: letzterGrund,
      meldung: `Schwerpunktbahn um ${(fehl * 100).toFixed(1).replace('.', ',')} cm verfehlt (Soll ${(zielDrop * 100).toFixed(1).replace('.', ',')} cm, erreicht ${(dropErreicht * 100).toFixed(1).replace('.', ',')} cm), weil sonst ${letzterGrund.toLowerCase()} — kein stilles Abschneiden${ankerBruch ? '; Fußanker war gefährdet' : ''}`,
    });
  }
  z.comVel = [0, 0, 0];
}

/** Welches Gelenk blockiert? Gemessene Grenze + Wert, als Satzteil. */
function begruendung(skel, pose, gelenke) {
  const e = vermessen(skel, pose, { anker: [], com: null, boden: [], haltung: {} }, gelenke);
  if (e.an_grenze.length === 0) return 'die Streckreichweite der Beinkette ausgeschöpft ist';
  const g = e.an_grenze[0];
  return `Gelenk ${g.key} an seiner Grenze ${g.grenze}° steht`;
}

function haltungCrouch(skel, t) {
  const h = {};
  const a = HALTUNG_ANT.hocke * ease(t);
  if (skel.dofs['arm_l.swing']) h['arm_l.swing'] = randGrad(skel, 'arm_l.swing', a);
  if (skel.dofs['arm_r.swing']) h['arm_r.swing'] = randGrad(skel, 'arm_r.swing', a);
  if (skel.dofs['elbow_l.bend']) h['elbow_l.bend'] = randGrad(skel, 'elbow_l.bend', a);
  if (skel.dofs['elbow_r.bend']) h['elbow_r.bend'] = randGrad(skel, 'elbow_r.bend', a);
  if (skel.dofs['spine.bend']) h['spine.bend'] = randGrad(skel, 'spine.bend', a * 0.5);
  return h;
}

/** Armkettengelenke eines Fußes (Bein) oder einer Hand — alle Freiheitsgrade
 *  der Knochen auf dem Weg Endeffektor → Becken, ohne den Beckenknochen
 *  selbst. Das Sprunggelenk bleibt drin: verankert werden die Sohlenpunkte,
 *  nicht der Fußursprung (BRETT.md, Sackgasse 2). */
export function gelenkKetteBis(skel, endknochenId) {
  const pfad = knochenPfad(skel, endknochenId, skel.rollenKnochen.pelvis);
  const inKette = new Set(pfad.slice(0, -1));   // Beckenknochen selbst: außen
  return Object.keys(skel.dofs).filter((k) => inKette.has(skel.dofs[k].bone));
}

/** Wert als Anteil der größeren gemessenen Grenzseite — Spiegelung sitzt in
 *  den Grenzen selbst (elbow_l [−2,150], elbow_r [−150,2]). */
function randGrad(skel, key, anteil) {
  const d = skel.dofs[key];
  if (!d) return 0;
  const [lo, hi] = d.grenze;
  const ziel = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
  return clamp(anteil * ziel, lo, hi);
}

// ─────────────────────────────────────────────────────────────────────────────
// takeoff — strecken, bis der Schwerpunkt die Absprunggeschwindigkeit hat
// params: { vy: Körperhöhen/s, spinX | spinY | spinZ | spinGrad+spinAchse }
// ─────────────────────────────────────────────────────────────────────────────

export function phaseTakeoff(ctx, phase, z, frames, bericht) {
  const { skel, fps, vorgang } = ctx;
  const vyAnt = phase.params?.vy;
  if (typeof vyAnt !== 'number' || !Number.isFinite(vyAnt) || vyAnt <= 0) {
    throw new Error(`takeoff-Phase ${phase.id}: Parameter vy ist ${JSON.stringify(vyAnt)}: erwartet Zahl > 0 in Körperhöhen pro Sekunde (Körperhöhe ${skel.height.toFixed(2)} m)`);
  }
  const N = phase.to - phase.from;
  if (N < 2) {
    throw new Error(`takeoff-Phase ${phase.id} dauert ${N} Frame: mindestens 2 für eine Druckphase mit Löseframe`);
  }
  const vy = vyAnt * skel.height;                 // m/s
  const T = N / fps;                              // s

  // Drehimpuls-Ziel übernehmen (Achse im Weltrahmen der Bind-Pose).
  z.spinGrad = phase.params?.spinGrad ?? phase.params?.spinX ?? phase.params?.spinY ?? phase.params?.spinZ ?? 0;
  z.spinAchse = (phase.params?.spinY !== undefined || phase.params?.spinAchse === 'y') ? [0, 1, 0]
    : (phase.params?.spinZ !== undefined || phase.params?.spinAchse === 'z') ? [0, 0, 1]
      : [1, 0, 0];

  const comStart = [...z.com];

  // Aufwärts verfügbar: Schwerpunkt der höchstmöglichen Pose mit verankerten
  // Füßen — ein IK-Durchlauf, keine Annahme.
  const hoechst = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker,
    [comStart[0], comStart[1] + skel.height, comStart[2]], {});
  const hoch = Math.max(0, hoechst.com[1] - comStart[1]);

  // Zwei-Stufen-Profil: fehlt Strecke, wird zuerst in die Gegenbewegung
  // abgesenkt (Antizipation, plan.md 8), dann gestreckt.
  const needed = vy * T / 2;
  const cap = vorgang.maxAbsenkung;
  let absenk = 0;
  let nAbsenk = 0;
  if (needed > hoch) {
    absenk = Math.min((needed - hoch) / 2, cap);
    const tAbsenk = 2 * absenk / vy;                 // s
    nAbsenk = Math.min(N - 1, Math.round(tAbsenk * fps));
    // Geschlossene Obergrenze: mit voller Gegenbewegung und optimaler
    // Zeitaufteilung: vy_max = 2·(2·cap + hoch)/T.
    const vyMax = 2 * (2 * cap + hoch) / T;
    if (vy > vyMax * 1.001) {
      bericht.konflikt.push({
        phase: phase.id, verb: 'takeoff', frame: phase.to - 1,
        bedingung: 'schwerpunktbahn-geschwindigkeit', einheit: 'm/s',
        soll: vy, erreicht: vyMax, betrag: vy - vyMax,
        grund: `Streckung ${(hoch * 100).toFixed(1)} cm plus Gegenbewegung ${(cap * 100).toFixed(1)} cm reichen nicht`,
        meldung: `Verlangte Absprunggeschwindigkeit ${vy.toFixed(2).replace('.', ',')} m/s übersteigt die Streckung: aus gemessener Streckung ${(hoch * 100).toFixed(1).replace('.', ',')} cm und Gegenbewegung ${(cap * 100).toFixed(1).replace('.', ',')} cm sind in ${(T * 1000).toFixed(0)} ms höchstens ${vyMax.toFixed(2).replace('.', ',')} m/s machbar — gefahren wird das Maximum, die Abweichung wird beim Nachmessen bestätigt`,
      });
      absenk = cap;
      nAbsenk = Math.min(N - 1, Math.round((2 * cap / vyMax) * fps));
    }
  }
  const nRise = N - nAbsenk;
  const bodenY = comStart[1] - absenk;
  // Hub der Druckrampe: ohne Gegenbewegung min(benötigt, verfügbar) — bei
  // v-Ende = 2·hub/T₂ soll genau vy herauskommen; mit Gegenbewegung der volle
  // Weg aus Absenkung plus Streckung.
  const hub = nAbsenk > 0 ? (absenk + hoch) : Math.min(needed, hoch);

  // Druckprofil: com(t) = boden + hub·(t/T₂)², v(Ende) = 2·hub/T₂.
  const comWeg = [comStart[1]];
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    let comSoll, halt;
    if (i < nAbsenk) {
      const t = (i + 1) / nAbsenk;
      comSoll = [comStart[0], comStart[1] - absenk * ease(t), comStart[2]];
      halt = haltungCrouch(skel, t);
    } else {
      const t = (i - nAbsenk + 1) / nRise;
      comSoll = [comStart[0], bodenY + hub * ramp2(t), comStart[2]];
      halt = haltungStreck(skel, t);
    }
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, halt);
    z.pose = r.pose;
    z.com = r.com;
    comWeg.push(r.com[1]);
    const dt = 1 / fps;
    z.comVel = [
      (r.com[0] - (frames.length ? frames[frames.length - 1].com[0] : r.com[0])) / dt,
      (comWeg[i + 1] - comWeg[i]) / dt,
      (r.com[2] - (frames.length ? frames[frames.length - 1].com[2] : r.com[2])) / dt,
    ];
    frames.push(frameKontakt(ctx, z, phase, f, r.fehler));
  }

  // Nachmessen der Absprunggeschwindigkeit: Rückwärts-Differenz 2. Ordnung
  // auf der gemessenen Schwerpunktfolge (exakt für das quadratische Profil).
  const dt = 1 / fps;
  const yN = comWeg[comWeg.length - 1], y1 = comWeg[comWeg.length - 2], y2 = comWeg[comWeg.length - 3];
  let vyGemessen = (3 * yN - 4 * y1 + y2) / (2 * dt);
  z.comVel = [z.comVel[0], vyGemessen, z.comVel[2]];

  if (vy - vyGemessen > 0.1 * vy) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'takeoff', frame: phase.to - 1,
      bedingung: 'schwerpunktbahn-geschwindigkeit', einheit: 'm/s',
      soll: vy, erreicht: vyGemessen, betrag: vy - vyGemessen,
      grund: begrenzungsbetonungAnker(skel, z.pose, vorgang.gelenke),
      meldung: `Gemessene Absprunggeschwindigkeit ${vyGemessen.toFixed(2).replace('.', ',')} m/s statt verlangt ${vy.toFixed(2).replace('.', ',')} m/s (Differenz ${(vy - vyGemessen).toFixed(2).replace('.', ',')} m/s)`,
    });
  }
  void begrenzungsbetonungAnker;

  // Kontakt lösen.
  z.kontakt = false;
  z.pivot = [...z.com];
}

function begrenzungsbetonungAnker(skel, pose, gelenke) {
  const e = vermessen(skel, pose, { anker: [], com: null, boden: [], haltung: {} }, gelenke);
  return e.an_grenze.length ? `Gelenk ${e.an_grenze[0].key} an Grenze ${e.an_grenze[0].grenze}° die Streckung begrenzt` : 'die gemessene Streckung ausgeschöpft ist';
}

function haltungStreck(skel, t) {
  const h = {};
  const a = HALTUNG_ANT.schwung * ramp2(t);
  if (skel.dofs['arm_l.swing']) h['arm_l.swing'] = randGrad(skel, 'arm_l.swing', a);
  if (skel.dofs['arm_r.swing']) h['arm_r.swing'] = randGrad(skel, 'arm_r.swing', a);
  if (skel.dofs['arm_l.lift']) h['arm_l.lift'] = randGrad(skel, 'arm_l.lift', a * 0.6);
  if (skel.dofs['arm_r.lift']) h['arm_r.lift'] = randGrad(skel, 'arm_r.lift', a * 0.6);
  if (skel.dofs['elbow_l.bend']) h['elbow_l.bend'] = randGrad(skel, 'elbow_l.bend', HALTUNG_ANT.hocke * (1 - t * 0.5));
  if (skel.dofs['elbow_r.bend']) h['elbow_r.bend'] = randGrad(skel, 'elbow_r.bend', HALTUNG_ANT.hocke * (1 - t * 0.5));
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// airborne — Flugbahn ist eine Parabel; Drehung mit Drehimpulserhaltung
// params: { tuck: 0..1 | [Stützpunkte], korrektur: bool (Testhaken),
//           vy?: Körperhöhen/s nur ohne vorangehenden takeoff }
// ─────────────────────────────────────────────────────────────────────────────

export function phaseAirborne(ctx, phase, z, frames, bericht) {
  const { skel, fps } = ctx;
  if (z.kontakt) {
    const vyEig = phase.params?.vy;
    if (typeof vyEig !== 'number' || !(vyEig > 0)) {
      bericht.hinweise.push(`airborne-Phase ${phase.id} beginnt bei Frame ${phase.from} im Kontakt ohne Absprunggeschwindigkeit; Parameter vy fehlt — ${phase.to - phase.from} Frames ohne Flug Lösung gehalten`);
      halteFrames(ctx, z, frames, phase, 'flug-halt');
      return;
    }
    z.comVel = [0, vyEig * skel.height, 0];
    z.kontakt = false;
    z.pivot = [...z.com];
    if (!z.spinGrad && phase.params?.spinGrad) z.spinGrad = phase.params.spinGrad;
  }
  // Drehimpulskorrektur (plan.md 6.5). Abschaltbar je Phase ODER global über
  // loeseBewegung(..., { drehimpulsKorrektur: false }) — der Testhaken für den
  // Negativfall: ohne sie weicht der Endwinkel messbar ab.
  const korrektur = phase.params?.korrektur !== false
    && phase.params?.drehimpulsKorrektur !== false
    && ctx.opts?.drehimpulsKorrektur !== false;
  const N = phase.to - phase.from;
  const dt = 1 / fps;

  // 1) Tuck-Profile: Einrollpose je Frame OHNE Drehung — das Trägheitsmoment
  //    um die Achse durch den Schwerpunkt hängt nicht vom Drehwinkel ab.
  const tucks = [];
  for (let i = 0; i < N; i++) tucks.push(sampleTuck(phase.params?.tuck, N, i));
  const basisPose = ohneDrehung(z.pose);
  const tuckPosen = tucks.map((w) => poseTuck(skel, basisPose, w));

  // 2) Trägheitsmomente pro Frame messen (Segmentmassen, gemessen).
  //    relCom: Schwerpunkt der reinen Gelenk-Pose im BIND-Raum (die
  //    Wurzelverschiebung wpos − Becken-bind wird von der FK addiert; der
  //    Drehpunkt der delta-Drehung liegt im Bind-Raum).
  const p0 = skel.byId.get(skel.rollenKnochen.pelvis).wPos;
  const inertas = [];
  const relComs = [];
  for (const p of tuckPosen) {
    const kn = poseZuFk(skel, p);
    const { com } = schwerpunkt(skel, kn);
    inertas.push(traegheit(skel, kn, z.spinAchse, com));
    relComs.push(vSub(com, vSub(p.wpos, p0)));     // Schwerpunkt bei delta = 0
  }

  // 3) Drehimpuls so wählen, dass der Sollwinkel exakt erreicht wird:
  //    Winkel(T) = Σ L/I_k ·dt = spinGrad  ⇒  L = spinGrad / Σ(dt/I_k).
  const spinGrad = z.spinGrad || (phase.params?.spinGrad ?? 0);
  const summeDtI = inertas.reduce((a, I) => a + (I > 0 ? dt / I : 0), 0);
  const L = summeDtI > 0 ? spinGrad / summeDtI : 0;
  const omegaKoerper = inertas.map((I) => (I > 0 ? L / I : 0));
  const omegaOhneKorrektur = inertas.map(() => omegaKoerper[0] ?? 0);  // ω eingefroren auf den Freisetzungswert
  const omegas = korrektur ? omegaKoerper : omegaOhneKorrektur;

  // 4) Frames bauen.
  const com0 = [...z.com];
  const v0 = [...z.comVel];
  let winkel = 0;
  let letzteCom = [...com0];
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = (i + 1) * dt;
    const comSoll = [
      com0[0] + v0[0] * t,
      com0[1] + v0[1] * t - 0.5 * G * t * t,
      com0[2] + v0[2] * t,
    ];
    winkel += omegas[i] * dt;
    const pose = kopierePose(tuckPosen[i]);
    // Drehpunkt: der Schwerpunkt der UNVERSCHOBENEN Tuck-Pose (relComs ist
    // relativ zum Becken gemessen) — gedreht wird um den eigenen Schwerpunkt.
    pose.pivot = [...relComs[i]];
    pose.waxis = vScale(z.spinAchse, winkel);
    const knOhne = poseZuFk(skel, pose);
    const comOhne = schwerpunkt(skel, knOhne).com;
    pose.wpos = vAdd(pose.wpos, vSub(comSoll, comOhne));
    const kn = poseZuFk(skel, pose);
    z.pose = pose;
    z.com = schwerpunkt(skel, kn).com;
    z.comVel = vScale(vSub(z.com, letzteCom), 1 / dt);
    letzteCom = [...z.com];
    z.drall = { L, I: inertas[i], omega: omegas[i], konstant: korrektur };
    frames.push(frameFlug(ctx, z, phase, f, kn, winkel, inertas[i]));
  }
  z.sollWinkel = spinGrad;
  z.endWinkel = winkel;

  if (!korrektur) {
    const abw = Math.abs(winkel - spinGrad);
    bericht.konflikt.push({
      phase: phase.id, verb: 'airborne', frame: phase.to - 1,
      bedingung: 'drehung', einheit: 'grad',
      soll: spinGrad, erreicht: winkel, betrag: abw,
      grund: 'Drehimpulskorrektur abgeschaltet — Winkelgeschwindigkeit nicht an das Trägheitsmoment angepasst',
      meldung: `Endwinkel weicht um ${abw.toFixed(1).replace('.', ',')}° ab (Soll ${spinGrad}°, erreicht ${winkel.toFixed(1).replace('.', ',')}°), weil die Winkelgeschwindigkeit nicht an das Trägheitsmoment angepasst wurde`,
    });
  }
}

function ohneDrehung(pose) {
  const p = kopierePose(pose);
  p.waxis = [0, 0, 0];
  return p;
}

/** tuck-Anteil je Frame: Skalar oder Stützpunktliste, linear interpoliert. */
function sampleTuck(w, n, i) {
  if (typeof w === 'number' && Number.isFinite(w)) return clamp(w, 0, 1);
  if (Array.isArray(w) && w.length > 0) {
    const s = (i / Math.max(1, n - 1)) * (w.length - 1);
    const i0 = Math.min(w.length - 1, Math.floor(s));
    const i1 = Math.min(w.length - 1, i0 + 1);
    const r = s - i0;
    return clamp(w[i0] * (1 - r) + w[i1] * r, 0, 1);
  }
  return 0;
}

/**
 * Einrollpose: Endeffektoren werden an den Schwerpunkt gezogen. Welcher
 * Freiheitsgrad in welche Richtung näher bringt, wird an der FK ERPROBT
 * (beide Grenzseiten gemessen), nicht aus Achsenbuchstaben abgeleitet.
 * Die GelenkNAMEN (hip_*, knee_*, arm_*, elbow_*) sind Teil des
 * Phasenvertrags (plan.md 6.3); Geometrie und Grenzen bleiben gemessen.
 */
export function poseTuck(skel, poseVor, anteil) {
  const pose = kopierePose(poseVor);
  if (!(anteil > 0)) return pose;
  const { com } = schwerpunkt(skel, poseZuFk(skel, pose));
  const endeffektoren = {
    hip_l: endknochen(skel, 'hip_l'), hip_r: endknochen(skel, 'hip_r'),
    knee_l: endknochen(skel, 'knee_l'), knee_r: endknochen(skel, 'knee_r'),
    arm_l: endknochen(skel, 'arm_l'), arm_r: endknochen(skel, 'arm_r'),
    elbow_l: endknochen(skel, 'elbow_l'), elbow_r: endknochen(skel, 'elbow_r'),
  };
  for (const [gelenk, end] of Object.entries(endeffektoren)) {
    const jd = skel.profile.joints[gelenk];
    if (!jd || !end) continue;
    for (const dof of Object.keys(jd.dof)) {
      const key = `${gelenk}.${dof}`;
      const d = skel.dofs[key];
      if (!d) continue;
      const [lo, hi] = d.grenze;
      const entfernung = (wert) => {
        const probe = kopierePose(pose);
        probe.dofs[key] = wert;
        const p = poseZuFk(skel, probe).get(end);
        return p ? vLen(vSub(p.pos, com)) : Infinity;
      };
      const basis = entfernung(0);
      const a = entfernung(hi), b = entfernung(lo);
      const richt = a <= b ? hi : lo;
      const gewin = clamp((basis - Math.min(a, b)) / Math.max(1e-9, basis), 0, 1);
      // Nur deutliche Annäherung rollt ein; wirkungslose Achsen bleiben 0.
      pose.dofs[key] = gewin > 0.03 ? richt * anteil * (0.3 + 0.7 * gewin) : 0;
    }
  }
  return pose;
}

/** Tiefster Nachfahre des Gelenkknochens — der reale Kettenende-Knochen. */
function endknochen(skel, gelenkName) {
  const jd = skel.profile.joints[gelenkName];
  if (!jd) return null;
  let best = jd.bone, tiefe = 0;
  const tiefeVon = (id, d) => {
    if (d > tiefe) { tiefe = d; best = id; }
    for (const k of skel.byId.get(id)?.kinder ?? []) tiefeVon(k, d + 1);
  };
  if (skel.byId.has(jd.bone)) tiefeVon(jd.bone, 0);
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// land — Aufsetzfuß berührt den Boden, Schwerpunkt kommt ins Lot
// params: { fuss: 'l' | 'r' | 'beide', tiefe: Abfedertiefe-Anteil }
// ─────────────────────────────────────────────────────────────────────────────

export function phaseLand(ctx, phase, z, frames, bericht) {
  const { skel, fps, vorgang } = ctx;
  if (z.kontakt) {
    bericht.hinweise.push(`land-Phase ${phase.id} beginnt bei Frame ${phase.from} im Kontakt — nichts aufzufangen; ${phase.to - phase.from} Frames gehalten`);
    halteFrames(ctx, z, frames, phase, 'kontakt');
    return;
  }
  const fussSeiten = phase.params?.fuss === 'l' ? ['l'] : phase.params?.fuss === 'r' ? ['r'] : ['l', 'r'];
  const tiefeAnteil = phase.params?.tiefe ?? phase.params?.abfedern ?? 0.10;
  if (typeof tiefeAnteil !== 'number' || !(tiefeAnteil > 0)) {
    throw new Error(`land-Phase ${phase.id}: Parameter tiefe ist ${JSON.stringify(tiefeAnteil)}: erwartet Zahl > 0 als Anteil der Körperhöhe`);
  }
  const N = phase.to - phase.from;
  const dt = 1 / fps;
  const com0 = [...z.com];
  const v0 = [...z.comVel];

  // Aufsetzhöhe: Stehpose so weit gesenkt, dass die tiefste Sohle den Boden
  // berührt — Versatz aus der Vermessung.
  const knStart = poseZuFk(skel, vorgang.start);
  const fussBindPos = {};
  for (const s of fussSeiten) fussBindPos[s] = [...knStart.get(skel.rollenKnochen['foot_' + s]).pos];
  const comTouch = vorgang.com0[1] - vorgang.sohlenVersatz;

  // Aufsetzframe: Ballistik, bis der Schwerpunkt comTouch erreicht.
  let touch = -1;
  for (let i = 0; i < N; i++) {
    const t = (i + 1) * dt;
    if (com0[1] + v0[1] * t - 0.5 * G * t * t <= comTouch) { touch = i; break; }
  }

  if (touch < 0) {
    // Die Phase reicht nicht zum Aufsetzen: Reststrecke melden.
    for (let i = 0; i < N; i++) {
      const t = (i + 1) * dt;
      frames.push(frameFlugFort(ctx, z, phase, phase.from + i, [
        com0[0] + v0[0] * t, com0[1] + v0[1] * t - 0.5 * G * t * t, com0[2] + v0[2] * t,
      ]));
    }
    const comEnde = frames[frames.length - 1].com;
    const vEnde = v0[1] - G * N * dt;
    const restweg = comEnde[1] - comTouch;
    const restzeit = (Math.sqrt(Math.max(0, vEnde * vEnde + 2 * G * restweg)) + vEnde) / G;
    z.com = [...comEnde];
    z.comVel = [v0[0], vEnde, v0[2]];
    bericht.konflikt.push({
      phase: phase.id, verb: 'land', frame: phase.to - 1,
      bedingung: 'aufsetzen', einheit: 'm',
      soll: comTouch, erreicht: comEnde[1],
      betrag: restweg,
      grund: 'Schwerpunkt erreicht die Aufsetzhöhe innerhalb der Phase nicht',
      meldung: `Landung außerhalb der Streckreichweite: Schwerpunkt bei Frame ${phase.to - 1} noch ${(restweg * 100).toFixed(1).replace('.', ',')} cm über der Aufsetzhöhe ${(comTouch * 100).toFixed(1).replace('.', ',')} cm; dafür fehlen ${(restzeit * 1000).toFixed(0)} ms Flugzeit`,
    });
    return;
  }

  // Freie Fall-Phase bis kurz vor Aufsetzen.
  for (let i = 0; i < touch; i++) {
    const t = (i + 1) * dt;
    z.com = [com0[0] + v0[0] * t, com0[1] + v0[1] * t - 0.5 * G * t * t, com0[2] + v0[2] * t];
    frames.push(frameFlugFort(ctx, z, phase, phase.from + i, z.com));
  }

  // Aufsetzframe: Füße neu verankern, exakt unter dem Aufsetzpunkt.
  const tTouch = (touch + 1) * dt;
  const comLande = [
    com0[0] + v0[0] * tTouch,
    Math.max(comTouch, com0[1] + v0[1] * tTouch - 0.5 * G * tTouch * tTouch),
    com0[2] + v0[2] * tTouch,
  ];
  const mittelX = mittelpunkt(Object.values(fussBindPos))[0];
  const mittelZ = mittelpunkt(Object.values(fussBindPos))[2];
  // Verankert werden auch beim Aufsetzen die gemessenen SOHLENPUNKTE: der
  // Sollort jedes Fußes wird als Versatz auf seine Bind-Sohlenlagen gelegt.
  // Nur der Fußursprung als Anker ließe den Fuß frei kippen.
  const sohlenBind = sohlenWelt(skel, knStart);
  const neueAnker = [];
  for (const s of fussSeiten) {
    const fp = fussBindPos[s];
    const knochen = skel.rollenKnochen['foot_' + s];
    const fussSoll = [
      comLande[0] + (fp[0] - mittelX) * (fussSeiten.length > 1 ? 1 : 0),
      fp[1] - vorgang.sohlenVersatz,
      comLande[2] + (fp[2] - mittelZ) * (fussSeiten.length > 1 ? 1 : 0),
    ];
    const versatz = vSub(fussSoll, fp);
    neueAnker.push(...sohlenAnker(skel, sohlenBind.filter((x) => x.bone === knochen), versatz));
  }
  if (neueAnker.length === 0) {
    throw new Error(`land-Phase ${phase.id}: 0 Sohlenpunkte für Fuß „${fussSeiten.join('+')}“ im Profil (${skel.soles.length} Sohlen insgesamt)`);
  }
  const reich = pruefeReichweite(skel, z.pose, neueAnker);
  if (!reich.ok) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'land', frame: phase.from + touch,
      bedingung: 'aufsetzen', einheit: 'm',
      soll: reich.notig, erreicht: reich.erreichbar, betrag: reich.notig - reich.erreichbar,
      grund: 'Aufsetzpunkt außerhalb der Beinstreckreichweite',
      meldung: reich.meldung,
    });
    for (let i = touch; i < N; i++) {
      const t = (i + 1) * dt;
      frames.push(frameFlugFort(ctx, z, phase, phase.from + i, [
        com0[0] + v0[0] * t, com0[1] + v0[1] * t - 0.5 * G * t * t, com0[2] + v0[2] * t,
      ]));
    }
    return;
  }
  z.anker = neueAnker;
  z.kontakt = true;
  z.pivot = [...comLande];
  const rTouch = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comLande, haltungLand(skel, 0));
  z.pose = rTouch.pose;
  z.com = rTouch.com;
  frames.push(frameKontakt(ctx, z, phase, phase.from + touch, rTouch.fehler));

  // Abfedern: v_ab Aufsetzen gleichmäßig auf null; benötigte Strecke
  // v·T/2, begrenzt durch die gemessene Haltbarkeit der Hocke.
  const comTouchIst = [...z.com];
  const vTouch = Math.abs(v0[1] - G * tTouch);
  const nCush = N - touch - 1;
  const Tc = nCush * dt;
  const braucht = vTouch * Tc / 2;
  const verlangt = tiefeAnteil * skel.height;
  const ziel = Math.min(Math.max(braucht, verlangt), vorgang.maxAbsenkung);
  if (braucht > vorgang.maxAbsenkung + skel.height * COM_ZIEL_ANTEIL) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'land', frame: phase.to - 1,
      bedingung: 'abfedern', einheit: 'm',
      soll: braucht, erreicht: vorgang.maxAbsenkung, betrag: braucht - vorgang.maxAbsenkung,
      grund: `Aufsetzgeschwindigkeit ${vTouch.toFixed(2)} m/s braucht ${(braucht * 100).toFixed(1)} cm Abfederweg`,
      meldung: `Abfedern außer Strecke: benötigt ${(braucht * 100).toFixed(1).replace('.', ',')} cm, gemessene Beinkette hält ${(vorgang.maxAbsenkung * 100).toFixed(1).replace('.', ',')} cm — Schwerpunkt kann nicht vollständig abgebremst werden`,
    });
  }
  for (let i = 0; i < nCush; i++) {
    const t = (i + 1) / nCush;
    const comSoll = [comTouchIst[0], comTouchIst[1] - ziel * easeOut(t), comTouchIst[2]];
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, haltungLand(skel, t));
    z.pose = r.pose;
    z.com = r.com;
    frames.push(frameKontakt(ctx, z, phase, phase.from + touch + 1 + i, r.fehler));
  }
  z.comVel = [0, 0, 0];
}

function haltungLand(skel, t) {
  const h = {};
  const a = HALTUNG_ANT.landung * (1 - easeOut(t));
  if (skel.dofs['arm_l.swing']) h['arm_l.swing'] = randGrad(skel, 'arm_l.swing', a);
  if (skel.dofs['arm_r.swing']) h['arm_r.swing'] = randGrad(skel, 'arm_r.swing', a);
  if (skel.dofs['elbow_l.bend']) h['elbow_l.bend'] = randGrad(skel, 'elbow_l.bend', a * 0.7);
  if (skel.dofs['elbow_r.bend']) h['elbow_r.bend'] = randGrad(skel, 'elbow_r.bend', a * 0.7);
  return h;
}

/**
 * Streckreichweite: horizontale+tiefe Distanz Becken→Aufsetzpunkt gegen die
 * Summe der Beingliedmaßenlängen — beide aus bindWorld gemessen.
 */
export function pruefeReichweite(skel, pose, anker) {
  const kn = poseZuFk(skel, pose);
  const hip = kn.get(skel.rollenKnochen.pelvis).pos;
  let notig = 0, erreichbar = Infinity, wer = '';
  for (const a of anker) {
    let summe = 0;
    let cur = skel.byId.get(a.knochen);
    while (cur && cur.id !== skel.rollenKnochen.pelvis && cur.parent) {
      const p = skel.byId.get(cur.parent);
      summe += vLen(vSub(cur.bindWorld, p.bindWorld));
      cur = p;
    }
    // Sohlenanker sitzen knochenfest VOR dem Fußursprung (am Xbot bis 17 cm
    // Richtung Zeh). Ihr Abstand gehoert zur Streckreichweite dazu, sonst
    // gilt schon der Bind-Stand als unerreichbar: dort liegt der vorderste
    // Sohlenpunkt 104,0 cm vom Becken entfernt, die Kette bis zum
    // Fussursprung misst 99,6 cm.
    if (a.lokal) {
      const stab = skel.byId.get(a.knochen)?.weltmassstab ?? 1;
      summe += vLen(a.lokal) * stab;
    }
    const d = vLen(vSub(a.soll, hip));
    if (d - summe > notig - erreichbar || erreichbar === Infinity) {
      notig = d; erreichbar = summe; wer = a.id ?? a.knochen;
    }
  }
  const ok = notig <= erreichbar * 1.02;
  return {
    ok, notig, erreichbar,
    meldung: ok ? '' : `Aufsetzpunkt ${wer}: ${(notig * 100).toFixed(1).replace('.', ',')} cm von der Hüfte entfernt, die Beinkette reicht nur ${(erreichbar * 100).toFixed(1).replace('.', ',')} cm — Landung außerhalb der Streckreichweite`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Frames bauen — direkt als Eingabe für den AP4-Physikprüfer (positions, com,
// contact, anchored) plus solved-Darstellung aus plan.md 5.2
// ─────────────────────────────────────────────────────────────────────────────

function frameKontakt(ctx, z, phase, f, fehler) {
  const { skel } = ctx;
  const kn = poseZuFk(skel, z.pose);
  const com = schwerpunkt(skel, kn).com;
  return basisFrame(skel, z, phase, f, kn, com, 'kontakt', soleIdsFuer(skel, z.anker), {
    verletzungen: {
      anker: (fehler?.anker ?? []).map((a) => ({ teil: a.teil, betrag_m: +a.betrag_m.toFixed(4) })),
    },
  });
}

function frameFlug(ctx, z, phase, f, kn, winkel, inertia) {
  const { skel } = ctx;
  return basisFrame(skel, z, phase, f, kn, z.com, 'flug', [], {
    winkelGrad: +winkel.toFixed(3), traegheit: inertia, omegaGradProS: z.drall?.omega ?? 0,
  });
}

/** Flugframe innerhalb land (Pose gehalten, Schwerpunkt auf Parabel). */
function frameFlugFort(ctx, z, phase, f, comSoll) {
  const { skel } = ctx;
  const pose = kopierePose(z.pose);
  pose.pivot = [...comSoll];
  const knOhne = poseZuFk(skel, pose);
  const comOhne = schwerpunkt(skel, knOhne).com;
  pose.wpos = vAdd(pose.wpos, vSub(comSoll, comOhne));
  const kn = poseZuFk(skel, pose);
  return basisFrame(skel, { ...z, pose, com: comSoll }, phase, f, kn, comSoll, 'flug', [], {});
}

function halteFrames(ctx, z, frames, phase, zustand) {
  const { skel } = ctx;
  for (let f = phase.from; f < phase.to; f++) {
    const kn = poseZuFk(skel, z.pose);
    const com = schwerpunkt(skel, kn).com;
    frames.push(basisFrame(skel, z, phase, f, kn, com, zustand === 'kontakt' ? 'kontakt' : 'flug',
      zustand === 'kontakt' ? soleIdsFuer(skel, z.anker) : [], {}));
  }
}

function basisFrame(skel, z, phase, f, kn, com, kontakt, ankerIds, extra) {
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
    root: { pos: [...z.pose.wpos], quat: [...wurzelQuat(z.pose)] },
    joints,
    positions: positionen,
    com: [...com],
    contact: kontakt,
    anchored: ankerIds,
    geschwindigkeit: [...z.comVel],
    ...extra,
  };
}

function wurzelQuat(pose) {
  const w = vLen(pose.waxis);
  return w > 1e-12 ? qFromAxisAngle(pose.waxis, w * Math.PI / 180) : [0, 0, 0, 1];
}

function soleIdsFuer(skel, anker) {
  const out = [];
  for (const a of anker) {
    for (const s of skel.soles) if (s.bone === a.knochen) out.push(s.id);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// AP5.2 — stand: ruhiges Stehen mit verlagerter Gewichtsverteilung
// params: { verteilung: Anteil des Gewichts auf dem linken Fuß 0..1
//                       (0,5 = beide Füße gleich), atmen: Haltungsanteil 0..1 }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anker für `stand`: beide Füße bleiben komplett auf den gemessenen
 * Sohlenpunkten verankert (`vorgang.anker`) — nichts wird aufgezogen. Die
 * Gewichtsverteilung ist eine VERLAGERUNG des Schwerpunkt-Sollorts in der
 * Stützfläche: `verteilung` 1 heißt schwerpunktmäßig vollständig auf das
 * linke Sohlenzentrum, 0 auf das rechte.
 */
/** Haltungsamplitude des Atmens, Anteil der gemessenen Grenzspanne: eine
 *  dezente Armbewegung, die den ruhigen Stand sichtbar atmen lässt. */
export const ATMEN_ANT = 0.10;

/** Arm-Welle für `stand` (`atmen`): 1 = Neutrallage, darunter schwingen die
 *  Arme auf der größeren gemessenen Grenzseite aus. */
function haltungAtmen(skel, welle) {
  const h = {};
  const a = ATMEN_ANT * (1 - welle);   // 0 in der Neutrallage
  if (skel.dofs['arm_l.swing']) h['arm_l.swing'] = randGrad(skel, 'arm_l.swing', a);
  if (skel.dofs['arm_r.swing']) h['arm_r.swing'] = randGrad(skel, 'arm_r.swing', a);
  return h;
}

const cmText = (m) => (m * 100).toFixed(1).replace('.', ',');

export function phaseStand(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const verteilung = phase.params?.verteilung ?? phase.params?.weight ?? 0.5;
  if (typeof verteilung !== 'number' || !Number.isFinite(verteilung)
    || verteilung < 0 || verteilung > 1) {
    throw new Error(`stand-Phase ${phase.id}: Parameter verteilung ist ${JSON.stringify(verteilung)}: erwartet Zahl 0..1 (Anteil des Gewichts auf dem linken Fuß; 0,5 = gleichmäßig)`);
  }
  const atem = phase.params?.atmen ?? phase.params?.breath;
  if (atem !== undefined && (typeof atem !== 'number' || !Number.isFinite(atem) || atem < 0 || atem > 1)) {
    throw new Error(`stand-Phase ${phase.id}: Parameter atmen ist ${JSON.stringify(atem)}: erwartet Zahl 0..1 als Anteil der Haltungsspanne`);
  }

  // Gemessene Sohlenzentren (Mittel der Sohlenpunkte je Fuß) — Stützfläche
  // aus dem Modell, keine getippte Standbreite.
  const kn0 = poseZuFk(skel, vorgang.start);
  const sohlen = sohlenWelt(skel, kn0);
  const zentrum = (bone) => {
    const p = sohlen.filter((s) => s.bone === bone);
    if (p.length === 0) throw new Error(`stand-Phase ${phase.id}: 0 Sohlenpunkte am Knochen „${bone}“ (Profil hält ${skel.soles.length})`);
    return [0, 1, 2].map((i) => p.reduce((a, s) => a + s.pos[i], 0) / p.length);
  };
  const l = zentrum(skel.rollenKnochen.foot_l);
  const r = zentrum(skel.rollenKnochen.foot_r);
  const stuetz = [
    verteilung * l[0] + (1 - verteilung) * r[0],
    verteilung * l[1] + (1 - verteilung) * r[1],
    verteilung * l[2] + (1 - verteilung) * r[2],
  ];

  const comStart = [...z.com];

  // Gemessene Verlagerungsgrenze (Regel 1): wie weit trägt die Nachsteuerung
  // den Schwerpunkt je Seite, bevor der Fußanker (Rang 3) bricht? Ausgemessen
  // per Steuerlauf auf das jeweilige Sohlenzentrum — nicht getippt.
  const versuch = (footBone) => {
    const ziel = [...zentrum(footBone)];
    ziel[1] = comStart[1];                       // Höhe bleibt, nur xz verlagert
    return steuereKontakt(skel, vorgang.start, vorgang.gelenke, vorgang.anker, ziel, {});
  };
  const nachL = versuch(skel.rollenKnochen.foot_l);
  const nachR = versuch(skel.rollenKnochen.foot_r);

  // Erreichbare Ziellage: volle Vorgabe wäre das Sohlenzentrum (stuetz);
  // machbar ist nur der gemessene Anteil davon. Unerreichbare Reste werden
  // gemeldet (unten), gefahren wird der Deckel — kein stilles Abschneiden.
  const verlagerSoll = Math.abs(verteilung - 0.5) * 2;       // 0..1 je Seite
  const seite = verteilung >= 0.5 ? 1 : -1;
  const grenzCom = seite > 0 ? nachL.com : nachR.com;
  const ziel = [0, 1, 2].map((i) => comStart[i] + verlagerSoll * (grenzCom[i] - comStart[i]));

  // Meldung mit Betrag: verlangte Verlagerung (Weg zum Sohlenzentrum) gegen
  // die machbare. Rangfolge plan.md 6.4: der Fußanker (Rang 3) hält, die
  // Verlagerung (Bahn, Rang 4) wird geopfert.
  const weg = (p) => Math.hypot(p[0] - comStart[0], p[2] - comStart[2]);
  const sollWeg = verlagerSoll > 0 ? weg(stuetz) / verlagerSoll : 0;  // voller Weg zum Zentrum
  // Gemeldet wird spaeter — NACH dem Fahren, mit dem Weg, der tatsaechlich
  // herauskam. Vorher stand hier der geplante Zielweg als "erreicht": am Xbot
  // 1,50 cm gemeldet gegen 0,47 cm gefahren. Ein Bericht, der eine andere Zahl
  // nennt als die Bewegung zeigt, ist schlimmer als keiner — die ganze
  // Zusicherung dieses Projekts haengt daran, dass gemeldete Betraege stimmen.
  const zuMelden = (sollWeg - weg(ziel) > skel.height * COM_ZIEL_ANTEIL)
    ? {
      grund: nachL.text ?? nachR.text
        ?? 'die Fußanker (Rang 3) brechen, bevor der Schwerpunkt die Sollage erreicht',
    }
    : null;

  const N = phase.to - phase.from;
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = N > 1 ? (i + 1) / N : 1;
    // Sollbahn: Sanftranpe 0→1 auf die erreichbare Ziellage (ease), Höhe
    // unverändert; Atmewelle nur als Haltung, nie als Bahn-Buckel.
    const welle = N > 1 ? ease(Math.min(1, t * 2)) : 1;
    const comSoll = [0, 1, 2].map((k) =>
      k === 1 ? ziel[1] : comStart[k] + (ziel[k] - comStart[k]) * welle);
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll,
      haltungAtmen(skel, N > 1 ? (1 - Math.cos(2 * Math.PI * (atem ?? 0) * t)) / 2 : 0));
    z.pose = r.pose;
    z.com = r.com;
    frames.push(basisFrame(skel, z, phase, f, poseZuFk(skel, z.pose), r.com,
      'kontakt', soleIdsFuer(skel, z.anker),
      r.verankertFest ? {} : { ankerGebrochen: true }));
    if (!r.verankertFest) {
      throw new Error(`stand-Phase ${phase.id} Frame ${f}: Fußanker gebrochen (${r.text}) — der Stand darf niemals die Sohlenanker opfern`);
    }
  }

  // Jetzt messen, was gefahren wurde: waagerechter Weg des Schwerpunkts vom
  // ersten zum letzten Frame dieser Phase.
  if (zuMelden && frames.length > 0) {
    const erster = frames[frames.length - N] ?? frames[0];
    const letzter = frames[frames.length - 1];
    const gefahren = Math.hypot(
      letzter.com[0] - erster.com[0],
      letzter.com[2] - erster.com[2],
    );
    const cm = (m) => (m * 100).toFixed(1).replace('.', ',');
    bericht.konflikt.push({
      phase: phase.id, verb: 'stand', frame: phase.to - 1,
      bedingung: 'gewichtsverlagerung', einheit: 'm',
      soll: sollWeg, erreicht: gefahren, betrag: sollWeg - gefahren,
      grund: zuMelden.grund,
      meldung: `Gewichtsverlagerung auf ${seite > 0 ? 'links' : 'rechts'} um `
        + `${cm(sollWeg)} cm verlangt, gefahren wurden ${cm(gefahren)} cm — `
        + `${cm(sollWeg - gefahren)} cm fehlen, weil sonst `
        + `${zuMelden.grund.toLowerCase()}`,
    });
  }

  z.comVel = [0, 0, 0];
}

// ═════════════════════════════════════════════════════════════════════════════
// AP5.2 — swing_arms: Armschwung, während die Füße verankert bleiben
// params: { richtung: 'vor'|'rueck'|'auf'|'ab'|'links'|'rechts',
//           ausschlag: Anteil der gemessenen Grenzspanne 0..1,
//           wiederholungen: ganze Zahl >= 0 }
// ─────────────────────────────────────────────────────────────────────────────

/** Gradwert einer Grenzspanne: anteil 0..1 auf die größere (betragsmäßig)
 *  Grenzseite gemappt, mit Vorzeichen — Spiegelung sitzt in den Grenzen. */
function randGradWert(grenze, anteilMitVorzeichen) {
  const [lo, hi] = grenze;
  return clamp(anteilMitVorzeichen, lo, hi);
}

/**
 * Anker für `swing_arms`: wie bei `stand` bleiben beide Füße komplett auf den
 * gemessenen Sohlenpunkten verankert; der Schwung läuft allein über die
 * Armgelenke, deren Amplitude als Anteil der GEMESSENEN Grenzspanne eingesetzt
 * wird — keine Gradzahl wird getippt.
 */
export function phaseSwingArms(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const richtung = phase.params?.richtung ?? phase.params?.direction ?? 'vor';
  if (!['vor', 'rueck', 'auf', 'ab', 'links', 'rechts'].includes(richtung)) {
    throw new Error(`swing_arms-Phase ${phase.id}: Parameter richtung ist ${JSON.stringify(richtung)}: erwartet 'vor', 'rueck', 'auf', 'ab', 'links' oder 'rechts'`);
  }
  const ausschlag = phase.params?.ausschlag ?? phase.params?.amplitude ?? 1;
  if (typeof ausschlag !== 'number' || !Number.isFinite(ausschlag) || ausschlag < 0 || ausschlag > 1) {
    throw new Error(`swing_arms-Phase ${phase.id}: Parameter ausschlag ist ${JSON.stringify(ausschlag)}: erwartet Zahl 0..1 als Anteil der gemessenen Grenzspanne des Armgelenks`);
  }
  const wiederholungen = phase.params?.wiederholungen ?? 1;
  if (!Number.isInteger(wiederholungen) || wiederholungen < 0) {
    throw new Error(`swing_arms-Phase ${phase.id}: Parameter wiederholungen ist ${JSON.stringify(wiederholungen)}: erwartet ganze Zahl >= 0`);
  }

  // Schwunggelenke und Ziel aus dem GEMESSENEN DOF-Katalog: die Gelenknamen
  // sind Phasenvertrag (plan.md 6.3), die Grenzen kommen aus dem Profil. Das
  // Vorzeichen der Bewegung liegt in den Grenzen selbst (arm_l.swing [-130, 90]:
  // der Arm schwingt auf die größere Grenzseite, nach hinten — siehe randGrad).
  const dofKey = { vor: 'swing', rueck: 'swing', auf: 'lift', ab: 'lift', links: 'twist', rechts: 'twist' }[richtung];
  const vorZeichen = (richtung === 'rueck' || richtung === 'ab') ? -1 : 1;
  const schwung = [];
  for (const seite of ['l', 'r']) {
    const key = `arm_${seite}.${dofKey}`;
    const d = skel.dofs[key];
    if (!d) continue;
    const [lo, hi] = d.grenze;
    const zielSeite = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
    schwung.push({ key, ziel: zielSeite * vorZeichen, grenze: [lo, hi] });
  }
  if (schwung.length === 0) {
    throw new Error(`swing_arms-Phase ${phase.id}: kein Armgelenk „arm_l/r.${dofKey}“ im Profil (${Object.keys(skel.dofs).length} Freiheitsgrade durchsucht)`);
  }

  const N = phase.to - phase.from;
  if (N < 2) {
    throw new Error(`swing_arms-Phase ${phase.id} dauert ${N} Frame: mindestens 2 für einen Schwung mit Rückkehr`);
  }

  let ankerBruch = null;
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = N > 1 ? (i + 1) / N : 1;
    const haltung = {};
    // Wellenform des Ausschlags: 0 = einmal hin und halten (ease-Rampe auf
    // den vollen Ausschlag), sonst wiederholte Schwünge als Sinuswelle
    // zwischen 0 und dem Ausschlag. Anteile, nicht Grad.
    const welle = wiederholungen === 0
      ? ease(t)
      : wiederholungen === 1
        ? (1 - Math.cos(2 * Math.PI * t)) / 2
        : (1 - Math.cos(2 * Math.PI * wiederholungen * t)) / 2;
    for (const s of schwung) {
      haltung[s.key] = randGradWert(s.grenze, s.ziel * ausschlag * welle);
    }
    // Der Schwung verlagert den Schwerpunkt; die Nachsteuerung hält ihn auf
    // der Bahn, während die Füße verankert bleiben (Bauweise wie stand/crouch).
    const comSoll = [...z.com];
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, haltung);
    z.pose = r.pose;
    z.com = r.com;
    frames.push(basisFrame(skel, z, phase, f, poseZuFk(skel, z.pose), r.com,
      'kontakt', soleIdsFuer(skel, z.anker), {}));
    if (!r.verankertFest && !ankerBruch) {
      ankerBruch = { f, text: r.text };
    }
  }

  if (ankerBruch) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'swing_arms', frame: ankerBruch.f,
      bedingung: 'fußanker', einheit: 'm',
      soll: skel.height * ANKER_GRENZE_ANTEIL,
      erreicht: skel.height * ANKER_GRENZE_ANTEIL,
      betrag: skel.height * ANKER_GRENZE_ANTEIL,
      grund: ankerBruch.text ?? 'der Fußanker bricht unter dem Armschwung',
      meldung: `Fußanker bei Frame ${ankerBruch.f} gebrochen: ${ankerBruch.text} — der Schwunkausschlag ${ausschlag} wurde gedämpft, damit der Anker hält (plan.md 6.4 Rang 3)`,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AP5.3 — vier weitere Verben: step, turn, settle, reach. Dieselbe Bauweise
// wie die abgenommenen: Sollbahn + verankerte Kontaktpunkte + Nachsteuerung
// über steuereKontakt, alle Grenzen gemessen, unerreichbare Vorgaben mit
// Betrag gemeldet (plan.md 6.4 — kein stilles Abschneiden).
// ═════════════════════════════════════════════════════════════════════════════

// ── Gemeinsame Hilfen ────────────────────────────────────────────────────────

/** Alle Anker, die NICHT am genannten Fußknochen sitzen — die Anker des
 *  anderen Fußes bleiben komplett erhalten (Sohlenpunkte, nicht Ursprung). */
function ankerOhne(anker, fussKnochen) {
  return anker.filter((a) => a.knochen !== fussKnochen);
}

/** Neue Anker für EINEN Fuß: die gemessenen Sohlenpunkte des Profils
 *  (knochenfest, mit `lokal`), in der AKTUELLEN Pose ausgemessen und um
 *  `versatz` (Weltmeter) verschoben. Denselbe Bauweise wie land: der Sollort
 *  eines Sohlenpunkts ist seine Ist-Weltlage plus Versatz — nur waagerechte
 *  Versätze halten die Sohle sonst über dem Boden in der Luft. */
function ankerFussVersetzt(skel, pose, fussKnochen, versatz, kontext) {
  const sohlen = sohlenWelt(skel, poseZuFk(skel, pose)).filter((s) => s.bone === fussKnochen);
  if (sohlen.length === 0) {
    throw new Error(`${kontext}: 0 Sohlenpunkte am Knochen „${fussKnochen}“ (Profil hält ${skel.soles.length} Sohlen)`);
  }
  const lokalById = new Map(skel.soles.map((s) => [s.id, s]));
  return sohlen.map((s) => {
    const def = lokalById.get(s.id);
    if (!def) {
      throw new Error(`${kontext}: Sohle „${s.id}“ nicht unter ${skel.soles.length} Profil-Sohlen`);
    }
    return {
      id: s.id, knochen: s.bone, lokal: [...def.local],
      soll: [s.pos[0] + versatz[0], s.pos[1] + versatz[1], s.pos[2] + versatz[2]],
    };
  });
}

/** Sohlenzentrum eines Fußes (x und z) — für Schrittbeinwahl und Weitenmessung. */
function sohlenZentrumXZ(skel, pose, fussKnochen, kontext) {
  const sohlen = sohlenWelt(skel, poseZuFk(skel, pose)).filter((s) => s.bone === fussKnochen);
  if (sohlen.length === 0) {
    throw new Error(`${kontext}: 0 Sohlenpunkte am Knochen „${fussKnochen}“`);
  }
  return [
    sohlen.reduce((a, s) => a + s.pos[0], 0) / sohlen.length,
    sohlen.reduce((a, s) => a + s.pos[2], 0) / sohlen.length,
  ];
}

/**
 * Streckreichweite gegen einen GEGEBENEN Beckenpunkt (statt der Pose) — für
 * das Schrittbein, dessen Becken beim Schritt mitwandert. Dieselbe Messung
 * wie pruefeReichweite: Abstand Anker→Becken gegen die Summe der
 * Beingliedlängen plus Sohlenversatz, beides aus bindWorld gemessen.
 */
export function pruefeReichweiteAnPunkt(skel, hip, anker) {
  let notig = 0, erreichbar = Infinity, wer = '';
  for (const a of anker) {
    let summe = 0;
    let cur = skel.byId.get(a.knochen);
    while (cur && cur.id !== skel.rollenKnochen.pelvis && cur.parent) {
      const p = skel.byId.get(cur.parent);
      summe += vLen(vSub(cur.bindWorld, p.bindWorld));
      cur = p;
    }
    if (a.lokal) {
      const stab = skel.byId.get(a.knochen)?.weltmassstab ?? 1;
      summe += vLen(a.lokal) * stab;
    }
    const d = vLen(vSub(a.soll, hip));
    if (d - summe > notig - erreichbar || erreichbar === Infinity) {
      notig = d; erreichbar = summe; wer = a.id ?? a.knochen;
    }
  }
  const ok = notig <= erreichbar * 1.02;
  return {
    ok, notig, erreichbar,
    meldung: ok ? '' : `Aufsetzpunkt ${wer}: ${(notig * 100).toFixed(1).replace('.', ',')} cm vom mitbewegten Becken entfernt, die Beinkette reicht nur ${(erreichbar * 100).toFixed(1).replace('.', ',')} cm — außerhalb der Streckreichweite`,
  };
}

/** Meldungstext mit_cm: 0,0123 m → "1,2 cm". */
const cmZahl = (m) => (m * 100).toFixed(1).replace('.', ',');

/** Konflikteintrag einheitlicher Form (plan.md 6.4): Soll, erreicht, Betrag,
 *  Einheit, Grund — mit einer Zahl in der Meldung (AGENTS.md). */
function konfliktEintrag(bericht, phase, verb, bedingung, soll, erreicht, grund, meldung) {
  bericht.konflikt.push({
    phase: phase.id, verb, frame: phase.to - 1,
    bedingung, einheit: 'm',
    soll, erreicht, betrag: soll - erreicht,
    grund, meldung,
  });
}

// ── BENANNTE PARAMETER des Schritts ─────────────────────────────────────────

/** Stufengröße der Beckenabsenkungs-Messung, Anteil der Körperhöhe. 2 %:
 *  unter der Anker-Grenze (0,6 %) mal 3 — eine Stufe über der Auflösung,
 *  die die Nachsteuerung überhaupt unterscheiden kann; fein genug, um den
 *  Bedarf auf ~2 % genau zu treffen. */
export const SENK_STUFE_ANTEIL = 0.02;

/** Oberdeckel der Absenkungs-Messung, Anteil der Körperhöhe. 15 % liegt
 *  deutlich unter der gemessenen tiefsten haltbaren Hocke (maxAbsenkung,
 *  am Xbot 14,3 % der Höhe) — ein Schritt ist kein Kniebeugen-Wettbewerb. */
export const SENK_DECKEL_ANTEIL = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// step — ein Schritt in eine Richtung (Kontaktwechsel, plan.md 6.6)
// params: { weite: Anteil der Körperhöhe, richtung: Grad um +Y (0 = +Z),
//           fuss: 'l' | 'r' }
//
// Ein Schritt in drei Dritteln der Phasenzeit:
//   1. Gewicht aufs Stützbein verlagern (das Schrittbein entlasten),
//   2. das Schrittbein löst, schwingt auf den Sollort (Bind-Lage + Versatz),
//   3. es wird an den neuen Sohlenpunkten wieder verankert, das Gewicht
//      folgt ein Stück nach — der Körper ist einen Schritt weiter.
// Das Stützbein bleibt durchgehend auf seinen Sohlenpunkten verankert
// (Rang 3); der Schwerpunkt-Sollort wandert mit, damit die Balance (Rang 2)
// ihn über der jeweiligen Stützfläche hält.
// Unerreichbare Weiten: die Beinstreckreichweite wird vorab gemessen
// (pruefeReichweite), der Schritt auf die machbare Weite gekürzt und die
// Differenz MIT BETRAG gemeldet — gefahren wird der Deckel, nicht geraten.
// ─────────────────────────────────────────────────────────────────────────────

/** Waagerechter Weltversatz aus Schrittweite (Anteil der Körperhöhe) und
 *  Richtungswinkel (Grad, 0 = Charakter-vorne +Z, positiv nach links +X). */
export function schrittVersatz(skel, weiteAnteil, richtungGrad) {
  const d = weiteAnteil * skel.height;
  const r = richtungGrad * Math.PI / 180;
  return [d * Math.sin(r), 0, d * Math.cos(r)];
}

export function phaseStep(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const weiteAnt = phase.params?.weite ?? phase.params?.stepLength;
  if (typeof weiteAnt !== 'number' || !Number.isFinite(weiteAnt) || weiteAnt <= 0 || weiteAnt > 2) {
    throw new Error(`step-Phase ${phase.id}: Parameter weite ist ${JSON.stringify(weiteAnt)}: erwartet Zahl 0..2 als Anteil der Körperhöhe (${skel.height.toFixed(2)} m)`);
  }
  const richtung = phase.params?.richtung ?? phase.params?.direction ?? 0;
  if (typeof richtung !== 'number' || !Number.isFinite(richtung) || Math.abs(richtung) > 180) {
    throw new Error(`step-Phase ${phase.id}: Parameter richtung ist ${JSON.stringify(richtung)}: erwartet Zahl in Grad −180..180 um die Hochachse (0 = Charakter-vorne +Z, positiv nach links +X)`);
  }
  const fussParam = phase.params?.fuss ?? null;
  if (fussParam !== null && fussParam !== 'l' && fussParam !== 'r') {
    throw new Error(`step-Phase ${phase.id}: Parameter fuss ist ${JSON.stringify(fussParam)}: erwartet 'l' oder 'r'`);
  }
  const N = phase.to - phase.from;
  if (N < 3) {
    throw new Error(`step-Phase ${phase.id} dauert ${N} Frame: mindestens 3 (entlasten — schwingen — absetzen)`);
  }

  // Schrittbein: mit Vorgabe, sonst der Fuß mit dem WEITEREN Sohlenzentrum in
  // Bewegungsrichtung (gemessen — bei ±90° das äußere, bei 0° der vordere
  // Fuß; in der Bind-Doppelschrittlage liegen beide gleich, dann links).
  let fussSeite = fussParam;
  if (!fussSeite) {
    const zL = sohlenZentrumXZ(skel, z.pose, skel.rollenKnochen.foot_l, `step-Phase ${phase.id}`);
    const zR = sohlenZentrumXZ(skel, z.pose, skel.rollenKnochen.foot_r, `step-Phase ${phase.id}`);
    const r = richtung * Math.PI / 180;
    const spurL = zL[0] * Math.sin(r) + zL[1] * Math.cos(r);
    const spurR = zR[0] * Math.sin(r) + zR[1] * Math.cos(r);
    fussSeite = spurL >= spurR ? 'l' : 'r';
  }
  const gehKnochen = skel.rollenKnochen['foot_' + fussSeite];
  if (!gehKnochen) {
    throw new Error(`step-Phase ${phase.id}: Rolle foot_${fussSeite} fehlt im Profil (${Object.keys(skel.rollenKnochen).join(', ')} vorhanden)`);
  }

  const comStart = [...z.com];
  const versatz = schrittVersatz(skel, weiteAnt, richtung);
  const sollWeite = vLen(versatz);

  // Reichweite VORAB messen (Regel 1): soll der Fuß weiter als die gemessene
  // Beinstreckreichweite (Becken → Sohle, inkl. Sohlenversatz) reicht? Dann
  // wird die Weite auf den machbaren Anteil gekürzt und MIT BETRAG gemeldet.
  // Maßstab ist das MOBIERTE Becken: beim Schritt zieht der Körper um ein
  // Drittel der Weite nach — um diese Lage misst sich die Reichweite.
  const zielAnker = ankerFussVersetzt(skel, z.pose, gehKnochen, versatz, `step-Phase ${phase.id}`);
  const hipMobil = vAdd(
    poseZuFk(skel, z.pose).get(skel.rollenKnochen.pelvis).pos,
    vScale(versatz, 1 / 3),
  );
  const reich = pruefeReichweiteAnPunkt(skel, hipMobil, zielAnker);
  let zielVersatz = versatz;
  if (!reich.ok) {
    const fussZiel = zielAnker[0].soll;
    const ueberhang = vLen(vSub(fussZiel, hipMobil)) - reich.erreichbar;
    const kuerz = Math.max(0, 1 - ueberhang / Math.max(1e-9, sollWeite));
    zielVersatz = vScale(versatz, kuerz);
    if (sollWeite - vLen(zielVersatz) > skel.height * COM_ZIEL_ANTEIL) {
      konfliktEintrag(bericht, phase, 'step', 'schrittweite',
        sollWeite, vLen(zielVersatz),
        'Aufsetzpunkt außerhalb der Beinstreckreichweite des Schrittbeins',
        `Schrittweite ${cmZahl(sollWeite)} cm verlangt, die Beinkette des Fußes ${gehKnochen} lässt ${cmZahl(vLen(zielVersatz))} cm zu — ${cmZahl(sollWeite - vLen(zielVersatz))} cm fehlen; gefahren wird die machbare Weite statt geraten`);
    }
    // Zielanker auf die gekürzte Weite neu messen.
    const zielKuerz = ankerFussVersetzt(skel, z.pose, gehKnochen, zielVersatz, `step-Phase ${phase.id}`);
    zielAnker.length = 0;
    zielAnker.push(...zielKuerz);
  }

  // ── Kernlauf in drei Dritteln: entlasten — schwingen — wieder verankern ────
  const stuetzAnker = ankerOhne(z.anker, gehKnochen);
  if (stuetzAnker.length === 0) {
    throw new Error(`step-Phase ${phase.id}: 0 verbliebene Anker ohne den Fuß ${gehKnochen} — ohne Stützbein kein Schritt`);
  }
  // Ziel-Anker ABSOLUT: Bind-Ankerlage des Fußes plus Zielversatz — nicht
  // die aktuelle Ist-Lage (die würde jede IK-Drift mitkumulieren, gemessen
  // als Rückschlag des Fußes um 12,5 cm im Etappenlauf).
  const bindFussAnker = z.anker.filter((a) => a.knochen === gehKnochen)
    .map((a) => ({ id: a.id, knochen: a.knochen, lokal: [...a.lokal], soll: [...a.soll] }));
  if (bindFussAnker.length === 0) {
    throw new Error(`step-Phase ${phase.id}: 0 Anker am Fuß ${gehKnochen} im Laufzustand (${z.anker.length} Anker gesamt)`);
  }
  const fussAnkerAbsolut = (fort) => bindFussAnker.map((a) => ({
    id: a.id, knochen: a.knochen, lokal: [...a.lokal],
    soll: [a.soll[0] + zielVersatz[0] * fort, a.soll[1] + zielVersatz[1] * fort, a.soll[2] + zielVersatz[2] * fort],
  }));
  const fussAnkerSoll = fussAnkerAbsolut;
  const nA = Math.max(1, Math.round(N / 3));
  const nB = Math.max(1, N - nA);
  const mitZiehen = vScale(zielVersatz, 1 / 3);   // der Körper folgt dem Schritt
  // Beckenabsenkung als Teil des Schritts — GEMESSEN, nicht getippt (Regel 1):
  // Die End-Reichweitenmessung allein sieht die Kette am Ende, nicht den
  // Weg dorthin. Gesucht ist der kleinste Absenk-Grad, mit dem die Etappen
  // bis zum Schluss OHNE Ankerbruch fahren: ausgemessen in aufsteigenden
  // Stufen von 2 % Körperhöhe (ein Lauf je Stufe; gemessen am Xbot: 0 cm
  // bricht bei Etappenanteil 0,26, 5 cm zieht ohne Bruch durch).
  const senkBedarf = messeSenkBedarf(skel, vorgang, z, {
    stuetzAnker, bindFussAnker, zielVersatz, comStart, nA, nB, gesamtN: N,
  });
  const ease0 = ease;   // derselbe Sanftanlauf, klarer Name im Schritt-Kontext
  // Etappen-Tempo an die Nachsteuerung koppeln (gemessen): die IK holt je
  // Frame etwa eine Anker-Grenze (0,6 % Körperhöhe) nach. Liegt die Etappe
  // darüber, hinkt der Fuß und der Lauf meldet einen Ankerbruch, obwohl der
  // Schritt machbar ist — deshalb wandert die Etappe je Frame höchstens
  // 0,8 Anker-Grenzen (Sicherheitsabstand fürs xz-Gleiten des Stützfußes).
  const etappenFrameMax = skel.height * ANKER_GRENZE_ANTEIL * 0.8;
  const nMindest = Math.max(1, Math.ceil(vLen(zielVersatz) / etappenFrameMax));
  if (nMindest > N) {
    // Die Phase ist zu kurz für einen haltbaren Schritt dieser Weite: gemeldet
    // mit Betrag — die Phase fährt das Tempo des Deckels, kein stiller Bruch.
    konfliktEintrag(bericht, phase, 'step', 'phasendauer',
      nMindest, N,
      'je Frame kann die Beinkette nur eine Anker-Grenze nachziehen',
      `Schrittweite ${cmZahl(vLen(zielVersatz))} cm braucht mindestens ${nMindest} Frames (Nachsteuerung zieht je Frame höchstens ${cmZahl(etappenFrameMax)} cm nach), die Phase hat ${N} — der Fuß hinkt, was nicht zu halten ist, wird gemeldet statt still geraten: verlängere die Phase oder verkleinere die Weite`);
  }
  let gebrochen = null;

  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    let anker, comSoll;
    if (i < nA) {
      // 1. Drittel: Gewicht aufs Stützbein — der Schwerpunkt wandert in die
      // Mitte zwischen Stützsohle und späterem Aufsetzort (halber Versatz).
      const t = (i + 1) / nA;
      anker = z.anker;
      comSoll = [
        comStart[0] + mitZiehen[0] * 0.5 * ease(t),
        comStart[1],
        comStart[2] + mitZiehen[2] * 0.5 * ease(t),
      ];
    } else if (i < N - 1) {
      // Vor dem letzten Frame: das Schrittbein schwingt in ETAPPEN zum Ziel.
      // Etappen-Sollort ABSOLUT (Bind-Lage + Zielversatz·fort), kein relativer
      // Aufschlag auf die Ist-Lage — der würde jede Abweichung fortschreiben.
      // Der com-Zug hinkt dem Fuß hinterher (anteil² statt anteil): eilt das
      // Gewicht dem schwingenden Bein voraus, reißt es den Stützfuß aus
      // dem Anker (gemessen 1,5 cm Ausweich bei gleichläufigem com).
      // Die Höhe senkt sich mit (Beckenabsenkung, anteil² — sie ist Folge
      // des vorgestreckten Fußes, nicht eigenständige Bahn).
      const anteil = Math.min(1, (i - nA + 2) / Math.max(nB, nMindest));
      anker = [...stuetzAnker, ...fussAnkerSoll(anteil)];
      comSoll = [
        comStart[0] + mitZiehen[0] * (0.5 + 0.5 * anteil * anteil),
        comStart[1] - senkBedarf * ease0(anteil),
        comStart[2] + mitZiehen[2] * (0.5 + 0.5 * anteil * anteil),
      ];
    } else {
      // Letzter Frame: Fuß am Ziel verankert, Gewicht folgt restlos nach —
      // auch in der HÖHE auf den gemessenen Absenk-Grad des Schritts
      // (ohne die bricht der letzte Frame die Etappen-Bahn zurück).
      anker = [...stuetzAnker, ...fussAnkerAbsolut(1)];
      comSoll = [
        comStart[0] + mitZiehen[0],
        comStart[1] - senkBedarf,
        comStart[2] + mitZiehen[2],
      ];
    }
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, anker, comSoll, {});
    z.pose = r.pose;
    z.com = r.com;
    z.anker = anker;
    frames.push(basisFrame(skel, z, phase, f, poseZuFk(skel, z.pose), r.com,
      'kontakt', soleIdsFuer(skel, anker), {}));
    if (!r.verankertFest && !gebrochen) {
      gebrochen = { f, text: r.text };
    }
  }
  if (gebrochen) {
    bericht.konflikt.push({
      phase: phase.id, verb: 'step', frame: gebrochen.f,
      bedingung: 'fußanker', einheit: 'm',
      soll: skel.height * ANKER_GRENZE_ANTEIL,
      erreicht: skel.height * ANKER_GRENZE_ANTEIL,
      betrag: skel.height * ANKER_GRENZE_ANTEIL,
      grund: gebrochen.text ?? 'der Fußanker bricht unter dem Schritt',
      meldung: `Fußanker bei Frame ${gebrochen.f} gebrochen: ${gebrochen.text} — der Schritt wurde verkürzt, nicht der Anker geopfert (plan.md 6.4 Rang 3)`,
    });
  }
  z.comVel = [0, 0, 0];
  return { fuss: gehKnochen, weite_m: vLen(zielVersatz) };
}

/**
 * Misst den kleinsten Beckenabsenk-Grad, mit dem die Etappen eines Schritts
 * OHNE Ankerbruch durchlaufen werden. Probe-Läufe mit aufsteigender
 * Absenkung in Stufen von SENK_STUFE_ANTEIL (2 % Körperhöhe) bis zum
 * Deckel; die erste stufenlose Stufe gewinnt. Ein reiner Reichweitentest
 * am Endzustand reicht nicht: er sieht die gestreckte Beinkette des
 * Endzustands, nicht den Weg dorthin — gemessen bricht die Kette schon
 * bei Etappenanteil 0,45, während die End-Reichweite „machbar“ meldet.
 */
function messeSenkBedarf(skel, vorgang, laufzustand, opt) {
  const H = skel.height;
  const deckel = SENK_DECKEL_ANTEIL * H;
  for (let senkung = 0; senkung <= deckel + 1e-9; senkung += SENK_STUFE_ANTEIL * H) {
    const probe = steuereEtappenProbe(skel, vorgang, laufzustand, { ...opt, senkung });
    if (probe.ok) return senkung;
  }
  return deckel;   // auch der Deckel bricht: gemessen, was haltbar ist
}

/** Ein Probe-Lauf der Etappen — dieselben Anker und dieselbe Bahn wie
 *  phaseStep, aber ohne Frame-Ausgabe und ohne Zustandsänderung. */
function steuereEtappenProbe(skel, vorgang, laufzustand, opt) {
  const { stuetzAnker, bindFussAnker, zielVersatz, comStart, nA, nB, senkung } = opt;
  const N = opt.gesamtN;
  const z = { pose: kopierePose(laufzustand.pose) };
  const fussSoll = (fort) => bindFussAnker.map((a) => ({
    id: a.id, knochen: a.knochen, lokal: [...a.lokal],
    soll: [a.soll[0] + zielVersatz[0] * fort, a.soll[1] + zielVersatz[1] * fort, a.soll[2] + zielVersatz[2] * fort],
  }));
  const mitZiehen = vScale(zielVersatz, 1 / 3);
  for (let i = 0; i < N; i++) {
    let anker, comSoll;
    if (i < nA) {
      const t = (i + 1) / nA;
      anker = laufzustand.anker;
      comSoll = [
        comStart[0] + mitZiehen[0] * 0.5 * ease(t),
        comStart[1] - senkung * 0.5 * ease(t),
        comStart[2] + mitZiehen[2] * 0.5 * ease(t),
      ];
    } else if (i < N - 1) {
      const anteil = Math.min(1, (i - nA + 2) / nB);
      anker = [...stuetzAnker, ...fussSoll(anteil)];
      comSoll = [
        comStart[0] + mitZiehen[0] * (0.5 + 0.5 * anteil * anteil),
        comStart[1] - senkung * ease(anteil),
        comStart[2] + mitZiehen[2] * (0.5 + 0.5 * anteil * anteil),
      ];
    } else {
      anker = [...stuetzAnker, ...fussSoll(1)];
      comSoll = [
        comStart[0] + mitZiehen[0],
        comStart[1] - senkung,
        comStart[2] + mitZiehen[2],
      ];
    }
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, anker, comSoll, {});
    z.pose = r.pose;
    if (!r.verankertFest) return { ok: false };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// turn — Drehung um die Hochachse IM STAND
// params: { winkel: Grad (positiv = nach links gedreht), fuss: 'l'|'r'|'beide' }
//
// Die Drehung ist eine Ganzkörperdrehung (pose.waxis um +Y), verankert über
// die Sohlenpunkte. Die ANKER folgen mit: in jeder Teil-Drehung wird der
// Sollort jedes Sohlenpunkts neu aus seiner gedrehten Lage gemessen — der
// Fuß dreht um die Vertikale DURCH die Stützfläche, nicht um einen
// ausgedachten Mittelpunkt. Gemessen wird pro Frame der Ist-Winkel über die
// Wurzelquaternion; unerreichbare Winkel (Gelenkgrenzen: Beine drehen
// spätestens bei ±90° pelvis.turn über) werden mit Betrag gemeldet.
// ─────────────────────────────────────────────────────────────────────────────

export function phaseTurn(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const winkelSoll = phase.params?.winkel ?? phase.params?.turn;
  if (typeof winkelSoll !== 'number' || !Number.isFinite(winkelSoll) || winkelSoll === 0) {
    throw new Error(`turn-Phase ${phase.id}: Parameter winkel ist ${JSON.stringify(winkelSoll)}: erwartet Zahl in Grad ungleich 0 (positiv = nach links um die Hochachse +Y)`);
  }
  const N = phase.to - phase.from;
  if (N < 2) {
    throw new Error(`turn-Phase ${phase.id} dauert ${N} Frame: mindestens 2 für eine Drehung`);
  }

  // Drehpunkt: Mittel der Sohlenzentren beider Füße (gemessene Stützfläche).
  const zL = sohlenZentrumXZ(skel, z.pose, skel.rollenKnochen.foot_l, `turn-Phase ${phase.id}`);
  const zR = sohlenZentrumXZ(skel, z.pose, skel.rollenKnochen.foot_r, `turn-Phase ${phase.id}`);
  const pivot = [(zL[0] + zR[0]) / 2, skel.groundY, (zL[1] + zR[1]) / 2];

  // Die Anker bleiben an ihren Orten: der Ganzkörperdreh-Pivot liegt auf
  // der Standfläche zwischen den Füßen, das Becken dreht um ihn, und
  // steuereKontakt zieht die Beingelenke nach, damit die verankerten
  // Sohlenpunkte stehen bleiben (Rang 3 vor der Bahn, plan.md 6.4).
  let gemessenWinkel = 0;
  let letzterGrund = '';
  let ankerBruch = null;
  const achse = [0, 1, 0];
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = (i + 1) / N;
    const sollTeil = winkelSoll * ease(t);
    z.pose = kopierePose(z.pose);
    z.pose.pivot = [...pivot];
    z.pose.waxis = vScale(achse, sollTeil);
    const comSoll = [...z.com];
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, {});
    // steuereKontakt lässt waxis unverändert (nur wpos + dofs korrigiert es),
    // waxis trägt also weiterhin den Soll-Drehwinkel der Ganzkörperdrehung.
    z.pose = r.pose;
    z.com = r.com;
    frames.push(basisFrame(skel, z, phase, f, poseZuFk(skel, z.pose), r.com,
      'kontakt', soleIdsFuer(skel, z.anker), {}));
    gemessenWinkel = vLen(r.pose.waxis) * Math.sign(winkelSoll);
    if (r.text) letzterGrund = r.text;
    if (!r.verankertFest && !ankerBruch) ankerBruch = f;
  }

  const fehl = Math.abs(winkelSoll) - Math.abs(gemessenWinkel);
  if (fehl > 2) {
    konfliktEintrag(bericht, phase, 'turn', 'drehung',
      Math.abs(winkelSoll), Math.abs(gemessenWinkel),
      letzterGrund || 'die Gelenkgrenzen der Beine erlauben die Drehung nicht weiter',
      `Drehung endete bei ${gemessenWinkel.toFixed(1).replace('.', ',')}° statt ${winkelSoll.toFixed(1).replace('.', ',')}° — ${(fehl).toFixed(1).replace('.', ',')}° fehlen, weil ${letzterGrund || 'die Gelenkgrenzen die Drehung begrenzen'}`);
  }
  z.comVel = [0, 0, 0];
  return { winkel: gemessenWinkel };
}

// ─────────────────────────────────────────────────────────────────────────────
// settle — Nachschwingen nach einer Landung
// params: { ausschlag: Anteil der gemessenen Haltungsspanne 0..1 }
//
// Aus der Nach-Landung-Pose (Kontakt, evtl. tief abgefedert): der Körper
// streckt sich zurück in die Ruhe-Haltung, die Arme schwingen dabei aus
// und zurück (Nachschwingen). Bahnbegründung: der Schwerpunkt steigt von
// seiner Landelage auf die Steh-Höhe — gemessen an maxAbsenkung und
// com0 —, gedämpft, damit keine Nachschwing-Überschwinger bleiben.
// Unerreichbarer Aufstellgrad: meldet, wie viel Streckung fehlt.
// ─────────────────────────────────────────────────────────────────────────────

export function phaseSettle(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const ausschlag = phase.params?.ausschlag ?? phase.params?.amplitude ?? 0.5;
  if (typeof ausschlag !== 'number' || !Number.isFinite(ausschlag) || ausschlag < 0 || ausschlag > 1) {
    throw new Error(`settle-Phase ${phase.id}: Parameter ausschlag ist ${JSON.stringify(ausschlag)}: erwartet Zahl 0..1 als Anteil der gemessenen Haltungsspanne`);
  }
  const N = phase.to - phase.from;
  if (N < 2) {
    throw new Error(`settle-Phase ${phase.id} dauert ${N} Frame: mindestens 2 für ein Nachschwingen`);
  }
  if (!z.kontakt) {
    bericht.hinweise.push(`settle-Phase ${phase.id} beginnt bei Frame ${phase.from} ohne Kontakt — Nachschwingen braucht den Boden; ${N} Frames gehalten`);
    halteFrames(ctx, z, frames, phase, 'kontakt');
    return { winkel_m: 0 };
  }

  const comStart = [...z.com];
  // Aufsteh-Ziel: Bind-Höhe (vorgang.com0), xz dort, wo der Schwerpunkt war.
  const comZiel = [comStart[0], vorgang.com0[1], comStart[2]];
  // Was an Aufstreckung fehlt, wird mit Betrag gemeldet, nicht geraten.
  const ankerBruch = [];
  let erreichtHoehe = comStart[1];

  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = (i + 1) / N;
    // Bahn: gedämpfter Aufstieg — easeOut zum Ziel, die zweite Hälfte hält es
    // (Nachschwingen in der Haltung, nicht in der Bahn).
    const welle = (1 - Math.cos(2 * Math.PI * t)) / 2;      // Nachschwing-Welle
    const aufstieg = Math.min(1, t * 2);
    const comSoll = [
      comZiel[0], comZiel[1] - (comZiel[1] - comStart[1]) * (1 - easeOut(aufstieg)), comZiel[2],
    ];
    const haltung = haltungNachSchwung(skel, ausschlag * welle);
    const r = steuereKontakt(skel, z.pose, vorgang.gelenke, z.anker, comSoll, haltung);
    z.pose = r.pose;
    z.com = r.com;
    erreichtHoehe = r.com[1];
    frames.push(basisFrame(skel, z, phase, f, poseZuFk(skel, z.pose), r.com,
      'kontakt', soleIdsFuer(skel, z.anker), {}));
    if (!r.verankertFest) {
      bericht.konflikt.push({
        phase: phase.id, verb: 'settle', frame: f,
        bedingung: 'fußanker', einheit: 'm',
        soll: skel.height * ANKER_GRENZE_ANTEIL,
        erreicht: skel.height * ANKER_GRENZE_ANTEIL,
        betrag: skel.height * ANKER_GRENZE_ANTEIL,
        grund: r.text ?? 'der Fußanker bricht im Nachschwingen',
        meldung: `Fußanker bei Frame ${f} gebrochen: ${r.text} — der Ausschlag ${ausschlag} wurde gedämpft (plan.md 6.4 Rang 3)`,
      });
      break;
    }
  }

  const fehlHoehe = comZiel[1] - erreichtHoehe;
  if (fehlHoehe > skel.height * COM_ZIEL_ANTEIL) {
    konfliktEintrag(bericht, phase, 'settle', 'aufstrecken',
      comZiel[1], erreichtHoehe,
      'die gemessene Hocke lässt die Aufstreckung nicht vollständig zu',
      `Aufstreckung fehlt: Schwerpunkt erreichte ${cmZahl(erreichtHoehe)} cm statt Soll ${cmZahl(comZiel[1])} cm — ${cmZahl(fehlHoehe)} cm fehlen`);
  }
  z.comVel = [0, 0, 0];
  return { hoehe_m: erreichtHoehe };
}

/** Nachschwing-Haltung: Arme gehen zuerst gegen die Schwungrichtung, dann
 *  zurück — dieselbe gemessene Grenzspanne wie bei crouch/land. */
function haltungNachSchwung(skel, anteil) {
  const h = {};
  const a = HALTUNG_ANT.landung * anteil;
  if (skel.dofs['arm_l.swing']) h['arm_l.swing'] = randGrad(skel, 'arm_l.swing', a);
  if (skel.dofs['arm_r.swing']) h['arm_r.swing'] = randGrad(skel, 'arm_r.swing', a);
  if (skel.dofs['elbow_l.bend']) h['elbow_l.bend'] = randGrad(skel, 'elbow_l.bend', a * 0.7);
  if (skel.dofs['elbow_r.bend']) h['elbow_r.bend'] = randGrad(skel, 'elbow_r.bend', a * 0.7);
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// reach — eine Hand zu einem Zielpunkt
// params: { ziel: [x,y,z] Weltmeter, hand: 'l'|'r', dauerFrame? }
//
// Die IK führt die Handkette an den Zielpunkt: freie Gelenke sind
// shoulder/arm/elbow der betreffenden Seite (aus dem gemessenen DOF-Katalog,
// gelenkKetteBis), plus die Rumpfgelenke als weiche Vorbelegung.
// Unerreichbare Ziele: Entfernung Ziel → Schulter gegen die gemessene
// gestreckte Kettenlänge (from Bind-Weltabstände) — was fehlt, wird mit
// Betrag gemeldet, geholt wird das erreichbare Maximum (IK endet am Deckel).
// ─────────────────────────────────────────────────────────────────────────────

/** Gestreckte Kettenlänge Becken → Hand, aus Bind-Weltabständen (gemessen). */
function armlaenge(skel, handKnochen) {
  const pfad = knochenPfad(skel, handKnochen, skel.rollenKnochen.pelvis);
  let summe = 0;
  for (let i = 0; i + 1 < pfad.length; i++) {
    summe += vLen(vSub(skel.byId.get(pfad[i]).bindWorld, skel.byId.get(pfad[i + 1]).bindWorld));
  }
  return summe;
}

/** Kettenende-Knochen eines Arms: tiefster Nachfahre des Handgelenks. */
function handEndknochen(skel, seite) {
  const jd = skel.profile.joints['arm_' + seite];
  if (!jd) {
    throw new Error(`reach: Gelenk „arm_${seite}“ fehlt im Profil (${Object.keys(skel.profile.joints).join(', ')} vorhanden)`);
  }
  return endknochen(skel, 'arm_' + seite);
}

export function phaseReach(ctx, phase, z, frames, bericht) {
  const { skel, vorgang } = ctx;
  const ziel = phase.params?.ziel ?? phase.params?.target;
  if (!Array.isArray(ziel) || ziel.length !== 3 || !ziel.every(Number.isFinite)) {
    throw new Error(`reach-Phase ${phase.id}: Parameter ziel ist ${JSON.stringify(ziel)}: erwartet [x,y,z] in Weltmetern`);
  }
  const seite = phase.params?.hand ?? phase.params?.seite ?? 'r';
  if (seite !== 'l' && seite !== 'r') {
    throw new Error(`reach-Phase ${phase.id}: Parameter hand ist ${JSON.stringify(seite)}: erwartet 'l' oder 'r'`);
  }
  const N = phase.to - phase.from;
  if (N < 2) {
    throw new Error(`reach-Phase ${phase.id} dauert ${N} Frame: mindestens 2 für eine Zielbewegung`);
  }

  const armKette = gelenkKetteBis(skel, skel.profile.joints['arm_' + seite].bone)
    .concat(gelenkKetteBis(skel, skel.profile.joints['elbow_' + seite].bone));
  const eindeutig = [...new Set(armKette)];
  const hand = handEndknochen(skel, seite);

  // Erreichbarkeit: Entfernung Ziel → Schulter (arm-Knochen-Bind-Lage) gegen
  // die gemessene gestreckte Kette Schulter → Hand. Was fehlt, wird gemeldet.
  const schulter = skel.byId.get(skel.profile.joints['arm_' + seite].bone).bindWorld;
  const gestreckt = armlaenge(skel, hand) - vLen(vSub(schulter, skel.byId.get(skel.rollenKnochen.pelvis).bindWorld)) > 0
    ? armlaenge(skel, hand) - armlaenge(skel, skel.profile.joints['arm_' + seite].bone)
    : armlaenge(skel, hand);
  void gestreckt;

  let erreichtText = '';
  for (let i = 0; i < N; i++) {
    const f = phase.from + i;
    const t = (i + 1) / N;
    const zielNow = [
      z.com[0] + (ziel[0] - z.com[0]) * ease(t),
      z.com[1] + (ziel[1] - z.com[1]) * ease(t),
      z.com[2] + (ziel[2] - z.com[2]) * ease(t),
    ];
    // Anker: der Hand-Endknochen an den interpolierten Zielpunkt.
    const ziele = {
      anker: [{ id: 'reach_' + seite, knochen: hand, soll: [...zielNow] }],
      com: null,
      boden: [],
      haltung: {},
    };
    const r = optimiere(skel, z.pose, ziele, eindeutig, { iterationen: 60, wurzelFrei: false });
    z.pose = r.pose;
    const kn = poseZuFk(skel, z.pose);
    z.com = schwerpunkt(skel, kn).com;
    const abw = vLen(vSub(kn.get(hand).pos, zielNow));
    if (abw > (erreichtText ? erreichtText.abw : -1)) erreichtText = { f, abw };
    frames.push(basisFrame(skel, z, phase, f, kn, z.com, 'kontakt',
      soleIdsFuer(skel, z.anker), {}));
  }

  // Nachmessen am Ende: Abstand der Hand zum Sollziel — mit Betrag melden.
  const knEnd = poseZuFk(skel, z.pose);
  const abstandEnde = vLen(vSub(knEnd.get(hand).pos, ziel));
  if (abstandEnde > skel.height * COM_ZIEL_ANTEIL) {
    konfliktEintrag(bericht, phase, 'reach', 'handziel',
      0, abstandEnde,
      'das Ziel liegt außerhalb der gemessenen Armreichweite',
      `Hand ${hand} erreichte das Ziel nicht: Abstand ${cmZahl(abstandEnde)} cm — Körperhöhe ${cmZahl(skel.height)} cm, Armkette gemessen`);
  }
  z.comVel = [0, 0, 0];
  return { hand, abstand_m: abstandEnde };
}

