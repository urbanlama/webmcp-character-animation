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
//            KATALOG_SICHTBAR.length Werkzeuge bei ihm registrieren — die
//            Werkzeugkiste (KISTE) ist fuer den Agenten absichtlich unsichtbar
//            und zaehlt nicht mit.
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
import { ZEILEN_STANDARD } from '../src/ui/agentenspur.js';
import { FRAME_MAX, KATALOG, KATALOG_GROESSE, KATALOG_SICHTBAR } from '../src/tools/catalog.js';

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
 *
 * Warum vorher ein Merkzeichen in die Statuszeile geschrieben wird: Die Seite
 * laedt das Beispielmodell beim Start von selbst und schreibt dabei
 * "Xbot.glb — 67 bones" in #status. Die alte Wartebedingung lautete "Status
 * enthaelt bones ODER Fehlerfeld sichtbar" — die war damit schon erfuellt,
 * bevor die eigene Datei ueberhaupt im Eingabefeld lag. Der Helfer las den
 * Stand VOR seinem eigenen Upload zurueck; der Wuerfel-Negativfall scheiterte
 * daran mit "Fehlerfeld muss sichtbar sein, Status war: Xbot.glb — 67 bones".
 *
 * Das Merkzeichen wird von jedem Ausgang von loadFile() ueberschrieben:
 * Erfolg (presentModel setzt Name und Knochenzahl), Ablehnung (catch setzt
 * "No model loaded") und Messfehler (haengt " — not measured" an). Gewartet
 * wird also darauf, dass die Seite auf DIESE Datei geantwortet hat.
 *
 * @returns {Promise<{status: string, fehler: string}>}
 */
async function hochladen(page, pfad) {
  // Erst das Startladen der Seite abwarten (index.html setzt das Flag im
  // finally des Beispielmodell-Ladens). Sonst kann dessen Ergebnis nach dem
  // eigenen Upload eintreffen und die Statuszeile ueberschreiben — der
  // Wuerfel-Negativfall wurde dadurch unter CPU-Last sporadisch rot.
  await page.waitForFunction(() => window.__boot?.startmodellFertig === true,
    undefined, { timeout: 30000 });

  const MERKZEICHEN = '(Testmarke: Upload laeuft)';
  await page.evaluate((m) => { document.getElementById('status').textContent = m; }, MERKZEICHEN);
  await page.setInputFiles('#file', pfad);
  await page.waitForFunction((m) => {
    const s = document.getElementById('status');
    const e = document.getElementById('error');
    return !!s && (s.textContent !== m || e.style.display === 'block');
  }, MERKZEICHEN, { timeout: 30000 });

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
  // Ohne document.modelContext steht die Werkzeugschicht trotzdem — sie ist
  // dann nur bei niemandem registriert. Sichtbar gesagt wird das im Hinweis;
  // der normale Uploadlauf bleibt unverändert.
  const ohneKontext = await page.evaluate(() => ({
    schicht: !!window.__tools,
    registriert: window.__registrierungsaufrufe ?? 0,
    hinweisSichtbar: !document.getElementById('hinweis').hidden,
    hinweis: document.getElementById('hinweis').textContent,
  }));
  assert.equal(ohneKontext.schicht, true,
    'ohne document.modelContext muss window.__tools trotzdem stehen: die Werkzeuge sollen '
    + 'auch ohne Flag prüfbar sein');
  assert.equal(ohneKontext.registriert, 0,
    `ohne document.modelContext darf nichts registriert werden, waren: ${ohneKontext.registriert}`);
  assert.equal(ohneKontext.hinweisSichtbar, true,
    'ohne document.modelContext muss die Seite sichtbar sagen, was fehlt');
  assert.match(ohneKontext.hinweis, /enable-webmcp-testing/,
    `Hinweis muss den Weg nennen, war: "${ohneKontext.hinweis}"`);

  const befund = await hochladen(page, XBOT_PFAD);
  const gefunden = Number((befund.status.match(/(\d+)\s+bones/) || [])[1]);

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

test(`Browser, Werkzeugschicht: Mock-Kontext vor dem Laden beweist genau ${KATALOG_SICHTBAR.length} registrierte Tools`, async () => {
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
  assert.equal(befund.aufrufe, KATALOG_SICHTBAR.length,
    `registerTool muss genau ${KATALOG_SICHTBAR.length}-mal aufgerufen sein, war: ${befund.aufrufe} — `
    + 'genau einmal createToolLayer, kein zweites Mal');
  assert.equal(befund.beimMock.length, new Set(befund.beimMock).size,
    `jeder Name darf genau einmal registriert sein, es sind ${befund.beimMock.length} Aufrufe `
    + `mit ${new Set(befund.beimMock).size} verschiedenen Namen`);
  assert.deepEqual(befund.beimMock, KATALOG_SICHTBAR.map((t) => t.name),
    `beim Mock müssen genau die ${KATALOG_SICHTBAR.length} sichtbaren Katalogwerkzeuge liegen, `
    + `es sind ${befund.beimMock.length}: ${befund.beimMock.join(', ')}`);
  assert.deepEqual(befund.schicht, befund.beimMock,
    'die Schicht und der Mock müssen dieselben Werkzeuge sehen');

  await page.close();
});

// --- Rueckfrage und Rollenbestaetigung: sechs Tests entfernt ------------------
//
// Hier standen sechs Browser-Tests: "Rueckfrage sichtbar", "zwei Varianten",
// "Rueckfrage Negativfall", "Panel und Figur ueberlappen sich nicht", "Rollen:
// der fragliche Knochen leuchtet", "Rollen Negativfall". Sie sind geloescht,
// nicht uebersprungen. Der Befund, der dazu gefuehrt hat (Stand 1. September
// 2026, Commit de77965):
//
//   index.html hat kein Element #frage mehr — das Fragefenster ist nicht
//     ausgeblendet, es wird gar nicht erst gebaut.
//   window.__ui.rollenAbfragen ist ausdruecklich null gesetzt.
//   ask_human traegt kiste:true in src/tools/catalog.js und wird deshalb nicht
//     bei document.modelContext registriert; der Agent sieht 18 Werkzeuge,
//     nicht 23 (auch confirm_role liegt in der Kiste).
//
// Ein uebersprungener Test waere hier eine Luege in Vorrat: die Oberflaeche
// soll zwar wiederkommen, aber ANDERS. Der Kommentar am Abschaltpunkt legt sie
// fest als "Frage, die ein Mensch beantworten kann: zum leuchtenden
// Koerperteil, in ganzen Saetzen, ohne eine einzige Zahl". Genau die Zahlen
// haben diese Tests eingefordert — Budgetstand "2 of 3 questions",
// Knochenname mixamorigLeftFoot, Konfidenz 0.62. Wieder eingeschaltet waeren
// sie rot, obwohl der Neubau richtig ist.
//
// Was von der Abdeckung bleibt, in Node und ohne Browser:
//   src/ui/rueckfrage.test.mjs  9 Tests auf den Broker ask-human.js
//   src/ui/rollen.test.mjs      7 Tests auf rollen-bestaetigung.js
//   src/rig/fragetexte.test.mjs auf die Fragetexte aus detect.js
//
// Was ohne Abdeckung DASTEHT und beim Neubau nicht als geprueft gelten darf:
// src/ui/frage-panel.js. Das Modul wird von keiner Datei mehr importiert —
// nur ein CSS-Kommentar in index.html erwaehnt es noch. Seine einzige Pruefung
// waren die sechs Tests hier. Wer das Fragefenster neu baut, faengt bei diesem
// Modul bei null an.

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
 * Wartet, bis der Autostart der Seite durch ist.
 *
 * Warum kein festes Warten: hier stand `await page.waitForTimeout(600)`. Der
 * Autostart laedt das Beispielmodell, vermisst es und ordnet die Rollen zu und
 * schreibt dabei ZWEI Zeilen in die Agentenspur ("Measurement",
 * "Rollenerkennung"). Brauchte er laenger als 600 ms, landeten seine Zeilen
 * zwischen den beiden Messpunkten des Tests und wurden dem eigenen Aufruf
 * zugerechnet: "genau 1 Zeile mehr erwartet (vorher 1), es sind 3". Eine
 * groessere Zahl waere dieselbe Wette mit hoeherem Einsatz.
 *
 * Gewartet wird stattdessen auf das ENDE des Autostarts. Seine letzte Handlung
 * steht in index.html, loadFile(): presentModel, dann messeFuerWerkzeuge, dann
 * bestaetigeUnsichereRollen. Steht deren Zeile in der Spur, kommt von selbst
 * keine weitere mehr. Schlaegt das Laden fehl, schreibt der Autostart eine
 * Zeile "Start" — auch dann ist er fertig, und der Test darf messen statt
 * still in ein Zeitlimit zu laufen.
 */
async function warteAufAutostart(page) {
  await page.waitForFunction(() => {
    const namen = [...document.querySelectorAll('#spur .spur-zeile')]
      .map((z) => z.dataset.werkzeug);
    return namen.includes('Rollenerkennung')
      || namen.includes('Role detection')
      || namen.includes('Start');
  }, null, { timeout: 30000 });
}
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

  // Ausgangsstand: die Seite laedt das Beispielmodell beim Start selbst und
  // meldet Vermessung und Rollenzuordnung in der Spur. Gezaehlt wird deshalb
  // der ZUWACHS, nicht der absolute Stand — und gemessen erst, wenn der
  // Autostart wirklich durch ist (siehe warteAufAutostart).
  await warteAufAutostart(page);
  const vorher = await spurLesen(page);

  const gut = await agentRuft(page, 'set_duration', { frameCount: 90 });
  assert.equal(gut.isError, false, `der Aufruf muss durchlaufen, war: "${gut.text}"`);
  assert.match(gut.text, /90/, `die Antwort an den Agenten bleibt unverändert, war: "${gut.text}"`);

  const nachEinem = await spurLesen(page);
  assert.equal(nachEinem.sichtbar, true, 'nach dem ersten Aufruf ist die Spur da');
  assert.equal(nachEinem.zeilen.length, vorher.zeilen.length + 1,
    `genau 1 Zeile mehr erwartet (vorher ${vorher.zeilen.length}), `
    + `es sind ${nachEinem.zeilen.length}`);
  assert.equal(nachEinem.zeilen[0].werkzeug, 'set_duration',
    'der neueste Aufruf steht oben');
  assert.match(nachEinem.zeilen[0].zeit, /^\d{2}:\d{2}:\d{2}$/,
    `die Zeile nennt eine Uhrzeit, war: "${nachEinem.zeilen[0].zeit}"`);
  assert.match(nachEinem.zeilen[0].ergebnis, /\d/,
    `die Zeile nennt das Ergebnis mit Zahl, war: "${nachEinem.zeilen[0].ergebnis}"`);
  assert.equal(nachEinem.zeilen[0].fehler, false);
  assert.match(nachEinem.titel, new RegExp(`${nachEinem.zeilen.length} calls?`),
    `der Titel zählt mit, war: "${nachEinem.titel}"`);

  // Die Spur muss den abgelehnten Agenten-Aufruf sichtbar führen. Der
  // vorherige Fall benutzte add_phase mit from 12 / to 970 — ein Werkzeug
  // der Kiste, das der Agent nicht mehr sieht und das über getTools() nicht
  // mehr erreichbar ist. Der Negativfall bleibt: set_duration mit frameCount
  // 970 wird vom Handler nach plan.md 5.4 abgelehnt, weil 970 über FRAME_MAX
  // liegt; die Meldung nennt die Grenze (AGENTS.md, Zahl im Fehlertext).
  const schlecht = await agentRuft(page, 'set_duration', { frameCount: 970 });
  assert.equal(schlecht.isError, true,
    `frameCount 970 liegt über FRAME_MAX ${FRAME_MAX} und muss abgelehnt werden, war: "${schlecht.text}"`);

  const nachZwei = await spurLesen(page);
  assert.equal(nachZwei.zeilen.length, vorher.zeilen.length + 2,
    `genau 2 Zeilen mehr als zu Beginn erwartet (vorher ${vorher.zeilen.length}), `
    + `es sind ${nachZwei.zeilen.length}`);
  assert.equal(nachZwei.zeilen[0].werkzeug, 'set_duration',
    'der neueste Aufruf steht oben');
  assert.equal(nachZwei.zeilen[0].fehler, true,
    'der abgelehnte Aufruf muss als Fehlschlag zu sehen sein');
  assert.match(nachZwei.zeilen[0].ergebnis, /rejected/);
  assert.equal(nachZwei.zeilen[1].werkzeug, 'set_duration',
    'der ältere Aufruf rutscht nach unten');

  // Der Zustand ist echt geändert worden — die Spur hängt sich an, ohne zu stören.
  assert.equal(await page.evaluate(() => window.__tools.store.lies().frameCount), 90,
    'der umwickelte Aufruf muss dieselbe Wirkung haben wie ohne Spur');
  assert.equal(await page.evaluate(() => window.__tools.store.lies().phases.length), 0,
    'der abgelehnte Aufruf darf nichts hinterlassen');

  await page.close();
});

test('Browser, Agentenspur: sie bleibt kurz — mehr als die Obergrenze an Aufrufen füllt keine Wand', async () => {
  const page = await seiteMitWerkzeugen();
  // Etwas über der Grenze: die Spur muss ein Fenster bleiben, nicht eine Wand.
  const mehrAlsDieGrenze = ZEILEN_STANDARD + 3;
  for (let i = 0; i < mehrAlsDieGrenze; i += 1) {
    await agentRuft(page, 'set_duration', { frameCount: 60 + (i % 200) });
  }
  const spur = await spurLesen(page);
  assert.equal(spur.zeilen.length, ZEILEN_STANDARD,
    `höchstens ${ZEILEN_STANDARD} Zeilen sichtbar, es sind ${spur.zeilen.length}`);
  // Einträge fallen vorne wieder heraus, sobald die Obergrenze erreicht ist —
  // der Titel zählt nur, was noch im Fenster liegt, nicht die Gesamtzahl.
  assert.match(spur.titel, new RegExp(`${ZEILEN_STANDARD} calls`),
    `gezählt werden alle im Fenster bis zur Obergrenze, Titel war: "${spur.titel}"`);
  // Aelteste fallen hinten raus, der neueste steht oben.
  assert.equal(await page.evaluate(() => window.__tools.store.lies().frameCount),
    60 + ((mehrAlsDieGrenze - 1) % 200),
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

/**
 * Schliesst eine Seite, die unter der Umleitung lief.
 *
 * Warum nicht einfach page.close(): Die Umleitung oben holt jede Datei selbst
 * beim Server ab. Das Beispielmodell ist 2,9 MB gross; wird die Seite
 * geschlossen, waehrend so eine Abholung noch laeuft, scheitert route.fulfill
 * mit "Fetch response has been disposed". Playwright kann diesen Fehlschlag
 * niemandem mehr zustellen und macht daraus ein unhandledRejection — der
 * Testlauf meldete danach 7 von 7 gruen UND Exit-Code 1.
 *
 * unrouteAll raeumt die Umleitung ab und laesst die letzten Abholungen ins
 * Leere laufen, statt sie in einen Fehler zu schicken. Das ist der von
 * Playwright dafuer vorgesehene Weg.
 */
async function beendeUnterpfad(page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.close();
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
  assert.equal(await page.evaluate(() => window.__registrierungsaufrufe ?? 0), KATALOG_SICHTBAR.length,
    `unter dem Unterpfad müssen dieselben ${KATALOG_SICHTBAR.length} Werkzeuge registriert sein`);

  // Der ganze Weg, nicht nur das Laden: Modell rein, Rollen zugeordnet.
  await warteAufAutostart(page);
  const rollenmeldungen = () => page.evaluate(() =>
    [...document.querySelectorAll('#spur .spur-zeile')]
      .filter((z) => z.dataset.werkzeug === 'Rollenerkennung')
      .map((z) => z.querySelector('.ergebnis').textContent));
  const vorUpload = (await rollenmeldungen()).length;
  assert.equal(vorUpload, 1,
    `der Autostart muss auch unter dem Unterpfad durchlaufen und genau 1 Rollenmeldung `
    + `hinterlassen, es sind ${vorUpload} — das Beispielmodell kommt über einen relativen `
    + 'Pfad, ein Fehlgriff ab Wurzel bliebe sonst unbemerkt');

  const befund = await hochladen(page, XBOT_PFAD);
  assert.equal(Number((befund.status.match(/(\d+)\s+bones/) || [])[1]), 67,
    `der Upload muss unter dem Unterpfad genauso laufen, Status war: "${befund.status}"`);
  assert.equal(befund.fehlerSichtbar, false,
    `kein Fehlerfeld erwartet, war: "${befund.fehler}"`);

  // KEINE Rollenrückfrage beim Xbot — und das ist die Zusicherung.
  //
  // Der Xbot ist ein Mixamo-Rig: seine Knochen heißen mixamorigLeftLeg,
  // mixamorigRightShoulder und so fort. Die Zuordnung steht damit im Namen und
  // wird nicht geschätzt (erkenneKonvention in src/rig/detect.js). Vorher
  // schätzte die Geometrie 0,54 für den Unterschenkel, und die Seite stellte
  // dem Menschen achtzehn Fragen zu einem Modell, das sie selbst mitliefert —
  // ein Agent hielt das für eine Vorbedingung und begann zu bestätigen, statt
  // zu animieren. Gefragt wird jetzt nur noch bei Rigs, die sich nicht selbst
  // benennen.
  //
  // Wie das seit dem 1. September 2026 gemessen wird: Hier stand
  // `document.getElementById('frage').hidden` nach 1200 ms fester Wartezeit.
  // Das Fragefenster ist abgeschaltet, #frage steht nicht mehr im Dokument —
  // die Zeile warf einen TypeError auf null, statt etwas zu prüfen. Und sie
  // hätte auch nichts bewiesen: ein Fenster, das es nicht gibt, ist kein Beleg
  // dafür, dass der Xbot keine unsichere Rolle hat. Gemessen wird deshalb der
  // Befund der Rollenerkennung selbst, den die Agentenspur mitschreibt — er
  // entsteht ERST NACH dem Upload, also wird auf ihn gewartet statt auf die Uhr.
  await page.waitForFunction((n) => [...document.querySelectorAll('#spur .spur-zeile')]
    .filter((z) => z.dataset.werkzeug === 'Rollenerkennung').length > n,
  vorUpload, { timeout: 30000 });

  const rollen = await rollenmeldungen();
  assert.ok(rollen.length > vorUpload,
    `die Rollenerkennung muss nach dem Upload gelaufen sein, `
    + `${rollen.length} Meldungen bei ${vorUpload} vorher`);
  for (const zeile of rollen) {
    assert.match(zeile, /\b0 unsicher/,
      `beim Xbot darf 0 Rolle unsicher bleiben, gemeldet wurde: "${zeile}"`);
  }
  assert.equal(await page.evaluate(() => document.getElementById('frage') === null), true,
    'das Fragefenster ist abgeschaltet: #frage darf nicht im Dokument stehen');

  assert.deepEqual(wache.abgewiesen, [],
    `kein einziger Pfad darf ab Wurzel gehen, abgewiesen wurden: ${wache.abgewiesen.join(', ')}`);
  assert.deepEqual(fehler, [], `die Seite darf unter dem Unterpfad keinen Fehler melden`);

  await beendeUnterpfad(page);
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

  await beendeUnterpfad(page);
});
