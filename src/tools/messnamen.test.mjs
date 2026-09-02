// Abnahmetest — „Die measure-Fehlermeldung nennt den passenden Messnamen".
//
// Buehnenlauf vom 2. September 2026, Befund 2.1: 10 von 18 Gelenken, die der
// Agent mit set_pose setzt, heissen beim Messen anders (hip_l -> thigh_l,
// knee_l -> shin_l, ankle_l -> foot_l, elbow_l -> forearm_l, toes_l -> toe_l,
// jeweils auch rechts). Die Fehlermeldung listete zwar die 22 verfuegbaren
// Namen auf, nannte aber nicht die Zuordnung — der Agent musste raten und
// machte jedes Mal einen Fehlaufruf.
//
// Die Zuordnung kommt aus dem Gelenkkatalog in src/rig/measure.js (Spalte
// bone = Messrolle), nicht aus einem zweiten, getippten Vokabular. Sie wird
// nur genannt, wenn die Messrolle an diesem Modell wirklich existiert.
//
// Negativfaelle: ein Name, der kein Gelenk ist (z. B. "flasche"), bekommt
// keinen Ersatznamen — die Meldung listet dann nur die verfuegbaren Teile.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, leererZustand } from './index.js';
import { attrappenPorts } from './ports.js';

/** Ports mit Rollen, wie AP2 sie fuer den Xbot liefert — nur die Rollen, die
 *  der Test braucht, mit echten Knochen-Namen im Stil Mixamos. Der Loeser
 *  liefert einen einzigen geloesten Frame mit Positionen; measure kommt bis
 *  brauchePunkt und wirft dort. */
function portsMitRollen() {
  const ports = attrappenPorts();
  ports.rig.rig = () => ({
    quelle: 'testrig',
    roles: {
      pelvis: { bone: 'mixamorigHips', confidence: 1 },
      thigh_l: { bone: 'mixamorigLeftUpLeg', confidence: 1 },
      shin_l: { bone: 'mixamorigLeftLeg', confidence: 1 },
      foot_l: { bone: 'mixamorigLeftFoot', confidence: 1 },
      toe_l: { bone: 'mixamorigLeftToeBase', confidence: 1 },
      forearm_l: { bone: 'mixamorigLeftForeArm', confidence: 1 },
      thigh_r: { bone: 'mixamorigRightUpLeg', confidence: 1 },
      shin_r: { bone: 'mixamorigRightLeg', confidence: 1 },
      foot_r: { bone: 'mixamorigRightFoot', confidence: 1 },
      toe_r: { bone: 'mixamorigRightToeBase', confidence: 1 },
      forearm_r: { bone: 'mixamorigRightForeArm', confidence: 1 },
    },
    joints: {},
  });
  ports.solver = {
    quelle: 'test',
    loese: () => ({
      quelle: 'test',
      frames: [{
        frame: 0, contact: 'kontakt', dofs: {},
        positions: {
          mixamorigHips: [0, 1.0, 0],
          mixamorigLeftUpLeg: [0, 0.9, 0],
          mixamorigLeftLeg: [0, 0.5, 0],
          mixamorigLeftFoot: [0, 0.1, 0],
          mixamorigLeftToeBase: [0, 0.05, 0.1],
          mixamorigLeftForeArm: [0.3, 1.2, 0],
          mixamorigRightUpLeg: [0, 0.9, 0],
          mixamorigRightLeg: [0, 0.5, 0],
          mixamorigRightFoot: [0, 0.1, 0],
          mixamorigRightToeBase: [0, 0.05, 0.1],
          mixamorigRightForeArm: [-0.3, 1.2, 0],
        },
      }],
    }),
  };
  return ports;
}

async function schicht() {
  const z = leererZustand();
  z.frameCount = 12;
  const s = await createToolLayer({ ports: portsMitRollen(), zustand: z });
  await s.rufe('set_duration', { frameCount: 12 });
  return s;
}

const fuenfSetzNamen = [
  ['hip_l', 'thigh_l'], ['knee_l', 'shin_l'], ['ankle_l', 'foot_l'],
  ['elbow_l', 'forearm_l'], ['toes_l', 'toe_l'],
  ['hip_r', 'thigh_r'], ['knee_r', 'shin_r'], ['ankle_r', 'foot_r'],
  ['elbow_r', 'forearm_r'], ['toes_r', 'toe_r'],
];

test('measure nennt für jedes Setz-Gelenk seinen Messnamen — alle 10 Fälle', async () => {
  const s = await schicht();
  for (const [gesetzt, gemessen] of fuenfSetzNamen) {
    const r = await s.rufe('measure', { frame: 0, fragen: [{ art: 'hoehe', a: gesetzt }] });
    assert.equal(r.isError, true, `${gesetzt} muss abgewiesen werden`);
    const t = r.content[0].text;
    assert.match(t, new RegExp(`heißt es "${gemessen}"`),
      `${t}\n— Meldung für "${gesetzt}" muss "${gemessen}" nennen`);
    assert.match(r.details.next, new RegExp(gemessen),
      `der nächste Schritt für "${gesetzt}" nennt "${gemessen}"`);
  }
});

test('Negativfall: ein Name ohne Gelenkzuordnung bekommt keinen Ersatznamen', async () => {
  const s = await schicht();
  const r = await s.rufe('measure', { frame: 0, fragen: [{ art: 'hoehe', a: 'flasche' }] });
  assert.equal(r.isError, true);
  const t = r.content[0].text;
  assert.doesNotMatch(t, /heißt es/,
    '„flasche" ist kein Gelenk — die Meldung darf keinen Ersatznamen erfinden');
  assert.match(t, /stehen zur Verfügung/, 'sie listet stattdessen die verfügbaren Teile');
});

test('Negativfall: der Ersatzname kommt nur, wenn die Messrolle an diesem Modell existiert', async () => {
  // Ein Modell ohne forearm-Rolle: elbow_l bleibt ohne Ersatznamen, denn
  // „messe forearm_l" wäre ein zweiter Fehlaufruf.
  const ports = portsMitRollen();
  ports.rig.rig = () => ({
    quelle: 'testrig-kahl', roles: { thigh_l: { bone: 'mixamorigLeftUpLeg', confidence: 1 } }, joints: {},
  });
  const z = leererZustand();
  z.frameCount = 12;
  const s = await createToolLayer({ ports, zustand: z });
  await s.rufe('set_duration', { frameCount: 12 });

  const r = await s.rufe('measure', { frame: 0, fragen: [{ art: 'hoehe', a: 'hip_l' }] });
  assert.match(r.content[0].text, /heißt es "thigh_l"/, 'die vorhandene Rolle wird genannt');

  const r2 = await s.rufe('measure', { frame: 0, fragen: [{ art: 'hoehe', a: 'elbow_l' }] });
  assert.doesNotMatch(r2.content[0].text, /heißt es/,
    'ohne forearm-Rolle gibt es keinen Ersatznamen');
});