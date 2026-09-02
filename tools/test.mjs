#!/usr/bin/env node
// Der Testlauf des Projekts. `npm test` ruft ausschliesslich diese Datei.
//
//   node tools/test.mjs              beide Phasen, wie npm test
//   node tools/test.mjs --nur-node   nur die rechnende Haelfte, ohne Browser
//   node tools/test.mjs --nur-browser  nur die drei Browserlaeufe
//
//   TEST_PARALLEL=n                  gleichzeitige Dateien in Phase 1
//                                    (zum Nachmessen, siehe NODE_PARALLEL)
//
// WARUM ZWEI PHASEN
//
// `node --test` verteilt Testdateien auf einen Worker je logischem Prozessor —
// auf der Entwicklungsmaschine (Ryzen 5 7500F, 6 Kerne / 12 Threads) also 12
// gleichzeitig. Drei dieser Dateien starten ein eigenes headless Chromium mit
// SwiftShader, das WebGL auf der CPU rechnet:
//
//   src/render/strip.test.mjs
//   tests/e2e/durchlauf.browser.test.mjs
//   tools/browser-test.mjs
//
// Liefen sie zusammen mit den rechnenden Tests, hungerten sich beide Seiten
// gegenseitig aus. Gemessen am 02.09.2026, derselbe Test in beiden Lagen:
//
//   "Browser: derselbe Lauf in der echten Seite …"   allein 2,1 s → gemeinsam 18,7 s
//   "Sabotage: ein ausgehaengtes Bauteil …"          allein 1,6 s → gemeinsam 16,3 s
//
// Der ganze Lauf brauchte dadurch 27 bis 31 s bei 97 % CPU-Auslastung, obwohl
// beide Haelften getrennt zusammen 13 s brauchen. Deshalb: erst die rechnenden
// Tests parallel, danach die Browserlaeufe einzeln — nie mehr als 1 Chromium
// gleichzeitig.
//
// Fortgeschrieben am 02.09.2026, nach dem Cache-Umbau der Vermessungs-Tests
// (measure.test.mjs und die solver/validate-Dateien messen das unveraenderte
// Xbot-Profil nur noch einmal je Datei statt bis zu 11-mal): Phase 1 41,7 s,
// Phase 2 einzeln 10,3 s + 30,4 s + 22,6 s, gesamt 105,0 s.
//
// Fortgeschrieben am 02.09.2026 abends, nach dem PROZESSUEBERGREIFENDEN
// Profil-Cache (src/rig/xbot-profil.mjs). 29 Testdateien brauchten dasselbe
// Profil des unveraenderten Xbot; `node --test` gibt jeder Datei einen eigenen
// Prozess, ein Cache im Modul half also nur innerhalb einer Datei. Das Profil
// liegt jetzt v8-serialisiert im tmpdir, der Schluessel deckt die Importkette
// ab measure.js, die Xbot.glb und die Optionen ab. Alle Zeiten auf 12
// logischen Prozessoren, 517 Tests gruen:
//
//   Phase 1, Node                       41,7 s → 26,3 s
//   Phase 2, src/render/strip.test.mjs  10,3 s →  8,4 s
//   Phase 2, tests/e2e/durchlauf.browser.test.mjs      24,0 s
//   Phase 2, tools/browser-test.mjs                    22,7 s
//   gesamt                             105,0 s → 81,4 s
//
// Die beiden letzten Browserdateien sind unveraendert; ihre Abweichung gegen
// die Zeile darueber ist Messbedingung, nicht Ersparnis.
//
// Kalter gegen warmer Cache, Phase 1: 27,2 s gegen 26,3 s. Der Aufschlag
// bleibt klein, weil waehrend der einen Messung die anderen Worker
// weiterlaufen. Wer measure.js, detect.js, kollision.js oder die Xbot.glb
// aendert, zahlt genau diese eine Sekunde — der Schluessel bemerkt es.
//
// Der Rest ist echte Arbeit: die Gelenkgrenzmessung (~2 s, jetzt einmal statt
// 29-mal, bewusst) und drei SwiftShader-Browserlaeufe. Ein Lauf mit zwei
// Agenten gleichzeitig auf einer Maschine verdoppelt grob die Zeiten.
//
// GEPRUEFT UND VERWORFEN: die Seite je Testdatei nur EINMAL booten und ueber
// mehrere Tests hinweg wiederverwenden. Klingt nach dem groessten Hebel in
// Phase 2 und ist das Gegenteil. index.html rendert dauerhaft weiter
// (requestAnimationFrame, index.html Zeile 1238); eine Seite, die offen bleibt,
// rechnet mit SwiftShader auf der CPU gegen den gerade laufenden Test. Am
// selben Code gemessen, nur der Wiederverwendung an- und abgeschaltet:
//
//                                    Seiten geteilt   Seite je Test
//   src/render/strip.test.mjs               7,8 s          8,3 s
//   tests/e2e/durchlauf.browser.test.mjs   31,2 s         24,7 s
//   tools/browser-test.mjs                 53,3 s         23,6 s
//   Phase 2 gesamt                         92,3 s         56,6 s
//
// Wer eine Seite offen halten will, muss vorher ihre Renderschleife anhalten —
// sonst kostet der gesparte Boot ein Vielfaches dessen, was er einbringt.
//
// SwiftShader bleibt: die Pixelvergleiche in strip.test.mjs brauchen ein
// deterministisches Bild, das eine echte GPU nicht garantiert. Der Preis ist
// CPU-Last, und die wird hier begrenzt statt vervielfacht.

import { spawn } from 'node:child_process';
import { globSync } from 'node:fs';
import { availableParallelism, constants, setPriority } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Verfahrensparameter: gleichzeitige Testdateien in der Node-Phase.
 *
 * Gemessen am 02.09.2026 auf 12 logischen Prozessoren, ganze Suite in EINEM
 * Lauf (also so, wie npm test es vor diesem Runner tat):
 *
 *   Parallelitaet   Laufzeit
 *   12 (Standard)   39,8 s und 51,3 s in zwei Messungen — CPU dauerhaft am Anschlag
 *    6              25,5 s
 *    4              22,1 s und 19,8 s
 *
 * Mehr Worker als ein Drittel der logischen Prozessoren machen den Lauf also
 * nicht schneller, sondern langsamer: die Browserdateien und die rechnenden
 * Tests nehmen sich gegenseitig die Kerne weg. 4 laesst die Maschine waehrend
 * des Laufs zugleich bedienbar.
 *
 * Nach dem prozessuebergreifenden Profil-Cache nachgemessen (die alte Zahl
 * stammt aus der Zeit, in der jede Testdatei ~2 s Gelenkgrenzmessung trug —
 * der Verdacht war, dass ohne diese Last mehr Worker lohnen). Phase 1 allein,
 * warm, je ein Lauf:
 *
 *    4              26,1 s
 *    6              26,7 s
 *
 * Kein Unterschied ausserhalb des Rauschens. Es bleibt bei 4, jetzt aus dem
 * zweiten Grund: die Maschine bleibt bedienbar, und schneller wird es ohnehin
 * nicht. TEST_PARALLEL=n setzt den Wert fuer eine Nachmessung. Wird er
 * geaendert, erneut messen und die Zahlen hier fortschreiben.
 *
 * EHRLICH DAZU: Die Zeit kommt aus dieser Zahl, nicht aus der Phasentrennung —
 * der zweiphasige Lauf liegt mit 21,5 s im selben Bereich wie ein einphasiger
 * mit derselben Parallelitaet. Die Phasentrennung kauft Verlaesslichkeit: nie
 * mehr als 1 Chromium, also keine Testdatei mehr, die je nach Maschinenlast
 * ein anderes Ergebnis liefert.
 */
const NODE_PARALLEL = Number(process.env.TEST_PARALLEL) > 0
  ? Number(process.env.TEST_PARALLEL)
  : Math.max(2, Math.floor(availableParallelism() / 3));

/** Erkennt eine Testdatei, die ein eigenes Chromium startet. Automatisch statt
 *  gepflegter Liste: ein neuer Browsertest landet ohne Zutun in Phase 2. */
const BROWSER_MUSTER = /chromium\.launch\s*\(/;

/** Alle Testdateien des Projekts. spikes/ bleibt draussen — Spielwiese, kein
 *  Teil der Abnahme. */
function alleTestdateien() {
  const gefunden = globSync(['src/**/*.test.mjs', 'tests/**/*.test.mjs'], { cwd: ROOT });
  // tools/browser-test.mjs heisst nicht *.test.mjs, ist aber eine Testdatei.
  return [...gefunden, 'tools/browser-test.mjs'].map((p) => p.split('\\').join('/')).sort();
}

/** Teilt nach Inhalt: wer Chromium startet, kommt in die zweite Phase. */
async function teileAuf(dateien) {
  const { readFile } = await import('node:fs/promises');
  const node = [];
  const browser = [];
  for (const datei of dateien) {
    const text = await readFile(resolve(ROOT, datei), 'utf8');
    (BROWSER_MUSTER.test(text) ? browser : node).push(datei);
  }
  return { node, browser };
}

/**
 * Startet `node --test` und liefert den Exitcode. Ausgabe geht direkt durch.
 *
 * Der Kindprozess laeuft mit gesenkter Prioritaet, und Chromium erbt sie als
 * Enkel. Grund: SwiftShader rechnet WebGL auf der CPU und zieht in Spitzen alle
 * 12 Threads. Mit BELOW_NORMAL bekommt jedes Programm im Vordergrund seine
 * Rechenzeit zuerst — die Maschine bleibt waehrend des Laufs bedienbar, ohne
 * dass der Lauf laenger wird (gemessen 02.09.2026: 21,9 s ohne, 21,5 s mit
 * gesenkter Prioritaet — der Unterschied liegt im Rauschen). VOLLGAS=1
 * schaltet es ab.
 */
function laufe(argumente) {
  return new Promise((fertig) => {
    const proc = spawn(process.execPath, argumente, { cwd: ROOT, stdio: 'inherit' });
    if (!process.env.VOLLGAS) {
      try {
        setPriority(proc.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Fehlt das Recht (manche CI-Container), laeuft der Test eben normal
        // weiter — die Prioritaet ist Komfort, kein Teil der Pruefung.
      }
    }
    proc.on('exit', (code) => fertig(code ?? 1));
  });
}

function sekunden(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

const nurNode = process.argv.includes('--nur-node');
const nurBrowser = process.argv.includes('--nur-browser');

const { node: nodeDateien, browser: browserDateien } = await teileAuf(alleTestdateien());
let fehler = 0;
const zeiten = [];

if (!nurBrowser) {
  console.log(`\n── Phase 1: ${nodeDateien.length} rechnende Testdateien, `
    + `${NODE_PARALLEL} gleichzeitig ──\n`);
  const t0 = Date.now();
  const code = await laufe(['--test', `--test-concurrency=${NODE_PARALLEL}`, ...nodeDateien]);
  zeiten.push([`Phase 1, Node (${nodeDateien.length} Dateien)`, Date.now() - t0, code]);
  if (code !== 0) fehler = code;
}

if (!nurNode) {
  // Einzeln und nacheinander: jeder Lauf ist ein eigener Prozess, also steht zu
  // jedem Zeitpunkt genau 1 Chromium mit SwiftShader auf der CPU.
  for (const datei of browserDateien) {
    console.log(`\n── Phase 2: ${datei} (einzeln, 1 Chromium) ──\n`);
    const t0 = Date.now();
    const code = await laufe(['--test', '--test-concurrency=1', datei]);
    zeiten.push([`Phase 2, ${relative('', datei)}`, Date.now() - t0, code]);
    if (code !== 0) fehler = code;
  }
}

const gesamt = zeiten.reduce((s, [, ms]) => s + ms, 0);
console.log('\n── Laufzeiten ──');
for (const [name, ms, code] of zeiten) {
  console.log(`  ${code === 0 ? 'grün' : 'ROT '}  ${sekunden(ms).padStart(7)}  ${name}`);
}
console.log(`         ${sekunden(gesamt).padStart(7)}  gesamt\n`);

process.exit(fehler);
