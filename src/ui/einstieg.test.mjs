// Die Anleitungsspalte in Node geprüft.
//
// Das Repo hat keinen DOM-Shim (weder jsdom noch linkedom in package.json —
// und package.json darf nicht angefasst werden). Deshalb folgt der Test dem
// vorhandenen Muster des Projekts, wie in src/ui/rollen.test.mjs: das Modul
// bekommt seine Abhängigkeiten als Anschlüsse herein, und in Node wird
// gegen eine winzige DOM-Attrappe geprüft, die die vom Modul benutzten
// Aufrufe (createElement, replaceChildren, textContent) nachstellt. Die echte
// DOM-Hälfte — Layout, sichtbare Seite — prüft tools/browser-test.mjs.
//
// ladeBeispielDatei braucht fetch und File; Node 24 hat beide von sich aus.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mounteAnleitung, ladeBeispielDatei } from './einstieg.js';

/**
 * Mini-DOM: ein Element mit Kindliste, so viel wie das Modul braucht.
 * Nicht attraktiv, nur klein — das echte Layout prüft der Browsertest.
 */
function element(tag) {
  const kinder = [];
  const daten = { textContent: '' };
  return {
    tagName: tag.toUpperCase(),
    ownerDocument: { createElement: (t) => element(t) },
    setAttribute() {},
    replaceChildren(...neu) { kinder.length = 0; kinder.push(...neu); },
    appendChild(k) { kinder.push(k); },
    append(...k) { kinder.push(...k); },
    get children() { return kinder; },
    get firstChild() { return kinder[0] ?? null; },
    get textContent() {
      return daten.textContent
        + kinder.map((k) => k.textContent).join('');
    },
    set textContent(v) { daten.textContent = v; },
  };
}

test('Anleitung, Positivfall: Titel und 3 nummerierte Schritte stehen', () => {
  const spalte = element('section');
  mounteAnleitung({ spalte });

  const liste = [...spalte.children].find((e) => e.tagName === 'OL');
  assert.ok(liste, `eine nummerierte Liste muss in der Spalte stehen, es stehen ${spalte.children.length} Elemente`);
  const titel = spalte.children.find((e) => e.id === 'einstieg-schritte-titel');
  assert.ok(titel && titel.textContent.length > 3,
    `die Spalte muss einen Titel haben, war: "${titel?.textContent}"`);

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
});

test('Anleitung, Negativfall: mount ohne Container scheitert mit Zahl', () => {
  assert.throws(
    () => mounteAnleitung({ spalte: null }),
    (err) => /0 Spalten-Container/.test(err.message) && /\d/.test(err.message),
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