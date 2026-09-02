#!/usr/bin/env node
// Der Testlauf des Projekts. `npm test` ruft ausschliesslich diese Datei.
//
//   node tools/test.mjs              beide Phasen, wie npm test
//   node tools/test.mjs --nur-node   nur die rechnende Haelfte, ohne Browser
//   node tools/test.mjs --nur-browser  nur die drei Browserlaeufe
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
 * des Laufs zugleich bedienbar. Wird der Wert angepasst, erneut messen und die
 * Zahlen hier fortschreiben.
 *
 * EHRLICH DAZU: Die Zeit kommt aus dieser Zahl, nicht aus der Phasentrennung —
 * der zweiphasige Lauf liegt mit 21,5 s im selben Bereich wie ein einphasiger
 * mit derselben Parallelitaet. Die Phasentrennung kauft Verlaesslichkeit: nie
 * mehr als 1 Chromium, also keine Testdatei mehr, die je nach Maschinenlast
 * ein anderes Ergebnis liefert.
 */
const NODE_PARALLEL = Math.max(2, Math.floor(availableParallelism() / 3));

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
