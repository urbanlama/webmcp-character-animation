#!/usr/bin/env node
// Bruecke: ein MCP-Server, der die Werkzeuge der laufenden SEITE an einen
// Agenten weiterreicht, der nicht im Browser wohnt (Claude Code, Codex, …).
//
// Warum es die braucht
// ───────────────────
// WebMCP heisst: die Seite legt ihre Werkzeuge in `document.modelContext` ab.
// Ein Agent, der IM Browser sitzt (ChatGPT Atlas), findet sie dort von selbst.
// Ein Agent im Terminal hat diesen Zugang nicht — nicht weil ihm etwas fehlte,
// sondern weil ihm die Tuer fehlt. Diese Datei ist die Tuer.
//
// Der Weg ist derselbe, den ein Browser-Agent nimmt:
//   getTools()               → welche Werkzeuge die Seite anbietet
//   executeTool(name, args)  → einen davon aufrufen
// Beides wird ueber das Chrome DevTools Protocol in der Seite ausgefuehrt.
// Es wird NICHT im DOM geklickt und nichts nachgebaut: was hier ankommt, hat
// die Werkzeugschicht der Seite geliefert.
//
// Zwei Zugaenge, in dieser Reihenfolge
// ────────────────────────────────────
//   1. `document.modelContext` — der echte WebMCP-Transport. Gibt es nur in
//      Chrome mit chrome://flags/#enable-webmcp-testing.
//   2. `window.__tools` — dieselbe Werkzeugschicht, eine Ebene tiefer
//      angefasst. Die Seite legt sie in index.html ohnehin offen, damit sie
//      ohne Flag pruefbar bleibt.
// Welcher Weg benutzt wurde, steht in jeder Antwort und beim Start auf stderr:
// die Bruecke behauptet nie, ueber WebMCP zu sprechen, wenn sie es nicht tut.
//
// Starten
// ───────
//   Chrome mit offenem Debug-Port starten:
//     chrome --remote-debugging-port=9222
//   Seite oeffnen (node tools/serve.mjs → http://localhost:8000/), Modell laden.
//   Dann als MCP-Server eintragen:
//     claude mcp add-json rig-studio '{"command":"node",
//       "args":["tools/webmcp-bridge.mjs"]}' --scope local
//
// Umgebungsvariablen: BRIDGE_CDP_PORT (9222), BRIDGE_SEITE (localhost:8000)

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Debug-Port des Browsers, in dem die Seite laeuft.
 *
 * 9333 ist der Port der Instanz MIT WebMCP-Flag. Ohne das Flag gibt es
 * document.modelContext nicht, und die Bruecke faellt auf window.__tools
 * zurueck — dieselben Werkzeuge, aber nicht der Weg, um den es hier geht.
 * Fuer einen WebMCP-Beitrag darf das nicht der Standard sein.
 */
const CDP_PORT = Number(process.env.BRIDGE_CDP_PORT || 9333);
const SEITE = process.env.BRIDGE_SEITE || 'localhost:8000';
const SEITE_URL = process.env.BRIDGE_URL || `http://${SEITE}/`;

/**
 * Browser, die die Bruecke selbst starten kann, in dieser Reihenfolge.
 *
 * Warum ueberhaupt selbst starten: Ein bereits laufender Browser hilft nur,
 * wenn er einen offenen Debug-PORT hat. Wird er von einem Werkzeug gesteuert,
 * laeuft er meist ueber eine Pipe (--remote-debugging-pipe) — daran kann sich
 * nichts Zweites anhaengen. Statt den Menschen mit einer Kommandozeile
 * loszuschicken, macht die Bruecke sich ihre eigene Instanz auf, mit eigenem
 * Profilordner, damit ein laufender Browser unberuehrt bleibt.
 */
const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** Eigener Profilordner: der laufende Browser des Menschen bleibt unberuehrt. */
const PROFIL = process.env.BRIDGE_PROFIL || join(tmpdir(), 'rig-studio-bruecke');

/** Wie lange ein Werkzeugaufruf in der Seite dauern darf. Der Bildstreifen
 *  rendert echte Pixel; gemessen lagen vier Frames bei rund zwei Sekunden,
 *  zwoelf Frames deutlich darueber. 60 s lassen Luft, ohne den Agenten in
 *  einem haengenden Aufruf stehen zu lassen. */
const AUFRUF_MAX_MS = 60_000;

/** Was die Seite anbietet, wenn ueberhaupt nichts erreichbar ist. */
const KEIN_WERKZEUG = [];

// ─────────────────────────────────────────────────────────────────────────────
// Chrome DevTools Protocol — nur so viel davon, wie gebraucht wird
// ─────────────────────────────────────────────────────────────────────────────

/** Antwortet der Debug-Port? */
async function portLebt() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`,
      { signal: AbortSignal.timeout(700) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Startet einen Browser mit offenem Debug-Port und wartet, bis er antwortet.
 *
 * Der Browser laeuft losgeloest weiter (`detached`) und wird nicht wieder
 * eingesammelt: er soll die Bruecke ueberleben, damit ein Neustart des
 * Agenten nicht das Fenster mit dem geladenen Modell schliesst.
 */
async function starteBrowser() {
  const pfad = BROWSER.find((p) => existsSync(p));
  if (!pfad) {
    throw new Error(
      `Kein Browser gefunden — gesucht an ${BROWSER.length} Orten. `
      + 'Starte selbst einen mit --remote-debugging-port='
      + `${CDP_PORT} und lass die Brücke erneut laufen.`);
  }
  notiz(`starte ${pfad.split(/[\\/]/).pop()} auf Port ${CDP_PORT}`);
  const kind = spawn(pfad, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFIL}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Ohne dieses Flag existiert document.modelContext nicht. Gemessen in
    // Chrome 151: mit Flag meldet die Seite "connected" und registriert ihre
    // Werkzeuge ueber WebMCP; ohne Flag bleibt nur der Ersatzweg.
    '--enable-features=WebMCP,WebMCPTesting,ModelContextProtocol',
    SEITE_URL,
  ], { detached: true, stdio: 'ignore' });
  kind.unref();

  for (let versuch = 0; versuch < 40; versuch += 1) {
    if (await portLebt()) {
      notiz(`Browser antwortet nach ${(versuch + 1) * 250} ms`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Browser gestartet, aber Port ${CDP_PORT} antwortete 10 s lang nicht`);
}

/** Alle offenen Seiten der Browser-Instanz; startet sie bei Bedarf. */
async function seitenListe() {
  if (!(await portLebt())) await starteBrowser();
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP antwortete ${res.status} auf /json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

/**
 * Die Seite, auf der das Rig-Studio laeuft.
 *
 * Gesucht wird nach der Adresse, nicht nach dem Titel: der Titel aendert sich
 * mit dem geladenen Modell, die Adresse nicht.
 */
async function findeSeite() {
  const seiten = await seitenListe();
  const treffer = seiten.filter((s) => (s.url || '').includes(SEITE));
  if (treffer.length > 0) return treffer[0];

  // Browser laeuft, die Seite ist nur nicht offen: aufmachen statt meckern.
  notiz(`${SEITE} war nicht offen — öffne ${SEITE_URL}`);
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(SEITE_URL)}`,
    { method: 'PUT' });
  if (!res.ok) {
    throw new Error(
      `0 von ${seiten.length} offenen Seiten laufen auf ${SEITE}, und das Öffnen `
      + `schlug fehl (${res.status}). Läuft der Server? "node tools/serve.mjs" startet ihn.`);
  }
  const neu = await res.json();

  // Die Seite laedt Module nach; ohne kurzes Warten steht window.__tools noch
  // nicht. Der Ladezustand wird an window.__boot.bereit sichtbar gemacht.
  await new Promise((r) => setTimeout(r, 1200));
  return neu;
}

/** Eine Verbindung zur Seite, die mehrere Auswertungen ueberlebt. */
async function verbinde() {
  const seite = await findeSeite();
  const ws = new WebSocket(seite.webSocketDebuggerUrl);
  await new Promise((auf, ab) => {
    ws.addEventListener('open', auf, { once: true });
    ws.addEventListener('error', () => ab(new Error(
      `Verbindung zur Seite ${seite.url} nicht möglich (CDP-Port ${CDP_PORT})`)), { once: true });
  });

  let id = 0;
  const offen = new Map();
  ws.addEventListener('message', (ev) => {
    let nachricht;
    try { nachricht = JSON.parse(ev.data); } catch { return; }
    const warte = offen.get(nachricht.id);
    if (!warte) return;
    offen.delete(nachricht.id);
    if (nachricht.error) warte.ab(new Error(nachricht.error.message));
    else warte.auf(nachricht.result);
  });

  /** Fuehrt einen Ausdruck IN der Seite aus und gibt den Wert zurueck. */
  async function werteAus(ausdruck) {
    const eigene = ++id;
    const ergebnis = await new Promise((auf, ab) => {
      offen.set(eigene, { auf, ab });
      const uhr = setTimeout(() => {
        offen.delete(eigene);
        ab(new Error(`Die Seite antwortete ${AUFRUF_MAX_MS} ms lang nicht`));
      }, AUFRUF_MAX_MS);
      const fertig = (fn) => (v) => { clearTimeout(uhr); fn(v); };
      offen.set(eigene, { auf: fertig(auf), ab: fertig(ab) });
      ws.send(JSON.stringify({
        id: eigene,
        method: 'Runtime.evaluate',
        params: {
          expression: ausdruck,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
      }));
    });
    if (ergebnis.exceptionDetails) {
      const e = ergebnis.exceptionDetails;
      throw new Error(e.exception?.description || e.text || 'Fehler in der Seite');
    }
    return ergebnis.result?.value;
  }

  return { seite, werteAus, schliesse: () => ws.close() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Was in der Seite ausgefuehrt wird
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Holt den Werkzeugkatalog — bevorzugt ueber den echten WebMCP-Transport.
 *
 * Der Katalog wird bei JEDER Abfrage frisch geholt, nicht einmal beim Start:
 * die Seite erzeugt Werkzeuge zur Laufzeit nach, sobald ein Modell hochgeladen
 * ist. Ein einmal gemerkter Katalog waere nach dem Upload falsch.
 */
const HOLE_WERKZEUGE = `(async () => {
  // Die Seite laedt ihre Module nach und meldet sich mit window.__boot.bereit.
  // Ohne dieses Warten kam beim ersten Start reproduzierbar "0 Werkzeuge"
  // zurueck — die Bruecke war schneller als der Modulbaum.
  const bis = Date.now() + 15000;
  while (Date.now() < bis) {
    if (window.__boot && (window.__boot.bereit || window.__boot.fehlerr?.length)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (window.__boot?.fehlerr?.length) {
    return { weg: 'keiner', werkzeuge: [], grund:
      'Die Seite konnte ' + window.__boot.fehlerr.length + ' Module nicht laden: '
      + window.__boot.fehlerr.join(', ') };
  }
  // Nur einfache Werte zurueckgeben. Der echte document.modelContext liefert
  // Werkzeugobjekte mit Funktionen und Rueckverweisen; CDP lehnte sie mit
  // "Object reference chain is too long" ab. Name, Beschreibung und Schema
  // sind alles, was der Agent sieht — mehr wird nicht gebraucht.
  // Gemessen in Chrome 151: der echte document.modelContext gibt inputSchema
  // als JSON-STRING zurueck, nicht als Objekt — MCP verlangt ein Objekt und
  // weist die ganze Werkzeugliste sonst ab ("expected object, received
  // string"). window.__tools liefert dagegen ein Objekt. Beides wird hier auf
  // die Form gebracht, die das Protokoll erwartet.
  const alsObjekt = (schema) => {
    if (typeof schema === 'string') {
      try { return JSON.parse(schema); } catch { return { type: 'object', properties: {} }; }
    }
    if (schema && typeof schema === 'object') {
      try { return JSON.parse(JSON.stringify(schema)); } catch { /* faellt durch */ }
    }
    return { type: 'object', properties: {} };
  };
  const flach = (liste) => (liste || []).map((w) => ({
    name: String(w.name || ''),
    description: String(w.description || ''),
    inputSchema: alsObjekt(w.inputSchema),
  }));

  const mc = document.modelContext;
  if (mc && typeof mc.getTools === 'function') {
    return { weg: 'document.modelContext', werkzeuge: flach(await mc.getTools()) };
  }
  if (window.__tools && typeof window.__tools.getTools === 'function') {
    return { weg: 'window.__tools', werkzeuge: flach(window.__tools.getTools()) };
  }
  return { weg: 'keiner', werkzeuge: [], grund:
    'Weder document.modelContext noch window.__tools sind da — lädt die Seite noch?' };
})()`;

/** Ruft ein Werkzeug auf. Gibt immer { weg, antwort } zurueck. */
function rufeWerkzeug(name, args) {
  const n = JSON.stringify(name);
  const argObj = JSON.stringify(args ?? {});
  const argStr = JSON.stringify(JSON.stringify(args ?? {}));
  return `(async () => {
    const mc = document.modelContext;
    if (mc && typeof mc.executeTool === 'function') {
      // Gemessen in Chrome 151: executeTool erwartet das WERKZEUGOBJEKT aus
      // getTools(), nicht seinen Namen. Mit einem String antwortet es
      // "The provided value is not of type 'RegisteredTool'". Deshalb wird
      // das Werkzeug zuerst in der Liste gesucht.
      const liste = await mc.getTools();
      const werkzeug = (liste || []).find((w) => w && w.name === ${n});
      if (!werkzeug) {
        throw new Error('Werkzeug ' + ${n} + ' steht nicht in getTools(): '
          + (liste || []).length + ' registriert');
      }
      let roh;
      try {
        roh = await mc.executeTool(werkzeug, ${argObj});
      } catch (e) {
        // Zweite gemessene Form: Argumente als JSON-String.
        roh = await mc.executeTool(werkzeug, ${argStr});
      }
      return { weg: 'document.modelContext',
               antwort: typeof roh === 'string' ? JSON.parse(roh) : roh };
    }
    if (window.__tools && typeof window.__tools.rufe === 'function') {
      return { weg: 'window.__tools', antwort: await window.__tools.rufe(${n}, ${argObj}) };
    }
    throw new Error('Kein Zugang zur Werkzeugschicht: weder document.modelContext '
      + 'noch window.__tools sind vorhanden');
  })()`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP ueber stdio — zeilenweises JSON-RPC 2.0
// ─────────────────────────────────────────────────────────────────────────────

function sende(nachricht) {
  process.stdout.write(`${JSON.stringify(nachricht)}\n`);
}

function antwort(id, result) {
  sende({ jsonrpc: '2.0', id, result });
}

function fehler(id, code, message) {
  sende({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Nur fuer den Menschen im Terminal — stdout gehoert dem Protokoll. */
function notiz(text) {
  process.stderr.write(`[bruecke] ${text}\n`);
}

let sitzung = null;

/** Verbindung bei Bedarf aufbauen, bei Abriss neu aufbauen. */
async function seite() {
  if (sitzung) {
    try {
      await sitzung.werteAus('1');
      return sitzung;
    } catch {
      notiz('Verbindung zur Seite war weg — baue neu auf');
      sitzung = null;
    }
  }
  sitzung = await verbinde();
  notiz(`verbunden mit ${sitzung.seite.url}`);
  return sitzung;
}

async function listeWerkzeuge() {
  const s = await seite();
  const { weg, werkzeuge, grund } = await s.werteAus(HOLE_WERKZEUGE);
  if (weg === 'keiner') {
    notiz(grund);
    return KEIN_WERKZEUG;
  }
  notiz(`${werkzeuge.length} Werkzeuge über ${weg}`);
  return werkzeuge.map((w) => ({
    name: w.name,
    description: w.description,
    inputSchema: w.inputSchema ?? { type: 'object', properties: {} },
  }));
}

/**
 * Reicht die Antwort der Seite durch.
 *
 * Die Werkzeugschicht antwortet bereits im MCP-Format ({content:[…]}), Bilder
 * eingeschlossen. Es wird deshalb nichts umgebaut — nur der benutzte Weg als
 * letzte Textzeile angehaengt, damit im Verlauf sichtbar bleibt, ob gerade
 * ueber WebMCP oder ueber die Werkzeugschicht gesprochen wurde.
 */
async function ruf(name, args) {
  const s = await seite();
  const { weg, antwort: a } = await s.werteAus(rufeWerkzeug(name, args));
  const inhalt = Array.isArray(a?.content) ? [...a.content] : [{ type: 'text', text: String(a) }];
  inhalt.push({ type: 'text', text: `— über ${weg} —` });
  return { content: inhalt, isError: a?.isError === true };
}

const METHODEN = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'rig-studio-bruecke', version: '0.1.0' },
  }),
  'notifications/initialized': () => null,
  'tools/list': async () => ({ tools: await listeWerkzeuge() }),
  'tools/call': async (params) => ruf(params?.name, params?.arguments),
};

const zeilen = createInterface({ input: process.stdin });

zeilen.on('line', async (zeile) => {
  if (!zeile.trim()) return;
  let nachricht;
  try {
    nachricht = JSON.parse(zeile);
  } catch {
    return; // kaputte Zeile: nichts zu beantworten, keine id bekannt
  }
  const methode = METHODEN[nachricht.method];
  if (!methode) {
    if (nachricht.id !== undefined) {
      fehler(nachricht.id, -32601, `Methode "${nachricht.method}" kennt die Brücke nicht`);
    }
    return;
  }
  try {
    const ergebnis = await methode(nachricht.params);
    if (nachricht.id !== undefined && ergebnis !== null) antwort(nachricht.id, ergebnis);
  } catch (e) {
    const text = e?.message || String(e);
    notiz(`Fehler bei ${nachricht.method}: ${text}`);
    if (nachricht.id !== undefined) {
      // Werkzeugfehler gehoeren in die Antwort, nicht in den Protokollfehler —
      // sonst sieht der Agent nur "call failed" statt der Meldung der Seite.
      if (nachricht.method === 'tools/call') {
        antwort(nachricht.id, { content: [{ type: 'text', text }], isError: true });
      } else {
        fehler(nachricht.id, -32603, text);
      }
    }
  }
});

notiz(`bereit — CDP-Port ${CDP_PORT}, Seite ${SEITE}`);
