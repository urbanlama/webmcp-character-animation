#!/usr/bin/env node
// Wegwerfmessung zum Auftrag "Der Bildstreifen frisst den Rechner": Nachher-
// Messung eines vollen validate-Aufrufs mit 60 Frames und 4 Phasen — genau
// der Fall, der laut Befund nach fünf Minuten nicht zurückkam.
//
// Ausführen: node spikes/tmp-validate-nachher.mjs

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTZEILE = new RegExp('Server läuft: (http://localhost:[0-9]+/)');

const { proc, basis } = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(HERE, '..', 'tools', 'serve.mjs')], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const t = setTimeout(() => { p.kill(); reject(new Error('keine Serverstartzeile in 10 s')); }, 10000);
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (c) => {
    buf += c;
    const m = buf.match(STARTZEILE);
    if (m) { clearTimeout(t); resolve({ proc: p, basis: m[1] }); }
  });
});
console.log('Server:', basis);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(basis, { waitUntil: 'load' });
await page.waitForFunction(() => window.__boot?.bereit === true, null, { timeout: 10000 });

await page.setInputFiles('#file', XBOT_PFAD);
await page.waitForFunction(
  () => document.getElementById('status').textContent.match(/Knochen|bones/),
  null, { timeout: 30000 });

const wartet = await page.evaluate(() => window.__tools?.ask.stand().wartet === true);
if (wartet) {
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__tools.ask.stand().wartet === false, null, { timeout: 5000 });
}

await page.evaluate(() => window.__tools.rufe('set_duration', { frameCount: 60 }));
await page.evaluate(() => window.__tools.rufe('set_intent', { checks: [{ kind: 'airtime', minSek: 0.4 }] }));
await page.evaluate(() => {
  const start = Date.now();
  return new Promise((resolve) => {
    const warte = () => {
      const b = document.querySelector('#frage-optionen button[data-index="0"]');
      if (b) { b.click(); resolve(); }
      else if (Date.now() - start > 5000) resolve();
      else setTimeout(warte, 20);
    };
    warte();
  });
});
for (const [verb, from, to, params] of [
  ['crouch', 0, 12, { tiefe: 0.1 }],
  ['takeoff', 12, 18, { vy: 2 }],
  ['airborne', 18, 42, { vy: 2 }],
  ['land', 42, 55, { tiefe: 0.1 }],
]) {
  await page.evaluate(([verb, from, to, params]) =>
    window.__tools.rufe('add_phase', { verb, from, to, params }), [verb, from, to, params]);
}

// Der volle validate-Aufruf, dreimal gemessen.
for (let i = 0; i < 3; i++) {
  const m = await page.evaluate(async () => {
    const t0 = performance.now();
    const a = await window.__tools.rufe('validate', {});
    const msd = performance.now() - t0;
    const bilder = (a.content ?? []).filter((c) => c.type === 'image');
    const text = (a.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    return { ms: msd, isError: a.isError === true, bilder: bilder.length,
      bytes: bilder.reduce((s, b) => s + (b.data ?? '').length, 0),
      textAnfang: text.slice(0, 160), hatKuerzung: /Zeitgrenze/.test(text) };
  });
  console.log(`validate Lauf ${i + 1}: ${Math.round(m.ms)} ms  isError=${m.isError}  `
    + `Bilder ${m.bilder} (${Math.round(m.bytes / 1024)} KB Base64)  `
    + `Kürzungsmeldung=${m.hatKuerzung}`);
  if (i === 0) console.log('  Textanfang:', JSON.stringify(m.textAnfang));
}

await browser.close();
proc.kill();