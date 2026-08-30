#!/usr/bin/env node
// Kommandozeile zur 3D-Szene. Jeder Aufruf ist ein Werkzeugaufruf.
//
//   node tool.mjs help
//   node tool.mjs describe_rig
//   node tool.mjs body_profile
//   node tool.mjs set_timeline 45
//   node tool.mjs set_key 0 '{"knee_l":{"bend":20}}' '{"y":-0.10}'
//   node tool.mjs set_key 0 '{"knee_l":{"bend":20}}' '{"y":-0.10}' ease
//   node tool.mjs clear_keys
//   node tool.mjs validate
//   node tool.mjs measure 12
//   node tool.mjs flight 10 25 '{"vy":4.2,"vz":1.5}'
//   node tool.mjs render 0,6,12,18,24 side
//   node tool.mjs state

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'http://localhost:8778/index.html';
const CDP = 'http://127.0.0.1:9222';

const HELP = `
Werkzeuge der 3D-Bewegungsumgebung
==================================

  describe_rig                 Gelenke, Freiheitsgrade, Grenzwerte, Weltkonventionen
  body_profile                 gemessene Koerpermasse: Radien, Massen, Sohlenpunkte
  state                        Timeline-Zustand: Laenge, gesetzte Keyframes
  probe_joints                 Achsenpruefung: wohin bewegt +20 Grad jedes Gelenk?

  set_timeline <frames>        Laenge der Animation festlegen (30 fps)
  set_key <frame> <pose> [root] [easing]
                               Keyframe setzen.
                               pose  = JSON, z.B. {"knee_l":{"bend":90},"hip_l":{"flex":-40}}
                               root  = JSON, z.B. {"y":-0.15,"z":0.4,"tilt":-30}
                               easing= linear | ease | easeIn | easeOut  (Vorgabe: ease)
  clear_keys                   alle Keyframes loeschen
  reload                       Seite neu laden (nur noetig nach Code-Aenderungen)

  validate [limit]             alle Frames pruefen, Verstoesse mit Frame und Zahl
  measure <frame>              Einzelframe im Detail (Schwerpunkt, Kontakte, Abstaende)
  flight <von> <bis> <takeoff> ballistische Wurzelbahn berechnen (nur Rechnung, setzt nichts)
                               takeoff = {"vy":4.2,"vz":1.5}  in m/s

  render <frames> [ansicht]    Bildstreifen als PNG schreiben.
                               frames  = 0,6,12,18   (max 12)
                               ansicht = side | front | quarter | wide

Wichtig
-------
* Alle Winkel in GRAD, gemessen als Abweichung von der T-Pose. 0 = T-Pose.
* root verschiebt die ganze Figur: x/y/z in METERN, tilt/turn/roll in Grad.
* Zwischen Keyframes wird interpoliert. Zwei Keyframes reichen fuer eine Bewegung,
  fuer eine glaubwuerdige braucht es mehr.
* Die Figur ist 1.60 m hoch, steht auf y=0, blickt nach +Z.
`;

async function connect() {
  // Bestehenden Tab wiederverwenden, damit gesetzte Keyframes erhalten bleiben.
  const list = await (await fetch(`${CDP}/json`)).json();
  let t = list.find((x) => x.type === 'page' && x.url.startsWith(PAGE.split('?')[0]));
  if (!t) t = await (await fetch(`${CDP}/json/new?${PAGE}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  const ev = async (expr, tmo = 90000) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
    return r.result?.value;
  };
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 400)); if (await ev('window.__ready===true')) break; }
  return { ev, send, close: () => ws.close(), targetId: t.id };
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); process.exit(0); }

const js = (v) => JSON.stringify(v);

const c = await connect();
try {
  let out;
  switch (cmd) {
    case 'describe_rig':  out = await c.ev('api.describe_rig()'); break;
    case 'body_profile':  out = await c.ev('api.body_profile()'); break;
    case 'reload': {
      await c.send('Page.enable');
      await c.send('Page.reload', { ignoreCache: true });
      let ok = false;
      for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 400)); if (await c.ev('window.__ready===true')) { ok = true; break; } }
      out = ok ? 'Seite neu geladen. Achtung: alle Keyframes sind weg.' : 'Neuladen fehlgeschlagen.';
      break;
    }
    case 'sign_report': out = await c.ev('api.sign_report()'); break;
    case 'probe_joints': out = await c.ev('api.probe_joints()'); break;
    case 'state':         out = await c.ev('JSON.stringify(api.state(), null, 1)'); break;
    case 'set_timeline':  out = await c.ev(`api.set_timeline(${Number(args[0])})`); break;
    case 'clear_keys':    out = await c.ev('api.clear_keys()'); break;
    case 'validate':      out = await c.ev(`api.validate(${Number(args[0]) || 40})`); break;
    case 'measure':       out = await c.ev(`api.measure(${Number(args[0]) || 0})`); break;

    case 'set_key': {
      const frame = Number(args[0]);
      const pose = args[1] ? JSON.parse(args[1]) : {};
      const root = args[2] && args[2] !== '-' ? JSON.parse(args[2]) : {};
      const easing = args[3] || 'ease';
      out = await c.ev(`api.set_key(${frame}, ${js(pose)}, ${js(root)}, ${js(easing)})`);
      break;
    }

    case 'flight': {
      const takeoff = args[2] ? JSON.parse(args[2]) : {};
      const r = await c.ev(`JSON.stringify(api.flight(${Number(args[0])}, ${Number(args[1])}, ${js(takeoff)}), null, 1)`);
      out = r;
      break;
    }

    case 'render': {
      const frames = String(args[0] || '0').split(',').map(Number).filter(n => Number.isFinite(n));
      const view = args[1] || 'side';
      const dataUrl = await c.ev(`api.render_strip(${js(frames)}, ${js(view)})`, 120000);
      const dir = resolve(HERE, 'shots');
      mkdirSync(dir, { recursive: true });
      const name = `strip_${view}_${frames.join('-')}.png`;
      const file = resolve(dir, name);
      writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
      out = `Bild geschrieben: shots/${name}\n(${frames.length} Frames, Ansicht ${view})`;
      break;
    }

    default:
      out = `Unbekanntes Werkzeug: ${cmd}\n${HELP}`;
  }
  console.log(out);
} catch (e) {
  console.log('FEHLER: ' + e.message);
} finally {
  c.close();
  process.exit(0);
}
