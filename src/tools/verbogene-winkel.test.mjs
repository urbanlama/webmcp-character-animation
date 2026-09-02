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
// Positivfall: set_pose in einem verankerten Frame nennt Kanal, gesetzten und
// gelösten Winkel und den Anker als Ursache.
// Negativfall: ohne Abweichung steht kein solcher Satz in der Antwort.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verbogeneWinkel, WINKEL_ABWEICHUNG_MELDEN_GRAD } from './handlers.js';

const zustand = (anchors) => ({
  overrides: { '134': { joints: { pelvis: { tilt: 24 }, hip_l: { flex: -26 }, hip_r: { flex: -26 }, spine: { bend: 35 } }, ease: 'smooth' } },
  anchors,
});

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
});

test('Negativfall: steht alles wie gesetzt, gibt es keinen Satz', () => {
  const z = zustand([{ foot: 'foot_l', von: 79, bis: 159 }]);
  const knapp = WINKEL_ABWEICHUNG_MELDEN_GRAD - 0.5;
  const geloest = { dofs: { 'pelvis.tilt': 24, 'hip_l.flex': -26 + knapp, 'hip_r.flex': -26, 'spine.bend': 35 } };
  assert.deepEqual(verbogeneWinkel(z, 134, geloest), []);
  assert.deepEqual(verbogeneWinkel(z, 135, geloest), [], 'ein Frame ohne Haltung meldet nichts');
  assert.deepEqual(verbogeneWinkel(z, 134, { dofs: null }), []);
});
