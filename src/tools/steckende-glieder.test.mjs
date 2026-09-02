// Abnahmetest — „Der Agent erfährt sofort, wenn ein Körperteil im anderen steckt".
//
// Befund vom 2. September 2026: Der Agent setzt eine Haltung, in der die Hand
// im Rumpf steckt, und bekommt zurück „2 Gelenke, 2 Winkel, Bodenkontakt,
// Schwerpunkt 0,97 m". Die Selbstdurchdringung ist gemessen und kalibriert
// (src/validate/physics.js), läuft aber nur in `validate` — also erst, nachdem
// der Agent ein Dutzend weitere Haltungen daraufgesetzt hat.
//
// Die gemessene Ellbogengrenze klemmt 150° jetzt auf 127°. Diese harte Pose
// bringt die linke Hand trotzdem in den rechten Oberarm (10,3 cm) — genau
// dieses tatsächlich gelöste Paar muss in der set_pose-Antwort stehen.
//
// Positivfall: das gelöste Paar wird mit beiden Teilen und dem Betrag genannt.
// Negativfall: ein hängender Arm ist keine Durchdringung und bleibt still —
// sonst wäre die Meldung Rauschen und der Agent lernt, sie zu übergehen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { steckendeGliedmassen } from './handlers.js';
import { ladeXbot, xbotProfil } from '../rig/xbot-profil.mjs';

// Profil aus dem geteilten Cache (src/rig/xbot-profil.mjs): das unveraenderte
// Xbot-Profil wird einmal gemessen, nicht in jeder Testdatei neu.
const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));

/** Eine Timeline, die auf beiden Frames dieselbe Haltung hält. */
function timeline(joints) {
  return {
    schemaVersion: 1, fps: 30, frameCount: 2, rotationFormat: 'quaternion',
    phases: [], anchors: [],
    overrides: { '0': { joints, ease: 'hold' }, '1': { joints, ease: 'hold' } },
  };
}

const geloest = (joints) => loeseBewegung(PROFIL, SKEL, timeline(joints), {}).frames[0];

test('Durchdringung: die Wirkung nennt beide Teile und den Betrag', () => {
  const frame = geloest({ arm_l: { swing: 90 }, elbow_l: { bend: 150 } });
  const saetze = steckendeGliedmassen(PROFIL, frame);

  assert.equal(saetze.length, 1, `erwartet genau einen Satz, bekommen: ${JSON.stringify(saetze)}`);
  const s = saetze[0];
  assert.match(s, /hand_l/, 'die Hand muss benannt sein');
  assert.match(s, /upperarm_r/, 'der tatsächlich getroffene Gegenarm muss benannt sein');
  assert.match(s, /\d+,\d cm/, 'der Betrag muss in cm dastehen');
  assert.match(s, /validate/, 'der Agent muss wissen, dass validate das später meldet');
});

test('Hängender Arm: keine Durchdringung, kein Satz', () => {
  const frame = geloest({ arm_l: { lift: -75, twist: 75 }, arm_r: { lift: -75, twist: -75 } });
  assert.deepEqual(steckendeGliedmassen(PROFIL, frame), []);
});

test('Ohne Weltpositionen bleibt die Prüfung still, statt zu werfen', () => {
  assert.deepEqual(steckendeGliedmassen(PROFIL, { frame: 0, positions: null }), []);
  assert.deepEqual(steckendeGliedmassen(PROFIL, null), []);
});
