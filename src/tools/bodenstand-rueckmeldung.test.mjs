// Abnahmetest — „Der Agent erfährt mit Zahl, ob die Figur steht, schwebt oder
// angehoben wurde".
//
// Bühnenlauf vom 2. September 2026, Befund A: für „schwebt 15 cm", „steckt
// 11 cm im Boden" und „steht richtig" kam aus set_pose dieselbe Zeile
// „Bodenkontakt"; die Sohle war nicht messbar (measure kannte nur den
// Fußknochen, 8,8 cm über der Sohle); hold_foot lehnte „beide" ab, obwohl der
// Katalogtext es versprach.
//
// Seit dem Bodenstand im Löser steht die Figur ohne gesetzte Höhe auf dem
// Boden. Hier wird geprüft, dass die Werkzeugschicht das auch SAGT — mit Zahl —
// und dass die drei Werkzeuge die neuen Eingaben annehmen.
//
// Negativfälle: eine gesetzte Höhe muss als „schwebt" mit Betrag gemeldet
// werden (nicht als „steht"), und eine zu tiefe Höhe als Anhebung mit Betrag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { createToolLayer } from './index.js';
import { echtePorts } from './ports.js';
import { bodenzeile } from './handlers.js';

async function schichtMitXbot() {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ports = echtePorts();
  await ports.bereit;
  await ports.setzeModell(gltf, { fileName: 'Xbot.glb' });
  const s = await createToolLayer({ ports });
  await s.rufe('set_duration', { frameCount: 12 });
  return s;
}

const text = (antwort) => antwort.content?.map((c) => c.text ?? '').join('\n') ?? '';
const HOCKE = { knee_l: { bend: 60 }, knee_r: { bend: 60 }, hip_l: { flex: 50 }, hip_r: { flex: 50 } };

test('set_pose Hocke ohne root: die Wirkung sagt „steht auf dem Boden" und nennt die Absenkung in cm', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 0, joints: HOCKE }));
  assert.match(t, /steht auf dem Boden/, t);
  assert.match(t, /abgesenkt/, 'die Absenkung wird genannt');
  assert.match(t, /\d+,\d cm/, 'mit Betrag in cm');
  assert.doesNotMatch(t, /Flugphase/, 'eine Hocke ist keine Flugphase');
  assert.match(t, /auf den Boden gestellt/, 'der Wurzeltext sagt, dass der Boden die Höhe bestimmt');
});

test('Negativfall: gesetzte Höhe schwebt — und die Wirkung sagt es mit Betrag und Ausweg', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 0, joints: HOCKE, root: { pos: [0, 1.2, 0] } }));
  assert.match(t, /schwebt \d+,\d cm ueber dem Boden/, t);
  assert.match(t, /root\.pos y = 1\.2 m/, 'nennt die gesetzte Höhe als Ursache');
  assert.match(t, /null/, 'nennt den Ausweg (y = null)');
  assert.match(t, /weder Balance noch Fussrutschen/, 'sagt, was im Flug nicht geprüft wird');
  assert.doesNotMatch(t, /steht auf dem Boden/);
});

test('Negativfall: zu tief gesetzt — angehoben, mit Betrag', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 0, joints: HOCKE, root: { pos: [0, 0.79, 0] } }));
  assert.match(t, /Wurzel um \d+,\d cm angehoben/, t);
  assert.match(t, /im Boden/, 'nennt den Grund');
});

test('set_pose nimmt y = null: Position gilt für x und z, die Höhe kommt vom Boden', async () => {
  const s = await schichtMitXbot();
  const t = text(await s.rufe('set_pose', { frame: 0, joints: HOCKE, root: { pos: [0.3, null, 0.2] } }));
  assert.match(t, /Position \[0\.3, Boden, 0\.2\]/, t);
  assert.match(t, /steht auf dem Boden/);
  const p = JSON.parse(text(await s.rufe('describe_pose', { frame: 0 })));
  assert.ok(Math.abs(p.wurzel.pos_m[0] - 0.3) < 1e-3 && Math.abs(p.wurzel.pos_m[2] - 0.2) < 1e-3, JSON.stringify(p.wurzel));
  assert.equal(p.wurzelhoehe.quelle, 'boden');
  assert.ok(Math.abs(p.bodenabstand_m) < 0.002, `bodenabstand_m ${p.bodenabstand_m}`);
  assert.ok(p.sohlen_m && typeof p.sohlen_m.foot_l === 'number', 'sohlen_m je Fuß');
});

test('measure kennt sole_l und sole_r: die Sohle einer stehenden Figur liegt auf 0', async () => {
  const s = await schichtMitXbot();
  await s.rufe('set_pose', { frame: 0, joints: HOCKE });
  const m = JSON.parse(text(await s.rufe('measure', {
    frame: 0,
    fragen: [{ art: 'hoehe', a: 'sole_l' }, { art: 'hoehe', a: 'foot_l' }],
  })));
  const werte = JSON.stringify(m);
  const sohle = JSON.stringify(m).match(/"wert_m":(-?[\d.]+)/g).map((x) => +x.split(':')[1]);
  assert.equal(sohle.length, 2, werte);
  assert.ok(Math.abs(sohle[0]) < 0.03, `sole_l muss nahe 0 liegen (Sohle 1,2–2,4 cm über der tiefsten Zehe), ist ${sohle[0]} — ${werte}`);
  assert.ok(sohle[1] > 0.05, `foot_l (Knochen) liegt deutlich über der Sohle, ist ${sohle[1]}`);
});

test('hold_foot nimmt „beide" und legt zwei Anker an', async () => {
  const s = await schichtMitXbot();
  await s.rufe('set_pose', { frame: 0, joints: HOCKE });
  await s.rufe('set_pose', { frame: 11, joints: HOCKE });
  const t = text(await s.rufe('hold_foot', { foot: 'beide', von: 0, bis: 11 }));
  assert.match(t, /foot_l und foot_r stehen/, t);
  assert.match(t, /2 Anker insgesamt/, t);
  assert.deepEqual(s.store.roh().anchors.map((a) => a.foot).sort(), ['foot_l', 'foot_r']);
});

test('bodenzeile, Negativfall: ein Frame ohne Höhenangabe fällt auf Kontakt mit Zahl zurück', () => {
  assert.deepEqual(bodenzeile({ contact: 'kontakt', bodenabstand_m: 0.004 }),
    ['Bodenkontakt (tiefster Punkt 0,4 cm ueber dem Boden)']);
  const flug = bodenzeile({ contact: 'flug', bodenabstand_m: 0.302 });
  assert.match(flug[0], /30,2 cm/);
  assert.match(flug[1], /Balance/);
});
