// Abnahmetest — "Ein Kanal blendet ein, er springt nicht".
//
// Befund aus dem Agentenlauf vom 1. September 2026: Frame 19 setzte
// `spine.bend`, Frame 26 zusaetzlich `spine.side` und `pelvis.roll`. Die zwei
// neuen Kanaele hatten nur EIN Schluesselbild, ihre Kurve galt damit nur auf
// Frame 26. Gemessen an der geloesten Bewegung:
//
//     Frame 25   1,8 Grad Neigung
//     Frame 26  12,3 Grad     <- 10,5 Grad in einem Frame
//
// Im Bild sichtbar als Umschalter, nicht als Bewegung.
//
// Positivfall: der Kanal bekommt am Nachbar-Schluesselbild eine Stuetzstelle
// und blendet ueber die volle Strecke.
// Negativfall: ohne Verankerung MUSS der Sprung wieder auftauchen — sonst
// misst der Test nicht, was er zu messen behauptet.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baueKurven, verankereKurven, kurvenWert } from './loeser.js';

/** Zwei Schluesselbilder; der Kanal `side` steht nur auf dem zweiten. */
const OVERRIDES = {
  0: { joints: { spine: { bend: 0 } }, ease: 'smooth' },
  30: { joints: { spine: { side: -20 } }, ease: 'smooth' },
};

/** Ausgangshaltung: beide Kanaele stehen auf 0. */
const basiswert = () => 0;

test('Verankerung: ein spaet gesetzter Kanal blendet ueber die ganze Strecke', () => {
  const kurven = baueKurven(OVERRIDES);
  const anzahl = verankereKurven(kurven, OVERRIDES, basiswert);
  // Beide Kanaele stehen auf nur einem Schluesselbild: `side` auf Frame 30,
  // `bend` auf Frame 0. Beide brauchen ihre Gegenstuetze.
  assert.equal(anzahl, 2, 'spine.side und spine.bend brauchen je eine Verankerung');

  const side = kurven.get('spine.side');
  assert.equal(side.length, 2, `spine.side hat 2 Stuetzstellen, nicht ${side.length}`);
  assert.equal(side[0].frame, 0, 'die vordere Stuetzstelle sitzt auf Schluesselbild 0');
  assert.equal(side[0].grad, 0, 'sie traegt den Wert der Ausgangshaltung');

  // Ueber die Strecke muss der Betrag monoton wachsen — kein Sprung, kein Zacken.
  const werte = [0, 5, 10, 15, 20, 25, 29, 30].map((f) => kurvenWert(side, f));
  assert.ok(werte.every((w) => w !== null), 'jeder Frame zwischen 0 und 30 hat einen Wert');
  for (let i = 1; i < werte.length; i += 1) {
    assert.ok(Math.abs(werte[i]) >= Math.abs(werte[i - 1]),
      `Frame ${i}: ${werte[i]}° liegt naeher an 0 als der Frame davor (${werte[i - 1]}°)`);
  }
  assert.equal(werte[werte.length - 1], -20, 'am gesetzten Frame steht der verlangte Wert');

  // Der groesste Schritt zwischen zwei benachbarten Frames bleibt klein.
  const proFrame = [];
  for (let f = 1; f <= 30; f += 1) proFrame.push(Math.abs(kurvenWert(side, f) - kurvenWert(side, f - 1)));
  const groesster = Math.max(...proFrame);
  assert.ok(groesster < 2,
    `groesster Schritt zwischen zwei Frames ist ${groesster.toFixed(2)}°, erlaubt sind unter 2°`);
});

test('Verankerung, Negativfall: ohne sie springt der Kanal in einem Frame', () => {
  const kurven = baueKurven(OVERRIDES);
  const side = kurven.get('spine.side');
  assert.equal(side.length, 1, 'unverankert hat der Kanal genau 1 Stuetzstelle');

  assert.equal(kurvenWert(side, 29), null, 'Frame 29 liegt ausserhalb der Kurve');
  assert.equal(kurvenWert(side, 30), -20, 'Frame 30 traegt den vollen Wert');
  assert.equal(kurvenWert(side, 31), null, 'Frame 31 liegt wieder ausserhalb');
});

test('Verankerung: ein Kanal auf beiden Schluesselbildern bleibt unangetastet', () => {
  const beide = {
    0: { joints: { spine: { bend: 0, side: 0 } }, ease: 'smooth' },
    30: { joints: { spine: { bend: 0, side: -20 } }, ease: 'smooth' },
  };
  const kurven = baueKurven(beide);
  const vorher = kurven.get('spine.side').length;
  const anzahl = verankereKurven(kurven, beide, basiswert);
  assert.equal(anzahl, 0, 'kein Kanal braucht eine Verankerung');
  assert.equal(kurven.get('spine.side').length, vorher, 'die Kurve bleibt, wie sie war');
});

test('Verankerung: hinter dem letzten Schluesselbild HAELT der Kanal, danach wirkt er nicht', () => {
  // Der erste Anlauf dieser Pruefung verlangte Ausblenden zur Ruhelage: der
  // Kanal haette auf Frame 60 wieder bei 0 stehen muessen. Das war der
  // gemessene "Zucken"-Fehler: Der Agent setzt auf Frame 30 eine Neigung und
  // nennt den Kanal danach nicht mehr — er WILL die Haltung behalten, er
  // wiederholt nicht jeden Kanal in jedem Schluesselbild. Mit der Ruhelage
  // als Stuetzstelle wanderte der Wert zurueck auf 0: die Figur ging in eine
  // Haltung und wurde wieder herausgezogen.
  //
  // Gewollt ist jetzt: HALTEN bis zum naechsten Schluesselbild (gleiche Zahl
  // noch einmal), und erst DANACH gehoert der Frame wieder den Phasen.
  const drei = {
    0: { joints: { spine: { bend: 0 } }, ease: 'smooth' },
    30: { joints: { spine: { side: -20 } }, ease: 'smooth' },
    60: { joints: { spine: { bend: 5 } }, ease: 'smooth' },
  };
  const kurven = baueKurven(drei);
  verankereKurven(kurven, drei, basiswert);
  const side = kurven.get('spine.side');

  assert.equal(kurvenWert(side, 60), -20,
    'auf Frame 60 haelt der Kanal die gesetzte Haltung (-20), er blendet nicht zur Ruhelage aus');
  assert.equal(kurvenWert(side, 61), null, 'danach gehoert der Frame wieder den Phasen');
});

test('Verankerung: eine Ausgangshaltung ohne diesen Kanal gilt als Ruhelage', () => {
  // Die Basispose fuehrt nur Freiheitsgrade, die eine Phase belegt hat. Bei
  // einer reinen Schluesselbild-Timeline ist sie leer — dann muss der Kanal
  // trotzdem verankert werden, sonst greift der Fix im Browser nicht.
  // Genau daran scheiterte der erste Anlauf: 339 Tests gruen, live unveraendert.
  const kurven = baueKurven(OVERRIDES);
  const anzahl = verankereKurven(kurven, OVERRIDES, () => undefined);
  assert.equal(anzahl, 2, 'auch ohne Basiswert werden beide Kanaele verankert');
  assert.equal(kurven.get('spine.side')[0].grad, 0, 'die Stuetzstelle traegt die Ruhelage 0');
});
