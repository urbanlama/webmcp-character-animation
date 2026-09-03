// Abnahmetest — "Der Loeser belegt keinen Feldnamen, den die Anzeige braucht".
//
// Am 1. September 2026 passiert: fuer den Fussanker wurde die Loeser-Pose als
// `frame.pose` an jeden Frame gehaengt. stellePose in src/render/strip.js liest
// aber genau dieses Feld als Knochenverzeichnis:
//
//     const ziel = (frame.pose || frame.bones || {})[bone.name];
//
// Die Loeser-Pose ist {wpos, waxis, pivot, dofs} — kein Knochenverzeichnis.
// Damit war `ziel` fuer JEDEN Knochen undefined, jeder wurde uebersprungen, und
// die Szene blieb in der Bindepose stehen. Der Mensch sah die ganze Zeit eine
// T-Pose, waehrend der Agent 60 Aufrufe lang eine Bewegung baute. 357 Tests
// waren gruen: keiner davon schaut auf die Szene.
//
// Positivfall: `bones` traegt Knochennamen, `pose` bleibt frei.
// Negativfall: ein Frame mit belegtem `pose` MUSS auffallen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { xbotProfil } from '../rig/xbot-profil.mjs';

/**
 * Feldnamen, die stellePose (src/render/strip.js) als Knochenverzeichnis liest.
 * Wer einen davon fuer etwas anderes belegt, macht die Anzeige blind.
 */
const RESERVIERT = ['pose', 'bones'];

/** Sieht das aus wie ein Knochenverzeichnis: Name -> {position, quaternion}? */
function istKnochenverzeichnis(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const werte = Object.values(v);
  if (werte.length === 0) return false;
  return werte.every((e) => e && typeof e === 'object' && Array.isArray(e.position));
}

test('Frame-Felder: kein reserviertes Feld traegt etwas anderes als Knochen', async () => {
  const puff = readFileSync('beispiel/Xbot.glb');
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = await xbotProfil();
  const skel = baueSkeleton(profil, erfasseBind(gltf.scene));

  const { frames } = loeseBewegung(profil, skel, {
    fps: 30, frameCount: 30, phases: [],
    overrides: {
      0: { joints: { arm_l: { lift: 0 } }, root: { pos: [0, 1.04, 0] }, ease: 'smooth' },
      20: { joints: { arm_l: { lift: -80 } }, root: { pos: [0, 1.04, 0.2] }, ease: 'smooth' },
    },
    anchors: [{ foot: 'foot_l', von: 0, bis: 20 }],
  });

  const verletzt = [];
  for (const f of frames) {
    for (const feld of RESERVIERT) {
      if (f[feld] !== undefined && !istKnochenverzeichnis(f[feld])) {
        verletzt.push(`Frame ${f.frame}.${feld} = ${Object.keys(f[feld]).join('/')}`);
      }
    }
  }
  assert.deepEqual(verletzt.slice(0, 3), [],
    `${verletzt.length} Frames belegen ein reserviertes Feld falsch — die Szene bleibt dann `
    + `in der Bindepose stehen: ${verletzt.slice(0, 3).join('; ')}`);
});

test('Frame-Felder, Negativfall: ein falsch belegtes pose faellt auf', () => {
  const kaputt = { frame: 0, pose: { wpos: [0, 1, 0], dofs: { 'arm_l.lift': -80 } } };
  assert.equal(istKnochenverzeichnis(kaputt.pose), false,
    'eine Loeser-Pose darf NICHT als Knochenverzeichnis durchgehen');

  const gut = { frame: 0, bones: { mixamorigLeftArm: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] } } };
  assert.equal(istKnochenverzeichnis(gut.bones), true,
    'ein echtes Knochenverzeichnis muss als solches erkannt werden');
});
