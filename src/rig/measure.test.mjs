// AP2 — Abnahmetest für die Rig-Vermessung (src/rig/measure.js).
//
// Fünf Abnahmereihen aus docs/umsetzung.md AP2, je mit Positiv- und Negativfall
// (AGENTS.md Regel 2): Massen, Radien, Sohlen, Vorzeichen, Twist. Dazu die
// Vertragsprüfung über validateRigProfile (docs/plan.md 5.1) und die Prüfung,
// dass die gemeldeten Verfahrensparameter auch die benutzten sind (plan.md 4).
//
// Bezugssystem durchgehend der Weltvertrag aus plan.md 5.5, an diesem Modell
// gemessen: oben = +y, Charakter-vorne = +z, links = +x. Der Maßstab kommt aus
// dem Modell, nichts wird getippt.
//
// Die beiden Fallstricke dieses Modells sind hier gebaut, nicht angenommen:
//   - Die Bind-Pose ist eine T-Pose: Armspannweite (x) und Körperhöhe (y)
//     unterscheiden sich nur um 0,4 % — wer die größte Ausdehnung für die Höhe
//     hält, merkt den Fehler an keinem Schwellwert. Geprüft wird deshalb der
//     y-Ausdruck gegen die eigene Nachmessung, nicht ein Zahlenwert.
//   - Die Vertexpositionen der SkinnedMeshes liegen im Bind-Space; die
//     Nachmessung hier nutzt mesh.getVertexPosition (berücksichtigt die Haut)
//     und danach mesh.localToWorld — applyMatrix4(matrixWorld) allein auf die
//     Rohpositionen wäre doppelt gerechnet.
//
// Läuft ohne Browser: node --test "src/**/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { loadGLB, getBounds } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer, REPO_ROOT, glbZerlegen, glbBauen } from '../scene/testdaten.mjs';
import { validateRigProfile } from '../contracts/rig-profile.js';
import { detectRig } from './detect.js';
import {
  measureRigProfile,
  measureMasses,
  measureSoles,
  measureJoints,
  CONTACT_MARGIN,
  PROBE_DEG,
  DEAD_MOVE_FRACTION,
  RADIUS_DEVIATION_MAX,
  SOLE_COVERAGE_MIN,
  SOLE_TOLERANCE,
  RADIUS_PERCENTILE,
} from './measure.js';

// ─────────────────────────────────────────────────────────────────────────────
// Eigenständige Nachmessungen — bewusste Doppelung
//
// Der Abnahmetest prüft eine Nachbedingung, er darf sie nicht mit derselben
// Rekonstruktion tun wie die Vermessung selbst. Deshalb stehen hier ein eigener
// Lastweg über alle SkinnedMeshes und eine eigene Wirkungsmessung am Kettenende.
// ─────────────────────────────────────────────────────────────────────────────

/** Frisches Modell — jede Prüfung lädt ihre eigene Kopie, Abtastung verändert die Szene. */
async function ladeXbot() {
  return loadGLB(alsArrayBuffer(XBOT_PFAD));
}

/** Skelett und alle gehäuteten Meshes der Szene. */
function hautwerke(scene) {
  const meshes = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const lastwerk = meshes.length ? meshes[0].skeleton : null;
  const gelenke = new Map((lastwerk ? lastwerk.bones : []).map((b) => [b.name, b]));
  return { meshes, lastwerk, gelenke };
}

/**
 * Weltposition aller Vertex der Bind-Pose über die Haut (getVertexPosition),
 * nicht über die Matrix des Meshes.
 */
function bindVertices(scene) {
  const { meshes } = hautwerke(scene);
  const p = new THREE.Vector3();
  const out = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      mesh.getVertexPosition(i, p);
      mesh.localToWorld(p);
      out.push(p.clone());
    }
  }
  return out;
}

/** y-Ausdruck der echten Hülle: das ist die Körperhöhe, nicht die Armspannweite. */
function huellenhochAchse(scene) {
  const { min, max } = getBounds(scene);
  return { hoehe: max.y - min.y, boden: min.y };
}

/**
 * Messbare Wirkung eines Freiheitsgrads, unabhängig von measure.js:
 * Gelenkknochen um achse*grad drehen, Verschiebung des Kettenendes messen.
 * Rueckgabe {verschiebung, weg} — verschiebung in Weltkoordinaten.
 */
function wirkung(scene, gelenke, lastwerk, gelenkKnochen, endKnochen, achse, grad) {
  const kn = gelenke.get(gelenkKnochen);
  const end = gelenke.get(endKnochen);
  if (!kn || !end) {
    throw new Error(`Wirkungsmessung unmöglich: ${kn ? 'Endknochen' : 'Gelenkknochen'} „${kn ? endKnochen : gelenkKnochen}“ fehlt im Skelett mit ${gelenke.size} Knochen`);
  }
  const achsenvektor = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[achse];
  if (!achsenvektor) throw new Error(`Wirkungsmessung: Achse „${achse}“ unbekannt, erwartet x, y oder z`);

  scene.updateMatrixWorld(true);
  const vor = end.getWorldPosition(new THREE.Vector3());
  const sicherung = kn.quaternion.clone();
  kn.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...achsenvektor), grad * Math.PI / 180));
  scene.updateMatrixWorld(true);
  if (lastwerk) lastwerk.update();
  const nach = end.getWorldPosition(new THREE.Vector3());
  kn.quaternion.copy(sicherung);
  scene.updateMatrixWorld(true);
  if (lastwerk) lastwerk.update();
  const verschiebung = nach.sub(vor);
  return { verschiebung, weg: verschiebung.length() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Abnahmetabelle „benannte Richtung“ — Handbuchwissen, nicht Messgröße
//
// Was ein positiver Wert eines Freiheitsgrads am Kettenende tun MUSS, steht im
// Namen des Freiheitsgrads und im Weltvertrag (plan.md 5.5: oben +y, vorne +z,
// links +x). Diese Tabelle ist die Prüfungsannahme; gemessen wird die Wirkung.
// Belegt: 30 Freiheitsgrade ohne Twist, je 18 Gelenke.
// ─────────────────────────────────────────────────────────────────────────────

const RICHTUNG = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** joint.dof -> [Richtung, in die ein positiver Wert das Kettenende bewegt] */
const BENANNTE_RICHTUNG = {
  'pelvis.tilt': ['+z'], 'pelvis.roll': ['+x'],
  'spine.bend': ['+z'], 'spine.side': ['+x'],
  'neck.bend': ['+z'], 'neck.side': ['+x'],
  'head.bend': ['+z'], 'head.side': ['+x'],
  'shoulder_l.shrug': ['+y'], 'shoulder_l.fwd': ['+z'],
  'shoulder_r.shrug': ['+y'], 'shoulder_r.fwd': ['+z'],
  'arm_l.lift': ['+y'], 'arm_l.swing': ['+z'],
  'arm_r.lift': ['+y'], 'arm_r.swing': ['+z'],
  // Ellbogen: Achse im Katalog auf 'y' umgestellt (gemessen am Xbot: nur 'y'
  // führt die Hand nach VORN zur Schulter, 'z' kippte sie seitlich nach
  // oben). Die benannte Richtung folgt: + beugt, Hand kommt nach +z vorn.
  'elbow_l.bend': ['+z'], 'elbow_r.bend': ['+z'],
  'hip_l.flex': ['+z'], 'hip_l.spread': ['+x'],
  'hip_r.flex': ['+z'], 'hip_r.spread': ['-x'],
  'knee_l.bend': ['-z'], 'knee_r.bend': ['-z'],
  'ankle_l.point': ['-y'], 'ankle_l.tilt': ['+x'],
  'ankle_r.point': ['-y'], 'ankle_r.tilt': ['-x'],
  'toes_l.bend': ['-y'], 'toes_r.bend': ['-y'],
};

/** Die Freiheitsgrade, die am Kettenende nicht messbar sind (plan.md 3.5). */
const TWIST_DOF = [
  'pelvis.turn', 'spine.turn', 'neck.turn', 'head.turn',
  'arm_l.twist', 'arm_r.twist', 'elbow_l.twist', 'elbow_r.twist',
  'hip_l.twist', 'hip_r.twist',
];

/** Twist-Kanäle, deren Richtungstext seitenbezogen ist („nach außen") und die
 *  deshalb auf der rechten Seite das umgekehrte Vorzeichen tragen. Kanäle mit
 *  absoluter Richtung („vorwärts rollend", „nach links") stehen hier nicht. */
const GESPIEGELTE_TWIST_DOF = new Set(['hip_r.twist']);

function richtungsvektor(kennung) {
  const [text] = BENANNTE_RICHTUNG[kennung];
  const vorzeichen = text[0] === '-' ? -1 : 1;
  return RICHTUNG[text[text.length - 1]].map((k) => k * vorzeichen);
}

/**
 * Prüft das Profil der Vorzeichen gegen die benannten Richtungen.
 * Ein gemessener Freiheitsgrad gilt als falsch, wenn die vom Profil verlangte
 * Drehung (vorzeichen * Abtastwinkel) das Kettenende nicht nachweisbar in die
 * benannte Richtung bewegt. Rueckgabe der Beanstandungen, je mit Zahl.
 */
function vorzeichenbeanstandungen(gltf, joints, nachweisgrenze) {
  const { lastwerk, gelenke } = hautwerke(gltf.scene);
  const bo = [];
  const ende = {
    pelvis: 'HeadTop_End', spine: 'HeadTop_End', neck: 'HeadTop_End', head: 'HeadTop_End',
    shoulder_l: 'LeftHandMiddle3', shoulder_r: 'RightHandMiddle3',
    arm_l: 'LeftHandMiddle3', arm_r: 'RightHandMiddle3',
    elbow_l: 'LeftHandMiddle3', elbow_r: 'RightHandMiddle3',
    hip_l: 'LeftToe_End', hip_r: 'RightToe_End', knee_l: 'LeftToe_End', knee_r: 'RightToe_End',
    ankle_l: 'LeftToe_End', ankle_r: 'RightToe_End', toes_l: 'LeftToe_End', toes_r: 'RightToe_End',
  };
  for (const [gelenk, j] of Object.entries(joints)) {
    for (const [dof, spec] of Object.entries(j.dof)) {
      const kennung = `${gelenk}.${dof}`;
      if (spec.signSource !== 'gemessen') continue;
      if (!BENANNTE_RICHTUNG[kennung]) {
        bo.push(`${kennung}: als gemessen ausgegeben, aber ohne benannte Richtung in der Abnahmetabelle`);
        continue;
      }
      const { verschiebung, weg } = wirkung(
        gltf.scene, gelenke, lastwerk, j.bone, 'mixamorig' + ende[gelenk], spec.axis, spec.sign * PROBE_DEG);
      const richtung = richtungsvektor(kennung);
      const inBenannterRichtung = verschiebung.x * richtung[0]
        + verschiebung.y * richtung[1] + verschiebung.z * richtung[2];
      if (weg < nachweisgrenze) {
        bo.push(`${kennung}: ${spec.axis}-Achse mit Vorzeichen ${spec.sign} bewegt ${ende[gelenk]} um ${weg.toFixed(4)} m — unter der Nachweisgrenze von ${nachweisgrenze.toFixed(4)} m`);
      } else if (inBenannterRichtung <= 0) {
        bo.push(`${kennung}: ${spec.axis}-Achse mit Vorzeichen ${spec.sign} bewegt ${ende[gelenk]} um ${inBenannterRichtung.toFixed(4)} m in die benannte Richtung ${BENANNTE_RICHTUNG[kennung][0]} — erwartet > 0 m (betreffende Achse war ${spec.axis}, gemessene Wirkung [${verschiebung.toArray().map((n) => n.toFixed(4)).join(', ')}])`);
      }
    }
  }
  return bo;
}

/**
 * Prüft, ob die Vermessung das ganze Modell erfasst: melde Höhe und Vertexzahl
 * gegen die eigene Nachmessung aller SkinnedMeshes. Rueckgabe mit Zahlen.
 */
function vollstaendigkeitbeanstandungen(profil, scene) {
  const bo = [];
  const { meshes, } = hautwerke(scene);
  const eigene = bindVertices(scene);
  const huelle = huellenhochAchse(scene);
  const hoch = eigene.reduce((a, p) => Math.max(a, p.y), -Infinity);
  const tief = eigene.reduce((a, p) => Math.min(a, p.y), Infinity);
  const eigeneHoehe = hoch - tief;
  const eigeneVertices = eigene.length;

  const abweichung = Math.abs(profil.world.height - eigeneHoehe);
  if (abweichung > 0.01 * eigeneHoehe) {
    bo.push(`world.height ${profil.world.height} m weicht von der nachgemessenen Hüllhöhe ${eigeneHoehe.toFixed(4)} m um ${abweichung.toFixed(4)} m ab (${(100 * abweichung / eigeneHoehe).toFixed(1)} % der Körperhöhe) — BBox der Szene y ${huelle.boden.toFixed(4)}..${(huelle.boden + huelle.hoehe).toFixed(4)} m`);
  }
  if (profil.source.vertexCount !== eigeneVertices) {
    bo.push(`source.vertexCount ${profil.source.vertexCount} sind nicht alle Vertex der Bind-Pose: nachgemessen ${eigeneVertices} Vertex in ${meshes.length} SkinnedMeshes, es fehlen ${eigeneVertices - profil.source.vertexCount}`);
  }
  return bo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 1 — Massen
// ─────────────────────────────────────────────────────────────────────────────

test('Massen, Positivfall: Schwerpunkt der Bind-Pose liegt in der Standfläche', async () => {
  const m = measureMasses(await ladeXbot());

  assert.ok(m.insideSupportPolygon,
    `Schwerpunkt [${m.comXYZ.join(', ')}] liegt außerhalb der Standfläche mit ${m.supportPolygon.length} Ecken — eine ruhende Figur darf nicht kippen`);
  assert.ok(m.totalMassKg > 0 && Number.isFinite(m.totalMassKg),
    `Gesamtmasse ${m.totalMassKg} kg über ${m.segments.length} Segmente — erwartet > 0 kg`);

  // Nachgemessene Höhe, nicht getippt: der Schwerpunkt muss im oberen Bereich
  // der Figur liegen, sonst ist die Massenverteilung Unsinn.
  const huelle = huellenhochAchse((await ladeXbot()).scene);
  const anteil = (m.comXYZ[1] - huelle.boden) / huelle.hoehe;
  assert.ok(anteil > 0.45 && anteil < 0.70,
    `Schwerpunkt auf ${(anteil * 100).toFixed(1)} % der nachgemessenen Körperhöhe ${huelle.hoehe.toFixed(4)} m — erwartet zwischen 45 und 70 %`);

  // T-Pose: die Arme tragen symmetrisch — der Schwerpunkt muss in x mitten
  // stehen, die Armspannweite darf ihn nicht verschieben.
  assert.ok(Math.abs(m.comXYZ[0]) < 0.01 * huelle.hoehe,
    `Schwerpunkt x = ${m.comXYZ[0]} m bei Armspannweite ${huelle.hoehe.toFixed(4)} m — Abweichung über 1 % der Körperhöhe, Symmetrie fehlerhaft`);
});

test('Massen, Negativfall: verdreifachte Handmasse verschiebt den Schwerpunkt messbar', async () => {
  const basis = measureMasses(await ladeXbot());
  const huelle = huellenhochAchse((await ladeXbot()).scene);
  const grenzeNachweisbar = 0.01 * huelle.hoehe;

  const gedreifacht = measureMasses(await ladeXbot(), { massOverrides: { hand_l: 3 } });
  const schubX = gedreifacht.comXYZ[0] - basis.comXYZ[0];

  assert.ok(schubX > grenzeNachweisbar,
    `hand_l × 3 verschiebt den Schwerpunkt um ${schubX.toFixed(4)} m in x — erwartet mehr als ${grenzeNachweisbar.toFixed(4)} m (1 % der Körperhöhe ${huelle.hoehe.toFixed(4)} m); wäre der Wert 0, reagiert die Schwerpunktrechnung auf die Masse gar nicht`);
  assert.ok(gedreifacht.totalMassKg > basis.totalMassKg,
    `Gesamtmasse nach Verdreiung ${gedreifacht.totalMassKg} kg, vorher ${basis.totalMassKg} kg — die zusätzliche Masse taucht in der Summe nicht auf`);

  // Der zweite Teil der Abnahmereihe: HERAUS aus der Standfläche. Der Faktor
  // ist an diesem Modell nachgemessen, nicht geschätzt. Die Standfläche beider
  // Füße reicht in x bis ±0,1449 m, der Schwerpunkt liegt bei x = 0,0003 m.
  // Gemessene Schwerpunktlage nach hand_l × f:
  //   f =  3 → 0,0281 m   f =  8 → 0,0896 m   f = 15 → 0,1609 m
  // Der frühere Faktor 8 blieb mit 0,0896 m von 0,1449 m INNERHALB der
  // Standfläche — der Test war zu schwach dosiert, nicht die Prüfung untätig.
  // Faktor 15 tritt heraus; Faktor 8 muss weiterhin drin bleiben, sonst meldet
  // die Prüfung Überstand, wo keiner ist.
  const faktorDrin = 8, faktorHeraus = 15;
  const knapp = measureMasses(await ladeXbot(), { massOverrides: { hand_l: faktorDrin } });
  const grenzeX = Math.max(...basis.supportPolygon.map((p) => p[0]));
  assert.ok(knapp.insideSupportPolygon,
    `hand_l × ${faktorDrin} mit Schwerpunkt x = ${knapp.comXYZ[0].toFixed(4)} m gilt schon als außerhalb der Standfläche (Rand ${grenzeX.toFixed(4)} m) — die Prüfung meldet Überstand, wo keiner ist`);

  const heraus = measureMasses(await ladeXbot(), { massOverrides: { hand_l: faktorHeraus } });
  assert.ok(!heraus.insideSupportPolygon,
    `hand_l × ${faktorHeraus} mit Schwerpunkt x = ${heraus.comXYZ[0].toFixed(4)} m liegt weiterhin innerhalb der Standfläche (Rand ${grenzeX.toFixed(4)} m) — die Prüfung auf Standflächenüberstand reagiert nicht`);
  assert.ok(basis.supportPolygon.length >= 3 && heraus.supportPolygon.length === basis.supportPolygon.length,
    `Standfläche verändert sich durch die Massenänderung: ${basis.supportPolygon.length} → ${heraus.supportPolygon.length} Ecken — die Geometrie darf von einem Massenhaken nicht abhängen`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 2 — Radien
// ─────────────────────────────────────────────────────────────────────────────

/** Eigenständige Hülle je Segment: größter und perzentiler Abstand zur Achse.
 *
 *  `perzentil` rechnet wie die Radiusmessung selbst (Perzentil über ALLE
 *  Abstände) und prüft damit nur die Vertexzuordnung — nicht das Verfahren.
 *  `stationen` ist die eigentliche unabhängige Nachmessung: zehn Scheiben
 *  entlang der Achse, je das Perzentil ihrer Abstände, daraus der Median.
 *  Sie ist hier zweitimplementiert, damit ein Rechenfehler in measure.js
 *  auffällt statt sich in beide Seiten des Vergleichs fortzupflanzen — genau
 *  dieser Fall trat ein: dort wurde das Perzentil auf ein unsortiertes Array
 *  gezogen, die Stationshülle fiel um bis zu 37 % zu klein aus. */
function segmenthuelle(gltf, segment) {
  const { gelenke, meshes } = hautwerke(gltf.scene);
  const a = gelenke.get(segment.from).getWorldPosition(new THREE.Vector3());
  const b = gelenke.get(segment.to).getWorldPosition(new THREE.Vector3());
  const ab = b.clone().sub(a);
  const laenge2 = ab.lengthSq();
  const praefixe = [
    ['HeadTop_End', 'head'], ['Head', 'head'], ['Neck', 'head'],
    ['Hips', 'torso'], ['Spine', 'torso'], ['LeftShoulder', 'torso'], ['RightShoulder', 'torso'],
    ['LeftArm', 'upperarm_l'], ['LeftForeArm', 'forearm_l'], ['LeftHand', 'hand_l'],
    ['RightArm', 'upperarm_r'], ['RightForeArm', 'forearm_r'], ['RightHand', 'hand_r'],
    ['LeftUpLeg', 'thigh_l'], ['LeftLeg', 'shin_l'], ['LeftFoot', 'foot_l'], ['LeftToe', 'foot_l'],
    ['RightUpLeg', 'thigh_r'], ['RightLeg', 'shin_r'], ['RightFoot', 'foot_r'], ['RightToe', 'foot_r'],
  ];
  function segmentDesKnochens(name) {
    let best = null, besteLaenge = -1;
    for (const [pr, sg] of praefixe) {
      if (name.startsWith('mixamorig' + pr) && pr.length > besteLaenge) { best = sg; besteLaenge = pr.length; }
    }
    return best;
  }
  const p = new THREE.Vector3();
  const abstaende = [];
  const laengsAnteile = [];
  for (const mesh of meshes) {
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      let besteW = -1, besterK = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k), kn = si.getComponent(i, k);
        if (w > besteW) { besteW = w; besterK = kn; }
      }
      if (besteW < 0.5) continue;
      const knochen = mesh.skeleton.bones[besterK];
      if (!knochen || segmentDesKnochens(knochen.name) !== segment.id) continue;
      mesh.getVertexPosition(i, p);
      mesh.localToWorld(p);
      const t = laenge2 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / laenge2)) : 0;
      abstaende.push(p.distanceTo(a.clone().addScaledVector(ab, t)));
      laengsAnteile.push(t);
    }
  }
  const anQuantil = (sortiert, q) =>
    sortiert[Math.min(sortiert.length - 1, Math.max(0, Math.round((sortiert.length - 1) * q)))];

  // Stationsprofil, unabhängig gerechnet: zehn Scheiben, je das Perzentil der
  // Abstände darin, daraus der Median über die Stationen.
  const paare = abstaende.map((d, i) => ({ d, t: laengsAnteile[i] }));
  const proStation = [];
  for (let k = 0; k < 10; k++) {
    const mitte = (k + 0.5) / 10;
    const scheibe = paare.filter((x) => Math.abs(x.t - mitte) <= 1 / 20)
      .map((x) => x.d).sort((x, y) => x - y);
    if (scheibe.length >= 4) proStation.push(anQuantil(scheibe, RADIUS_PERCENTILE));
  }
  proStation.sort((x, y) => x - y);

  abstaende.sort((x, y) => x - y);
  return {
    groesster: abstaende[abstaende.length - 1] ?? 0,
    perzentil: anQuantil(abstaende, RADIUS_PERCENTILE),
    stationen: proStation.length ? anQuantil(proStation, 0.5) : 0,
    stationsZahl: proStation.length,
    anzahl: abstaende.length,
  };
}

test('Radien, Positivfall: gemessener Radius liegt an der Mesh-Hülle', async () => {
  const gltf = await ladeXbot();
  const profil = measureRigProfile(gltf, { fileName: 'Xbot.glb' });
  const huelle = huellenhochAchse(gltf.scene);

  assert.strictEqual(profil.segments.length, 14,
    `Profil enthält ${profil.segments.length} Segmente, erwartet 14 (Bein, Arm, Rumpf, Kopf je Seite)`);

  const bo = [];
  for (const s of profil.segments) {
    const h = segmenthuelle(gltf, s);
    if (h.anzahl === 0) { bo.push(`${s.id}: 0 Vertex dieser Segmentzuordnung nachgemessen`); continue; }
    const abweichung = Math.abs(h.perzentil - s.radius) / h.perzentil;
    if (abweichung > RADIUS_DEVIATION_MAX) {
      bo.push(`${s.id}: Radius ${s.radius} m gegen nachgemessene Hülle ${h.perzentil.toFixed(4)} m = ${(abweichung * 100).toFixed(1)} % Abweichung, Grenze ${(RADIUS_DEVIATION_MAX * 100).toFixed(0)} %`);
    }
    if (s.radius > h.groesster * 1.001) {
      bo.push(`${s.id}: Radius ${s.radius} m größer als die höchste Mesh-Ausdehnung ${h.groesster.toFixed(4)} m`);
    }
    // Unabhängige Nachmessung des Stationsprofils. Sie fängt Rechenfehler in
    // measure.js, die sich der Zeile darüber entziehen, weil die dort dieselbe
    // Formel wie die Radiusmessung benutzt.
    if (h.stationsZahl < 5) {
      bo.push(`${s.id}: nur ${h.stationsZahl} von 10 Stationen mit mindestens 4 Vertex besetzt — Stationsprofil nicht aussagekräftig`);
    } else {
      const stAbw = Math.abs(h.stationen - s.radius) / h.stationen;
      if (stAbw > RADIUS_DEVIATION_MAX) {
        bo.push(`${s.id}: Radius ${s.radius} m gegen nachgemessenes Stationsprofil ${h.stationen.toFixed(4)} m (${h.stationsZahl} Stationen) = ${(stAbw * 100).toFixed(1)} % Abweichung, Grenze ${(RADIUS_DEVIATION_MAX * 100).toFixed(0)} %`);
      }
    }
  }
  assert.deepStrictEqual(bo, [], `Radien weichen von der Mesh-Hülle ab:\n  ${bo.join('\n  ')}`);

  // Die Hüllenprüfung im Profil selbst darf bei diesem Modell nichts melden.
  const warnungen = profil.warnings.filter((w) => /Hülle|weicht .* ab/.test(w));
  assert.deepStrictEqual(warnungen, [], `Profil meldet Radienabweichungen, wo keine sind: ${warnungen.join(' | ')}`);

  // Link/Rechts-Gleichheit ist an diesem Modell gemessen meßbar: symmetrische
  // Figur, symmetrische Zuordnung.
  for (const [links, rechts] of [['upperarm_l', 'upperarm_r'], ['thigh_l', 'thigh_r'], ['foot_l', 'foot_r']]) {
    const l = profil.segments.find((s) => s.id === links).radius;
    const r = profil.segments.find((s) => s.id === rechts).radius;
    assert.ok(Math.abs(l - r) < 0.02 * huelle.hoehe,
      `${links} Radius ${l} m gegen ${rechts} ${r} m: Differenz ${(l - r).toFixed(4)} m über 2 % der Körperhöhe — eine Seite wurde anders vermessen`);
  }
});

test('Radien, Negativfall: ein halbierter Radius wird von der Hüllenprüfung gemeldet', async () => {
  const gltf = await ladeXbot();
  const unveraendert = measureRigProfile(gltf, { fileName: 'Xbot.glb' });

  const gltf2 = await ladeXbot();
  const halbiert = measureRigProfile(gltf2, { fileName: 'Xbot.glb', radiusOverrides: { thigh_l: 0.5 } });

  const gemeldete = halbiert.warnings.filter((w) => /thigh_l/.test(w) && /Hülle/.test(w));
  assert.ok(gemeldete.length > 0,
    `thigh_l auf die Hälfte gesetzt (${unveraendert.segments.find((s) => s.id === 'thigh_l').radius} → ${halbiert.segments.find((s) => s.id === 'thigh_l').radius} m) ergibt keine Warnung; Warnungen waren: ${halbiert.warnings.join(' | ') || 'keine'}`);
  assert.match(gemeldete[0], /\d/, `Warnung muss eine Zahl enthalten, war: "${gemeldete[0]}"`);
  assert.ok(unveraendert.warnings.length === 0,
    `Unverändertes Modell meldet schon ${unveraendert.warnings.length} Warnungen: ${unveraendert.warnings.join(' | ')}`);
});

test('Verfahrensparameter: gemeldetes Perzentil ist das benutzte', async () => {
  const unveraendert = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb' });
  const anderes = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb', radiusPercentile: 0.5 });

  assert.strictEqual(anderes.params.radiusPercentile, 0.5,
    `params.radiusPercentile meldet ${anderes.params.radiusPercentile}, erwartet 0,5`);

  const unterschied = anderes.segments.filter((s, i) =>
    s.radius !== unveraendert.segments[i].radius).length;
  assert.ok(unveraendert.params.radiusPercentile === RADIUS_PERCENTILE,
    `params.radiusPercentile des Standardlaufs ist ${unveraendert.params.radiusPercentile}, erwartet ${RADIUS_PERCENTILE}`);
  assert.ok(unterschied > 0,
    `Perzentil 0,5 geändert, aber alle ${unveraendert.segments.length} Radien bleiben identisch (z. B. thigh_l ${anderes.segments.find((s) => s.id === 'thigh_l').radius} m) — das Profil meldet einen Parameter, der nicht benutzt wurde`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 3 — Sohlen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modell mit angehobener Ferse: beide Füße um streckGrad nach unten drehen
 * (Zeh absenken) und die Figur auf den Boden setzen. Das ist ein Modell, das
 * auf dem Ballen steht — kein Umhängen des ganzen Körpers.
 */
async function aufDemBallen(streckGrad) {
  const gltf = await ladeXbot();
  const { gelenke, lastwerk } = hautwerke(gltf.scene);
  for (const name of ['mixamorigLeftFoot', 'mixamorigRightFoot']) {
    gelenke.get(name).quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), streckGrad * Math.PI / 180));
  }
  gltf.scene.updateMatrixWorld(true);
  if (lastwerk) lastwerk.update();

  const tief = Math.min(...bindVertices(gltf.scene).map((p) => p.y));
  gltf.scene.position.y = -tief;
  gltf.scene.updateMatrixWorld(true);
  if (lastwerk) lastwerk.update();
  return gltf;
}

test('Sohlen, Positivfall: erkannte Fläche deckt die Fußlänge und sitzt auf dem Boden', async () => {
  const gltf = await ladeXbot();
  const { soles, stats } = measureSoles(gltf);
  const huelle = huellenhochAchse(gltf.scene);

  for (const seite of ['l', 'r']) {
    const st = stats[seite];
    assert.ok(st.vertexCount >= 4, `Sohle ${seite}: nur ${st.vertexCount} Vertex in Bodennähe`);
    assert.ok(st.coverage >= SOLE_COVERAGE_MIN,
      `Sohle ${seite}: erkannte Fläche ${st.soleLength} m von ${st.footLength} m Fußlänge = ${(st.coverage * 100).toFixed(0)} %, verlangt sind ${(SOLE_COVERAGE_MIN * 100).toFixed(0)} %`);
    assert.ok(st.heelLiftMeters !== null && st.heelLiftMeters < CONTACT_MARGIN,
      `Sohle ${seite}: Höhendifferenz Ferse/Ballen ${st.heelLiftMeters} m über dem Kontaktzuschlag ${CONTACT_MARGIN} m — die stehende Figur wird als Ballenstand vermessen`);
  }

  assert.strictEqual(soles.length, 8,
    `${soles.length} Sohlenpunkte erkannt, erwartet 8 (je vier Ecken pro Fuß)`);

  // Nachprüfung im Weltvertrag: ein Sohlenpunkt in Knochen-lokalen Koordinaten
  // muss, zurückgerechnet, im Bodennäheband liegen — nicht 13 Einheiten daneben.
  const { gelenke } = hautwerke(gltf.scene);
  const band = huelle.hoehe * SOLE_TOLERANCE;
  for (const s of soles) {
    const kn = gelenke.get(s.bone);
    const welt = kn.localToWorld(new THREE.Vector3(...s.local));
    assert.ok(welt.y - huelle.boden >= -0.01 * huelle.hoehe && welt.y - huelle.boden <= band,
      `${s.id}: zurückgerechnet auf y = ${welt.y.toFixed(4)} m, Bodenhöhe ${huelle.boden.toFixed(4)} m — Überhöhung ${(welt.y - huelle.boden).toFixed(4)} m über dem Bodennäheband von ${band.toFixed(4)} m (Sohlentoleranz ${SOLE_TOLERANCE} der Körperhöhe)`);
    assert.ok(Number.isFinite(welt.x) && Number.isFinite(welt.z),
      `${s.id}: zurückgerechnete Weltlage ${welt.toArray().join(', ')} ist keine endliche Zahl`);
  }
});

test('Sohlen, Negativfall: angehobene Ferse wird erkannt, nicht stillschweigend vermessen', async () => {
  const flach = await ladeXbot();
  const flachProfil = measureRigProfile(flach, { fileName: 'Xbot.glb' });

  // Der Ballenstand ist eine verstellte Pose. Die Erkennung liest die
  // Blickrichtung darin nicht mehr eindeutig; sie meldet die Fußrolle nur mit
  // Konfidenz 0,58 und rutscht die ganze Beinkette ein Gelenk nach unten
  // (foot_l auf den Zehenknochen). Das ist die Rückfragezone aus plan.md 5.1:
  // dort wird gemessen, aber gefragt, statt zu raten. Diese Prüfung will die
  // Sohle eines bekannten Fußes sehen, nicht die einer vorläufigen Zuordnung,
  // und gibt deshalb die Antwort des Menschen gleich mit: dieselbe Zuordnung,
  // die dieselbe Figur im ruhigen Stand liefert, über opts.roles.
  const antwort = {};
  for (const [rolle, v] of Object.entries(detectRig(await ladeXbot()).roles)) {
    antwort[rolle] = v.bone;
  }
  const ballen = await aufDemBallen(20);
  const { stats } = measureSoles(ballen, { roles: antwort });
  const ballenProfil = measureRigProfile(ballen, { fileName: 'ballen.glb', roles: antwort });

  for (const seite of ['l', 'r']) {
    assert.ok(stats[seite].coverage < SOLE_COVERAGE_MIN,
      `Fuß auf dem Ballen: erkannte Sohlenfläche deckt ${(stats[seite].coverage * 100).toFixed(0)} % der Fußlänge ab — über der Grenze von ${(SOLE_COVERAGE_MIN * 100).toFixed(0)} %, der angehobene Kontakt würde also nicht bemerkt`);
  }

  const melden = ballenProfil.warnings.filter((w) => /Sohle/.test(w));
  assert.ok(melden.length >= 2,
    `Ballenmodell erzeugt ${melden.length} Sohlenwarnungen, erwartet mindestens 2 (je eine pro Fuß): ${ballenProfil.warnings.join(' | ') || 'keine'}`);
  for (const w of melden) assert.match(w, /\d/, `Sohlenwarnung ohne Zahl: "${w}"`);
  assert.ok(flachProfil.warnings.filter((w) => /Sohle/.test(w)).length === 0,
    `flaches Standmodell meldet bereits Sohlenwarnungen: ${flachProfil.warnings.join(' | ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 4 — Vorzeichen
// ─────────────────────────────────────────────────────────────────────────────

test('Vorzeichen, Positivfall: jeder gemessene Freiheitsgrad wirkt in die benannte Richtung', async () => {
  const gltf = await ladeXbot();
  const { gelenke, lastwerk } = hautwerke(gltf.scene);
  const huelle = huellenhochAchse(gltf.scene);
  const nachweisgrenze = huelle.hoehe * DEAD_MOVE_FRACTION;

  const { joints, counts } = measureJoints(gltf);

  const erwarteteAnzahl = Object.keys(BENANNTE_RICHTUNG).length;
  assert.strictEqual(counts.measurable, erwarteteAnzahl,
    `${counts.measurable} von ${erwarteteAnzahl} benannten Freiheitsgraden als messbar erkannt (nicht messbar: ${counts.notMeasurable}) — die Abtastung bewegt das Kettenende nicht, also ist kein einziges Vorzeichen gemessen`);

  const bo = vorzeichenbeanstandungen(gltf, joints, nachweisgrenze);
  assert.deepStrictEqual(bo, [], `Vorzeichen wirken nicht in die benannte Richtung:\n  ${bo.join('\n  ')}`);

  // Die drei im Vortest (plan.md 3.5) gefundenen Fehlerarten müssen als gemessene
  // Vorzeichen sichtbar sein, sonst wird nur ein Erfolg bestätigt.
  assert.strictEqual(joints.hip_l.dof.flex.sign, -1,
    `Hüftbeugung links meldet Vorzeichen ${joints.hip_l.dof.flex.sign}; erwartet -1 — die rawe +20°-Drehung bewegt den Zeh um 0,3440 m nach hinten`);
  assert.notStrictEqual(joints.shoulder_l.dof.shrug.sign, joints.shoulder_r.dof.shrug.sign,
    `Schulterheben meldet für beide Seiten Vorzeichen ${joints.shoulder_l.dof.shrug.sign} — in einer T-Pose wirkt die Weltachse für links und rechts entgegengesetzt, eine fehlende Spiegelung bleibt so unsichtbar`);
});

test('Vorzeichen, Negativfall: ein absichtlich invertiertes Vorzeichen wird gemeldet', async () => {
  const gltf = await ladeXbot();
  const huelle = huellenhochAchse(gltf.scene);
  const nachweisgrenze = huelle.hoehe * DEAD_MOVE_FRACTION;

  const { gelenke, lastwerk } = hautwerke(gltf.scene);
  const korrekt = measureJoints(gltf);
  assert.deepStrictEqual(vorzeichenbeanstandungen(gltf, korrekt.joints, nachweisgrenze), [],
    'unveränderte Vermessung wird bereits beanstandet — der Negativfall kann nichts Neues finden');

  const gltf2 = await ladeXbot();
  const kaputt = measureJoints(gltf2, { invert: { 'hip_l.flex': true } });
  const bo = vorzeichenbeanstandungen(gltf2, kaputt.joints, nachweisgrenze);

  assert.strictEqual(bo.length, 1,
    `invertiertes Vorzeichen an hip_l.flex führt zu ${bo.length} Beanstandungen, erwartet 1: ${bo.join(' | ') || 'keine'}`);
  assert.match(bo[0], /hip_l\.flex/, `Beanstandung nennt das Gelenk nicht: "${bo[0]}"`);
  assert.match(bo[0], /\d/, `Beanstandung nennt keine Zahl: "${bo[0]}"`);
  assert.notStrictEqual(kaputt.joints.hip_l.dof.flex.sign, korrekt.joints.hip_l.dof.flex.sign,
    `die Invertierung hat das gemeldete Vorzeichen nicht geändert (beide ${korrekt.joints.hip_l.dof.flex.sign}) — der Testhaken wirkt nicht`);
  void gelenke; void lastwerk;
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 4b — Vorzeichen-Normierung links/rechts
//
// Der gemeldete Fehler: die Grenzwerte waren links und rechts gespiegelt
// (arm_r.lift [-170, 40]). Ein Agent, der beide Arme mit +80 hebt, wurde
// rechts auf 40 geklemmt. Nach der Normierung gilt: das gemessene Vorzeichen
// trägt die Spiegelung, die Grenzen sind auf beiden Seiten gleich.
// ─────────────────────────────────────────────────────────────────────────────

/** Paare spiegelbildlicher Gelenke für die Grenz- und Richtungsvergleiche. */
const SEITENPAARE = [
  ['shoulder_l', 'shoulder_r'], ['arm_l', 'arm_r'],
  ['elbow_l', 'elbow_r'], ['hip_l', 'hip_r'],
  ['knee_l', 'knee_r'], ['ankle_l', 'ankle_r'], ['toes_l', 'toes_r'],
];

function symmetrieluecken(joints) {
  const bo = [];

  // 1. Paare gleicher Gelenke: Grenzwerte links und rechts identisch. Genau
  //    hier klemmte vorher die rechte Seite anders als die linke.
  for (const [links, rechts] of SEITENPAARE) {
    if (!joints[links] || !joints[rechts]) continue;
    for (const [dof, l] of Object.entries(joints[links].dof)) {
      const r = joints[rechts].dof[dof];
      if (!r) { bo.push(`${rechts}.${dof}: fehlt, links vorhanden`); continue; }
      if (l.limit[0] !== r.limit[0] || l.limit[1] !== r.limit[1]) {
        bo.push(`${links}.${dof} und ${rechts}.${dof} haben verschiedene Grenzen: ` +
          `[${l.limit}] gegen [${r.limit}] — ein Agent, der beide Seiten mit ` +
          'demselben positiven Wert bewegt, wird rechts anders geklemmt als links');
      }
    }
  }

  // 2. Die Grenzen gelten für den normalisierten Wert: die Anatomie muss nach
  //    + zeigen. Ein Maximum <= 0 hieße: der positive Wert des Freiheitsgrads
  //    ist immer verboten — genau der arm_r.lift-Fehler. Nur das Knie darf
  //    bei 0 beginnen (gestrecktes Knie ist die 0, Beugung geht nach +).
  for (const [gelenk, j] of Object.entries(joints)) {
    for (const [dof, spec] of Object.entries(j.dof)) {
      const istKnie = gelenk === 'knee_l' || gelenk === 'knee_r';
      if (!istKnie && spec.limit[1] <= 0) {
        bo.push(`${gelenk}.${dof}: Maximum ${spec.limit[1]} <= 0 — ein positiver ` +
          'Wert des Freiheitsgrads wäre immer an der Grenze; nach der Normierung ' +
          'zeigt die Anatomie nach +');
      }
      // 3. Die Richtung-Beschreibung muss da sein und von + handeln.
      if (typeof spec.richtung !== 'string' || !/^\w+: \+/.test(spec.richtung)) {
        bo.push(`${gelenk}.${dof}: richtung „${JSON.stringify(spec.richtung)}“ — ` +
          'erwartet ein Satz der Form „name: + wirkt so, - anders“');
      }
    }
  }
  return bo;
}

test('Normierung, Positivfall: Grenzwerte links und rechts identisch, Richtung beschrieben', async () => {
  const gltf = await ladeXbot();
  const { joints } = measureJoints(gltf);

  const bo = symmetrieluecken(joints);
  assert.deepStrictEqual(bo, [], `Normierung hat Lücken:\n  ${bo.join('\n  ')}`);

  // Konkret der gemeldete Fall: arm_l.lift und arm_r.lift lauten identisch,
  // +80 ist auf BEIDEN Seiten innerhalb der Grenzen.
  for (const seite of ['l', 'r']) {
    const [lo, hi] = joints[`arm_${seite}`].dof.lift.limit;
    assert.ok(lo <= 80 && 80 <= hi,
      `arm_${seite}.lift: Grenze [${lo}, ${hi}] enthält +80 nicht — ein Agent, der ` +
      'beide Arme mit +80 hebt, würde auf dieser Seite geklemmt');
  }
});

test('Normierung, Nachmessen an der Haut: +80 auf beiden Seiten hebt beide Hände gleich hoch', async () => {
  // Der Nachweis, der den gemeldeten Fehler am Bild zeigt, in Zahlen: derselbe
  // positive Wert, dieselben Grenzen, symmetrische Wirkung. Der Solver wendet
  // das gemessene Vorzeichen an (kinematik.js: roh = sign * wert); der Test
  // macht dasselbe und misst den Höhengewinn beider Hände.
  const gltf = await ladeXbot();
  const { gelenke } = hautwerke(gltf.scene);
  const { joints } = measureJoints(gltf);

  const huelle = huellenhochAchse(gltf.scene);
  const WINKEL = 80;
  const steig = {};
  for (const seite of ['l', 'r']) {
    const pr = seite === 'l' ? 'Left' : 'Right';
    const { verschiebung } = wirkung(
      gltf.scene, gelenke, gelenke.size ? [...gelenke.values()][0].skeleton : null,
      'mixamorig' + pr + 'Arm', 'mixamorig' + pr + 'HandMiddle3',
      joints[`arm_${seite}`].dof.lift.axis,
      joints[`arm_${seite}`].dof.lift.sign * WINKEL);
    steig[seite] = verschiebung.y;
  }

  // Symmetrie des Modells: beide Hände steigen gleich weit. Toleranz 2 % der
  // Körperhöhe (Rechenrauschen der Haut messen, keine getippten Meter).
  const differenz = Math.abs(steig.l - steig.r);
  const huelle2 = huellenhochAchse(gltf.scene);
  const toleranz = 0.02 * huelle2.hoehe;
  assert.ok(differenz < toleranz,
    `+80 lift lädt die linke Hand um ${steig.l.toFixed(4)} m, die rechte um ` +
    `${steig.r.toFixed(4)} m in die Höhe — Differenz ${differenz.toFixed(4)} m über der ` +
    `Toleranz ${toleranz.toFixed(4)} m: eine Seite geht anders hoch als die andere`);
  assert.ok(steig.l > 0 && steig.r > 0,
    `positiver lift muss beide Arme nach oben bringen: links ${steig.l.toFixed(4)} m, ` +
    `rechts ${steig.r.toFixed(4)} m`);
});

test('Normierung, Negativfall: gespiegelte Grenzen werden gefunden', () => {
  // Der alte Zustand als Fälschung eingespeist — die Prüfung muss ihn melden:
  // rechts andere Grenzen, links normal. Würde sie stillschweigend bestehen,
  // wäre sie stumpf (AGENTS.md, Regel 2).
  const alt = {
    arm_l: { dof: {
      lift: { limit: [-40, 170], richtung: 'lift: + hebt den linken Arm nach oben, - senkt ihn' },
    } },
    arm_r: { dof: {
      lift: { limit: [-170, 40], richtung: 'lift: + hebt den rechten Arm nach oben, - senkt ihn' },
    } },
  };
  const bo = symmetrieluecken(alt);
  assert.ok(bo.length >= 1,
    `die gespiegelten Grenzen [-40,170] gegen [-170,40] müssen beanstandet werden, ` +
    `es kam ${bo.length === 0 ? 'keine' : bo.length} Beanstandung`);
  assert.ok(bo.some((b) => /arm_r\.lift/.test(b)),
    `die Beanstandung muss arm_r.lift nennen: ${bo.join(' | ')}`);
  assert.ok(bo.some((b) => /\[\s*-40,\s*170\s*\]/.test(b) || /\[\s*-170,\s*40\s*\]/.test(b)),
    `die Beanstandung nennt die Grenzwerte: ${bo.join(' | ')}`);
});

test('Normierung: richtung-Sätze kommen für alle Freiheitsgrade mit', async () => {
  const gltf = await ladeXbot();
  const { joints } = measureJoints(gltf);

  // Jeder dof-Datensatz trägt richtung — Twist wie gemessen.
  let gezahlt = 0;
  const luecken = [];
  for (const [gelenk, j] of Object.entries(joints)) {
    for (const [dof, spec] of Object.entries(j.dof)) {
      gezahlt++;
      if (typeof spec.richtung !== 'string' || spec.richtung.length < 10) {
        luecken.push(`${gelenk}.${dof}`);
      }
      // Nichts darf als „gemessen“ mit fehlendem Messwert durchgehen — die
      // richtung ist Zusatz, die Messspur bleibt unverändert.
      if (spec.signSource === 'gemessen' && !Number.isFinite(spec.measured)) {
        luecken.push(`${gelenk}.${dof}: signSource gemessen ohne measured`);
      }
    }
  }
  assert.ok(gezahlt >= 40,
    `nur ${gezahlt} Freiheitsgrade im Ergebnis — erwartet werden alle 40 des Katalogs (18 Gelenke)`);
  assert.deepStrictEqual(luecken, [],
    `fehlende richtung-Felder oder Messspuren:\n  ${luecken.join('\n  ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 5 — Twist
// ─────────────────────────────────────────────────────────────────────────────

/** Twist-Freiheitsgrade, die als gemessen ausgegeben werden, ohne es zu sein. */
function twisttaeuschungen(joints) {
  const bo = [];
  for (const kennung of TWIST_DOF) {
    const [gelenk, dof] = kennung.split('.');
    const spec = joints[gelenk] && joints[gelenk].dof[dof];
    if (!spec) { bo.push(`${kennung}: im Profil nicht vorhanden`); continue; }
    if (spec.signSource === 'gemessen' && spec.measured === undefined) {
      bo.push(`${kennung}: signSource „gemessen“ ohne Bewegungsmessung am Kettenende, Vorzeichen ${spec.sign}`);
    }
  }
  return bo;
}

test('Twist, Positivfall: nicht messbare Drehungen sind als nicht_messbar gekennzeichnet', async () => {
  const gltf = await ladeXbot();
  const huelle = huellenhochAchse(gltf.scene);
  const nachweisgrenze = huelle.hoehe * DEAD_MOVE_FRACTION;
  const { joints } = measureJoints(gltf);
  const { gelenke, lastwerk } = hautwerke(gltf.scene);

  const enden = {
    'pelvis.turn': ['mixamorigHips', 'mixamorigHeadTop_End'],
    'spine.turn': ['mixamorigSpine', 'mixamorigHeadTop_End'],
    'neck.turn': ['mixamorigNeck', 'mixamorigHeadTop_End'],
    'head.turn': ['mixamorigHead', 'mixamorigHeadTop_End'],
    'arm_l.twist': ['mixamorigLeftArm', 'mixamorigLeftHandMiddle3'],
    'arm_r.twist': ['mixamorigRightArm', 'mixamorigRightHandMiddle3'],
    'elbow_l.twist': ['mixamorigLeftForeArm', 'mixamorigLeftHandMiddle3'],
    'elbow_r.twist': ['mixamorigRightForeArm', 'mixamorigRightHandMiddle3'],
  };

  for (const kennung of TWIST_DOF) {
    const [gelenk, dof] = kennung.split('.');
    const spec = joints[gelenk].dof[dof];
    assert.strictEqual(spec.signSource, 'nicht_messbar',
      `${kennung}: signSource „${spec.signSource}“, erwartet „nicht_messbar“ (plan.md 3.5: Drehung um die eigene Kettenachse)`);
    // Nicht messbar heißt: das Vorzeichen kommt nicht aus einer Messung. Es
    // heißt NICHT, dass es 1 sein muss. Die Seitenspiegelung ist Katalogwissen
    // und gilt auch hier — bis zum 2. September 2026 stand hier pauschal 1,
    // und hip_r.twist drehte damit nach innen, wo sein Text „nach außen"
    // versprach (src/rig/twist-spiegelung.test.mjs).
    const erwartet = GESPIEGELTE_TWIST_DOF.has(kennung) ? -1 : 1;
    assert.strictEqual(spec.sign, erwartet,
      `${kennung}: Vorzeichen ${spec.sign}, erwartet ${erwartet} — gespiegelt sind nur Kanäle, deren Text eine seitenbezogene Richtung nennt („nach außen")`);
  }

  // Nachweis an den Ketten, die auf ihrer Achse liegen: die Drehung bewegt das
  // Ende unter der Nachweisgrenze — die Kennzeichnung ist also berechtigt.
  const nachgemessen = [];
  for (const [kennung, [knochen, ende]] of Object.entries(enden)) {
    const [gelenk, dof] = kennung.split('.');
    const achse = joints[gelenk].dof[dof].axis;
    const { weg } = wirkung(gltf.scene, gelenke, lastwerk, knochen, ende, achse, PROBE_DEG);
    nachgemessen.push(`${kennung}=${weg.toFixed(4)}`);
    assert.ok(weg < nachweisgrenze,
      `${kennung}: Drehung um ${achse} bewegt ${ende} um ${weg.toFixed(4)} m — über der Nachweisgrenze ${nachweisgrenze.toFixed(4)} m, „nicht_messbar“ wäre falsch`);
  }
  assert.ok(nachgemessen.length === 8,
    `nur ${nachgemessen.length} von 8 am Kettenende wirkungslosen Drehungen nachgemessen`);
});

test('Twist, Negativfall: Twist wird nicht stillschweigend als gemessen ausgegeben', async () => {
  const gltf = await ladeXbot();
  const { joints } = measureJoints(gltf);

  assert.deepStrictEqual(twisttaeuschungen(joints), [],
    `Twist-Freiheitsgrade werden als gemessen ausgegeben: ${twisttaeuschungen(joints).join(' | ')}`);

  // Selbst kaputt gebaut muss die Prüfung ansprechen: Vorzeichen 1, Quelle
  // „gemessen“, ohne dass eine Bewegung gemessen wurde.
  const gefaelscht = structuredClone(joints);
  gefaelscht.arm_l.dof.twist.signSource = 'gemessen';
  const bo = twisttaeuschungen(gefaelscht);
  assert.strictEqual(bo.length, 1,
    `gefälschte Quelle an arm_l.twist ergibt ${bo.length} Beanstandungen, erwartet 1`);
  assert.match(bo[0], /arm_l\.twist/, `Beanstandung nennt den Freiheitsgrad nicht: "${bo[0]}"`);

  // Kein Twist-Dof darf ohne Messwert als gemessen durchgehen.
  for (const kennung of TWIST_DOF) {
    const [gelenk, dof] = kennung.split('.');
    const spec = joints[gelenk].dof[dof];
    if (spec.signSource === 'gemessen') {
      assert.ok(Number.isFinite(spec.measured) && Math.abs(spec.measured) > 0,
        `${kennung}: „gemessen“ ohne belastbaren Bewegungswert (${JSON.stringify(spec.measured)})`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Vertrag und Vollständigkeit
// ─────────────────────────────────────────────────────────────────────────────

test('Vertrag, Positivfall: das vermessene RigProfile besteht validateRigProfile', async () => {
  const gltf = await ladeXbot();
  const profil = measureRigProfile(gltf, { fileName: 'Xbot.glb' });
  const befund = validateRigProfile(profil);

  assert.strictEqual(befund.ok, true,
    `validateRigProfile lehnt das vermessene Profil mit ${befund.errors.length} Feldern ab: ${befund.errors.map((e) => `${e.field}: ${e.message}`).join(' | ')}`);

  // Querschnitt durch den Weltvertrag, alles nachgemessen: Höhe = y-Ausdruck.
  const huelle = huellenhochAchse(gltf.scene);
  const bo = vollstaendigkeitbeanstandungen(profil, gltf.scene);
  assert.deepStrictEqual(bo, [], `Vermessung erfasst das Modell nicht vollständig:\n  ${bo.join('\n  ')}`);
  assert.ok(Math.abs(profil.world.height - huelle.hoehe) < 0.01 * huelle.hoehe,
    `world.height ${profil.world.height} m gegen nachgemessene Körperhöhe ${huelle.hoehe.toFixed(4)} m — Abweichung ${Math.abs(profil.world.height - huelle.hoehe).toFixed(4)} m`);
  assert.ok(Math.abs(profil.world.groundY - huelle.boden) < 0.01 * huelle.hoehe,
    `world.groundY ${profil.world.groundY} m gegen nachgemessene Bodenhöhe ${huelle.boden.toFixed(4)} m`);

  // Pflichtrollen, Gelenkknochen und Sohlenknochen müssen existieren.
  const ids = new Set(profil.bones.map((b) => b.id));
  assert.ok(ids.size === profil.bones.length,
    `${profil.bones.length} Knochen gelistet, aber nur ${ids.size} verschiedene ids — Zuordnungen wären mehrdeutig`);
  for (const [rolle, r] of Object.entries(profil.roles)) {
    assert.ok(ids.has(r.bone), `Rolle ${rolle} zeigt auf „${r.bone}“, der Knochen fehlt unter ${ids.size} ids`);
    assert.ok(r.confidence >= 0.9, `Rolle ${rolle} mit Konfidenz ${r.confidence} — unter der Sicherheitsschwelle von 0,9 (plan.md 5.1)`);
  }
  for (const [gelenk, j] of Object.entries(profil.joints)) {
    assert.ok(ids.has(j.bone), `Gelenk ${gelenk} zeigt auf „${j.bone}“, der Knochen fehlt unter ${ids.size} ids`);
  }
  for (const s of profil.soles) {
    assert.ok(ids.has(s.bone), `Sohle ${s.id} zeigt auf „${s.bone}“, der Knochen fehlt unter ${ids.size} ids`);
  }
});

test('Vertrag, Negativfall: ein kaputtes Profil wird mit Feldnamen abgelehnt', async () => {
  const profil = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb' });
  assert.strictEqual(validateRigProfile(profil).ok, true, 'Ausgangspanel muss gültig sein');

  const ohneFuss = structuredClone(profil);
  delete ohneFuss.roles.foot_l;
  const befund = validateRigProfile(ohneFuss);
  assert.strictEqual(befund.ok, false, 'fehlende Pflichtrolle foot_l wurde durchgewinkt');
  assert.ok(befund.errors.some((e) => e.field === 'roles.foot_l'),
    `Ablehnung nennt nicht das Feld roles.foot_l, sondern: ${befund.errors.map((e) => e.field).join(', ')}`);

  const schlechteHoehe = structuredClone(profil);
  schlechteHoehe.world.height = 0;
  const befund2 = validateRigProfile(schlechteHoehe);
  assert.ok(befund2.errors.some((e) => e.field === 'world.height'),
    `Höhe 0 m wird nicht unter world.height beanstandet: ${befund2.errors.map((e) => e.field).join(', ') || 'keine Fehler'}`);

  // Unvollständige Vermessung muss die Vollständigkeitsprüfung ebenfalls melden.
  const teilvermessen = structuredClone(profil);
  teilvermessen.world.height = 1.5968;      // nur das erste von zwei SkinnedMeshes
  teilvermessen.source.vertexCount = 12473; // ebenso die Vertexzahl dieses einen Meshes
  const bo = vollstaendigkeitbeanstandungen(teilvermessen, (await ladeXbot()).scene);
  assert.strictEqual(bo.length, 2,
    `nur mit einem von ${2} SkinnedMeshes gemessenes Profil ergibt ${bo.length} Beanstandungen, erwartet 2:\n  ${bo.join('\n  ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe „Rollen“ — woher die Vermessung weiß, welcher Knochen was ist
//
// Bis hierher stand in measure.js ein Namensschema: „mixamorig“ + „LeftFoot“.
// Damit war jede Messung an eine Benennung gebunden und ein fremdes Modell
// wurde abgelehnt, obwohl seine Geometrie vollständig messbar ist. Die Rollen
// kommen jetzt aus der geometrischen Erkennung (detect.js). Diese Reihe prüft
// genau das und nichts sonst: dieselbe Geometrie muss dieselben Maße ergeben,
// egal wie die Knochen heißen.
// ─────────────────────────────────────────────────────────────────────────────

/** Benennt alle Knochen um in `bone_000…` und liefert die Übersetzung alt→neu. */
function umbenennen(gltf) {
  const uebersetzung = new Map();
  let nr = 0;
  gltf.scene.traverse((obj) => {
    if (!obj.isBone) return;
    const neu = `bone_${String(nr).padStart(3, '0')}`;
    uebersetzung.set(obj.name, neu);
    obj.name = neu;
    nr++;
  });
  assert.ok(nr > 20, `erwartet ein Skelett mit vielen Knochen, umbenannt wurden ${nr}`);
  return uebersetzung;
}

/**
 * Entfernt alle Textilverweise aus einem GLB. Node kann eingebettete Bilder
 * nicht entschlüsseln — three.js' GLTFLoader ruft `self.URL`, und `self` gibt
 * es in Node nicht. Für die Vermessung zählt kein Pixel, nur Vertices,
 * Gewichte und Gelenke; Geometrie und Skin bleiben unangetastet.
 */
function ohneTexturen(puffern) {
  const { json, bin } = glbZerlegen(puffern);
  const streichen = (o) => {
    for (const schluessel of Object.keys(o)) {
      if (/Texture$/i.test(schluessel)) delete o[schluessel];
    }
  };
  for (const material of json.materials || []) {
    streichen(material);
    if (material.pbrMetallicRoughness) streichen(material.pbrMetallicRoughness);
    for (const erweiterung of Object.values(material.extensions || {})) streichen(erweiterung);
  }
  return glbBauen(json, bin);
}

test('Rollen, Positivfall: umbenannte Knochen ändern kein einziges Maß', async () => {
  const originalGltf = await ladeXbot();
  const original = measureRigProfile(originalGltf, { fileName: 'Xbot.glb' });

  const anonym = await ladeXbot();
  const uebersetzung = umbenennen(anonym);
  const getarnt = measureRigProfile(anonym, { fileName: 'Xbot.glb' });

  // 1. Dieselben Rollen auf denselben Knochen — nur eben unter neuem Namen.
  for (const rolle of ['pelvis', 'foot_l', 'foot_r']) {
    assert.strictEqual(getarnt.roles[rolle].bone, uebersetzung.get(original.roles[rolle].bone),
      `Rolle ${rolle} sitzt nach dem Umbenennen auf „${getarnt.roles[rolle].bone}“, erwartet „${uebersetzung.get(original.roles[rolle].bone)}“ (vorher „${original.roles[rolle].bone}“) — die Zuordnung hängt am Namen`);
    assert.strictEqual(getarnt.roles[rolle].confidence, original.roles[rolle].confidence,
      `Konfidenz der Rolle ${rolle} fällt von ${original.roles[rolle].confidence} auf ${getarnt.roles[rolle].confidence}, sobald die Knochen anders heißen`);
  }

  // 2. Dieselben Maße. Verglichen wird das ganze Profil; die Felder, die den
  //    Knochennamen TRAGEN, werden vorher über die Übersetzung zurückgeführt.
  const zurueck = (name) => uebersetzung.get(name) ?? name;
  const uebersetzt = structuredClone(original);
  uebersetzt.bones = uebersetzt.bones.map((b) => ({
    ...b, id: zurueck(b.id), parent: b.parent === null ? null : zurueck(b.parent),
  }));
  for (const r of Object.values(uebersetzt.roles)) r.bone = zurueck(r.bone);
  for (const j of Object.values(uebersetzt.joints)) j.bone = zurueck(j.bone);
  uebersetzt.segments = uebersetzt.segments.map((s) => ({ ...s, from: zurueck(s.from), to: zurueck(s.to) }));
  uebersetzt.soles = uebersetzt.soles.map((s) => ({ ...s, bone: zurueck(s.bone) }));
  // Knochen mit Haut: traegt Namen, also ebenfalls zurueckfuehren. Sortiert,
  // weil das Profil sie sortiert ausgibt und die Umbenennung die Reihenfolge
  // aendert.
  uebersetzt.skinnedBones = uebersetzt.skinnedBones.map(zurueck).sort();

  assert.deepStrictEqual(getarnt, uebersetzt,
    `das Profil des umbenannten Modells weicht ab — Körperhöhe ${getarnt.world.height} gegen ${original.world.height} m,`
    + ` ${getarnt.segments.length} gegen ${original.segments.length} Segmente,`
    + ` ${Object.keys(getarnt.joints).length} gegen ${Object.keys(original.joints).length} Gelenke,`
    + ` ${getarnt.warnings.length} gegen ${original.warnings.length} Warnungen`);
});

test('Rollen, Positivfall: fremde Rigs werden vermessen, nicht abgelehnt', async () => {
  // Drei Modelle aus fremder Hand, drei verschiedene Benennungen: CesiumMan
  // („Skeleton_torso_joint_1“), RiggedFigure („leg_joint_L_3“), Soldier
  // (Mixamo, aber ohne Zehenendknochen und mit anderer Kettenlänge).
  const namen = ['CesiumMan', 'RiggedFigure', 'Soldier', 'Michelle'];
  const ergebnisse = [];
  for (const name of namen) {
    const roh = ohneTexturen(readFileSync(join(REPO_ROOT, 'models', 'fremde', name + '.glb')));
    const gltf = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
    const profil = measureRigProfile(gltf, { fileName: name + '.glb' });
    ergebnisse.push({ name, profil });

    assert.strictEqual(validateRigProfile(profil).ok, true,
      `${name}: vermessenes Profil besteht den Vertrag nicht — ${validateRigProfile(profil).errors.map((e) => e.field).join(', ')}`);
    assert.ok(profil.world.height > 0,
      `${name}: Körperhöhe ${profil.world.height} m`);
    assert.ok(profil.segments.length >= 6,
      `${name}: nur ${profil.segments.length} von ${14} Segmenten messbar, erwartet mindestens 6 — Warnungen: ${profil.warnings.join(' | ')}`);
    assert.ok(profil.soles.length === 8,
      `${name}: ${profil.soles.length} Sohlenpunkte, erwartet 8 (vier Ecken je Fuß)`);
    // Jede Pflichtrolle sitzt auf einem Knochen, den dieses Modell wirklich hat.
    const vorhandene = new Set(profil.bones.map((b) => b.id));
    for (const rolle of ['pelvis', 'foot_l', 'foot_r']) {
      assert.ok(vorhandene.has(profil.roles[rolle].bone),
        `${name}: Rolle ${rolle} zeigt auf „${profil.roles[rolle].bone}“, das Skelett hat ${vorhandene.size} Knochen — der gibt es nicht`);
    }
  }
  assert.strictEqual(ergebnisse.length, namen.length,
    `${ergebnisse.length} von ${namen.length} fremden Modellen vermessen`);
});

test('Rollen, Negativfall: ein Nicht-Humanoid wird geometrisch abgelehnt, nicht wegen fehlender Namen', async () => {
  // RobotExpressive: eine Figur, deren Skelett keine aufrechte zweibeinige
  // Körperform hat. Die Ablehnung muss von der Geometrie kommen.
  const roh = ohneTexturen(readFileSync(join(REPO_ROOT, 'models', 'fremde', 'RobotExpressive.glb')));
  const gltf = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));

  assert.throws(
    () => measureRigProfile(gltf, { fileName: 'RobotExpressive.glb' }),
    (fehler) => {
      assert.match(fehler.message, /\d/,
        `jede Ablehnung muss eine Zahl nennen, war: "${fehler.message}"`);
      assert.doesNotMatch(fehler.message, /mixamorig|Knochen „[A-Za-z]*(Left|Right|Hips)/,
        `die Ablehnung stützt sich auf einen Knochennamen statt auf Geometrie: "${fehler.message}"`);
      assert.match(fehler.message, /Achsenwert|Erkennung abgelehnt|ohne Kandidaten|Segmenten messbar/,
        `die Ablehnung nennt keinen geometrischen Grund: "${fehler.message}"`);
      return true;
    },
    'ein Modell ohne menschliche Körperform muss abgelehnt werden, statt als Mensch vermessen zu werden'
  );
});


test('Rollen, mittlere Zone: eine unsichere Pflichtrolle wird gemessen und zur Bestätigung markiert', async () => {
  // plan.md 5.1 kennt drei Zonen, nicht zwei. Michelle ist der Beleg, warum
  // die mittlere gebraucht wird: 65 Knochen, ein vollständiges Mixamo-Rig —
  // und trotzdem findet die Erkennung die Blickrichtung nicht eindeutig und
  // gibt den Füßen nur 0,58. Solange „unter 0,90“ gleich „abgelehnt“ hieß,
  // fiel dieses Modell durch, obwohl seine Füße gefunden waren.
  const roh = ohneTexturen(readFileSync(join(REPO_ROOT, 'models', 'fremde', 'Michelle.glb')));
  const gltf = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
  const profil = measureRigProfile(gltf, { fileName: 'Michelle.glb' });

  const fuss = profil.roles.foot_l;
  assert.ok(fuss.confidence >= 0.5 && fuss.confidence < 0.9,
    `Testvoraussetzung: foot_l müsste in der Rückfragezone liegen, ist aber ${fuss.confidence}`);
  assert.strictEqual(fuss.confirm, true,
    `foot_l mit Konfidenz ${fuss.confidence} ist nicht als bestätigungsbedürftig markiert — der Mensch wird nie gefragt`);
  assert.ok(profil.world.height > 0 && profil.segments.length > 0,
    `trotz unsicherer Rolle muss gemessen werden: ${profil.segments.length} Segmente, Höhe ${profil.world.height} m`);
  assert.strictEqual(validateRigProfile(profil).ok, true,
    `Profil mit bestätigungsbedürftiger Rolle besteht den Vertrag nicht: ${validateRigProfile(profil).errors.map((e) => e.field).join(', ')}`);

  const meldung = profil.warnings.filter((w) => /Pflichtrolle foot_l/.test(w));
  assert.strictEqual(meldung.length, 1,
    `${meldung.length} Warnungen zur unsicheren Pflichtrolle foot_l, erwartet genau eine: ${profil.warnings.join(' | ')}`);
  assert.match(meldung[0], /0\.58/,
    `die Warnung nennt die gemessene Konfidenz nicht: "${meldung[0]}"`);

  // Gegenprobe: eine sichere Rolle wird nicht markiert und erzeugt keine Warnung.
  const sicher = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb' });
  assert.strictEqual(sicher.roles.foot_l.confirm, undefined,
    `Rolle mit Konfidenz ${sicher.roles.foot_l.confidence} ist als bestätigungsbedürftig markiert, obwohl sie sicher ist`);
  assert.strictEqual(sicher.warnings.length, 0,
    `sicher erkanntes Modell meldet ${sicher.warnings.length} Warnungen: ${sicher.warnings.join(' | ')}`);
});

test('Rollen, mittlere Zone: die Antwort des Menschen ersetzt die unsichere Zuordnung', async () => {
  // Der Mensch bestätigt über confirm_role (src/ui/rollen-bestaetigung.js);
  // seine Antwort kommt als opts.roles herein. Danach ist die Rolle festgelegt
  // und nicht mehr bestätigungsbedürftig.
  const roh = ohneTexturen(readFileSync(join(REPO_ROOT, 'models', 'fremde', 'Michelle.glb')));
  const laden = async () => {
    const g = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
    return g;
  };
  const ohneAntwort = measureRigProfile(await laden(), { fileName: 'Michelle.glb' });
  const antwort = {
    foot_l: ohneAntwort.roles.foot_l.bone,
    foot_r: ohneAntwort.roles.foot_r.bone,
  };
  const mitAntwort = measureRigProfile(await laden(), { fileName: 'Michelle.glb', roles: antwort });

  assert.strictEqual(mitAntwort.roles.foot_l.confidence, 1,
    `bestätigte Rolle trägt Konfidenz ${mitAntwort.roles.foot_l.confidence}, erwartet 1`);
  assert.strictEqual(mitAntwort.roles.foot_l.confirm, undefined,
    'bestätigte Rolle ist immer noch als bestätigungsbedürftig markiert');
  assert.strictEqual(mitAntwort.warnings.filter((w) => /Pflichtrolle/.test(w)).length, 0,
    `nach der Bestätigung bleiben Rollenwarnungen stehen: ${mitAntwort.warnings.filter((w) => /Pflichtrolle/.test(w)).join(' | ')}`);
  assert.strictEqual(mitAntwort.world.height, ohneAntwort.world.height,
    `die Bestätigung derselben Zuordnung ändert die Körperhöhe von ${ohneAntwort.world.height} auf ${mitAntwort.world.height} m`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe „Bestätigungen messen neu“ — confirm_role ist keine Kosmetik
//
// Befund (spikes/rollen/BEFUND.md): eine bestätigte oder korrigierte Rolle
// lief über NICHT in die Vermessung — describe_body zeigte bitidentische
// Segmente, Massen, Sohlen und Gelenke, wie auch immer der Mensch korrigierte.
// Die Vermessung (Pfad A dieser Erhebung) hatte nie ein Problem: mit
// korrigierter Rollentabelle aufgerufen, misst sie ohnehin neu. Die Reihe hier
// prüft genau diese Nachbedingung an der Vermessung: JEDE abweichende
// Bestätigung muss das Profil neu bilden — über beide Kanäle (opts.roles und
// opts.bestaetigteRollen aus dem Tool-Store), mit identischen Zahlen.
// ─────────────────────────────────────────────────────────────────────────────

/** Gesamtmasse eines Profils, gerundet wie die Segmentmeldungen. */
const gesamtMasse = (profil) => +profil.segments.reduce((a, s) => a + s.mass, 0).toFixed(4);

test('Bestätigung, Positivfall: eine abweichende Beckenrolle misst das Profil neu', async () => {
  const ohne = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb' });
  const falschesBecken = ohne.roles.pelvis.bone === 'mixamorigHips' ? 'mixamorigSpine' : 'mixamorigHips';

  const korrigiert = measureRigProfile(await ladeXbot(), {
    fileName: 'Xbot.glb',
    bestaetigteRollen: { pelvis: falschesBecken },
  });

  // Die Rolle selbst sitzt auf dem neuen Knochen, bestätigt, Konfidenz 1.
  assert.strictEqual(korrigiert.roles.pelvis.bone, falschesBecken,
    `Korrektur ist nicht eingetroffen: pelvis zeigt weiter auf „${korrigiert.roles.pelvis.bone}“ statt „${falschesBecken}“`);
  assert.strictEqual(korrigiert.roles.pelvis.confidence, 1,
    `bestätigte Rolle trägt Konfidenz ${korrigiert.roles.pelvis.confidence}, erwartet 1`);

  // Das gemessene Profil muss gefolgt sein — Zahlen vergleichen, nicht nur Felder.
  const torsoOhne = ohne.segments.find((s) => s.id === 'torso');
  const torsoMit = korrigiert.segments.find((s) => s.id === 'torso');
  assert.notStrictEqual(torsoMit.from, torsoOhne.from,
    `Segment torso beginnt weiter an „${torsoMit.from}“ — die Segmentachse ist der Korrektur nicht gefolgt`);
  assert.notStrictEqual(torsoMit.radius, torsoOhne.radius,
    `torso-Radius blieb bitidentisch (${torsoMit.radius} m) — es wurde nicht neu gemessen`);
  assert.notStrictEqual(gesamtMasse(korrigiert), gesamtMasse(ohne),
    `Gesamtmasse blieb bei ${gesamtMasse(ohne)} kg — Massen sind der Korrektur nicht gefolgt`);
  assert.notStrictEqual(torsoMit.mass, torsoOhne.mass,
    `torso-Masse blieb bitidentisch (${torsoMit.mass} kg) — Massenmessung lief nicht neu`);
});

test('Bestätigung, Positivfall: Fuß-Korrektur zieht Sohle, Gelenk und Masse nach', async () => {
  const gltfErkannt = await ladeXbot();
  const zehLinks = detectRig(gltfErkannt).roles.toe_l.bone;
  const ohne = measureRigProfile(await ladeXbot(), { fileName: 'Xbot.glb' });

  const korrigiert = measureRigProfile(await ladeXbot(), {
    fileName: 'Xbot.glb',
    bestaetigteRollen: { foot_l: zehLinks },
  });

  assert.strictEqual(korrigiert.roles.foot_l.bone, zehLinks,
    `foot_l zeigt weiter auf „${korrigiert.roles.foot_l.bone}“, statt auf die Korrektur „${zehLinks}“`);

  // Sohle: am neuen Knochen, in neuen lokal-Koordinaten gemessen.
  const sohleOhne = ohne.soles.find((s) => s.id === 'sole_l_front_out');
  const sohleMit = korrigiert.soles.find((s) => s.id === 'sole_l_front_out');
  assert.strictEqual(sohleMit.bone, zehLinks,
    `Sohle sitzt weiter am alten Knochen „${sohleMit.bone}“ — die Sohlenmessung lief nicht über die korrigierte Rolle`);
  assert.notDeepStrictEqual(sohleMit.local, sohleOhne.local,
    `Sohle „sole_l_front_out“ in bitidentisch lokal gemessen ${JSON.stringify(sohleMit.local)} — keine Neumessung`);

  // Gelenk: ankle_l sitzt an der neuen Fußrolle.
  assert.strictEqual(korrigiert.joints.ankle_l.bone, zehLinks,
    `Gelenk ankle_l sitzt weiter auf „${korrigiert.joints.ankle_l.bone}“ — die Gelenkmessung folgt der Korrektur nicht`);

  // Masse des Fußsegments: ein Zeh wiegt weniger als ein ganzer Fuß.
  const fussOhne = ohne.segments.find((s) => s.id === 'foot_l');
  const fussMit = korrigiert.segments.find((s) => s.id === 'foot_l');
  assert.ok(fussMit.mass < fussOhne.mass,
    ` Fußmasse stieg von ${fussOhne.mass} auf ${fussMit.mass} kg — die Fuß-Korrektur hat die Messung nicht neu durchlaufen`);
});

test('Bestätigung, Negativfall: bestätigter Nicht-Knochen wird mit Zahl abgelehnt', async () => {
  const gltf = await ladeXbot();
  assert.throws(
    () => measureRigProfile(gltf, { fileName: 'Xbot.glb', bestaetigteRollen: { foot_l: 'gibt-es-nicht' } }),
    (fehler) => {
      assert.match(fehler.message, /\d/,
        `Ablehnung muss eine Zahl nennen, war: "${fehler.message}"`);
      assert.match(fehler.message, /gibt-es-nicht/,
        `Ablehnung muss den abgewiesenen Knochennamen nennen, war: "${fehler.message}"`);
      return true;
    },
    'eine Bestätigung auf einen Knochen außerhalb des Skeletts darf nicht stillschweigend durchgehen');
});

test('Bestätigung, Kontrollfall: dieselbe Zuordnung bestätigt misst exakt dasselbe', async () => {
  // Der Kontrollfall für den Positivfall über: Ein reines Bestätigen (der
  // Mensch wählt den Vorschlag) darf kein anderes Profil geben — sonst wäre
  // die Neumessung kein Messen, sondern eine zweite Zufallszahl.
  const gltf = await ladeXbot();
  const ohne = measureRigProfile(gltf, { fileName: 'Xbot.glb' });
  const antwort = {};
  for (const [rolle, v] of Object.entries(detectRig(await ladeXbot()).roles)) {
    antwort[rolle] = v.bone;
  }
  const bestaetigt = measureRigProfile(await ladeXbot(), {
    fileName: 'Xbot.glb',
    bestaetigteRollen: antwort,
  });

  assert.deepStrictEqual(bestaetigt.segments, ohne.segments,
    'Bestätigen aller erkannten Zuordnungen ändert die Segmente — die Neumessung lief, ohne dass geändert wurde');
  assert.deepStrictEqual(bestaetigt.soles, ohne.soles,
    'Bestätigen derselben Zuordnung ändert die Sohlen');
  assert.strictEqual(gesamtMasse(bestaetigt), gesamtMasse(ohne),
    `Gesamtmasse wandert von ${gesamtMasse(ohne)} auf ${gesamtMasse(bestaetigt)} kg — die Bestätigung derselben Zuordnung misst zu`);
});
