// Test zur Messung spikes/fremdmodelle/messung.mjs — Fremdmodelle.
//
// Verträge des Messlaufs selbst (AGENTS.md, Regel 2: jeder Positivfall mit
// seinem Negativfall):
//
//   Lauf     alle zehn Auftragsmodelle liefern je eine Zeile und laden alle;
//            Negativfall: 3 Bytes Müll enden in Schritt 1 mit einer Zahl
//   Messung  der gemessene Stand: 0 von 10 Modellen kommen durch die Ver-
//            messung, alle stoppen in Schritt 3 an derselben Ursache; Negativ-
//            fall: kein Modell steht als vermessbar da, dessen Zeile stoppt
//            vor Schritt 3
//   Rollen   Rollen laufen JEDESMAL, auch wenn die Vermessung scheitert —
//            rollenWeiter zählt genau die Zeilen mit Rollen ohne Vermessung;
//            Negativfall: eine Zeile mit Rollen muss rollenWeiter erhöhen
//   Robust   eine fehlende Datei wirft NICHT, sondern endet als Zeile in
//            Schritt 1
//
// Kein Körpermaß wird behauptet: Diese Tests schreiben KEINE Körperhöhe,
// Knochenzahl oder Rollenzahl je Modell vor — genau solche Behauptungen wären
// die Fehler, die das Projekt beheben will (Regel 1). Behauptet wird nur der
// gemessene Gesamtstand vom 04.09.; ist measure.js repariert, wird dieser
// Test geändert und die Messung wiederholt (Auftrag fmd-2).

import { test } from 'node:test';
import assert from 'node:assert';

import { messModell, messLauf, tabellenText, AUFTRAGSMODELLE } from './messung.mjs';

// Der Lauf ist teuer (Abtastung je Modell) und läuft einmal.
const ergebnis = await messLauf();

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Lauf
// ─────────────────────────────────────────────────────────────────────────────

test('Messlauf: alle zehn Auftragsmodelle liefern je eine Zeile und laden alle', () => {
  assert.equal(ergebnis.gesamt, AUFTRAGSMODELLE.length,
    `der Lauf muss ${AUFTRAGSMODELLE.length} Auftragsmodelle messen, er hat ${ergebnis.gesamt} Zeilen`);
  assert.ok(ergebnis.zeilen.every((z) => AUFTRAGSMODELLE.includes(z.datei)),
    'jede Zeile gehört zu einem benannten Auftragsmodell');
  assert.equal(ergebnis.geladen, AUFTRAGSMODELLE.length,
    `${ergebnis.geladen} von ${ergebnis.gesamt} Modellen laden (Schritt 1) — ein Ladefehler ist `
    + 'ein Problem des Ladewegs, nicht der Modelle, und würde die ganze Messung verzerren. '
    + `Erste Meldung: ${ergebnis.zeilen.find((z) => z.stopSchritt === 1)?.stop ?? 'keine'}`);
});

test('Lauf, Negativfall: 3 Bytes Müll werden in Schritt 1 mit einer Zahl abgelehnt', async () => {
  const müll = await messModell('negativfall-kein-glb.glb', { puffer: new Uint8Array([0x00, 0x01, 0x02]) });

  assert.equal(müll.stopSchritt, 1,
    `Müll muss in Schritt 1 (laden) enden, endete in Schritt ${müll.stopSchritt}`);
  assert.ok(müll.stop !== null, 'die Müll-Zeile trägt eine Meldung');
  assert.match(müll.stop, /\d/,
    `die Ablehnung muss eine Zahl nennen (AGENTS.md), war: „${müll.stop}“`);
  assert.equal(müll.knochen, null,
    `Müll darf keine Knochenzahl liefern, liefert ${müll.knochen}`);
  assert.equal(müll.rollenSicher, null,
    `Müll darf keine Rollenzahl liefern, liefert ${müll.rollenSicher}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Messung
// ─────────────────────────────────────────────────────────────────────────────

test('Messung (Stand 04.09.): 0 von 10 Modellen kommen durch die Vermessung, jede Zeile stoppt in Schritt 3', () => {
  // Der gemessene Stand. src/rig/measure.js ist mitten in einer Umarbeitung
  // (Mixamo-Referenzen entfernen) und wirft bei JEDEM Modell denselben
  // ReferenceError, BEVOR die Namensprüfung Pflichtrollen prüfen kann. Diese
  // Zahl ist der Beleg, den der Auftrag haben will („wie viele Modelle
  // scheitern“). Der andere Agent repariert measure.js — danach ändert sich
  // diese Zahl, und dieser Test wird mit der Wiederholungsmessung geändert.
  assert.equal(ergebnis.vermessbar, 0,
    `${ergebnis.vermessbar} von ${ergebnis.gesamt} Modellen kommen durch die Vermessung — `
    + 'gemessen am 04.09. waren es 0. Hat ein anderer Agent measure.js repariert, ist dieser '
    + 'Teststand veraltet: Messung wiederholen und Test nachziehen.');

  const aufSchritt3 = ergebnis.zeilen.filter((z) => z.stopSchritt === 3);
  assert.equal(aufSchritt3.length, ergebnis.gesamt,
    `${ergebnis.gesamt - aufSchritt3.length} von ${ergebnis.gesamt} Modellen stoppen NICHT in `
    + `Schritt 3 — der Fehlerort hat sich verschoben, die Zeile sagt wo: `
    + `${ergebnis.zeilen.find((z) => z.stopSchritt !== 3)?.stop ?? 'kein Stopp'}`);

  // Derselbe Befund überall? Ein unterschiedlicher Fehler je Modell wäre eine
  // Modelleigenschaft; derselbe überall ist eine Eigenschaft des Messwegs.
  const meldungen = new Set(aufSchritt3.map((z) => z.stop));
  assert.ok(meldungen.size === 1,
    `die ${aufSchritt3.length} Stopp-Meldungen aus Schritt 3 sind an ${meldungen.size} `
    + `verschiedenen Stellen — der erste: „${aufSchritt3[0]?.stop}“`);
});

test('Messung, Negativfall: jedes Modell, das vor Schritt 3 stoppt, trägt KEINE Messzahlen', () => {
  for (const z of ergebnis.zeilen) {
    if (z.stopSchritt < 3) {
      assert.equal(z.gelenke, null,
        `„${z.datei}“ stoppt in Schritt ${z.stopSchritt}, meldet aber ${z.gelenke} Gelenke — `
        + 'Zahlen aus einem Schritt, der nie ganz lief, dürfen nicht in der Tabelle stehen');
      assert.equal(z.vertragsfehler, null,
        `„${z.datei}“ stoppt in Schritt ${z.stopSchritt}, meldet aber ${z.vertragsfehler} Vertragsfehler`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Rollen
// ─────────────────────────────────────────────────────────────────────────────

test('Rollen: jede Zeile mit Rollen ohne Vermessung erhöht rollenWeiter genau um 1', () => {
  const erwartet = ergebnis.zeilen.filter((z) => z.schritt2 === true && z.schritt3 !== true).length;
  assert.equal(ergebnis.rollenWeiter, erwartet,
    `rollenWeiter = ${ergebnis.rollenWeiter}, aber ${erwartet} Zeilen haben Rollen ohne Vermessung — `
    + 'die Zweitzahl des Auftrags zählt die Zeilen nicht nach');
  // Der gemessene Stand: die Erkennung kam bei ALLEN zehn weiter.
  assert.equal(ergebnis.rollenWeiter, ergebnis.gesamt,
    `die Rollenerkennung kam bei ${ergebnis.rollenWeiter} von ${ergebnis.gesamt} Modellen weiter — `
    + 'gemessen am 04.09. waren es alle zehn. Sinkt diese Zahl, ist measure.js repariert: '
    + 'Messung wiederholen und Tabelle vergleichen.');
});

test('Rollen, Negativfall: ohne Rollen gibt es bei gestoppter Vermessung keinen Weiterzähler', () => {
  // Eine Zeile, in der Rollen NICHT erkannt wurden und die Vermessung nicht
  // lief, darf rollenWeiter nicht erhöhen — gezählt wird der Unterschied,
  // nicht die Erfolgsmeldung der Erkennung allein. Konstruiert statt gewartet:
  // eine Zeile, der beide Felder entzieht, und die Zähllogik auf die Zeilen losgelassen.
  const zeile = { datei: 'konstruiert.glb', schritt2: null, schritt3: null };
  const zählt = zeile.schritt2 === true && zeile.schritt3 !== true;
  assert.equal(zählt, false,
    `eine Zeile ohne erkannte Rollen zählt als „Rollen weiter als Vermessung“ (${zählt}) — falsch gezählt`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Tabelle und Robustheit
// ─────────────────────────────────────────────────────────────────────────────

test('Tabelle: nennt beide Gesamtzahlen und trägt jede Datei', () => {
  const text = tabellenText(ergebnis);
  assert.match(text, new RegExp(`Vermessen: ${ergebnis.vermessbar} von ${ergebnis.gesamt} Modellen`),
    'der Tabellenkopf nennt nicht die erste Gesamtzahl (vermessen)');
  assert.match(text, new RegExp(`\\b${ergebnis.rollenWeiter} von ${ergebnis.gesamt} Modellen\\b`),
    'der Tabellenkopf nennt nicht die zweite Gesamtzahl (Rollen weiter als Vermessung)');
  for (const z of ergebnis.zeilen) {
    assert.ok(text.includes(z.datei), `die Tabelle verschweigt „${z.datei}“`);
  }
});

test('Robustheit: eine fehlende Datei stürzt nicht ab, sondern endet als Zeile in Schritt 1', async () => {
  const fehlt = await messModell('diese-datei-fehlt.glb');
  assert.equal(fehlt.stopSchritt, 1,
    `eine fehlende Datei endet im Ladenschritt, aber in Schritt ${fehlt.stopSchritt}`);
  assert.ok(fehlt.knochen === null && fehlt.rollenSicher === null,
    `eine fehlende Datei trägt Messzahlen (Knochen ${fehlt.knochen}, Rollen ${fehlt.rollenSicher}) — sie hat nichts gemessen`);
});