// Browser-Prüfung des Welt-Kamerafolgers (wegwerfbar, wie spikes/).
//
// Fährt die Seite, schaltet in die Welt, baut über die Werkzeugschicht einen
// gehenden Clip und prüft an echten Kameraständen:
//   1. Figur läuft weg — Kamera folgt (Drehpunkt wandert mit).
//   2. Richtung und Abstand der Kamera bleiben beim Mitfahren erhalten.
//   3. Zoomgrenzen in der Welt sind körperrelativ (1,6 .. 4 × Körperhöhe).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8123;
const seite = `http://localhost:${PORT}/index.html`;

const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const seite1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fehler = [];
  seite1.on('pageerror', (e) => fehler.push(String(e)));
  await seite1.goto(seite);
  await seite1.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await seite1.waitForFunction(() => window.__scene?.model, null, { timeout: 30000 });

  // root.pos der Clip-Enden direkt aus dem Löser messen (dieselbe Schicht,
  // die die Leiste speist).
  const wurzel = await seite1.evaluate(async () => {
    const t = window.__tools;
    await t.rufe('set_duration', { frameCount: 60 });
    await t.rufe('add_phase', { verb: 'step', from: 0, to: 15, params: { weite: 0.5, richtung: 0, fuss: 'l' } });
    await t.rufe('add_phase', { verb: 'step', from: 15, to: 30, params: { weite: 0.5, richtung: 0, fuss: 'r' } });
    await t.rufe('add_phase', { verb: 'step', from: 30, to: 45, params: { weite: 0.5, richtung: 0, fuss: 'l' } });
    await t.rufe('add_phase', { verb: 'step', from: 45, to: 60, params: { weite: 0.5, richtung: 0, fuss: 'r' } });
    // gelöste Frames über den Port holen — derselbe Weg wie in der Leiste.
    const z = window.__tools.store.roh();
    const frames = window.__ports.loeseFuerSzene({
      schemaVersion: z.schemaVersion, fps: z.fps, frameCount: z.frameCount,
      rotationFormat: z.rotationFormat, phases: z.phases, overrides: z.overrides,
    });
    return {
      root0: frames[0]?.root?.pos ?? null,
      rootN: frames[frames.length - 1]?.root?.pos ?? null,
      bones0: Object.keys(frames[0]?.bones ?? {}).length,
    };
  });
  console.log('Wurzelpos:', JSON.stringify(wurzel));

  // In die Welt schalten und einen Walk-Clip über die Werkzeugschicht bauen.
  const rahmung = await seite1.evaluate(async () => {
    document.querySelectorAll('.ansicht-knopf')[1]?.click();   // Welt
    await new Promise((r) => setTimeout(r, 400));
    const t = window.__tools;
    await t.rufe('set_duration', { frameCount: 60 });
    // Ein gehender Clip über Wurzel-Overrides: die Figur fährt von z=0 nach
    // z=1 m. Das LETZTE Schlüsselbild liegt auf Frame 59, weil Wurzelkanäle
    // absichtlich über ihr letztes Schlüsselbild hinaus nicht wirken — ohne
    // Schlüssel am Ende springe die Figur zurück.
    for (let f = 0; f < 60; f += 10) {
      const z = Math.min(59, f);
      await t.rufe('set_pose', {
        frame: z,
        root: { pos: [0, 1.04, z * 0.02] },
        joints: { hip_l: { flex: 0 }, hip_r: { flex: 0 } },
      });
    }
    const welt = await t.rufe('describe_world', {});
    const weltJson = JSON.parse(welt.content?.[0]?.text ?? '{}');
    const hoehe = weltJson.height;
    return {
      ansicht: document.body.className,
      kameraPos: window.__scene.camera.position.toArray(),
      ziel: window.__scene.controls.target.toArray(),
      minDistanz: window.__scene.controls.minDistance,
      maxDistanz: window.__scene.controls.maxDistance,
      hoehe,
    };
  });
  await seite1.waitForTimeout(300);

  // Clip abspielen und Kamerastände Anfang/Ende messen.
  const messung = await seite1.evaluate(async () => {
    const abspieler = window.__abspieler;
    abspieler.pruefe();
    const stand0 = abspieler.stand();
    if (!stand0.bereit) return { bereit: false, grund: stand0.grund };
    const kamera0 = window.__scene.camera.position.clone();
    const ziel0 = window.__scene.controls.target.clone();

    abspieler.umschalten();
    await new Promise((r) => setTimeout(r, 3500));   // Clip ablaufen lassen

    const kamera1 = window.__scene.camera.position.clone();
    const ziel1 = window.__scene.controls.target.clone();
    const stand1 = abspieler.stand();
    return {
      bereit: true,
      index0: stand0.index, index1: stand1.index, frameCount: stand1.frameCount,
      kamera0: kamera0.toArray(), kamera1: kamera1.toArray(),
      ziel0: ziel0.toArray(), ziel1: ziel1.toArray(),
      abstand0: kamera0.distanceTo(ziel0),
      abstand1: kamera1.distanceTo(ziel1),
      winkelGrad: kamera0.clone().sub(ziel0).normalize()
        .angleTo(kamera1.clone().sub(ziel1).normalize()) * 180 / Math.PI,
      zielFahrt: ziel1.distanceTo(ziel0),
      root0: null, root1: null,
    };
  });
  await browser.close();

  console.log('Rahmung:', JSON.stringify(rahmung));
  console.log('Messung:', JSON.stringify(messung, null, 2));
  console.log('Seitenfehler:', fehler.length ? fehler : 'keine');

  // Prüfungen mit Zahlen.
  const p = [];
  const pruefe = (ok, text) => { p.push({ ok, text }); console.log(ok ? 'OK ' : 'FEHLER ', text); };
  if (!messung.bereit) {
    pruefe(false, `Abspieler nicht bereit: ${messung.grund}`);
  } else {
    pruefe(messung.zielFahrt > 0.3,
      `Drehpunkt ist der Figur gefolgt: ${messung.zielFahrt.toFixed(3)} m Fahrt`);
    pruefe(Math.abs(messung.abstand1 - messung.abstand0) < 0.02,
      `Abstand erhalten: ${messung.abstand0.toFixed(3)} m → ${messung.abstand1.toFixed(3)} m`);
    pruefe(messung.winkelGrad < 0.5,
      `Blickrichtung erhalten: ${messung.winkelGrad.toFixed(6)}° Kippung`);
    const hoehe = rahmung.minDistanz / 1.6;
    pruefe(Math.abs(rahmung.maxDistanz - hoehe * 6) < hoehe * 0.01,
      `Zoomgrenzen körperrelativ: near ${rahmung.minDistanz.toFixed(3)} m, `
      + `far ${rahmung.maxDistanz.toFixed(3)} m bei Körperhöhe ${hoehe.toFixed(3)} m`);
  }
  pruefe(fehler.length === 0, `keine Seitenfehler (${fehler.length})`);
  process.exitCode = p.every((x) => x.ok) ? 0 : 1;
} finally {
  server.kill();
}