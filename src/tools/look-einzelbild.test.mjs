// Werkzeug `look` — ein Bild je Aufruf, Kamera vom Agenten gerichtet.
//
// Befund vom 2.9.2026 (docs/journal/buehne-befunde-2026-09-02.md, Kapitel 1.1 bis 1.4):
// `look` verlangte zwei Listen (frames × views), deren Produkt unter 12 bleiben
// musste, und lieferte dafür ein Raster, in dem jede Figur fingernagelgroß war.
// Geprüft wird hier die Werkzeugseite des Umbaus:
//
//   Schema    — ein Frame, vier freiwillige Kameraangaben, keine Listen mehr.
//   Antwort   — genau EIN Bild, und die benutzte Kamera in Zahlen.
//   Verlauf   — dass eine Abfolge aus mehreren Aufrufen entsteht, muss im
//               Werkzeugtext UND in der Antwort stehen. Eine Möglichkeit, von
//               der nirgends etwas steht, hat der Agent nicht.
//
// Die Bilder kommen von den Attrappen-Ports: geprüft wird der Vertrag zwischen
// Werkzeug und Renderer, nicht das Rendern selbst (das prüft
// src/render/einzelbild.test.mjs am gemessenen Modell).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer } from './index.js';
import { KATALOG } from './catalog.js';

const lookEintrag = () => KATALOG.find((w) => w.name === 'look');

/** Werkzeugschicht mit gesetzter Timeline — ohne Länge lehnt jedes Werkzeug ab. */
async function schichtMitTimeline(frameCount = 60) {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount });
  return schicht;
}

/** Der Text einer Werkzeugantwort. */
const alsText = (antwort) => antwort.content.filter((c) => c.type === 'text')
  .map((c) => c.text).join('\n');

/** Die Bilder einer Werkzeugantwort. */
const alsBilder = (antwort) => antwort.content.filter((c) => c.type === 'image');

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

test('Schema: look nimmt einen Frame und vier freiwillige Kameraangaben', () => {
  const schema = lookEintrag().inputSchema;
  const felder = Object.keys(schema.properties);

  assert.deepEqual(schema.required, ['frame'],
    `required = ${JSON.stringify(schema.required)}: nur der Frame ist Pflicht, `
    + 'die Kamera hat für jede Angabe eine Voreinstellung');
  assert.deepEqual(felder.sort(),
    ['frame', 'hoehe_grad', 'richtung_grad', 'weite', 'ziel'],
    `look hat die Felder ${felder.join(', ')} — erwartet genau fünf`);
  assert.equal(schema.properties.frame.type, 'integer',
    'frame ist EINE Zahl, keine Liste — ein Aufruf ist ein Bild');
});

test('Schema: die alten Listen frames und views sind weg', () => {
  const schema = lookEintrag().inputSchema;

  assert.equal(schema.properties.frames, undefined,
    'frames-Liste noch im Schema: sie war der Grund für das Raster');
  assert.equal(schema.properties.views, undefined,
    'views-Liste noch im Schema: die Blickrichtung kommt jetzt aus Gradzahlen');
});

test('Beschreibung: der Werkzeugtext sagt, wie der Agent einen Verlauf ansieht', () => {
  const text = lookEintrag().description;

  assert.match(text, /verlauf|abfolge/i,
    `die Beschreibung nennt weder Verlauf noch Abfolge — dann weiß der Agent nicht, `
    + `dass er eine Bewegung ansehen kann:\n"${text}"`);
  assert.match(text, /mehrmals|mehrfach|je Frame|Frame fuer Frame/i,
    'die Beschreibung sagt nicht, dass mehrere Aufrufe den Verlauf ergeben');
});

// ─────────────────────────────────────────────────────────────────────────────
// Antwort
// ─────────────────────────────────────────────────────────────────────────────

test('Aufruf: ein nackter Aufruf mit nur einem Frame liefert genau ein Bild', async () => {
  const schicht = await schichtMitTimeline();
  const antwort = await schicht.rufe('look', { frame: 12 });

  assert.equal(antwort.isError, undefined,
    `look ohne Kameraangaben wurde abgelehnt: ${alsText(antwort)}`);
  assert.equal(alsBilder(antwort).length, 1,
    `${alsBilder(antwort).length} Bilder in der Antwort, erwartet genau 1`);
});

test('Aufruf: die Antwort nennt Frame, Blickrichtung und Weite in Zahlen', async () => {
  const schicht = await schichtMitTimeline();
  const antwort = await schicht.rufe('look',
    { frame: 7, richtung_grad: 135, hoehe_grad: 20, weite: 'nah' });
  const text = alsText(antwort);

  for (const teil of ['7', '135', '20', 'nah']) {
    assert.ok(text.includes(teil),
      `"${teil}" fehlt in der Antwort — ohne die Zahlen kann der Agent zwei Bilder `
      + `nicht zueinander in Beziehung setzen:\n${text}`);
  }
});

test('Aufruf: die Antwort erinnert an den Verlauf über mehrere Aufrufe', async () => {
  const schicht = await schichtMitTimeline();
  const text = alsText(await schicht.rufe('look', { frame: 0 }));

  assert.match(text, /verlauf|abfolge/i,
    `die Antwort erwähnt den Verlauf nicht — der Agent soll bei jedem Bild wissen, `
    + `dass er die Nachbarframes genauso ansehen kann:\n${text}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Ablehnungen — jede nennt eine Zahl (AGENTS.md, Regel 2)
// ─────────────────────────────────────────────────────────────────────────────

test('Ablehnung: unbekannte Weite, Frame außerhalb der Timeline, falscher Winkel', async () => {
  const schicht = await schichtMitTimeline(60);

  const faelle = [
    ['unbekannte Weite', { frame: 0, weite: 'riesig' }],
    ['Frame außerhalb der Timeline', { frame: 640 }],
    ['Blickhöhe über der Grenze', { frame: 0, hoehe_grad: 300 }],
  ];

  for (const [grund, args] of faelle) {
    const antwort = await schicht.rufe('look', args);
    assert.equal(antwort.isError, true, `${grund}: wurde angenommen statt abgelehnt`);
    assert.match(alsText(antwort), /\d/,
      `${grund}: die Meldung nennt keine Zahl — "${alsText(antwort)}"`);
  }
});
