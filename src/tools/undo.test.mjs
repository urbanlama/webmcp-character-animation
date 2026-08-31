// Abnahmetest AP7 — "Undo", docs/umsetzung.md.
//
// Positivfall: Ruecknahme stellt den vorigen Zustand her.
// Negativfall: nach fuenf Aenderungen und fuenf Ruecknahmen ist der Zustand
// bitgleich zum Ausgangszustand.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, fingerabdruck } from './index.js';

/** Fuenf Aenderungen, die alle vier Zustandsteile anfassen. */
async function fuenfAenderungen(schicht) {
  await schicht.rufe('set_duration', { frameCount: 90 });
  await schicht.rufe('add_phase', { verb: 'crouch', from: 0, to: 12, params: { depth: 0.35 } });
  await schicht.rufe('add_phase', { verb: 'takeoff', from: 12, to: 18, params: { vy: 4.2 } });
  await schicht.rufe('set_joint', { frame: 24, joint: 'head', angleDeg: 12, channel: 'bend' });
  await schicht.rufe('confirm_role', { role: 'foot_l', bone: 'mixamorigLeftFoot' });
}

test('Undo: Rücknahme stellt den vorigen Zustand her', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 90 });

  const vorher = fingerabdruck(schicht.store.lies());
  await schicht.rufe('add_phase', { verb: 'crouch', from: 0, to: 12, params: { depth: 0.35 } });
  assert.notEqual(fingerabdruck(schicht.store.lies()), vorher, 'die Änderung ist angekommen');

  const antwort = await schicht.rufe('undo', {});
  assert.ok(!antwort.isError, antwort.content[0].text);
  assert.equal(fingerabdruck(schicht.store.lies()), vorher, 'voriger Zustand wiederhergestellt');
});

test('Undo: nach fünf Änderungen und fünf Rücknahmen bitgleich zum Ausgangszustand', async () => {
  const schicht = await createToolLayer({});
  const ausgang = fingerabdruck(schicht.store.lies());

  await fuenfAenderungen(schicht);
  assert.equal(schicht.store.tiefe(), 5, '5 rücknehmbare Schritte auf dem Stapel');
  assert.notEqual(fingerabdruck(schicht.store.lies()), ausgang);

  for (let i = 0; i < 5; i += 1) {
    const a = await schicht.rufe('undo', {});
    assert.ok(!a.isError, `Rücknahme ${i + 1}: ${a.content[0].text}`);
  }

  assert.equal(fingerabdruck(schicht.store.lies()), ausgang,
    'bitgleich zum Ausgangszustand');
  assert.equal(schicht.store.tiefe(), 0, '0 Schritte übrig');
});

test('Undo: Zwischenstände werden Schritt für Schritt rückwärts durchlaufen', async () => {
  const schicht = await createToolLayer({});
  const staende = [fingerabdruck(schicht.store.lies())];

  await schicht.rufe('set_duration', { frameCount: 60 });
  staende.push(fingerabdruck(schicht.store.lies()));
  await schicht.rufe('add_phase', { verb: 'stand', from: 0, to: 20, params: {} });
  staende.push(fingerabdruck(schicht.store.lies()));
  await schicht.rufe('set_target', { frame: 10, part: 'com', pos: [0, 1, 0] });
  staende.push(fingerabdruck(schicht.store.lies()));

  for (let i = staende.length - 2; i >= 0; i -= 1) {
    await schicht.rufe('undo', {});
    assert.equal(fingerabdruck(schicht.store.lies()), staende[i], `Rückweg zu Stand ${i}`);
  }
});

test('Undo, Negativfall: ein gescheiterter Aufruf legt nichts auf den Stapel', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 90 });
  const vorher = fingerabdruck(schicht.store.lies());
  const tiefeVorher = schicht.store.tiefe();

  // Frame 640 gibt es nicht — die Timeline hat 90.
  const a = await schicht.rufe('set_joint',
    { frame: 640, joint: 'head', angleDeg: 12, channel: 'bend' });
  assert.ok(a.isError, 'der Aufruf meldet einen Fehler');

  assert.equal(schicht.store.tiefe(), tiefeVorher, 'der Stapel ist nicht gewachsen');
  assert.equal(fingerabdruck(schicht.store.lies()), vorher, 'der Zustand ist unverändert');
});

test('Undo, Negativfall: auf leerem Stapel meldet undo statt still nichts zu tun', async () => {
  const schicht = await createToolLayer({});
  const a = await schicht.rufe('undo', {});
  assert.ok(a.isError);
  assert.match(a.content[0].text, /0 rücknehmbare Schritte/);
});
