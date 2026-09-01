// Abnahmetest — "Eine Frage an den Menschen ist auf Deutsch und ohne Fachjargon".
//
// Die Rueckfragen sind der einzige Ort, an dem das Programm den Menschen am
// Bildschirm direkt anspricht. Sie lauteten bis zum 1. September 2026:
//
//   Ist „mixamorigLeftFoot" die Rolle foot_l? Vorschlag mit Konfidenz 0.72,
//   sicher ab 0.9.
//
//   Die Blickrichtung ist nicht messbar: 2 von 7 Richtungssignalen ueber der
//   Grenze (staerkstes Signal 0.031 der Koerperhoehe). Welcher Fuss ist links?
//
// Beide setzen voraus, dass der Leser Knochennamen, Rollenbezeichner und
// Konfidenzschwellen kennt. Der Knochen leuchtet waehrenddessen im Bild — die
// Frage muss also nur benennen, was leuchtet.
//
// Positivfall: keine Frage enthaelt Bezeichner, Zahlen oder Englisch.
// Negativfall: die alten Texte MUESSEN an dieser Pruefung scheitern.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROLLEN, ROLLENNAME, menschlich } from './detect.js';
import { ABLEHNUNG } from '../ui/rollen-bestaetigung.js';

/** Was in einer Frage an den Menschen nichts verloren hat. */
const VERBOTEN = [
  { muster: /mixamorig|_[lr]\b|\bbone\b/i, grund: 'Knochen- oder Rollenbezeichner' },
  { muster: /Konfidenz|confidence|Signal|Grenze|Schwelle/i, grund: 'Messgroesse aus der Erkennung' },
  { muster: /\d/, grund: 'Zahl' },
  { muster: /\b(the|role|leave|open|is|confirm|assignment)\b/i, grund: 'Englisch' },
];

function maengel(text) {
  return VERBOTEN.filter((v) => v.muster.test(text)).map((v) => v.grund);
}

test('Fragetexte: jede Rolle hat einen Namen, den ein Mensch versteht', () => {
  const ohne = ROLLEN.filter((r) => !ROLLENNAME[r]);
  assert.deepEqual(ohne, [], `${ohne.length} Rollen ohne menschlichen Namen: ${ohne.join(', ')}`);

  for (const r of ROLLEN) {
    const name = menschlich(r);
    assert.deepEqual(maengel(name), [],
      `Rollenname "${name}" (${r}) enthaelt: ${maengel(name).join(', ')}`);
  }
});

test('Fragetexte: die Antwortmoeglichkeit "offen lassen" ist deutsch', () => {
  assert.deepEqual(maengel(ABLEHNUNG), [],
    `"${ABLEHNUNG}" enthaelt: ${maengel(ABLEHNUNG).join(', ')}`);
});

test('Fragetexte, Negativfall: die alten Texte fallen durch', () => {
  const alt1 = 'Ist „mixamorigLeftFoot“ die Rolle foot_l? Vorschlag mit Konfidenz 0.72, sicher ab 0.9.';
  const alt2 = 'Die Blickrichtung ist nicht messbar: 2 von 7 Richtungssignalen über der Grenze.';
  const alt3 = 'No — leave this role open';

  assert.ok(maengel(alt1).length >= 3, `der alte Rollentext muss mehrfach auffallen, gefunden: ${maengel(alt1).join(', ')}`);
  assert.ok(maengel(alt2).length >= 2, `der alte Seitentext muss auffallen, gefunden: ${maengel(alt2).join(', ')}`);
  assert.ok(maengel(alt3).length >= 1, `die englische Ablehnung muss auffallen, gefunden: ${maengel(alt3).join(', ')}`);
});

test('Fragetexte: menschlich() faellt auf den Bezeichner zurueck, statt leer zu sein', () => {
  assert.equal(menschlich('gibt_es_nicht'), 'gibt_es_nicht',
    'eine unbekannte Rolle behaelt ihren Namen — lieber technisch als leer');
});
