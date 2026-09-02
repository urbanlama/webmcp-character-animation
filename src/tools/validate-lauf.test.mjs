// Abnahmetests zu dem Auftrag "Zwei Befunde am Werkzeug validate" — beide aus
// einem echten Browserlauf gemeldet und hier je in Positiv- und Negativfall
// festgehalten:
//
//   Befund 1: validate ohne gesetzte Absicht stürzte ab, statt zu antworten
//             ("Werkzeug validate ist abgestürzt, statt zu antworten:
//             Error: Bericht abgelehnt: intent = 0 … übergeben sind 0
//             Parameter, validate beschreibt 0; … schicke die fehlenden
//             Felder mit"). Nach dem Fix ist es eine Fehlerantwort.
//   Befund 2: validate mit Absicht kam nach 5 Minuten nicht zurück
//             (abgebrochen, headless Chromium über Playwright). Gemessen
//             vor dem Fix an derselben Maschine: 0,42 s bis zur Antwort —
//             der Hangt muss am Aufrufkontext liegen, nicht an der Rechnung.
//             Rückfallebene dagegen: das Zeitlimit in registry.js, das jeden
//             hängenden Aufruf nach AUFRUF_MAX_MS mit einer Fehlerantwort
//             beantwortet. Gemessen wird die Dauer der Aufrufe unten mit.
//
// Beide Befunde betreffen die Werkzeugschicht (handlers, registry); der
// Bericht selbst (src/validate/) und der Streifen (src/render/) werden hier
// nicht angefasst — der Bericht wirft weiterhin, das ist seine Aufgabe.
//
// Die Negativfälle sind absichtlich kaputte Fälle, die ROT werden MÜSSEN:
// wird die set_intent-Leitung aus handlers.js ausgebaut, scheitert der erste
// Test (Absturzmeldung statt Fehlerantwort); wird das Zeitlimit aus
// registry.js entfernt, scheitert der letzte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolLayer, KATALOG, INTENT_ARTEN, attrappenPorts } from './index.js';
import { createRegistry, ANTWORT_MAX_BYTES } from './registry.js';
import { berichtTextKompaktFuerTest, VALIDATE_FRAMES_MAX } from './handlers.js';

/**
 * Setzt die Absicht. Ohne Rueckfrage: set_intent fragt den Menschen nicht mehr.
 *
 * Vorher stand hier eine Warteschleife auf die Pflichtbestaetigung. Sie lief
 * nach dem Ausbau der Rueckfrage endlos — der Testlauf blieb bei 120 Sekunden
 * haengen, obwohl alle Zusicherungen gruen waren. Ein Test, der auf etwas
 * wartet, das es nicht mehr gibt, meldet keinen Fehler; er meldet gar nichts.
 */
async function setzeAbsicht(s, checks) {
  return s.rufe('set_intent', { checks });
}

/** Baut eine Schicht und legt die Timeline für validate bereit. */
async function schichtMitTimeline({ mitAbsicht = false } = {}) {
  const s = await createToolLayer({});
  await s.rufe('set_duration', { frameCount: 60 });
  await s.rufe('add_phase', { verb: 'crouch', from: 0, to: 12, params: {} });
  await s.rufe('add_phase', { verb: 'takeoff', from: 12, to: 18, params: { vy: 4.2 } });
  if (mitAbsicht) {
    await setzeAbsicht(s, [{ kind: 'airtime', minSek: 0.4 }]);
  }
  return s;
}

// ── Befund 1: validate ohne Absicht antwortet, statt abzustürzen ────────────

test('validate ohne Absicht: prueft trotzdem und nennt set_intent als Ergaenzung', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });

  const antwort = await schicht.rufe('validate', {});

  // Frueher war das hier eine Verweigerung mit Verweis auf set_intent. Im
  // Agentenlauf war das eine Sackgasse: set_intent wartet auf einen Menschen,
  // und ohne Menschen kam der Agent nie zu einer Pruefung. Physik und Stil
  // brauchen aber gar keine Absicht — geprueft wird jetzt, und der Text sagt,
  // welche Schicht ausgelassen wurde.
  const text = antwort.content?.[0]?.text ?? '';
  assert.match(text, /0 Absichtskriterien/,
    'der Bericht nennt die Zahl der Kriterien');
  assert.match(text, /set_intent/,
    'und nennt das Werkzeug, mit dem die Absichtsschicht dazukommt');
  assert.doesNotMatch(text, /beschreibt 0/,
    'die sinnlose Meldung "uebergeben sind 0 Parameter, validate beschreibt 0" steht nicht');
});

test('validate ohne Absicht, Negativfall: dieselbe Prüfung fängt eine kaputte Meldung', async () => {
  // Gegenprobe des Prüfers: wäre die Meldung leer oder riet sie zur
  // Nachlieferung von Feldern, müsste dieser Test scheitern — so wie die
  // echte Antwort es vor dem Fix tat.
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });

  const antwort = await schicht.rufe('validate', {});
  const text = antwort.content[0].text;

  const maengel = [];
  if (!/\d/.test(text)) maengel.push('nennt keine Zahl');
  if (!/set_intent/.test(text)) maengel.push('nennt nicht set_intent');
  if (/fehlende[n]? Feld(er)?/.test(text) && !/set_intent/.test(text)) {
    maengel.push('riet zur Nachlieferung statt zum vorangehenden Aufruf');
  }
  assert.deepEqual(maengel, [],
    `die Fehlerantwort trägt ${maengel.length} Mängel: ${maengel.join(', ')} — Text: "${text}"`);
});

test('validate ohne Absicht antwortet schnell und reißt den Zustand nicht mit', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });

  const t0 = performance.now();
  const antwort = await schicht.rufe('validate', {});
  const dauerMs = performance.now() - t0;

  // Nicht mehr auf isError geprueft: ohne Absicht wird jetzt geprueft statt
  // abgewiesen. Was der Test sichert, ist die Dauer und dass ein Aufruf ohne
  // Absicht die Timeline nicht anfasst.
  assert.ok(antwort.content?.[0]?.text, 'es kommt eine Antwort mit Text');
  assert.ok(dauerMs < 1000,
    `die Antwort kam nach ${Math.round(dauerMs)} ms; ein Aufruf haengt nicht`);
  assert.equal(schicht.store.lies().phases.length, 0,
    'validate aendert die Timeline nicht');
  assert.equal(schicht.store.lies().intent, null,
    'und legt keine Absicht an');
});

// ── Befund 2: validate mit Absicht kommt in Sekunden zurück ─────────────────

// Die gemessene Dauer hängt am Modell (Bildstreifen). Ohne angeschlossene
// Ports scheitert validate an der fehlenden Messung — auch das ist eine
// Antwort in Millisekunden, kein Hängen. Der harte Beweis für die Dauer mit
// Xbot läuft im Browser (tools/browser-test.mjs, Abschnitt "validate").

test('validate mit Absicht ohne Ports: Antwort in Millisekunden, kein Hängen', async () => {
  const schicht = await createToolLayer({});
  await schicht.rufe('set_duration', { frameCount: 60 });
  await setzeAbsicht(schicht, [{ kind: 'airtime', minSek: 0.4 }]);

  const t0 = performance.now();
  const antwort = await schicht.rufe('validate', {});
  const dauerMs = performance.now() - t0;

  // Ohne Modell meldet der lebende Anschluss "0 Modelle geladen" — eine
  // Antwort in Millisekunden — und sie sagt, dass nichts vermessen ist.
  // Frueher war das hier eine Fehlerantwort, aber aus dem falschen Grund: die
  // Pflichtbestaetigung von set_intent lief ins Zeitlimit, die Absicht wurde
  // nie gesetzt, und validate verweigerte mit "0 Absichtskriterien". Seit die
  // Bestaetigung beantwortet wird, laeuft validate durch und liefert den
  // Bericht der Attrappe — der benennt sich selbst als Attrappe.
  const berichtText = antwort.content?.[0]?.text ?? '';
  assert.match(berichtText, /attrappe/i,
    `ohne Modell muss der Bericht sich als Attrappe zu erkennen geben, war: "${berichtText}"`);
  assert.match(berichtText, /\d/, 'die Antwort nennt eine Zahl');
  assert.ok(dauerMs < 1000,
    `validate mit Absicht kam nach ${Math.round(dauerMs)} ms zurück; ein Aufruf hängt nicht`);
});

// ── Das Zeitlimit in registry.js (Rückfallebene zu Befund 2) ─────────────────

// Geprüft wird das Verhalten, nicht die Wanduhr: der Aufruf muss mit einer
// Fehlerantwort enden, statt ewig zu hängen. Mit dem echten Wert dauerte dieser
// eine Test 20 s und war damit allein für zwei Drittel der Laufzeit der
// gesamten Testsuite verantwortlich. Der Wert kommt jetzt über createRegistry
// herein; der echte Wert wird eine Zeile weiter unten trotzdem geprüft, damit
// niemand ihn im Produktivpfad auf Minuten stellen kann.
const ZEITLIMIT_TEST_MS = 50;

test('Zeitlimit: ein hängender Aufruf kommt nach AUFRUF_MAX_MS mit Fehlerantwort zurück',
  // Ohne Zeitlimit in registry.js hinge dieser Test ewig — und ein Test, der
  // hängt, meldet keinen Fehler, er meldet gar nichts. Die Grenze macht den
  // ausgebauten Fall rot statt still.
  { timeout: 5000 }, async () => {
  const registry = createRegistry({ aufrufMaxMs: ZEITLIMIT_TEST_MS });
  const { AUFRUF_MAX_MS } = await import('./registry.js');

  // Der Produktivwert selbst: er wird hier nicht abgewartet, aber geprüft.
  assert.ok(AUFRUF_MAX_MS >= 1000 && AUFRUF_MAX_MS <= 60000,
    `AUFRUF_MAX_MS = ${AUFRUF_MAX_MS} ms liegt außerhalb des gemessenen Rahmens `
    + '(1000..60000 ms): validate dauert gemessen 0,42 s; der Wert ist also '
    + 'entweder zu knapp oder so groß, dass der Agent wieder Minuten wartet');

  let laeuftNoch = true;
  await registry.registriere({
    name: 'haengt',
    description: 'Attrappe fuer die Zeitlimitpruefung: laeuft absichtlich in Minuten. '
      + 'Bezugssystem: keins, Einheiten: keine.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      await new Promise(() => {}); // läuft bewusst ewig
    }
  });

  const t0 = Date.now();
  const antwort = await registry.rufe('haengt', {});
  const dauerMs = Date.now() - t0;

  assert.equal(antwort.isError, true,
    `der hängende Aufruf muss als Fehler enden, war: "${antwort.content?.[0]?.text}"`);
  assert.ok(dauerMs >= ZEITLIMIT_TEST_MS * 0.9 && dauerMs <= ZEITLIMIT_TEST_MS + 2000,
    `die Antwort kam nach ${dauerMs} ms, erwartet nahe ${ZEITLIMIT_TEST_MS} ms`);
  laeuftNoch = false;
  assert.equal(laeuftNoch, false);
});

test('Zeitlimit, Negativfall: ein Aufruf unter der Grenze merkt davon nichts', async () => {
  const registry = createRegistry({});
  await registry.registriere({
    name: 'schnell',
    description: 'Attrappe fuer die Zeitlimitpruefung: antwortet sofort. '
      + 'Bezugssystem: keins, Einheiten: keine.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() { return { content: [{ type: 'text', text: 'fertig in 1 Schritt' }] }; }
  });
  const antwort = await registry.rufe('schnell', {});
  assert.equal(antwort.isError, undefined,
    `ein schneller Aufruf darf keine Fehlerantwort bekommen, war: "${antwort.content?.[0]?.text}"`);
});

// ── Der Katalog behält beschreibungsfreie validate-Parameter ────────────────

test('validate bleibt parameterlos: 0 Parameter im Schema, aber 18 Werkzeuge im Katalog', () => {
  const validate = KATALOG.find((t) => t.name === 'validate');
  assert.ok(validate, 'validate steht im Katalog');
  assert.equal(Object.keys(validate.inputSchema?.properties ?? {}).length, 0,
    'validate beschreibt 0 Parameter — der Agent muss keine Felder nachschicken');
});

// ── Antwortgröße: Text und Bild bleiben unter der 512-KB-Grenze ─────────────
// Gemessen an Xbot (Browserlauf, spikes/tmp-validate-messung.mjs): 12 Frames
// × 2 Ansichten ergaben 527 KB und die Antwort wurde abgewiesen, NACHDEM
// gerechnet war. Die Kürzung berichtTextKompakt schreibt den Bericht zuerst
// kompakt, dann ohne issue-Listen — nichts verschwindet still.

const einKleinesBild = [{ data: 'A'.repeat(1024), mimeType: 'image/png' }];

test('Kürzung: kleiner Bericht wird unverändert pretty geliefert', () => {
  const bericht = { frameCount: 60, physics: { passed: true, issues: [] } };
  const text = berichtTextKompaktFuerTest(bericht, einKleinesBild);
  assert.equal(text, JSON.stringify(bericht, null, 2),
    'solange Text + Bild unter der Grenze liegen, bleibt es beim pretty-JSON');
});

test('Kürzung, Positivfall: großer Bericht mit großem Bild kommt kompakt und nennt den Grund', () => {
  // 200 Issues machen pretty deutlich größer als kompakt (gemessen: pretty
  // 29 429 Byte, kompakt 16 581 Byte, Differenz 12 848). Damit der Test die
  // erste Stufe — bloß kompakt statt pretty, Issues bleiben ganz drin —
  // erreicht, muss das Bild in das Fenster zwischen 524288 − pretty und
  // 524288 − kompakt liegen, also zwischen 494 859 und 507 707 Byte. Das
  // ursprüngliche 505-KB-Bild fiel mit 517 120 Byte JENSEITS des Fensters und
  // zwang die Testannahme in die dritte Stufe (Issues ganz weg), die von der
  // Aussage her anders lautet — gemessen, nicht geschätzt, siehe
  // "Kürzung, Negativfall" unten, derselbe Bildwert.
  const grossesBild = [{ data: 'A'.repeat(495 * 1024), mimeType: 'image/png' }];
  const bericht = {
    frameCount: 60,
    physics: {
      passed: false,
      issues: Array.from({ length: 200 }, (_, i) => (
        { kind: 'boden', frame: i, value: 0.0591, unit: 'm', part: 'Mixamorig:LeftFoot' })),
    },
    style: { passed: true, issues: [] },
  };
  const text = berichtTextKompaktFuerTest(bericht, grossesBild);
  const gesamt = new TextEncoder().encode(text).length + grossesBild[0].data.length;
  assert.ok(gesamt <= ANTWORT_MAX_BYTES,
    `kompakter Text (${Math.round(gesamt / 1024)} KB mit Bild) muss unter `
    + `${ANTWORT_MAX_BYTES / 1024} KB liegen`);
  assert.match(text, /ohne Einrückung/,
    'die Kürzung wird laut genannt — nichts verschwindet still');
  assert.match(text, /"issues"/, 'die Issues selbst bleiben in der Fassung');
});

test('Kürzung, Negativfall: ein zu kleiner Text wird nicht als kompakt gemeldet', () => {
  const grossesBild = [{ data: 'A'.repeat(505 * 1024), mimeType: 'image/png' }];
  const bericht = { frameCount: 60, physics: { passed: true, issues: [] } };
  const text = berichtTextKompaktFuerTest(bericht, grossesBild);
  // Passt der kompakte Bericht mit dem Bild unter die Grenze, darf die Meldung
  // "verworfen" nicht erscheinen — sie gehört nur in die tiefere Stufe.
  assert.doesNotMatch(text, /verworfen/,
    'die tiefere Kürzungsstufe darf nur greifen, wenn auch kompakt zu groß ist');
});

test('VALIDATE_FRAMES_MAX liegt unter dem 12-Frame-Maximum des Streifens', () => {
  assert.ok(VALIDATE_FRAMES_MAX >= 1 && VALIDATE_FRAMES_MAX < 12,
    `VALIDATE_FRAMES_MAX = ${VALIDATE_FRAMES_MAX}: mindestens 1 Frame, aber unter den `
    + '12 Frames, deren Base64-Bild die gemessene 512-KB-Grenze sprengt');
});