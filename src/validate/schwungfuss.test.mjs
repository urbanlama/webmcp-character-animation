// Ein Schwungfuss rutscht nicht — er geht.
//
// Vorher entschied die figurweite Phase ueber die Rutschpruefung, und geprueft
// wurden dann BEIDE Fuesse. Beim Gehen steht immer einer am Boden, also war die
// Figur "in Kontakt" — und der Schwungfuss, der gerade durch die Luft schwingt,
// wurde mitgeprueft. Bei der Kontaktschwelle von 3,5 % der Koerperhoehe
// (6,3 cm am Xbot) galt er als aufliegend, denn ein Schwungfuss geht beim
// Durchschwingen nur 2 bis 5 cm ueber den Boden.
//
// Gemessen am Agentenlauf vom 1. September 2026: 19 bis 33 cm "Rutschen" ueber
// die Frames 4–34, also den kompletten Anlauf. Der Agent schrieb "der Pruefer
// wertet sie als Kontakt" und beugte die Knie von 40 auf 56 Grad, um die Fuesse
// hoeher zu bekommen. Aus dem Gang wurde ein Storchengang.
//
// Positivfall: ein Gehzyklus mit wechselndem Standbein meldet kein Rutschen.
// Negativfall: ein Standfuss, der wirklich verschoben wird, MUSS gemeldet
// werden — sonst prueft der Test nichts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefePhysik } from './physics.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  return { profil, skel: baueSkeleton(profil, erfasseBind(gltf.scene)) };
}

function rutschbefunde(profil, frames) {
  const r = pruefePhysik(profil, frames, 30);
  return (r.issues ?? []).filter((i) => (i.kind ?? i.art) === 'rutschen');
}

/** Zwei Schritte: die Beine wechseln, das Becken wandert gleichmaessig vor. */
const GANG = {
  fps: 30, frameCount: 40, phases: [],
  overrides: {
    0:  { joints: { hip_l: { flex: 25 }, knee_l: { bend: 10 }, hip_r: { flex: -20 }, knee_r: { bend: 30 } },
          root: { pos: [0, 1.02, 0] }, ease: 'smooth' },
    10: { joints: { hip_l: { flex: 0 },  knee_l: { bend: 5 },  hip_r: { flex: 0 },  knee_r: { bend: 45 } },
          root: { pos: [0, 1.04, 0.32] }, ease: 'smooth' },
    20: { joints: { hip_l: { flex: -20 }, knee_l: { bend: 30 }, hip_r: { flex: 25 }, knee_r: { bend: 10 } },
          root: { pos: [0, 1.02, 0.64] }, ease: 'smooth' },
    30: { joints: { hip_l: { flex: 0 },  knee_l: { bend: 45 }, hip_r: { flex: 0 },  knee_r: { bend: 5 } },
          root: { pos: [0, 1.04, 0.96] }, ease: 'smooth' },
    39: { joints: { hip_l: { flex: 25 }, knee_l: { bend: 10 }, hip_r: { flex: -20 }, knee_r: { bend: 30 } },
          root: { pos: [0, 1.02, 1.25] }, ease: 'smooth' },
  },
};

test('Rutschen: ein Fuß in der Luft wird nicht gemeldet', async () => {
  const { profil, skel } = await aufbau();
  const { frames } = loeseBewegung(profil, skel, GANG);
  const g = profil.world.groundY;
  const sohlenVon = (bone) => (profil.soles ?? []).filter((s) => s.bone === bone).map((s) => s.id);

  // Geprueft wird nicht die ANZAHL der Befunde — in diesem von Hand gesetzten
  // Gang rutschen die Standfuesse wirklich ein wenig, und das ist richtig so.
  // Geprueft wird, dass kein Fuss gemeldet wird, der in der Luft haengt.
  const daneben = [];
  for (const b of rutschbefunde(profil, frames)) {
    const bone = b.teil ?? b.part ?? b.bone;
    const f = frames[b.frame ?? b.index];
    const sp = f?.solePositions ?? {};
    const tiefste = Math.min(...sohlenVon(bone).map((id) => (sp[id]?.[1] ?? Infinity) - g));
    if (tiefste > profil.world.height * 0.02) {
      daneben.push(`Frame ${b.frame}: ${bone} gemeldet, tiefste Sohle ${(tiefste * 100).toFixed(1)} cm über dem Boden`);
    }
  }
  assert.deepStrictEqual(daneben, [],
    `${daneben.length} Meldungen für Füße in der Luft — ${daneben.join(' | ')} — `
    + 'ein Schwungfuß geht, er rutscht nicht');
});

test('Rutschen, Negativfall: ein wirklich verschobener Standfuß wird gemeldet', async () => {
  const { profil, skel } = await aufbau();
  const { frames } = loeseBewegung(profil, skel, {
    fps: 30, frameCount: 10, phases: [],
    overrides: {
      0: { joints: { hip_l: { flex: 0 }, hip_r: { flex: 0 } }, root: { pos: [0, 1.04, 0] }, ease: 'smooth' },
      9: { joints: { hip_l: { flex: 0 }, hip_r: { flex: 0 } }, root: { pos: [0, 1.04, 0.5] }, ease: 'smooth' },
    },
  });
  const befunde = rutschbefunde(profil, frames);
  assert.ok(befunde.length > 0,
    'beide Füße stehen auf dem Boden, während das Becken 50 cm wandert — '
    + 'das MUSS als Rutschen gemeldet werden, sonst prüft der Positivfall nichts');
});
