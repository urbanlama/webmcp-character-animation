// Abnahmetest AP7 — "Registrierung", docs/umsetzung.md.
//
// Positivfall: 18 Werkzeuge sind ueber getTools() sichtbar.
// Negativfall: ein Werkzeug ohne Beschreibung wird abgelehnt.
//
// Der zweite Block prueft die Fehlerform (Auftrag "Zwei verschiedene
// Fehlerformen — vereinheitlichen"): ein abgelehnter Aufruf kam ueber
// document.modelContext als geworfene Ausnahme an, ueber den internen
// rufe()-Pfad als Antwort mit isError. Genau der erste Weg ist der Weg des
// Agenten in der Bewertung.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer } from './index.js';
import { createRegistry, BESCHREIBUNG_MIN } from './registry.js';
import { createModelContextStub } from './model-context-stub.js';
import { KATALOG, KATALOG_GROESSE, KATALOG_SICHTBAR, KISTE } from './catalog.js';
import { WerkzeugFehler, WerkzeugMeldung } from './errors.js';

test('Registrierung: nur die Werkzeuge ausserhalb der Kiste sind sichtbar', async () => {
  const modelContext = createModelContextStub();
  const schicht = await createToolLayer({ modelContext });

  // Die Werkzeugkiste ist standardmaessig aus (KISTE in catalog.js): der Agent
  // sieht sie nicht, sonst baut er keine eigene Haltung mehr.
  assert.equal(schicht.getTools().length, KATALOG_SICHTBAR.length);
  assert.equal(modelContext.getTools().length, KATALOG_SICHTBAR.length);
  assert.equal(KATALOG_GROESSE - KISTE.length, KATALOG_SICHTBAR.length,
    `${KISTE.length} Werkzeuge in der Kiste, ${KATALOG_GROESSE} im Katalog`);

  const namen = modelContext.getTools().map((t) => t.name);
  assert.deepEqual(namen, KATALOG_SICHTBAR.map((t) => t.name),
    'Namen und Reihenfolge wie im sichtbaren Katalog');
  for (const k of KISTE) {
    assert.ok(!namen.includes(k), `${k} gehoert in die Kiste und darf nicht sichtbar sein`);
  }
});

test('Registrierung: jede sichtbare Beschreibung nennt Zweck und ist nicht leer', async () => {
  const schicht = await createToolLayer({});
  for (const t of schicht.getTools()) {
    assert.ok(t.description.trim().length >= BESCHREIBUNG_MIN,
      `${t.name}: Beschreibung hat ${t.description.trim().length} Zeichen, `
      + `verlangt sind ${BESCHREIBUNG_MIN}`);
    assert.equal(t.inputSchema.type, 'object', `${t.name}: inputSchema.type`);
    assert.ok(t.execute === undefined, `${t.name}: execute darf nicht sichtbar sein`);
  }
});

test('Registrierung, Negativfall: ein Werkzeug ohne Beschreibung wird abgelehnt', async () => {
  const modelContext = createModelContextStub();
  const registry = createRegistry({ modelContext });

  const ohne = {
    name: 'kaputt',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() { return 'egal'; }
  };

  await assert.rejects(() => registry.registriere(ohne), (e) => {
    assert.ok(e instanceof WerkzeugFehler, 'meldet als WerkzeugFehler');
    assert.match(e.message, /Beschreibung/, 'nennt die Beschreibung als Grund');
    assert.match(e.message, /\d/, 'nennt eine Zahl');
    return true;
  });

  // Nichts ist durchgerutscht — weder intern noch im Browser.
  assert.equal(registry.anzahl(), 0);
  assert.equal(modelContext.getTools().length, 0);
});

test('Registrierung, Negativfall: leere und zu dünne Beschreibungen ebenso', async () => {
  const registry = createRegistry({});
  const grundgeruest = {
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() { return 'egal'; }
  };

  const faelle = [
    { ...grundgeruest, name: 'leer', description: '' },
    { ...grundgeruest, name: 'blank', description: '                                              ' },
    { ...grundgeruest, name: 'kurz', description: 'macht was' },
    { ...grundgeruest, name: 'keinText', description: 42 }
  ];

  for (const f of faelle) {
    await assert.rejects(() => registry.registriere(f), WerkzeugFehler, `Fall ${f.name}`);
  }
  assert.equal(registry.anzahl(), 0, `0 von ${faelle.length} kaputten Werkzeugen registriert`);
});

test('Registrierung: Aufruf über die gemessene WebMCP-Form executeTool(name, jsonString)', async () => {
  const modelContext = createModelContextStub();
  await createToolLayer({ modelContext });

  const roh = await modelContext.executeTool('set_duration', JSON.stringify({ frameCount: 90 }));
  const antwort = JSON.parse(roh);
  assert.equal(antwort.content[0].type, 'text');
  assert.match(antwort.content[0].text, /90 Frames/);
});

// --- Fehlerform: zwei Wege, eine Antwort -------------------------------------
//
// Was die drei Abnahmezeilen des Auftrags pruefen: Gleiche Form, Keine
// Ausnahme, Zahl erhalten. Der Vollstaendigkeit halber wird jeder Fall auf
// allen drei Zugriffen geprüft, die es gibt: das registrierte execute selbst,
// der interne rufe()-Pfad und executeTool(name, jsonString) — die gemessene
// Form, ueber die der Agent im ChatGPT-Browser geht.

/** Fuhrt etwas aus und merkt sich, ob es stattdessen geworfen hat. */
async function hole(ruft) {
  try {
    return { warf: false, antwort: await ruft() };
  } catch (e) {
    const meldung = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { warf: true, meldung };
  }
}

/** Was eine brauchbare Fehlerantwort ausmacht. Leere Liste = brauchbar. */
function maengel(antwort) {
  if (antwort === null || typeof antwort !== 'object') return ['gar keine Antwort'];
  const m = [];
  if (antwort.isError !== true) m.push('nicht als Fehler markiert');
  const t = antwort.content && antwort.content[0] && antwort.content[0].text;
  if (typeof t !== 'string' || t.length < 30) {
    m.push(`kein brauchbarer Text (${typeof t === 'string' ? `${t.length} Zeichen` : 'fehlt'})`);
  } else if (!/\d/.test(t)) {
    m.push('Meldung ohne Zahl');
  }
  return m;
}

/** Beschreibung über der Mindestlänge, damit die Attrappe sich registrieren lässt. */
function beschreibung(fall) {
  return `Attrappe fuer die Abnahme der Fehlerform (${fall}): wirft beim Aufruf absichtlich `
    + 'und antwortet sonst nicht. Bezugssystem: keins, Einheiten: keine.';
}

test('Fehlerform, Gleiche Form: abgelehnter Aufruf antwortet über document.modelContext wie intern', async () => {
  const modelContext = createModelContextStub();
  const schicht = await createToolLayer({ modelContext });
  const args = { frameCount: 3 };

  const intern = await hole(() => schicht.rufe('set_duration', args));
  const kontext = await hole(() =>
    modelContext.executeTool('set_duration', JSON.stringify(args)));

  assert.equal(intern.warf, false, `der interne Pfad warf: ${intern.meldung}`);
  assert.equal(kontext.warf, false, `document.modelContext warf: ${kontext.meldung}`);

  const antwort = JSON.parse(kontext.antwort);
  assert.equal(antwort.isError, true, 'abgelehnt muss als Fehler zu erkennen sein');
  assert.deepEqual(antwort, intern.antwort,
    'derselbe Fehler muss auf beiden Wegen bitgleich antworten');
  assert.deepEqual(maengel(antwort), [], `Meldung: ${antwort.content[0].text}`);
});

test('Fehlerform, Keine Ausnahme: was im Werkzeug fliegt, kommt als Antwort zurück', async () => {
  const modelContext = createModelContextStub();
  const registry = createRegistry({ modelContext });
  const schema = {
    type: 'object',
    properties: { frame: { type: 'number' }, text: { type: 'string' } },
    required: ['text']
  };

  const faelle = [
    {
      name: 'lehnt_ab',
      grund: 'abgelehnte Eingabe',
      async execute() {
        throw new WerkzeugFehler({
          tool: 'lehnt_ab', param: 'frame', value: 970,
          range: 'ganze Zahl von 0 bis 90',
          next: 'setze die Länge zuerst mit set_duration'
        });
      }
    },
    {
      name: 'kracht',
      grund: 'Programmfehler',
      async execute() {
        throw new TypeError('kann tiefliegende Felder nicht lesen');
      }
    },
    {
      name: 'nackt',
      grund: 'Wurf ohne Fehlerobjekt',
      async execute() {
        throw 'zeitsprung fehlgeschlagen';
      }
    }
  ];

  for (const f of faelle) {
    const eintrag = await registry.registriere({
      name: f.name,
      description: beschreibung(f.grund),
      inputSchema: schema,
      execute: f.execute
    });

    const wege = [
      ['registriertes execute', await hole(() => eintrag.execute({ frame: 12 }))],
      ['rufe()', await hole(() => registry.rufe(f.name, { frame: 12 }))],
      ['executeTool()', await hole(() =>
        modelContext.executeTool(f.name, JSON.stringify({ frame: 12 })))]
    ];

    const antworten = [];
    for (const [weg, erg] of wege) {
      assert.equal(erg.warf, false,
        `${f.name} (${f.grund}) über ${weg}: Ausnahme erreicht den Aufrufer — ${erg.meldung}`);
      const antwort = weg === 'executeTool()' ? JSON.parse(erg.antwort) : erg.antwort;
      assert.deepEqual(maengel(antwort), [],
        `${f.name} über ${weg}: ${maengel(antwort).join(', ')}\n  Meldung: ${antwort.content?.[0]?.text}`);
      antworten.push(antwort);
    }

    assert.deepEqual(antworten[1], antworten[0], `${f.name}: drei Wege, eine Antwort`);
    assert.deepEqual(antworten[2], antworten[0], `${f.name}: drei Wege, eine Antwort`);

    const text = antworten[0].content[0].text;
    assert.equal(antworten[0].isError, true, `${f.name}: als Fehler markiert`);
    if (f.name === 'kracht') {
      assert.match(text, /kann tiefliegende Felder nicht lesen/,
        'die ursprüngliche Meldung bleibt lesbar beim Agenten');
    }
    if (f.name === 'nackt') {
      assert.match(text, /zeitsprung fehlgeschlagen/, 'auch ein nackter Wurf verliert seinen Text nicht');
    }
    if (f.name === 'lehnt_ab') {
      assert.doesNotMatch(text, /übergeben sind \d+ Parameter/,
        'der widersprüchliche Parametervergleich aus dem alten Absturztext '
          + '(Befund 1, „übergeben sind 0 Parameter, validate beschreibt 0") steht nicht mehr drin');
     }
  }
});

test('Fehlerform, Zahl erhalten: jede Meldung der Stichprobe kommt über document.modelContext vollständig an', async () => {
  const modelContext = createModelContextStub();
  // Mit Kiste: die Stichprobe prueft die FORM der Fehlermeldungen, auch die der
  // Kistenwerkzeuge. Ihre Sichtbarkeit prueft der Test weiter oben.
  const schicht = await createToolLayer({ modelContext, werkzeugkiste: true });
  await schicht.rufe('set_duration', { frameCount: 90 });

  const faelle = [
    ['Länge unter dem Minimum', 'set_duration', { frameCount: 3 }],
    ['unbekanntes Verb', 'add_phase', { verb: 'backflip', from: 0, to: 10, params: {} }],
    ['Frame außerhalb der Timeline',
      'set_joint', { frame: 640, joint: 'head', angleDeg: 12, channel: 'bend' }],
    ['Phase endet vor ihrem Anfang', 'add_phase', { verb: 'stand', from: 30, to: 20, params: {} }],
    ['unbekannte Phasen-Id', 'edit_phase', { id: 'p99', to: 20 }],
    ['unbekannter Kanal',
      'set_joint', { frame: 10, joint: 'head', angleDeg: 5, channel: 'wobble' }],
    ['Zielpunkt mit zwei statt drei Werten', 'set_target', { frame: 10, part: 'com', pos: [0, 1] }],
    ['Winkel außerhalb des Prüfbereichs', 'probe_joint', { joint: 'hip_l', angleDeg: 200 }],
    ['unbekannte Ansicht', 'look', { frames: [0, 10], views: ['isometrisch'] }],
    ['zu wenige Antwortmöglichkeiten', 'ask_human', { question: 'Weiter?', options: ['ja'] }],
    ['Absichtskriterium unbekannter Art', 'set_intent', { checks: [{ kind: 'stimmung' }] }]
  ];
  assert.ok(faelle.length >= 10, `${faelle.length} Fälle, verlangt sind mindestens 10`);

  const ohneZahl = [];
  const verluste = [];
  for (const [grund, name, args] of faelle) {
    const intern = await hole(() => schicht.rufe(name, args));
    const kontext = await hole(() => modelContext.executeTool(name, JSON.stringify(args)));

    assert.equal(intern.warf, false, `${grund}: der interne Pfad warf (${intern.meldung})`);
    assert.equal(kontext.warf, false, `${grund}: document.modelContext warf (${kontext.meldung})`);

    const antwort = JSON.parse(kontext.antwort);
    const text = antwort.content[0].text;
    if (!/\d/.test(text)) ohneZahl.push(grund);
    if (text !== intern.antwort.content[0].text) {
      verluste.push(`${grund}: intern "${intern.antwort.content[0].text}" / Agent "${text}"`);
    }
    assert.equal(antwort.isError, true, `${grund}: muss als Fehler gekennzeichnet sein`);
  }

  assert.deepEqual(ohneZahl, [],
    `${ohneZahl.length} von ${faelle.length} Meldungen nennen keine Zahl: ${ohneZahl.join(', ')}`);
  assert.deepEqual(verluste, [],
    `${verluste.length} von ${faelle.length} Meldungen kommen nicht vollständig an:\n  `
    + verluste.join('\n  '));
});

test('Fehlerform: eine Meldung ohne Zahl bleibt nicht ohne Zahl', async () => {
  const registry = createRegistry({});
  await registry.registriere({
    name: 'ohne_zahl',
    description: beschreibung('Meldung ohne jede Ziffer'),
    inputSchema: {
      type: 'object',
      properties: { dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' } },
      required: ['dx']
    },
    async execute() {
      throw new WerkzeugMeldung({
        tool: 'ohne_zahl', param: 'dx', value: 'schnurz',
        range: 'eine Zahl', next: 'schicke eine Zahl statt eines Textes',
        message: 'die Eingabe ist ungültig, bitte erneut versuchen'
      });
    }
  });

  const a = await registry.rufe('ohne_zahl', { dx: 'schnurz' });
  const text = a.content[0].text;
  assert.equal(a.isError, true);
  assert.match(text, /die Eingabe ist ungültig, bitte erneut versuchen/,
    'der ursprüngliche Satz bleibt stehen');
  assert.match(text, /\d/, 'die fehlende Zahl wird nachgereicht');
  assert.match(text, /1 Aufruf|1 Antwort/, 'genannt wird, was der Aufruf hatte und verlangt ist');
});

test('Fehlerform, Negativfall des Prüfers: maengel() fällt auf eine schlechte Antwort herein? Nein', () => {
  assert.deepEqual(
    maengel({ isError: true, content: [{ type: 'text', text: 'die Eingabe ist ungültig, bitte erneut versuchen' }] }),
    ['Meldung ohne Zahl'], 'eine Meldung ohne Ziffer wird beanstandet');
  assert.deepEqual(
    maengel({ content: [{ type: 'text', text: 'Antwort 1 sagt dem Agenten leider nichts Hilfreiches' }] }),
    ['nicht als Fehler markiert'], 'eine Antwort ohne isError wird beanstandet');
  assert.deepEqual(maengel(null), ['gar keine Antwort'], 'keine Antwort wird beanstandet');
  assert.deepEqual(
    maengel({ isError: true, content: [{ type: 'text', text: 'frame 970 liegt außerhalb von 0 bis 90' }] }),
    [], 'eine gute Meldung durchläuft den Prüfer');
});
