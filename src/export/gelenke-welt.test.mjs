// Abnahmetest — „Die exportierte Datei zeigt dieselbe Figur wie der Löser".
//
// Der Löser schreibt frame.joints als WELT-Quaternionen (poseKnochen,
// kinematik.js: wq = q_eltern · lQuat · extra). Der Export las sie als LOKALE
// Knotenwerte und setzte sie direkt auf bone.quaternion. Am Xbot unterscheiden
// sich Welt- und Lokalausrichtung an jedem Knochen unter dem Becken — die
// Datei zeigte eine andere Figur als look, measure und die Anzeige.
//
// Ebenso die Wurzel: frame.root.quat ist nur die Ganzkörperdrehung (waxis),
// ohne Bind-Anteil und ohne Beckenneigung. Als Weltausrichtung des Becken-
// knochens genommen verliert die Datei `pelvis tilt` — genau die Verbeugung.
//
// Der Nachweis läuft nicht gegen den eigenen Schreibcode: die Datei wird mit
// dem GLTFLoader neu eingelesen, jeder Knochen aus seinen Kanälen gestellt, und
// die WELTPOSITIONEN der Gelenkknochen werden mit frame.positions verglichen —
// das ist, was ein fremder Player zeigt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { exportiereClip, pruefeExport } from './gltf.js';

const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
const PROFIL = measureRigProfile(gltf);
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));
const H = SKEL.height;

/** Eine Verbeugung mit Armhaltung: Beckenneigung, Rumpf, Ellbogen, Ortswechsel. */
function verbeugung() {
  const overrides = {
    '0': { ease: 'smooth', joints: { knee_l: { bend: 3 } }, root: { pos: [0, 1.04, -1.0] } },
    '10': {
      ease: 'smooth',
      joints: {
        pelvis: { tilt: 24 }, spine: { bend: 35 }, neck: { bend: 20 },
        hip_l: { flex: -26 }, hip_r: { flex: -26 }, knee_l: { bend: 16 }, knee_r: { bend: 16 },
        arm_r: { lift: -60, swing: 58 }, elbow_r: { bend: 105 }, arm_l: { lift: -42, swing: -50 },
      },
      root: { pos: [0, 0.9, 1.2] },
    },
    '19': { ease: 'smooth', joints: { knee_l: { bend: 3 } }, root: { pos: [0, 1.05, 1.3] } },
  };
  return { schemaVersion: 1, fps: 30, frameCount: 20, rotationFormat: 'quaternion', phases: [], overrides, anchors: [] };
}

/** Stellt einen Frame aus den Animationskanälen auf die neu eingelesene Szene. */
function stelleAusKanaelen(szene, clip, i) {
  for (const track of clip.tracks) {
    const [knoten, eigenschaft] = track.name.split('.');
    const obj = szene.getObjectByName(knoten);
    if (!obj) continue;
    if (eigenschaft === 'quaternion') obj.quaternion.fromArray(track.values, i * 4);
    else if (eigenschaft === 'position') obj.position.fromArray(track.values, i * 3);
  }
  szene.updateMatrixWorld(true);
}

test('Export: Gelenkknochen stehen in der Datei dort, wo der Löser sie gerechnet hat', async () => {
  const tl = verbeugung();
  const { frames } = loeseBewegung(PROFIL, SKEL, tl, {});
  const timeline = { ...tl, solved: { frames } };

  const clip = await exportiereClip(gltf, timeline, PROFIL);
  const zurueck = await loadGLB(clip.bytes);
  const anim = zurueck.animations[0];
  assert.ok(anim, 'Wiedereinlesen ohne Animation');

  const knochen = ['pelvis', 'spine', 'neck', 'head', 'elbow_r', 'hand_r', 'knee_l', 'foot_l', 'toe_l']
    .map((g) => [g, PROFIL.joints[g]?.bone ?? PROFIL.roles[g]?.bone]).filter(([, b]) => b);
  assert.ok(knochen.length >= 6, `nur ${knochen.length} Gelenke auflösbar`);
  const toleranz = 0.01 * H;                     // 1 % der Körperhöhe, ~1,8 cm

  let groesste = { abw: 0, was: '' };
  for (const i of [0, 5, 10, 15, 19]) {
    stelleAusKanaelen(zurueck.scene, anim, i);
    for (const [gelenk, name] of knochen) {
      const soll = frames[i].positions[name];
      const ist = zurueck.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray();
      const abw = Math.hypot(ist[0] - soll[0], ist[1] - soll[1], ist[2] - soll[2]);
      if (abw > groesste.abw) groesste = { abw, was: `${gelenk} (${name}) in Frame ${i}: Datei [${ist.map((v) => v.toFixed(3))}], Löser [${soll.map((v) => v.toFixed(3))}]` };
    }
  }
  assert.ok(groesste.abw <= toleranz,
    `größte Abweichung ${(groesste.abw * 100).toFixed(1)} cm, erlaubt ${(toleranz * 100).toFixed(1)} cm — ${groesste.was}`);

  const befund = await pruefeExport(timeline, clip.bytes, PROFIL);
  assert.deepEqual(befund.errors, [], `pruefeExport: ${befund.errors.map((e) => e.message).join(' | ')}`);
});

test('Negativfall: eine Datei mit vertauschten Gelenkwerten fällt beim Wiedereinlesen auf', async () => {
  const tl = verbeugung();
  const { frames } = loeseBewegung(PROFIL, SKEL, tl, {});
  const timeline = { ...tl, solved: { frames } };
  const clip = await exportiereClip(gltf, timeline, PROFIL);

  // Vergleichs-Timeline mit einem absichtlich falschen Ellbogen in Frame 10.
  const kaputt = structuredClone(timeline);
  kaputt.solved.frames[10].joints.elbow_r = [0, 0, 0, 1];
  const befund = await pruefeExport(kaputt, clip.bytes, PROFIL);
  assert.equal(befund.passed, false, 'ein falsches Gelenk muss den Befund rot machen');
  assert.ok(befund.errors.some((e) => e.kind === 'gelenk' && e.frame === 10),
    `erwartet Gelenkbefund in Frame 10, bekommen: ${befund.errors.map((e) => e.message).join(' | ')}`);
});
