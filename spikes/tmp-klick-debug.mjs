#!/usr/bin/env node
// Wegwerfdebug: Klick auf die set_intent-Bestätigung.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { proc, basis } = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(HERE, '..', 'tools', 'serve.mjs')], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const t = setTimeout(() => { p.kill(); reject(new Error('keine Startzeile in 10 s')); }, 10000);
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (c) => {
    buf += c;
    const m = buf.match(/Server läuft: (http:\/\/localhost:[0-9]+\/)/);
    if (m) { clearTimeout(t); resolve({ proc: p, basis: m[1] }); }
  });
});

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewportSize({ width: 1440, height: 900 });
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

console.log('ask stand nach Upload:', await page.evaluate(() => JSON.stringify(window.__tools.ask.stand())));
const panel = await page.evaluate(() => {
  const f = document.getElementById('frage');
  return { hidden: f?.hidden, buttons: f ? [...f.querySelectorAll('#frage-optionen button')].length : -1 };
});
console.log('Panel:', JSON.stringify(panel));

// set_intent aufrufen und Panelzustand beobachten
await page.evaluate(() => {
  window.__resp = null;
  window.__tools.rufe('set_intent', { checks: [{ kind: 'airtime', minSek: 0.4 }] })
    .then((a) => { window.__resp = a.content?.[0]?.text?.slice(0, 120); });
});
await page.waitForTimeout(1500);
console.log('ask stand nach set_intent:', await page.evaluate(() => JSON.stringify(window.__tools.ask.stand())));
console.log('Panel nach set_intent:', JSON.stringify(await page.evaluate(() => {
  const f = document.getElementById('frage');
  return { hidden: f?.hidden, buttons: f ? [...f.querySelectorAll('#frage-optionen button')].map((b) => ({ idx: b.dataset.index, text: b.textContent.slice(0, 40) })) : null };
})));
await page.evaluate(() => {
  const b = document.querySelector('#frage-optionen button[data-index="0"]');
  if (b) b.click(); else console.log('kein Knopf');
});
await page.waitForTimeout(1500);
console.log('Antwort:', await page.evaluate(() => String(window.__resp)));

await browser.close();
proc.kill();