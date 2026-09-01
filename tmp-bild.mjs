import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = 'C:/Users/maxbl/Desktop/Projekte/WebMCP_Challenge';
const ZIEL = 'C:/Users/maxbl/Desktop/Projekte/_auftraege';
const srv = spawn(process.execPath, [`${REPO}/tools/serve.mjs`], { cwd: REPO, env: { ...process.env, PORT: '8127' }, stdio: ['ignore','pipe','inherit'] });
await new Promise(r => setTimeout(r, 2500));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto('http://localhost:8127/', { waitUntil: 'networkidle' });
await p.setInputFiles('#file', `${REPO}/spikes/test-b-motion/assets/Xbot.glb`);
await p.waitForTimeout(5000);
const r = await p.evaluate(async () => {
  const t = window.__tools;
  const ruf = async (n, a = {}) => { const x = await t.rufe(n, a); return x?.content ?? x; };
  const text = (c) => (Array.isArray(c) ? c : [c]).filter(x => x?.type === 'text').map(x => String(x.text)).join(' ');
  await ruf('set_duration', { frameCount: 60 });
  const si = text(await ruf('set_intent', { checks: [{ kind: 'airtime', minSek: 0.4 }, { kind: 'part_height', part: 'com', minAnteil: 0.4 }] }));
  for (const ph of [
    { verb: 'crouch', from: 0, to: 18, params: { tiefe: 0.25 } },
    { verb: 'takeoff', from: 18, to: 26, params: { vy: 2.6 } },
    { verb: 'airborne', from: 26, to: 44, params: { einrollen: 0.3 } },
    { verb: 'land', from: 44, to: 58, params: { fuss: 'beide', abfedern: 0.2 } },
  ]) await ruf('add_phase', ph);
  const teile = [].concat(await ruf('validate', {}));
  const bild = teile.find(x => x?.type === 'image');
  return { si: si.slice(0, 150), bericht: text(teile).slice(0, 1100), bild: bild ? bild.data : null };
});
console.log('set_intent:', r.si);
console.log('\n--- validate ---\n' + r.bericht);
if (r.bild) { writeFileSync(`${ZIEL}/bildstreifen.png`, Buffer.from(r.bild, 'base64')); console.log('\nBILD:', Math.round(r.bild.length/1024), 'KB'); } else console.log('\nKEIN BILD');
await b.close(); srv.kill();
