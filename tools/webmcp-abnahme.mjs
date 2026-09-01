#!/usr/bin/env node
// Abnahmelauf ueber Chromes eigene Agenten-Schnittstelle.
//
// Was das hier von tests/e2e/ unterscheidet
// ─────────────────────────────────────────
// Die E2E-Laeufe rufen unsere Bauteile auf. Dieser Lauf ruft gar nichts von
// uns: er spricht die DevTools-Domain `WebMCP` an, die Chrome 152 mitbringt.
//
//   WebMCP.enable      → Chrome meldet, welche Werkzeuge die Seite registriert
//   WebMCP.invokeTool  → Chrome ruft eines davon auf
//   toolsAdded / toolInvoked / toolResponded  → Chrome berichtet
//
// Das ist derselbe Weg, den ein Agent im Browser nimmt. Kein window.__tools,
// keine eigene Bruecke, kein Nachbau. Was hier ankommt, hat Chrome geliefert;
// was hier fehlt, fehlt auch dem Agenten der Jury.
//
// Starten
// ───────
//   node tools/serve.mjs            (in einem anderen Fenster)
//   node tools/webmcp-abnahme.mjs
//
// Umgebungsvariablen: ABNAHME_PORT (9333), ABNAHME_URL (http://localhost:8000/),
// ABNAHME_CHROME (Pfad zur chrome.exe), ABNAHME_SICHTBAR=1 (Fenster zeigen).
//
// Exit 0 = alles gruen. Exit 1 = mindestens eine Pruefung rot, mit Zahl.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.ABNAHME_PORT || 9333);
const URL_SEITE = process.env.ABNAHME_URL || 'http://localhost:8000/';
const PROFIL = join(tmpdir(), 'webmcp-abnahme-profil');

/**
 * Ohne diese drei Features gibt es weder document.modelContext noch die
 * DevTools-Domain. WebMCPTesting entspricht chrome://flags/#enable-webmcp-testing,
 * DevToolsWebMCPSupport dem Flag #devtools-webmcp-support — gemessen an
 * Chrome 152.0.7977.65: fehlt das zweite, bleibt toolsAdded stumm.
 */
const FEATURES = 'WebMCP,WebMCPTesting,DevToolsWebMCPSupport';

const BROWSER = [
  process.env.ABNAHME_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// Protokoll des Laufs
// ─────────────────────────────────────────────────────────────────────────────

const befunde = [];
let rot = 0;

function pruefe(was, bedingung, belegt) {
  if (bedingung) befunde.push(`  OK    ${was}${belegt ? ` — ${belegt}` : ''}`);
  else { rot += 1; befunde.push(`  ROT   ${was}${belegt ? ` — ${belegt}` : ''}`); }
  return bedingung;
}

function notiz(text) { process.stderr.write(`[abnahme] ${text}\n`); }

// ─────────────────────────────────────────────────────────────────────────────
// Browser und CDP
// ─────────────────────────────────────────────────────────────────────────────

async function portLebt() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
}

async function starteBrowser() {
  if (await portLebt()) { notiz(`Port ${PORT} antwortet bereits, haenge mich an`); return; }
  const pfad = BROWSER.find((p) => existsSync(p));
  if (!pfad) throw new Error(`Kein Chrome gefunden — an ${BROWSER.length} Orten gesucht. `
    + 'Pfad ueber ABNAHME_CHROME setzen.');
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFIL}`,
    '--no-first-run', '--no-default-browser-check',
    `--enable-features=${FEATURES}`,
    'about:blank',
  ];
  if (!process.env.ABNAHME_SICHTBAR) args.unshift('--window-position=-2400,0');
  spawn(pfad, args, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40; i += 1) {
    if (await portLebt()) { notiz(`Chrome antwortet nach ${(i + 1) * 250} ms`); return; }
    await warte(250);
  }
  throw new Error(`Chrome gestartet, aber Port ${PORT} antwortete 10 s lang nicht`);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Verbindung zu einer Seite, mit send() fuer Befehle und einer Ereignisliste. */
async function verbinde(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' });
  if (!res.ok) throw new Error(`Seite ${url} liess sich nicht oeffnen: CDP ${res.status} — `
    + 'laeuft "node tools/serve.mjs"?');
  const ziel = await res.json();
  const ws = new WebSocket(ziel.webSocketDebuggerUrl);
  let id = 0;
  const offen = new Map();
  const ereignisse = [];
  ws.onmessage = (m) => {
    const n = JSON.parse(m.data);
    if (n.id && offen.has(n.id)) { offen.get(n.id)(n); offen.delete(n.id); }
    else if (n.method) ereignisse.push(n);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((r) => {
    const i = (id += 1);
    offen.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, ereignisse, schliesse: () => ws.close() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Der Lauf
// ─────────────────────────────────────────────────────────────────────────────

await starteBrowser();
notiz(`oeffne ${URL_SEITE}`);
const s = await verbinde(URL_SEITE);
await s.send('Page.enable');
await s.send('Runtime.enable');

// Die Seite laedt ihr Modell selbst. Gewartet wird auf das Ergebnis, nicht auf
// eine Uhr: erst wenn Werkzeuge gemeldet sind, hat die Seite registriert.
await s.send('WebMCP.enable');

// Gewartet wird, bis die Zahl STEHT, nicht bis sie ueber null ist.
//
// Chrome meldet toolsAdded fortlaufend, waehrend die Seite registriert — ein
// Werkzeug je Ereignis. Wer beim ersten Ereignis zugreift, sieht einen
// Zwischenstand: gemessen wurden 2 von 18, und der halbe Lauf ging rot, ohne
// dass an der Seite etwas fehlte.
let werkzeuge = [];
let ruhig = 0;
for (let i = 0; i < 120; i += 1) {
  const jetzt = s.ereignisse.filter((e) => e.method === 'WebMCP.toolsAdded')
    .flatMap((e) => e.params.tools);
  if (jetzt.length > 0 && jetzt.length === werkzeuge.length) ruhig += 1;
  else ruhig = 0;
  werkzeuge = jetzt;
  if (ruhig >= 6) break;          // 3 s ohne Zuwachs
  await warte(500);
}
if (!werkzeuge.length) {
  console.error('ROT: Chrome meldete 30 s lang 0 Werkzeuge ueber WebMCP.toolsAdded.\n'
    + 'Pruefen: laeuft der Server, ist die Seite ueber http:// erreichbar (nicht file://), '
    + 'startet Chrome mit --enable-features=' + FEATURES + '?');
  process.exit(1);
}
const frameId = werkzeuge[0].frameId;
notiz(`${werkzeuge.length} Werkzeuge gemeldet`);

const nach = (name) => werkzeuge.find((w) => w.name === name);

/** Ruft ein Werkzeug so auf, wie Chrome es fuer einen Agenten tut. */
async function ruf(toolName, input = {}, { warteMs = 20000 } = {}) {
  const vorher = s.ereignisse.length;
  const r = await s.send('WebMCP.invokeTool', { frameId, toolName, input });
  if (r.error) return { protokollfehler: r.error.message, code: r.error.code };
  const id = r.result.invocationId;
  const bis = Date.now() + warteMs;
  while (Date.now() < bis) {
    const ev = s.ereignisse.slice(vorher)
      .find((e) => e.method === 'WebMCP.toolResponded' && e.params.invocationId === id);
    if (ev) return { ...ev.params, invocationId: id };
    await warte(100);
  }
  return { zeitueberschreitung: warteMs, invocationId: id };
}

/** Der Text einer Antwort, egal ob Chrome sie als Objekt oder String durchreicht. */
function text(antwort) {
  const a = antwort?.output;
  if (a == null) return '';
  const o = typeof a === 'string' ? JSON.parse(a) : a;
  return (o.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const gelungen = (a) => a?.status === 'Completed' && !/^Fehler|abgelehnt/i.test(text(a));

// ── 1. Der Katalog, wie der Agent ihn sieht ─────────────────────────────────

console.log('\nKATALOG');
pruefe('jedes Werkzeug hat eine Beschreibung',
  werkzeuge.every((w) => typeof w.description === 'string' && w.description.length > 40),
  `${werkzeuge.filter((w) => (w.description || '').length > 40).length} von ${werkzeuge.length}`);

const ohneSchema = werkzeuge.filter((w) => !w.inputSchema).map((w) => w.name);
pruefe('jedes Werkzeug hat ein inputSchema', ohneSchema.length === 0,
  ohneSchema.length ? `${ohneSchema.length} ohne: ${ohneSchema.join(', ')}` : `${werkzeuge.length} von ${werkzeuge.length}`);

// ── 2. Eine Sitzung, in der Reihenfolge eines Agenten ───────────────────────

console.log('\nSITZUNG');
const welt = await ruf('describe_world');
pruefe('describe_world antwortet', gelungen(welt), text(welt).slice(0, 60).replace(/\s+/g, ' '));

const rig = await ruf('describe_rig');
pruefe('describe_rig antwortet', gelungen(rig));

// Gelenk und Kanal kommen aus der Antwort, nicht aus einer getippten Liste.
// Die Zeilen sehen aus wie: "pelvis      tilt -40..40   roll -30..30"
const rigZeile = text(rig).split('\n').map((z) => z.trim())
  .find((z) => /^[a-z_0-9]+\s+[a-z_]+\s+-?\d/.test(z));
const [gelenk, kanal] = rigZeile ? rigZeile.split(/\s+/) : [];
if (!pruefe('Gelenk und Kanal aus describe_rig lesbar', Boolean(gelenk && kanal),
  rigZeile ? `${gelenk}/${kanal}` : '0 Zeilen im Muster "name kanal min..max"')) {
  console.log(befunde.join('\n'));
  console.error('\nAbbruch: ohne Gelenknamen kann der Lauf keine Haltung setzen.');
  process.exit(1);
}

pruefe('describe_body antwortet', gelungen(await ruf('describe_body')));
pruefe('set_duration setzt 60 Frames', gelungen(await ruf('set_duration', { frameCount: 60 })));
pruefe('set_intent nimmt ein Kriterium',
  gelungen(await ruf('set_intent', { checks: [{ kind: 'part_height', part: 'com', minAnteil: 0.4 }] })));
pruefe('probe_joint probiert ein Gelenk',
  gelungen(await ruf('probe_joint', { joint: gelenk, angleDeg: 20 })));

pruefe('set_pose auf Frame 0',
  gelungen(await ruf('set_pose', { frame: 0, joints: { [gelenk]: { [kanal]: 10 } } })));
pruefe('set_pose auf Frame 30',
  gelungen(await ruf('set_pose', { frame: 30, joints: { [gelenk]: { [kanal]: -10 } } })));
pruefe('set_joint bessert einen Kanal nach',
  gelungen(await ruf('set_joint', { frame: 30, joint: gelenk, channel: kanal, angleDeg: -5 })));

pruefe('describe_pose liest Frame 15', gelungen(await ruf('describe_pose', { frame: 15 })));
pruefe('measure misst die Schwerpunkthoehe',
  gelungen(await ruf('measure', { frame: 15, fragen: [{ art: 'hoehe', a: 'com' }] })));

const posen = await ruf('list_poses');
pruefe('list_poses zeigt die gesetzten Haltungen', gelungen(posen),
  text(posen).split('\n')[0]?.slice(0, 60));

// look liest seine erlaubten Ansichten aus dem Schema, das Chrome gemeldet hat.
// Faellt das Schema aus (siehe src/tools/schema-transport.test.mjs), faellt
// dieser Aufruf mit auf — genau so soll es sein.
const ansichten = nach('look')?.inputSchema?.properties?.views?.items?.enum;
if (pruefe('look meldet seine Ansichten im Schema', Array.isArray(ansichten) && ansichten.length > 0,
  Array.isArray(ansichten) ? ansichten.join('/') : 'kein enum im Schema')) {
  const bild = await ruf('look', { frames: [0, 15, 30], views: [ansichten[0]] }, { warteMs: 60000 });
  const bilder = (() => {
    const a = bild?.output;
    if (a == null) return 0;
    const o = typeof a === 'string' ? JSON.parse(a) : a;
    return (o.content || []).filter((c) => c.type === 'image').length;
  })();
  pruefe('look liefert Bilder zurueck', gelungen(bild) && bilder > 0, `${bilder} Bilder`);
}

pruefe('hold_foot nagelt einen Fuss fest',
  gelungen(await ruf('hold_foot', { foot: 'foot_l', von: 0, bis: 20 })));
pruefe('validate prueft die Bewegung', gelungen(await ruf('validate', {}, { warteMs: 60000 })));
pruefe('move_pose verschiebt Frame 30 auf 40', gelungen(await ruf('move_pose', { von: 30, nach: 40 })));
pruefe('delete_pose loescht Frame 40', gelungen(await ruf('delete_pose', { frame: 40 })));
pruefe('undo nimmt zurueck', gelungen(await ruf('undo')));
pruefe('export_clip schreibt glTF', gelungen(await ruf('export_clip', {}, { warteMs: 60000 })));

// ── 3. Es fragt niemand mehr ──────────────────────────────────────────────

console.log('\nKEINE RUECKFRAGEN');
pruefe('ask_human ist fuer den Agenten nicht sichtbar', !nach('ask_human'),
  nach('ask_human') ? 'steht im Katalog' : `${werkzeuge.length} Werkzeuge, keins davon fragt`);
{
  const r = await s.send('WebMCP.invokeTool', {
    frameId, toolName: 'ask_human', input: { question: 'x', options: ['a', 'b'] },
  });
  pruefe('ein Aufruf von ask_human wird abgelehnt', Boolean(r.error),
    r.error ? r.error.message : 'der Aufruf ging durch');
}

// ── 4. Negativfaelle — was rot werden MUSS ──────────────────────────────────

console.log('\nNEGATIVFAELLE');
const unbekannt = await ruf('gibt_es_nicht');
pruefe('unbekanntes Werkzeug wird von Chrome abgelehnt',
  Boolean(unbekannt.protokollfehler), `${unbekannt.code} ${unbekannt.protokollfehler}`);

const zuKurz = await ruf('set_duration', { frameCount: -5 });
const zuKurzText = text(zuKurz);
pruefe('set_duration lehnt -5 Frames ab', /nicht|ausserhalb|außerhalb/i.test(zuKurzText));
pruefe('die Ablehnung nennt eine Zahl', /\d/.test(zuKurzText),
  zuKurzText.slice(0, 80).replace(/\s+/g, ' '));

const weitDraussen = await ruf('describe_pose', { frame: 99999 });
pruefe('describe_pose lehnt Frame 99999 ab', /\d/.test(text(weitDraussen)),
  text(weitDraussen).slice(0, 80).replace(/\s+/g, ' '));

// ── Bericht ─────────────────────────────────────────────────────────────────

console.log('\nBEFUND');
console.log(befunde.join('\n'));
const gesamt = befunde.length;
console.log(`\n${gesamt - rot} von ${gesamt} Pruefungen gruen, ${rot} rot.`);
console.log(`Weg: Chrome ${(await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).Browser}, `
  + 'DevTools-Domain WebMCP — kein eigener Zugang.');
s.schliesse();
process.exit(rot ? 1 : 0);
