// Abnahmetest — "Das Schema kommt beim Agenten an".
//
// Gemessen in Chrome 152.0.7977.65 ueber die DevTools-Domain WebMCP
// (WebMCP.enable → toolsAdded): das inputSchema faellt aus dem Ereignis
// heraus, wenn sein serialisierter Text ausschliesslich Zeichen bis U+00FF
// enthaelt UND mindestens eines davon ueber U+007F liegt. Also: "Stück" bricht
// es, "Stueck" nicht — und "Pfeil →" (U+2192) auch nicht, weil ein Zeichen
// jenseits von Latin-1 den Text auf den 16-Bit-Pfad hebt.
//
// Belegt mit spikes/schema-probe/: von fuenf Schemaformen kamen drei durch,
// die zwei rein latin-1-haltigen nicht. Betroffen waren look und ask_human —
// zwei von neunzehn sichtbaren Werkzeugen erreichten den Agenten ohne
// Parameterbeschreibung.
//
// Positivfall: kein sichtbares Werkzeug traegt ein Schema in diesem Bereich.
// Negativfall: ein Schema mit "ü" muss die Pruefung rot machen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KATALOG_SICHTBAR } from './catalog.js';

/**
 * True, wenn Chrome dieses Schema auf dem Weg zum Agenten verliert:
 * Latin-1-Sonderzeichen ohne ein Zeichen jenseits von U+00FF.
 */
export function faelltAusDemTransport(schema) {
  const punkte = [...JSON.stringify(schema ?? {})].map((z) => z.codePointAt(0));
  return punkte.some((c) => c > 127) && punkte.every((c) => c < 256);
}

test('Schema-Transport: kein sichtbares Werkzeug verliert sein inputSchema', () => {
  const betroffen = KATALOG_SICHTBAR
    .filter((t) => faelltAusDemTransport(t.inputSchema))
    .map((t) => t.name);

  assert.deepEqual(betroffen, [],
    `${betroffen.length} von ${KATALOG_SICHTBAR.length} Werkzeugen erreichen den Agenten `
    + `ohne inputSchema: ${betroffen.join(', ')} — Latin-1-Sonderzeichen durch ue/oe/ae ersetzen`);
});

test('Schema-Transport: der Negativfall wird erkannt', () => {
  assert.equal(faelltAusDemTransport(
    { type: 'object', properties: { x: { type: 'string', description: '1 bis 12 Stück' } } }),
  true, '"Stück" muss als betroffen gelten');

  assert.equal(faelltAusDemTransport(
    { type: 'object', properties: { x: { type: 'string', description: '1 bis 12 Stueck' } } }),
  false, '"Stueck" ist reines ASCII und kommt durch');

  assert.equal(faelltAusDemTransport(
    { type: 'object', properties: { x: { type: 'string', description: 'Stück → hin' } } }),
  false, 'U+2192 hebt den Text auf den 16-Bit-Pfad; das Schema kommt an');
});
