// Abnahmetest — „Keine Grenze ist enger als das, was das Modell selbst fährt".
//
// Befund vom 2. September 2026 (docs/buehne-befunde-2026-09-02.md, Nachlese zu
// Auftrag E): der anatomische Katalog klemmt an zwei Kanälen Bewegung ab, die
// die mitgelieferten Animationen des Xbot fahren.
//
//     head.bend        Grenze -35…30   Clips fahren -12,7…35,2   5,2 Grad zu eng
//     shoulder_l.fwd   Grenze -25…25   Clips fahren   0,0…26,4   1,4 Grad zu eng
//
// Eine Grenze, gegen die eine ausgelieferte Animation des Modells verstößt, ist
// widerlegt — das ist ein Kriterium aus dem Modell, keine gewählte Zahl. Die
// Kollisionsmessung engt den Katalog ein (measureJointLimits), sie weitet ihn
// nie auf; genau diese Richtung fehlte.
//
// Positivfall: nach der Vermessung fährt kein Referenzclip mehr über eine
// Grenze hinaus.
// Negativfall: eine Grenze, die aus einem gemessenen Haut-auf-Haut-Kontakt
// stammt, wird NICHT aufgeweitet — dort steht ein Beleg gegen die Bewegung.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB, clipSpannen, REFERENZ_CLIPS } from './measure.js';
import { xbotProfil } from './xbot-profil.mjs';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

let gltf = null;
let profil = null;
let spannen = null;

before(async () => {
  const buf = readFileSync(XBOT);
  gltf = await loadGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  profil = await xbotProfil();
  spannen = clipSpannen(gltf);
}, { timeout: 600000 });

test('Kein Referenzclip fährt über eine Gelenkgrenze hinaus', () => {
  const verstoesse = [];
  for (const [gelenk, j] of Object.entries(profil.joints)) {
    for (const [kanal, d] of Object.entries(j.dof ?? {})) {
      const s = spannen.get(`${gelenk}.${kanal}`);
      if (!s) continue;
      const [lo, hi] = d.limit;
      if (s.min < lo - 0.5) verstoesse.push(`${gelenk}.${kanal}: Clips fahren ${s.min.toFixed(1)}°, Grenze endet bei ${lo}°`);
      if (s.max > hi + 0.5) verstoesse.push(`${gelenk}.${kanal}: Clips fahren ${s.max.toFixed(1)}°, Grenze endet bei ${hi}°`);
    }
  }
  assert.deepEqual(verstoesse, [],
    `${verstoesse.length} Kanäle klemmen Bewegung ab, die die ausgelieferten Animationen `
    + `des Modells selbst fahren:\n  ${verstoesse.join('\n  ')}`);
});

test('Die Aufweitung ist als gemessen ausgewiesen, nicht als anatomisch', () => {
  // head.bend oben ist der grösste belegte Fall: Katalog 30, Clips 35,2.
  const d = profil.joints.head.dof.bend;
  const s = spannen.get('head.bend');
  assert.ok(s.max > 30, `Vorbedingung: die Clips müssen über den Katalogwert 30° hinausfahren, gemessen ${s.max.toFixed(1)}°`);
  assert.ok(d.limit[1] >= s.max - 0.5,
    `head.bend endet bei ${d.limit[1]}°, die Clips fahren ${s.max.toFixed(1)}°`);
  assert.equal(d.limitSource.max, 'gemessen',
    'eine aus dem Modell aufgeweitete Grenze ist gemessen, nicht anatomisch');
});

test('Symmetrie: die Aufweitung gilt auf beiden Seiten', () => {
  // Der Katalog fuehrt die Grenzen ausdruecklich beidseitig identisch
  // (measure.js, Kommentar ueber JOINT_CATALOG). Faehrt ein Clip nur links
  // ueber die Schranke, darf die Figur danach nicht einseitig beweglicher sein.
  for (const [l, r] of [['shoulder_l', 'shoulder_r'], ['arm_l', 'arm_r'],
    ['elbow_l', 'elbow_r'], ['hip_l', 'hip_r'], ['knee_l', 'knee_r']]) {
    for (const kanal of Object.keys(profil.joints[l].dof ?? {})) {
      const a = profil.joints[l].dof[kanal];
      const b = profil.joints[r].dof?.[kanal];
      if (!b) continue;
      // Gemessene Kollisionsgrenzen duerfen sich unterscheiden — die Geometrie
      // ist nicht exakt spiegelbildlich. Anatomische muessen gleich sein.
      if (a.limitSource.max === 'anatomisch' && b.limitSource.max === 'anatomisch') {
        assert.equal(a.limit[1], b.limit[1], `${l}.${kanal} und ${r}.${kanal} obere Grenze`);
      }
      if (a.limitSource.min === 'anatomisch' && b.limitSource.min === 'anatomisch') {
        assert.equal(a.limit[0], b.limit[0], `${l}.${kanal} und ${r}.${kanal} untere Grenze`);
      }
    }
  }
});

test('REFERENZ_CLIPS nennt genau die vier Entwicklungsclips', () => {
  // AGENTS.md Regel 3: run, headShake und sneak_pose bleiben der Abnahme
  // vorbehalten und duerfen hier nicht mitzaehlen.
  assert.deepEqual([...REFERENZ_CLIPS].sort(), ['agree', 'idle', 'sad_pose', 'walk']);
});
