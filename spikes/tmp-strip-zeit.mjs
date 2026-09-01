#!/usr/bin/env node
// Wegwerfmessung zum Auftrag "Der Bildstreifen frisst den Rechner" (Schritt 1).
//
// Miss die Dauer EINES Bildstreifens, nicht eines ganzen validate-Laufs:
//   - je Einzel-Frame und je Einzel-Ansicht,
//   - Skalierung mit Frames und Ansichten,
//   - Mesh-Weg (WebGL) gegen Overlay-Weg (Kapseln, ohne WebGL).
//
// Bricht ab, sobald ein einzelner Aufruf über ZEIT_ABBRUCH_MS geht.
// Ausführen: node spikes/tmp-strip-zeit.mjs

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const ZEIT_ABBRUCH_MS = 30000;

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
console.log('Status:', await page.evaluate(() => document.getElementById('status').textContent));

// Bewegung lösen (einmal), damit der Renderer-Port gelöste Frames hat. Die
// Dauer des Lösens ist NICHT Teil der Streifenmessung. Vorher eine Timeline
// setzen (60 Frames, 4 Phasen) — ohne die ist frameCount 0 und der Löser
// lehnt ab.
await page.evaluate(() => window.__tools.rufe('set_duration', { frameCount: 60 }));
await page.evaluate(() => window.__tools.rufe('set_intent',
  { checks: [{ kind: 'airtime', minSek: 0.4 }] }));
// set_intent wartet auf den menschlichen Klick — den nimmt die Messung selbst ab.
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
const loesung = await page.evaluate(() => {
  const z0 = window.__tools.store.roh();
  const timeline = {
    schemaVersion: z0.schemaVersion, fps: z0.fps, frameCount: z0.frameCount,
    rotationFormat: z0.rotationFormat, phases: z0.phases, overrides: z0.overrides,
  };
  const t0 = performance.now();
  const solved = window.__ports.solver.loese(timeline);
  return { ms: Math.round(performance.now() - t0), n: solved.frames.length };
});
console.log(`Lösung: ${loesung.n} Frames in ${loesung.ms} ms (einmalig, vor der Messung)`);

const rufeStreifen = (frames, views) => page.evaluate(([f, v]) => {
  const t0 = performance.now();
  try {
    const [e] = window.__ports.renderer.streifen({ frames: f, views: v });
    return { ok: true, ms: performance.now() - t0, panels: e.panels,
      breite: e.width, hoehe: e.height, bytes: e.bytes,
      warnung: (e.warnungen ?? []).join(' | ') };
  } catch (err) {
    return { ok: false, ms: performance.now() - t0, fehler: err.message };
  }
}, [frames, views]);

const zeile = (name, m) => console.log(
  `${name.padEnd(36)} ${String(Math.round(m.ms)).padStart(8)} ms  `
  + `Panels ${String(m.panels).padStart(3)}  ${String(m.breite)}×${m.hoehe} px  `
  + `${Math.round(m.bytes / 1024)} KB`);

// ── Kurve 1: 1 Ansicht, Frames steigern (Mesh-Weg) ───────────────────────────
console.log('\n=== Kurve 1: Mesh, 1 Ansicht (side), Frames steigen ===');
for (const n of [1, 2, 4, 6, 8, 12]) {
  const m = await rufeStreifen(Array.from({ length: n }, (_, i) => i), ['side']);
  if (!m.ok) { console.log(`n=${n}: nach ${Math.round(m.ms)} ms FEHLER — ${m.fehler}`); break; }
  zeile(`${n} Frame${n === 1 ? '' : 's'} × 1 Ansicht`, m);
  if (m.ms > ZEIT_ABBRUCH_MS) { console.log('— Abbruchgrenze 30 s erreicht'); break; }
}

// ── Kurve 2: 2 Frames, Ansichten steigern ────────────────────────────────────
console.log('\n=== Kurve 2: Mesh, 2 Frames, Ansichten steigen ===');
for (const v of [['side'], ['side', 'front'], ['side', 'front', 'quarter'], ['side', 'front', 'quarter', 'top']]) {
  const m = await rufeStreifen([0, 1], v);
  if (!m.ok) { console.log(`${v.join('+')}: nach ${Math.round(m.ms)} ms FEHLER — ${m.fehler}`); break; }
  zeile(`2 Frames × ${v.length} Ansichten`, m);
  if (m.ms > ZEIT_ABBRUCH_MS) { console.log('— Abbruchgrenze 30 s erreicht'); break; }
}

// ── Kurve 3: Worst Case aus validate/look: bis 12 × 2 ────────────────────────
console.log('\n=== Kurve 3: Mesh, 2 Ansichten, Worst Case ===');
for (const n of [4, 6, 8, 12]) {
  const m = await rufeStreifen(Array.from({ length: n }, (_, i) => i * 2), ['side', 'front']);
  if (!m.ok) { console.log(`n=${n}: nach ${Math.round(m.ms)} ms FEHLER — ${m.fehler}`); break; }
  zeile(`${n} Frames × 2 Ansichten`, m);
  if (m.ms > ZEIT_ABBRUCH_MS) { console.log('— Abbruchgrenze 30 s erreicht'); break; }
}

// ── Worst Case: 12 Frames × 4 Ansichten (MAX_PANELS) — wie es `look` fordern kann ─
console.log('\n=== Kurve 5: 12 Frames × 4 Ansichten (48 Panels, MAX_PANELS) ===');
const worst = await rufeStreifen(Array.from({ length: 12 }, (_, i) => i), ['side', 'front', 'quarter', 'top']);
if (worst.ok) zeile('12 Frames × 4 Ansichten', worst);
else console.log(`nach ${Math.round(worst.ms)} ms FEHLER — ${worst.fehler}`);

// ── Referenz: Overlay ohne Mesh (kein WebGL) ─────────────────────────────────
console.log('\n=== Referenz: Overlay ohne Mesh (Kapseln, kein WebGL) ===');
const overlay = await page.evaluate(async (nF) => {
  const strip = await import(new URL('src/render/strip.js', document.baseURI).href);
  const { loadGLB } = await import(new URL('src/scene/load.js', document.baseURI).href);
  const { measureRigProfile } = await import(new URL('src/rig/measure.js', document.baseURI).href);
  const antwort = await fetch(new URL('spikes/test-b-motion/assets/Xbot.glb', document.baseURI).href);
  const gltf = await loadGLB(await antwort.arrayBuffer());
  gltf.scene.updateMatrixWorld(true);
  const profil = measureRigProfile(gltf, { fileName: 'Xbot.glb' });
  const frame = strip.frameAusScene(gltf.scene, { frame: 0 });
  const frames = Array.from({ length: nF }, (_, i) => ({ ...frame, frame: i }));
  const t0 = performance.now();
  const eintrag = strip.bildeStreifen({ profile: profil, frames, views: ['side'] });
  return { ok: true, ms: performance.now() - t0, panels: eintrag.panels,
    breite: eintrag.width, hoehe: eintrag.height, bytes: eintrag.bytes };
}, 4);
if (overlay.ok) zeile(`OHNE Mesh, 4 Frames × 1 Ansicht`, overlay);

console.log('\nMessung fertig.');
await browser.close();
proc.kill();