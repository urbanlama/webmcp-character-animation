// AP8 — Vertikalschnitt, Browserzweig: derselbe Lauf gegen die echte Seite.
//
// Warum es diesen Zweig gibt: die Anordnung auf dem Brett (2026-08-30 21:52)
// sagt "Browser nur, wo Pixel entstehen ... der Vertikalschnitt aus AP8". Dieser
// Test baut keinen zweiten Aufbau neben den vorhandenen — er benutzt genau die
// zwei Dinge, die es schon gibt:
//
//   tools/serve.mjs          derselbe Datei-Server, mit PORT=0 wie in
//                            tools/browser-test.mjs, damit kein schon laufender
//                            Server gestört wird
//   chromium + swiftshader   dieselben Launch-Argumente wie dort
//
// Was dieser Zweig weiß und der Node-Zweig nicht kann:
//
//   B1  Der ganze Importgraph des Wegs lädt im Browser und misst dabei
//       BITGLEICH dieselben Zahlen wie Node. Weichen sie ab, ist eine von beiden
//       falsch.
//   B2  Der Bildstreifen kann hier echte Pixel erzeugen; in Node entstehen keine.
//   B3  Die ausgelieferte Seite selbst: an welchem Anschluss ihre Werkzeuge
//       hängen, ist eine Frage an index.html, nicht an src/.
//
// Der Lauf selbst ist importiert, nicht nachgebaut: ./durchlauf.mjs läuft in der
// Seite, mit dem Modellupload durch das echte Eingabefeld als Schritt 1.

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { durchlauf, SCHRITTE, FRAMES } from './durchlauf.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const XBOT = join(REPO, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb');
const STARTZEILE = /Server läuft: (http:\/\/localhost:\d+\/)/;
const WERKZEUGE = 16;

/** Derselbe Server, dieselbe Port-Vergabe wie tools/browser-test.mjs. */
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
      const gemeldete = gepuffert.match(STARTZEILE);
      if (gemeldete) { clearTimeout(zeitlimit); resolve({ proc, basis: gemeldete[1] }); }
    });
    proc.on('exit', (code) => {
      clearTimeout(zeitlimit);
      if (code !== 0) reject(new Error(`Server endete vor der Startmeldung, Code ${code}`));
    });
  });
}

/** Was es unter src/solver/ gibt — in Node nachgesehen und in die Seite
 *  hineingereicht, damit beide Zweige genau dieselbe Liste prüfen. */
const SOLVER_DATEIEN = readdirSync(join(REPO, 'src', 'solver'))
  .filter((n) => n.endsWith('.js')).map((n) => `src/solver/${n}`);

const nodeUmgebung = (zusatz = {}) => ({
  moduleUrl: (datei) => pathToFileURL(join(REPO, datei.split('/').join('\\'))).href,
  existiert: async (datei) => existsSync(join(REPO, datei.split('/').join('\\'))),
  glbBytes: async () => new Uint8Array(readFileSync(XBOT)),
  solverDateien: SOLVER_DATEIEN,
  umgebungsname: 'node',
  ...zusatz,
});

let server;
let browser;
let basis;

before(async () => {
  const start = await serverStart();
  server = start.proc;
  basis = start.basis;
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** Lädt die Seite, spielt Xbot durch das echte Eingabefeld ein, wartet auf die Statuszeile. */
async function seiteMitModell() {
  const page = await browser.newPage();
  await page.goto(basis, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => !!window.__boot?.bereit), true,
    'Seitenmodul wurde nicht ausgeführt — ohne geladene Seite gibt es keinen Weg');
  await page.setInputFiles('#file', XBOT);
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    return !!s && s.textContent.indexOf('Knochen') >= 0;
  }, null, { timeout: 30000 });
  return page;
}

/** Der Vertikalschnitt, ausgeführt in der laufenden Seite. */
function schnittInDerSeite(page, { umgebungsname = 'browser', mitRenderer = true } = {}) {
  return page.evaluate(async ({ solverDateien, umgebungsname, mitRenderer }) => {
    const { durchlauf, berichtText } = await import('/tests/e2e/durchlauf.mjs');
    const scene = window.__scene?.scene ?? null;
    const webgl = window.__scene?.renderer ?? null;
    const ergebnis = await durchlauf({
      moduleUrl: (datei) => '/' + datei,
      existiert: async (datei) => (await fetch('/' + datei, { method: 'HEAD' })).ok,
      glbBytes: async () => new Uint8Array(
        await (await fetch('/spikes/test-b-motion/assets/Xbot.glb')).arrayBuffer()),
      solverDateien,
      umgebungsname,
      scene,
      streifenRenderer: mitRenderer
        ? async ({ profile, frames, frameCount }) => {
          const { createStripRenderer } = await import('/src/render/strip.js');
          return createStripRenderer({
            scene, profile, frames, frameCount,
            renderer: webgl, canvas: webgl.domElement,
          });
        }
        : undefined,
    });
    return { ergebnis, text: berichtText(ergebnis) };
  }, { solverDateien: SOLVER_DATEIEN, umgebungsname, mitRenderer });
}

// ─────────────────────────────────────────────────────────────────────────────

test('Browser: derselbe Lauf in der echten Seite endet am selben Schritt und misst dieselben Zahlen', async () => {
  const page = await seiteMitModell();
  const [b, n] = await Promise.all([schnittInDerSeite(page), durchlauf(nodeUmgebung())]);
  console.log('\n' + b.text + '\n');
  await page.close();

  assert.equal(b.ergebnis.endeteBei, n.endeteBei,
    `der Browser endet bei Schritt ${b.ergebnis.endeteBei}, Node bei ${n.endeteBei} — beide `
    + `Zweige müssen denselben Weg gehen. Browser: `
    + `${b.ergebnis.schritte.map((s) => `${s.id}:${s.status}`).join(' ')}`);
  assert.equal(b.ergebnis.zahlen.gelaufen, n.zahlen.gelaufen,
    `gelaufene Schritte: Browser ${b.ergebnis.zahlen.gelaufen}, Node ${n.zahlen.gelaufen}`);
  assert.equal(b.ergebnis.schritte.length, SCHRITTE.length,
    `der Bericht muss alle ${SCHRITTE.length} Schritte führen, er führt `
    + `${b.ergebnis.schritte.length}`);

  // Gemessen, nicht getippt — und in beiden Umgebungen dasselbe Modell.
  const bm = b.ergebnis.schritte.find((s) => s.id === '2a').zahlen;
  const nm = n.schritte.find((s) => s.id === '2a').zahlen;
  for (const feld of ['gelenke', 'segmente', 'sohlen', 'ruheabstaende', 'warnungen']) {
    assert.equal(bm[feld], nm[feld],
      `Schritt 2a misst ${feld} im Browser ${bm[feld]}, in Node ${nm[feld]} — zwei Umgebungen, `
      + `ein Modell, eine Vermessung`);
  }
  assert.equal(bm.koerperhoeheMeter, nm.koerperhoeheMeter,
    `Körperhöhe gemessen: Browser ${bm.koerperhoeheMeter} m, Node ${nm.koerperhoeheMeter} m`);
  assert.ok(nm.koerperhoeheMeter > 0.5 && nm.koerperhoeheMeter < 3,
    `die gemessene Körperhöhe muss am Modell abgelesen sein, war ${nm.koerperhoeheMeter} m`);

  const s4 = b.ergebnis.schritte.find((s) => s.id === '4').zahlen;
  assert.equal(s4.werkzeuge, WERKZEUGE,
    `die Werkzeugschicht der Seite registriert ${s4.werkzeuge} Werkzeuge, der Katalog nennt ${WERKZEUGE}`);
  assert.equal(s4.frames, FRAMES, `die Timeline muss ${FRAMES} Frames haben, meldet ${s4.frames}`);
});

test('Browser: ohne WebGL-Kontext verweigert der Lauf den Bericht, auch in der Seite mit Renderer', async () => {
  // Umkehrung von B2: nicht "kein Pixel gesehen, weil keiner gebraucht wurde",
  // sondern "ohne Bild gibt es keinen Bericht" (plan.md 5.3). Dazu wird der
  // Renderer-Port weggelassen, obwohl die Seite einen hätte.
  const page = await seiteMitModell();
  const ohne = await schnittInDerSeite(page, { umgebungsname: 'browser-ohne-webgl', mitRenderer: false });
  await page.close();

  const stopp = ohne.ergebnis.schritte.find((s) => s.id === '7');
  assert.ok(ohne.ergebnis.schritte.some((s) => s.status !== 'gelaufen'),
    `ein Lauf ohne Bildstreifen darf nicht vollständig sein:\n${ohne.text}`);

  if (ohne.ergebnis.kamBis === '5') {
    // Schritt 6 braucht den Streifen als Pflichteingang; er darf nicht gelaufen
    // sein, nur weil report.js da ist.
    assert.notEqual(ohne.ergebnis.schritte.find((s) => s.id === '6').status, 'gelaufen',
      'Schritt 6 lief, obwohl 0 Bildstreifen vorlagen — ein Bericht ohne Bild wird nicht ausgeliefert');
    assert.match(stopp.meldung, /0 WebGL-Kontext/,
      `die Meldung muss den Grund mit Zahl nennen, war: "${stopp.meldung}"`);
  } else {
    assert.ok(['browser-ohne-webgl'].includes(ohne.ergebnis.umgebung),
      'der Zweigname muss in der Meldung stehen');
    assert.doesNotMatch(ohne.text, /endet bei Schritt 7/,
      `ohne gelösten Schritt 5 darf der Lauf nicht behaupten, an 7 gescheitert zu sein:\n${ohne.text}`);
  }
  assert.match(ohne.text, /nicht (verfügbar|erreicht)/,
    `der Bericht muss das Fehlen benennen:\n${ohne.text}`);
});

test('Browser, Negativfall: die ausgelieferte Seite hängt ihre Werkzeuge an Attrappen — Anschluss fehlt, Zahl fehlt', async () => {
  // Der dritte Befund, den nur dieser Zweig sehen kann: index.html ruft
  // createToolLayer OHNE ports auf (Zeile 218), die Schicht steht damit auf den
  // Attrappen aus src/tools/ports.js — obwohl Vermessung, Erkennung und
  // Prüfungen schon existieren. Bis der Anschluss steht, ist "0 von 14
  // Segmenten gemessen" die Antwort der fertigen Seite.
  //
  // Dieser Fall ist als BEHAUPTUNG der heutigen Lücke gebaut, nicht als Wunsch:
  // Sobald index.html echte Ports bekommt, schlägt er rot und muss auf die
  // gemessenen Zahlen umgestellt werden — gelöscht wird er nicht.
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const registriert = [];
    document.modelContext = {
      async registerTool(w) { registriert.push(w); },
      getTools() { return registriert.slice(); },
    };
  });
  await page.goto(basis, { waitUntil: 'load' });
  await page.setInputFiles('#file', XBOT);
  await page.waitForFunction(() => document.getElementById('status').textContent.indexOf('Knochen') >= 0,
    null, { timeout: 30000 });

  const befund = await page.evaluate(async () => {
    const t = window.__tools;
    if (!t) return { schicht: false };
    const a = await t.rufe('describe_body', {});
    const text = String(a?.content?.[0]?.text ?? '');
    let profil = null;
    try { profil = JSON.parse(text); } catch { /* Meldungstext, kein JSON */ }
    return {
      schicht: true, text,
      segmente: Array.isArray(profil?.segments) ? profil.segments.length : null,
      quelle: profil?.quelle ?? null,
    };
  });
  await page.close();

  const gemessen = (await durchlauf(nodeUmgebung())).schritte.find((s) => s.id === '2a').zahlen;
  assert.equal(befund.schicht, true,
    'window.__tools muss stehen — ohne Modell-Kontext baut die Seite keine Werkzeugschicht');
  assert.match(befund.text, /\d/,
    `die Werkzeugantwort muss eine Zahl nennen (AGENTS.md), war: "${befund.text}"`);
  assert.equal(befund.segmente, 0,
    `DER ANSCHLUSS FEHLT: die Seite meldet ${befund.segmente} Segmente aus describe_body, die `
    + `Vermessung am selben Modell liefert ${gemessen.segmente}. index.html baut createToolLayer `
    + `ohne ports — Antwortquelle war "${befund.quelle}". Sobald echte Ports angeschlossen sind, `
    + `ist diese Behauptung falsch und der Fall auf ${gemessen.segmente} umzustellen.`);
  assert.equal(befund.quelle, 'attrappe',
    `die Antwortquelle der Seite ist "${befund.quelle}", erwartet war "attrappe" — bei einem `
    + `anderen Wert ist der Anschluss gebaut und dieser Fall muss auf gemessen umgestellt werden`);
});
