// Abnahmetest — „set_pose meldet Rutschen nur für den Fuß, der wirklich steht".
//
// Fund aus dem Agentenlauf vom 2. September 2026 (Lauf 7, Reibungsbericht
// 1.9): Beim Setzen einer Schrittpose kam
//
//   „foot_l wandert 144 cm seit Frame 56, obwohl der Boden berührt wird"
//
// für einen Fuß, der die ganze Spanne in der Luft war. Die Sofortmeldung
// fragte nach der Kontaktphase der FIGUR (`frame.contact !== 'flug'`) und
// prüfte danach beide Füße. Beim Gehen steht immer einer — also galt auch der
// Schwungfuß als aufliegend, und sein Schritt als Rutschen. Der Agent hat
// mehrfach nach schleifenden Füßen gesucht, die nicht schliffen.
//
// Die Physikprüfung machte es längst richtig (src/validate/schwungfuss.test.mjs);
// die Sofortmeldung hatte ein eigenes, gröberes Kriterium. Seitdem benutzen
// beide dieselbe Antwort: fussLiegtAuf().
//
// Negativfall: ein Standfuß, der wirklich verschoben wird, MUSS weiter
// gemeldet werden — sonst prüft der Test nichts.

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
  await s.rufe('set_duration', { frameCount: 30 });
  return s;
}

const text = (antwort) => antwort.content?.map((c) => c.text ?? '').join('\n') ?? '';

test('set_pose: ein Schritt mit angehobenem Schwungbein meldet kein Rutschen', async () => {
  const s = await schichtMitXbot();

  // Zwei Schrittposen: links steht, rechts schwingt durch und setzt vorn auf.
  // Das rechte Bein ist in beiden Frames deutlich angehoben — es kann nicht
  // rutschen, weil es nicht trägt.
  await s.rufe('set_pose', {
    frame: 0,
    joints: { hip_l: { flex: -10 }, knee_l: { bend: 8 }, hip_r: { flex: 45 }, knee_r: { bend: 75 } },
    root: { pos: [0, null, 0] },
  });
  const t = text(await s.rufe('set_pose', {
    frame: 10,
    joints: { hip_l: { flex: -20 }, knee_l: { bend: 12 }, hip_r: { flex: 25 }, knee_r: { bend: 40 } },
    root: { pos: [0, null, 0.6] },
  }));

  assert.doesNotMatch(t, /foot_r .*wandert|foot_r liegt/,
    `der Schwungfuß hängt in der Luft und darf nicht als Rutschen gemeldet werden:\n${t}`);
});

test('set_pose, Negativfall: ein Standfuß, der verschoben wird, wird weiter gemeldet', async () => {
  const s = await schichtMitXbot();

  // Beide Füße stehen, die Wurzel fährt 60 cm weiter, und kein Anker hält
  // etwas fest: dann wandern die Füße mit — genau das, was validate später
  // als Rutschen meldet.
  const STAND = { hip_l: { flex: 0 }, knee_l: { bend: 5 }, hip_r: { flex: 0 }, knee_r: { bend: 5 } };
  await s.rufe('set_pose', { frame: 0, joints: STAND, root: { pos: [0, null, 0] } });
  const t = text(await s.rufe('set_pose', { frame: 10, joints: STAND, root: { pos: [0, null, 0.6] } }));

  assert.match(t, /liegt in Frame 0 und 10 auf, wandert dabei aber/,
    `ein stehender Fuß, der 60 cm mitwandert, muss gemeldet werden:\n${t}`);
  assert.match(t, /wandert dabei aber \d+(,\d+)? cm/, 'die Meldung nennt den Betrag in cm');
});
