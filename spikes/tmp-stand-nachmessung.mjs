// Wegwerf-Nachmessung: warum endet die stand-Fahrt zurück bei comStart?
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
const VORGANG = v.vermesseAusgangslage(SKEL);
const z = v.startZustand(SKEL, VORGANG);

// Bahn-Nachbau wie phaseStand: grenzCom-links über steuereKontakt aufs Sohlenzentrum.
// Das Sohlenzentrum kommt im Solver aus sohlenWelt — hier nachgebaut über die Anker:
const L = VORGANG.anker.filter((a) => a.id.includes('_l_'));
const zentrumL = [0, 1, 2].map((i) => L.reduce((s, a) => s + a.soll[i], 0) / L.length);
const comStart = [...z.com];
const ziel = [zentrumL[0], comStart[1], zentrumL[2]];
const rVersuch = v.steuereKontakt(SKEL, z.pose, VORGANG.gelenke, VORGANG.anker, ziel, {});
console.log('grenzCom links:', rVersuch.com.map((x) => +x.toFixed(4)).join(','));
console.log('comStart       :', comStart.map((x) => +x.toFixed(4)).join(','));

// Fahrt: comSoll-Zwischenlagen
for (const w of [0.2, 0.5, 1.0]) {
  const comSoll = [0, 1, 2].map((i) => comStart[i] + (rVersuch.com[i] - comStart[i]) * w);
  const r = v.steuereKontakt(SKEL, z.pose, VORGANG.gelenke, VORGANG.anker, comSoll, {});
  console.log(
    'welle', w, 'comSoll-x', comSoll[0].toFixed(4),
    '→ com-x', r.com[0].toFixed(4), 'verankertFest', r.verankertFest,
    r.text ? ' (' + r.text + ')' : ''
  );
}

// Grenznutzung in der Endlage: welche Gelenke sind aktiv, welche an der Grenze?
const ik = await import('../src/solver/ik.js');
const comSoll = [rVersuch.com[0], comStart[1], rVersuch.com[2]];
const rEnd = v.steuereKontakt(SKEL, z.pose, VORGANG.gelenke, VORGANG.anker, comSoll, {});
const aktiv = Object.entries(rEnd.pose.dofs).filter(([, val]) => Math.abs(val) > 0.3);
console.log('Endlage — aktive Gelenke:');
for (const [key, val] of aktiv) {
  const d = SKEL.dofs[key];
  console.log(' ', key, val.toFixed(1), 'grenze', JSON.stringify(d.grenze), 'sign', d.vorzeichen);
}