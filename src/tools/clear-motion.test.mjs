// Abnahmetest — „Es gibt einen Weg, den Sitzungszustand zu leeren".
//
// Bühnenlauf vom 2. September 2026, Nebenbefund zu Pose 15 und Befund 3.4:
// set_duration löscht weder gesetzte Haltungen noch Fußanker, ein
// Reset-Werkzeug existierte nicht. Wer eine neue Bewegung begann, erbte alle
// Schlüsselbilder der vorigen — auch auf Frames, die er nie anfasste. Das hat
// dreimal zu Fehldiagnosen geführt (u. a. der zurückgezogene arm_l.lift-Befund,
// bei dem ein Altbestand auf Frame 12 mitgemessen wurde).
//
// Seit dem 2. September gibt es clear_motion: leert Haltungen, Phasen,
// Fußanker und Absicht; Modell, Vermessung, Rollenbestätigungen und die
// Timeline-Länge bleiben. Rücknehmbar mit undo wie jede Änderung.
//
// Negativfälle: clear_motion auf leerem Zustand meldet „0 von allem" statt zu
// schweigen, und eine gelöschte Haltung ist danach wirklich weg — set_duration
// stößt vorher an den Altbestand, danach nicht mehr.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, leererZustand } from './index.js';

const text = (antwort) => antwort.content?.map((c) => c.text ?? '').join('\n') ?? '';

/** Leere Schicht mit 24 Frames — ohne Modell, denn clear_motion rührt das
 *  Modell und den Rig nicht an. */
async function schicht() {
  const z = leererZustand();
  z.frameCount = 24;
  return createToolLayer({ zustand: z });
}

test('clear_motion leert Haltungen, Anker, Phasen und Absicht — und zählt, was weg ist', async () => {
  const s = await schicht();
  await s.rufe('set_duration', { frameCount: 24 });
  await s.rufe('set_pose', { frame: 5, joints: { knee_l: { bend: 40 } } });
  await s.rufe('set_pose', { frame: 12, joints: { knee_l: { bend: 80 } } });
  await s.rufe('hold_foot', { foot: 'foot_l', von: 0, bis: 11 });
  await s.rufe('add_phase', {
    verb: 'stand', from: 0, to: 6, params: { verteilung: 0.5 }
  });
  await s.rufe('set_intent', {
    checks: [{ kind: 'airtime', von: 6, bis: 12, minSek: 0.3 }]
  });

  const t = text(await s.rufe('clear_motion', {}));
  assert.match(t, /2 gesetzte Haltungen \(Frames 5, 12\)/, t);
  assert.match(t, /1 Phase \(p1\)/, t);
  assert.match(t, /1 Fußanker \(foot_l 0-11\)/, t);
  assert.match(t, /1 gesetzte Absicht entfernt/, t);
  assert.match(t, /0 Haltungen, 0 Phasen, 0 Anker, keine Absicht/, t);
  assert.match(t, /24 Frames Länge/, 'die Timeline-Länge bleibt stehen');
  assert.match(t, /Rücknehmbar mit undo/, t);

  const z = s.store.roh();
  assert.deepEqual(Object.keys(z.overrides), [], 'kein Override bleibt');
  assert.deepEqual(z.phases, [], 'keine Phase bleibt');
  assert.deepEqual(z.anchors, [], 'kein Anker bleibt');
  assert.equal(z.intent, null, 'keine Absicht bleibt');
  assert.equal(z.frameCount, 24, 'die Länge bleibt');
});

test('Negativfall: clear_motion auf leerem Zustand schweigt nicht, sondern meldet 0 von allem', async () => {
  const s = await schicht();
  const t = text(await s.rufe('clear_motion', {}));
  assert.match(t, /0 gesetzte Haltungen/, t);
  assert.match(t, /0 Phasen/, t);
  assert.match(t, /0 Fußanker/, t);
  assert.match(t, /0 gesetzte Absicht entfernt/, t);
});

test('clear_motion rührt Rollenbestätigungen nicht an', async () => {
  const s = await schicht();
  s.store.aendere((z) => { z.roleConfirmations = { pelvis: 'mixamorigHips' }; });
  text(await s.rufe('set_pose', { frame: 5, joints: { knee_l: { bend: 40 } } }));
  text(await s.rufe('clear_motion', {}));
  assert.deepEqual(s.store.roh().roleConfirmations, { pelvis: 'mixamorigHips' },
    'Rollenbestätigungen sind Aussagen über das Modell, nicht über die Bewegung — '
    + 'und confirm_role liegt in der Kiste, der Agent könnte sie nicht neu setzen');
});

test('clear_motion ist über undo zurücknehmbar', async () => {
  const s = await schicht();
  await s.rufe('set_duration', { frameCount: 24 });
  await s.rufe('set_pose', { frame: 5, joints: { knee_l: { bend: 40 } } });
  text(await s.rufe('clear_motion', {}));
  text(await s.rufe('undo', {}));
  const z = s.store.roh();
  assert.deepEqual(Object.keys(z.overrides), ['5'],
    'nach undo muss die gelöschte Haltung wieder da sein');
});

test('Negativfall: eine gelöschte Haltung ist wirklich weg — set_duration zeigt es', async () => {
  const s = await schicht();
  await s.rufe('set_duration', { frameCount: 24 });
  await s.rufe('set_pose', { frame: 5, joints: { knee_l: { bend: 40 } } });
  await s.rufe('set_pose', { frame: 20, joints: { knee_l: { bend: 80 } } });
  // Ohne clear_motion kollidiert das Verkürzen auf 12 Frames mit dem Override
  // auf Frame 20 — genau die Erbschaft, die früher still stehen blieb.
  const abgewiesen = await s.rufe('set_duration', { frameCount: 12 });
  assert.equal(abgewiesen.isError, true,
    'mit Altbestand muss das Verkürzen abgewiesen werden');
  text(await s.rufe('clear_motion', {}));
  // Jetzt geht es: der Altbestand ist weg, die Länge ist frei.
  const gut = await s.rufe('set_duration', { frameCount: 12 });
  assert.equal(gut.isError, undefined, 'nach clear_motion muss das Verkürzen durchgehen');
  assert.deepEqual(Object.keys(s.store.roh().overrides), [],
    'nach clear_motion darf kein Override mehr existieren');
});

test('clear_motion ist sichtbar registriert und steht im Katalog', async () => {
  const s = await schicht();
  const werkzeuge = s.getTools().map((w) => w.name);
  assert.ok(werkzeuge.includes('clear_motion'),
    `clear_motion muss sichtbar sein, sichtbar sind: ${werkzeuge.join(', ')}`);
});