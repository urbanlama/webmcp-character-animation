// Erzeugt einen echten Bildstreifen einer vom Löser erzeugten Bewegung und legt
// ihn als PNG ab. Wegwerfcode (spikes/), nicht Teil des Produkts.
//
// Der Weg ist NICHT neu gebaut: derselbe Lauf wie tests/e2e/durchlauf.browser.test.mjs —
// tools/serve.mjs als Datei-Server, chromium mit swiftshader, der Vertikalschnitt
// (tests/e2e/durchlauf.mjs) läuft IN der Seite gegen index.html, mit dem echten
// Modellupload über das Eingabefeld, und src/render/strip.js rendert die Pixel.
// Der einzige Unterschied: statt der Berichtsauswahl fordert dieses Skript am Ende
// vomselben Renderer-Port einen Schau-Streifen an — 8 Frames über die vier Sprung-
// phasen, alle vier festen Ansichten aus src/render/strip.js:ANSICHTEN.
//
//   node spikes/bildstreifen/erzeuge.mjs [zielpng]
//
// Kein Körpermaß wird getippt: Höhe, Radien, Gelenke, Sohlen kommen aus
// src/rig/measure.js am geladenen Modell. Die Phasenzahlen sind Versuchsaufbau.

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const XBOT = join(REPO, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb');
const ZIEL = process.argv[2] ?? join(HIER, 'sprung-streifen.png');

const STARTZEILE = /Server läuft: (http:\/\/localhost:\d+\/)/;

/** Derselbe Server, dieselbe Port-Vergabe wie tests/e2e/durchlauf.browser.test.mjs. */
function serverStart() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(REPO, 'tools', 'serve.mjs')], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const zeitlimit = setTimeout(() => {
      proc.kill();
      reject(new Error('Server meldet seine Startzeile mit URL nicht innerhalb von 10000 ms'));
    }, 10000);
    let gepuffert = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      gepuffert += chunk;
      const m = gepuffert.match(STARTZEILE);
      if (m) { clearTimeout(zeitlimit); resolve({ proc, basis: m[1] }); }
    });
    proc.on('exit', (code) => {
      clearTimeout(zeitlimit);
      if (code !== 0) reject(new Error(`Server endete vor der Startmeldung, Code ${code}`));
    });
  });
}

// 8 Frames über die vier Phasen des Sprungs (Versuchsaufbau, keine Körpermaße).
// crouch 0–18: 0 aufrecht, 9 in der Hocke, 18 tiefste Hocke
// takeoff 18–26: 22 Streckung
// airborne 26–44: 30 Flug (früh), 44 Flugende kurz vor dem Kontakt
// land 44–58: 50 Abfedern, 58 aufgerichtet
const SCHAU_FRAMES = [0, 9, 18, 22, 30, 44, 50, 58];
const SCHAU_ANSICHTEN = ['front', 'side', 'quarter', 'top'];

let server;
let browser;
try {
  const start = await serverStart();
  server = start.proc;
  console.log(`Server: ${start.basis}`);

  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log(`SEITENFEHLER: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`KONSOLE(${msg.type()}): ${msg.text()}`);
  });

  await page.goto(start.basis, { waitUntil: 'load' });
  console.log(`window.__boot = ${JSON.stringify(await page.evaluate(() => window.__boot ?? null))}`);
  console.log(`status = ${JSON.stringify(await page.evaluate(() => document.getElementById('status')?.textContent ?? null))}`);
  if (!(await page.evaluate(() => !!window.__boot?.bereit))) {
    throw new Error('Seitenmodul wurde nicht ausgeführt — ohne geladene Seite gibt es keinen Weg');
  }
  await page.setInputFiles('#file', XBOT).catch((err) => {
    console.log(`SETINPUTFILES-FEHLER: ${err.message}`);
  });
  try {
    // Der Seitenlauf setzt den Status VOR der Vermessung ("Knochen") und hängt
    // nach ihr "not measured" oder gar einen Ladefehler an (index.html:messeFuerWerkzeuge).
    // Gewartet wird deshalb auf das ENDE: "bones" mit gemessener Zeile oder ein
    // Scheitern. Nur "bones" abzuwarten kann das Ende verpassen.
    await page.waitForFunction(() => {
      const s = document.getElementById('status');
      return !!s && /(bones —|measured|not measured|Could not load)/.test(s.textContent)
        && s.textContent.indexOf('No model loaded') < 0;
    }, null, { timeout: 30000 });
  } catch (err) {
    await page.screenshot({ path: join(HIER, 'diag-nach-upload.png'), fullPage: true });
    console.log(`STATUS blieb bei: ${JSON.stringify(await page.evaluate(() => document.getElementById('status')?.textContent))}`);
    console.log(`ERROR-Feld: ${JSON.stringify(await page.evaluate(() => document.getElementById('error')?.textContent))}`);
    console.log(`Datei-Element: ${JSON.stringify(await page.evaluate(() => {
      const f = document.getElementById('file');
      return f ? { vorhanden: true, dateien: f.files.length } : null;
    }))}`);
    throw err;
  }

  /** Solver-Dateien aus Node nachgesehen, damit beide Zweige dieselbe Liste sehen. */
  const SOLVER_DATEIEN = readdirSync(join(REPO, 'src', 'solver'))
    .filter((n) => n.endsWith('.js')).map((n) => `src/solver/${n}`);

  const raus = await page.evaluate(async ({ solverDateien, schauFrames, schauAnsichten }) => {
    const { durchlauf, berichtText } = await import('/tests/e2e/durchlauf.mjs');

    // Derselbe Renderer-Anschluss wie im e2e-Test: mit Szene, also mit Mesh;
    // scheitert das, fällt er auf die Rasterung aus den gemessenen
    // Segmentradien zurück und meldet den Grund.
    const scene = window.__scene?.scene ?? null;
    const webgl = window.__scene?.renderer ?? null;
    const profilBereit = { profil: null, frames: null, frameCount: null };

    window.__streifenBefund = { mesh: true, grund: null };
    async function rendererFabrik({ profile, frames, frameCount }) {
      profilBereit.profil = profile;
      profilBereit.frames = frames;
      profilBereit.frameCount = frameCount;
      const { createStripRenderer } = await import('/src/render/strip.js');
      const gemeinsam = { profile, frames, frameCount };
      const mitMesh = createStripRenderer({
        ...gemeinsam, scene, renderer: webgl, canvas: webgl.domElement,
      });
      let ohneMesh = null;
      return {
        streifen(arg) {
          try {
            return mitMesh.streifen(arg);
          } catch (err) {
            window.__streifenBefund = { mesh: false, grund: String(err.message ?? err) };
            ohneMesh = ohneMesh ?? createStripRenderer({ ...gemeinsam, scene: undefined });
            return ohneMesh.streifen(arg);
          }
        },
      };
    }

    const ergebnis = await durchlauf({
      moduleUrl: (datei) => '/' + datei,
      existiert: async (datei) => (await fetch('/' + datei, { method: 'HEAD' })).ok,
      glbBytes: async () => new Uint8Array(
        await (await fetch('/spikes/test-b-motion/assets/Xbot.glb')).arrayBuffer()),
      solverDateien,
      umgebungsname: 'browser-spike',
      scene,
      streifenRenderer: rendererFabrik,
    });

    // Der Schau-Streifen kommt vom SELBSEN Renderer wie Schritt 7 — nur mit
    // der eigenen Frame-Auswahl allen vier Ansichten. Es gibt keinen zweiten Weg.
    const schauFrames2 = schauFrames;
    const schauAnsichten2 = schauAnsichten;
    return new Promise(async (resolveErgebnis) => {
      // rendererFabrik liefert den Renderer nur während des Laufs; er wurde
      // dort geschlossen erzeugt. Erneutes Aufrufen bedarf neuer Argumente —
      // deshalb der Schau-Streifen als zweiter Lauf der Fabrik mit denselben
      // Messungen aus dem bereits gelaufenen Durchlauf.
      try {
        const renderer = await rendererFabrik({
          profile: profilBereit.profil,
          frames: profilBereit.frames,
          frameCount: profilBereit.frameCount,
        });
        const eintrag = renderer.streifen({
          frames: schauFrames2, views: schauAnsichten2,
        })[0];
        resolveErgebnis({
          text: berichtText(ergebnis),
          endeteBei: ergebnis.endeteBei,
          schau: {
            bytes: eintrag.bytes,
            breite: eintrag.width,
            hoehe: eintrag.height,
            panels: eintrag.panels,
            meshGezeichnet: eintrag.meshGezeichnet,
            data: eintrag.data,
            massstab: eintrag.massstab,
            frames: eintrag.framesZusammenfassung,
            warnungen: eintrag.warnungen,
            bezug: eintrag.bezug,
          },
          streifenBefund: window.__streifenBefund,
        });
      } catch (err) {
        resolveErgebnis({
          text: berichtText(ergebnis),
          endeteBei: ergebnis.endeteBei,
          schau: null,
          schauFehler: String((err && err.message) ?? err),
          streifenBefund: window.__streifenBefund,
        });
      }
    });
  }, {
    solverDateien: SOLVER_DATEIEN,
    schauFrames: SCHAU_FRAMES,
    schauAnsichten: SCHAU_ANSICHTEN,
  });

  console.log('\n' + raus.text + '\n');

  if (!raus.schau) {
    throw new Error(`Schau-Streifen nicht erzeugt: ${raus.schauFehler}`);
  }
  console.log(`Streifenbefund: ${raus.streifenBefund.mesh ? 'MIT Mesh' : 'OHNE Mesh'}`
    + (raus.streifenBefund.grund ? ` (${raus.streifenBefund.grund})` : ''));

  const png = Buffer.from(raus.schau.data, 'base64');
  mkdirSync(dirname(ZIEL), { recursive: true });
  writeFileSync(ZIEL, png);
  console.log(`\nPNG geschrieben: ${ZIEL}`);
  console.log(`  Bildmaße: ${raus.schau.breite} × ${raus.schau.hoehe} px, `
    + `${raus.schau.panels} Panels, Dateigröße ${png.length} Byte`);
  console.log(`  Mesh gezeichnet: ${raus.schau.meshGezeichnet}`);
  console.log(`  Maßstab: ${JSON.stringify(raus.schau.massstab)}`);
  console.log(`  Warnungen: ${JSON.stringify(raus.schau.warnungen)}`);
  for (const f of raus.schau.frames) {
    console.log(`  Frame ${String(f.index).padStart(2)}: Phase ${f.phase}, `
      + `Kontakt ${f.kontakt}/${f.sohlen} Sohlen, SP y=${f.schwerpunkt[1]} `
      + `(${f.schwerpunktQuelle})`);
  }
  await page.close();
} finally {
  await browser?.close();
  server?.kill();
}