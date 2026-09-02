// Abnahmetest — „Was der Kanaltext über die Handfläche sagt, stimmt am Modell".
//
// Befund vom 2. September 2026 (Agentenlauf 9, Bilder mit verdrehten Händen):
// Der Text von `arm.twist` behauptete, am nur mit lift gesenkten Arm zeige
// die Handfläche nach vorn, und gab als Faustregel „links twist +75, rechts
// twist -75". Gemessen am Xbot liegt die Handfläche am hängenden Arm ohne
// twist bereits am Körper — die Faustregel drehte sie 75° weg, links nach
// hinten und rechts nach vorn. Der Text von `elbow.twist` versprach „+ =
// Handfläche nach oben"; gemessen dreht + nach unten.
//
// Beide Kanäle sind twist-Kanäle (signSource 'nicht_messbar'): die Messung am
// Kettenende ist bei einer Drehung um die eigene Achse strukturell 0, deshalb
// hat keine Prüfung die Texte je gegen das Modell gehalten. Dieser Test misst
// die Handfläche direkt über die Fingerknochen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton, vSub, vCross, vLen, vScale } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { ladeXbot, xbotProfil } from './xbot-profil.mjs';

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

const norm = (v) => vScale(v, 1 / vLen(v));

/** Handflächen-Normale in Weltkoordinaten. Index × Kleinfinger steht bei der
 *  linken Hand auf dem Handrücken, bei der rechten auf der Handfläche — in
 *  der T-Pose zeigen beide Handflächen nach unten, daran ist das geeicht. */
function handflaeche(p, seite) {
  const H = p[`mixamorig${seite}Hand`];
  const c = norm(vCross(vSub(p[`mixamorig${seite}HandIndex1`], H), vSub(p[`mixamorig${seite}HandPinky1`], H)));
  return seite === 'Left' ? vScale(c, -1) : c;
}

// Welche Richtung vorn und links ist, sagt das Modell selbst.
const ruhe = haltung({ pelvis: { tilt: 0 } });
const VORN = Math.sign(ruhe['mixamorigLeftToe_End'][2] - ruhe['mixamorigLeftFoot'][2]);
const LINKS = Math.sign(ruhe[PROFIL.joints.shoulder_l.bone][0] - ruhe[PROFIL.joints.shoulder_r.bone][0]);
const zumKoerper = (v, seite) => v[0] * LINKS * (seite === 'Left' ? -1 : 1);
const nachVorn = (v) => v[2] * VORN;
const nachOben = (v) => v[1];

test('Eichung: in der T-Pose zeigen beide Handflächen nach unten', () => {
  const p = haltung({ pelvis: { tilt: 0 } });
  assert.ok(nachOben(handflaeche(p, 'Left')) < -0.9, 'links');
  assert.ok(nachOben(handflaeche(p, 'Right')) < -0.9, 'rechts');
});

test('hängender Arm ohne twist: die Handfläche liegt schon am Körper', () => {
  for (const [seite, joint] of [['Left', 'arm_l'], ['Right', 'arm_r']]) {
    const v = handflaeche(haltung({ [joint]: { lift: -80 } }), seite);
    assert.ok(zumKoerper(v, seite) > 0.9,
      `${joint}: Handfläche zum Körper = ${zumKoerper(v, seite).toFixed(2)}, erwartet nahe 1`);
  }
});

test('arm.twist am hängenden Arm: + dreht die Handfläche nach hinten, - nach vorn, auf beiden Seiten gleich', () => {
  for (const [seite, joint] of [['Left', 'arm_l'], ['Right', 'arm_r']]) {
    const plus = handflaeche(haltung({ [joint]: { lift: -80, twist: 75 } }), seite);
    const minus = handflaeche(haltung({ [joint]: { lift: -80, twist: -75 } }), seite);
    assert.ok(nachVorn(plus) < -0.9, `${joint} twist +75: nach vorn = ${nachVorn(plus).toFixed(2)}, erwartet nahe -1`);
    assert.ok(nachVorn(minus) > 0.9, `${joint} twist -75: nach vorn = ${nachVorn(minus).toFixed(2)}, erwartet nahe 1`);
  }
});

test('elbow.twist am gebeugten Ellbogen: + dreht die Handfläche nach unten, - nach oben', () => {
  for (const [seite, arm, elbow] of [['Left', 'arm_l', 'elbow_l'], ['Right', 'arm_r', 'elbow_r']]) {
    const plus = handflaeche(haltung({ [arm]: { lift: -80 }, [elbow]: { bend: 90, twist: 60 } }), seite);
    const minus = handflaeche(haltung({ [arm]: { lift: -80 }, [elbow]: { bend: 90, twist: -60 } }), seite);
    assert.ok(nachOben(plus) < -0.8, `${elbow} twist +60: nach oben = ${nachOben(plus).toFixed(2)}, erwartet nahe -1`);
    assert.ok(nachOben(minus) > 0.5, `${elbow} twist -60: nach oben = ${nachOben(minus).toFixed(2)}, erwartet > 0.5`);
  }
});

test('Die Kanaltexte sagen, was gemessen ist', () => {
  for (const joint of ['arm_l', 'arm_r']) {
    const text = PROFIL.joints[joint].dof.twist.richtung;
    assert.doesNotMatch(text, /twist \+75|twist -75/, `${joint}: die Faustregel ±75 verdreht die Hände`);
    assert.doesNotMatch(text, /zeigt sie danach nach vorn/, `${joint}: am gesenkten Arm liegt die Handfläche am Körper, nicht vorn`);
    assert.match(text, /\+ dreht die Handflaeche.*HINTEN/, `${joint}: + muss als "nach hinten" beschrieben sein`);
  }
  for (const joint of ['elbow_l', 'elbow_r']) {
    const text = PROFIL.joints[joint].dof.twist.richtung;
    assert.match(text, /\+.*nach UNTEN/, `${joint}: + dreht die Handfläche nach unten`);
    assert.doesNotMatch(text, /\+ dreht den (linken|rechten) Unterarm \(Handfläche nach oben\)/, `${joint}: Text verkehrt`);
  }
});
