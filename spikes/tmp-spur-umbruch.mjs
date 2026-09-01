#!/usr/bin/env node
// Wegwerfskript (spikes-Konvention): misst, ob die Spur-Zeile (Befund 3) im
// echten Browser vollständig sichtbar umbricht — scrollWidth gegen clientWidth.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTZEILE = new RegExp('Server läuft: (http://localhost:[0-9]+/)');

function serverStart() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(HERE, '..', 'tools', 'serve.mjs')], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const t = setTimeout(() => { proc.kill(); reject(new Error('keine Startzeile in 10 s')); }, 10000);
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c) => {
      buf += c;
      const m = buf.match(STARTZEILE);
      if (m) { clearTimeout(t); resolve({ proc, basis: m[1] }); }
    });
  });
}

const { proc, basis } = await serverStart();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.addInitScript(() => {
  const registriert = [];
  document.modelContext = {
    async registerTool(w) { registriert.push(w); },
    getTools() { return registriert.slice(); },
  };
});
await page.goto(basis, { waitUntil: 'load' });
await page.waitForFunction(() => window.__boot?.bereit === true, null, { timeout: 10000 });
await page.setInputFiles('#file', XBOT_PFAD);
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('Knochen'),
  null, { timeout: 30000 });

// Eine evtl. offene Rollenfrage abbrechen, dann eine lange Meldung in die Spur
// bringen — der über 90 Zeichen lange Wortlaut, den die alte Kürzung beschnitten hätte.
const wartet = await page.evaluate(() => window.__tools.ask.stand().wartet === true);
if (wartet) {
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__tools.ask.stand().wartet === false, null, { timeout: 5000 });
}

await page.evaluate(() => {
  window.__ui.spur.notiere({
    name: 'confirm_role',
    dauerMs: 3,
    fehler: true,
    text: '10 von 10 unsicheren Zuordnungen gefragt, 10 festgelegt, 0 offen — '
      + 'abgebrochen nach dem Neuladen der Seite',
  });
});

const spur = await page.evaluate(() => {
  const z = document.querySelector('.spur-zeile .ergebnis');
  const r = z.getBoundingClientRect();
  return {
    text: z.textContent,
    clientWidth: z.clientWidth,
    scrollWidth: z.scrollWidth,
    zeilenhoehe: Math.round(r.height),
    umbricht: z.scrollWidth <= z.clientWidth && r.height > 24,
  };
});
console.log(JSON.stringify(spur, null, 2));

await browser.close();
proc.kill();