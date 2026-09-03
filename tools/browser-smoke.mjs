#!/usr/bin/env node
// Laedt die Seite, laedt das Modell, loest eine Bewegung — im echten Browser.
//
//   node tools/browser-smoke.mjs            gegen localhost
//   node tools/browser-smoke.mjs --live     gegen die veroeffentlichte Seite
//
// Warum es das gibt: am 3. September 2026 blieben zwei `process.env`-Abfragen
// im Loeser stehen. In Node laufen sie durch, im Browser gibt es kein
// `process` — jeder Werkzeugaufruf, der den Loeser anfasst, endete mit
// "process is not defined". 547 gruene Node-Tests haben das nicht gesehen,
// weil keiner den Loeser IM Browser aufruft. Der Agentenlauf danach war
// verloren.
//
// Dieser Test nimmt den Weg des Agenten: Seite, Modell, window.__tools.rufe.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const LIVE = process.argv.includes('--live');
const LIVE_URL = 'https://urbanlama.github.io/webmcp-character-animation/';
const XBOT = 'beispiel/Xbot.glb';

function serverStart() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['tools/serve.mjs'], {
      env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const t = setTimeout(() => { proc.kill(); reject(new Error('Server meldet sich nicht in 10000 ms')); }, 10000);
    let b = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c) => {
      b += c;
      const m = b.match(/Server läuft: (http:\/\/localhost:\d+\/)/);
      if (m) { clearTimeout(t); resolve({ proc, basis: m[1] }); }
    });
  });
}

let server = null;
const basis = LIVE ? LIVE_URL : (server = await serverStart()).basis;
console.log(`Seite: ${basis}`);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let schlecht = 0;
try {
  const page = await browser.newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(String(e.message)));
  await page.goto(basis, { waitUntil: 'load' });
  await page.setInputFiles('#file', XBOT);
  await page.waitForFunction(() => !!window.__scene?.model && !!window.__tools, null, { timeout: 40000 });

  const r = await page.evaluate(async () => {
    const rufe = async (n, a) => {
      const x = await window.__tools.rufe(n, a);
      return {
        ok: x?.isError !== true,
        text: (x?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' '),
      };
    };
    const schritte = [
      ['describe_world', {}],
      ['set_duration', { frameCount: 40 }],
      ['set_pose', { frame: 0, joints: { arm_l: { lift: -70 }, knee_l: { bend: 20 } }, ease: 'smooth' }],
      ['set_joint', { frame: 20, joints: { arm_l: { lift: 10, swing: 30 }, arm_r: { lift: 10 } } }],
      ['hold_foot', { foot: 'foot_l', von: 0, bis: 20 }],
      ['describe_pose', { frame: 20 }],
      ['validate', {}],
    ];
    const out = [];
    for (const [n, a] of schritte) out.push({ name: n, ...(await rufe(n, a)) });
    return out;
  });

  for (const s of r) {
    const kurz = (s.text || '').split('\n')[0].slice(0, 110);
    console.log(`${s.ok ? '  ok ' : '  FEHLER '} ${s.name.padEnd(15)} ${kurz}`);
    if (!s.ok) schlecht++;
  }
  if (fehler.length) {
    schlecht += fehler.length;
    for (const f of fehler.slice(0, 3)) console.log(`  SEITENFEHLER: ${f}`);
  }
  console.log(`\n${r.length} Aufrufe, ${schlecht} Probleme, ${fehler.length} Seitenfehler`);
} finally {
  await browser.close();
  if (server) server.proc.kill();
}
process.exitCode = schlecht > 0 ? 1 : 0;
