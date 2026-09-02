// Die Bodenpruefung darf keine Knochen melden, an denen nichts haengt.
//
// Mixamo fuehrt Hilfsknochen ohne jede Haut: beide Toe_End, HeadTop_End, die
// Augen, alle zehn Fingerspitzen. Am Xbot sind das 15 von 67 Knochen, gemessen
// ueber die Skin-Gewichte.
//
// Warum das nicht kosmetisch ist: der Toe_End-Knochen liegt konstruktiv TIEFER
// als der tiefste Sohlenpunkt — in der Ruhehaltung 1,53 cm, bei 30 Grad
// gestrecktem Fuss 1,85 cm, bei einer Bodentoleranz von 1,8 cm. Sobald die
// Sohle sauber aufliegt und der Fuss abrollt, meldet die Pruefung einen Fehler,
// den die Bewegung nicht hat und den kein Agent auf null bringen kann.
//
// Gemessen am Agentenlauf vom 1. September 2026: der Agent kaempfte ueber rund
// 40 Aufrufe von 12,6 cm auf 3,5 cm herunter, kam nie auf null und baute dabei
// den Anlauf zum Storchengang um (knee.bend von 40 auf 56 Grad).
//
// Positivfall: ein Schritt mit Abrollen meldet keinen Toe_End mehr.
// Negativfall: ohne das Feld MUSS Toe_End auftauchen — sonst prueft der Test
// nichts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefePhysik } from './physics.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

/** Ein Schritt, bei dem der Fuss von der Ferse in den Abdruck abrollt. */
const TIMELINE = {
  fps: 30, frameCount: 30, phases: [],
  overrides: {
    0:  { joints: { ankle_l: { point: -10 }, knee_l: { bend: 5 } },  root: { pos: [0, 1.03, 0] },    ease: 'smooth' },
    10: { joints: { ankle_l: { point: 0 },   knee_l: { bend: 10 } }, root: { pos: [0, 1.02, 0.15] }, ease: 'smooth' },
    20: { joints: { ankle_l: { point: 25 },  knee_l: { bend: 8 } },  root: { pos: [0, 1.04, 0.32] }, ease: 'smooth' },
    29: { joints: { ankle_l: { point: 30 },  knee_l: { bend: 5 } },  root: { pos: [0, 1.05, 0.48] }, ease: 'smooth' },
  },
};

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
  const { frames } = loeseBewegung(profil, skel, TIMELINE);
  return { profil, frames };
}

function bodenTeile(profil, frames) {
  const r = pruefePhysik(profil, frames, 30);
  return (r.issues ?? [])
    .filter((i) => (i.kind ?? i.art) === 'boden')
    .map((i) => i.teil ?? i.part ?? i.bone ?? '?');
}

/** Nur die gemeldeten KNOCHEN. Die Bodenprüfung meldet seit der Umstellung auf
 *  Sohlenpunkte zwei Sorten von Teilen: Knochen mit Haut und Sohlen-ids
 *  (sole_l_front_in und die sieben anderen). Um die Frage dieses Tests —
 *  „meldet die Prüfung Knochen, an denen nichts hängt?" — geht es nur bei den
 *  Knochen; eine Sohle ist kein Knochen und hat keine Skin-Gewichte. */
function bodenKnochen(profil, frames) {
  const sohlenIds = new Set((profil.soles ?? []).map((s) => s.id));
  return bodenTeile(profil, frames).filter((t) => !sohlenIds.has(t));
}

test('Vermessung: skinnedBones nennt nur Knochen mit Haut', async () => {
  const { profil } = await aufbau();
  assert.ok(Array.isArray(profil.skinnedBones) && profil.skinnedBones.length > 0,
    'skinnedBones fehlt im Profil — ohne das Feld prüft die Bodenprüfung wieder alles');
  assert.ok(profil.skinnedBones.includes('mixamorigLeftFoot'),
    'der Fußknochen trägt 1549 Vertices und muss dabei sein');
  assert.ok(!profil.skinnedBones.includes('mixamorigLeftToe_End'),
    'Toe_End trägt 0 Vertices und darf nicht dabei sein');
});

test('Bodenprüfung: ein Schritt mit Abrollen meldet keinen Knochen ohne Haut', async () => {
  const { profil, frames } = await aufbau();
  const gemeldet = bodenKnochen(profil, frames);
  const haut = new Set(profil.skinnedBones);
  const phantom = [...new Set(gemeldet.filter((t) => !haut.has(t)))];
  assert.deepStrictEqual(phantom, [],
    `${phantom.length} Knochen ohne Haut werden als „im Boden“ gemeldet: ${phantom.join(', ')} — `
    + 'dort hängt kein einziges Dreieck, der Agent kann das nicht beheben');
});

test('Bodenprüfung, Negativfall: ohne das Feld taucht Toe_End auf', async () => {
  const { profil, frames } = await aufbau();
  const ohne = { ...profil };
  delete ohne.skinnedBones;
  const gemeldet = bodenKnochen(ohne, frames);
  assert.ok(gemeldet.includes('mixamorigLeftToe_End'),
    'ohne skinnedBones müsste Toe_End gemeldet werden — sonst misst der Positivfall nichts');
});
