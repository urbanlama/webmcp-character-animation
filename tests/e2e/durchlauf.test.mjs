// AP8 — Vertikalschnitt, Node-Zweig.
//
// Drei Abnahmetests aus dem Auftrag, jeder mit seinem Negativfall:
//
//   Durchlauf   der Weg läuft bis zum ersten noch nicht gebauten Teil und meldet,
//               wie weit er kam   |  ein Teil, das da ist, aber falsche Daten
//                                  liefert, bricht mit Datei und Betrag ab
//   Übergaben   jede Übergabe wird gegen src/contracts/ geprüft  |  eine kaputte
//               Übergabe wird mit dem Feldnamen gemeldet
//   Bericht     am Ende steht, was lief, was fehlte, wo es hakte  |  ein Lauf,
//                  der nichts tut und Erfolg meldet, ist ein Fehlschlag
//
// Aufgerufen wird dieses Muster wie im Rest des Repos:
//   node --test "tests/e2e/**/*.test.mjs"
// (Das automatische Einsammeln läuft über "src/**/*.test.mjs"; dieser Zweig
//  liegt bewusst außerhalb von src/ — Dateien, die dir gehören, laut Auftrag.)

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { durchlauf, berichtText, SCHRITTE, FRAMES } from './durchlauf.mjs';
import { nahtstellen } from './nahtstellen.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const XBOT = join(REPO, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb');

/** Die Node-Umgebung: URLs, Dateiblick, Modellbytes, solver-Dateibestand. */
function umgebung(zusatz = {}) {
  return {
    moduleUrl: (datei) => pathToFileURL(join(REPO, datei.split('/').join('\\'))).href,
    existiert: async (datei) => existsSync(join(REPO, datei.split('/').join('\\'))),
    glbBytes: async () => new Uint8Array(readFileSync(XBOT)),
    solverDateien: readdirSync(join(REPO, 'src', 'solver'))
      .filter((n) => n.endsWith('.js')).map((n) => `src/solver/${n}`),
    umgebungsname: 'node',
    ...zusatz,
  };
}

// Ein Lauf als Grundlage — das Vermessen dauert Sekunden und darf nicht in
// jedem Test erneut geschehen.
const lauf = await durchlauf(umgebung());
const schritt = (id) => lauf.schritte.find((s) => s.id === id);

// Das gemessene Profil, um daraus gezielt kaputte Übergaben zu bauen.
const { loadGLB } = await import(umgebung().moduleUrl('src/scene/load.js'));
const { measureRigProfile } = await import(umgebung().moduleUrl('src/rig/measure.js'));
const gltf = await loadGLB(new Uint8Array(readFileSync(XBOT)));
const profil = measureRigProfile(gltf, { fileName: 'Xbot.glb' });

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Durchlauf
// ─────────────────────────────────────────────────────────────────────────────

test('Durchlauf: der Weg läuft bis zum ersten fehlenden Teil und meldet, wie weit er kam', async () => {
  console.log('\n' + berichtText(lauf) + '\n');

  assert.ok(SCHRITTE.length >= 8,
    `die Schrittliste muss den ganzen Weg abbilden, sie hat ${SCHRITTE.length} Einträge`);

  // Vor dem ersten fehlenden Teil muss alles gelaufen sein, das da ist.
  const end = lauf.endeteBei;
  assert.ok(end !== null, `der Lauf meldet kein Ende — ergebnis.endeteBei = ${end}`);
  assert.equal(lauf.endete, 'nicht verfügbar',
    `der Lauf endet heute an einem fehlenden Teil, meldete aber "${lauf.endete}" `
    + `(Schritt ${end}) — complete ${lauf.zahlen.gelaufen}/${lauf.zahlen.schritteGesamt}`);

  const stop = schritt(end);
  assert.match(stop.meldung, /^noch nicht verfügbar: /,
    `die Meldung muss mit "noch nicht verfügbar: " beginnen, war: "${stop.meldung}"`);
  assert.match(stop.meldung, /\d/,
    `die Meldung muss eine Zahl nennen (AGENTS.md), war: "${stop.meldung}"`);

  // Wie weit er kam: jeder Schritt vor dem Stopp muss gelaufen oder ausdrücklich
  // abgelehnt sein — kein Schritt davor darf "nicht erreicht" stehen haben.
  const vorDemStopp = SCHRITTE.slice(0, SCHRITTE.findIndex((s) => s.id === end)).map((s) => s.id);
  for (const id of vorDemStopp) {
    const s = schritt(id);
    assert.ok(s.status === 'gelaufen' || s.status === 'abgelehnt',
      `Schritt ${id} (${s.name}) steht vor dem Stopp aber mit Status "${s.status}" — `
      + `der Lauf behauptet, bis ${end} gekommen zu sein: ${s.meldung ?? ''}`);
  }
  assert.ok(lauf.zahlen.gelaufen >= 4,
    `bis zum Löser stehen ${lauf.zahlen.gelaufen} gelaufene Schritte, erwartet werden mindestens 4 `
    + `(laden, vermessen, Rückfrage, Werkzeuge) — gemessen ${lauf.kamBis}`);

  // Die gemessenen Zahlen müssen Zahlen sein, keine Meldungen.
  const m = schritt('1').zahlen;
  assert.ok(m.knochen >= 1 && m.koerperhoeheMeter > 0.5,
    `Schritt 1 meldet ${m.knochen} Knochen und ${m.koerperhoeheMeter} m — das Modell ist geladen`);
  assert.equal(schritt('4').zahlen.frames, FRAMES,
    `die Timeline muss ${FRAMES} Frames haben, meldet ${schritt('4').zahlen.frames}`);
  assert.equal(schritt('4').zahlen.phasen, 4,
    `alle 4 Phasen müssen angelegt sein, es sind ${schritt('4').zahlen.phasen}`);
});

test('Durchlauf, Negativfall: ein Teil, das da ist, aber falsche Daten liefert, bricht mit Datei und Betrag ab', async () => {
  // Ein Löser, der vorhanden ist und 3 Frames für eine Timeline von FRAMES
  // Frames liefert. Der Lauf darf hier NICHT weiterlaufen und "fast geschafft"
  // melden — er muss abbrechen und Datei und Betrag nennen.
  const kaputt = {
    verfuegbar: true,
    datei: 'src/solver/loeser-kaputt.js', name: 'loese',
    modul: { loese: () => ({ frames: [{}, {}, {}] }) },
  };
  const ergebnis = await durchlauf(umgebung({ teile: { loeser: kaputt } }));

  assert.equal(ergebnis.endete, 'abgebrochen',
    `ein Löser mit 3 von ${FRAMES} Frames darf der Lauf nicht durchlassen — er meldete `
    + `"${ergebnis.endete}" (Schritt ${ergebnis.endeteBei}, ${ergebnis.schritte.filter((s) => s.status === 'gelaufen').length} gelaufen)`);
  assert.equal(ergebnis.endeteBei, '5',
    `der Abbruch muss als Schritt 5 gemeldet werden, gemeldet wurde ${ergebnis.endeteBei}`);
  const stopp = ergebnis.schritte.find((s) => s.id === '5');
  assert.ok(stopp.meldung.includes('src/solver/loeser-kaputt.js'),
    `die Abbruchmeldung muss die Datei nennen, war: "${stopp.meldung}"`);
  assert.match(stopp.meldung, /3 Frames/,
    `die Abbruchmeldung muss den gelieferten Betrag nennen, war: "${stopp.meldung}"`);
  assert.ok(stopp.meldung.includes(String(FRAMES)),
    `die Abbruchmeldung muss die erwartete Zahl ${FRAMES} nennen, war: "${stopp.meldung}"`);

  // Weiter darf er nicht gekommen sein.
  assert.equal(ergebnis.schritte.find((s) => s.id === '6').status, 'nicht erreicht',
    `nach dem Abbruch in Schritt 5 darf Schritt 6 nicht laufen — Status: `
    + `${ergebnis.schritte.find((s) => s.id === '6').status}`);

  // Zweite Stufe des Negativfalls: das geladene Modell selbst ist Müll.
  const muell = await durchlauf(umgebung({ glbBytes: async () => new Uint8Array([0x00, 0x01, 0x02]) }));
  assert.equal(muell.endete, 'abgebrochen',
    `3 Bytes Müll dürfen nicht als geladenes Modell durchgehen — meldete "${muell.endete}"`);
  assert.equal(muell.endeteBei, '1',
    `der Müll-Fall muss in Schritt 1 enden, endete in ${muell.endeteBei}`);
  assert.match(muell.schritte.find((s) => s.id === '1').meldung, /\d/,
    `die Meldung muss eine Zahl nennen, war: "${muell.schritte.find((s) => s.id === '1').meldung}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Übergaben
// ─────────────────────────────────────────────────────────────────────────────

test('Übergaben: jede Übergabe des Laufs liegt gegen einen Vertragsprüfer aus src/contracts/', async () => {
  assert.ok(lauf.uebergaben.length >= 2,
    `der Lauf muss jede Übergabe gegen einen Prüfer legen, er meldet ${lauf.uebergaben.length}`);
  for (const u of lauf.uebergaben) {
    assert.ok(typeof u.ok === 'boolean', `Übergabe "${u.zwischen}" meldet kein ok/nein`);
    assert.ok(u.pruefer.length > 0, `Übergabe "${u.zwischen}" nennt keinen Prüfer`);
    assert.equal(u.ok, true,
      `Übergabe "${u.zwischen}" besteht ihren Prüfer ${u.pruefer} nicht: `
      + `${u.fehlerAnzahl} Fehler — ${u.meldung}`);
  }
  const pruefer = lauf.uebergaben.map((u) => u.pruefer).join(' ');
  assert.match(pruefer, /src\/contracts\/rig-profile\.js/,
    `die RigProfile-Übergabe muss gegen src/contracts/rig-profile.js geprüft sein, Prüfer waren: ${pruefer}`);
  assert.match(pruefer, /src\/contracts\/timeline\.js/,
    `die Timeline-Übergabe muss gegen src/contracts/timeline.js geprüft sein, Prüfer waren: ${pruefer}`);

  // Was hinter der Löser-Blockade liegt, wird direkt an den Nahtstellen geprüft.
  const { INTENT_ARTEN } = await import(umgebung().moduleUrl('src/tools/catalog.js'));
  const befunde = await nahtstellen({ profil, gltf, moduleUrl: umgebung().moduleUrl, katalogArten: INTENT_ARTEN });
  console.log('\nNahtstellen hinter der Blockade');
  for (const b of befunde) {
    console.log(`  ${b.status.padEnd(7)} ${b.name} — ${b.meldung}`);
  }
  console.log('');
  // Jeder Befund muss eine Zahl enthalten — auch die, die etwas anprangern.
  for (const b of befunde) {
    assert.match(b.meldung, /\d/,
      `Nahtstellenbefund "${b.name}" nennt keine Zahl (AGENTS.md): "${b.meldung}"`);
  }
  // Ein Befund, der als "ok" ankommt, darf keine Anklage sein, und umgekehrt.
  for (const b of befunde) {
    assert.ok(b.status === 'ok' || b.status === 'befund',
      `Nahtstelle "${b.name}" meldet unbekannten Status "${b.status}"`);
  }
  // Die Bildgrenze ist eine echte Gleichheit, keine Geschmackssache.
  const grenze = befunde.find((b) => b.name.startsWith('Bildgrenze'));
  assert.ok(grenze, 'die Nahtstelle Bildgrenze Bericht ↔ Renderer fehlt');
  assert.equal(grenze.status, 'ok',
    `MAX_BILDFRAMES (Bericht) und FRAMES_MAX (Renderer) müssen gleich sein: ${grenze.meldung}`);
});

test('Übergaben, Negativfall: eine kaputte Übergabe wird mit dem Feldnamen gemeldet', async () => {
  // Ein Vermessungs-Teil, das da ist und ein Profil ohne foot_r liefert — der
  // Pflichtrolle aus plan.md 5.1. Der Lauf muss das am Feldnamen festmachen.
  const ohneFuss = JSON.parse(JSON.stringify(profil));
  delete ohneFuss.roles.foot_r;
  const ergebnis = await durchlauf(umgebung({
    teile: { vermessen: { verfuegbar: true, modul: { measureRigProfile: () => ohneFuss } } },
  }));

  assert.equal(ergebnis.endete, 'abgebrochen',
    `ein RigProfile ohne Pflichtrolle foot_r darf nicht durchlaufen — meldete "${ergebnis.endete}"`);
  assert.equal(ergebnis.endeteBei, '2a',
    `der Feldfehler muss in Schritt 2a landen, landete in ${ergebnis.endeteBei}`);
  const stopp = ergebnis.schritte.find((s) => s.id === '2a');
  assert.match(stopp.meldung, /roles\.foot_r/,
    `die Meldung muss den Feldnamen nennen, war: "${stopp.meldung}"`);
  assert.match(stopp.meldung, /\d+\s+(Fehler|Vertragsfehler)/,
    `die Meldung muss die Anzahl der Vertragsfehler nennen, war: "${stopp.meldung}"`);
  assert.match(stopp.meldung, /src\/rig\/measure\.js/,
    `die Meldung muss die Datei nennen, war: "${stopp.meldung}"`);

  // Und die Übergabe selbst liegt als fehlgeschlagene im Protokoll.
  const ue = ergebnis.uebergaben.find((u) => u.zwischen.includes('RigProfile'));
  assert.ok(ue, 'die fehlgeschlagene Übergabe fehlt im Protokoll');
  assert.equal(ue.ok, false, `die Übergabe meldet ok, obwohl foot_r fehlt: ${ue.meldung}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Bericht
// ─────────────────────────────────────────────────────────────────────────────

test('Bericht: am Ende steht, welche Schritte liefen, welche fehlten und wo es hakte', async () => {
  const text = berichtText(lauf);

  // Welche Schritte liefen — jeder gelaufene muss mit Zahlen dastehen.
  for (const s of lauf.schritte.filter((x) => x.status === 'gelaufen')) {
    assert.ok(text.includes(`${s.id} `),
      `der Bericht verschweigt den gelaufenen Schritt ${s.id} (${s.name})`);
    assert.ok(Object.keys(s.zahlen).length > 0,
      `Schritt ${s.id} läuft, meldet aber keine Zahl`);
  }
  // Welche fehlten.
  assert.ok(lauf.fehlend.length >= 1,
    `der Bericht muss fehlende Teile nennen, er nennt ${lauf.fehlend.length}`);
  for (const f of lauf.fehlend) {
    assert.match(f, /^noch nicht verfügbar: /, `fehlendes Teil ohne die feste Meldung: "${f}"`);
    assert.ok(text.includes(f), `die fehlende Meldung steht nicht im Bericht: "${f}"`);
  }
  // Wo es hakte.
  assert.match(text, /Wo es hakte \(\d+\)/,
    'der Bericht führt keine Sektion für die Haken');
  assert.ok(lauf.haken.length >= 1,
    `heute muss der Bericht mindestens einen Haken tragen (Erkennung lehnt das `
    + `Referenzmodell ab), er trägt ${lauf.haken.length}`);
  for (const h of lauf.haken) assert.match(h, /\d/, `Haken ohne Zahl: "${h}"`);

  // Wie weit, in Zahlen, und zwar dieselben wie im Protokoll.
  assert.match(text, new RegExp(`kam bis Schritt ${lauf.kamBis}, endet bei Schritt ${lauf.endeteBei}`),
    `der Bericht sagt nicht, wie weit der Lauf kam (kamBis=${lauf.kamBis}, endeteBei=${lauf.endeteBei})`);
});

test('Bericht, Negativfall: ein Lauf, der stillschweigend nichts tut, darf keinen Erfolg melden', async () => {
  // Eine Umgebung, in der es kein einziges Bauteil gibt: 0 Dateien, keine Bytes.
  const nichts = await durchlauf({
    moduleUrl: () => 'file:///gibt-es-nicht/modul.js',
    existiert: async () => false,
    glbBytes: async () => new Uint8Array(0),
    solverDateien: [],
    umgebungsname: 'node-leer',
  });
  const text = berichtText(nichts);
  console.log('\n' + text + '\n');

  assert.equal(nichts.zahlen.gelaufen, 0,
    `in einer Umgebung ohne Bauteile dürfen 0 Schritte laufen, es waren ${nichts.zahlen.gelaufen}`);
  assert.notEqual(nichts.endete, 'vollständig',
    `ein Lauf mit 0 gelaufenen Schritten meldet "${nichts.endete}" — Stillstand ist kein Erfolg`);
  assert.match(text, /KEIN ERFOLG/,
    'der Bericht muss einen Lauf ohne jeden gelaufenen Schritt ausdrücklich als Fehlschlag '
    + `benennen, er meldete:\n${text}`);
  assert.match(text, new RegExp(`0 von ${SCHRITTE.length} Schritten geschafft`),
    `der Bericht muss die Zahl nennen, die er gerade verweigert:\n${text}`);
  assert.match(text, /endet bei Schritt 1/,
    `der Stillstand muss einen Ort haben, Bericht:\n${text}`);
});
