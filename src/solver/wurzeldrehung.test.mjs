// Abnahmetest — „Die Ganzkörperdrehung dreht ums Becken, egal wo die Figur steht".
//
// Gefunden im Agentenlauf vom 1. September 2026 (Session 5c6a601a, Rückwärts-
// salto): `drehGrad.x` hob die Figur an, statt sie zu drehen. Der Agent hat den
// Fehler an drei Messreihen vermessen und die Formel
//
//     pelvis_y = pos_y + 0,465·(1−cos θ) + pos_z·sin θ
//
// gefunden — exakt der Term (I−R)·d, den man bekommt, wenn der Drehpunkt in
// Weltkoordinaten (wpos) übergeben, aber in poseKnochen auf Bind-Koordinaten
// angewandt wird. Er hat daraufhin den ganzen Anlauf auf z = −4 m verlegt, damit
// der Salto über dem Weltursprung stattfindet, und 135 seiner 237 Aufrufe in die
// Kalibrierung gesteckt. Die Figur stand danach 2,5 m neben der Mitte.
//
// Positivfall: Becken landet exakt auf root.pos, die Höhe des Kopfes hängt
// nicht davon ab, wo die Figur in z steht.
// Negativfall: eine Drehung um −90° muss den Kopf tatsächlich aus der
// Senkrechten holen — sonst hätte die Drehung gar nicht gegriffen und der Test
// wäre trivial grün.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { ladeXbot, xbotProfil } from '../rig/xbot-profil.mjs';

// Profil aus dem geteilten Cache (src/rig/xbot-profil.mjs): das unveraenderte
// Xbot-Profil wird einmal gemessen, nicht in jeder Testdatei neu.
const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));
const BECKEN = SKEL.rollenKnochen.pelvis;
const KOPF = PROFIL.joints.head.bone;

/** Eine Timeline: in jedem genannten Frame dieselbe Drehung, andere Position. */
function timeline(eintraege) {
  const overrides = {};
  for (const [frame, pos, grad] of eintraege) {
    overrides[String(frame)] = {
      joints: { knee_l: { bend: 5 } },
      root: { pos, drehGrad: { x: grad } },
      ease: 'hold',
    };
  }
  const frameCount = Math.max(...eintraege.map(([f]) => f)) + 1;
  return { schemaVersion: 1, fps: 30, frameCount, rotationFormat: 'quaternion', phases: [], overrides, anchors: [] };
}

const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('drehGrad.x: das Becken bleibt auf root.pos, wo immer die Figur steht', () => {
  const faelle = [[0, [0, 1.5, 0], -90], [10, [0, 1.5, 2], -90], [20, [0, 1.5, -4], -90], [30, [1, 1.5, 3], -200]];
  const { frames } = loeseBewegung(PROFIL, SKEL, timeline(faelle), {});
  for (const [f, pos] of faelle) {
    const becken = frames[f].positions[BECKEN];
    const abw = abstand(becken, pos);
    assert.ok(abw < 1e-3,
      `Frame ${f}: Becken bei [${becken.map((v) => v.toFixed(3))}], gesetzt war [${pos}] — ${(abw * 100).toFixed(1)} cm daneben`);
  }
});

test('drehGrad.x: die Kopfhöhe hängt nicht von der z-Position ab', () => {
  const { frames } = loeseBewegung(PROFIL, SKEL, timeline([[0, [0, 1.5, 0], -90], [10, [0, 1.5, 2], -90]]), {});
  const kopf0 = frames[0].positions[KOPF];
  const kopf10 = frames[10].positions[KOPF];
  assert.ok(Math.abs(kopf0[1] - kopf10[1]) < 1e-3,
    `Kopfhöhe bei z=0: ${kopf0[1].toFixed(3)} m, bei z=2: ${kopf10[1].toFixed(3)} m — `
    + `Unterschied ${((kopf10[1] - kopf0[1]) * 100).toFixed(1)} cm, erlaubt 0,1 cm`);
  // Negativfall: die Drehung muss gegriffen haben. Bei −90° liegt der Kopf
  // etwa auf Beckenhöhe, nicht 0,5 m darüber wie im Stand.
  const becken0 = frames[0].positions[BECKEN];
  assert.ok(Math.abs(kopf0[1] - becken0[1]) < 0.15,
    `Kopf ${(kopf0[1] - becken0[1]).toFixed(3)} m über dem Becken — bei −90° erwartet < 0,15 m, `
    + 'die Drehung hat nicht gegriffen');
});
