// Abnahmetest — „Der Prüfbericht zeigt EINEN Moment, dafür räumlich eindeutig".
//
// Befund vom 2. September 2026 (docs/journal/buehne-befunde-2026-09-02.md, Punkt 1):
// `validate` klebte bis zu sechs Frames in zwei Ansichten zu einem Bild
// zusammen — zwölf Kacheln, jede Figur fingernagelgroß. Belegt am Bild:
// darauf ist eine Fehlhaltung nicht erkennbar, und genau dafür war das Bild da.
//
// Die Bildpflicht selbst bleibt (plan.md 5.3): ein Agent, der nur Zahlen liest,
// baut kaputte Bewegungen mit grünem Gewissen — docs/journal/nachlese-2026-09-01.md,
// Briefmarken erfüllen sie aber nur auf dem Papier.
//
// Zwei Ansichten, nicht eine: aus einem einzelnen Blick ist ein 3D-Raum nicht
// eindeutig. Ein Arm vor dem Körper und ein Arm neben dem Körper sehen von vorn
// gleich aus. Zwei um 90 Grad versetzte Blicke lösen das auf.
//
// Ein Frame, nicht sechs: der Verlauf gehört zu `look`, das der Agent selbst
// aufruft, so oft er will und mit der Kamera, die zur Frage passt.
//
// Positivfall: genau ein Frame, genau zwei Ansichten, und der Frame ist der
// erste beanstandete.
// Negativfall: ohne Beanstandung wird trotzdem gezeigt — Fehlerfreiheit ist
// kein Grund, nicht hinzusehen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { waehleBildframes, BERICHT_ANSICHTEN } from './report.js';

test('Ein beanstandeter Frame: genau dieser wird gezeigt', () => {
  assert.deepEqual(waehleBildframes(60, [23], []), [23]);
});

test('Mehrere Beanstandungen: der erste Frame, nicht alle', () => {
  const gewaehlt = waehleBildframes(60, [41, 23, 37], []);
  assert.equal(gewaehlt.length, 1,
    `erwartet genau einen Frame, bekommen ${gewaehlt.length} — sechs Kacheln zeigen dem Agenten nichts`);
  assert.deepEqual(gewaehlt, [23], 'gezeigt wird die früheste beanstandete Stelle');
});

test('Ohne Beanstandung: die Mitte der Bewegung', () => {
  // Fehlerfreiheit ist kein Erfolg — der Agent sieht trotzdem, was er gebaut hat.
  assert.deepEqual(waehleBildframes(60, [], []), [30]);
  assert.deepEqual(waehleBildframes(1, [], []), [0]);
});

test('Phasengrenzen allein sind keine Beanstandung', () => {
  // Frueher zaehlten Phasenanfang und -ende als kritisch und fuellten den
  // Streifen. Bei einem Bild ist der Platz fuer echte Befunde da.
  assert.deepEqual(waehleBildframes(60, [], [{ from: 0, to: 20 }, { from: 20, to: 60 }]), [30]);
  assert.deepEqual(waehleBildframes(60, [44], [{ from: 0, to: 20 }]), [44]);
});

test('Zwei Ansichten, um 90 Grad versetzt', () => {
  assert.equal(BERICHT_ANSICHTEN.length, 2,
    'ein Blick laesst den Raum mehrdeutig, drei kosten Bildgroesse');
  const [a, b] = BERICHT_ANSICHTEN;
  assert.equal(Math.abs(a.richtung_grad - b.richtung_grad), 90,
    `die Blicke stehen ${Math.abs(a.richtung_grad - b.richtung_grad)}° auseinander, erwartet 90°`);
  for (const v of BERICHT_ANSICHTEN) {
    assert.equal(v.weite, 'ganz', 'der Bericht zeigt die ganze Figur — Details holt look');
  }
});
