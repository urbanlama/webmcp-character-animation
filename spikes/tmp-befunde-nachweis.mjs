#!/usr/bin/env node
// Browsernachweise für die vier Befunde aus der Sichtprüfung.
// Wegwerfskript (spikes-Konvention): misst vorher/nachher und zeigt Zahlen.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { XBOT_PFAD } from '../src/scene/testdaten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/serve.mjs meldet seine URL auf stdout; stderr existiert dort nicht.
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
console.log('Status:', await page.evaluate(() => document.getElementById('status').textContent));

// Eine evtl. automatisch offene Rollenfrage abbrechen, damit wir selbst fragen.
const wartet = await page.evaluate(() => window.__tools?.ask.stand().wartet === true);
if (wartet) {
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__tools.ask.stand().wartet === false, null, { timeout: 5000 });
}

async function figurBreiteMessen() {
  return page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.min.js', document.baseURI).href);
    const { getBounds } = await import(new URL('src/scene/load.js', document.baseURI).href);
    const box = getBounds(window.__scene.model);
    const leinwand = document.getElementById('view').getBoundingClientRect();
    const ecken = [
      [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
      [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
      [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
      [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z],
    ];
    let links = Infinity, rechts = -Infinity;
    for (const e of ecken) {
      const p = new THREE.Vector3(...e).project(window.__scene.camera);
      const px = leinwand.left + (p.x * 0.5 + 0.5) * leinwand.width;
      links = Math.min(links, px); rechts = Math.max(rechts, px);
    }
    return Math.round(rechts - links);
  });
}

const budgetLesen = () => page.evaluate(
  () => document.getElementById('frage-budget')?.textContent ?? '(kein Panel sichtbar)');
const panelBreite = () => page.evaluate(() => {
  const r = document.getElementById('seite').getBoundingClientRect();
  return Math.round(r.width);
});

// 10 Pflichtfragen (Rollenbestätigung) nacheinander — derselbe Weg wie im Befund.
await page.evaluate(() => {
  window.__rollenErgebnis = null;
  const fragen = Array.from({ length: 10 }, (_, i) => ({
    art: 'rollenbestaetigung', rolle: `rolle_${i}`,
    frage: `Ist „knochen_${i}“ die Rolle rolle_${i}? Vorschlag mit Konfidenz 0.6${i}, sicher ab 0.9.`,
    optionen: [
      { text: `ja, „knochen_${i}“`, bone: `knochen_${i}`, confidence: 0.6 },
      { text: `nein, sondern „knochen_${i}b“`, bone: `knochen_${i}b`, confidence: 0 },
    ],
  }));
  window.__ui.rollenAbfragen({ schemaVersion: 1, roles: {}, questions: fragen })
    .then((r) => { window.__rollenErgebnis = r; });
});
await page.waitForFunction(() => !document.getElementById('frage').hidden, null, { timeout: 5000 });

console.log('\n=== FRAGE 1 ===');
console.log('Budget:', await budgetLesen());
console.log('Spaltenbreite:', await panelBreite(), 'px');
console.log('Figurbreite:', await figurBreiteMessen(), 'px');

for (let i = 0; i < 10; i += 1) {
  await page.waitForFunction(
    () => window.__tools.ask.stand().wartet === true,
    null, { timeout: 5000 });
  await page.click('#frage-optionen button[data-index="0"]');
}
await page.waitForFunction(() => window.__rollenErgebnis !== null, null, { timeout: 5000 });

// Figurbreite erneut messen — Panel ist jetzt weg, deshalb über eine neue Frage.
await frageStellenUndMessen();
async function frageStellenUndMessen() {
  await page.evaluate(() => {
    window.__ui.rollenAbfragen({
      schemaVersion: 1, roles: {},
      questions: [{ art: 'rollenbestaetigung', rolle: 'p', frage: 'Nachfrage nach 10 Fragen?',
        optionen: [{ text: 'a', bone: 'a', confidence: 0.6 }, { text: 'b', bone: 'b', confidence: 0 }] }],
    }).then((r) => { window.__zweite_runde = r; });
  });
  await page.waitForFunction(() => !document.getElementById('frage').hidden, null, { timeout: 5000 });
}
console.log('\n=== FRAGE 11 (nach 10 beantworteten) ===');
console.log('Budget:', await budgetLesen());
console.log('Spaltenbreite:', await panelBreite(), 'px');
console.log('Figurbreite:', await figurBreiteMessen(), 'px');

const spur = await page.evaluate(() =>
  [...document.querySelectorAll('.spur-zeile .ergebnis')].map((z) => z.textContent));
console.log('\n=== SPUR ===');
console.log('Zeilen:', spur.length);
console.log('Rollenmeldung (vollständig?):', spur.find((z) => z.includes('Zuordnung')) ?? '(keine)');

const boden = await page.evaluate(async () => {
  const { createBodengitter } = await import(new URL('src/ui/bodengitter.js', document.baseURI).href);
  const g = createBodengitter({ scene: window.__scene.scene, model: window.__scene.model });
  const imBaum = window.__scene.scene.getObjectByName('bodengitter');
  return { stand: g.stand(), imBaum: !!imBaum, posY: imBaum?.position.y ?? null };
});
console.log('\n=== BODEN ===');
console.log(JSON.stringify(boden));

await browser.close();
proc.kill();