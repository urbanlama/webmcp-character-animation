// Abnahmetest — „set_pose sagt, wenn eine Wurzelposition die Wurfbahn teilt".
//
// Agentenlauf 9 vom 2. September 2026: Tuck bei Frame 44 mit y = 1,8 zwischen
// Absprung 34 (wurf) und Landung 55. Acht validate-Aufrufe lang ein
// Ballistik-Knick bei 44; der Agent drehte an der Höhe (1,61 → 1,8), ohne dass
// ihm ein Werkzeug den Grund nannte.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { createToolLayer } from './index.js';
import { echtePorts } from './ports.js';

async function schichtMitXbot() {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ports = echtePorts();
  await ports.bereit;
  await ports.setzeModell(gltf, { fileName: 'Xbot.glb' });
  const s = await createToolLayer({ ports });
  await s.rufe('set_duration', { frameCount: 70 });
  await s.rufe('set_pose', { frame: 34, joints: { hip_r: { flex: 60 } }, ease: 'wurf', root: { pos: [0, 1.13, 1.7] } });
  await s.rufe('set_pose', { frame: 55, joints: { hip_r: { flex: 20 } }, root: { pos: [0, null, 2.8] } });
  return s;
}

const text = (antwort) => antwort.content?.map((c) => c.text ?? '').join('\n') ?? '';

test('set_pose: eine Wurzelposition zwischen wurf-Schlüssel und Landung wird als Knick gemeldet', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', {
    frame: 44, joints: { hip_l: { flex: 110 }, hip_r: { flex: 110 } }, ease: 'wurf',
    root: { pos: [0, 1.8, 2.2], drehGrad: { x: -180 } },
  }));
  assert.match(t, /Frame 44 liegt im Flug zwischen 34 \(ease "wurf"\) und 55/, t);
  assert.match(t, /OHNE root\.pos/, t);
});

test('set_pose: y = null im Flug ist ebenso ein Schlüssel und wird gemeldet', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 44, joints: { hip_l: { flex: 110 } }, root: { pos: [0, null, 2.2] } }));
  assert.match(t, /Frame 44 liegt im Flug/, t);
});

test('set_pose, Negativfall: Flugpose nur mit Drehung (ohne pos) löst keine Warnung aus', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 44, joints: { hip_l: { flex: 110 } }, ease: 'wurf', root: { drehGrad: { x: -180 } } }));
  assert.doesNotMatch(t, /liegt im Flug/, t);
});

test('set_pose, Negativfall: eine Wurzel zwischen zwei Standposen ohne wurf ist kein Flug', async () => {
  const s = await schichtMitXbot();
  await s.rufe('set_pose', { frame: 5, joints: { hip_r: { flex: 10 } }, root: { pos: [0, null, 0.2] } });
  await s.rufe('set_pose', { frame: 25, joints: { hip_r: { flex: 10 } }, root: { pos: [0, null, 1.0] } });
  const t = text(await s.rufe('set_pose', { frame: 15, joints: { hip_r: { flex: 20 } }, root: { pos: [0, null, 0.6] } }));
  assert.doesNotMatch(t, /liegt im Flug/, t);
});
