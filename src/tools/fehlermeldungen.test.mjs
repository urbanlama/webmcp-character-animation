// Abnahmetest AP7 — "Fehlermeldungen", docs/umsetzung.md.
//
// Positivfall: jede nennt Wert, erlaubten Bereich und naechsten Schritt.
// Negativfall: eine Stichprobe von zehn Fehlerfaellen enthaelt keine Meldung
// ohne Zahl.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer } from './index.js';
import { WerkzeugFehler } from './errors.js';

/**
 * Die Pruefung selbst: was eine brauchbare Fehlermeldung ausmacht.
 * Wird unten auch gegen eine absichtlich schlechte Meldung gehalten — sonst
 * waere nicht belegt, dass sie ueberhaupt etwas faengt.
 */
export function pruefeMeldung(antwort) {
  const maengel = [];
  if (!antwort.isError) maengel.push('nicht als Fehler markiert');

  const t = antwort.content && antwort.content[0] && antwort.content[0].text;
  if (typeof t !== 'string' || t.length === 0) {
    maengel.push('kein Text');
    return maengel;
  }
  if (!/\d/.test(t)) maengel.push('keine Zahl in der Meldung');

  const d = antwort.details || {};
  if (!d.param) maengel.push('kein benannter Parameter');
  if (!d.range) maengel.push('kein erlaubter Bereich');
  else if (!/\d/.test(d.range)) maengel.push('Bereich ohne Zahl');
  if (!d.next || d.next.length < 10) maengel.push('kein nächster Schritt');
  if (t.length < 30) maengel.push(`Meldung zu knapp (${t.length} Zeichen)`);
  return maengel;
}

/** Zehn Fehlerfaelle quer durch den Katalog. */
async function stichprobe() {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 90 });
  await schicht.rufe('add_phase', { verb: 'crouch', from: 0, to: 12, params: { depth: 0.35 } });

  return [
    ['Frame außerhalb der Timeline',
      await schicht.rufe('set_joint', { frame: 640, joint: 'head', angleDeg: 12, channel: 'bend' })],
    ['Länge unter dem Minimum',
      await schicht.rufe('set_duration', { frameCount: 3 })],
    ['unbekanntes Verb',
      await schicht.rufe('add_phase', { verb: 'backflip', from: 0, to: 10, params: {} })],
    ['Phase endet vor ihrem Anfang',
      await schicht.rufe('add_phase', { verb: 'stand', from: 30, to: 20, params: {} })],
    ['unbekannte Phasen-Id',
      await schicht.rufe('edit_phase', { id: 'p99', to: 20 })],
    ['unbekannter Kanal',
      await schicht.rufe('set_joint', { frame: 10, joint: 'head', angleDeg: 5, channel: 'wobble' })],
    ['Zielpunkt mit zwei statt drei Werten',
      await schicht.rufe('set_target', { frame: 10, part: 'com', pos: [0, 1] })],
    ['Winkel außerhalb des Prüfbereichs',
      await schicht.rufe('probe_joint', { joint: 'hip_l', angleDeg: 200 })],
    ['unbekannte Ansicht',
      await schicht.rufe('look', { frames: [0, 10], views: ['isometrisch'] })],
    ['zu wenige Antwortmöglichkeiten',
      await schicht.rufe('ask_human', { question: 'Weiter?', options: ['ja'] })],
    ['unbekanntes Werkzeug',
      await schicht.rufe('mach_mal_schoen', {})],
    ['Absichtskriterium unbekannter Art',
      await schicht.rufe('set_intent', { checks: [{ kind: 'stimmung' }] })]
  ];
}

test('Fehlermeldungen: jede nennt Wert, erlaubten Bereich und nächsten Schritt', async () => {
  const faelle = await stichprobe();
  assert.ok(faelle.length >= 10, `${faelle.length} Fehlerfälle in der Stichprobe, verlangt sind 10`);

  for (const [name, antwort] of faelle) {
    const maengel = pruefeMeldung(antwort);
    assert.deepEqual(maengel, [],
      `${name}: ${maengel.join(', ')}\n  Meldung: ${antwort.content[0].text}`);
  }
});

test('Fehlermeldungen, Negativfall: keine Meldung ohne Zahl in zehn Fehlerfällen', async () => {
  const faelle = await stichprobe();
  const ohneZahl = faelle.filter(([, a]) => !/\d/.test(a.content[0].text));
  assert.deepEqual(ohneZahl.map(([n]) => n), [],
    `${ohneZahl.length} von ${faelle.length} Meldungen enthalten keine Zahl`);
});

test('Fehlermeldungen: der Prüfer fällt auf eine absichtlich schlechte Meldung herein? Nein', () => {
  // Genau der Satz, den AGENTS.md verbietet.
  const schlecht = {
    content: [{ type: 'text', text: 'ungültige Eingabe' }],
    isError: true,
    details: { param: 'frame', range: 'gültiger Bereich', next: 'nochmal' }
  };
  const maengel = pruefeMeldung(schlecht);
  assert.ok(maengel.includes('keine Zahl in der Meldung'), 'die fehlende Zahl fällt auf');
  assert.ok(maengel.includes('Bereich ohne Zahl'), 'der Bereich ohne Zahl fällt auf');
  assert.ok(maengel.length >= 3, `${maengel.length} Mängel gefunden, erwartet mindestens 3`);
});

test('Fehlermeldungen: der Frame-Fehler nennt Wert und Timeline-Grenzen wörtlich', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 600 });
  const a = await schicht.rufe('set_joint',
    { frame: 640, joint: 'head', angleDeg: 12, channel: 'bend' });

  assert.match(a.content[0].text, /640/, 'nennt den gelieferten Wert');
  assert.match(a.content[0].text, /0 bis 599/, 'nennt den erlaubten Bereich');
  assert.match(a.content[0].text, /set_duration/, 'nennt den nächsten Schritt');
});

test('Fehlermeldungen: ein Fehler kommt als Werkzeugantwort zurück, nicht als Absturz', async () => {
  const schicht = await createToolLayer({});
  const a = await schicht.rufe('set_duration', { frameCount: 3 });
  assert.equal(a.isError, true);
  assert.equal(a.content[0].type, 'text');
  assert.ok(a.details instanceof Object);
});

test('Fehlermeldungen: alle Prüfhelfer melden mit Zahl im Bereich', () => {
  const e = new WerkzeugFehler({
    tool: 'test', param: 'frameCount', value: 3, range: 'ganze Zahl von 12 bis 600',
    next: 'setze eine größere Länge'
  });
  assert.match(e.message, /3/);
  assert.match(e.message, /12 bis 600/);
  assert.equal(e.toResult().isError, true);
});
