// Abnahmetest AP7 — "Rückfrage", docs/umsetzung.md.
//
// Positivfall: das Werkzeug wartet, der Klick liefert die Antwort im selben
// Aufruf.
// Negativfall: Abbruch oder Neuladen waehrend der Wartezeit beschaedigt die
// Timeline nicht.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer, fingerabdruck } from '../tools/index.js';

/** Wartet, bis der Broker eine offene Frage hat — der Klick des Menschen. */
async function warteAufFrage(schicht) {
  for (let i = 0; i < 100; i += 1) {
    if (schicht.ask.stand().wartet) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('nach 100 ms wartet keine Frage');
}

test('Rückfrage: Werkzeug wartet, Klick liefert die Antwort im selben Aufruf', async () => {
  const schicht = await createToolLayer({});

  const aufruf = schicht.rufe('ask_human', {
    question: 'Soll die Figur mit dem linken oder dem rechten Fuß landen?',
    options: ['linker Fuß', 'rechter Fuß']
  });

  await warteAufFrage(schicht);
  assert.equal(schicht.ask.stand().wartet, true, 'der Aufruf hängt an der Frage');

  schicht.ask.antworte(1);                       // der Mensch klickt
  const antwort = await aufruf;                  // derselbe Aufruf liefert sie

  assert.ok(!antwort.isError, antwort.content[0].text);
  assert.match(antwort.content[0].text, /rechter Fuß/);
  assert.match(antwort.content[0].text, /Möglichkeit 2 von 2/);
});

test('Rückfrage: set_intent wartet auf die Bestätigung des Menschen (plan.md 6.7)', async () => {
  const schicht = await createToolLayer({});
  const aufruf = schicht.rufe('set_intent', {
    checks: [{ kind: 'rotation', part: 'pelvis', axis: 'x', minDeg: 350, maxDeg: 370, from: 12, to: 44 }]
  });

  await warteAufFrage(schicht);
  schicht.ask.antworte(0);                       // "Ja, so bauen"
  const antwort = await aufruf;

  assert.ok(!antwort.isError, antwort.content[0].text);
  assert.equal(schicht.store.lies().intent.checks.length, 1);
});

test('Rückfrage, Negativfall: Abbruch während der Wartezeit lässt die Timeline unberührt', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 90 });
  await schicht.rufe('add_phase', { verb: 'crouch', from: 0, to: 12, params: { depth: 0.35 } });

  const vorher = fingerabdruck(schicht.store.lies());
  const tiefeVorher = schicht.store.tiefe();

  const aufruf = schicht.rufe('set_intent', {
    checks: [{ kind: 'airtime', minSek: 0.6, maxSek: 1.0 }]
  });
  await warteAufFrage(schicht);
  schicht.ask.abbrechen('der Mensch hat abgebrochen');

  const antwort = await aufruf;
  assert.ok(antwort.isError, 'der Aufruf endet als Fehler, nicht stillschweigend');
  assert.match(antwort.content[0].text, /\d/, 'die Meldung nennt eine Zahl');

  assert.equal(fingerabdruck(schicht.store.lies()), vorher, 'Timeline bitgleich wie vorher');
  assert.equal(schicht.store.tiefe(), tiefeVorher, 'kein Schritt auf dem Undo-Stapel');
  assert.equal(schicht.store.lies().intent, null, 'keine halbe Absicht gespeichert');
});

test('Rückfrage, Negativfall: Neuladen während der Wartezeit beschädigt die Timeline nicht', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 90 });
  await schicht.rufe('add_phase', { verb: 'takeoff', from: 12, to: 18, params: { vy: 4.2 } });

  const aufruf = schicht.rufe('ask_human', {
    question: 'Weiter mit der Drehung?',
    options: ['ja', 'nein']
  });
  await warteAufFrage(schicht);

  // Neuladen: der Zustand wird gesichert, die Seite verschwindet, der offene
  // Aufruf stirbt mit ihr.
  const gesichert = schicht.store.lies();
  schicht.ask.abbrechen('die Seite wurde neu geladen');
  const antwort = await aufruf;
  assert.ok(antwort.isError);

  // Die neue Seite baut die Schicht aus dem gesicherten Zustand wieder auf.
  const neu = await createToolLayer({ zustand: gesichert });
  assert.equal(fingerabdruck(neu.store.lies()), fingerabdruck(gesichert),
    'die Timeline übersteht das Neuladen bitgleich');
  assert.equal(neu.ask.stand().wartet, false, 'keine Frage hängt in der neuen Sitzung');
  assert.equal(neu.store.lies().phases.length, 1);
});

test('Rückfrage: eine abgebrochene Frage kostet kein Budget', async () => {
  const schicht = await createToolLayer({ budget: 1 });

  const erster = schicht.rufe('ask_human', { question: 'Erste Frage?', options: ['a', 'b'] });
  await warteAufFrage(schicht);
  schicht.ask.abbrechen();
  await erster;

  assert.equal(schicht.ask.stand().uebrig, 1, '1 von 1 Frage weiterhin frei');

  const zweiter = schicht.rufe('ask_human', { question: 'Zweite Frage?', options: ['a', 'b'] });
  await warteAufFrage(schicht);
  schicht.ask.antworte(0);
  const antwort = await zweiter;
  assert.ok(!antwort.isError, antwort.content[0].text);
});

test('Rückfrage: erschöpftes Budget meldet mit Zahlen statt zu hängen', async () => {
  const schicht = await createToolLayer({ budget: 1 });

  const erster = schicht.rufe('ask_human', { question: 'Frage eins?', options: ['a', 'b'] });
  await warteAufFrage(schicht);
  schicht.ask.antworte(0);
  await erster;

  const zweiter = await schicht.rufe('ask_human', { question: 'Frage zwei?', options: ['a', 'b'] });
  assert.ok(zweiter.isError);
  assert.match(zweiter.content[0].text, /1 von 1 Fragen/);
});

test('Rückfrage: Budget 0 schaltet ask_human ab, die Pflichtbestätigung läuft weiter', async () => {
  const schicht = await createToolLayer({ budget: 0 });

  const abgelehnt = await schicht.rufe('ask_human', { question: 'Geht das?', options: ['a', 'b'] });
  assert.ok(abgelehnt.isError);
  assert.match(abgelehnt.content[0].text, /0 Fragen/);

  // plan.md 6.7 nennt die drei Momente "kein Notausgang" — die Bestaetigung
  // der Absicht muss auch bei Budget 0 gehen.
  const aufruf = schicht.rufe('set_intent', { checks: [{ kind: 'travel', part: 'com', richtung: [0, 0, 1], minHoehe: 1.0 }] });
  await warteAufFrage(schicht);
  schicht.ask.antworte(0);
  const antwort = await aufruf;
  assert.ok(!antwort.isError, antwort.content[0].text);
});

test('Rückfrage: zwei gleichzeitig offene Fragen werden abgelehnt', async () => {
  const schicht = await createToolLayer({});

  const erster = schicht.rufe('ask_human', { question: 'Frage eins?', options: ['a', 'b'] });
  await warteAufFrage(schicht);

  const zweiter = await schicht.rufe('ask_human', { question: 'Frage zwei?', options: ['a', 'b'] });
  assert.ok(zweiter.isError);
  assert.match(zweiter.content[0].text, /1 Frage wartet bereits/);

  schicht.ask.antworte(0);
  await erster;
});
