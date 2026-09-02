// Eine Hand im Rumpf muss gemeldet werden — ein hängender Arm nicht.
//
// Zwei Fehler standen dem im Weg, beide am Xbot gemessen:
//
//   1. measureRestDistances trug nur Paare ein, deren Oberflächen sich in der
//      Bind-Pose näher als 5 % der Körperhöhe kamen: 22 von 82 Paaren, ohne
//      torso|hand_l und ohne torso|forearm_l. Eine Hand im Rumpf konnte gar
//      nicht gemeldet werden, weil das Paar in der Prüfung nicht existierte.
//      Die T-Pose ist als Auswahlkriterium ungeeignet: sie hält gerade die
//      Arme so weit wie möglich vom Rumpf weg.
//
//   2. measure.js speicherte den OBERFLÄCHENabstand, physics.js verglich ihn
//      mit dem ACHSabstand der Pose. Die Prüfung war um rA + rB zu
//      großzügig — bei Rumpf (16,9 cm) und Hand (6,0 cm) um 22,9 cm.
//
// Positivfall: Arm quer vor die Brust gedreht, die Hand steckt im Rumpf.
// Negativfälle: der normal hängende Arm darf nichts melden, und ohne die neu
// hinzugekommenen Paare muss dieselbe Pose stumm bleiben — sonst misst der
// Positivfall nicht, was er zu messen behauptet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefePhysik } from './physics.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';
const FPS = 30;

// Kanalnamen aus profile.joints, nicht geraten: arm_l hat lift/swing/twist,
// elbow_l hat bend/twist (describe_rig nennt sie dem Agenten genauso).
const HAND_IM_RUMPF = { arm_l: { lift: -10, swing: 80 }, elbow_l: { bend: 140 } };
const ARM_HAENGEND  = { arm_l: { lift: -85, twist: 75 } };

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  const bind = erfasseBind(gltf.scene);
  return {
    profil,
    skel: baueSkeleton(profil, bind),
    standHoehe: bind.find((b) => b.id === profil.roles.pelvis.bone).pos[1],
  };
}

function halte(profil, skel, joints, standHoehe) {
  const { frames } = loeseBewegung(profil, skel, {
    fps: FPS, frameCount: 6, phases: [],
    overrides: {
      0: { joints, root: { pos: [0, standHoehe, 0] } },
      5: { joints, root: { pos: [0, standHoehe, 0] } },
    },
  });
  return frames;
}

const durchdringungen = (profil, frames) =>
  pruefePhysik(profil, frames, FPS).issues.filter((i) => i.kind === 'durchdringung');

test('Vermessung: alle nicht benachbarten Paare stehen im Profil, mit Vorzeichen', async () => {
  const { profil } = await aufbau();
  const paare = Object.keys(profil.restDistances);

  assert.equal(paare.length, 82,
    `erwartet 82 nicht benachbarte Segmentpaare am Xbot, gezählt ${paare.length}`);
  for (const paar of ['torso|hand_l', 'torso|forearm_l']) {
    assert.ok(paar in profil.restDistances,
      `${paar} fehlt — genau dieses Paar fehlte, als nur die 22 in der T-Pose nahen Paare eingetragen wurden`);
  }
  // Rumpf und Oberschenkel überschneiden sich schon in der Bind-Pose, weil die
  // Radien das 90. Perzentil der Hüllpunkte sind. Der negative Eintrag ist die
  // Untergrenze, unterhalb derer nichts gemeldet werden darf.
  assert.ok(profil.restDistances['torso|thigh_r'] < 0,
    `torso|thigh_r = ${profil.restDistances['torso|thigh_r']} m, erwartet negativ `
    + '(die Kapseln stecken in der Bind-Pose ineinander)');
});

test('Durchdringung: Hand quer in den Rumpf gedreht wird mit Betrag gemeldet', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, HAND_IM_RUMPF, standHoehe);
  const dd = durchdringungen(profil, frames);

  assert.ok(dd.length >= 1,
    `die Hand steckt im Rumpf, gemeldet wurden ${dd.length} Durchdringungen`);
  const teile = [...new Set(dd.map((i) => i.part))];
  assert.ok(teile.includes('torso|hand_l'),
    `erwartet eine Meldung für torso|hand_l, gemeldet wurden: ${teile.join(', ')}`);
  const hand = dd.find((i) => i.part === 'torso|hand_l');
  assert.ok(hand.value > 0.10,
    `die Kapseln stecken tief ineinander, gemeldet ${(hand.value * 100).toFixed(1)} cm`);
  assert.equal(hand.unit, 'm');
  assert.match(hand.message, /\d/);
});

test('Durchdringung, Negativfall: ohne die neuen Paare bleibt dieselbe Pose stumm', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, HAND_IM_RUMPF, standHoehe);

  // Das Profil, wie measureRestDistances es vor der Umstellung lieferte: ohne
  // die Paare des linken Arms mit dem Rumpf.
  const alt = {
    ...profil,
    restDistances: Object.fromEntries(Object.entries(profil.restDistances)
      .filter(([k]) => !k.includes('hand_l') && !k.includes('forearm_l'))),
  };
  const dd = durchdringungen(alt, frames);
  assert.equal(dd.length, 0,
    `ohne die Paare meldet die Prüfung ${dd.length} Durchdringungen — `
    + 'meldet sie hier schon etwas, beweist der Positivfall nicht, dass die Paare gebraucht werden');
});

test('Durchdringung: der normal hängende Arm ist kein Fehler', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, ARM_HAENGEND, standHoehe);
  const dd = durchdringungen(profil, frames);

  assert.equal(dd.length, 0,
    `ein hängender Arm liegt am Körper an, das ist keine Durchdringung — gemeldet wurden ${dd.length}: `
    + [...new Set(dd.map((i) => `${i.part} ${(i.value * 100).toFixed(1)} cm`))].join(', '));
});
