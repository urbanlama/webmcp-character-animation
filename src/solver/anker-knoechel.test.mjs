// Abnahmetest — „Ein Fußanker verdreht weder Bein noch Knöchel".
//
// Befund aus Lauf 10 vom 2. September 2026, nachgerechnet am Löser: mit den
// acht Ankern des Laufs 19 Knöchelsprünge über 15° in einem Frame (bis 62°),
// ohne Anker 3. Ursache: die IK nahm die Kanäle, die der Agent nie gesetzt
// hatte — spread, twist, tilt — und hielt den Fuß durch Verdrehen; reichte
// das nicht, wechselte sie in einen zweiten Durchgang mit allen Kanälen, und
// die Lösung sprang von Frame zu Frame zwischen beiden Welten.
//
// Positivfall: Anker über eine Wurzelfahrt — twist und tilt bleiben 0, der
// Knöchel springt nicht, der Fuß steht.
// Negativfall: ohne Anker wandert der Fuß mit der Wurzel (der Anker tut also
// etwas).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { createToolLayer } from '../tools/index.js';
import { echtePorts } from '../tools/ports.js';

async function schicht() {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ports = echtePorts();
  await ports.bereit;
  await ports.setzeModell(gltf, { fileName: 'Xbot.glb' });
  const s = await createToolLayer({ ports });
  await s.rufe('set_duration', { frameCount: 30 });
  return { s, ports };
}

// Standbein links gesetzt (flex, bend, point), Wurzel fährt 35 cm nach vorn.
const STAND = { hip_l: { flex: 10 }, knee_l: { bend: 15 }, ankle_l: { point: -5 }, hip_r: { flex: 30 }, knee_r: { bend: 60 } };
const FUSS_L = 'mixamorigLeftFoot';

async function geloest(mitAnker) {
  const { s, ports } = await schicht();
  await s.rufe('set_pose', { frame: 0, joints: STAND, root: { pos: [0, null, 0] } });
  await s.rufe('set_pose', { frame: 20, joints: STAND, root: { pos: [0, null, 0.35] } });
  if (mitAnker) await s.rufe('hold_foot', { foot: 'foot_l', von: 0, bis: 20 });
  return ports.solver.loese(s.store.roh()).frames;
}

test('Anker: hip.twist und ankle.tilt bleiben 0, der Knöchel springt nicht, der Fuß steht', async () => {
  const frames = await geloest(true);
  let maxTilt = 0, maxTwist = 0, maxSprung = 0;
  for (let i = 0; i <= 20; i++) {
    const d = frames[i].dofs;
    maxTilt = Math.max(maxTilt, Math.abs(d['ankle_l.tilt'] ?? 0));
    maxTwist = Math.max(maxTwist, Math.abs(d['hip_l.twist'] ?? 0));
    if (i > 0) maxSprung = Math.max(maxSprung, Math.abs((d['ankle_l.point'] ?? 0) - (frames[i - 1].dofs['ankle_l.point'] ?? 0)));
  }
  assert.ok(maxTilt < 0.01, `ankle_l.tilt bis ${maxTilt.toFixed(1)}° — die IK darf den Knöchel nicht seitlich kippen`);
  assert.ok(maxTwist < 0.01, `hip_l.twist bis ${maxTwist.toFixed(1)}° — die IK darf das Bein nicht verdrehen`);
  assert.ok(maxSprung < 10, `ankle_l.point springt um ${maxSprung.toFixed(1)}° in einem Frame`);

  const p0 = frames[0].positions[FUSS_L];
  let maxWeg = 0;
  for (let i = 1; i <= 20; i++) {
    const p = frames[i].positions[FUSS_L];
    maxWeg = Math.max(maxWeg, Math.hypot(p[0] - p0[0], p[2] - p0[2]));
  }
  assert.ok(maxWeg < 0.03, `der verankerte Fuß wandert ${(maxWeg * 100).toFixed(1)} cm — er soll stehen`);
});

test('Negativfall: ohne Anker fährt der Fuß mit der Wurzel mit', async () => {
  const frames = await geloest(false);
  const p0 = frames[0].positions[FUSS_L], p20 = frames[20].positions[FUSS_L];
  const weg = Math.hypot(p20[0] - p0[0], p20[2] - p0[2]);
  assert.ok(weg > 0.25, `ohne Anker müsste der Fuß rund 35 cm mitfahren, gemessen ${(weg * 100).toFixed(1)} cm`);
});
