// Wegwerf-Smoke-Lauf für die neuen Verben (kein Test — wird gleich gelöscht).
import { loadGLB } from '../src/scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../src/scene/testdaten.mjs';
import { measureRigProfile } from '../src/rig/measure.js';
import { baueSkeleton, erfasseBind, vLen, vSub } from '../src/solver/kinematik.js';
import * as m from '../src/solver/verben.js';

const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
const profil = measureRigProfile(gltf);
const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
const V = m.vermesseAusgangslage(skel);
const ctx = { skel, profile: profil, fps: 30, vorgang: V, opts: {} };

function loese(fn, params, dauer) {
  const z = m.startZustand(skel, V);
  const frames = [];
  const bericht = { konflikt: [], hinweise: [], lucken: [] };
  fn(ctx, { id: 'p1', verb: params.verb, from: 0, to: dauer, params }, z, frames, bericht);
  return { frames, bericht, z };
}

// step
const s = loese(m.phaseStep, { verb: 'step', weite: 0.3, richtung: 0, fuss: 'l' }, 20);
console.log('step: frames', s.frames.length, 'konflikt', s.bericht.konflikt.map((k) => k.bedingung));
if (s.frames.length) {
  const f0 = s.frames[0], fE = s.frames[s.frames.length - 1];
  console.log('  fuss L weg:', vLen(vSub(fE.positions['mixamorigLeftFoot'], f0.positions['mixamorigLeftFoot'])).toFixed(3));
  console.log('  fuss R weg:', vLen(vSub(fE.positions['mixamorigRightFoot'], f0.positions['mixamorigRightFoot'])).toFixed(3));
  console.log('  com weg xz:', Math.hypot(fE.com[0] - f0.com[0], fE.com[2] - f0.com[2]).toFixed(3));
}

console.log('step MELDUNG:', JSON.stringify(s.bericht.konflikt, null, 2));

// turn
const t = loese(m.phaseTurn, { verb: 'turn', winkel: 90 }, 20);
console.log('turn: frames', t.frames.length, 'konflikt', t.bericht.konflikt.map((k) => [k.bedingung, k.meldung]));
if (t.frames.length) {
  const f0 = t.frames[0], fE = t.frames[t.frames.length - 1];
  console.log('  root quat Ende:', (fE.root?.quat ?? []).map((x) => +x.toFixed(3)).join(','));
  console.log('  fuss L weg:', vLen(vSub(fE.positions['mixamorigLeftFoot'], f0.positions['mixamorigLeftFoot'])).toFixed(4));
}

// settle
const st = loese(m.phaseSettle, { verb: 'settle', ausschlag: 0.5 }, 20);
console.log('settle: frames', st.frames.length, 'konflikt', st.bericht.konflikt.map((k) => k.bedingung));

// reach
const rc = loese(m.phaseReach, { verb: 'reach', ziel: [0.75, 1.20, 0.30], hand: 'r' }, 15);
console.log('reach: frames', rc.frames.length, 'konflikt', rc.bericht.konflikt.map((k) => [k.bedingung, +k.betrag.toFixed(3)]));
if (rc.frames.length) {
  const handR = rc.frames[rc.frames.length - 1].positions['mixamorigRightHand'];
  console.log('  handR endet:', handR.map((x) => +x.toFixed(3)).join(','), 'ziel [0.75,1.2,0.3]');
}