// phaseStand mit ALT-Grenzen (hip_l.spread [-45,30]) gegen NEU ([-30,45]) —
// wer setzt den spread auf welche Werte, und wo bleibt com stehen?
import { loadGLB } from '../src/scene/load.js';
import { alsArrayBuffer, XBOT_PFAD } from '../src/scene/testdaten.mjs';
import { readFileSync } from 'node:fs';
import * as m from '../src/rig/measure.js';
import * as k from '../src/solver/kinematik.js';
import * as v from '../src/solver/verben.js';

const buf = readFileSync(XBOT_PFAD);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await loadGLB(ab);
const PROFIL = m.measureRigProfile(gltf);
const SKEL = k.baueSkeleton(PROFIL, k.erfasseBind(gltf.scene));

for (const variante of ['NEU [-30,45]', 'ALT [-45,30]']) {
  if (variante.startsWith('ALT')) SKEL.dofs['hip_l.spread'].grenze = [-45, 30];
  else SKEL.dofs['hip_l.spread'].grenze = [-30, 45];
  const VORGANG = v.vermesseAusgangslage(SKEL);
  const z = v.startZustand(SKEL, VORGANG);
  const ctx = { skel: SKEL, profile: PROFIL, fps: 30, vorgang: VORGANG, opts: {} };
  const frames = [], bericht = { konflikt: [], hinweise: [], lucken: [] };
  v.phaseStand(ctx, { id: 'p1', verb: 'stand', from: 0, to: 12, params: { verteilung: 1.0 } }, z, frames, bericht);
  const c0 = frames[0].com, cE = frames[frames.length - 1].com;
  const real = Math.hypot(cE[0] - c0[0], cE[2] - c0[2]);
  const konf = bericht.konflikt.find((x) => x.bedingung === 'gewichtsverlagerung');
  console.log(variante,
    '| real(cm)', (real * 100).toFixed(2),
    '| erreicht(cm)', konf ? (konf.erreicht * 100).toFixed(2) : '—',
    '| frame0-x', c0[0].toFixed(4), 'Ende-x', cE[0].toFixed(4));
}