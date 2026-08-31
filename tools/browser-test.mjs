#!/usr/bin/env node
// AP0, Browserhälfte: echter Datei-Upload gegen die echte Seite.
//
//   node tools/browser-test.mjs      läuft auch als `npm test`-Zweite-Hälfte
//
// Prüft drei Fälle:
//   Positiv  Xbot.glb — die Statuszeile muss 67 Knochen nennen, 67 inverse
//            Bind-Matrizen stehen in der Datei (spikes/tmp-ap4-probe.mjs), und
//            window.__scene.model muss das Modell enthalten. Ohne
//            document.modelContext darf die Seite keine Werkzeugschicht bauen.
//   Negativ  Würfel ohne Skelett — dieselbe Seite muss die Datei sichtbar
//            ablehnen, mit Grund und Zahl im Fehlerfeld.
//   Tools    Ein document.modelContext-Mock wird VOR dem Seitenladen eingesetzt;
//            die Seite muss genau einmal createToolLayer damit aufrufen und genau
//            KATALOG_GROESSE Werkzeuge bei ihm registrieren.
//
// Kein Pixelvergleich, keine Screenshots: die Ansicht prüft src/scene/
// view.test.mjs rechnerisch über die projizierten Boxecken.

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { XBOT_PFAD, wuerfelOhneSkelett } from '../src/scene/testdaten.mjs';
import { KATALOG, KATALOG_GROESSE } from '../src/tools/catalog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// PORT=0: das Betriebssystem vergibt einen freien Port, der Server meldet ihn.
// Ein getippter Port lief hier auf 8000 und 8123 bereits laufende Server auf.
const STARTZEILE = /Server läuft: (http:\/\/localhost:\d+\/)/;

/** Startet den vorhandenen Datei-Server und wartet auf seine Startmeldung. */
function serverStart() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(HERE, 'serve.mjs')], {
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
      if (gemeldete) {
        clearTimeout(zeitlimit);
        resolve({ proc, basis: gemeldete[1] });
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(zeitlimit);
      if (code !== 0) reject(new Error(`Server endete vor der Startmeldung, Code ${code}`));
    });
  });
}

/**
 * Legt eine Datei ins Eingabefeld und wartet auf die Antwort der Seite.
 * @returns {Promise<{status: string, fehler: string}>}
 */
async function hochladen(page, pfad) {
  await page.setInputFiles('#file', pfad);
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    const e = document.getElementById('error');
    return !!s && (s.textContent.indexOf('Knochen') >= 0 || e.style.display === 'block');
  }, null, { timeout: 30000 });

  return page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    fehler: document.getElementById('error').textContent,
    fehlerSichtbar: getComputedStyle(document.getElementById('error')).display !== 'none',
    modell: !!window.__scene?.model,
  }));
}

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

/**
 * Setzt einen document.modelContext-Mock in die Seite EIN, BEVOR deren Skripte
 * laufen (addInitScript läuft vor jedem Dokument). Er zählt jeden
 * registerTool-Aufruf mit und gibt die Werkzeuge über getTools() zurück —
 * genau wie die gemessene WebMCP-API (AGENTS.md).
 */
async function modelContextMockEinsetzen(page) {
  await page.addInitScript(() => {
    const registriert = [];
    document.modelContext = {
      async registerTool(w) {
        registriert.push(w);
        window.__registrierungsaufrufe = (window.__registrierungsaufrufe ?? 0) + 1;
      },
      getTools() { return registriert.slice(); },
    };
  });
}

test('Browser, Positivfall: Xbot-Upload nennt 67 Knochen und hängt das Modell in die Szene', async () => {
  const page = await browser.newPage();
  await page.goto(basis, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => !!window.__boot?.bereit), true,
    'Seitenmodul wurde nicht ausgeführt: window.__boot.bereit ist nach dem Laden nicht gesetzt');
  // Ohne document.modelContext baut die Seite keine Werkzeugschicht — der
  // normale Uploadlauf bleibt unverändert.
  assert.equal(await page.evaluate(() => window.__tools), null,
    'ohne document.modelContext darf window.__tools nicht gesetzt sein');

  const befund = await hochladen(page, XBOT_PFAD);
  const gefunden = Number((befund.status.match(/(\d+)\s+Knochen/) || [])[1]);

  assert.equal(gefunden, 67,
    `Statuszeile muss 67 Knochen nennen, war: "${befund.status}"`);
  assert.equal(befund.modell, true,
    `window.__scene.model muss nach dem Upload das Modell enthalten, Status: "${befund.status}"`);
  assert.equal(befund.fehlerSichtbar, false,
    `Positivfall darf kein Fehlerfeld füllen, war: "${befund.fehler}"`);

  await page.close();
});

test('Browser, Negativfall: Würfel ohne Skelett wird sichtbar mit Zahl abgelehnt', async () => {
  const page = await browser.newPage();
  await page.goto(basis, { waitUntil: 'load' });

  const befund = await hochladen(page, wuerfelOhneSkelett());

  assert.equal(befund.fehlerSichtbar, true,
    `Fehlerfeld muss sichtbar sein, Status war: "${befund.status}"`);
  assert.match(befund.fehler, /Skelett/i,
    `Ablehnung muss den Grund benennen, war: "${befund.fehler}"`);
  assert.match(befund.fehler, /\d/,
    `Ablehnung muss eine Zahl enthalten (AGENTS.md), war: "${befund.fehler}"`);
  assert.equal(befund.modell, false,
    `Abgelehnte Datei darf kein Modell in der Szene hinterlassen, Status: "${befund.status}"`);

  await page.close();
});

test('Browser, Werkzeugschicht: Mock-Kontext vor dem Laden beweist genau 16 registrierte Tools', async () => {
  const page = await browser.newPage();
  await modelContextMockEinsetzen(page);
  await page.goto(basis, { waitUntil: 'load' });

  // Die Seite registriert im Seitenmodul; bis bereit gesetzt ist, müssen alle
  // Registrierungen durch sein.
  assert.equal(await page.evaluate(() => !!window.__boot?.bereit), true,
    'Seitenmodul wurde nicht ausgeführt: window.__boot.bereit ist nach dem Laden nicht gesetzt');

  const befund = await page.evaluate(() => ({
    aufrufe: window.__registrierungsaufrufe ?? 0,
    beimMock: document.modelContext.getTools().map((t) => t.name),
    schicht: window.__tools ? window.__tools.getTools().map((t) => t.name) : null,
  }));

  assert.ok(befund.schicht,
    'window.__tools muss gesetzt sein: die Seite muss createToolLayer mit dem echten document.modelContext aufrufen');
  assert.equal(befund.aufrufe, KATALOG_GROESSE,
    `registerTool muss genau ${KATALOG_GROESSE}-mal aufgerufen sein, war: ${befund.aufrufe} — `
    + 'genau einmal createToolLayer, kein zweites Mal');
  assert.equal(befund.beimMock.length, new Set(befund.beimMock).size,
    `jeder Name darf genau einmal registriert sein, es sind ${befund.beimMock.length} Aufrufe `
    + `mit ${new Set(befund.beimMock).size} verschiedenen Namen`);
  assert.deepEqual(befund.beimMock, KATALOG.map((t) => t.name),
    `beim Mock müssen genau die ${KATALOG_GROESSE} Katalogwerkzeuge liegen, `
    + `es sind ${befund.beimMock.length}: ${befund.beimMock.join(', ')}`);
  assert.deepEqual(befund.schicht, befund.beimMock,
    'die Schicht und der Mock müssen dieselben Werkzeuge sehen');

  await page.close();
});

// --- Rueckfrage (plan.md 6.7) -------------------------------------------------
//
// Der Broker src/ui/ask-human.js ist in Node geprueft (src/ui/rueckfrage.test.mjs).
// Hier wird die andere Haelfte geprueft, die es dort nicht gibt: dass die Frage
// in der echten Seite auch erscheint und dass ein echter Klick den wartenden
// Aufruf aufloest.

/** Laedt die Seite mit Mock-Kontext und wartet, bis die Werkzeugschicht steht. */
async function seiteMitWerkzeugen() {
  const page = await browser.newPage();
  await modelContextMockEinsetzen(page);
  await page.goto(basis, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => !!window.__tools), true,
    'window.__tools muss stehen, sonst gibt es keinen Broker zum Fragen');
  return page;
}

/**
 * Räumt eine Frage weg, die die Seite von sich aus gestellt hat. Nach dem
 * Upload kann die Rollenerkennung eine Bestätigung offen haben (plan.md 6.7,
 * Moment 1); es wartet immer nur eine Frage, also muss sie erst vom Tisch.
 */
async function keineFrageOffen(page) {
  const wartet = await page.evaluate(() => window.__tools?.ask.stand().wartet === true);
  if (!wartet) return false;
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__tools.ask.stand().wartet === false,
    null, { timeout: 5000 });
  return true;
}

/**
 * Startet ask_human in der Seite und wartet, bis das Panel die Frage zeigt.
 * Der Aufruf bleibt offen; sein Ergebnis landet spaeter in window.__antwort.
 */
async function frageStellen(page, question, options) {
  await page.evaluate(({ q, o }) => {
    window.__antwort = null;
    window.__fertig = false;
    window.__tools.rufe('ask_human', { question: q, options: o })
      .then((a) => { window.__antwort = a; window.__fertig = true; });
  }, { q: question, o: options });

  await page.waitForFunction(() => {
    const p = document.getElementById('frage');
    return p && !p.hidden && p.querySelectorAll('#frage-optionen button').length > 0;
  }, null, { timeout: 5000 });
}

/** Liest, was der Mensch sieht: Text, Beschriftungen, Lage der Knoepfe. */
function panelLesen(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('frage');
    const knoepfe = [...panel.querySelectorAll('#frage-optionen button')];
    return {
      sichtbar: !panel.hidden && getComputedStyle(panel).display !== 'none',
      frage: document.getElementById('frage-text').textContent,
      spalten: document.getElementById('frage-optionen').className,
      budget: document.getElementById('frage-budget').textContent,
      knoepfe: knoepfe.map((k) => {
        const r = k.getBoundingClientRect();
        return {
          text: k.textContent,
          marke: k.querySelector('.marke')?.textContent ?? '',
          klasse: k.className,
          index: Number(k.dataset.index),
          oben: Math.round(r.top), links: Math.round(r.left),
          breite: Math.round(r.width), hoehe: Math.round(r.height),
        };
      }),
    };
  });
}

test('Browser, Rückfrage sichtbar: gestellte Frage erscheint, der Klick liefert die Antwort an den wartenden Aufruf', async () => {
  const page = await seiteMitWerkzeugen();
  const frage = 'Soll die Figur mit dem linken oder dem rechten Fuß landen?';
  await frageStellen(page, frage, ['linker Fuß', 'rechter Fuß']);

  const vorher = await panelLesen(page);
  assert.equal(vorher.sichtbar, true, 'das Panel muss sichtbar sein, solange die Frage wartet');
  assert.equal(vorher.frage, frage,
    `die gestellte Frage muss wortgleich stehen, war: "${vorher.frage}"`);
  assert.equal(vorher.knoepfe.length, 2,
    `2 Antwortmöglichkeiten müssen klickbar sein, es sind ${vorher.knoepfe.length}`);
  assert.match(vorher.knoepfe[0].text, /linker Fuß/);
  assert.match(vorher.knoepfe[1].text, /rechter Fuß/);
  assert.match(vorher.budget, /2 von 3 Fragen/,
    `die Budgetanzeige muss den Stand nennen, war: "${vorher.budget}"`);

  // Der Klick des Menschen — kein antworte() aus dem Testcode.
  await page.click('#frage-optionen button[data-index="1"]');
  await page.waitForFunction(() => window.__fertig === true, null, { timeout: 5000 });

  const antwort = await page.evaluate(() => window.__antwort);
  assert.notEqual(antwort.isError, true,
    `der Aufruf muss ohne Fehler enden, war: "${antwort.content[0].text}"`);
  assert.match(antwort.content[0].text, /rechter Fuß/,
    `derselbe Aufruf muss die geklickte Antwort liefern, war: "${antwort.content[0].text}"`);
  assert.match(antwort.content[0].text, /Möglichkeit 2 von 2/,
    `die Antwort muss die geklickte Position nennen, war: "${antwort.content[0].text}"`);

  const nachher = await panelLesen(page);
  assert.equal(nachher.sichtbar, false, 'nach der Antwort wartet nichts mehr, das Panel ist weg');

  await page.close();
});

test('Browser, zwei Varianten: beide stehen nebeneinander, ein Klick wählt eine', async () => {
  const page = await seiteMitWerkzeugen();
  await frageStellen(page, 'Welcher Absprung gefällt dir besser?',
    ['Variante mit tiefer Hocke', 'Variante mit flachem Absprung']);

  const panel = await panelLesen(page);
  const [a, b] = panel.knoepfe;
  assert.equal(panel.spalten, 'varianten',
    `2 Möglichkeiten sind eine Geschmacksfrage und stehen als Varianten, war: "${panel.spalten}"`);
  assert.equal(panel.knoepfe.length, 2, `genau 2 Varianten, es sind ${panel.knoepfe.length}`);
  // Nebeneinander heisst messbar: gleiche Oberkante, verschiedene linke Kante,
  // beide sichtbar breit. Untereinander waeren a.oben und b.oben verschieden.
  assert.equal(a.oben, b.oben,
    `beide Varianten müssen auf gleicher Höhe stehen, ${a.oben} px gegen ${b.oben} px`);
  assert.ok(b.links >= a.links + a.breite,
    `Variante 2 muss rechts neben Variante 1 liegen: links ${a.links} + ${a.breite} px breit, rechts beginnt bei ${b.links} px`);
  assert.ok(a.breite > 100 && b.breite > 100,
    `beide Varianten müssen sichtbar breit sein, ${a.breite} px und ${b.breite} px`);
  assert.equal(a.marke, '1', `die erste Karte trägt die Nummer 1, war "${a.marke}"`);
  assert.equal(b.marke, '2', `die zweite Karte trägt die Nummer 2, war "${b.marke}"`);
  assert.match(a.klasse, /variante/, `beide Karten stehen als Variante, war: "${a.klasse}"`);
  assert.match(a.text, /tiefer Hocke/);
  assert.match(b.text, /flachem Absprung/);

  // Negativfall: ohne Klick wird nichts stillschweigend gewählt.
  await page.waitForTimeout(300);
  const zwischenstand = await page.evaluate(() => ({
    fertig: window.__fertig,
    antwort: window.__antwort,
    wartet: window.__tools.ask.stand().wartet,
  }));
  assert.equal(zwischenstand.fertig, false,
    'ohne Klick darf keine Antwort entstehen; der Aufruf wartet weiter');
  assert.equal(zwischenstand.antwort, null, 'ohne Klick liegen 0 Antworten vor');
  assert.equal(zwischenstand.wartet, true, 'nach 300 ms wartet die Frage unverändert');

  await page.click('#frage-optionen button[data-index="0"]');
  await page.waitForFunction(() => window.__fertig === true, null, { timeout: 5000 });
  const antwort = await page.evaluate(() => window.__antwort);
  assert.match(antwort.content[0].text, /tiefer Hocke/,
    `der Klick muss genau die geklickte Variante wählen, war: "${antwort.content[0].text}"`);
  assert.match(antwort.content[0].text, /Möglichkeit 1 von 2/,
    `die Antwort muss die gewählte Position nennen, war: "${antwort.content[0].text}"`);

  await page.close();
});

test('Browser, Rückfrage Negativfall: Abbruch und Neuladen lassen die Timeline bitgleich', async () => {
  const page = await seiteMitWerkzeugen();

  // Eine Timeline, die Schaden nehmen könnte.
  const aufbau = await page.evaluate(async () => {
    const t = window.__tools;
    const a = await t.rufe('set_duration', { frameCount: 90 });
    const b = await t.rufe('add_phase', { verb: 'takeoff', from: 12, to: 18, params: { vy: 4.2 } });
    const { fingerabdruck } = await import(new URL('src/tools/index.js', document.baseURI).href);
    return {
      fehler: [a, b].filter((r) => r.isError).map((r) => r.content[0].text),
      abdruck: fingerabdruck(t.store.lies()),
      tiefe: t.store.tiefe(),
      zustand: t.store.lies(),
    };
  });
  assert.deepEqual(aufbau.fehler, [], `Aufbau muss durchlaufen: ${aufbau.fehler.join(' | ')}`);

  await frageStellen(page, 'Weiter mit der Drehung?', ['ja', 'nein']);

  // Der Mensch bricht ab, statt zu klicken.
  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__fertig === true, null, { timeout: 5000 });

  const nachAbbruch = await page.evaluate(async () => {
    const { fingerabdruck } = await import(new URL('src/tools/index.js', document.baseURI).href);
    return {
      antwort: window.__antwort,
      abdruck: fingerabdruck(window.__tools.store.lies()),
      tiefe: window.__tools.store.tiefe(),
      panelSichtbar: !document.getElementById('frage').hidden,
    };
  });

  assert.equal(nachAbbruch.antwort.isError, true,
    'der abgebrochene Aufruf muss als Fehler enden, nicht stillschweigend');
  assert.match(nachAbbruch.antwort.content[0].text, /\d/,
    `die Meldung muss eine Zahl nennen (AGENTS.md), war: "${nachAbbruch.antwort.content[0].text}"`);
  assert.equal(nachAbbruch.abdruck, aufbau.abdruck,
    'die Timeline muss nach dem Abbruch bitgleich sein');
  assert.equal(nachAbbruch.tiefe, aufbau.tiefe,
    `der Abbruch darf keinen Schritt auf den Undo-Stapel legen, ${aufbau.tiefe} gegen ${nachAbbruch.tiefe}`);
  assert.equal(nachAbbruch.panelSichtbar, false, 'nach dem Abbruch ist das Panel weg');

  // Neuladen während der Wartezeit: erst wieder fragen, dann die Seite neu laden.
  await frageStellen(page, 'Noch weiter mit der Drehung?', ['ja', 'nein']);
  await page.reload({ waitUntil: 'load' });

  const nachNeuladen = await page.evaluate(async (gesichert) => {
    const { createToolLayer, fingerabdruck } = await import(new URL('src/tools/index.js', document.baseURI).href);
    const wiederhergestellt = await createToolLayer({ zustand: gesichert });
    return {
      panelSichtbar: !document.getElementById('frage').hidden,
      fehlerfeldSichtbar: getComputedStyle(document.getElementById('error')).display !== 'none',
      schichtSteht: !!window.__tools,
      wartet: window.__tools.ask.stand().wartet,
      phasenFrisch: window.__tools.store.lies().phases.length,
      abdruck: fingerabdruck(wiederhergestellt.store.lies()),
      phasen: wiederhergestellt.store.lies().phases.length,
    };
  }, aufbau.zustand);

  assert.equal(nachNeuladen.panelSichtbar, false,
    'nach dem Neuladen darf keine Frage von vorher hängen bleiben');
  assert.equal(nachNeuladen.fehlerfeldSichtbar, false,
    'das Neuladen selbst ist kein Fehlerfall der Seite');
  assert.equal(nachNeuladen.schichtSteht, true, 'die Werkzeugschicht steht nach dem Neuladen wieder');
  assert.equal(nachNeuladen.wartet, false, 'die neue Seite hat 0 offene Fragen');
  assert.equal(nachNeuladen.phasenFrisch, 0,
    `die frische Schicht startet mit 0 Phasen, hatte ${nachNeuladen.phasenFrisch}`);
  assert.equal(nachNeuladen.abdruck, aufbau.abdruck,
    'aus dem gesicherten Zustand gebaut ist die Timeline bitgleich zu vor der Frage');
  assert.equal(nachNeuladen.phasen, 1,
    `die wiederhergestellte Timeline muss ihre 1 Phase behalten, hatte ${nachNeuladen.phasen}`);

  await page.close();
});

/**
 * Misst, wo die Figur im Fenster steht und wo das Panel liegt. Die Figur wird
 * aus ihrer Bounding Box ueber die echte Kamera projiziert — dieselbe Rechnung
 * wie in src/scene/view.test.mjs, nur in Fensterkoordinaten statt in NDC.
 */
function lageMessen(page) {
  return page.evaluate(async () => {
    const { getBounds } = await import(new URL('src/scene/load.js', document.baseURI).href);
    const { camera, model } = window.__scene;
    const box = getBounds(model);
    const leinwand = document.getElementById('view').getBoundingClientRect();

    let links = Infinity, rechts = -Infinity, oben = Infinity, unten = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const p = box.min.clone().set(x, y, z).project(camera);
          const px = leinwand.left + (p.x * 0.5 + 0.5) * leinwand.width;
          const py = leinwand.top + (-p.y * 0.5 + 0.5) * leinwand.height;
          links = Math.min(links, px); rechts = Math.max(rechts, px);
          oben = Math.min(oben, py); unten = Math.max(unten, py);
        }
      }
    }

    const r = document.getElementById('frage').getBoundingClientRect();
    const rund = (v) => Math.round(v);
    return {
      figur: {
        links: rund(links), rechts: rund(rechts), oben: rund(oben), unten: rund(unten),
        breite: rund(rechts - links), hoehe: rund(unten - oben),
      },
      leinwand: {
        links: rund(leinwand.left), rechts: rund(leinwand.right),
        oben: rund(leinwand.top), unten: rund(leinwand.bottom),
      },
      // Die unteren 20 % der Figur: Bodenkontakt, Standfläche, Fußanker.
      fuesse: {
        links: rund(links), rechts: rund(rechts),
        oben: rund(unten - (unten - oben) * 0.2), unten: rund(unten),
      },
      panel: { links: rund(r.left), rechts: rund(r.right), oben: rund(r.top), unten: rund(r.bottom) },
    };
  });
}

/** Ueberlappende Flaeche zweier Rechtecke in Quadratpixeln. 0 heisst: frei. */
function ueberlappung(a, b) {
  const breite = Math.min(a.rechts, b.rechts) - Math.max(a.links, b.links);
  const hoehe = Math.min(a.unten, b.unten) - Math.max(a.oben, b.oben);
  return breite > 0 && hoehe > 0 ? breite * hoehe : 0;
}

/** Menschenlesbare Lage eines gemessenen Rechtecks. */
const alsText = (r) => `${r.links}..${r.rechts} px waagerecht, ${r.oben}..${r.unten} px senkrecht`;

test('Browser, Rückfrage: Panel und Figur überlappen sich weder bei 1440 noch bei 1024 px', async () => {
  const page = await seiteMitWerkzeugen();
  await page.setViewportSize({ width: 1440, height: 900 });

  const befund = await hochladen(page, XBOT_PFAD);
  assert.equal(Number((befund.status.match(/(\d+)\s+Knochen/) || [])[1]), 67,
    `für die Messung muss Xbot stehen, Status war: "${befund.status}"`);
  await keineFrageOffen(page);

  await frageStellen(page, 'Welcher Absprung gefällt dir besser?',
    ['Variante mit tiefer Hocke', 'Variante mit flachem Absprung']);

  // 1440 px ist der bequeme Fall, 1024 px der enge: die Seite muss laut
  // challenge.md im eingebauten Browser der ChatGPT-Desktop-App laufen, und
  // dessen Fenster ist regelmäßig schmaler als 1440 px.
  for (const breite of [1440, 1024]) {
    await page.setViewportSize({ width: breite, height: 900 });
    const lage = await lageMessen(page);

    assert.ok(lage.figur.rechts > lage.figur.links && lage.figur.unten > lage.figur.oben,
      `bei ${breite} px muss die Figur eine messbare Fläche haben, war: ${alsText(lage.figur)}`);
    assert.ok(lage.figur.breite > 200 && lage.figur.hoehe > 200,
      `bei ${breite} px muss die Figur groß bleiben, war ${lage.figur.breite}×${lage.figur.hoehe} px`);
    assert.equal(ueberlappung(lage.figur, lage.panel), 0,
      `bei ${breite} px darf das Panel die Figur nicht verdecken: Figur ${alsText(lage.figur)}, `
      + `Panel ${alsText(lage.panel)}, ${ueberlappung(lage.figur, lage.panel)} px² überlappen`);
    assert.equal(ueberlappung(lage.leinwand, lage.panel), 0,
      `bei ${breite} px muss das Panel neben der Leinwand stehen, nicht darüber: `
      + `Leinwand ${alsText(lage.leinwand)}, Panel ${alsText(lage.panel)}`);
    assert.ok(lage.panel.oben >= 0 && lage.panel.unten <= 900,
      `bei ${breite} px muss das Panel ganz im Fenster stehen, war: ${alsText(lage.panel)}`);
  }

  // Gegenprobe im engen Fall: das Panel wird absichtlich genau über die Füße
  // gelegt. Meldet die Messung auch dann 0 px², misst sie nichts und die beiden
  // Durchläufe oben beweisen nichts.
  // Erst schweben lassen, dann zielen: aus dem Fluss genommen gibt das Panel
  // seinen Platz frei, die Leinwand wächst zurück und die Füße stehen woanders.
  await page.evaluate(() => {
    const p = document.getElementById('frage');
    p.style.position = 'fixed'; p.style.left = '-9999px'; p.style.top = '0';
  });
  const schwebend = await lageMessen(page);
  await page.evaluate((ziel) => {
    const p = document.getElementById('frage');
    p.style.boxSizing = 'border-box';
    p.style.left = `${ziel.links}px`; p.style.top = `${ziel.oben}px`;
    p.style.width = `${ziel.rechts - ziel.links}px`;
    p.style.height = `${ziel.unten - ziel.oben}px`;
    p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
  }, schwebend.fuesse);

  const gegenprobe = await lageMessen(page);
  assert.ok(ueberlappung(gegenprobe.fuesse, gegenprobe.panel) > 0,
    `die Gegenprobe muss greifen: über die Füße (${alsText(gegenprobe.fuesse)}) gelegt, `
    + `muss das Panel (${alsText(gegenprobe.panel)}) als Überlappung gemeldet werden`);

  await page.close();
});

// --- Mensch-Moment 1: unsichere Rollen bestätigen (plan.md 6.7) --------------

/** Attrappe im Format von detectRig(), plan.md 5.1: eine unsichere Rolle. */
const PROFIL_UNSICHER = {
  schemaVersion: 1,
  roles: {
    pelvis: { bone: 'mixamorigHips', confidence: 1.0 },
    foot_l: { bone: 'mixamorigLeftFoot', confidence: 0.62 },
    foot_r: { bone: 'mixamorigRightFoot', confidence: 0.58 },
  },
  questions: [{
    art: 'rollenbestaetigung', rolle: 'foot_l',
    frage: 'Ist „mixamorigLeftFoot“ die Rolle foot_l? Vorschlag mit Konfidenz 0.62, sicher ab 0.9.',
    optionen: [
      { text: 'ja, „mixamorigLeftFoot“', bone: 'mixamorigLeftFoot', confidence: 0.62 },
      { text: 'nein, sondern „mixamorigRightFoot“', bone: 'mixamorigRightFoot', confidence: 0 },
    ],
  }],
};

test('Browser, Rollen: der fragliche Knochen leuchtet, der Klick legt die Rolle fest', async () => {
  const page = await seiteMitWerkzeugen();
  const befund = await hochladen(page, XBOT_PFAD);
  assert.equal(Number((befund.status.match(/(\d+)\s+Knochen/) || [])[1]), 67,
    `Xbot muss stehen, Status war: "${befund.status}"`);
  await keineFrageOffen(page);

  await page.evaluate((profil) => {
    window.__rollen = null;
    window.__ui.rollenAbfragen(profil).then((r) => { window.__rollen = r; });
  }, PROFIL_UNSICHER);
  await page.waitForFunction(() => {
    const p = document.getElementById('frage');
    return p && !p.hidden && p.querySelectorAll('#frage-optionen button').length > 0;
  }, null, { timeout: 5000 });

  const panel = await panelLesen(page);
  assert.match(panel.frage, /mixamorigLeftFoot/,
    `die Frage muss den fraglichen Knochen nennen, war: "${panel.frage}"`);
  assert.match(panel.frage, /0\.62/,
    `die Frage muss die gemessene Konfidenz nennen, war: "${panel.frage}"`);
  assert.equal(panel.knoepfe.length, 2,
    `Vorschlag und Gegenvorschlag ergeben 2 Karten, es sind ${panel.knoepfe.length}`);

  // Der fragliche Knochen leuchtet — sonst weiß niemand, worüber geredet wird.
  const marker = await page.evaluate(() => {
    const gruppe = window.__scene.scene.getObjectByName('knochen-leuchten');
    const meshes = gruppe.children.filter((k) => k.isMesh);
    const ziel = window.__scene.model.getObjectByName('mixamorigLeftFoot');
    const ort = ziel ? ziel.getWorldPosition(new (ziel.position.constructor)()) : null;
    return {
      knochen: window.__ui.leuchten.stand(),
      anzahl: meshes.length,
      abstand: ort ? meshes[0].position.distanceTo(ort) : -1,
      radius: meshes[0]?.geometry?.parameters?.radius ?? 0,
    };
  });
  assert.deepEqual(marker.knochen, ['mixamorigLeftFoot', 'mixamorigRightFoot'],
    'es leuchten genau die beiden Knochen, zwischen denen der Mensch wählt');
  assert.ok(marker.abstand >= 0 && marker.abstand < 1e-6,
    `der Marker muss auf dem Knochen sitzen, Abstand ${marker.abstand} m`);
  assert.ok(marker.radius > 0.02 && marker.radius < 0.2,
    `der Marker muss zur 1,6-m-Figur passen, Radius war ${marker.radius} m`);

  await page.click('#frage-optionen button[data-index="0"]');
  await page.waitForFunction(() => window.__rollen !== null, null, { timeout: 5000 });

  const ergebnis = await page.evaluate(() => ({
    lauf: window.__rollen,
    bestaetigt: window.__tools.store.lies().roleConfirmations,
    leuchtetNoch: window.__ui.leuchten.stand(),
    panelSichtbar: !document.getElementById('frage').hidden,
  }));

  assert.equal(ergebnis.lauf.bestaetigt, 1,
    `1 Zuordnung erwartet, ${ergebnis.lauf.bestaetigt} festgelegt`);
  assert.equal(ergebnis.bestaetigt.foot_l, 'mixamorigLeftFoot',
    'der Klick muss über confirm_role im Zustand landen');
  assert.deepEqual(ergebnis.leuchtetNoch, [],
    'nach der Antwort leuchtet 0 Knochen weiter');
  assert.equal(ergebnis.panelSichtbar, false, 'das Panel ist nach der Antwort weg');

  await page.close();
});

test('Browser, Rollen Negativfall: Abbruch legt keine Rolle fest und lässt nichts leuchten', async () => {
  const page = await seiteMitWerkzeugen();
  await hochladen(page, XBOT_PFAD);
  await keineFrageOffen(page);

  await page.evaluate((profil) => {
    window.__rollen = null;
    window.__ui.rollenAbfragen(profil).then((r) => { window.__rollen = r; });
  }, PROFIL_UNSICHER);
  await page.waitForFunction(() => !document.getElementById('frage').hidden, null, { timeout: 5000 });

  await page.click('#frage-abbruch');
  await page.waitForFunction(() => window.__rollen !== null, null, { timeout: 5000 });

  const ergebnis = await page.evaluate(() => ({
    lauf: window.__rollen,
    bestaetigt: window.__tools.store.lies().roleConfirmations,
    leuchtetNoch: window.__ui.leuchten.stand(),
  }));

  assert.equal(ergebnis.lauf.abgebrochen, true, 'der Abbruch muss gemeldet werden');
  assert.equal(ergebnis.lauf.bestaetigt, 0,
    `0 Zuordnungen erwartet, ${ergebnis.lauf.bestaetigt} festgelegt`);
  assert.equal(Object.keys(ergebnis.bestaetigt).length, 0,
    `nach dem Abbruch darf 0 Zuordnung im Zustand stehen, es sind ${Object.keys(ergebnis.bestaetigt).length}`);
  assert.equal(ergebnis.bestaetigt.foot_l, undefined,
    'die abgebrochene Rolle darf nicht geraten werden');
  assert.deepEqual(ergebnis.leuchtetNoch, [], 'nach dem Abbruch leuchtet nichts weiter');

  await page.close();
});

// --- Mensch-Moment: was der Agent gerade tut ---------------------------------

/**
 * Ruft ein Werkzeug so auf, wie der Agent es tut: über document.modelContext.
 *
 * Auf diesem Weg meldet die Werkzeugschicht einen abgelehnten Aufruf als
 * geworfene Ausnahme, nicht als Antwort mit isError — die Vereinheitlichung in
 * src/tools/registry.js sitzt auf dem rufe()-Pfad, nicht auf dem registrierten
 * execute. Beides zählt hier als Fehlschlag.
 */
function agentRuft(page, name, args) {
  return page.evaluate(async ({ n, a }) => {
    const werkzeug = document.modelContext.getTools().find((t) => t.name === n);
    if (!werkzeug) throw new Error(`Werkzeug ${n} nicht registriert`);
    try {
      const antwort = await werkzeug.execute(a);
      return { isError: antwort.isError === true, text: antwort.content[0].text };
    } catch (err) {
      return { isError: true, text: err.message };
    }
  }, { n: name, a: args });
}

/** Was in der Spur steht, von oben nach unten. */
function spurLesen(page) {
  return page.evaluate(() => {
    const wurzel = document.getElementById('spur');
    return {
      sichtbar: !wurzel.hidden,
      titel: document.getElementById('spur-titel')?.textContent ?? '',
      zeilen: [...wurzel.querySelectorAll('.spur-zeile')].map((z) => ({
        werkzeug: z.dataset.werkzeug,
        zeit: z.querySelector('.zeit').textContent,
        ergebnis: z.querySelector('.ergebnis').textContent,
        fehler: z.className.includes('fehler'),
      })),
    };
  });
}

test('Browser, Agentenspur: jeder Werkzeugaufruf des Agenten wird sichtbar, ohne den Aufruf zu verändern', async () => {
  const page = await seiteMitWerkzeugen();

  // Negativfall zuerst: solange nichts läuft, steht auch nichts da.
  const leer = await spurLesen(page);
  assert.equal(leer.sichtbar, false,
    `ohne Aufruf darf die Spur nicht erscheinen, sie zeigte ${leer.zeilen.length} Zeilen`);

  const gut = await agentRuft(page, 'set_duration', { frameCount: 90 });
  assert.equal(gut.isError, false, `der Aufruf muss durchlaufen, war: "${gut.text}"`);
  assert.match(gut.text, /90/, `die Antwort an den Agenten bleibt unverändert, war: "${gut.text}"`);

  const nachEinem = await spurLesen(page);
  assert.equal(nachEinem.sichtbar, true, 'nach dem ersten Aufruf ist die Spur da');
  assert.equal(nachEinem.zeilen.length, 1,
    `1 Zeile erwartet, es sind ${nachEinem.zeilen.length}`);
  assert.equal(nachEinem.zeilen[0].werkzeug, 'set_duration');
  assert.match(nachEinem.zeilen[0].zeit, /^\d{2}:\d{2}:\d{2}$/,
    `die Zeile nennt eine Uhrzeit, war: "${nachEinem.zeilen[0].zeit}"`);
  assert.match(nachEinem.zeilen[0].ergebnis, /\d/,
    `die Zeile nennt das Ergebnis mit Zahl, war: "${nachEinem.zeilen[0].ergebnis}"`);
  assert.equal(nachEinem.zeilen[0].fehler, false);
  assert.match(nachEinem.titel, /1 Aufruf/, `der Titel zählt mit, war: "${nachEinem.titel}"`);

  // Ein abgelehnter Aufruf wird als Fehlschlag geführt, nicht verschwiegen.
  const schlecht = await agentRuft(page, 'add_phase',
    { verb: 'takeoff', from: 12, to: 970, params: { vy: 4.2 } });
  assert.equal(schlecht.isError, true,
    `Frame 970 liegt außerhalb von 90 und muss abgelehnt werden, war: "${schlecht.text}"`);

  const nachZwei = await spurLesen(page);
  assert.equal(nachZwei.zeilen.length, 2,
    `2 Zeilen erwartet, es sind ${nachZwei.zeilen.length}`);
  assert.equal(nachZwei.zeilen[0].werkzeug, 'add_phase',
    'der neueste Aufruf steht oben');
  assert.equal(nachZwei.zeilen[0].fehler, true,
    'der abgelehnte Aufruf muss als Fehlschlag zu sehen sein');
  assert.match(nachZwei.zeilen[0].ergebnis, /abgelehnt/);
  assert.equal(nachZwei.zeilen[1].werkzeug, 'set_duration',
    'der ältere Aufruf rutscht nach unten');

  // Der Zustand ist echt geändert worden — die Spur hängt sich an, ohne zu stören.
  assert.equal(await page.evaluate(() => window.__tools.store.lies().frameCount), 90,
    'der umwickelte Aufruf muss dieselbe Wirkung haben wie ohne Spur');
  assert.equal(await page.evaluate(() => window.__tools.store.lies().phases.length), 0,
    'der abgelehnte Aufruf darf nichts hinterlassen');

  await page.close();
});

test('Browser, Agentenspur: sie bleibt kurz — mehr als 8 Aufrufe füllen keine Wand', async () => {
  const page = await seiteMitWerkzeugen();
  for (let i = 0; i < 11; i += 1) {
    await agentRuft(page, 'set_duration', { frameCount: 60 + i });
  }
  const spur = await spurLesen(page);
  assert.equal(spur.zeilen.length, 8,
    `höchstens 8 Zeilen sichtbar, es sind ${spur.zeilen.length}`);
  assert.match(spur.titel, /11 Aufrufe/,
    `gezählt werden trotzdem alle, Titel war: "${spur.titel}"`);
  assert.equal(await page.evaluate(() => window.__tools.store.lies().frameCount), 70,
    'der letzte Aufruf hat gewirkt');

  await page.close();
});

// --- Auslieferung unter einem Unterpfad --------------------------------------
//
// Die Einreichung läuft live unter einer URL, und ob die an der Wurzel einer
// Domain liegt, steht nicht fest — ohne Wildcard-DNS ist ein Unterpfad wie
// …/webmcp/ wahrscheinlich. Ein Pfad ab Wurzel („/vendor/three.module.min.js“)
// lädt dort nicht, und die Seite ist tot, ohne dass ein Test es merkt.
//
// tools/serve.mjs bedient nur die Wurzel und gehört einem anderen Paket. Der
// Unterpfad wird deshalb im Browser hergestellt: alles unter /webmcp/ wird auf
// den Server umgeschrieben, alles daneben bekommt hart 404. Damit scheitert
// jeder Pfad ab Wurzel sichtbar, statt vom Server doch noch bedient zu werden.

const UNTERPFAD = '/webmcp/';

/**
 * Liefert die Seite unter UNTERPFAD aus und sperrt den Rest des Servers.
 * @returns {Promise<{abgewiesen: string[]}>} was außerhalb angefragt wurde
 */
async function unterpfadAusliefern(page) {
  const abgewiesen = [];
  const wurzel = new URL(basis).origin;

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== wurzel) return route.continue();

    if (!url.pathname.startsWith(UNTERPFAD)) {
      abgewiesen.push(url.pathname);
      return route.fulfill({
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        body: `404: ${url.pathname} liegt außerhalb von ${UNTERPFAD} — Pfad ab Wurzel`
      });
    }
    const ziel = new URL(url.pathname.slice(UNTERPFAD.length - 1) + url.search, basis);
    const antwort = await route.fetch({ url: ziel.toString() });
    return route.fulfill({ response: antwort });
  });

  return { abgewiesen };
}

test('Browser, Unterpfad: die Seite läuft vollständig unter …/webmcp/, ohne einen einzigen Pfad ab Wurzel', async () => {
  const page = await browser.newPage();
  const fehler = [];
  page.on('pageerror', (err) => fehler.push(err.message));
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });

  const wache = await unterpfadAusliefern(page);
  await modelContextMockEinsetzen(page);

  const ziel = new URL(UNTERPFAD.slice(1), basis).href;
  await page.goto(ziel, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => document.baseURI.endsWith('/webmcp/')), true,
    `die Seite muss unter ${UNTERPFAD} stehen, war: ${await page.evaluate(() => document.baseURI)}`);

  // three.js kommt über die Import-Map; ohne sie steht keine Szene.
  assert.equal(await page.evaluate(() => !!window.__boot?.bereit), true,
    `das Seitenmodul muss durchgelaufen sein, Fehler: ${fehler.join(' | ') || 'keine'}`);
  assert.equal(await page.evaluate(() => window.__registrierungsaufrufe ?? 0), KATALOG_GROESSE,
    `unter dem Unterpfad müssen dieselben ${KATALOG_GROESSE} Werkzeuge registriert sein`);

  // Der ganze Weg, nicht nur das Laden: Modell rein, Rollenfrage sichtbar.
  const befund = await hochladen(page, XBOT_PFAD);
  assert.equal(Number((befund.status.match(/(\d+)\s+Knochen/) || [])[1]), 67,
    `der Upload muss unter dem Unterpfad genauso laufen, Status war: "${befund.status}"`);
  assert.equal(befund.fehlerSichtbar, false,
    `kein Fehlerfeld erwartet, war: "${befund.fehler}"`);

  await page.waitForFunction(() => !document.getElementById('frage').hidden,
    null, { timeout: 10000 });
  const panel = await panelLesen(page);
  assert.equal(panel.knoepfe.length, 2,
    `auch die Rückfrage muss unter dem Unterpfad stehen, sie zeigte ${panel.knoepfe.length} Karten`);
  await page.click('#frage-optionen button[data-index="0"]');

  assert.deepEqual(wache.abgewiesen, [],
    `kein einziger Pfad darf ab Wurzel gehen, abgewiesen wurden: ${wache.abgewiesen.join(', ')}`);
  assert.deepEqual(fehler, [], `die Seite darf unter dem Unterpfad keinen Fehler melden`);

  await page.close();
});

test('Browser, Unterpfad Negativfall: ein Pfad ab Wurzel wird von der Sperre erwischt', async () => {
  const page = await browser.newPage();
  const wache = await unterpfadAusliefern(page);
  await page.goto(new URL(UNTERPFAD.slice(1), basis).href, { waitUntil: 'load' });

  // Gegenprobe der Sperre: hätte die Seite einen Pfad ab Wurzel, sähe es so aus.
  const antwort = await page.evaluate(async () => {
    const r = await fetch('/vendor/three.module.min.js');
    return { status: r.status, text: (await r.text()).slice(0, 80) };
  });

  assert.equal(antwort.status, 404,
    `ein Pfad ab Wurzel muss unter dem Unterpfad scheitern, Status war ${antwort.status} — `
    + 'sonst beweist der Positivfall nichts');
  assert.match(antwort.text, /außerhalb von \/webmcp\//);
  assert.deepEqual(wache.abgewiesen, ['/vendor/three.module.min.js'],
    'die Sperre muss den Fehlgriff beim Namen nennen');

  await page.close();
});
