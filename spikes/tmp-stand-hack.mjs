// Welcher Grenz-Difference bewirkt real 0.80 → 0.47? Nur hip_l.spread liegt in der
// Beingelenkkette. Wir setzen frisch pro Lauf und vergleichen.
import { loadGLB } from '../src/scene/load.js';
import { alsArrayBuffer, XBOT_PFAD } from '../src/scene/testdaten.mjs';
import { readFileSync } from 'node:fs';
import * as m from '../src/rig/measure.js';
import * as k from '../src/solver/kinematik.js';
import * as v from '../src/solver/verben.js';

const hack = process.argv[2] ?? '';
const buf = readFileSync(XBOT_PFAD);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await loadGLB(ab);
const PROFIL = m.measureRigProfile(gltf);

// Hack: ALTE gespiegelte Grenzen in den SOLVER-Zweig einschleusen (nur im Speicher).
if (hack.includes('l')) PROFIL.joints.hip_l.dof.spread.limit = [-45, 30];
if (hack.includes('r')) PROFIL.joints.shoulder_r.dof.shrug.limit = [-25, 20];
if (hack.includes('R')) PROFIL.joints.arm_r.dof.lift.limit = [-170, 40];
if (hack.includes('e')) PROFIL.joints.elbow_r.dof.bend.limit = [-150, 2];

const SKEL = k.baueSkeleton(PROFIL, k.erfasseBind(gltf.scene));
const VORGANG = v.vermesseAusgangslage(SKEL);
const z = v.startZustand(SKEL, VORGANG);
const ctx = { skel: SKEL, profile: PROFIL, fps: 30, vorgang: VORGANG, opts: {} };
const frames = [], bericht = { konflikt: [], hinweise: [], lucken: [] };
v.phaseStand(ctx, { id: 'p1', verb: 'stand', from: 0, to: 12, params: { verteilung: 1.0 } }, z, frames, bericht);
const c0 = frames[0].com, cE = frames[frames.length - 1].com;
console.log('hack="' + hack + '" | real(cm)', (Math.hypot(cE[0] - c0[0], cE[2] - c0[2]) * 100).toFixed(2), '| frame0-x', c0[0].toFixed(4), 'Ende-x', cE[0].toFixed(4));