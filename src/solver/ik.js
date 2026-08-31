// AP5 — Phasenlöser: numerische Gelenkoptimierung mit harten Grenzen.
//
// Warum numerisch und nicht analytisch (gemessen, nicht vermutet):
// Die Vermessung von Xbot.glb mit src/rig/measure.js ergibt, daß die
// Buchstaben der Freiheitsgrade im AP2-Katalog NICHT den Weltachsen ihrer
// Wirkung folgen. Am geladenen Modell nachgemessen (Bind-Pose, +30°):
//
//   hip_l.flex   (Achse 'z')  bewegt den Sprunggelenks-Punkt um +41 cm nach  X
//   hip_l.spread (Achse 'x')  bewegt ihn um 41 cm nach -Z und 13 cm nach  Y
//   knee_l.bend  (Achse 'z')  bewegt ihn um +27 cm nach  X und 22 cm nach  Y
//
// Wer daraus eine analytische Kniebeugung in der Sagittalebene ableitet, baut
// Bewegung auf beschriftete Achsen statt auf gemessene. Dieser Löser kennt nur
// die gemessene Forward-Kinematik aus ./kinematik.js und fragt sie pro Schritt:
// „Welche Gelenkwerte bringen den Fuß-Anker und den Schwerpunkt an ihren Ort?"
//
// Rangfolge aus plan.md 6.4, als Gewichte — Gelenkgrenzen sind HART (Clamping,
// nie verletzt), danach fällt die Weichheit:
//   Boden  (gw 400) > Fußanker (gw 100) > Orientierung/Regularisierung (gw 4)
//   > Schwerpunktbahn (gw 1)
// Was geopfert wurde, steht nach der Lösung mit BETRAG im Bericht.
//
// Alle Toleranzen relativ zur Körperhöhe (AGENTS.md, Regel: keine absoluten
// Zentimeter in Schwellen).

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

import { poseKnochen, schwerpunkt, vAdd, vSub, vScale, vLen, qRot, qFromAxisAngle } from './kinematik.js';

/** Gewichte der Zielbedingungen — Verhältnis folgt der Rangfolge plan.md 6.4. */
export const GEWICHT = {
  boden: 400,
  anker: 100,
  haltung: 4,
  schwerpunkt: 1,
};

/** Schrittweite der numerischen Ableitung je Gelenk, in Grad. 0,4° ist klein
 *  gegenüber der engsten Gelenkgrenze (2°) und groß gegenüber der
 *  Double-Genauigkeit der FK. */
export const SCHRITT_GRAD = 0.4;

/** Schrittweite der numerischen Ableitung der Wurzelverschiebung, in Meter. */
export const SCHRITT_METER = 5e-4;

/** Vertrauensbereich pro Iteration, Grad je Gelenk / Meter je Wurzel. */
export const SCHRANK_GRAD = 8;
export const SCHRANK_METER = 0.05;

/**Iterationsdeckel. Erreicht die Optimierung ihn, ist das Ergebnis trotzdem
 *  brauchbar — die Restfehler werden berichtet, nicht verschluckt. */
export const ITERATIONEN = 60;

/** Dämpfung der kleinsten-Quadrate-Schrittgleichung (Levenberg-Marquardt). */
export const DAEMPfung = 1e-3;

/** Abbruch, wenn die Bewegung unter dieser Änderung liegt: 1e-7 — die
 *  Kriterien sind in Meter und Grad angegeben, das ist Rauschen. */
export const RUHE_SCHWELLE = 1e-7;

/** Anteil der Körperhöhe, unter dem ein Fußanker als „steht" gilt. */
export const ANKER_TOLERANZ_ANTEIL = 0.004;

/** Anteil der Körperhöhe, den der Schwerpunkt seine Sollbahn verfehlen darf,
 *  bevor gemeldet wird. */
export const COM_TOLERANZ_ANTEIL = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// Pose-Werk
// ─────────────────────────────────────────────────────────────────────────────

/** Tiefe Kopie einer Pose. */
export function kopierePose(p) {
  return { wpos: [...p.wpos], waxis: [...p.waxis], pivot: [...(p.pivot ?? [0, 0, 0])], dofs: { ...p.dofs } };
}

/** Pose aus der Bind-Pose: alles Null, Wurzel auf gemessener Bind-Position. */
export function bindPose(skel) {
  const pelvis = skel.rollenKnochen.pelvis;
  if (!pelvis || !skel.byId.has(pelvis)) {
    throw new Error(`Bind-Startpose nicht bildbar: Rollen-Knochen „${pelvis}“ fehlt in ${skel.order.length} Knochen`);
  }
  const p0 = skel.byId.get(pelvis).wPos;
  return { wpos: [...p0], waxis: [0, 0, 0], pivot: [...p0], dofs: {} };
}

/**
 * Rechnet eine Pose in die Darstellung der Forward-Kinematik um.
 *
 * pose = {
 *   wpos:  [x,y,z]   gewünschte Weltposition des Beckens in Metern
 *   waxis: [x,y,z]   Ganzkörperdrehung als axis-winkel (Grad) um pose.pivot
 *   pivot: [x,y,z]   Drehpunkt der Ganzkörperdrehung (im Flug: der Schwerpunkt)
 *   dofs:  {schlüssel: grad}
 * }
 */
export function poseZuFk(skel, pose) {
  const p0 = skel.byId.get(skel.rollenKnochen.pelvis).wPos;
  const weg = vLen(pose.waxis);
  const d = vSub(pose.wpos, p0);
  const dreht = weg > 1e-12;
  if (!dreht && vLen(d) < 1e-15) {
    return poseKnochen(skel, { dofs: pose.dofs });
  }
  return poseKnochen(skel, {
    dofs: pose.dofs,
    delta: {
      pos: d,
      q: dreht ? qFromAxisAngle(pose.waxis, weg * Math.PI / 180) : [0, 0, 0, 1],
      pivot: pose.pivot ?? p0,
    },
  });
}

/** Weltquaternion eines Knochens aus einer Pose (für den solved-Report). */
export function gelenkQuat(kn, skel, gelenkName) {
  const j = skel.profile.joints[gelenkName];
  if (!j) {
    throw new Error(`Gelenk „${gelenkName}“ nicht im Profil (${Object.keys(skel.profile.joints).length} Gelenke durchsucht)`);
  }
  const b = kn.get(j.bone);
  if (!b) {
    throw new Error(`Gelenk „${gelenkName}“ verweist auf Knochen „${j.bone}“, nicht in ${kn.size} gelösten Knochen`);
  }
  return b.quat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Restfehler und Jacobiler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Einmal Restvektor und Jacobiler.
 *
 * ziele = {
 *   anker:   [{knochen, soll, id}],             // Fußanker, Welt Meter
 *   com:     {soll} | null,                     // Schwerpunktbahn
 *   boden:   [{knochen}] ,                      // diese Knochen nicht unter groundY
 *   haltung: {name: wert}                       // weiche Gelenkvorzugaben in Grad
 * }
 *
 * Rückgabe { rueck, pose, fehler }:
 *   rueck: Array von {art, teil, vektor:[...], gewicht}
 *   fehler: { anker: [{id, teil, betrag_m, soll, ist}], com_betrag_m,
 *             boden: [{teil, tiefe_m}], an_grenze: [{key, grenze, wert}] }
 */
/**
 * Weltpunkt eines Ankers. Ein Anker ohne `lokal` meint den Knochenursprung;
 * mit `lokal` einen knochenfesten Punkt (Sohlenpunkte aus dem Profil stehen
 * in Knochen-lokalen Einheiten, deshalb der Weltmaßstab des Knochens —
 * dieselbe Rechnung wie sohlenWelt in ./kinematik.js).
 */
export function ankerPunkt(skel, kn, a) {
  const b = kn.get(a.knochen);
  if (!b) {
    throw new Error(`Ankerziel „${a.id ?? a.knochen}“: Knochen „${a.knochen}“ nicht in ${kn.size} gelösten`);
  }
  if (!a.lokal) return b.pos;
  const stab = skel.byId.get(a.knochen).weltmassstab ?? 1;
  return vAdd(b.pos, vScale(qRot(b.quat, a.lokal), stab));
}

export function restvektor(skel, pose, ziele, gelenke) {
  const kn = poseZuFk(skel, pose);
  const r = [];
  const bodenTol = skel.height * 0.01;

  for (const a of ziele.anker) {
    const p = ankerPunkt(skel, kn, a);
    r.push({ art: 'anker', teil: a.id ?? a.knochen, vektor: vSub(p, a.soll), gewicht: GEWICHT.anker });
  }
  if (ziele.com) {
    const { com } = schwerpunkt(skel, kn);
    r.push({ art: 'com', teil: 'schwerpunkt', vektor: vSub(com, ziele.com.soll), gewicht: GEWICHT.schwerpunkt });
  }
  for (const b of ziele.boden) {
    const p = kn.get(b.knochen);
    if (!p) throw new Error(`Bodenziel: Knochen „${b.knochen}“ nicht in ${kn.size} gelösten`);
    const tiefe = (skel.groundY + bodenTol) - p.pos[1];
    if (tiefe > 0) r.push({ art: 'boden', teil: b.knochen, vektor: [0, -tiefe, 0], gewicht: GEWICHT.boden });
  }
  for (const [name, wert] of Object.entries(ziele.haltung ?? {})) {
    const d = skel.dofs[name];
    if (!d) continue;
    const ist = pose.dofs[name] ?? 0;
    r.push({ art: 'haltung', teil: name, vektor: [ist - wert], gewicht: GEWICHT.haltung });
  }
  void gelenke;
  return { r, kn };
}

/** Flacht den Restvektor (Arrays unterschiedlicher Länge) zu einer Zahlenspur. */
function flach(r) {
  const out = [];
  for (const e of r) for (const v of e.vektor) out.push(v * e.gewicht);
  return out;
}

/**
 * Damped-least-squares Optimierung einer Pose gegen die Zielbedingungen.
 *
 * @param {object} skel     Skelett aus ./kinematik.js
 * @param {object} pose0    Startpose {wpos, waxis, pivot, dofs}
 * @param {object} ziele    siehe restvektor
 * @param {string[]} gelenke freie Gelenkschlüssel ("hip_l.flex")
 * @param {object} [opt]    {wurzelFrei: true|false, iterationen}
 * @returns {{pose, fehler, iterationen, abgebrochen}}
 */
export function optimiere(skel, pose0, ziele, gelenke, opt = {}) {
  const wurzelFrei = opt.wurzelFrei !== false;
  const maxIt = opt.iterationen ?? ITERATIONEN;
  const pose = kopierePose(pose0);
  const offset = wurzelFrei ? 3 : 0;
  const n = offset + gelenke.length;

  // Grenzwerte je Variable: Gelenke hart auf Profilgrenze (Rang 1, plan.md 6.4).
  const grenzen = gelenke.map((k) => {
    const d = skel.dofs[k];
    if (!d) throw new Error(`Freies Gelenk „${k}“ nicht im Profil (${Object.keys(skel.dofs).length} Freiheitsgrade bekannt)`);
    return d.grenze;
  });

  let iterationen = 0;
  let abgebrochen = false;
  for (; iterationen < maxIt; iterationen++) {
    const { r } = restvektor(skel, pose, ziele, gelenke);
    const f0 = flach(r);
    if (f0.length === 0 || n === 0) break;

    // Jacobiler durch zentrale Differenz — die einzig mögliche Ableitung,
    // wenn die Wirkung der Achsen nur aus der FK-Messung bekannt ist.
    const jac = new Array(f0.length * n).fill(0);
    for (let i = 0; i < n; i++) {
      const plus = kopierePose(pose), minus = kopierePose(pose);
      let h;
      if (i < offset) {
        h = SCHRITT_METER;
        plus.wpos[i] += h; minus.wpos[i] -= h;
      } else {
        const k = gelenke[i - offset];
        h = SCHRITT_GRAD;
        plus.dofs[k] = (plus.dofs[k] ?? 0) + h;
        minus.dofs[k] = (minus.dofs[k] ?? 0) - h;
      }
      const rp = flach(restvektor(skel, plus, ziele, gelenke).r);
      const rm = flach(restvektor(skel, minus, ziele, gelenke).r);
      for (let j = 0; j < f0.length; j++) jac[j * n + i] = (rp[j] - rm[j]) / (2 * h);
    }

    // (JᵀJ + λI) δ = −Jᵀf — gaußsche Elimination; n ≤ 30.
    const jtf = new Array(n).fill(0);
    const jtj = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < f0.length; k++) s += jac[k * n + i] * jac[k * n + j];
        jtj[i * n + j] = s;
      }
      let s = 0;
      for (let k = 0; k < f0.length; k++) s += jac[k * n + i] * f0[k];
      jtf[i] = s;
    }
    for (let i = 0; i < n; i++) jtj[i * n + i] += DAEMPfung;
    const delta = loeseGleichungsjystem(jtj, jtf.map((v) => -v));
    if (!delta) { abgebrochen = true; break; }

    // Schritt begrenzen, Gelenke hart klemmen — in Einheiten der Variablen.
    const beg = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let bewegung = 0;
    for (let i = 0; i < offset; i++) {
      const d = beg(delta[i], -SCHRANK_METER, SCHRANK_METER);
      pose.wpos[i] += d;
      bewegung = Math.max(bewegung, Math.abs(d) / SCHRANK_METER);
    }
    gelenke.forEach((k, gi) => {
      const idx = offset + gi;
      const alt = pose.dofs[k] ?? 0;
      const d = beg(delta[idx], -SCHRANK_GRAD, SCHRANK_GRAD);
      const neu = beg(alt + d, grenzen[gi][0], grenzen[gi][1]);
      pose.dofs[k] = neu;
      bewegung = Math.max(bewegung, Math.abs(neu - alt) / SCHRANK_GRAD);
    });
    if (bewegung < RUHE_SCHWELLE) break;
  }

  return { pose, fehler: vermessen(skel, pose, ziele, gelenke), iterationen, abgebrochen };
}

/** Gaußsche Elimination mit Partial Pivot — n bis ~30. */
function loeseGleichungsjystem(A, b) {
  const n = b.length;
  const M = A.slice();
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * n + col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-14) return null;
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = M[col * n + c]; M[col * n + c] = M[piv * n + c]; M[piv * n + c] = t;
      }
      const t = b[col]; b[col] = b[piv]; b[piv] = t;
    }
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / M[col * n + col];
      if (!f) continue;
      for (let c = col; c < n; c++) M[r * n + c] -= f * M[col * n + c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= M[r * n + c] * x[c];
    x[r] = s / M[r * n + r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

/**
 * Nachmessen statt behaupten: welche Zielbedingungen hat die gefundene Pose
 * tatsächlich erfüllt? Alles in Meter bzw. Grad, mit Soll und Ist.
 */
export function vermessen(skel, pose, ziele, gelenke) {
  const kn = poseZuFk(skel, pose);
  const { com } = schwerpunkt(skel, kn);
  const out = { anker: [], com_betrag_m: 0, com_soll: null, com_ist: com, boden: [], an_grenze: [], haltung: [] };

  for (const a of ziele.anker) {
    const p = ankerPunkt(skel, kn, a);
    const b = vLen(vSub(p, a.soll));
    if (b > skel.height * ANKER_TOLERANZ_ANTEIL) {
      out.anker.push({ id: a.id ?? a.knochen, teil: a.id ?? a.knochen, betrag_m: b, soll: a.soll, ist: [...p] });
    }
  }
  if (ziele.com) {
    out.com_soll = ziele.com.soll;
    out.com_betrag_m = vLen(vSub(com, ziele.com.soll));
  }
  const bodenTol = skel.height * 0.01;
  for (const b of ziele.boden) {
    const p = kn.get(b.knochen);
    const tiefe = (skel.groundY + bodenTol) - p.pos[1];
    if (tiefe > 0) out.boden.push({ teil: b.knochen, tiefe_m: tiefe });
  }
  for (const k of gelenke) {
    const d = skel.dofs[k];
    const v = pose.dofs[k] ?? 0;
    if (Math.abs(v - d.grenze[0]) < 1e-6 || Math.abs(v - d.grenze[1]) < 1e-6) {
      out.an_grenze.push({ key: k, wert: v, grenze: v > 0 ? d.grenze[1] : d.grenze[0] });
    }
  }
  for (const [name, wert] of Object.entries(ziele.haltung ?? {})) {
    const ist = pose.dofs[name] ?? 0;
    if (Math.abs(ist - wert) > 1) out.haltung.push({ key: name, soll: wert, ist });
  }
  return out;
}

/**
 * Gelenksatz der Beingelenkkette, aus dem Profil abgeleitet statt geraten:
 * alle Freiheitsgrade der Knochen auf dem Weg Fuß → Becken einschließlich des
 * Fußknochens (Sprunggelenk), ohne den Beckenknochen selbst
 * (Ganzkörperdrehung ist Wurzelvariable) und ohne Zehenknochen.
 *
 * Warum das Sprunggelenk frei sein MUSS: verankert sind die gemessenen
 * Sohlenpunkte des Profils, nicht der Fußursprung. Bleibt das Sprunggelenk
 * starr, kippt die Sohle beim Beugen mit dem Unterschenkel — am Xbot sackte
 * mixamorigLeftToe_End dabei 28,6 cm unter den Boden, und der Löser verwarf
 * jeden Absenkschritt (gemessen, Grund für diesen Zuschnitt).
 */
export function gelenkKette(skel, fussKnochenIds) {
  const { rollenKnochen } = skel;
  const pelvis = rollenKnochen.pelvis;
  const inKette = new Set();
  for (const fid of fussKnochenIds) {
    if (!skel.byId.has(fid)) {
      throw new Error(`Beingelenkkette: Fußknochen „${fid}“ nicht unter ${skel.order.length} Knochen gefunden`);
    }
    const pfad = [fid];
    let cur = skel.byId.get(fid);
    while (cur && cur.id !== pelvis && cur.parent && skel.byId.has(cur.parent)) {
      cur = skel.byId.get(cur.parent);
      pfad.push(cur.id);
    }
    if (!cur || cur.id !== pelvis) {
      throw new Error(`Beingelenkkette: Weg von „${fid}“ führt über ${pfad.length} Knochen nicht zum Becken „${pelvis}“`);
    }
    // Der Fußknochen (Index 0) gehört DAZU: verankert sind die gemessenen
    // Sohlenpunkte, nicht der Knochenursprung — ohne freies Sprunggelenk
    // müsste die Sohle mit dem Unterschenkel mitkippen und der Zeh sackt
    // durch den Boden. Das Becken (letzter) bleibt außen vor: seine Lage
    // ist Wurzelvariable.
    for (let i = 0; i + 1 < pfad.length; i++) inKette.add(pfad[i]);
  }
  return Object.keys(skel.dofs).filter((k) => inKette.has(skel.dofs[k].bone));
}
