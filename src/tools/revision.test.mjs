// Der Zaehler, an dem die Anzeige haengt.
//
// Vorgeschichte: index.html hielt eine Namensliste der Werkzeuge, nach denen
// neu geloest wird. hold_foot, move_pose und delete_pose fehlten darin. Wer
// eines davon rief, sah im Browser weiter den Stand von davor — lautlos. Der
// Mensch beurteilte eine Bewegung, die es nicht mehr gab.
//
// Geprueft wird deshalb nicht eine Liste von Namen, sondern die Invariante,
// die eine Liste ueberfluessig macht:
//
//     Fingerabdruck geaendert  <=>  Revision gestiegen
//
// Positivfall: jeder annehmende Aufruf zaehlt hoch, auch undo.
// Negativfall: Lesen zaehlt nicht hoch, und ein gescheiterter Aufruf auch nicht.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, fingerabdruck } from './index.js';

/** Aufrufe, die den Zustand anfassen — je [name, args]. */
const AENDERNDE_AUFRUFE = [
  ['set_duration', { frameCount: 90 }],
  ['add_phase', { verb: 'crouch', from: 0, to: 12, params: { depth: 0.35 } }],
  ['edit_phase', { id: 'p1', to: 14 }],
  ['set_joint', { frame: 24, joint: 'head', angleDeg: 12, channel: 'bend' }],
  ['set_target', { frame: 10, part: 'com', pos: [0, 1, 0] }],
  ['confirm_role', { role: 'foot_l', bone: 'mixamorigLeftFoot' }],
  ['undo', {}],
];

test('Revision: jede angenommene Änderung zählt hoch', async () => {
  const schicht = await createToolLayer({});
  assert.equal(schicht.store.revision(), 0, 'vor der ersten Änderung steht der Zähler auf 0');

  let angenommen = 0;
  for (const [name, args] of AENDERNDE_AUFRUFE) {
    const vorherAbdruck = fingerabdruck(schicht.store.lies());
    const vorherRev = schicht.store.revision();

    const antwort = await schicht.rufe(name, args);
    if (antwort.isError) continue;   // braucht ein Modell o. Ä. — hier nicht der Prüfgegenstand

    const nachherAbdruck = fingerabdruck(schicht.store.lies());
    const nachherRev = schicht.store.revision();

    if (nachherAbdruck !== vorherAbdruck) {
      angenommen += 1;
      assert.ok(nachherRev > vorherRev,
        `${name} hat den Zustand geändert, aber die Revision steht auf ${nachherRev} `
        + `statt über ${vorherRev} — die Anzeige würde den alten Stand weiterzeigen`);
    }
  }

  assert.ok(angenommen >= 5,
    `${angenommen} von ${AENDERNDE_AUFRUFE.length} Aufrufen haben geändert — `
    + 'zu wenige, der Test prüft sonst nichts');
});

test('Revision, Negativfall: Lesen zählt nicht hoch', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });
  const rev = schicht.store.revision();

  schicht.store.lies();
  schicht.store.roh();
  schicht.store.fingerabdruck();
  schicht.store.tiefe();
  await schicht.rufe('list_poses', {});

  assert.equal(schicht.store.revision(), rev,
    `Lesen hat die Revision von ${rev} auf ${schicht.store.revision()} gehoben — `
    + 'die Anzeige würde bei jedem Blick grundlos neu lösen');
});

test('Revision, Negativfall: ein gescheiterter Aufruf zählt nicht hoch', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });
  const rev = schicht.store.revision();

  const antwort = await schicht.rufe('set_joint',
    { frame: 999, joint: 'head', angleDeg: 12, channel: 'bend' });
  assert.ok(antwort.isError, 'Frame 999 liegt außerhalb von 0 bis 59 und muss abgelehnt werden');

  assert.equal(schicht.store.revision(), rev,
    `ein abgelehnter Aufruf hat die Revision von ${rev} auf ${schicht.store.revision()} gehoben`);
});
