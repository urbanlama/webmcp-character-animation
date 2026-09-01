// Manueller Etappenlauf mit Ankerabweichung je Sohlpunkt (temporär).
import { loadGLB } from '../src/scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../src/scene/testdaten.mjs';
import { measureRigProfile } from '../src/rig/measure.js';
import { baueSkeleton, erfasseBind } from '../src/solver/kinematik.js';
import { poseZuFk, ankerPunkt } from '../src/solver/ik.js';
import * as m from '../src/solver/verben.js';

const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
const profil = measureRigProfile(gltf);
const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
const V = m.vermesseAusgangslage(skel);
const z = m.startZustand(skel, V);

const N = 40, nA = Math.round(N / 3), nB = N - nA;
const zielVersatz = [0, 0, 0.18];
const bindFussAnker = V.anker.filter((a) => a.knochen === skel.rollenKnochen.foot_l);
const stuetzAnker = V.anker.filter((a) => a.knochen !== skel.rollenKnochen.foot_l);
const fussAnkerAbsolut = (fort) => bindFussAnker.map((a) => ({
  id: a.id, knochen: a.knochen, lokal: [...a.lokal],
  soll: [a.soll[0] + zielVersatz[0] * fort, a.soll[1] + zielVersatz[1] * fort, a.soll[2] + zielVersatz[2] * fort],
}));
const comStart = [...z.com];
const mitZ = zielVersatz[2] / 3;
const ease0 = (t) => t * t * (3 - 2 * t);
let gebrochen = null;

for (let i = 0; i < N; i++) {
  let anker, comSoll;
  if (i < nA) {
    const t = (i + 1) / nA;
    anker = V.anker;
    comSoll = [comStart[0], comStart[1], comStart[2] + mitZ * 0.5 * ease0(t)];
  } else if (i < N - 1) {
    const anteil = Math.min(1, (i - nA + 2) / nB);
    anker = [...stuetzAnker, ...fussAnkerAbsolut(anteil)];
    comSoll = [comStart[0], comStart[1], comStart[2] + mitZ * (0.5 + 0.5 * anteil * anteil)];
  } else {
    anker = [...stuetzAnker, ...fussAnkerAbsolut(1)];
    comSoll = [comStart[0], comStart[1], comStart[2] + mitZ];
  }
  const r = m.steuereKontakt(skel, z.pose, V.gelenke, anker, comSoll, {});
  z.pose = r.pose;
  const kn = poseZuFk(skel, z.pose);
  const abw = anker.map((a) => {
    const p = ankerPunkt(skel, kn, a);
    return [a.id, Math.hypot(p[0] - a.soll[0], p[1] - a.soll[1], p[2] - a.soll[2])];
  });
  const maxAbw = abw.reduce((x, y) => (y[1] > x[1] ? y : x));
  const stuetzMax = abw.filter(([id]) => stuetzAnker.some((s) => s.id === id)).reduce((x, y) => (y[1] > x[1] ? y : x));
  const anteilText = i < nA ? 'A' : Math.min(1, (i - nA + 2) / nB).toFixed(2);
  if (i === nA || (i >= 22 && i <= 27) || i === N - 1) {
    console.log('i', i, 'anteil', anteilText, 'maxAbw', maxAbw[0], (maxAbw[1] * 100).toFixed(2) + 'cm', '| stützMax', (stuetzMax[1] * 100).toFixed(2) + 'cm', r.verankertFest ? '' : 'BRUCH ' + r.text);
  }
  if (!r.verankertFest) gebrochen = i;
}
console.log('letzter Bruch-Frame:', gebrochen);