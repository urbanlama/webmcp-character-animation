// Kollisionsgeometrie: Dreieck gegen Dreieck, Gitter als Vorfilter.
//
// Reine Geometrie, kein Modell — deshalb ohne Ladezeit prüfbar. Jeder
// Positivfall hat seinen Negativfall daneben (AGENTS.md Regel 2): dieselbe
// Anordnung, um einen Betrag verschoben, der den Schnitt aufhebt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dreieckSchnitt, Kollisionsgitter } from './kollision.js';

// Ein waagerechtes Dreieck in der Ebene y = 0, Kantenlänge rund 2 m.
const WAAGERECHT = [[-1, 0, -1], [1, 0, -1], [0, 0, 1]];

/** Senkrechtes Dreieck, das die Ebene y = 0 bei x = versatz durchstößt. */
function senkrecht(versatz) {
  return [[versatz, -1, 0], [versatz, 1, 0], [versatz + 0.5, 0, 0.5]];
}

test('Dreieckschnitt: zwei Dreiecke durchdringen sich', () => {
  const [a, b, c] = WAAGERECHT;
  const [d, e, f] = senkrecht(0);
  assert.equal(dreieckSchnitt(a, b, c, d, e, f), true,
    'senkrechtes Dreieck bei x = 0 durchstößt das waagerechte');
});

test('Dreieckschnitt, Negativfall: dieselbe Anordnung 5 m daneben schneidet nicht', () => {
  const [a, b, c] = WAAGERECHT;
  const [d, e, f] = senkrecht(5);
  assert.equal(dreieckSchnitt(a, b, c, d, e, f), false,
    'bei x = 5 liegt das senkrechte Dreieck außerhalb des waagerechten');
});

test('Dreieckschnitt: Ebene wird geschnitten, das Dreieck selbst nicht', () => {
  // Durchstößt die Ebene y = 0, aber weit neben der Dreiecksfläche. Der Fall
  // trennt einen echten Dreiecksschnitt von einem reinen Ebenenschnitt.
  const [a, b, c] = WAAGERECHT;
  const [d, e, f] = senkrecht(3);
  assert.equal(dreieckSchnitt(a, b, c, d, e, f), false);
});

test('Dreieckschnitt: parallele Dreiecke ohne gemeinsamen Punkt', () => {
  const [a, b, c] = WAAGERECHT;
  const versetzt = WAAGERECHT.map(([x, y, z]) => [x, y + 0.5, z]);
  assert.equal(dreieckSchnitt(a, b, c, versetzt[0], versetzt[1], versetzt[2]), false);
});

test('Gitter: findet den Kandidaten in derselben Zelle', () => {
  const g = new Kollisionsgitter(0.02);
  g.einfuegen(7, [0, 0, 0], [0.01, 0, 0], [0, 0.01, 0]);
  const treffer = [...g.kandidaten([0.005, 0.005, 0], [0.015, 0.005, 0], [0.005, 0.015, 0])];
  assert.deepEqual(treffer, [7]);
});

test('Gitter, Negativfall: ferne Anfrage liefert keinen Kandidaten', () => {
  const g = new Kollisionsgitter(0.02);
  g.einfuegen(7, [0, 0, 0], [0.01, 0, 0], [0, 0.01, 0]);
  const treffer = [...g.kandidaten([5, 5, 5], [5.01, 5, 5], [5, 5.01, 5])];
  assert.deepEqual(treffer, [], 'bei 5 m Abstand darf keine Zelle geteilt werden');
});

test('Gitter: ein Dreieck über mehrere Zellen wird nur einmal geliefert', () => {
  const g = new Kollisionsgitter(0.02);
  // Spannt rund 10 Zellen in x und y auf.
  g.einfuegen(3, [0, 0, 0], [0.2, 0, 0], [0, 0.2, 0]);
  const treffer = [...g.kandidaten([0, 0, 0], [0.2, 0, 0], [0, 0.2, 0])];
  assert.deepEqual(treffer, [3], 'jede ID höchstens einmal, egal über wie viele Zellen sie reicht');
});

test('Gitter lehnt eine unbrauchbare Zellgröße mit Zahl ab', () => {
  assert.throws(() => new Kollisionsgitter(0), /Zellgröße 0/);
  assert.throws(() => new Kollisionsgitter(-0.5), /Zellgröße -0.5/);
});
