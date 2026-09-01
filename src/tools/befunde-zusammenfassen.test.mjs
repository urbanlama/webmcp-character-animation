// Abnahmetest — "Ein Befund über vier Frames ist ein Befund".
//
// Gemessen am Agentenlauf vom 1. September 2026: die Bodenpruefung meldete
// dieselbe Zehenspitze in Frame 52, 53, 54, 55 und 56 einzeln. Ueber den
// ganzen Bericht 43 Bodenmeldungen, Antwortgroesse 33 bis 49 KB, fuenfmal
// gerufen — rund 190 KB fuer eine Handvoll Sachverhalte.
//
// Positivfall: aufeinanderfolgende Frames derselben Art am selben Koerperteil
// werden zu einem Eintrag mit von/bis, und der groesste Betrag bleibt stehen.
// Negativfall: eine Luecke in der Frame-Folge darf NICHT ueberbrueckt werden,
// und zwei verschiedene Koerperteile bleiben zwei Befunde.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fasseIssuesZusammen } from './handlers.js';

const boden = (frame, part, value) => ({
  kind: 'boden', frame, part, value, unit: 'm',
  message: `${part} steckt ${(value * 100).toFixed(1)} cm im Boden`,
  fix: 'Wurzel anheben oder Bein strecken',
});

test('Zusammenfassung: fuenf Frames am selben Teil werden ein Befund', () => {
  const bericht = { physics: { issues: [
    boden(52, 'RightToeBase', 0.023),
    boden(53, 'RightToeBase', 0.028),
    boden(54, 'RightToeBase', 0.031),
    boden(55, 'RightToeBase', 0.030),
    boden(56, 'RightToeBase', 0.029),
  ] } };

  const { bericht: aus, vorher, nachher } = fasseIssuesZusammen(bericht);
  assert.equal(vorher, 5);
  assert.equal(nachher, 1, `5 Meldungen ergeben 1 Befund, nicht ${nachher}`);

  const b = aus.physics.issues[0];
  assert.equal(b.von, 52, 'die Spanne beginnt bei Frame 52');
  assert.equal(b.bis, 56, 'die Spanne endet bei Frame 56');
  assert.equal(b.frames, 5, '5 Frames sind betroffen');
  assert.equal(b.value, 0.031, 'der groesste Betrag bleibt stehen');
  assert.equal(b.frame, 54, 'und der Frame, in dem er auftrat');
  assert.match(b.message, /Frames 52 bis 56/, 'die Meldung nennt die Spanne');
});

test('Zusammenfassung, Negativfall: eine Luecke wird nicht ueberbrueckt', () => {
  const bericht = { physics: { issues: [
    boden(10, 'LeftToe_End', 0.01),
    boden(11, 'LeftToe_End', 0.02),
    // Frame 12 ist sauber
    boden(13, 'LeftToe_End', 0.03),
    boden(14, 'LeftToe_End', 0.04),
  ] } };

  const { nachher } = fasseIssuesZusammen(bericht);
  assert.equal(nachher, 2, `zwei getrennte Spannen bleiben zwei Befunde, nicht ${nachher}`);
});

test('Zusammenfassung, Negativfall: zwei Koerperteile bleiben zwei Befunde', () => {
  const bericht = { physics: { issues: [
    boden(52, 'RightToeBase', 0.023),
    boden(52, 'RightToe_End', 0.024),
    boden(53, 'RightToeBase', 0.028),
    boden(53, 'RightToe_End', 0.032),
  ] } };

  const { vorher, nachher } = fasseIssuesZusammen(bericht);
  assert.equal(vorher, 4);
  assert.equal(nachher, 2, 'je Koerperteil eine Spanne');
});

test('Zusammenfassung: ein einzelner Befund bleibt unangetastet', () => {
  const bericht = { physics: { issues: [boden(52, 'RightToeBase', 0.023)] } };
  const { bericht: aus, vorher, nachher } = fasseIssuesZusammen(bericht);
  assert.equal(vorher, 1);
  assert.equal(nachher, 1);
  assert.equal(aus.physics.issues[0].von, undefined, 'kein von/bis an einem Einzelbefund');
  assert.equal(aus.physics.issues[0].message, bericht.physics.issues[0].message,
    'die Meldung bleibt Wort fuer Wort dieselbe');
});
