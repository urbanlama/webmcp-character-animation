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

import { KATALOG, KATALOG_SICHTBAR, KISTE } from '../../src/tools/catalog.js';
import { durchlauf, SCHRITTE, FRAMES } from './durchlauf.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const XBOT = join(REPO, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb');
const STARTZEILE = /Server läuft: (http:\/\/localhost:\d+\/)/;
// Was der Agent sieht, nicht was der Gesamtbestand fuehrt: die Werkzeugkiste
// (add_phase, edit_phase, set_target) ist dem Agenten absichtlich unsichtbar
// und wird von createToolLayer deshalb nicht an document.modelContext
// weitergereicht — registriert sind trotzdem alle, siehe registry.anzahl().
// Schritt 4 meldet registry.anzahl() (alle 22), der sichtbare Katalog nennt
// KATALOG_SICHTBAR.length (19). Beide Zahlen gehoeren zum selben Stand.
const WERKZEUGE = KATALOG.length;
const SICHTBAR = KATALOG_SICHTBAR.length;
assert.equal(WERKZEUGE - KISTE.length, SICHTBAR,
  `${KISTE.length} Werkzeuge in der Kiste, ${WERKZEUGE} im Katalog, ${SICHTBAR} sichtbar `
  + `— der Bestand muss aufgehen, sonst steht hier eine alte Zahl`);

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
  // Das Startladen des Beispielmodells laeuft NACH __boot.bereit weiter. Wer
  // vorher eine Datei einlegt, bekommt dessen Ergebnis mitten in den eigenen
  // Lauf geschoben (index.html setzt startmodellFertig im finally).
  await page.waitForFunction(() => window.__boot?.startmodellFertig === true,
    null, { timeout: 30000 });
  await page.setInputFiles('#file', XBOT);
  // Die Statuszeile zaehlt auf Englisch ("N bones"), siehe index.html;
  // "Knochen" steht dort nicht.
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    return !!s && /\d+\s+bones/.test(s.textContent);
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
          // Erster Versuch: mit Scene, also mit gestelltem Mesh. Dafür braucht
          // src/render/strip.js je Frame eine volle Knochenpose unter `bones`
          // (position, quaternion, weltSkala). src/solver/loeser.js liefert
          // heute `positions` je Knochen und `joints` je GELENKNAME, keine
          // weltSkala — daraus lässt sich die Mesh-Pose nicht bauen, ohne
          // Zahlen zu erfinden.
          //
          // Zweiter Versuch deshalb ohne Scene: strip.js rastert dann die Figur
          // aus den GEMESSENEN Segmentradien des RigProfile. Das sind echte
          // Pixel aus echten Maßen, nur ohne Haut — und strip.js weist es
          // selbst als Warnung aus. Sobald der Löser Ausrichtungen mitgibt,
          // greift wieder der erste Versuch, ohne dass hier jemand nachzieht.
          const gemeinsam = { profile, frames, frameCount };
          const mitMesh = createStripRenderer({
            ...gemeinsam, scene, renderer: webgl, canvas: webgl.domElement,
          });
          let ohneMesh = null;
          window.__streifenBefund = { mesh: true, grund: null };
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
        : undefined,
    });
    return { ergebnis, text: berichtText(ergebnis), streifenBefund: window.__streifenBefund ?? null };
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

  // Ein Schritt darf legitim abweichen, und nur einer: Schritt 7 rendert im
  // Browser echte Pixel und kann das in Node nicht. Jede andere Abweichung ist
  // ein Befund — dann misst eine der beiden Umgebungen falsch.
  const andersAls = SCHRITTE.map((s) => s.id).filter((id) => {
    const bs = b.ergebnis.schritte.find((x) => x.id === id).status;
    const ns = n.schritte.find((x) => x.id === id).status;
    return bs !== ns;
  });
  assert.deepEqual(andersAls.filter((id) => id !== '7'), [],
    `außer Schritt 7 (WebGL) darf kein Schritt zwischen den Umgebungen abweichen, es weichen ab: `
    + andersAls.map((id) => `${id} (Browser ${b.ergebnis.schritte.find((x) => x.id === id).status}, `
      + `Node ${n.schritte.find((x) => x.id === id).status})`).join('; '));
  assert.equal(b.ergebnis.zahlen.gelaufen - n.zahlen.gelaufen, andersAls.length,
    `gelaufene Schritte: Browser ${b.ergebnis.zahlen.gelaufen}, Node ${n.zahlen.gelaufen} — `
    + `der Unterschied muss genau die ${andersAls.length} abweichenden Schritte sein`);

  // B2: der Bildstreifen entsteht hier wirklich. Ein Platzhalter zählt nicht.
  const s7 = b.ergebnis.schritte.find((s) => s.id === '7');
  assert.equal(s7.status, 'gelaufen',
    `Schritt 7 muss im Browser echte Pixel liefern, meldet "${s7.status}": ${s7.meldung ?? ''}`);
  assert.equal(s7.zahlen.quelle, 'src/render/strip.js:createStripRenderer',
    `der Streifen muss aus src/render/strip.js kommen, kam aus "${s7.zahlen.quelle}"`);
  if (b.streifenBefund && b.streifenBefund.mesh === false) {
    console.log('\nBEFUND Bildstreifen ohne Mesh — gerastert aus gemessenen Segmentradien:\n  '
      + b.streifenBefund.grund + '\n');
  }
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
    `die Werkzeugschicht der Seite registriert ${s4.werkzeuge} Werkzeuge, der Katalog führt ${WERKZEUGE}`);
  assert.equal(s4.frames, FRAMES, `die Timeline muss ${FRAMES} Frames haben, meldet ${s4.frames}`);
});

test('Browser: ohne Renderer-Port fällt der Lauf auf den Platzhalter zurück und sagt es, statt ein Bild zu behaupten', async () => {
  // Umkehrung von B2: derselben Seite wird der Renderer-Port weggelassen,
  // obwohl sie einen hätte. Die Regel aus plan.md 5.3 bleibt in Kraft — der
  // Bericht trägt weiter einen Bildverweis —, aber der Verweis muss sich als
  // Platzhalter zu erkennen geben, und Schritt 7 darf NICHT als gelaufen
  // dastehen. Ein Lauf, der hier "Bildstreifen: gelaufen" meldete, würde ein
  // Bild behaupten, das niemand gerendert hat.
  const page = await seiteMitModell();
  const ohne = await schnittInDerSeite(page, { umgebungsname: 'browser-ohne-webgl', mitRenderer: false });
  await page.close();

  const stopp = ohne.ergebnis.schritte.find((s) => s.id === '7');
  assert.notEqual(stopp.status, 'gelaufen',
    `Schritt 7 meldet "gelaufen", obwohl 0 Renderer-Ports übergeben wurden:\n${ohne.text}`);
  assert.match(stopp.meldung ?? '', /0 WebGL-Kontext/,
    `die Meldung muss den Grund mit Zahl nennen, war: "${stopp.meldung}"`);
  assert.equal(stopp.zahlen.gerendertBilder, 0,
    `der Platzhalter muss 0 gerenderte Bilder ausweisen, meldet ${stopp.zahlen.gerendertBilder}`);
  assert.match(ohne.text, /nicht (verfügbar|erreicht)/,
    `der Bericht muss das Fehlen benennen:\n${ohne.text}`);

  // Kam der Lauf bis zum Bericht, muss dessen Bildverweis den Platzhalter
  // ausweisen — kein Eintrag darf wie eine gerenderte Ansicht aussehen.
  const bericht = ohne.ergebnis.bericht;
  if (bericht) {
    assert.ok(bericht.images.length >= 1,
      'die Bildpflicht aus plan.md 5.3 gilt auch für den Platzhalter');
    for (const bild of bericht.images) {
      assert.equal(bild.view, 'platzhalter',
        `Bildeintrag gibt sich als Ansicht "${bild.view}" aus, obwohl nichts gerendert wurde`);
      assert.match(bild.ref, /^platzhalter:\/\/kein-bild\//,
        `der Bildverweis verschweigt, dass er keiner ist: "${bild.ref}"`);
    }
  }
});

// Referenz-Vermessung des Xbot, wie sie der Anschluss an echte Ports liefert
// (Auftrag vom 2026-08-31: describe_body 15 Segmente / 8 Sohlen, describe_world
// 67 Knochen / 28374 Vertices / 1,8093 m, describe_rig 18 Gelenke).
// Das sind keine getippten Körpermaße: es ist das MESERGEBNIS an diesem einen
// festen Referenzmodell, und der Test prüft die Seitenantworten doppelt — gegen
// die Node-Vermessung desselben Modells (dynamisch) und gegen diese Zahlzeile
// (fest). Ändert sich die Vermessung legitimate, muss sie hier und dort
// gemeinsam umgestellt werden; leise abdriften darf sie nicht.
const REFERENZ_XBOT = {
  segmente: 15, gelenke: 18, knochen: 67, sohlen: 8,
  vertices: 28374, hoeheMeter: 1.8093,
};

test('Browser, Negativfall: die ausgelieferte Seite hängt keine Attrappen mehr an — jedes describe-Werkzeug meldet gemessen', async () => {
  // Umkehrung des alten Befunds: dieser Fall behauptete bis 2026-08-30 die
  // Lücke („index.html ruft createToolLayer ohne ports auf, describe_body
  // antwortet 0 von 15 Segmenten"). Die Lücke ist zu: index.html baut
  // echtePorts({ renderer }) und hängt sie unter ports ein. Der Test prüft
  // deshalb jetzt, dass KEINE Attrappe mehr dranhängt. Tauscht jemand die
  // Anschlüsse zurück auf attrappenPorts(), werden die beiden Prüfungen auf
  // quelle und das Wort „Attrappe" rot — genau der Negativfall.
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const registriert = [];
    document.modelContext = {
      async registerTool(w) { registriert.push(w); },
      getTools() { return registriert.slice(); },
    };
  });
  await page.goto(basis, { waitUntil: 'load' });
  // Siehe seiteMitModell: erst das Startladen zu Ende, dann die eigene Datei.
  await page.waitForFunction(() => window.__boot?.startmodellFertig === true,
    null, { timeout: 30000 });
  await page.setInputFiles('#file', XBOT);
  // Nicht "Knochen" abwarten — das schreibt presentModel VOR der Vermessung.
  // Gewartet wird das ENDE der Vermessung: bei Erfolg haengt zeigeMesswerte
  // "measured, no warnings" an #messwerte, ein Scheitern schreibt in #status
  // ("not measured", "No model loaded"). Nur in #status zu lauschen haette
  // beim Erfolg ewig gewartet — der Timeout, gegen den dieser Fix geht.
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    const m = document.getElementById('messwerte');
    const gemessen = !!m && /measured/.test(m.textContent);
    const gescheitert = !!s && /not measured|No model loaded/.test(s.textContent);
    return gemessen || gescheitert;
  }, null, { timeout: 30000 });

  const befund = await page.evaluate(async () => {
    const t = window.__tools;
    if (!t) return { schicht: false };
    const antworten = {};
    for (const name of ['describe_world', 'describe_rig', 'describe_body']) {
      // describe_rig antwortet standardmaessig als Tabelle (Agentenformat);
      // die Pruefungen brauchen Struktur, deshalb mit detail: true anfragen —
      // dasselbe, was auch die Unit-Tests fuer die Strukturpruefung tun.
      const a = await t.rufe(name, name === 'describe_rig' ? { detail: true } : {});
      const text = String(a?.content?.[0]?.text ?? '');
      let profil = null;
      try { profil = JSON.parse(text); } catch { /* Fehlermeldung, kein JSON */ }
      antworten[name] = {
        isError: a?.isError === true,
        text,
        quelle: profil?.quelle ?? null,
        segmente: Array.isArray(profil?.segments) ? profil.segments.length : null,
        sohlen: Array.isArray(profil?.soles) ? profil.soles.length : null,
        gelenke: profil?.joints ? Object.keys(profil.joints).length : null,
        rollen: profil?.roles ? Object.keys(profil.roles).length : null,
        rueckfragen: Array.isArray(profil?.questions) ? profil.questions.length : null,
        knochen: typeof profil?.knochen === 'number' ? profil.knochen : null,
        vertices: typeof profil?.vertices === 'number' ? profil.vertices : null,
        hoehe: typeof profil?.height === 'number' ? profil.height : null,
      };
    }
    return { schicht: true, registriert: t.getTools().length, antworten };
  });
  await page.close();

  // Node misst denselben Modellfall durch — der Positivfall prüft gegen diese
  // zweite unabhängige Vermessung, nicht nur gegen Konstanten.
  const n = (await durchlauf(nodeUmgebung())).schritte;
  const g2a = n.find((s) => s.id === '2a').zahlen;
  const g1 = n.find((s) => s.id === '1').zahlen;
  const g2b = n.find((s) => s.id === '2b')?.zahlen ?? {};

  assert.equal(befund.schicht, true,
    'window.__tools muss stehen — ohne Modell-Kontext baut die Seite keine Werkzeugschicht');
  assert.equal(befund.registriert, SICHTBAR,
    `die Seite macht ${befund.registriert} Werkzeuge sichtbar, der sichtbare Katalog führt `
    + `${SICHTBAR} — die ${KISTE.length} Kisten-Werkzeuge (${KISTE.join(', ')}) bleiben `
    + `dem Agenten verborgen`);

  // ── Negativfall: keine Attrappe mehr, nirgends ─────────────────────────────
  for (const [name, a] of Object.entries(befund.antworten)) {
    assert.equal(a.isError, false,
      `${name} antwortet als Fehler — ohne Modell oder ohne Anschluss lautet die Meldung:\n${a.text}`);
    assert.match(a.text, /\d/,
      `die Werkzeugantwort von ${name} muss eine Zahl nennen (AGENTS.md), war: "${a.text}"`);
    assert.equal(a.quelle, 'gemessen',
      `${name} meldet quelle "${a.quelle}" — erwartet "gemessen". Steht hier wieder `
      + `"attrappe", hat jemand die echten Anschlüsse aus index.html gegen attrappenPorts() `
      + `getauscht; die Werkzeuge antworten dann aus src/tools/ports.js ohne Messung.`);
    assert.doesNotMatch(a.text, /attrappe/i,
      `${name} trägt eine Attrappen-Warnung im Antworttext — die Seite misst nicht mehr am `
      + `Modell:\n${a.text}`);
  }

  // ── Positivfall: es sind die GEMESSENEN Werte ──────────────────────────────
  const body = befund.antworten.describe_body;
  const world = befund.antworten.describe_world;
  const rig = befund.antworten.describe_rig;

  assert.equal(body.segmente, g2a.segmente,
    `describe_body meldet ${body.segmente} Segmente, die Node-Vermessung desselben Modells `
    + `liefert ${g2a.segmente} — die Seite muss nachweisen, dass sie MISST, nicht dass ein Wert da ist`);
  assert.equal(body.segmente, REFERENZ_XBOT.segmente,
    `describe_body meldet ${body.segmente} Segmente, die Referenz-Vermessung des Xbot führt `
    + `${REFERENZ_XBOT.segmente} — bei einer legitimate Änderung der Vermessung ist diese `
    + `Zeile gemeinsam mit der Node-Brücke umzustellen`);
  assert.equal(body.sohlen, REFERENZ_XBOT.sohlen,
    `describe_body meldet ${body.sohlen} Sohlenpunkte, gemessen werden ${REFERENZ_XBOT.sohlen}`);
  assert.equal(world.knochen, g1.knochen,
    `describe_world meldet ${world.knochen} Knochen, das geladene Modell hat ${g1.knochen}`);
  assert.equal(world.knochen, REFERENZ_XBOT.knochen,
    `describe_world meldet ${world.knochen} Knochen, der Xbot führt ${REFERENZ_XBOT.knochen}`);
  assert.equal(world.vertices, REFERENZ_XBOT.vertices,
    `describe_world meldet ${world.vertices} Vertices, die Geometrie des Xbot hat `
    + `${REFERENZ_XBOT.vertices}`);
  assert.ok(Math.abs(world.hoehe - REFERENZ_XBOT.hoeheMeter) <= 0.0005,
    `describe_world meldet ${world.hoehe} m Körperhöhe, gemessen am Xbot sind `
    + `${REFERENZ_XBOT.hoeheMeter} m (Toleranz 0,0005 m)`);
  assert.equal(world.hoehe, g2a.koerperhoeheMeter,
    `describe_world meldet ${world.hoehe} m, die Node-Vermessung meldet ${g2a.koerperhoeheMeter} m — `
    + `zwei Umgebungen, ein Modell, eine Vermessung`);
  assert.equal(rig.gelenke, g2a.gelenke,
    `describe_rig meldet ${rig.gelenke} Gelenke, die Vermessung führt ${g2a.gelenke}`);
  assert.equal(rig.gelenke, REFERENZ_XBOT.gelenke,
    `describe_rig meldet ${rig.gelenke} Gelenke, die Referenz-Vermessung des Xbot führt `
    + `${REFERENZ_XBOT.gelenke}`);
  if (g2b.rollen) {
    assert.equal(rig.rollen, g2b.rollen,
      `describe_rig meldet ${rig.rollen} Rollen, die Erkennung in Node führt ${g2b.rollen}`);
  }
  if (typeof g2b.rueckfragen === 'number') {
    assert.equal(rig.rueckfragen, g2b.rueckfragen,
      `describe_rig meldet ${rig.rueckfragen} Rückfragen, die Erkennung in Node stellt `
      + `${g2b.rueckfragen} — ungefragte Rollen dürfen nicht verschwinden, aber auch nicht entstehen`);
  }
});
