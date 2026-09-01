#!/usr/bin/env node
// Wegwerf-Prüfung des Kamera-Clippings an der echten Seite (spikes/ = Wegwerfcode).
// Lädt Xbot, zoomt in drei Stufen stark heran, dreht jeweils und misst:
// 1. near/far an der Kamera, 2. ob alle projizierten Boxecken im NDC-Würfel
// bleiben (nichts abgeschnitten), 3. Screenshots fürs Auge.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], {
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const startZeile = await new Promise((resolve, reject) => {
  let puffer = '';
  server.stdout.on('data', (d) => {
    puffer += d.toString();
    const m = puffer.match(/Server läuft: (http:\/\/localhost:\d+\/)/);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error('Server startete nicht')), 10000);
});
console.log('Server:', startZeile);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(startZeile);

// Beispiel-Robot laden
await page.click('#einstieg-beispiel');
await page.waitForFunction(() => window.__scene?.model, null, { timeout: 15000 });
await page.waitForTimeout(500);

const bericht = await page.evaluate(() => {
  const kamera = window.__scene.camera;
  return { near: kamera.near, far: kamera.far, pos: kamera.position.toArray() };
});
console.log('Rahmung:', bericht);

// Zoom-Stufen: Rad-Events heran, dann Drehung, dann Eckprojektion messen.
const stab = async (label, rueder, dreh) => {
  const r = await page.evaluate(async ({ rueder, dreh }) => {
    const canvas = document.querySelector('canvas');
    const feld = canvas.getBoundingClientRect();
    // Rad: Zoom
    for (let i = 0; i < rueder; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, clientX: feld.left + feld.width / 2, clientY: feld.top + feld.height / 2,
        bubbles: true, cancelable: true,
      }));
    }
    // Drehen: Drag
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, buttons: 1, clientX: feld.left + 400, clientY: feld.top + 300, pointerId: 1, isPrimary: true, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      button: 0, buttons: 1, clientX: feld.left + 400 + dreh, clientY: feld.top + 340, pointerId: 1, isPrimary: true, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      button: 0, clientX: feld.left + 400 + dreh, clientY: feld.top + 340, pointerId: 1, bubbles: true,
    }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const kamera = window.__scene.camera;
    const model = window.__scene.model;
    // Box über die Sample-Hilfe messen, falls vorhanden; sonst setFromObject
    const THREE = await import('/vendor/three.module.min.js');
    const box = new THREE.Box3().setFromObject(model);
    const ecken = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          ecken.push(new THREE.Vector3(x, y, z).project(kamera).toArray());
    const ausserhalb = ecken.filter((e) => e[2] < -1 || e[2] > 1).length;
    return {
      near: +kamera.near.toFixed(4), far: +kamera.far.toFixed(4),
      abstand: +kamera.position.distanceTo(box.getCenter(new THREE.Vector3())).toFixed(3),
      eckenAusserhalbTiefe: ausserhalb,
    };
  }, { rueder, dreh });
  console.log(`${label}: near=${r.near} far=${r.far} Abstand=${r.abstand} Ecken außerhalb [−1,1] der Tiefe: ${r.eckenAusserhalbTiefe}`);
  await page.screenshot({ path: join(HERE, `shots/clip-${label.replace(/\W+/g, '-')}.png`) });
  return r;
};

await stab('rahmung', 0, 0);
await stab('nah-1', 10, 0);
await stab('nah-2-drehung', 10, 200);
await stab('nah-3-extrem', 30, 350);
await stab('seitlich', 0, 320);

await browser.close();
server.kill();
console.log('fertig');