import test from 'node:test';
import assert from 'node:assert/strict';
import { editorFrame } from './ansichtsmodus.js';

function punktNah(ist, soll) {
  assert.equal(ist.length, soll.length);
  ist.forEach((wert, i) => assert.ok(Math.abs(wert - soll[i]) < 1e-10,
    `Koordinate ${i}: ${wert} statt ${soll[i]}`));
}

test('Editor stellt das Becken in X/Z auf den Ursprung und schiebt alle Knochen mit', () => {
  const frame = {
    root: { pos: [4.5, 1.8, 6] },
    bones: {
      hips: { position: [4.5, 1.8, 6], quaternion: [0, 0, 0, 1] },
      hand: { position: [4.9, 2.9, 6.4], quaternion: [0, 0, 0, 1] },
    },
  };

  const editor = editorFrame(frame, { root: { pos: [2, 1.1, -3] } });

  punktNah(editor.root.pos, [0, 1.8, 0]);
  punktNah(editor.bones.hips.position, [0, 1.8, 0]);
  punktNah(editor.bones.hand.position, [0.4, 2.9, 0.4]);
  // Der Originalframe bleibt unangetastet.
  assert.deepEqual(frame.root.pos, [4.5, 1.8, 6]);
  assert.deepEqual(frame.bones.hand.position, [4.9, 2.9, 6.4]);
});

test('Editor: ein versetzter Startframe verschiebt die Figur NICHT aus der Mitte', () => {
  // Negativfall zum Lauf vom 1. September 2026: Anlauf beginnt bei z = −2,48 m.
  // Die alte Fassung legte jeden Frame auf diese Startposition — 2,48 m neben
  // dem Gitterzentrum. Jetzt zaehlt der Startframe nicht mehr.
  const start = { root: { pos: [0, 1.04, -2.48] } };
  const frame = { root: { pos: [0, 0.9, 2.33] }, bones: { hips: { position: [0, 0.9, 2.33] } } };
  const editor = editorFrame(frame, start);
  punktNah(editor.root.pos, [0, 0.9, 0]);
  punktNah(editor.bones.hips.position, [0, 0.9, 0]);
});

test('Editor lässt Frames ohne brauchbare Root-Position unverändert', () => {
  const frame = { bones: { hips: { position: [1, 2, 3] } } };
  assert.equal(editorFrame(frame, { root: { pos: [0, 1, 0] } }), frame);
});
