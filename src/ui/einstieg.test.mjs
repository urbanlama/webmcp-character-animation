// Die Erstsicht (docs/plan.md 6.1) in Node geprüft.
//
// Das Repo hat keinen DOM-Shim (weder jsdom noch linkedom in package.json —
// und package.json darf nicht angefasst werden). Deshalb folgt der Test dem
// vorhandenen Muster des Projekts, wie in src/ui/rollen.test.mjs: das Modul
// bekommt seine Abhängigkeiten als Anschlüsse herein, und in Node wird
// gegen eine winzige DOM-Attrappe geprüft, die die drei vom Modul benutzten
// Aufrufe (createElement, replaceChildren, textContent) nachstellt. Die echte
// DOM-Hälfte — Klick, Layout, sichtbare Seite — prüft tools/browser-test.mjs.
//
// ladeBeispielDatei braucht fetch und File; Node 24 hat beide von sich aus.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mounteEinstieg, ladeBeispielDatei } from './einstieg.js';

/**
 * Mini-DOM: ein Element mit Kindlisten, so viel wie das Modul braucht.
 * Nicht attraktiv, nur klein — das echte Layout prüft der Browsertest.
 */
function element(tag) {
  const kinder = [];
  const daten = { textContent: '', hidden: undefined };
  return {
    tagName: tag.toUpperCase(),
    ownerDocument: { createElement: (t) => element(t) },
    setAttribute() {},
    addEventListener(art, fn) { daten[`an_${art}`] = fn; },
    replaceChildren(...neu) { kinder.length = 0; kinder.push(...neu); },
    appendChild(k) { kinder.push(k); },
    append(...k) { kinder.push(...k); },
    get children() { return kinder; },
    get firstChild() { return kinder[0] ?? null; },
    dispatch(art) { daten[`an_${art}`]?.(); },
    get textContent() {
      return daten.textContent
        + kinder.map((k) => k.textContent).join('');
    },
    set textContent(v) { daten.textContent = v; },
    get hidden() { return daten.hidden; },
    set hidden(v) { daten.hidden = v; },
  };
}

/** Hält fest, welche Sätze für die Erstsicht und für die Schritte gebaut wurden. */
function aufbauLesen(wurzel, spalte) {
  const name = (e) => (e.tagName === 'H1' ? 'titel' : e.tagName === 'H2' ? 'spaltenTitel'
    : e.id === 'einstieg-satz' ? 'satz' : e.id === 'einstieg-beispiel' ? 'knopf'
    : e.id === 'einstieg-messung' ? 'messung' : 'unbekannt');
  const nachId = (liste) => Object.fromEntries(liste.map((e) => [name(e), e]));
  return { liste: nachId([...wurzel.children]), spalte: [...spalte.children] };
}

test('Erstsicht, Positivfall: Titel, Satz, Knopf und 3 nummerierte Schritte stehen', () => {
  const wurzel = element('div');
  const spalte = element('section');
  let angefordert = 0;
  mounteEinstieg({
    wurzel, spalte,
    async dateiLaden() { angefordert += 1; return { name: 'Xbot.glb', arrayBuffer: async () => new ArrayBuffer(2) }; },
  });

  const aufbau = aufbauLesen(wurzel, spalte);
  const satzWerte = [aufbau.liste.titel.textContent, aufbau.liste.satz.textContent];
  assert.ok(satzWerte.every((t) => t.length > 5),
    `Überschrift und Satz müssen Substanz haben: "${aufbau.liste.titel.textContent}" `
    + `und "${aufbau.liste.satz.textContent}"`);
  assert.ok(aufbau.liste.satz.textContent.toLowerCase().includes('agent'),
    `der Satz muss den Agenten nennen, war: "${aufbau.liste.satz.textContent}"`);

  assert.equal(aufbau.liste.knopf.tagName, 'BUTTON',
    `der Beispieleinstieg muss ein Knopf sein, ist ${aufbau.liste.knopf.tagName}`);
  assert.match(aufbau.liste.knopf.textContent, /example/i,
    `der Knopf muss das Beispiel nennen, war: "${aufbau.liste.knopf.textContent}"`);

  // Die Schritte-Spalte: Titel + nummerierte Liste mit 3 Punkten.
  const liste = aufbau.spalte.find((e) => e.tagName === 'OL');
  assert.ok(liste, `eine nummerierte Liste muss in der Spalte stehen, es stehen ${aufbau.spalte.length} Elemente`);
  const punkte = liste.children;
  assert.equal(punkte.length, 3, `3 Schritte erwartet, es stehen ${punkte.length}`);
  const nummern = punkte.map((p) => p.children.find((k) => k.className === 'einstieg-nr').textContent);
  assert.deepEqual(nummern, ['1', '2', '3'], `nummeriert 1 bis 3 erwartet, waren: ${nummern.join(', ')}`);
  const texte = punkte.map((p) => p.textContent);
  // Die Schritte folgen dem, was der Mensch wirklich tun muss. Das Modell
  // laedt beim Start von selbst; ein Schritt "lade einen Charakter" schickte
  // ihn zu einem Knopf, der nichts mehr tut.
  assert.match(texte[0], /ChatGPT|chrome|enable-webmcp/i,
    `Schritt 1 muss den WebMCP-Weg nennen, war: "${texte[0]}"`);
  assert.match(texte[0], /149/,
    `Schritt 1 muss die Chrome-Version nennen, war: "${texte[0]}"`);
  assert.match(texte[1], /agent|move|jump/i,
    `Schritt 2 muss zum Auftrag an den Agenten führen, war: "${texte[1]}"`);
  assert.match(texte[2], /slider|clip|watch/i,
    `Schritt 3 muss sagen, wie man zusieht und das Ergebnis bekommt, war: "${texte[2]}"`);

  assert.deepEqual([...wurzel.children].filter((e) => e.id === 'einstieg-messung').map((e) => e.hidden), [true],
    'die Messzeile steht bereit, ist vor dem ersten Vermessen aber verborgen, 0 sichtbar');
  assert.equal(angefordert, 0, 'vor dem Klick sind 0 Dateien angefordert');
});

test('Erstsicht, Positivfall: der Klick ruft den einen Ladepfad mit einem File-Objekt auf', async () => {
  const wurzel = element('div');
  const spalte = element('section');
  // Der Hook, den index.html als window.__ladeDatei freilegt — hier Attrappe.
  const empfangen = [];
  globalThis.window = { __ladeDatei: async (datei) => { empfangen.push(datei); } };
  t_cleanup(() => { delete globalThis.window; });

  mounteEinstieg({
    wurzel, spalte,
    async dateiLaden() {
      return { name: 'Xbot.glb', arrayBuffer: async () => new ArrayBuffer(3) };
    },
  });

  const aufbau = aufbauLesen(wurzel, spalte);
  aufbau.liste.knopf.dispatch('click');
  await new Promise((r) => setImmediate(r));

  assert.equal(empfangen.length, 1, `genau 1 Aufruf des Ladepfads erwartet, waren ${empfangen.length}`);
  assert.match(String(empfangen[0]?.name), /Xbot/,
    `der Ladepfad muss den Dateinamen sehen, war "${empfangen[0]?.name}"`);
});

/** Hilfsfunktion: beseitigt ein globales Fenster nach dem Test. */
function t_cleanup(fn) { process.on('exit', fn); }

test('Erstsicht: setzeGemessen zeigt die Körperhöhe nach dem Vermessen', () => {
  const wurzel = element('div');
  const spalte = element('section');
  const einstieg = mounteEinstieg({
    wurzel, spalte, async dateiLaden() { throw new Error('im Test nicht gebraucht'); },
  });

  const messZeile = wurzel.children.find((e) => e.id === 'einstieg-messung');
  assert.equal(messZeile.hidden, true, 'vor dem Vermessen steht in der Messzeile nichts');

  einstieg.setzeGemessen('Gemessen: Körperhöhe 1.8093 m, 14 Segmente');
  assert.equal(messZeile.hidden, false, 'nach dem Vermessen muss die Zeile sichtbar werden');
  assert.match(messZeile.textContent, /1\.8093/,
    `die Zeile muss die gemessene Höhe nennen, war: "${messZeile.textContent}"`);
});

test('Erstsicht, Negativfall: ein scheiternder Beispiel-Knopf meldet 404 sichtbar über window.onerror', async () => {
  const wurzel = element('div');
  const spalte = element('section');
  const empfangen = [];
  const gemeldet = [];
  // Mini-Fenster: dispatchEvent reicht ErrorEvent an onerror-Handler weiter —
  // dieselbe Oberfläche, auf der index.html ins Fehlerfeld schreibt.
  globalThis.window = {
    __ladeDatei: async (datei) => { empfangen.push(datei); },
    dispatchEvent(ereignis) {
      window.onerror?.(ereignis.message, '', 0, 0, ereignis.error);
      return true;
    },
    ErrorEvent: class {
      constructor(art, { message, error }) { this.message = message; this.error = error; }
    },
  };
  t_cleanup(() => { delete globalThis.window; });

  mounteEinstieg({
    wurzel, spalte,
    async dateiLaden() {
      throw new Error('Beispielmodell nicht ladbar: HTTP-Status 404 bei beispiel/Xbot.glb');
    },
  });

  window.onerror = (nachricht) => { gemeldet.push(nachricht); };
  const aufbau = aufbauLesen(wurzel, spalte);
  aufbau.liste.knopf.dispatch('click');
  await new Promise((r) => setImmediate(r));

  assert.equal(empfangen.length, 0,
    `nach einem abgelehnten Laden dürfen 0 Modelle ankommen, es waren ${empfangen.length}`);
  assert.equal(gemeldet.length, 1,
    `der Fehler muss 1-fach gemeldet werden, es kamen ${gemeldet.length} an —`
    + ' ein stiller Fehlschlag ist keiner');
  assert.match(gemeldet[0], /404/, 'die Meldung muss die Statuszahl nennen (AGENTS.md)');
  assert.match(gemeldet[0], /beispiel\/Xbot\.glb/, 'die Meldung muss den Pfad nennen');
});

test('Erstsicht, Negativfall: mount ohne Container scheitert mit Zahl', () => {
  assert.throws(
    () => mounteEinstieg({ wurzel: null, spalte: null, dateiLaden() {} }),
    (err) => /0 Container/.test(err.message) && /\d/.test(err.message),
    'die Meldung muss sagen, was fehlt, mit Zahl (AGENTS.md)',
  );
});

test('ladeBeispielDatei, Positivfall: Antwort wird ein File-Objekt mit Name und Inhalt', async () => {
  const inhalte = [];
  globalThis.fetch = async (adresse) => {
    inhalte.push(String(adresse));
    return {
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode('GLB-Attrappe').buffer,
    };
  };

  const datei = await ladeBeispielDatei({
    basisUrl: 'https://example.org/webmcp/',
    pfad: 'beispiel/Xbot.glb',
  });

  assert.match(inhalte[0], /beispiel\/Xbot\.glb$/,
    `der Pfad muss relativ zur Basis aufgelöst werden, war: "${inhalte[0]}"`);
  assert.match(String(datei.name), /Xbot\.glb$/, `der Name muss bleiben, war "${datei.name}"`);
  assert.equal(datei.type, 'model/gltf-binary', `der Typ muss gltf-binary sein, war "${datei.type}"`);
  const bytes = new Uint8Array(await datei.arrayBuffer());
  assert.deepEqual([...bytes].slice(0, 3), [...new TextEncoder().encode('GLB').slice(0, 3)],
    'der Inhalt muss byte-genau ankommen');
});

test('ladeBeispielDatei, Negativfall: ein HTTP-404 scheitert mit URL und Statuszahl', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 });

  await assert.rejects(
    () => ladeBeispielDatei({ basisUrl: 'https://example.org/', pfad: 'beispiel/Xbot.glb' }),
    (err) => {
      assert.match(err.message, /404/, 'die Meldung muss den HTTP-Status nennen');
      assert.match(err.message, /beispiel\/Xbot\.glb/, 'die Meldung muss den Pfad nennen');
      return true;
    },
  );
});