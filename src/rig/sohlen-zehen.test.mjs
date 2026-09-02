// Abnahmetest — „Gebeugte Zehen bleiben über dem Boden".
//
// Lauf 10 vom 2. September 2026: toes_l.bend 35 hielt bis zum Ende, und die
// Zehenspitze stand 6 cm im Boden, während die Bodenstellung 0 cm meldete.
// Die vier Sohlenpunkte hängen starr am Fußknochen und gehen beim Beugen der
// Zehen nicht mit; die Zehenspitze (Toe_End) ist hautlos und wurde von der
// Bodenstellung übergangen. Jetzt zählt die ganze Fußkette bis zur Spitze.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung, bodenabstand } from '../solver/loeser.js';
import { poseKnochen } from '../solver/kinematik.js';
import { ladeXbot, xbotProfil } from './xbot-profil.mjs';

const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));
const G = PROFIL.world.groundY ?? 0;

function stand(joints) {
  const timeline = {
    schemaVersion: 1, fps: 30, frameCount: 12, rotationFormat: 'quaternion',
    phases: [], anchors: [],
    overrides: { '0': { joints, ease: 'hold', haltung: true }, '11': { joints, ease: 'hold', haltung: true } },
  };
  return loeseBewegung(PROFIL, SKEL, timeline, {}).frames[0];
}

test('Zehen 35° gebeugt: die Figur wird angehoben, die Zehenspitze bleibt über dem Boden', () => {
  const f = stand({ toes_l: { bend: 35 }, toes_r: { bend: 35 } });
  const zeheL = f.positions['mixamorigLeftToe_End'][1] - G;
  const zeheR = f.positions['mixamorigRightToe_End'][1] - G;
  // Der Knochenpunkt Toe_End sitzt auch in der Ruhepose 1,3 cm unter der
  // Haut; sichtbar ist die Sohlenspitze, und die liegt jetzt auf dem Boden.
  assert.ok(zeheL > -0.025, `linke Zehenspitze ${(zeheL * 100).toFixed(1)} cm — vorher −6 cm`);
  assert.ok(zeheR > -0.025, `rechte Zehenspitze ${(zeheR * 100).toFixed(1)} cm — vorher −6 cm`);
  assert.match(String(f.hoehe?.teil ?? ''), /front.*\/zehe/,
    `tiefster Teil ist ${f.hoehe?.teil} — bei gebeugten Zehen muss es die Sohlenspitze am Zehenknochen sein`);
});

test('Negativfall: ungebeugte Zehen — Stand wie bisher, kein Sohlenpunkt im Boden', () => {
  const f = stand({ knee_l: { bend: 5 }, knee_r: { bend: 5 } });
  const hs = Object.entries(f.solePositions).map(([id, p]) => [id, p[1] - G]);
  const tiefste = Math.min(...hs.map(([, h]) => h));
  // Am Xbot liegt der Zehenknochen (ToeBase) knapp unter den Sohlenvertices;
  // der Löser stellt ihn auf den Boden, die Sohle schwebt rund 1 cm —
  // innerhalb der Bodentoleranz von 1,8 cm. Das war vor dem Umbau so.
  assert.ok(tiefste > -0.005 && tiefste < 0.02, `tiefster Sohlenpunkt ${(tiefste * 100).toFixed(2)} cm`);
  for (const [id, h] of hs) assert.ok(h < 0.06, `${id} steht ${(h * 100).toFixed(1)} cm hoch — im Stand liegt die ganze Sohle auf`);
});

test('bodenabstand: bei gebeugten Zehen ist die Sohlenspitze am Zehenknochen der tiefste Teil', () => {
  const f = stand({ toes_l: { bend: 35 } });
  const kn = poseKnochen(SKEL, f.loeserPose);
  const { teil } = bodenabstand(SKEL, kn);
  assert.match(String(teil), /sole_l_front.*\/zehe/, `tiefster Teil: ${teil}`);
});
