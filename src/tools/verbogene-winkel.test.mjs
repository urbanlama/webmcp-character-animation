// Abnahmetest — „Der Agent erfährt, wenn der Löser seine Winkel umbiegt".
//
// Lauf vom 1. September 2026 (Session 5c6a601a): der Agent setzte für die
// Verbeugung pelvis.tilt 24° und hip.flex −26° — in der Annahme, das hebe sich
// auf. Es addiert sich. Der Fußanker (hold_foot 79–159) bog die Beinkette
// still zurück, measure zeigte dem Agenten die korrigierte Haltung, er meldete
// „Verbeugung sitzt". Der Mensch sah in der Anzeige die Rohhaltung: Fuß 40 cm
// in der Luft. Der Löser schrieb den Umstand in bericht.hinweise — die kein
// Werkzeug je ausgab.
//
// Positivfälle: set_pose in einem verankerten Frame nennt Kanal, gesetzten und
// gelösten Winkel und den Anker als Ursache — aber nur für Beingelenke der
// verankerten Seite. Abweichungen an Armgelenken oder am Bein ohne Anker
// heißen Gelenkgrenzen (Befund G8, Fall 15: `arm_l.lift 180` bekam den
// Anker-Lösungsweg, der ins Leere führte). Mischen sich beide Ursachen,
// stehen zwei Sätze.
// Negativfall: ohne Abweichung steht kein solcher Satz in der Antwort.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verbogeneWinkel, WINKEL_ABWEICHUNG_MELDEN_GRAD } from './handlers.js';

const zustand = (anchors) => ({
  overrides: { '134': { joints: { pelvis: { tilt: 24 }, hip_l: { flex: -26 }, hip_r: { flex: -26 }, spine: { bend: 35 }, arm_l: { lift: 180 }, elbow_r: { bend: -90 }, knee_r: { bend: 10 } } }, ease: 'smooth' },
  anchors,
});

/** Anzahl der Sätze einer Antwort (0, 1 oder 2). */
const saetzeLaenge = (s) => s.split('. ').length;

test('Anker biegt gesetzte Winkel: Kanal, Soll, Ist und Ursache stehen in der Wirkung', () => {
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }, { foot: 'foot_r', von: 79, bis: 159 }]);
  const geloest = { dofs: { 'pelvis.tilt': 24, 'hip_l.flex': 12.3, 'hip_r.flex': 11.8, 'spine.bend': 35 } };
  const saetze = verbogeneWinkel(z, 134, geloest);
  assert.equal(saetze.length, 1);
  const s = saetze[0];
  assert.match(s, /2 gesetzte Winkel/);
  assert.match(s, /hip_l\.flex -26° → 12,3°|hip_l\.flex -26° → 12\.3°/);
  assert.match(s, /hold_foot foot_l 79–159/);
  assert.match(s, /Fußanker/);
});

test('Ohne Anker heißt die Ursache Gelenkgrenze', () => {
  const z = zustand([]);
  const geloest = { dofs: { 'pelvis.tilt': 24, 'hip_l.flex': -26, 'hip_r.flex': -26, 'spine.bend': 35 - 10 } };
  const [s] = verbogeneWinkel(z, 134, geloest);
  assert.match(s, /spine\.bend 35° → 25°/);
  assert.match(s, /Gelenkgrenzen/);
  assert.doesNotMatch(s, /Fußanker/);
});

test('G8: Armgelenk bei aktivem Fußanker heißt Gelenkgrenze, nicht Fußanker', () => {
  // Befund G8, Fall 15: arm_l.lift 180 und elbow_r.bend -90 wurden geklemmt,
  // die Antwort schob es dem Fußanker in die Schuhe — dessen Lösungsweg
  // (Ankerspanne verkürzen) hilft bei Armgelenken nicht.
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }, { foot: 'foot_r', von: 79, bis: 159 }]);
  const geloest = { dofs: { 'arm_l.lift': 100, 'elbow_r.bend': 0 } };
  const [s] = verbogeneWinkel(z, 134, geloest);
  assert.equal(saetzeLaenge(s), 1);
  assert.match(s, /arm_l\.lift 180° → 100°/);
  assert.match(s, /Gelenkgrenzen/);
  assert.doesNotMatch(s, /Fußanker/, 'Armgelenk darf dem Fußanker zugeschrieben werden');
  assert.doesNotMatch(s, /hold_foot/);
});

test('G8: Beingelenk der verankerten Seite heißt Fußanker, das andere Bein heißt Grenzen', () => {
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }]);
  const geloest = { dofs: { 'hip_l.flex': 12.3, 'knee_r.bend': 5, spine: undefined } };
  const saetze = verbogeneWinkel(z, 134, geloest);
  assert.equal(saetze.length, 2, `erwartet zwei Sätze (Anker links, Grenzen rechts), gekommen: ${JSON.stringify(saetze)}`);
  const mitAnker = saetze.find((s) => /Fußanker/.test(s));
  const mitGrenzen = saetze.find((s) => /Gelenkgrenzen/.test(s));
  assert.ok(mitAnker, 'kein Satz mit Fußanker-Ursache');
  assert.ok(mitGrenzen, 'kein Satz mit Gelenkgrenzen-Ursache');
  assert.match(mitAnker, /hip_l\.flex -26° → 12,3°|hip_l\.flex -26° → 12\.3°/);
  assert.match(mitAnker, /hold_foot foot_l 79–159/);
  assert.match(mitGrenzen, /knee_r\.bend/);
  assert.doesNotMatch(mitAnker, /knee_r\.bend/, 'die Grenzen-Abweichung steht im Grenzen-Satz, nicht im Anker-Satz');
  assert.doesNotMatch(mitGrenzen, /hip_l\.flex/);
});

test('G8: Beingelenk ohne Anker auf dieser Seite heißt nicht Fußanker', () => {
  // Anker verankert nur links; das rechte Bein kann er nicht biegen.
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }]);
  const geloest = { dofs: { 'hip_r.flex': 0 } };
  const [s] = verbogeneWinkel(z, 134, geloest);
  assert.match(s, /Gelenkgrenzen/);
  assert.doesNotMatch(s, /Fußanker/);
  assert.doesNotMatch(s, /hold_foot/);
});

test('Negativfall: steht alles wie gesetzt, gibt es keinen Satz', () => {
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }]);
  const knapp = WINKEL_ABWEICHUNG_MELDEN_GRAD - 0.5;
  const geloest = { dofs: { 'pelvis.tilt': 24, 'hip_l.flex': -26 + knapp, 'hip_r.flex': -26, 'spine.bend': 35 } };
  assert.deepEqual(verbogeneWinkel(z, 134, geloest), []);
  assert.deepEqual(verbogeneWinkel(z, 135, geloest), [], 'ein Frame ohne Haltung meldet nichts');
  assert.deepEqual(verbogeneWinkel(z, 134, { dofs: null }), []);
});
