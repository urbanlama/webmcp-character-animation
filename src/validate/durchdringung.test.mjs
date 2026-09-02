// Eine Hand im Rumpf muss gemeldet werden — ein hängender Arm nicht.
//
// Zwei Fehler standen dem im Weg, beide am Xbot gemessen:
//
//   1. measureRestDistances trug nur Paare ein, deren Oberflächen sich in der
//      Bind-Pose näher als 5 % der Körperhöhe kamen: 22 von 82 Paaren, ohne
//      die Paare der Hand mit dem Rumpf und ohne die des Unterarms. Eine Hand im Rumpf konnte gar
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
import * as THREE from 'three';

import { loadGLB } from '../scene/load.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefePhysik } from './physics.js';
import { xbotProfil } from '../rig/xbot-profil.mjs';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';
const FPS = 30;

// Kanalnamen aus profile.joints, nicht geraten: arm_l hat lift/swing/twist,
// elbow_l hat bend/twist (describe_rig nennt sie dem Agenten genauso).
const ARM_HAENGEND  = { arm_l: { lift: -85, twist: 75 } };

async function aufbau() {
  // Profil des UNVERAENDERTEN Xbot aus dem geteilten Cache
  // (src/rig/xbot-profil.mjs): einmal gemessen, prozessuebergreifend
  // geteilt, jeder Aufrufer bekommt eine eigene Kopie. Veraenderte Modelle
  // (Overrides, fremde Posen) messen weiter selbst. Die Kopie haelt die
  // Isolation zwischen den Tests.
  const profil = await xbotProfil();
  const gltf = await ladeModell();
  const bind = erfasseBind(gltf.scene);
  return {
    profil,
    skel: baueSkeleton(profil, bind),
    standHoehe: bind.find((b) => b.id === profil.roles.pelvis.bone).pos[1],
  };
}


async function ladeModell() {
  const puff = readFileSync(XBOT);
  return loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
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

/** Absichtlich ungültiger Fremdframe: die linke Hand liegt ganz im oberen Rumpf.
 * Der Löser erzeugt ihn nach der gemessenen Gelenkgrenze nicht mehr selbst;
 * die Physikprüfung muss fremde oder alte Clips trotzdem erkennen. */
function handImRumpf(profil, frames) {
  const rumpf = profil.segments.find((s) => s.id === 'torso_upper');
  const hand = profil.segments.find((s) => s.id === 'hand_l');
  assert.ok(rumpf && hand, 'oberer Rumpf und linke Hand müssen vermessen sein');
  for (const f of frames) {
    f.positions[hand.from] = [...f.positions[rumpf.from]];
    f.positions[hand.to] = [...f.positions[rumpf.to]];
  }
  return frames;
}

/** 91 gleichmäßig verteilte, tatsächlich gesampelte Posen eines GLB-Clips. */
function clipFrames(gltf, clip) {
  const bones = new Map();
  gltf.scene.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const frames = [];
  for (let i = 0; i <= 90; i += 1) {
    mixer.setTime(clip.duration * i / 90);
    gltf.scene.updateMatrixWorld(true);
    const positions = {};
    for (const [id, bone] of bones) {
      const p = bone.getWorldPosition(new THREE.Vector3());
      positions[id] = [p.x, p.y, p.z];
    }
    frames.push({ positions });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  return frames;
}

test('Vermessung: alle Segmentpaare stehen im Profil, mit Vorzeichen', async () => {
  const { profil } = await aufbau();
  const paare = Object.keys(profil.restDistances);

  assert.equal(paare.length, 105,
    `erwartet 105 Paare aus 15 Segmenten am Xbot, gezählt ${paare.length}`);
  for (const paar of ['torso_lower|hand_l', 'torso_upper|hand_l', 'torso_upper|forearm_l']) {
    assert.ok(paar in profil.restDistances,
      `${paar} fehlt — genau dieses Paar fehlte, als nur die 22 in der T-Pose nahen Paare eingetragen wurden`);
  }
  // Rumpf und Oberschenkel überschneiden sich schon in der Bind-Pose, weil die
  // Radien das 90. Perzentil der Hüllpunkte sind. Der negative Eintrag ist die
  // Untergrenze, unterhalb derer nichts gemeldet werden darf.
  assert.ok(profil.restDistances['torso_lower|thigh_r'] < 0,
    `torso_lower|thigh_r = ${profil.restDistances['torso_lower|thigh_r']} m, erwartet negativ `
    + '(die Kapseln stecken in der Bind-Pose ineinander)');
});

test('Vermessung: Gelenkpaare und beide Rumpfsegmente stehen im Profil', async () => {
  const { profil } = await aufbau();
  const paare = profil.restDistances;
  for (const paar of [
    'thigh_l|shin_l', 'thigh_r|shin_r',
    'upperarm_l|forearm_l', 'forearm_l|hand_l',
    'upperarm_r|forearm_r', 'forearm_r|hand_r',
    'shin_l|foot_l', 'shin_r|foot_r',
    'torso_lower|torso_upper', 'torso_upper|head',
  ]) {
    assert.ok(paar in paare,
      `${paar} fehlt — genau diese Gelenkregion bliebe strukturell ungeprüft`);
  }
  assert.equal(profil.segments.filter((s) => s.id.startsWith('torso_')).length, 2,
    'Rumpf muss aus zwei gemessenen Kapseln bestehen, nicht aus Hüfte bis Hals');
});

test('Durchdringung: Hand quer in den Rumpf gedreht wird mit Betrag gemeldet', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = handImRumpf(profil, halte(profil, skel, ARM_HAENGEND, standHoehe));
  const dd = durchdringungen(profil, frames);

  assert.ok(dd.length >= 1,
    `die Hand steckt im Rumpf, gemeldet wurden ${dd.length} Durchdringungen`);
  const teile = [...new Set(dd.map((i) => i.part))];
  assert.ok(teile.includes('torso_upper|hand_l'),
    `erwartet eine Meldung für torso_upper|hand_l, gemeldet wurden: ${teile.join(', ')}`);
  const hand = dd.find((i) => i.part === 'torso_upper|hand_l');
  assert.ok(hand.value > 0.10,
    `die Kapseln stecken tief ineinander, gemeldet ${(hand.value * 100).toFixed(1)} cm`);
  assert.equal(hand.unit, 'm');
  assert.match(hand.message, /\d/);
});

test('Durchdringung, Negativfall: ohne die neuen Paare bleibt dieselbe Pose stumm', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = handImRumpf(profil, halte(profil, skel, ARM_HAENGEND, standHoehe));

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

test('Kalibrierung: die vier Entwicklungsclips bleiben ohne Durchdringungsmeldung', async () => {
  const buffer = readFileSync(XBOT);
  const gltf = await loadGLB(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const profil = await xbotProfil();
  for (const name of ['idle', 'walk', 'agree', 'sad_pose']) {
    const clip = gltf.animations.find((x) => x.name === name);
    assert.ok(clip, `Entwicklungsclip ${name} fehlt im Xbot`);
    const dd = durchdringungen(profil, clipFrames(gltf, clip));
    assert.deepEqual(dd, [],
      `${name}: ${dd.length} Durchdringungsmeldungen bei 91 Stichproben: ${JSON.stringify(dd)}`);
  }
});
