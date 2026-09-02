// Abnahmetest — „Was der Kanaltext 'nach außen' nennt, geht auf beiden Seiten
// nach außen".
//
// Befund vom 2. September 2026: `hip_l.twist` und `hip_r.twist` versprechen
// beide „+ dreht den Oberschenkel nach außen". Gemessen an der Fußausrichtung
// drehten bei +40 Grad BEIDE Füße 12,85 cm in dieselbe Weltrichtung — der
// linke nach außen, der rechte nach innen. Ein Agent, der beide Hüften
// symmetrisch setzt, bekommt ein verdrehtes Bein und sieht es nicht.
//
// Ursache: der twist-Zweig in measure.js sprang mit `sign: 1` heraus, bevor
// die Spiegelung ausgewertet wurde (die Messung am Kettenende ist bei einer
// Drehung um die eigene Achse strukturell 0 — die Spiegelung ist aber
// Katalogwissen und braucht keine Messung).
//
// Positivfall: hip_r.twist ist gegenüber hip_l.twist gespiegelt, und die
// Fußspitzen wandern bei gleichem Wert in entgegengesetzte Richtungen.
// Negativfall: Kanäle mit absoluter Semantik (arm.twist „vorwärts rollend")
// bleiben ungespiegelt — sonst kippt ihr Verhalten still mit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { ladeXbot, xbotProfil } from './xbot-profil.mjs';

// Profil aus dem geteilten Cache (src/rig/xbot-profil.mjs): das unveraenderte
// Xbot-Profil wird einmal gemessen, nicht in jeder Testdatei neu.
const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));

function haltung(joints) {
  const timeline = {
    schemaVersion: 1, fps: 30, frameCount: 12, rotationFormat: 'quaternion',
    phases: [], anchors: [],
    overrides: { '0': { joints, ease: 'hold' }, '11': { joints, ease: 'hold' } },
  };
  return loeseBewegung(PROFIL, SKEL, timeline, {}).frames[0].positions;
}

/** Seitlicher Versatz der Fußspitze gegen die Ferse, in Metern.
 *  Positiv heißt: die Spitze zeigt nach +x. */
const fussVersatz = (p, seite) =>
  p[`mixamorig${seite}Toe_End`][0] - p[`mixamorig${seite}Foot`][0];

// Welche x-Richtung links ist, sagt das Modell selbst — nicht das Handbuch.
const ruhe = haltung({ pelvis: { tilt: 0 } });
const LINKS_IST_PLUS_X =
  ruhe[PROFIL.joints.shoulder_l.bone][0] > ruhe[PROFIL.joints.shoulder_r.bone][0];

test('hip.twist: + dreht beide Oberschenkel nach außen, wie der Text verspricht', () => {
  const links = fussVersatz(haltung({ hip_l: { twist: 40 } }), 'Left');
  const rechts = fussVersatz(haltung({ hip_r: { twist: 40 } }), 'Right');

  const linksNachAussen = LINKS_IST_PLUS_X ? links > 0 : links < 0;
  const rechtsNachAussen = LINKS_IST_PLUS_X ? rechts < 0 : rechts > 0;

  assert.ok(linksNachAussen,
    `hip_l.twist +40 dreht die linke Fußspitze um ${(links * 100).toFixed(2)} cm — das ist nach innen`);
  assert.ok(rechtsNachAussen,
    `hip_r.twist +40 dreht die rechte Fußspitze um ${(rechts * 100).toFixed(2)} cm — das ist nach innen`);
});

test('hip.twist: das Vorzeichen ist zwischen den Seiten gespiegelt', () => {
  assert.equal(PROFIL.joints.hip_l.dof.twist.sign, 1);
  assert.equal(PROFIL.joints.hip_r.dof.twist.sign, -1,
    'die rechte Hüfte muss das umgekehrte Vorzeichen tragen, sonst dreht sie nach innen');
});

test('Negativfall: arm.twist beschreibt eine absolute Richtung und bleibt ungespiegelt', () => {
  assert.equal(PROFIL.joints.arm_l.dof.twist.sign, 1);
  assert.equal(PROFIL.joints.arm_r.dof.twist.sign, 1,
    'arm.twist sagt "vorwärts rollend", nicht "nach außen" — hier wäre eine Spiegelung falsch');
});
