#!/usr/bin/env node
// Wegwerfmessung zum Auftrag "Zwei Befunde am Werkzeug validate".
// Lädt Xbot im headless Chromium, ruft die Werkzeuge so wie ein Agent und
// misst die Dauer jedes Aufrufs. Negativfälle prüfpunktweise — wird einer
// rot, steht MAENGEL in der Ausgabe.
//
// Ausführen: node spikes/tmp-validate-messung.mjs

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTZEILE = new RegExp('Server läuft: (http://localhost:[0-9]+/)');

// ── Server starten ───────────────────────────────────────────────────────────
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

// ── Browser + Seite ──────────────────────────────────────────────────────────
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
  () => document.getElementById('status').textContent.match(/Knochen|bones/),
  null, { timeout: 30000 });
console.log('Status:', await page.evaluate(() => document.getElementById('status').textContent));

// Offene Rollenfrage abbrechen, damit die Messung selbst fragen kann.
const wartet = await page.evaluate(() => window.__tools?.ask.stand().wartet === true);
if (wartet) {
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__tools.ask.stand().wartet === false, null, { timeout: 5000 });
}

// Helper in der Seite: ruft auf, klickt eine menschliche Bestätigung weg.
await page.evaluate(() => {
  window.__messer = async (name, args, klickOption0 = false) => {
    const t0 = performance.now();
    const p = window.__tools.rufe(name, args);
    if (klickOption0 && window.__tools.ask.stand().wartet === true) {
      const start = Date.now();
      while (!document.querySelector('#frage-optionen button[data-index="0"]')
             && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      document.querySelector('#frage-optionen button[data-index="0"]')?.click();
    }
    const antwort = await p;
    const dauerMs = performance.now() - t0;
    const content = Array.isArray(antwort?.content) ? antwort.content : [];
    const text = content.find((t) => t.type === 'text')?.text ?? '';
    const bilder = content.filter((t) => t.type === 'image');
    return {
      dauerMs: Math.round(dauerMs * 10) / 10,
      isError: antwort?.isError === true,
      textZeilen: 1,
      textErsteZeile: String(text).split('\n')[0].slice(0, 200),
      textZeichen: text.length,
      bilder: bilder.length,
      bildBytes: bilder.reduce((s, b) => s + String(b.data ?? '').length, 0),
    };
  };
});

const rufe = (name, args, klick = false) =>
  page.evaluate(([n, a, k]) => window.__messer(n, a, k), [name, args, klick]);

const zeige = (name, m) => console.log(
  `${name.padEnd(14)} ${String(m.dauerMs).padStart(8)} ms   `
  + `${m.isError ? 'FEHLER' : 'ok    '}  Bilder: ${m.bilder} (${Math.round(m.bildBytes / 1024)} KB)  `
  + `| ${m.textErsteZeile.slice(0, 100)}`);

// ── Befund 1: validate ohne Absicht ─────────────────────────────────────────
console.log('\n=== BEFUND 1: validate ohne Absicht ===');
const z = await page.evaluate(() => window.__tools.store.roh());
if (z.frameCount < 10) await rufe('set_duration', { frameCount: 60 });
const f1 = await rufe('validate', {});
zeige('validate', f1);
console.log('Antworttext wörtlich:', JSON.stringify(f1.textErsteZeile));
const volleAntwort = await page.evaluate(async () => {
  const t0 = performance.now();
  const a = await window.__tools.rufe('validate', {});
  return { dauerMs: Math.round(performance.now() - t0), text: a.content[0].text };
});
console.log('Dauer (2. Lauf):', volleAntwort.dauerMs, 'ms');
console.log('Antworttext (vollständig):\n' + volleAntwort.text);

// ── Befund 2: validate mit Absicht und vier Phasen ──────────────────────────
console.log('\n=== BEFUND 2: validate mit Absicht, 4 Phasen, 60 Frames ===');
zeige('set_duration', await rufe('set_duration', { frameCount: 60 }));
zeige('set_intent', await rufe('set_intent',
  { checks: [{ kind: 'airtime', minSek: 0.4 }] }, true));
// Vier Phasen über die 60 Frames: Stütz, Schwung, Flug, Landung.
for (const [verb, from, to, params] of [
  ['crouch', 0, 12, { tiefe: 0.1 }],
  ['takeoff', 12, 18, { vy: 2 }],
  ['airborne', 18, 42, { vy: 2 }],
  ['land', 42, 55, { tiefe: 0.1 }],
]) {
  zeige('add_phase', await rufe('add_phase', { verb, from, to, params }));
}

const laeufe = [];
for (let i = 0; i < 3; i += 1) {
  const m = await rufe('validate', {});
  laeufe.push(m.dauerMs);
  zeige(`validate (Lauf ${i + 1})`, m);
}
console.log('Dauern validate (ms):', laeufe.join(', '));

// Prüfpunkte (Negativfälle): was falsch liefe, steht als MAENGEL in der Ausgabe.
const maengel = [];
if (!/\d/.test(volleAntwort.text) || !/set_intent/.test(volleAntwort.text)) {
  maengel.push('Befund 1: Meldung ohne Zahl oder ohne set_intent-Rat');
}
if (/Bericht abgelehnt|beschreibt 0|fehlende Felder/.test(volleAntwort.text)) {
  maengel.push('Befund 1: alter Absturztext liegt noch vor');
}
const letzter = await page.evaluate(async () => {
  const a = await window.__tools.rufe('validate', {});
  return {
    dauerMs: Math.round(performance.now()),
    bilder: a.content.filter((c) => c.type === 'image').length,
    isError: a.isError === true,
    text: a.content.find((c) => c.type === 'text')?.text.slice(0, 300) ?? ''
  };
});
if (letzter.bilder === 0) maengel.push('Abnahme 3: validate-Antwort ohne Bildstreifen');
if (letzter.isError) maengel.push('Abnahme 2: validate mit Absicht antwortet mit Fehler');
console.log('\nLetzter Lauf: Bilder:', letzter.bilder, '| isError:', letzter.isError);
console.log('Berichtanfang:', JSON.stringify(letzter.text.slice(0, 200)));
console.log('\n' + (maengel.length === 0
  ? 'MAENGEL: keine — alle Prüfpunkte bestanden'
  : `MAENGEL (${maengel.length}):\n- ` + maengel.join('\n- ')));

await browser.close();
proc.kill();