// Abnahmetest — „Ein set_pose-Schlüsselbild ist die ganze Haltung".
//
// Lauf 10 vom 2. September 2026: toes_l.bend 35 auf Frame 36 gesetzt, in
// keinem der acht späteren Schlüsselbilder genannt — der Kanal blieb bis
// Frame 95 auf 35°, die Zehen standen die ganze Landung über im Boden. Der
// Agent liest ein Schlüsselbild als ganze Haltung; der Löser hielt nicht
// genannte Kanäle fest.
//
// Positivfall: ein Haltungs-Schlüsselbild (haltung: true, gesetzt von
// set_pose) stellt nicht genannte Kanäle in die Ruhelage.
// Negativfall: ein Nachtrag ohne Marke (set_joint) hält die übrigen Kanäle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { ladeXbot, xbotProfil } from '../rig/xbot-profil.mjs';
import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { createToolLayer } from '../tools/index.js';
import { echtePorts } from '../tools/ports.js';

const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));

function loese(overrides) {
  const timeline = {
    schemaVersion: 1, fps: 30, frameCount: 50, rotationFormat: 'quaternion',
    phases: [], anchors: [], overrides,
  };
  return loeseBewegung(PROFIL, SKEL, timeline, {}).frames;
}

test('Haltungs-Schlüsselbild: ein nicht genannter Kanal steht dort in der Ruhelage', () => {
  const frames = loese({
    '10': { joints: { toes_l: { bend: 35 } }, ease: 'smooth', haltung: true },
    '30': { joints: { knee_l: { bend: 20 } }, ease: 'smooth', haltung: true },
  });
  assert.ok(Math.abs(frames[10].dofs['toes_l.bend'] - 35) < 0.01, `Frame 10: ${frames[10].dofs['toes_l.bend']}`);
  assert.ok(Math.abs(frames[30].dofs['toes_l.bend']) < 0.01,
    `Frame 30 nennt toes_l nicht — erwartet 0, gemessen ${frames[30].dofs['toes_l.bend']}`);
  assert.ok(Math.abs(frames[45].dofs['toes_l.bend']) < 0.01, `Frame 45: ${frames[45].dofs['toes_l.bend']}`);
  const mitte = frames[20].dofs['toes_l.bend'];
  assert.ok(mitte > 5 && mitte < 30, `Frame 20 blendet über: ${mitte}`);
});

test('Negativfall: ein Nachtrag ohne Marke hält die übrigen Kanäle', () => {
  const frames = loese({
    '10': { joints: { toes_l: { bend: 35 } }, ease: 'smooth', haltung: true },
    '30': { joints: { knee_l: { bend: 20 } }, ease: 'smooth' },
  });
  assert.ok(Math.abs(frames[30].dofs['toes_l.bend'] - 35) < 0.01,
    `Frame 30 ist ein Nachtrag — toes_l.bend bleibt 35, gemessen ${frames[30].dofs['toes_l.bend']}`);
});

test('Werkzeugschicht: set_pose setzt die Marke, set_joint auf einem leeren Frame nicht', async () => {
  const g2 = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ports = echtePorts();
  await ports.bereit;
  await ports.setzeModell(g2, { fileName: 'Xbot.glb' });
  const s = await createToolLayer({ ports });
  await s.rufe('set_duration', { frameCount: 40 });
  await s.rufe('set_pose', { frame: 5, joints: { toes_l: { bend: 35 } } });
  await s.rufe('set_joint', { frame: 25, joint: 'knee_l', channel: 'bend', angleDeg: 20 });
  await s.rufe('set_pose', { frame: 35, joints: { knee_l: { bend: 10 } } });
  const ov = s.store.roh().overrides;
  assert.equal(ov['5'].haltung, true);
  assert.notEqual(ov['25'].haltung, true, 'set_joint ist ein Nachtrag');
  assert.equal(ov['35'].haltung, true);
  const frames = ports.solver.loese(s.store.roh()).frames;
  // Frame 25 ist ein Nachtrag: er setzt keinen eigenen toes-Wert, also liegt
  // er auf der Überblendung zwischen 35 (Frame 5) und 0 (Frame 35).
  const bei25 = frames[25].dofs['toes_l.bend'];
  assert.ok(bei25 > 0 && bei25 < 35, `Frame 25 (Nachtrag) liegt auf der Überblendung: ${bei25}`);
  assert.ok(Math.abs(frames[35].dofs['toes_l.bend']) < 0.01, `Frame 35 (Haltung): ${frames[35].dofs['toes_l.bend']}`);
});
