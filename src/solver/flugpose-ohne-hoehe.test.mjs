// Abnahmetest — „Eine Flugpose ohne Wurzel folgt der Wurfbahn".
//
// Befund vom 2. September 2026, Agentenlauf 9: Der Agent setzt Absprung
// (Frame 34, wurf), Tuck (Frame 44) und Landung (Frame 55). Mit fester Höhe
// bei 44 rechnet der Löser zwei getrennte Parabeln, am Stoß entsteht ein
// Knick — 28 m/s² in der Ballistikprüfung, in allen acht validate-Aufrufen.
// OHNE Höhe bei 44 wurde die Haltung ein Boden-Schlüssel: Wurzel 0,56 m,
// Schwerpunkt 0,68 m, tiefer als beim Absprung — die Figur fiel mitten im
// Flug auf den Boden und die Ballistik war zufällig still, weil die Phasen
// dort Kontakt sahen. Es gab keinen Weg, der beides vermeidet.
//
// Positivfall: Tuck ohne Wurzelposition zwischen wurf-Schlüssel und Landung
// liegt auf der Parabel, Ballistik still, Scheitel über dem Absprung.
// Negativfall: dieselbe Haltung MIT Höhe bleibt ein eigener Schlüssel — der
// Agent hat es so gesetzt, set_pose warnt ihn davor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { pruefePhysik } from '../validate/physics.js';
import { ladeXbot, xbotProfil } from '../rig/xbot-profil.mjs';

const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));

const ABSPRUNG = { pelvis: { tilt: -8 }, spine: { bend: -18 }, hip_l: { flex: -10 }, knee_l: { bend: 6 }, ankle_l: { point: 36 }, hip_r: { flex: 64 }, knee_r: { bend: 52 }, arm_l: { lift: 74 }, arm_r: { lift: 74 } };
const TUCK = { pelvis: { tilt: 12 }, spine: { bend: 30 }, neck: { bend: 22 }, hip_l: { flex: 116 }, knee_l: { bend: 120 }, hip_r: { flex: 116 }, knee_r: { bend: 120 }, arm_l: { lift: -38 }, arm_r: { lift: -38 } };
const LANDUNG = { pelvis: { tilt: 4 }, spine: { bend: 10 }, hip_l: { flex: 28 }, knee_l: { bend: 26 }, hip_r: { flex: 28 }, knee_r: { bend: 26 } };

function loese(overrides) {
  const timeline = {
    schemaVersion: 1, fps: 30, frameCount: 70, rotationFormat: 'quaternion',
    phases: [], anchors: [],
    overrides: { '0': { joints: LANDUNG, ease: 'smooth' }, ...overrides },
  };
  const r = loeseBewegung(PROFIL, SKEL, timeline, {});
  const physik = pruefePhysik(PROFIL, r.frames, 30);
  return { frames: r.frames, bericht: r.bericht, ballistik: physik.issues.filter((i) => i.kind === 'ballistik') };
}
const wurzelY = (r, f) => r.frames[f].positions[PROFIL.roles.pelvis.bone][1];

test('Flugpose ohne Wurzel: der Tuck liegt auf der Parabel, Ballistik still (Absprung mit Höhe)', () => {
  const r = loese({
    '34': { joints: ABSPRUNG, ease: 'wurf', root: { pos: [0, 1.13, 1.7] } },
    '44': { joints: TUCK, ease: 'wurf', root: { drehGrad: { x: -180 } } },
    '55': { joints: LANDUNG, ease: 'smooth', root: { pos: [0, null, 2.8] } },
  });
  assert.equal(r.ballistik.length, 0,
    `Ballistik-Befunde: ${r.ballistik.map((i) => i.frame + ':' + i.value).join(' ')}`);
  assert.ok(r.frames[44].com[1] > r.frames[34].com[1] + 0.3,
    `Schwerpunkt bei 44 = ${r.frames[44].com[1].toFixed(3)} m, beim Absprung ${r.frames[34].com[1].toFixed(3)} m — der Tuck muss am Scheitel liegen, nicht am Boden`);
  assert.ok(wurzelY(r, 44) > 1.13,
    `Wurzel bei 44 = ${wurzelY(r, 44).toFixed(3)} m, erwartet über der Absprunghöhe 1,13 m`);
  assert.ok(r.bericht.hinweise.some((h) => /Frame 44 .*zwischen 34 \(wurf\) und 55/.test(h)),
    `der Bericht muss sagen, dass Frame 44 der Wurfbahn folgt:\n${r.bericht.hinweise.join('\n')}`);
});

test('Flugpose ohne Wurzel: auch vom Boden weg (Absprung y = null, wurf) bleibt die Parabel ganz', () => {
  const r = loese({
    '34': { joints: ABSPRUNG, ease: 'wurf', root: { pos: [0, null, 1.7] } },
    '44': { joints: TUCK, ease: 'wurf' },
    '55': { joints: LANDUNG, ease: 'smooth', root: { pos: [0, null, 2.8] } },
  });
  assert.equal(r.ballistik.length, 0,
    `Ballistik-Befunde: ${r.ballistik.map((i) => i.frame + ':' + i.value).join(' ')}`);
  assert.ok(r.frames[44].com[1] > r.frames[34].com[1] + 0.3,
    `Schwerpunkt bei 44 = ${r.frames[44].com[1].toFixed(3)} m, beim Absprung ${r.frames[34].com[1].toFixed(3)} m`);
});

test('Negativfall: dieselbe Flugpose MIT fester Höhe bleibt ein eigener Schlüssel und knickt die Bahn', () => {
  const r = loese({
    '34': { joints: ABSPRUNG, ease: 'wurf', root: { pos: [0, 1.13, 1.7] } },
    '44': { joints: TUCK, ease: 'wurf', root: { pos: [0, 1.8, 2.2] } },
    '55': { joints: LANDUNG, ease: 'smooth', root: { pos: [0, null, 2.8] } },
  });
  assert.ok(r.ballistik.some((i) => i.frame === 44),
    'eine gesetzte Höhe wird getroffen — der Knick bei 44 ist die Folge und muss sichtbar bleiben');
  assert.ok(Math.abs(wurzelY(r, 44) - 1.8) < 0.01,
    `Wurzel bei 44 = ${wurzelY(r, 44).toFixed(3)} m, gesetzt 1,8 m — gesetzte Höhen werden exakt getroffen`);
});

test('Boden-Schlüssel bleiben Boden-Schlüssel: eine Haltung ohne Wurzel zwischen zwei Standposen steht weiter am Boden', () => {
  const r = loese({
    '10': { joints: LANDUNG, ease: 'smooth', root: { pos: [0, null, 0.5] } },
    '20': { joints: TUCK, ease: 'smooth' },
    '30': { joints: LANDUNG, ease: 'smooth', root: { pos: [0, null, 1.0] } },
  });
  assert.ok(r.frames[20].bodenabstand_m < 0.02,
    `Bodenabstand bei 20 = ${r.frames[20].bodenabstand_m} m — ohne wurf davor ist die Haltung ein Boden-Schlüssel`);
});
