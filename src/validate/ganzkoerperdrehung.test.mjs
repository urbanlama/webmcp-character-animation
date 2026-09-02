// Abnahmetest — „Der Salto-Check sieht den Salto".
//
// Fund aus dem Agentenlauf vom 2. September 2026 (Lauf 7, Reibungsbericht
// 1.6): Der Agent formulierte seine Absicht als
//
//   { kind: 'rotation', part: 'mixamorigHips', axis: 'x', maxDeg: -300 }
//
// und bekam 0,0 Grad gemeldet — bei einer Bewegung, die im Bild nachweislich
// einen ganzen Salto dreht. `messeDrehung` misst die Position eines Parts
// RELATIV ZUM BECKEN; nennt man das Becken selbst, ist der Punkt mit dem
// Bezugspunkt identisch, jeder Frame fällt durch die Radiusprüfung, und die
// Summe bleibt null. Ohne Warnung.
//
// Der einzige Weg, einen Salto zu bauen, ist die Ganzkörperdrehung
// (root.drehGrad.x) — und der war zugleich der einzige Weg, den Salto-Check zu
// verfehlen. Seitdem misst die Prüfung beim Bezugsknochen die
// Wurzelausrichtung.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { xbotProfil } from '../rig/xbot-profil.mjs';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefeAbsicht } from './intent.js';

/** Ein Rückwärtssalto über die Ganzkörperdrehung, wie der Agent ihn baut. */
const SALTO = {
  schemaVersion: 1, fps: 30, frameCount: 60, rotationFormat: 'quaternion',
  phases: [], anchors: [],
  overrides: {
    10: { joints: { knee_l: { bend: 30 }, knee_r: { bend: 30 } },
          root: { pos: [0, 1.04, 0], drehGrad: { x: 0 } }, ease: 'smooth' },
    30: { joints: { knee_l: { bend: 110 }, knee_r: { bend: 110 } },
          root: { pos: [0, 2.10, 0.8], drehGrad: { x: -180 } }, ease: 'smooth' },
    50: { joints: { knee_l: { bend: 30 }, knee_r: { bend: 30 } },
          root: { pos: [0, 1.04, 1.6], drehGrad: { x: -360 } }, ease: 'smooth' },
  },
};

async function geloest() {
  const profil = await xbotProfil();
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
  const { frames } = loeseBewegung(profil, skel, SALTO, {});
  return { profil, timeline: { ...SALTO, solved: { frames } } };
}

test('Ganzkörperdrehung: rotation auf dem Becken misst den Salto, statt still 0 zu melden', async () => {
  const { profil, timeline } = await geloest();
  const becken = profil.roles.pelvis.bone;

  const erg = pruefeAbsicht(profil, timeline,
    [{ kind: 'rotation', part: becken, axis: 'x', from: 10, to: 50, minDeg: 300 }]);

  const check = erg.checks[0];
  assert.ok(Math.abs(check.measured) > 300,
    `der Salto dreht 360 Grad, gemessen wurden ${check.measured} Grad`);
  assert.equal(check.passed, true,
    `ein 360-Grad-Salto muss ein Kriterium von mindestens 300 Grad erfüllen: `
    + JSON.stringify(check));
});

test('Ganzkörperdrehung: ein mitdrehendes Part liefert dasselbe Ergebnis wie das Becken', async () => {
  const { profil, timeline } = await geloest();
  const becken = profil.roles.pelvis.bone;
  const fuss = profil.roles.foot_l?.bone;
  assert.ok(fuss, 'das Xbot-Profil muss eine Fußrolle haben');

  const [ausBecken, ausFuss] = [becken, fuss].map((part) =>
    pruefeAbsicht(profil, timeline,
      [{ kind: 'rotation', part, axis: 'x', from: 10, to: 50, minDeg: 300 }]).checks[0].measured);

  // Beide messen dieselbe Ganzkörperdrehung über verschiedene Wege: das Becken
  // über die Wurzelausrichtung, der Fuß über seine Bahn um das Becken. Der Fuß
  // trägt zusätzlich das Beugen des Knies, deshalb kein exakter Gleichstand —
  // aber dieselbe Drehrichtung und beide über einer vollen Umdrehung.
  assert.equal(Math.sign(ausBecken), Math.sign(ausFuss),
    `beide Wege müssen dieselbe Drehrichtung liefern: Becken ${ausBecken}, Fuß ${ausFuss}`);
  assert.ok(Math.abs(ausBecken) > 300 && Math.abs(ausFuss) > 300,
    `beide Wege müssen den ganzen Salto sehen: Becken ${ausBecken} Grad, Fuß ${ausFuss} Grad`);
});

test('Ganzkörperdrehung, Negativfall: eine Achse ohne Drehung meldet eine gemessene kleine Zahl', async () => {
  const { profil, timeline } = await geloest();
  const becken = profil.roles.pelvis.bone;

  // Um die Hochachse dreht dieser Salto nicht. Die Antwort muss trotzdem aus
  // einer Messung stammen und nicht aus übersprungenen Frames: seit die
  // Wurzelausrichtung gelesen wird, liegt für jeden Frame ein Referenzvektor
  // vor, und „keine Drehung" ist eine echte Aussage statt einer stillen Null.
  const erg = pruefeAbsicht(profil, timeline,
    [{ kind: 'rotation', part: becken, axis: 'y', from: 10, to: 50, maxDeg: 30 }]);
  const check = erg.checks[0];
  assert.ok(Number.isFinite(check.measured),
    `die Messung muss eine Zahl liefern: ${JSON.stringify(check)}`);
  assert.ok(Math.abs(check.measured) < 30,
    `um die Hochachse dreht dieser Salto nicht, gemessen ${check.measured} Grad`);
  assert.equal(check.passed, true, JSON.stringify(check));
});

test('Ganzkörperdrehung, Negativfall: ein Part auf der Drehachse wird abgelehnt statt mit 0 beantwortet', async () => {
  const { profil, timeline } = await geloest();

  // Ein Part, das nicht das Becken ist und dennoch auf der Achse liegt, gibt
  // es am Xbot nicht als Rolle — geprüft wird deshalb über einen Knochennamen,
  // den die gelöste Timeline nicht kennt: auch dieser Fall darf keine 0
  // liefern, sondern muss mit Zahl und Grund abgelehnt werden.
  assert.throws(
    () => pruefeAbsicht(profil, timeline,
      [{ kind: 'rotation', part: 'gibtEsNicht', axis: 'x', from: 10, to: 50, minDeg: 300 }]),
    /gibtEsNicht/,
    'ein unbekanntes Part muss abgelehnt werden, nicht mit 0 Grad beantwortet',
  );
});
