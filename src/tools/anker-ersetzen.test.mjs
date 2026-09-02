// Abnahmetest — „Einen Anker aendert man mit einem Aufruf".
//
// Reibungsbericht Lauf 7, Punkt 5: hold_foot kannte nur zwei Wege, anlegen und
// entfernen. Wer eine Spanne aendern wollte — aus 40–78 sollte 40–72 werden —,
// musste erst entfernen und dann neu anlegen. 14 von 32 hold_foot-Aufrufen
// eines Laufs waren solche Entfernungen.
//
// Seit dem 2. September 2026 ersetzt ein neuer Anker die vorhandenen Anker
// DESSELBEN Fusses, deren Spanne sich mit der neuen ueberschneidet. Der Ort,
// an dem der Fuss steht, bleibt dabei erhalten: der Ersatz erbt `ortFrame`
// (im Loeser ausgewertet, siehe src/solver/anker-ortframe.test.mjs).
//
// Negativfaelle: eine Spanne, die die alte NICHT beruehrt, legt einen zweiten
// Anker an statt zu ersetzen. Und ein anderer Fuss mit derselben Spanne laesst
// den ersten in Ruhe — sonst wuerde „beide Fuesse stehen" sich selbst
// wegloeschen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, leererZustand } from './index.js';

const text = (antwort) => antwort.content?.map((c) => c.text ?? '').join('\n') ?? '';

async function schicht(frames = 120) {
  const z = leererZustand();
  z.frameCount = frames;
  return createToolLayer({ zustand: z });
}

test('derselbe Fuss mit ueberlappender Spanne ersetzt den alten Anker', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 78 });
  const t = text(await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 72 }));

  const anker = s.store.roh().anchors;
  assert.equal(anker.length, 1, `es darf nur ein Anker bleiben, es sind ${anker.length}: ${JSON.stringify(anker)}`);
  assert.equal(anker[0].von, 40);
  assert.equal(anker[0].bis, 72);
  assert.match(t, /1 fruehere/, `die Antwort muss sagen, dass ersetzt wurde: ${t}`);
});

test('der Ersatz behaelt den Ort des alten Ankers, auch wenn der Anfang wandert', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 78 });
  const t = text(await s.rufe('hold_foot', { foot: 'foot_l', von: 50, bis: 72 }));

  const [a] = s.store.roh().anchors;
  assert.equal(a.ortFrame, 40,
    `der Ersatz muss den Ort aus Frame 40 behalten, er nennt ${a.ortFrame}`);
  assert.match(t, /Frame 40/, `die Antwort muss den Ort nennen, aus dem der Fuss stammt: ${t}`);

  // Und weiter: ein dritter Aufruf erbt denselben Ort, nicht den des Ersatzes.
  await s.rufe('hold_foot', { foot: 'foot_l', von: 55, bis: 70 });
  assert.equal(s.store.roh().anchors[0].ortFrame, 40,
    'der Ort darf nicht bei jedem Ersetzen weiterwandern');
});

test('Negativfall: eine Spanne ohne Beruehrung legt einen zweiten Anker an', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 78 });
  const t = text(await s.rufe('hold_foot', { foot: 'foot_l', von: 79, bis: 100 }));

  const anker = s.store.roh().anchors;
  assert.equal(anker.length, 2,
    `getrennte Spannen sind zwei Anker, es sind ${anker.length}: ${JSON.stringify(anker)}`);
  assert.equal(/fruehere/.test(t), false, `hier wurde nichts ersetzt, die Antwort behauptet es: ${t}`);
});

test('Negativfall: der andere Fuss loescht den ersten nicht weg', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 78 });
  await s.rufe('hold_foot', { foot: 'foot_r', von: 40, bis: 78 });

  const anker = s.store.roh().anchors;
  assert.equal(anker.length, 2, JSON.stringify(anker));
  assert.deepEqual(anker.map((x) => x.foot).sort(), ['foot_l', 'foot_r']);
});

test('beide: ersetzt beide Fuesse in einem Aufruf', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'beide', von: 40, bis: 78 });
  await s.rufe('hold_foot', { foot: 'beide', von: 40, bis: 72 });

  const anker = s.store.roh().anchors;
  assert.equal(anker.length, 2, `zwei Fuesse, zwei Anker, es sind ${anker.length}: ${JSON.stringify(anker)}`);
  assert.ok(anker.every((x) => x.bis === 72), JSON.stringify(anker));
});

test('undo dreht ein Ersetzen zurueck — der alte Anker steht wieder da', async () => {
  const s = await schicht();
  await s.rufe('hold_foot', { foot: 'foot_l', von: 40, bis: 78 });
  await s.rufe('hold_foot', { foot: 'foot_l', von: 50, bis: 72 });
  await s.rufe('undo', {});

  const anker = s.store.roh().anchors;
  assert.equal(anker.length, 1, JSON.stringify(anker));
  assert.equal(anker[0].bis, 78, `nach undo muss die alte Spanne wieder stehen: ${JSON.stringify(anker)}`);
});
