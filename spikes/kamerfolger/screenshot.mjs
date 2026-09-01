// Screenshot der Welt-Startrahmung (wegwerfbar) — Vergleich gegen das
// gewünschte Startbild des Menschen.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8124;
const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const seite = await browser.newPage({ viewport: { width: 662, height: 790 } });
  await seite.goto(`http://localhost:${PORT}/index.html`);
  await seite.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await seite.waitForFunction(() => window.__scene?.model, null, { timeout: 30000 });
  await seite.evaluate(() => document.querySelectorAll('.ansicht-knopf')[1]?.click());
  await seite.waitForTimeout(600);
  await seite.screenshot({ path: 'spikes/kamerfolger/start-welt.png' });

  // Messwerte zur Rahmung: Figuranteil der Bildhöhe, Figurenmitte, Horizont.
  const mass = await seite.evaluate(() => {
    const k = window.__scene.camera;
    const t = window.__scene.controls.target;
    const V = k.position.constructor;           // THREE.Vector3, aus der Seite
    const leinwand = document.getElementById('view');
    const h = leinwand.clientHeight;
    const projiziere = (v) => {
      const p = v.clone().project(k);
      return { yAnteil: (1 - (p.y + 1) / 2) };
    };
    // Kopf und Fuß aus der Modell-Traverse messen (Regel 1: gemessen, nicht
    // getippt) — über die Weltposition der Haut, nicht über eine Annahme.
    // SkinnedMesh: die Geometrie-Bounding-Box liegt in Bind-Pose am Ursprung;
    // gezählt werden die Ecken der LOKalen Box, transformiert je Mesh —
    // bei skinnierten Modellen mit Skeleton zusätzlich die Knochenweltposen.
    let minY = Infinity, maxY = -Infinity;
    const zulaessig = (w) => Number.isFinite(w) && Math.abs(w) < 1000;
    window.__scene.model.traverse((o) => {
      let punkte = null;
      if (o.isSkinnedMesh && o.skeleton) {
        punkte = o.skeleton.bones.map((b) => new V().setFromMatrixPosition(b.matrixWorld));
      } else if (o.isMesh) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        punkte = [
          new V(b.min.x, b.min.y, b.min.z), new V(b.max.x, b.max.y, b.max.z),
          new V(b.min.x, b.max.y, b.min.z), new V(b.max.x, b.min.y, b.max.z),
        ].map((p) => p.applyMatrix4(o.matrixWorld));
      }
      if (!punkte) return;
      for (const w of punkte) {
        if (!zulaessig(w.y)) continue;
        minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
      }
    });
    const mitte = new V(0, (minY + maxY) / 2, 0);
    const kopf = projiziere(new V(0, maxY, 0));
    const fuss = projiziere(new V(0, minY, 0));
    // Horizont: ein Weltpunkt weit weg auf Kamerahöhe, in Blickrichtung.
    const blick = new V(); k.getWorldDirection(blick); blick.y = 0; blick.normalize();
    const horizont = projiziere(k.position.clone().add(blick.multiplyScalar(1000)));
    return {
      abstand: +k.position.distanceTo(t).toFixed(3),
      azimuth: +(Math.atan2(k.position.x - t.x, k.position.z - t.z) * 180 / Math.PI).toFixed(2),
      koerperhoehe: +(maxY - minY).toFixed(4),
      figurenHoeheAnteil: +(kopf.yAnteil - fuss.yAnteil).toFixed(4),
      kopfYAnteil: +kopf.yAnteil.toFixed(4),
      fussYAnteil: +fuss.yAnteil.toFixed(4),
      horizontYAnteil: +horizont.yAnteil.toFixed(4),
    };
  });
  console.log('Rahmung:', JSON.stringify(mass));
  await browser.close();
} finally {
  server.kill();
}