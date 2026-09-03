// Abnahmetest — „Der Agent sieht den Ablauf als Folge GROSSER Einzelbilder".
//
// Vorgeschichte, zwei verworfene Wege (docs/journal/buehne-befunde-2026-09-02.md):
//
//   1. Der alte Bildstreifen klebte bis zu sechs Frames in EIN PNG. Jede Figur
//      wurde fingernagelgross; am Bild belegt, dass darauf nichts zu erkennen
//      ist.
//   2. Die Bewegungsspur legte die Bahnen aller Endeffektoren in ein Bild. Sie
//      zeigte einen Standweitsprung brauchbar, ist aber nicht intuitiv — die
//      Zeitrichtung muss man aus Zahlen erschliessen. Und bei einer Bewegung,
//      die denselben Weg mehrfach laeuft (drei Rueckwaertssaltos), ueberlagern
//      sich die Bahnen zu einem Knaeuel, aus dem sich nichts mehr lesen laesst.
//
// Der dritte Weg ist der einfachste: mehrere Einzelbilder in EINER Antwort,
// jedes in voller Groesse. Das MCP-Antwortformat traegt beliebig viele
// image-Bloecke; sie muessen nicht in ein PNG. Ein Daumenkino aus klaren
// Bildern statt einer Zeichnung, die gedeutet werden will.
//
// Positivfall: gleichmaessig ueber den verlangten Bereich verteilt, Anfang und
// Ende immer dabei.
// Negativfall: ein Bereich mit weniger Frames als Bildern liefert jeden Frame
// einmal, keine Dubletten.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { folgeFrames, FOLGE_BILDER } from './bildfolge.js';

test('Anfang und Ende sind immer dabei', () => {
  const f = folgeFrames(0, 23, FOLGE_BILDER);
  assert.equal(f[0], 0, 'der erste Frame des Bereichs fehlt');
  assert.equal(f[f.length - 1], 23, 'der letzte Frame des Bereichs fehlt');
});

test('Gleichmäßig verteilt über den Bereich', () => {
  const f = folgeFrames(0, 24, 4);
  assert.deepEqual(f, [0, 8, 16, 24]);
});

test('Ein Teilbereich liefert nur aus diesem Bereich', () => {
  const f = folgeFrames(10, 16, 4);
  assert.deepEqual(f, [10, 12, 14, 16]);
  assert.ok(f.every((x) => x >= 10 && x <= 16));
});

test('Weniger Frames als Bilder: jeder einmal, keine Dubletten', () => {
  assert.deepEqual(folgeFrames(5, 7, 6), [5, 6, 7]);
  assert.deepEqual(folgeFrames(3, 3, 4), [3]);
});

test('FOLGE_BILDER passt ins Antwortbudget', () => {
  // Gemessen am Xbot: ein Einzelbild in voller Größe liegt bei rund 150 KB,
  // als Base64 ein Drittel mehr. Das Antwortbudget sind 512 KB — mehr als
  // drei Bilder gehen nicht durch, und weniger als zwei zeigen keinen Ablauf.
  assert.ok(FOLGE_BILDER >= 2 && FOLGE_BILDER <= 4,
    `FOLGE_BILDER = ${FOLGE_BILDER}: unter 2 ist es kein Ablauf, über 4 sprengt es das Budget`);
});

test('Aufsteigend und ohne Wiederholung', () => {
  for (const [von, bis, n] of [[0, 23, 3], [0, 100, 3], [7, 9, 3], [0, 1, 3]]) {
    const f = folgeFrames(von, bis, n);
    assert.deepEqual([...f].sort((a, b) => a - b), f, `nicht aufsteigend: ${f}`);
    assert.equal(new Set(f).size, f.length, `Dublette in ${f}`);
  }
});
