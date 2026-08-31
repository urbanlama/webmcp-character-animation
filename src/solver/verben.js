// AP5 — Phasenlöser: die vier Verben crouch, takeoff, airborne, land.
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

import { schwerpunkt, sohlenWelt, traegheit, vAdd, vSub, vScale, vLen, qFromAxisAngle } from './kinematik.js';
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
