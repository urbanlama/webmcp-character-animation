// AP2 — Rig-Vermessung. Misst aus einem geladenen glTF/GLB-Modell ein RigProfile
// im Format aus docs/plan.md Abschnitt 5.1.
//
// Grundregel (AGENTS.md, Regel 1): Körpermaße werden GEMESSEN, nie getippt.
// Radien, Massen, Kontaktpunkte, Gelenkachsen, Blickrichtung — alles aus der
// Bind-Pose des geladenen Modells. Die einzigen getippten Zahlen sind
// Verfahrensparameter; sie stehen als BENANNTE PARAMETER an EINER Stelle unten,
// mit Begründung, und werden im RigProfile unter "params" ausgegeben.
//
// Import (Grundsatz aus vendor/README.md): three.js und der GLTFLoader kommen
// aus node_modules (npm r180) — derselbe Build wie vendor/. Der Alias
// 'three/addons/loaders/GLTFLoader.js' liefert dieselbe Datei wie
// vendor/GLTFLoader.js; fällt der Alias weg, ist die Datei zusätzlich im Repo
// unter ../../spikes/test-b-motion/assets/GLTFLoader.js && vendor/ abgelegt.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// plan.md Kapitel 4: alle Verfahrensparameter stehen an EINER Stelle, mit
// Begründung, und werden im RigProfile unter "params" ausgegeben.
// ─────────────────────────────────────────────────────────────────────────────

/** Radiusperzentil. plan.md: 0,80 unterschätzt die Körperbreite, 1,00 fängt Ausreißer. */
export const RADIUS_PERCENTILE = 0.90;

/** Sohlentoleranz als Anteil der Körperhöhe. plan.md: muss Modelle erfassen,
 *  die auf dem Ballen stehen. */
export const SOLE_TOLERANCE = 0.035;

/** Kontaktzuschlag in Metern über dem höchsten Sohlenpunkt. plan.md Kapitel 4. */
export const CONTACT_MARGIN = 0.015;

/** Abtastwinkel in Grad für die Vorzeichenmessung (plan.md 3.5): groß genug
 *  für messbare Wirkung am Kettenende, klein genug ohne Überschlag. */
export const PROBE_DEG = 20;

/** Minimal-Skin-Gewicht, ab dem ein Vertex seinem dominanten Knochen zugerechnet
 *  wird. 0,5 heißt: mehr als die Hälfte der Hautwirkung liegt bei diesem Knochen. */
export const MIN_DOMINANT_WEIGHT = 0.5;

/** Konstante Dichte für die Masse aus dem Kapselvolumen. Das Volumen wird
 *  gemessen; die Dichte ist am Modell nicht messbar und wird offen benannt.
 * Massen sind in erster Linie relative Anteile; kg sind die Wunscheinheit. */
export const DENSITY_KG_PER_M3 = 1000;

/** Maximale Abweichung eines gemessenen Radius zur Mesh-Hülle, Anteil der
 *  Körperhöhe. Abnahmekriterium AP2 „Radien“: Abweichung unter 15 %. */
export const RADIUS_DEVIATION_MAX = 0.15;

/** Mindestanteil der Fußlänge, den die erkannte Sohlenfläche abdecken muss.
 *  Abnahmekriterium AP2 „Sohlen“: mindestens 60 %. */
export const SOLE_COVERAGE_MIN = 0.60;

/** Mindestwirkung am Kettenende als Anteil der Körperhöhe, ab der eine
 *  Abtastung als „messbar“ gilt. Darunter gilt der Freiheitsgrad als
 *  nicht_messbar (plan.md 6.1) — nicht stillschweigend als gemessen. */
export const DEAD_MOVE_FRACTION = 0.01;

/** Mindestlänge einer Sohle als Anteil der Fußlänge; darunter ist die
 *  erkannte „Sohle“ zu klein, um als Fußkontaktfläche zu gelten. */
export const SOLE_LENGTH_MIN = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// Semantische Segmente und Segmentzuordnung
// ─────────────────────────────────────────────────────────────────────────────

/** Segmentliste mit Knochen-Suffixen (hinter „mixamorig“), von → bis.
 *  Reihenfolge = Reihenfolge im Profil. */
export const SEGMENTS = [
  { id: 'torso',      from: 'Hips',            to: 'Neck'             },
  { id: 'head',       from: 'Neck',            to: 'HeadTop_End'      },
  { id: 'upperarm_l', from: 'LeftArm',         to: 'LeftForeArm'      },
  { id: 'forearm_l',  from: 'LeftForeArm',     to: 'LeftHand'         },
  { id: 'hand_l',     from: 'LeftHand',        to: 'LeftHandMiddle3'  },
  { id: 'upperarm_r', from: 'RightArm',        to: 'RightForeArm'     },
  { id: 'forearm_r',  from: 'RightForeArm',    to: 'RightHand'        },
  { id: 'hand_r',     from: 'RightHand',       to: 'RightHandMiddle3' },
  { id: 'thigh_l',    from: 'LeftUpLeg',       to: 'LeftLeg'          },
  { id: 'shin_l',     from: 'LeftLeg',         to: 'LeftFoot'         },
  { id: 'foot_l',     from: 'LeftFoot',        to: 'LeftToe_End'      },
  { id: 'thigh_r',    from: 'RightUpLeg',      to: 'RightLeg'         },
  { id: 'shin_r',     from: 'RightLeg',        to: 'RightFoot'        },
  { id: 'foot_r',     from: 'RightFoot',       to: 'RightToe_End'     },
];

/** Knochenpräfix (hinter „mixamorig“) → Segment. Längster Treffer gewinnt,
 *  damit „LeftForeArm…“ über „LeftArm…“ siegt. */
const SEGMENT_BY_BONE_PREFIX = [
  ['HeadTop_End', 'head'], ['LeftEye', 'head'], ['RightEye', 'head'], ['Head', 'head'], ['Neck', 'head'],
  ['Hips', 'torso'], ['Spine', 'torso'], ['LeftShoulder', 'torso'], ['RightShoulder', 'torso'],
  ['LeftArm', 'upperarm_l'], ['LeftForeArm', 'forearm_l'], ['LeftHand', 'hand_l'],
  ['RightArm', 'upperarm_r'], ['RightForeArm', 'forearm_r'], ['RightHand', 'hand_r'],
  ['LeftUpLeg', 'thigh_l'], ['LeftLeg', 'shin_l'], ['LeftFoot', 'foot_l'], ['LeftToe', 'foot_l'],
  ['RightUpLeg', 'thigh_r'], ['RightLeg', 'shin_r'], ['RightFoot', 'foot_r'], ['RightToe', 'foot_r'],
];

const MIXAMO = 'mixamorig';

function segOfBone(boneName) {
  let best = null, bestLen = -1;
  for (const [prefix, seg] of SEGMENT_BY_BONE_PREFIX) {
    const full = MIXAMO + prefix;
    if (boneName.startsWith(full) && prefix.length > bestLen) { best = seg; bestLen = prefix.length; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gelenk-Katalog: benannte Freiheitsgrade mit semantischer Richtung.
//   axis  : Achse der Gelenkrotation im Knochen-lokalen Bezugssystem der
//           Bind-Pose (x nach Charakter-links, y hoch, z vorn — am Modell
//           gemessen; alle Mixamo-Knochen dieser Datei stehen in der Bind-Pose
//           ungedreht, ihre lokale Achse ist also die Weltachse).
//   moves : Weltachse, auf der die Wirkung am Kettenende auftritt. Sie ist
//           IMMER eine andere als axis: eine Drehung um eine Achse bewegt
//           Punkte parallel zu dieser Achse nicht. Der Name des
//           Freiheitsgrads (flex, lift, spread …) zusammen mit dem
//           Weltvertrag (plan.md 5.5: oben +y, Charakter-vorne +z, links +x)
//           legt beide fest.
//   want  : +1/-1 — ob ein positiver Wert des Freiheitsgrads das Kettenende
//           in Richtung +moves (oder -moves) bewegen soll. Vereinbarung,
//           keine Messung.
//   mirror: Erwartung bezieht sich auf eine nach links/rechts zeigende
//           Richtung; die rechte Seite dreht die Erwartung um (Spiegelung).
//   twist : Rotation um die eigene Kettenachse. Erzeugt am Kettenende keine
//           messbare Bewegung (plan.md 3.5) → signSource 'nicht_messbar'.
//   limit : anatomische Standardgrenzen in Grad [min, max]; limitSource bleibt
//           "anatomisch", aus der Bind-Pose nicht ableitbar (plan.md 6.1).
//
// Achsenkorrektur (Beleg: src/rig/measure.test.mjs, Reihe „Vorzeichen“):
// Die Abtastung maß die Bewegung entlang ACHSE statt entlang MOVES. Das kann
// keine Wirkung zeigen — gedreht wird um diese Achse, also ist die Verschiebung
// parallel zu ihr strukturell 0. Von 30 Freiheitsgraden galten 0 als messbar,
// bei Bewegungen bis 0,3440 m am Zehenende und einer Nachweisgrenze von
// 0,0181 m. Nach der Korrektur liest die Abtastung die Wirkung in benannter
// Richtung; Drehachsen, die dazu nicht passten, sind nachgemessen und umgesetzt:
// Hüftbeugung — Drehung um z bewegt den Zeh um 0,0000 m in z (gar nichts) und
// um 0,3336 m in x (das ist Spreizen); Drehung um x bewegt ihn um 0,3440 m in z.
// Beugung ist also eine Drehung um x, wie plan.md 5.1 für hip_l.flex nennt.
// ─────────────────────────────────────────────────────────────────────────────

const JOINT_CATALOG = [
  { joint: 'pelvis',     bone: 'Hips',            end: 'HeadTop_End', dofs: {
      tilt:  { axis: 'x', moves: 'z', want: +1, mirror: true,  limit: [-40, 40] },
      roll:  { axis: 'z', moves: 'x', want: +1, mirror: false, limit: [-30, 30] },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-90, 90], twist: true } } },
  { joint: 'spine',      bone: 'Spine',           end: 'HeadTop_End', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-25, 35] },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25] },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-25, 25], twist: true } } },
  { joint: 'neck',       bone: 'Neck',            end: 'HeadTop_End', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-40, 40] },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 30] },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true } } },
  { joint: 'head',       bone: 'Head',            end: 'HeadTop_End', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-35, 30] },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 30] },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true } } },
  { joint: 'shoulder_l', bone: 'LeftShoulder',    end: 'LeftHandMiddle3', dofs: {
      shrug: { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-20, 25] },
      fwd:   { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-25, 25] } } },
  { joint: 'shoulder_r', bone: 'RightShoulder',   end: 'RightHandMiddle3', dofs: {
      shrug: { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-25, 20] },
      fwd:   { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-25, 25] } } },
  { joint: 'arm_l',      bone: 'LeftArm',         end: 'LeftHandMiddle3', dofs: {
      lift:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-40, 170] },
      swing: { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-130, 90] },
      twist: { axis: 'x', want: +1, mirror: true,  limit: [-90, 90], twist: true } } },
  { joint: 'arm_r',      bone: 'RightArm',        end: 'RightHandMiddle3', dofs: {
      lift:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-170, 40] },
      swing: { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-90, 130] },
      twist: { axis: 'x', want: +1, mirror: true,  limit: [-90, 90], twist: true } } },
  { joint: 'elbow_l',    bone: 'LeftForeArm',     end: 'LeftHandMiddle3', dofs: {
      bend:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-2, 150] },
      twist: { axis: 'x', want: +1, mirror: true,  limit: [-90, 90], twist: true } } },
  { joint: 'elbow_r',    bone: 'RightForeArm',    end: 'RightHandMiddle3', dofs: {
      bend:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-150, 2] },
      twist: { axis: 'x', want: +1, mirror: true,  limit: [-90, 90], twist: true } } },
  { joint: 'hip_l',      bone: 'LeftUpLeg',       end: 'LeftToe_End', dofs: {
      flex:   { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-30, 130] },
      spread: { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-45, 30] },
      twist:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true } } },
  { joint: 'hip_r',      bone: 'RightUpLeg',      end: 'RightToe_End', dofs: {
      flex:   { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-30, 130] },
      spread: { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 45] },
      twist:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true } } },
  { joint: 'knee_l',     bone: 'LeftLeg',         end: 'LeftToe_End', dofs: {
      bend: { axis: 'x', moves: 'z', want: -1, mirror: false, limit: [0, 150] } } },
  { joint: 'knee_r',     bone: 'RightLeg',        end: 'RightToe_End', dofs: {
      bend: { axis: 'x', moves: 'z', want: -1, mirror: false, limit: [0, 150] } } },
  { joint: 'ankle_l',    bone: 'LeftFoot',        end: 'LeftToe_End', dofs: {
      point: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-45, 55] },
      tilt:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25] } } },
  { joint: 'ankle_r',    bone: 'RightFoot',       end: 'RightToe_End', dofs: {
      point: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-45, 55] },
      tilt:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25] } } },
  { joint: 'toes_l',     bone: 'LeftToeBase',     end: 'LeftToe_End', dofs: {
      bend: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-40, 60] } } },
  { joint: 'toes_r',     bone: 'RightToeBase',    end: 'RightToe_End', dofs: {
      bend: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-40, 60] } } },
];

/** Einheitsvektoren der Weltachsen für die Wirkungsrichtung. */
const ACHSENVEKTOR = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};


// ─────────────────────────────────────────────────────────────────────────────
// Helfer
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Konvexe Hülle von 2D-Punkten [x, z] in der x–z-Ebene (von oben gesehen).
 *  Rückgabe: Array von [x, z] in mathematisch positivem Umlaufsinn. */
function convexHull2D(points) {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  // Orientierung erzwingen: positiv (gegen Uhrzeigersinn in der x–z-Ebene).
  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  if (area2 < 0) hull.reverse();
  return hull;
}

/** Punkt-in-konvexer-Hülle-Test für 2D-Punkte [x, z]. Die Hülle muss in
 *  positivem Umlaufsinn vorliegen (convexHull2D stellt das sicher). */
function pointInHull(p, hull) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr < 0) return false;
  }
  return true;
}

/**
 * Mesh-Hülle eines Segments, unabhängig von seinem einen Perzentil-Radius: 10
 * Stationen entlang der Segmentachse, je das Perzentil der senkrechten Abstände
 * aller Vertex in dieser Scheibe, daraus der Median. Eine Kapsel, die die Haut
 * trifft, muss dieses Stationsprofil ebenfalls treffen — Auswüchse an den
 * Segmentenden (Finger, Schädel) schlagen darin nicht als Pauschalabweichung
 * durch.
 *
 * Rueckgabe { huelle, groesster, anzahl } in Metern; huelle 0, wenn zu wenige
 * Vertex in den Scheiben liegen.
 */
function meshHuelle(verts, a, b, stationen = 10, p = RADIUS_PERCENTILE) {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  const laenge = Math.sqrt(l2);
  if (!verts.length || !(laenge > 0)) return { huelle: 0, groesster: 0, anzahl: verts.length };
  const zerlegt = verts.map((v) => {
    const t = THREE.MathUtils.clamp(v.clone().sub(a).dot(ab) / l2, 0, 1);
    return { t, d: v.distanceTo(a.clone().addScaledVector(ab, t)) };
  });
  const band = 1 / (2 * stationen);      // Achsenanteil, t ist auf [0,1] normiert
  const proStation = [];
  for (let s = 0; s < stationen; s++) {
    const mittig = (s + 0.5) / stationen;
    // percentile() erwartet SORTIERTE Eingabe — sie greift blind auf einen
    // Index zu. Ohne dieses sort() lieferte jede Station einen beliebigen
    // Abstand statt ihres Perzentils, und die Stationshülle fiel systematisch
    // zu klein aus: Rumpf 0,1232 statt 0,1484 m, Fuß 0,0379 statt 0,0598 m.
    // Damit meldete die Hüllenprüfung alle 14 Segmente als abweichend (23 bis
    // 60 %), obwohl die Radien stimmen. Sortiert liegen 13 der 14 Segmente
    // unter 8 %, der Rumpf als konischstes Segment bei 13,9 % — unter der
    // Grenze von 15 %. (Beleg: src/rig/measure.test.mjs, Reihe „Radien“.)
    const inDerScheibe = zerlegt
      .filter((x) => Math.abs(x.t - mittig) <= band)
      .map((x) => x.d)
      .sort((x, y) => x - y);
    if (inDerScheibe.length >= 4) proStation.push(percentile(inDerScheibe, p));
  }
  if (proStation.length === 0) return { huelle: 0, groesster: 0, anzahl: verts.length };
  proStation.sort((x, y) => x - y);
  return {
    huelle: percentile(proStation, 0.5),
    groesster: zerlegt.reduce((m, x) => Math.max(m, x.d), 0),
    anzahl: verts.length,
  };
}


function r4(x) { return Number(x.toFixed(4)); }
function r5(x) { return Number(x.toFixed(5)); }

/** Pflichtrollen (plan.md 5.1): pelvis, foot_l, foot_r. Fehlt eine, wird das
 *  Modell abgelehnt statt geraten. */
const ROLE_BY_SUFFIX = {
  pelvis: 'Hips',
  foot_l: 'LeftFoot',
  foot_r: 'RightFoot',
};

// ─────────────────────────────────────────────────────────────────────────────
// Laden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lädt eine GLB/GLTF-Datei in ein three.js-gltf-Objekt ({scene, animations}).
 * @param {Uint8Array|ArrayBuffer} buffer  rohe Bytes einer .glb-/-.gltf-Datei
 * @throws {Error} bei leerem oder fehlerhaftem Puffer — Meldung mit Zahl.
 */
export async function loadGLB(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer
    : buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : null;
  if (!bytes || bytes.length === 0) {
    throw new Error(`Laden fehlgeschlagen: Puffer ist leer oder hat falschen Typ (${bytes === null ? typeof buffer : '0 Byte'})`);
  }
  const loader = new GLTFLoader();
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kontext: einmal aus dem Modell ziehen, was alle Messungen brauchen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sammelt Skeleton, Bind-Pose-Kopie, Vertexpositionen in Weltkoordinaten
 * (Bind-Pose), dominante Segment-Zuordnung je Vertex über die Skin-Gewichte
 * und die bodennahen (Sohlen-)Vertices. Wirft mit Zahl und Grund, wenn das
 * Modell nicht vermessen werden kann.
 */
function collectContext(gltf) {
  const scene = gltf && gltf.scene;
  if (!(scene instanceof THREE.Object3D)) {
    throw new Error(`Vermessung abgelehnt: kein Szenen-Objekt im Loader-Ergebnis (Typ ${gltf === null || gltf === undefined ? String(gltf) : typeof gltf})`);
  }
  let mesh = null;
  const meshes = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh) { meshes.push(o); if (!mesh) mesh = o; }
  });
  const skeleton = mesh ? mesh.skeleton : null;
  const bones = skeleton ? skeleton.bones : [];
  if (!mesh || bones.length === 0) {
    throw new Error(`Vermessung abgelehnt: ${bones.length} Knochen, ${meshes.length} SkinnedMesh gefunden — Vermessung braucht ein geriggtes Modell`);
  }

  scene.updateMatrixWorld(true);
  skeleton.update();

  const byName = new Map(bones.map((b) => [b.name, b]));

  const v = new THREE.Vector3();
  const worldVerts = [];
  const segOfVertex = [];
  let minY = Infinity, maxY = -Infinity;

  // ALLE SkinnedMeshes vermessen, nicht nur das erste. Xbot.glb bringt zwei mit
  // (Beta_Joints 12473, Beta_Surface 15901 Vertex). Wer nur das erste nimmt,
  // vermisst 12473 von 28374 Vertex = 44 % und erhält eine Körperhöhe von
  // 1,5968 m statt der nachgemessenen 1,8093 m — 0,2125 m = 11,7 % zu wenig.
  // Jede Toleranz dieses Profils ist auf diese Höhe relativ, also wäre das
  // gesamte Profil um 13,3 % zu eng. (Beleg: src/rig/measure.test.mjs,
  // „Vertrag, Positivfall“.)
  for (const haut of meshes) {
    const posAttr = haut.geometry.attributes.position;
    const si = haut.geometry.attributes.skinIndex;
    const sw = haut.geometry.attributes.skinWeight;
    if (!si || !sw) {
      throw new Error(`Vermessung abgelehnt: SkinnedMesh „${haut.name || 'unbenannt'}“ mit ${posAttr.count} Vertices ohne skinIndex/skinWeight — Segmentzuordnung unmöglich`);
    }

    for (let i = 0; i < posAttr.count; i++) {
      // Bind-Pose-Position über die Haut holen (getVertexPosition rechnet die
      // Skin-Gewichte), dann ins Weltkoordinatensystem. Die Rohposition der
      // SkinnedMeshes liegt im Bind-Space; applyMatrix4(matrixWorld) allein
      // darauf wäre falsch.
      haut.getVertexPosition(i, v);
      haut.localToWorld(v);
      const p = v.clone();
      worldVerts.push(p);
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;

      let bestW = -1, bestB = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        const bi = si.getComponent(i, k);
        if (w > bestW) { bestW = w; bestB = bi; }
      }
      segOfVertex.push(bestW >= MIN_DOMINANT_WEIGHT ? segOfBone(bones[bestB].name) : null);
    }
  }

  const vertexCount = worldVerts.length;
  const height = maxY - minY;
  if (!(height > 0)) {
    throw new Error(`Vermessung abgelehnt: Körperhöhe ${height} m aus ${vertexCount} Vertices von ${meshes.length} SkinnedMeshes — keine Ausdehnung auf der Hochachse y`);
  }

  // Bodennahe Vertices, aufgeteilt auf linke und rechte Körperseite.
  const soleTolMeters = height * SOLE_TOLERANCE;
  const footL = byName.get(MIXAMO + 'LeftFoot') || null;
  const footR = byName.get(MIXAMO + 'RightFoot') || null;
  const soleVertsL = [], soleVertsR = [];
  if (footL && footR) {
    const fl = footL.getWorldPosition(new THREE.Vector3());
    const fr = footR.getWorldPosition(new THREE.Vector3());
    for (const p of worldVerts) {
      if (p.y < minY + soleTolMeters) {
        (p.distanceTo(fl) <= p.distanceTo(fr) ? soleVertsL : soleVertsR).push(p);
      }
    }
  }

  return {
    scene, mesh, skeleton, bones, byName,
    vertexCount, worldVerts, segOfVertex,
    minY, maxY, height,
    soleTolMeters,
    footL, footR,
    soleVertsL, soleVertsR,
  };
}

function worldVertsOfSegment(ctx, segId) {
  const out = [];
  for (let i = 0; i < ctx.vertexCount; i++) {
    if (ctx.segOfVertex[i] === segId) out.push(ctx.worldVerts[i]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmente: Radius zur Segmentachse, Masse aus Kapselvolumen, Schwerpunkt
// ─────────────────────────────────────────────────────────────────────────────

function measureSegments(ctx, opts = {}) {
  const radiusPercentile = opts.radiusPercentile ?? RADIUS_PERCENTILE;
  const massOverrides = opts.massOverrides ?? {};
  const radiusOverrides = opts.radiusOverrides ?? {};
  const segments = [];
  const massBySeg = new Map();
  const comBySeg = new Map();

  for (const s of SEGMENTS) {
    const bone = (suffix) => ctx.byName.get(MIXAMO + suffix) || null;
    const ba = bone(s.from);
    const bb = bone(s.to);
    if (!ba || !bb) {
      throw new Error(`Segment ${s.id}: Knochen „${MIXAMO + s.from}“ oder „${MIXAMO + s.to}“ fehlt im Skelett mit ${ctx.bones.length} Knochen`);
    }
    const verts = worldVertsOfSegment(ctx, s.id);
    if (verts.length === 0) {
      throw new Error(`Segment ${s.id}: 0 von ${ctx.vertexCount} Vertices tragen ein Gewicht ≥ ${MIN_DOMINANT_WEIGHT} auf einem Segment-Knochen — Radius nicht messbar`);
    }
    const a = ba.getWorldPosition(new THREE.Vector3());
    const b = bb.getWorldPosition(new THREE.Vector3());
    const dists = verts
      .map((p) => pointSegDist(p, a, b))
      .sort((x, y) => x - y);
    let radius = percentile(dists, radiusPercentile);
    if (!(radius > 0) || !Number.isFinite(radius)) {
      throw new Error(`Segment ${s.id}: Radius ${radius} m aus ${dists.length} Vertex-Abständen (Perzentil ${radiusPercentile}) — keine Haut am Segment messbar`);
    }
    if (radiusOverrides[s.id] !== undefined) {
      radius = radius * radiusOverrides[s.id];   // Testhaken: künstlich veränderter Radius
    }
    const length = a.distanceTo(b);
    // Kapselvolumen: Zylinder plus zwei Halbkugeln. Masse NICHT aus der
    // Vertexzahl — feine Modellierung (viele Finger-Vertices) heißt nicht
    // viel Masse (Spike-Kalibrierung).
    const volume = Math.PI * radius * radius * length
      + (4 / 3) * Math.PI * radius * radius * radius;
    let mass = volume * DENSITY_KG_PER_M3;
    if (massOverrides[s.id] !== undefined) {
      mass = mass * massOverrides[s.id];      // Testhaken: künstliche Massenverlagerung
    }
    segments.push({
      id: s.id, from: MIXAMO + s.from, to: MIXAMO + s.to,
      radius: r4(radius), mass: r5(mass), volume: r5(volume),
    });
    massBySeg.set(s.id, mass);
    comBySeg.set(s.id, a.clone().add(b).multiplyScalar(0.5));    // Kapselmitte
  }
  return { segments, massBySeg, comBySeg };
}

/**
 * Misst Schwerpunkt und Standfläche der Bind-Pose.
 * opts.massOverrides: { segmentId: faktor } skaliert die gemessene Segmentmasse
 * künstlich — ausschließlich Testhaken für den Negativfall des Abnahmetests
 * „Massen“ (verdreifachte Handmasse).
 *
 * Positivfall des Abnahmetests: der Schwerpunkt der unveränderten Bind-Pose
 * liegt innerhalb der Standfläche (konvexe Hülle der bodennahen Vertices).
 */
export function measureMasses(gltf, opts = {}) {
  const ctx = collectContext(gltf);
  const { segments, massBySeg, comBySeg } = measureSegments(ctx, opts);

  let total = 0;
  const com = new THREE.Vector3();
  for (const s of segments) {
    const m = massBySeg.get(s.id);
    if (!(m > 0)) {
      throw new Error(`Segment ${s.id}: Masse ${m} kg nach eventuell künstlicher Skalierung — Summe über alle Segmente nicht bildbar`);
    }
    total += m;
    com.addScaledVector(comBySeg.get(s.id), m);
  }
  if (!(total > 0)) {
    throw new Error(`Schwerpunkt nicht messbar: Gesamtmasse ${total.toFixed(3)} kg über ${segments.length} Segmente`);
  }
  com.divideScalar(total);

  const solePts = [...ctx.soleVertsL, ...ctx.soleVertsR].map((p) => [p.x, p.z]);
  if (solePts.length < 3) {
    throw new Error(`Standfläche nicht messbar: nur ${solePts.length} Vertices in Bodennähe (Toleranz ${(ctx.height * SOLE_TOLERANCE).toFixed(4)} m bei Körperhöhe ${ctx.height.toFixed(3)} m)`);
  }
  const hull = convexHull2D(solePts);
  const inside = pointInHull([com.x, com.z], hull);
  return {
    comXYZ: [r4(com.x), r4(com.y), r4(com.z)],
    supportPolygon: hull,
    insideSupportPolygon: inside,
    totalMassKg: r5(total),
    segments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sohlen: Kontaktpunkte, Abdeckung, Ferse-gegen-Ballen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst die Sohlenkontaktpunkte aus der Bodennähe in der Bind-Pose
 * (plan.md 3.3). Ein Modell mit angehobener Ferse wird NICHT stillschweigend
 * falsch vermessen: zu jeder Sohle gehört eine Statistik mit der gemessenen
 * Höhendifferenz Ferse gegen Ballen — der Aufrufer entscheidet anhand der Zahl.
 */
export function measureSoles(gltf) {
  const ctx = collectContext(gltf);
  return measureSolesCore(ctx);
}

/** Kern der Sohlenmessung auf einem collectContext-Ergebnis. */
function measureSolesCore(ctx) {
  const soles = [];
  const stats = {};

  const sides = [
    { tag: 'l', group: ctx.soleVertsL, foot: ctx.footL, segId: 'foot_l' },
    { tag: 'r', group: ctx.soleVertsR, foot: ctx.footR, segId: 'foot_r' },
  ];

  for (const { tag, group, foot, segId } of sides) {
    if (group.length < 4) {
      stats[tag] = {
        vertexCount: group.length,
        coverage: 0,
        note: `nur ${group.length} Vertices in Bodennähe (Schwelle ${ctx.soleTolMeters.toFixed(4)} m bei Körperhöhe ${ctx.height.toFixed(3)} m)`,
      };
      continue;
    }
    const xs = group.map((p) => p.x), zs = group.map((p) => p.z);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);

    const corners = [
      ['back_in', xMin, zMin], ['back_out', xMax, zMin],
      ['front_in', xMin, zMax], ['front_out', xMax, zMax],
    ];
    for (const [pos, tx, tz] of corners) {
      let best = group[0], bestD = Infinity;
      for (const p of group) {
        const d = (p.x - tx) * (p.x - tx) + (p.z - tz) * (p.z - tz);
        if (d < bestD) { bestD = d; best = p; }
      }
      const local = foot.worldToLocal(best.clone());
      soles.push({
        id: `sole_${tag}_${pos}`,
        bone: foot.name,
        local: [r5(local.x), r5(local.y), r5(local.z)],
      });
    }

    // Fußlänge aus der Haut der Fuß-Kette (dominante Zuordnung), nicht getippt.
    const footVerts = worldVertsOfSegment(ctx, segId);
    let footLength = 0, soleLength = 0, coverage = 0;
    let heelLowY = NaN, toeLowY = NaN, heelLift = NaN;
    if (footVerts.length > 0) {
      const fz = footVerts.map((p) => p.z);
      const fzMin = Math.min(...fz), fzMax = Math.max(...fz);
      footLength = fzMax - fzMin;

      // Abdeckung über das KONTAKTBAND, nicht über das Sohlentoleranzband.
      // Die Sohlentoleranz (3,5 % der Körperhöhe = 0,0633 m an diesem Modell)
      // dient dazu, Sohlenpunkte zu FINDEN — auch an einem Fuß, der auf dem
      // Ballen steht. Als Maß für BERÜHRUNG taugt sie nicht: bei 20°
      // Zehenneigung schneidet ein 0,0633-m-Band 0,2011 m aus einem 0,2355 m
      // langen Fuß, also 85 % — die angehobene Ferse bliebe unter der Grenze
      // von 60 % unbemerkt. Über den Kontaktzuschlag (0,015 m) gemessen sind
      // es 31 %. An Xbot.glb bei 0/5/10/15/20/30° Zehenneigung: 98 / 88 / 48 /
      // 38 / 31 / 24 % — die 60-%-Grenze trennt zwischen 5° und 10°.
      const imKontakt = footVerts.filter((p) => p.y < ctx.minY + CONTACT_MARGIN);
      if (imKontakt.length > 0) {
        const kz = imKontakt.map((p) => p.z);
        soleLength = Math.max(...kz) - Math.min(...kz);
      }
      coverage = footLength > 0 ? Math.min(1, soleLength / footLength) : 0;

      // Fersenanhebung: TIEFSTER Punkt der hinteren gegen tiefsten der vorderen
      // Fußhälfte, über alle Fuß-Vertex. Vorher verglich das Maß die HÖCHSTEN
      // Punkte innerhalb des Bodenbands — die liegen beide an dessen Oberkante,
      // das Maß war strukturell blind: 0,0015 / 0,0004 / 0,0001 m bei 0 / 10 /
      // 20° Zehenneigung, also fallend, obwohl die Ferse steigt. So gemessen:
      // 0,0005 / 0,0172 / 0,0344 m — der Kontaktzuschlag von 0,015 m trennt
      // zwischen 5° (0,0090 m) und 10° (0,0172 m).
      const zMitte = (fzMin + fzMax) / 2;
      const ferse = footVerts.filter((p) => p.z < zMitte);
      const zeh = footVerts.filter((p) => p.z >= zMitte);
      if (ferse.length && zeh.length) {
        heelLowY = Math.min(...ferse.map((p) => p.y));
        toeLowY = Math.min(...zeh.map((p) => p.y));
        heelLift = Math.abs(heelLowY - toeLowY);
      }
    }

    stats[tag] = {
      vertexCount: group.length,
      soleLength: r4(soleLength),
      footLength: r4(footLength),
      coverage: r4(coverage),
      heelLowY: Number.isFinite(heelLowY) ? r4(heelLowY) : null,
      toeLowY: Number.isFinite(toeLowY) ? r4(toeLowY) : null,
      heelLiftMeters: Number.isFinite(heelLift) ? r4(heelLift) : null,
    };
  }
  return { soles, stats, height: r4(ctx.height) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorzeichen messen (plan.md 3.5): Gelenk um PROBE_DEG beugen, Wirkung am
// Kettenende messen. Twist wird nicht stillschweigend zu 1.
// ─────────────────────────────────────────────────────────────────────────────

function restoreBind(ctx) {
  for (const [name, saved] of ctx.bindSaved) {
    const bone = ctx.byName.get(name);
    if (bone) {
      bone.quaternion.copy(saved.q);
      bone.position.copy(saved.p);
    }
  }
  ctx.skeleton.update();
  ctx.scene.updateMatrixWorld(true);
}

/**
 * Misst alle Gelenke des Katalogs: Freiheitsgrade, Vorzeichen, Grenzen.
 *
 * Verfahren (plan.md 3.5): das Gelenk wird um PROBE_DEG Grad um seine
 * Knochen-lokale Achse (axis) gedreht; gemessen wird, wie weit sich das
 * Kettenende in der benannten Wirkungsrichtung (moves) bewegt. Für den
 * Spiegelvergleich zählt die rechte Seite mit umgekehrter Erwartung (mirror).
 *
 * opts.invert: { 'joint.dof': true } kehrt das gemessene Vorzeichen künstlich
 * um — ausschließlich Testhaken für den Negativfall des Abnahmetests
 * „Vorzeichen“ (absichtlich invertiertes Vorzeichen muss gemeldet werden).
 */
export function measureJoints(gltf, opts = {}) {
  const ctx = collectContext(gltf);
  const probeDeg = opts.probeDeg ?? PROBE_DEG;
  const invert = opts.invert ?? {};
  const probeRad = probeDeg * Math.PI / 180;
  // Mindestwirkung am Kettenende, ab der eine Abtastung als messbar gilt.
  const deadMove = ctx.height * DEAD_MOVE_FRACTION;

  ctx.bindSaved = new Map();
  for (const b of ctx.bones) {
    ctx.bindSaved.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }

  applyBindPose(ctx);   // sicherstellen, dass wirklich die Bind-Pose anliegt

  const joints = {};
  let measurableCount = 0;
  let notMeasurableCount = 0;
  const warnings = [];

  for (const def of JOINT_CATALOG) {
    const bone = ctx.byName.get(MIXAMO + def.bone);
    const end = ctx.byName.get(MIXAMO + def.end);
    if (!bone) {
      warnings.push(`Gelenk ${def.joint}: Knochen „${MIXAMO + def.bone}“ fehlt (Skelett mit ${ctx.bones.length} Knochen) — Gelenk bleibt ungemessen`);
      continue;
    }
    if (!end) {
      warnings.push(`Gelenk ${def.joint}: Kettenende „${MIXAMO + def.end}“ fehlt (Skelett mit ${ctx.bones.length} Knochen) — Vorzeichen nicht messbar`);
      continue;
    }

    // Datensicherung vor dem Abtasten (Restore unten sowieso, das hier ist
    // der Ausgangszustand für die Bind-Pose-Delta-Rechnung).
    const bindQ = bone.quaternion.clone();

    const dofOut = {};
    let anyMeasurable = false;

    for (const [name, spec] of Object.entries(def.dofs)) {
      if (spec.twist) {
        // Twist: Drehung um die eigene Kettenachse — erzeugt am Kettenende
        // keine messbare Bewegung (plan.md 3.5). Kennzeichnung gegen das
        // stille Setzen auf 1 mit falscher Quelle.
        dofOut[name] = {
          axis: spec.axis, sign: 1, limit: spec.limit,
          signSource: 'nicht_messbar',
        };
        continue;
      }

      // Abtastachse: Knochen-lokale Achse aus dem Katalog in Weltkoordinaten
      // gedreht (Bind-Pose-Orientierung des Knochens).
      const localAxis = new THREE.Vector3(
        spec.axis === 'x' ? 1 : 0,
        spec.axis === 'y' ? 1 : 0,
        spec.axis === 'z' ? 1 : 0,
      );
      const worldAxis = localAxis.applyQuaternion(bindQ).normalize();

      // Wirkungsrichtung: die Achse, auf der der Name des Freiheitsgrads eine
      // Bewegung verspricht. Nie die Drehachse selbst — die Verschiebung
      // parallel zur Drehachse ist bei einer Drehung strukturell 0.
      const richtung = ACHSENVEKTOR[spec.moves];
      if (!richtung) {
        throw new Error(`Gelenk ${def.joint}.${name}: Wirkungsrichtung „${spec.moves}“ unbekannt — erwartet x, y oder z (Skelett mit ${ctx.bones.length} Knochen)`);
      }

      const before = end.getWorldPosition(new THREE.Vector3());
      const qProbe = new THREE.Quaternion().setFromAxisAngle(worldAxis, probeRad);
      bone.quaternion.copy(bindQ).premultiply(qProbe);
      ctx.skeleton.update();
      ctx.scene.updateMatrixWorld(true);
      const after = end.getWorldPosition(new THREE.Vector3());
      bone.quaternion.copy(bindQ);
      ctx.skeleton.update();
      ctx.scene.updateMatrixWorld(true);

      const dWorld = after.clone().sub(before);
      const measured = dWorld.dot(richtung);

      if (!Number.isFinite(measured) || Math.abs(measured) < deadMove) {
        // Bewegung am Kettenende unterhalb der Nachweisgrenze: nicht messbar,
        // ausdrücklich gekennzeichnet — nicht stillschweigend 1.
        dofOut[name] = {
          axis: spec.axis, sign: 1, limit: spec.limit,
          signSource: 'nicht_messbar',
        };
        notMeasurableCount++;
        continue;
      }

      const mirrored = spec.mirror && def.joint.endsWith('_r');
      const want = spec.want * (mirrored ? -1 : 1);
      let sign = Math.sign(measured) === Math.sign(want) ? 1 : -1;
      if (invert[`${def.joint}.${name}`]) {
        sign = -sign;         // Testhaken Negativfall: künstlich invertiert
      }
      dofOut[name] = {
        axis: spec.axis, sign, limit: spec.limit,
        signSource: 'gemessen',
        measured: r4(measured),      // Welt-verschiebung am Kettenende in Metern
      };
      anyMeasurable = true;
      measurableCount++;
    }

    joints[def.joint] = {
      bone: MIXAMO + def.bone,
      dof: dofOut,
      signSource: anyMeasurable ? 'gemessen' : 'nicht_messbar',
      limitSource: 'anatomisch',   // Bind-Pose kann Grenzen nicht liefern (plan.md 6.1)
    };
  }

  restoreBind(ctx);

  return {
    joints,
    counts: { measurable: measurableCount, notMeasurable: notMeasurableCount },
    warnings,
  };
}

/** Setzt alle Knochen strikt auf die bei collectContext gesicherte Bind-Pose
 *  zurück und aktualisiert MatrixWorld. */
export function applyBindPose(ctx) {
  for (const [name, saved] of ctx.bindSaved) {
    const bone = ctx.byName.get(name);
    if (bone) {
      bone.quaternion.copy(saved.q);
      bone.position.copy(saved.p);
    }
  }
  ctx.skeleton.update();
  ctx.scene.updateMatrixWorld(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bind-Pose-Ruheabstände (Grundlage der Durchdringungsprüfung, plan.md 3.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst Bind-Pose-Ruheabstände aller nicht benachbarten Segmentpaare, deren
 * Oberflächen sich näher als ein Zwanzigstel der Körperhöhe kommen.
 * Benachbart = Segmente teilen einen Knochen — die sollen sich immer
 * berühren dürfen und werden nicht eingesammelt.
 */
export function measureRestDistances(gltf) {
  const ctx = collectContext(gltf);
  const { segments } = measureSegments(ctx);
  const radiusById = new Map(segments.map((s) => [s.id, s.radius]));
  const caps = new Map();
  for (const s of SEGMENTS) {
    if (!radiusById.has(s.id)) continue;
    const ba = ctx.byName.get(MIXAMO + s.from);
    const bb = ctx.byName.get(MIXAMO + s.to);
    if (ba && bb) {
      caps.set(s.id, [ba.getWorldPosition(new THREE.Vector3()), bb.getWorldPosition(new THREE.Vector3())]);
    }
  }
  const ids = [...caps.keys()];
  const nearPairs = new Set();
  for (const s of SEGMENTS) {
    nearPairs.add(s.from + '|' + s.to);
    nearPairs.add(s.to + '|' + s.from);
  }
  const isAdjacent = (a, b) => {
    const A = SEGMENTS.find((x) => x.id === a);
    const B = SEGMENTS.find((x) => x.id === b);
    if (!A || !B) return true;
    return nearPairs.has(A.from + '|' + B.to) || nearPairs.has(B.from + '|' + A.to);
  };

  // Nur Paare eintragen, deren Kapsel-Oberflächen sich merklich nah kommen.
  // Schranke relativ zur Körperhöhe (AGENTS.md), hier ein Zwanzigstel.
  const NEAR_FRACTION = 0.05;
  const nearMeters = ctx.height * NEAR_FRACTION;

  const restDistances = {};
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (isAdjacent(a, b)) continue;
      const [a1, a2] = caps.get(a);
      const [b1, b2] = caps.get(b);
      const gap = segSegDist(a1, a2, b1, b2) - (radiusById.get(a) + radiusById.get(b));
      if (gap < nearMeters) {
        restDistances[`${a}|${b}`] = r4(Math.max(0, gap));
      }
    }
  }
  return restDistances;
}

// ─────────────────────────────────────────────────────────────────────────────
// Komplettprofil (plan.md 5.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst das komplette RigProfile gemäß docs/plan.md 5.1 aus der Bind-Pose.
 *
 * @param {{scene: THREE.Object3D}} gltf  Ergebnis von loadGLB
 * @param {{fileName?: string}} [opts]
 * @returns {object} RigProfile (schemaVersion 1)
 * @throws {Error} wenn das Modell nicht vermessen werden kann. Jede Meldung
 *   enthält eine Zahl (AGENTS.md, Handwerkliches).
 */
export function measureRigProfile(gltf, opts = {}) {
  const ctx = collectContext(gltf);
  const warnings = [];
  const radiusPercentile = opts.radiusPercentile ?? RADIUS_PERCENTILE;

  // Bind-Pose sichern, damit die Abtastung sie restaurieren kann.
  ctx.bindSaved = new Map();
  for (const b of ctx.bones) {
    ctx.bindSaved.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }
  applyBindPose(ctx);

  // Rollen: exakte Namens-Treffer im Mixamo-Schema, Konfidenz sonst 0.
  // Pflichtrollen (plan.md 5.1): fehlt eine, wird das Modell abgelehnt statt
  // geraten — das Modell wird hier zu Ende vermessen und dann verworfen.
  const roles = {};
  for (const [role, suffix] of Object.entries(ROLE_BY_SUFFIX)) {
    const id = MIXAMO + suffix;
    const found = ctx.byName.has(id);
    roles[role] = { bone: id, confidence: found ? 1.0 : 0.0 };
    if (!found) {
      warnings.push(`Rolle ${role}: Knochen „${id}“ fehlt (${ctx.bones.length} Knochen durchsucht)`);
    }
  }
  for (const role of Object.keys(roles)) {
    if (roles[role].confidence < 1.0) {
      throw new Error(
        `Vermessung abgelehnt: Pflichtrolle ${role} nicht gefunden (Konfidenz ${roles[role].confidence.toFixed(2)}) — Modell wird abgelehnt statt geraten`
      );
    }
  }

  // Segmente, Massen, Schwerpunkt, Standfläche.
  // Die Verfahrensparameter des Aufrufers müssen hier durchgerechnet werden —
  // sonst meldet das Profil params.radiusPercentile 0,5, hat aber mit 0,9
  // gemessen (Beleg: measure.test.mjs „Verfahrensparameter“: alle 14 Radien
  // blieben identisch, thigh_l 0,0977 m, obwohl params auf 0,5 stand).
  const { segments, massBySeg, comBySeg } = measureSegments(ctx, opts);
  let totalMass = 0;
  const com = new THREE.Vector3();
  for (const s of segments) {
    const m = massBySeg.get(s.id);
    totalMass += m;
    com.addScaledVector(comBySeg.get(s.id), m);
  }
  com.divideScalar(totalMass);
  const solePts = [...ctx.soleVertsL, ...ctx.soleVertsR].map((p) => [p.x, p.z]);
  if (solePts.length < 3) {
    throw new Error(`Standfläche nicht messbar: nur ${solePts.length} Vertices in Bodennähe (Toleranz ${ctx.soleTolMeters.toFixed(4)} m)`);
  }
  const supportPolygon = convexHull2D(solePts);
  const comInsideFootprint = pointInHull([com.x, com.z], supportPolygon);
  if (!comInsideFootprint) {
    warnings.push(`Schwerpunkt der Bind-Pose liegt außerhalb der Standfläche (${com.x.toFixed(4)}, ${com.z.toFixed(4)}) — Standfläche mit ${supportPolygon.length} Ecken`);
  }

  // Radien-Hüllenprüfung (Abnahmekriterium „Radien“): der gemeldete Radius wird
  // gegen die Mesh-Hülle je Segment gerechnet.
  //
  // Verfahrensparameter: RADIUS_DEVIATION_MAX = 15 %, bezogen auf die
  // Segmenthülle. Der Bezug war hier zuerst die Körperhöhe (plan.md Kapitel 4:
  // „alle Toleranzen relativ zur Körperhöhe“); das macht die Prüfung untätig —
  // für jeden denkbaren Radius: die größte gemessene Segmenthülle ist der Rumpf
  // mit 0,1937 m bei 1,8093 m Körperhöhe. Einen Radius von 0 gemessen betrüge
  // die Abweichung damit 10,7 % der Körperhöhe, immer noch unter der Grenze von
  // 15 %. Ein halbierte Schenkelradius (0,0977 → 0,0489 m) ergibt 4,4 % der
  // Körperhöhe: unbemerkt. Gegen die Segmenthülle gerechnet sind es 52,6 %:
  // gemeldet. Die Grenze bleibt skalierungsunabhängig, weil sie zwei
  // Körperlängen ins Verhältnis setzt.
  // Beleg: src/rig/measure.test.mjs, Reihe „Radien“.
  const radiusCheck = [];
  for (const s of segments) {
    const verts = worldVertsOfSegment(ctx, s.id);
    const ba = ctx.byName.get(s.from);
    const bb = ctx.byName.get(s.to);
    if (!ba || !bb || verts.length === 0) continue;
    const a = ba.getWorldPosition(new THREE.Vector3());
    const b = bb.getWorldPosition(new THREE.Vector3());
    const hue = meshHuelle(verts, a, b, 10, radiusPercentile);
    if (!(hue.huelle > 0)) continue;
    const dev = Math.abs(hue.huelle - s.radius) / hue.huelle;
    radiusCheck.push({
      id: s.id, radius: s.radius, hullRadius: r5(hue.huelle),
      hullMax: r5(hue.groesster), deviationFraction: r4(dev),
    });
  }
  for (const r of radiusCheck.filter((x) => x.deviationFraction > RADIUS_DEVIATION_MAX)) {
    warnings.push(`Segment ${r.id}: Radius ${r.radius.toFixed(4)} m weicht ${(r.deviationFraction * 100).toFixed(1)} % von der Mesh-Hülle dieses Segments (${r.hullRadius.toFixed(4)} m Stationshülle, ${r.hullMax.toFixed(4)} m höchste Ausdehnung) ab — Grenze ${(RADIUS_DEVIATION_MAX * 100).toFixed(0)} %`);
  }

  // Sohlen + Sohlenabdeckung (Abnahmekriterium „Sohlen“: 60 % der Fußlänge).
  const { soles, stats: soleStats } = measureSolesCore(ctx);
  for (const tag of ['l', 'r']) {
    const st = soleStats[tag];
    if (st && st.footLength > 0 && st.coverage < SOLE_COVERAGE_MIN) {
      warnings.push(`Sohle ${tag}: erkannte Fläche deckt ${(st.coverage * 100).toFixed(0)} % der Fußlänge (${st.soleLength.toFixed(4)} m von ${st.footLength.toFixed(4)} m) ab — unter der Grenze von ${(SOLE_COVERAGE_MIN * 100).toFixed(0)} %`);
    }
    // Zweiter, unabhängiger Befund derselben Lage: die Ferse hängt in der Luft.
    // Abdeckung und Fersenanhebung können auseinanderlaufen (breiter Fuß, der
    // nur vorn aufsetzt), deshalb wird beides gemeldet, nicht eines aus dem
    // anderen abgeleitet.
    if (st && st.heelLiftMeters !== null && st.heelLiftMeters >= CONTACT_MARGIN) {
      warnings.push(`Sohle ${tag}: Ferse steht ${st.heelLiftMeters.toFixed(4)} m über dem Ballen (tiefster Fersenpunkt y ${st.heelLowY.toFixed(4)} m gegen tiefsten Zehenpunkt y ${st.toeLowY.toFixed(4)} m) — über dem Kontaktzuschlag von ${CONTACT_MARGIN.toFixed(4)} m, der Fuß liegt nicht flach auf`);
    }
  }

  // Gelenke: Vorzeichen messen.
  const probeDeg = opts.probeDeg ?? PROBE_DEG;
  const measured = measureJoints(gltf, { probeDeg });
  warnings.push(...measured.warnings);

  // Ruheabstände.
  const restDistances = measureRestDistances(gltf);

  // Knochenliste: id, Elternteil, Bind-Pose-Weltposition.
  const bonesOut = ctx.bones.map((b) => ({
    id: b.name,
    parent: b.parent && b.parent.isBone ? b.parent.name : null,
    bindWorld: (() => {
      const p = b.getWorldPosition(new THREE.Vector3());
      return [r4(p.x), r4(p.y), r4(p.z)];
    })(),
  }));

  restoreBind(ctx);

  return {
    schemaVersion: 1,
    source: {
      file: opts.fileName ?? 'unbenannt.glb',
      boneCount: ctx.bones.length,
      vertexCount: ctx.vertexCount,
    },
    world: {
      up: 'y',
      forward: 'z',
      left: 'x',
      groundY: r5(ctx.minY),
      height: r4(ctx.height),
      unitsPerMeter: 1.0,
    },
    bones: bonesOut,
    roles: {
      pelvis: roles.pelvis,
      foot_l: roles.foot_l,
      foot_r: roles.foot_r,
    },
    joints: measured.joints,
    segments,
    soles,
    restDistances,
    params: {
      radiusPercentile: opts.radiusPercentile ?? RADIUS_PERCENTILE,
      soleTolerance: SOLE_TOLERANCE,
      contactMargin: CONTACT_MARGIN,
    },
    warnings,
  };
}

export default measureRigProfile;