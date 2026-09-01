// Abnahmetest — "Kein Text schickt den Agenten zu einem Werkzeug, das er nicht hat".
//
// Vier Werkzeuge liegen in der Kiste und werden nicht registriert: add_phase,
// edit_phase, set_target, ask_human. Ein Ratschlag, der eines davon nennt,
// kostet den Agenten einen Aufruf und liefert ihm "Tool not found" — Reibung
// ohne Gegenwert.
//
// Gefunden am 1. September 2026 in registry.js: nach einem Absturz riet die
// Meldung "frage den Menschen mit ask_human", nachdem ask_human aus dem
// sichtbaren Katalog genommen worden war.
//
// Positivfall: keine sichtbare Beschreibung und keine Fehlermeldung nennt ein
// Kistenwerkzeug als naechsten Schritt.
// Negativfall: ein absichtlich gesetzter Verweis MUSS auffallen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, KATALOG_SICHTBAR, KISTE } from './index.js';

/** Nennt der Text eines der Kistenwerkzeuge? */
function verweise(text) {
  return KISTE.filter((name) => new RegExp(`\\b${name}\\b`).test(String(text ?? '')));
}

test('Verweise: keine sichtbare Werkzeugbeschreibung nennt ein Kistenwerkzeug', () => {
  const treffer = [];
  for (const t of KATALOG_SICHTBAR) {
    const text = `${t.description} ${JSON.stringify(t.inputSchema ?? {})}`;
    for (const name of verweise(text)) treffer.push(`${t.name} → ${name}`);
  }
  assert.deepEqual(treffer, [],
    `${treffer.length} Beschreibungen schicken den Agenten ins Leere: ${treffer.join(', ')}`);
});

test('Verweise: keine Fehlermeldung schickt den Agenten in die Kiste', async () => {
  const schicht = await createToolLayer({});

  // Eine Auswahl echter Fehlerpfade, jeder mit falschen Argumenten ausgeloest.
  const faelle = [
    ['set_duration', { frameCount: -5 }],
    ['describe_pose', { frame: 99999 }],
    ['set_pose', { frame: 0 }],
    ['set_intent', { checks: [{ kind: 'travel', part: 'com' }] }],
    ['measure', { frames: [0], fragen: [{ art: 'gibt_es_nicht', a: 'com' }] }],
    ['look', { frames: [0], views: ['schraeg'] }],
    ['probe_joint', { joint: 'gibt_es_nicht', angleDeg: 10 }],
    ['move_pose', { von: 0, nach: 0 }],
  ];

  const treffer = [];
  for (const [name, args] of faelle) {
    const antwort = await schicht.rufe(name, args);
    const text = (antwort.content ?? []).map((c) => c.text ?? '').join(' ');
    for (const ziel of verweise(text)) treffer.push(`${name} → ${ziel}`);
  }
  assert.deepEqual(treffer, [],
    `${treffer.length} Fehlermeldungen raten zu einem Kistenwerkzeug: ${treffer.join(', ')}`);
});

test('Verweise, Negativfall: ein gesetzter Verweis wird gefunden', () => {
  assert.deepEqual(verweise('frage den Menschen mit ask_human'), ['ask_human'],
    'der alte Rat aus registry.js muss auffallen');
  assert.deepEqual(verweise('nimm add_phase statt set_pose'), ['add_phase']);
  assert.deepEqual(verweise('rufe getTools() auf und versuche es erneut'), [],
    'ein Rat auf ein sichtbares Werkzeug faellt nicht auf');
});
