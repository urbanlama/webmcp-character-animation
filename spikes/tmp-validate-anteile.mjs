#!/usr/bin/env node
// Wegwerfmessung: Zusammensetzung der validate-Antwort — wie groß sind
// Berichttext, Bilddaten je Streifen, wie viele Frames im Streifen?

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
  () => document.getElementById('status').textContent.match(/Knochen|bones/),
  null, { timeout: 30000 });

// Rollenfrage des Uploads abräumen: erst eine Wartezeit, weil die Frage nach
// dem Status-Update beginnt, dann Abbruch wie keineFrageOffen() in browser-test.
await page.waitForTimeout(800);
await page.evaluate(() => window.__tools?.ask.abbrechen('Messlauf räumt die Rollenfrage weg'));
await page.waitForFunction(() => window.__tools.ask.stand().wartet === false, null, { timeout: 5000 });

// Helper: ruft auf und klickt eine menschliche Bestätigung weg.
await page.evaluate(() => {
  window.__rufeMitKlick = async (name, args, klickOption0 = false) => {
    const p = window.__tools.rufe(name, args);
    if (klickOption0) {
      const start = Date.now();
      while (!document.querySelector('#frage-optionen button[data-index="0"]')
             && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      document.querySelector('#frage-optionen button[data-index="0"]')?.click();
    }
    return p;
  };
});

// Timeline aufbauen und validate DIREKT an den Ports messen (unterhalb der
// Werkzeugschicht), um die Anteile zu sehen.
const messung = await page.evaluate(async () => {
  const t0 = performance.now();
  await window.__rufeMitKlick('set_duration', { frameCount: 60 });
  await window.__rufeMitKlick('set_intent',
    { checks: [{ kind: 'airtime', minSek: 0.4 }] }, true);
  for (const [verb, from, to, params] of [
    ['crouch', 0, 12, { tiefe: 0.1 }],
    ['takeoff', 12, 18, { vy: 2 }],
    ['airborne', 18, 42, { vy: 2 }],
    ['land', 42, 55, { tiefe: 0.1 }],
  ]) {
    await window.__rufeMitKlick('add_phase', { verb, from, to, params });
  }

  // Bericht direkt über den Port bauen (das ist der teure Teil), dann die
  // Anteile lesen: Bericht ohne Bilder, bilddaten je Streifen.
  const t1 = performance.now();
  const a = await window.__tools.rufe('validate', {});
  const dauerMs = performance.now() - t1;

  const content = a?.content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  const bilder = content.filter((c) => c.type === 'image');

  // Der Bericht zur Anteilszählung ein zweites Mal direkt über die Ports,
  // ohne die Größenkontrolle der Werkzeugschicht.
  const t2 = performance.now();
  const ports = window.__ports;
  const z = window.__tools.store.lies();
  const { alsTimeline } = await import(new URL('src/tools/handlers.js', document.baseURI).href);
  const timeline = alsTimeline(z);
  timeline.solved = ports.solver.loese(timeline);
  const bericht = ports.validator.pruefe(timeline, { intent: z.intent });
  const direktMs = performance.now() - t2;
  const bilddaten = bericht.bilddaten;
  delete bericht.bilddaten;
  const berichtKb = Math.round((
    new TextEncoder().encode(JSON.stringify(bericht, null, 2)).length) / 1024 * 10) / 10;
  const streifen = bilddaten.map((b) => ({
    view: b.view, frames: b.frames?.length, panels: b.panels,
    kb: Math.round((b.data.length * 3) / 4 / 1024 * 10) / 10,
    px: `${b.width}x${b.height}`,
  }));

  return { dauerMs, direktMs, isError: a?.isError === true, textLaenge: text.length,
    textKb: Math.round(new TextEncoder().encode(text).length / 1024 * 10) / 10,
    bilder: bilder.map((b) => ({ bytes: Math.round((b.data.length * 3) / 4 / 1024),
      w: b.width, h: b.height, frames: b.frames ?? null })),
    berichtKb, streifen,
    textAnfang: text.slice(0, 250) };
});

console.log(JSON.stringify(messung, null, 2));

// Handlerpfad exakt nachbauen: bilddaten aus dem Port-Bericht, Kappung
// anwenden, Größe zählen.
const simulation = await page.evaluate(async () => {
  const ports = window.__ports;
  const z = window.__tools.store.lies();
  const { alsTimeline, VALIDATE_FRAMES_MAX } = await import(
    new URL('src/tools/handlers.js', document.baseURI).href);
  const timeline = alsTimeline(z);
  timeline.solved = ports.solver.loese(timeline);
  const bericht = ports.validator.pruefe(timeline, { intent: z.intent });
  let bilder = Array.isArray(bericht.bilddaten) ? bericht.bilddaten : [];
  delete bericht.bilddaten;
  const vorKappung = bilder[0]?.frames?.length ?? 0;

  // derselbe zweite Schritt wie im Handler:
  if (bericht.images && bericht.images.length > 0
      && bilder[0] && Array.isArray(bilder[0].frames)
      && bilder[0].frames.length > VALIDATE_FRAMES_MAX) {
    const behalten = bilder[0].frames.slice(0, VALIDATE_FRAMES_MAX);
    bilder = ports.renderer.streifen({ frames: behalten, views: ['side', 'front'] });
    bericht.images = bilder.map(({ view, frames: f, ref }) => ({ view, frames: f, ref }));
  }

  const bilderBytes = bilder.reduce((s, b) => s + Math.ceil((b.data?.length ?? 0) * 3 / 4), 0);
  const base64Bytes = bilder.reduce((s, b) => s + (b.data?.length ?? 0), 0);
  const voll = JSON.stringify(bericht, null, 2);
  const kompakt = JSON.stringify(bericht);
  const enc = (t) => new TextEncoder().encode(t).length;
  const kompaktAntwort = { content: [{ type: 'text', text: kompakt }] };
  bilder.forEach((b) => kompaktAntwort.content.push(
    { type: 'image', data: b.data, mimeType: 'image/png' }));
  const antwortBytes = enc(JSON.stringify(kompaktAntwort));
  const issues = {
    physics: bericht.physics?.issues?.length ?? null,
    style: bericht.style?.issues?.length ?? null,
  };
  return {
    vorKappung, nachKappung: bilder[0]?.frames?.length ?? 0,
    bilderAnzahl: bilder.length,
    bilderPngKb: Math.round(bilderBytes / 1024 * 10) / 10,
    bilderBase64Kb: Math.round(base64Bytes / 1024 * 10) / 10,
    bilderPx: bilder.map((b) => `${b.width}x${b.height}`),
    vollKb: Math.round(enc(voll) / 1024 * 10) / 10,
    kompaktKb: Math.round(enc(kompakt) / 1024 * 10) / 10,
    gesamtKompaktBase64Kb: Math.round((enc(kompakt) + base64Bytes) / 1024 * 10) / 10,
    antwortJsonKb: Math.round(antwortBytes / 1024 * 10) / 10,
    issues,
  };
});
console.log('Simulation des Handlerwegs:', JSON.stringify(simulation, null, 2));

await browser.close();
proc.kill();