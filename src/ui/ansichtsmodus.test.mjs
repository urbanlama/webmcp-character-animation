import test from 'node:test';
import assert from 'node:assert/strict';
import { editorFrame } from './ansichtsmodus.js';

function punktNah(ist, soll) {
  assert.equal(ist.length, soll.length);
  ist.forEach((wert, i) => assert.ok(Math.abs(wert - soll[i]) < 1e-10,
    `Koordinate ${i}: ${wert} statt ${soll[i]}`));
}

test('Editor hält die gesamte Figur horizontal am ersten Root-Frame fest', () => {
  const start = {
    root: { pos: [2, 1.1, -3] },
    bones: {
      hips: { position: [2, 1.1, -3], quaternion: [0, 0, 0, 1] },
      hand: { position: [2.4, 2.2, -2.6], quaternion: [0, 0, 0, 1] },
    },
  };
  const frame = {
    root: { pos: [4.5, 1.8, 6] },
    bones: {
      hips: { position: [4.5, 1.8, 6], quaternion: [0, 0, 0, 1] },
      hand: { position: [4.9, 2.9, 6.4], quaternion: [0, 0, 0, 1] },
    },
  };

  const editor = editorFrame(frame, start);

  punktNah(editor.root.pos, [2, 1.8, -3]);
  punktNah(editor.bones.hips.position, [2, 1.8, -3]);
  punktNah(editor.bones.hand.position, [2.4, 2.9, -2.6]);
  assert.deepEqual(frame.root.pos, [4.5, 1.8, 6]);
  assert.deepEqual(frame.bones.hand.position, [4.9, 2.9, 6.4]);
});

test('Editor lässt Frames ohne brauchbare Root-Position unverändert', () => {
  const frame = { bones: { hips: { position: [1, 2, 3] } } };
  assert.equal(editorFrame(frame, { root: { pos: [0, 1, 0] } }), frame);
});
