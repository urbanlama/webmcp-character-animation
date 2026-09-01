// Weiche Ueberblendung darf an Schluesselbildern nicht anhalten.
//
// Vorher war `smooth` smoothstep, t²(3−2t). Dessen Ableitung ist an beiden
// Enden null: jeder Kanal bremste an JEDEM Schluesselbild auf null und lief
// wieder an. Bei Schluesselbildern alle 2–4 Frames ist das alle 70–130 ms
// eine Vollbremsung — der steife, stockende Gang.
//
// Positivfall: bei gleichmaessiger Steigung laeuft die Kurve gerade durch.
// Negativfall: smoothstep MUSS an derselben Stelle einbrechen, sonst prueft
// der Test nichts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kurvenWert, EASE } from './loeser.js';

/** Schrittweite je Frame ueber die ganze Kurve. */
function schritte(liste) {
  const von = liste[0].frame, bis = liste[liste.length - 1].frame;
  const w = [];
  for (let f = von; f <= bis; f += 1) w.push(kurvenWert(liste, f));
  return w.slice(1).map((v, i) => v - w[i]);
}

const RAMPE = [
  { frame: 0, grad: 0, ease: 'smooth' },
  { frame: 5, grad: 10, ease: 'smooth' },
  { frame: 10, grad: 20, ease: 'smooth' },
];

test('Glätte: bei gleichmäßiger Steigung bremst kein Schlüsselbild', () => {
  const d = schritte(RAMPE);
  const min = Math.min(...d), max = Math.max(...d);
  assert.ok(max - min < 0.01,
    `Schrittweite schwankt zwischen ${min.toFixed(2)} und ${max.toFixed(2)} Grad je Frame — `
    + 'bei gleichmäßiger Steigung muss sie konstant sein');
});

test('Glätte, Negativfall: smoothstep bricht an derselben Stelle ein', () => {
  // Dieselbe Rampe von Hand mit smoothstep gerechnet — so lief es vorher.
  const w = [];
  for (let f = 0; f <= 10; f += 1) {
    const i = f < 5 ? 0 : 1;
    const a = RAMPE[i], b = RAMPE[i + 1] ?? RAMPE[i];
    const t = b.frame > a.frame ? (f - a.frame) / (b.frame - a.frame) : 0;
    w.push(a.grad + (b.grad - a.grad) * EASE.smooth(t));
  }
  const d = w.slice(1).map((v, i) => v - w[i]);
  const min = Math.min(...d), max = Math.max(...d);
  assert.ok(max - min > 1,
    `smoothstep müsste einbrechen, schwankt aber nur zwischen ${min.toFixed(2)} und ${max.toFixed(2)} — `
    + 'dann misst der Positivfall nichts');
});

test('Glätte: ein Scheitelpunkt schwingt nicht über', () => {
  const liste = [
    { frame: 0, grad: 0, ease: 'smooth' },
    { frame: 5, grad: 30, ease: 'smooth' },
    { frame: 10, grad: 0, ease: 'smooth' },
  ];
  for (let f = 0; f <= 10; f += 1) {
    const v = kurvenWert(liste, f);
    assert.ok(v <= 30 + 1e-9 && v >= -1e-9,
      `Frame ${f}: ${v.toFixed(2)}° liegt außerhalb der gesetzten 0…30° — `
      + 'ein Überschwinger unter den Boden löst Fehlalarme in der Bodenprüfung aus');
  }
});

test('Glätte: hold hält, die Kurve läuft nicht vorzeitig an', () => {
  const liste = [
    { frame: 0, grad: 0, ease: 'hold' },
    { frame: 4, grad: 10, ease: 'smooth' },
    { frame: 8, grad: 20, ease: 'smooth' },
  ];
  for (let f = 0; f < 4; f += 1) {
    assert.equal(kurvenWert(liste, f), 0, `hold muss bis Frame 4 auf 0 stehen, Frame ${f} steht anders`);
  }
});
