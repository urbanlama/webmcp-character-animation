// A3 — Agentenlast: der Test des Pruefstands.
//
// Zwei Instrumente, beide nur aus name + description der 16 Katalogeintraege:
//  1. Auswahl: aufgezeichnete Werkzeugwahl je Aufgabe. Abnahme: fuenf
//     Standardaufgaben muessen richtig gewaehlt werden. Die zwei aehnlichen
//     Faelle werden nur protokolliert — ein Danebengreifen ist hier ein
//     gultiges Ergebnis, kein Misserfolg (Auftrag A3).
//  2. Abdeckung: mechanisch gemessen, wie viele Kernwoerter der Frage in der
//     Beschreibung wiederkehren. Zeigt die Schwachstellen fuer ERGEBNIS.md.
//
// Negativfaelle nach AGENTS.md Regel 2:
//  1. Strohmann-Verweigerung: fuehreWerkzeug wirft bei falscher Freigabe.
//  2. Kaputte Bewertungsvariante WAHLEN_NEGATIV muss rot werden.
//  3. Leere Frage darf kein Werkzeug treffen und keine Abdeckung liefern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bewerte, WAHLEN_NEGATIV } from './bewerte.mjs';
import { standardAufgaben, aehnlicheAufgaben, AUFGABEN } from './aufgaben.mjs';
import { entscheidung } from './auswahl.mjs';
import { abdeckung, woerter } from './abdeckung.mjs';
import { fuehreWerkzeug, erlaubeNur, aufrufListe } from './strohmann.mjs';
import { KATALOG } from '../../src/tools/catalog.js';

test('Negativfall 1: Strohmann lehnt nicht freigegebene Werkzeuge ab', () => {
  erlaubeNur('undo');
  assert.throws(
    () => fuehreWerkzeug('look', '{"frames":[1],"views":["front"]}'),
    /nicht freigegeben/
  );
  assert.equal(aufrufListe().length, 1);
});

test('Negativfall 2: kaputte Bewertungsvariante MUSS rot werden', () => {
  const aufgaben = standardAufgaben();
  const ergebnis = WAHLEN_NEGATIV(aufgaben);
  const treffer = ergebnis.filter(r => r.oben === r.richtig).length;
  assert.ok(treffer < aufgaben.length, `kaputte Variante darf nicht bestehen: ${treffer}/${aufgaben.length} getroffen`);
});

test('Negativfall 2b: korrekte Variante trifft mindestens eine Aufgabe', () => {
  const ergebnis = bewerte(standardAufgaben());
  const treffer = ergebnis.filter(r => r.oben === r.richtig).length;
  assert.ok(treffer > 0, `korrekte Variante trifft nichts: 0/${ergebnis.length}`);
});

test('Negativfall 3: leere Frage hat null Woerter und keine Entscheidung', () => {
  assert.equal(woerter('   ').length, 0);
  assert.throws(() => entscheidung({ id: 'LEER' }), /keine aufgezeichnete Entscheidung/);
});

test('Katalogdeckung: alle 16 Werkzeuge sind vorhanden und einzigartig', () => {
  assert.equal(KATALOG.length, 16, `Katalog hat ${KATALOG.length} Eintraege, erwartet 16`);
  const namen = new Set(KATALOG.map(e => e.name));
  assert.equal(namen.size, 16, 'Katalog enthaelt doppelte Namen');
});

test('Abnahme: fuenf Standardaufgaben werden richtig gewaehlt', () => {
  const fehler = [];
  for (const a of standardAufgaben()) {
    const e = entscheidung(a);
    if (e.wahl !== a.richtig) {
      fehler.push(`${a.id}: gewaehlt='${e.wahl}', richtig='${a.richtig}'`);
    }
  }
  assert.equal(fehler.length, 0, `danebengegriffen: ${fehler.join(' | ')}`);
});

test('Aehnliche Faelle: Auswahl wird protokolliert, Danebengreifen ist erlaubt', () => {
  for (const a of aehnlicheAufgaben()) {
    const e = entscheidung(a);
    const treffer = e.wahl === a.richtig;
    const nebenVerwechslung = e.wahl === a.griffig;
    console.log(
      `[A3] ${a.id}: gewaehlt='${e.wahl}', richtig='${a.richtig}' -> ` +
      (treffer ? 'TREFFER' : (nebenVerwechslung ? 'DANEBEN (Verwechslung wie erwartet)' : 'DANEBEN')) +
      ` | Grund: ${e.grund}`
    );
    // Kein assert auf wahl: Danebengreifen ist hier ein gueltiges Ergebnis.
    assert.ok(e.wahl, 'Wahl-String ist leer');
  }
});

test('Abdeckung: Kernwoerter je Frage und Werkzeug messbar', () => {
  const bericht = [];
  for (const a of AUFGABEN) {
    const e = entscheidung(a);
    const ab = abdeckung(a.frage, a.richtig);
    const quote = ab.total ? (ab.treffer.length / ab.total) : 0;
    bericht.push({ id: a.id, quote, treffer: ab.treffer, fehlen: ab.fehlen });
  }
  for (const b of bericht) {
    console.log(
      `[A3-Abdeckung] ${b.id}: ${(b.quote * 100).toFixed(0)}% (${b.treffer.length}/${b.total})` +
      ` | getroffen: ${b.treffer.slice(0, 6).join(', ') || 'keine'}` +
      ` | fehlen: ${b.fehlen.slice(0, 6).join(', ') || 'keine'}`
    );
  }
  assert.equal(bericht.length, 7, `Abdeckung fuer ${bericht.length} Aufgaben statt 7 berechnet`);
});