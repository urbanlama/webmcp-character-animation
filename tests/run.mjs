#!/usr/bin/env node
// Der eine Testkommando des Projekts. Läuft alle Tests und endet mit
// Fehlercode 1, wenn irgendeiner fehlschlägt.
//
//   npm test          → node tests/run.mjs
//
// Ablauf:
//   1. Selbsttest des Runners: eine absichtlich fehlschlagende Prüfung muss
//      tatsächlich fehlschlagen. Tut sie das nicht, ist der Runner kaputt,
//      nicht der Code — dann breakt npm test mit Fehler (AGENTS.md, Regel 2:
//      kein Test ohne Negativfall).
//   2. Discovery über tests/node/*.test.mjs und tests/browser/*.spec.mjs.
//      Jede Datei exportiert standardmäßig ein Array [{name, async run()}].
//   3. Alle laufen, Ergebnisse und Dauern landen in einer Übersicht auf stdout.
//   4. Fehlercode 1, wenn irgendein Test rot ist; der Name jedes kaputten
//      Tests steht in der Übersicht und zusätzlich als eigene Fehlerzeile.

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

/** Prototyp einer Test-Ergebniszeile. */
function result(name, ok, ms, error = null) {
  return { name, ok, ms, error };
}

/**
 * Führt eine einzelne Prüfung mit Messung aus. Ist die gemeinsame Ausführung
 * für echte Tests und für den Selbsttest — denselben Weg geht beides.
 */
async function measure(name, runFn) {
  const t0 = performance.now();
  try {
    await runFn();
    return result(name, true, performance.now() - t0);
  } catch (err) {
    return result(name, false, performance.now() - t0,
      (err && err.message) ? String(err.message) : String(err));
  }
}

/**
 * Selbsttest: eine absichtlich fehlschlagende Prüfung muss wirklich fehlschlagen.
 * Schlägt sie nicht fehl, ist der Runner kaputt — dann endet npm test mit Fehlercode,
 * bevor irgendein echter Test läuft.
 */
async function runnerSelfTest() {
  const mustFail = await measure('runner-selbsttest (Negativfall, muss fehlschlagen)',
    async () => { throw new Error('dieser Fehler ist erwartet — der Runner muss ihn als Fehlschlag zählen'); });
  if (mustFail.ok !== false) {
    throw new Error('Runner-Selbsttest kaputt: die absichtlich fehlschlagende Prüfung wurde als OK gezählt — der Runner markiert Fehler nicht zuverlässig');
  }
  return result('runner-selbsttest (markiert Fehlschläge zuverlässig)', true, mustFail.ms);
}

async function discover(dir, ext) {
  let names;
  try {
    names = await readdir(join(ROOT, dir));
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(ext)).sort()
    .map((n) => join(ROOT, dir, n));
}

async function main() {
  console.log('Runner: npm test (tests/run.mjs)\n');

  // 1. Selbsttest — muss bestehen, sonst ist der Runner selbst kaputt.
  let selftest;
  try {
    selftest = await runnerSelfTest();
  } catch (err) {
    console.error('RUNNER KAPUTT: ' + (err?.message || err));
    process.exit(1);
  }

  // 2. Discovery
  const nodeFiles = await discover('tests/node', '.test.mjs');
  const browserFiles = await discover('tests/browser', '.spec.mjs');

  /** @type {{name:string, run:Function}[]} */
  const cases = [];
  const { pathToFileURL } = await import('node:url');
  for (const file of [...nodeFiles, ...browserFiles]) {
    const mod = await import(pathToFileURL(file).href);
    const list = mod.default;
    if (!Array.isArray(list)) {
      console.error(`FEHLER: ${file} exportiert kein Array mit [{name, run()}] — übersprungen`);
      process.exit(1);
    }
    for (const c of list) {
      if (!c || typeof c.name !== 'string' || typeof c.run !== 'function') {
        console.error(`FEHLER: ${file} enthält einen Eintrag ohne {name, run()}`);
        process.exit(1);
      }
      cases.push(c);
    }
  }

  console.log(`Gefunden: ${cases.length} Tests aus ${nodeFiles.length} Node-Datei(en), ${browserFiles.length} Browser-Datei(en)\n`);

  // 3. Ausführen
  const results = [selftest, ...await Promise.all(cases.map((c) => measure(c.name, c.run)))];

  // 4. Übersicht
  console.log('Übersicht');
  console.log('---------');
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}  (${r.ms.toFixed(0)} ms)`);
    if (!r.ok) {
      failed++;
      // Fehlerliste: der Name des kaputten Tests steht sichtbar in einer eigenen Zeile.
      console.error(`FEHLSCHLAG: ${r.name}`);
      console.error(`  Grund: ${r.error}`);
    }
  }

  console.log(`---------\n${results.length - failed}/${results.length} bestanden (${failed} fehlgeschlagen)`);
  process.exit(failed > 0 ? 1 : 0);
}

main();