// Körperprofil aus dem Modell messen statt raten.
// Radien, Massen, Sohlenpunkte und erlaubte Kontaktabstände kommen alle
// aus dem Mesh bzw. aus Referenzbewegung — keine getippten Werte.

import * as THREE from 'three';
import { SEGMENTS, JOINTS, END_OF, dofMeaning } from './rig.js';

const M = 'mixamorig';

// Welcher Knochen zählt zu welchem Segment (Präfix-Zuordnung, längste Übereinstimmung gewinnt).
const BONE_TO_SEGMENT = [
  [M + 'HeadTop_End', 'head'], [M + 'Head', 'head'], [M + 'Neck', 'head'],
  [M + 'LeftEye', 'head'], [M + 'RightEye', 'head'],
  [M + 'Hips', 'torso'], [M + 'Spine', 'torso'], [M + 'Spine1', 'torso'], [M + 'Spine2', 'torso'],
  [M + 'LeftShoulder', 'torso'], [M + 'RightShoulder', 'torso'],
  [M + 'LeftArm', 'upperarm_l'], [M + 'LeftForeArm', 'forearm_l'], [M + 'LeftHand', 'hand_l'],
  [M + 'RightArm', 'upperarm_r'], [M + 'RightForeArm', 'forearm_r'], [M + 'RightHand', 'hand_r'],
  [M + 'LeftUpLeg', 'thigh_l'], [M + 'LeftLeg', 'shin_l'], [M + 'LeftFoot', 'foot_l'], [M + 'LeftToe', 'foot_l'],
  [M + 'RightUpLeg', 'thigh_r'], [M + 'RightLeg', 'shin_r'], [M + 'RightFoot', 'foot_r'], [M + 'RightToe', 'foot_r']
];

function segmentOf(boneName) {
  let best = null, bestLen = -1;
  for (const [prefix, seg] of BONE_TO_SEGMENT) {
    if (boneName.startsWith(prefix) && prefix.length > bestLen) { best = seg; bestLen = prefix.length; }
  }
  return best;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** Abstand Punkt zu Strecke. */
function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * Misst das Körperprofil in der Bind-Pose.
 * Gibt Radien, Massenanteile, Sohlenpunkte und Maße zurück.
 */
export function buildBodyProfile(rig, opts = {}) {
  const mesh = rig.skinned;
  const stride = opts.stride || 1;
  const pos = mesh.geometry.attributes.position;
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  const boneNames = mesh.skeleton.bones.map((b) => b.name);

  rig.reset();
  mesh.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  const segVerts = new Map();     // segId -> [Vector3 in Weltkoordinaten]
  const segWeight = new Map();    // segId -> aufsummiertes Skin-Gewicht
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = Infinity;
  const all = [];

  for (let i = 0; i < pos.count; i += stride) {
    mesh.getVertexPosition(i, v);
    mesh.localToWorld(v);
    all.push(v.clone());
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;

    // dominanter Knochen
    let bestW = -1, bestB = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      const bi = skinIndex.getComponent(i, k);
      if (w > bestW) { bestW = w; bestB = bi; }
      const segAll = segmentOf(boneNames[bi] || '');
      if (segAll && w > 0) segWeight.set(segAll, (segWeight.get(segAll) || 0) + w);
    }
    const seg = segmentOf(boneNames[bestB] || '');
    if (seg) {
      if (!segVerts.has(seg)) segVerts.set(seg, []);
      segVerts.get(seg).push(v.clone());
    }
  }

  // Radien: Abstand der zugehörigen Vertices zur Segmentachse.
  // Masse: aus dem Kapselvolumen bei konstanter Dichte — NICHT aus der
  // Vertexzahl. Feine Modellierung (Finger) bedeutet nicht viel Masse.
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const radii = {}, masses = {}, radiusDetail = {}, volumes = {};
  const rq = opts.radiusPercentile ?? 0.90;

  for (const s of SEGMENTS) {
    const ba = rig.bones.get(s.from), bb = rig.bones.get(s.to);
    const verts = segVerts.get(s.id) || [];
    if (!ba || !bb || verts.length === 0) { radii[s.id] = s.r; volumes[s.id] = 0; continue; }
    ba.getWorldPosition(a); bb.getWorldPosition(b);
    const d = verts.map((p) => pointSegDist(p, a, b)).sort((m, n) => m - n);
    const r = +percentile(d, rq).toFixed(4);
    radii[s.id] = r;
    radiusDetail[s.id] = { n: verts.length, len: +a.distanceTo(b).toFixed(4), p50: +percentile(d, 0.5).toFixed(4), p90: r, p95: +percentile(d, 0.95).toFixed(4), max: +d[d.length - 1].toFixed(4) };
    // Kapselvolumen: Zylinder + zwei Halbkugeln
    const L = a.distanceTo(b);
    volumes[s.id] = Math.PI * r * r * L + (4 / 3) * Math.PI * r * r * r;
  }
  const volSum = Object.values(volumes).reduce((x, y) => x + y, 0) || 1;
  for (const s of SEGMENTS) masses[s.id] = +(volumes[s.id] / volSum).toFixed(4);

  // Sohlenpunkte: rein geometrisch. Alles, was in Bind-Pose nahe am Boden
  // liegt, gehoert zur Sohle - unabhaengig davon, an welchen Knochen es
  // gewichtet ist. (Die Ferse haengt bei vielen Rigs am Unterschenkel.)
  const soleTol = (maxY - minY) * 0.035;
  const soles = [];
  const footBones = {
    l: rig.bones.get(M + 'LeftFoot'),
    r: rig.bones.get(M + 'RightFoot')
  };
  if (footBones.l && footBones.r) {
    const fl = footBones.l.getWorldPosition(new THREE.Vector3());
    const fr = footBones.r.getWorldPosition(new THREE.Vector3());
    const near = all.filter((p) => p.y < minY + soleTol);
    const groups = { l: [], r: [] };
    for (const p of near) groups[p.distanceTo(fl) <= p.distanceTo(fr) ? 'l' : 'r'].push(p);
    for (const side of ['l', 'r']) {
      const verts = groups[side];
      const bone = footBones[side];
      if (verts.length < 4) continue;
      const zs = verts.map((p) => p.z), xs = verts.map((p) => p.x);
      const zMin = Math.min(...zs), zMax = Math.max(...zs), xMin = Math.min(...xs), xMax = Math.max(...xs);
      const corners = [
        { id: `sole_${side}_back_in`,   tx: xMin, tz: zMin },
        { id: `sole_${side}_back_out`,  tx: xMax, tz: zMin },
        { id: `sole_${side}_front_in`,  tx: xMin, tz: zMax },
        { id: `sole_${side}_front_out`, tx: xMax, tz: zMax }
      ];
      for (const c of corners) {
        let best = verts[0], bestV = Infinity;
        for (const p of verts) {
          const d = (p.z - c.tz) ** 2 + (p.x - c.tx) ** 2;
          if (d < bestV) { bestV = d; best = p; }
        }
        const local = bone.worldToLocal(best.clone());
        soles.push({ id: c.id, bone: bone.name, local: [+local.x.toFixed(5), +local.y.toFixed(5), +local.z.toFixed(5)],
                     bind: [+best.x.toFixed(4), +best.y.toFixed(4), +best.z.toFixed(4)] });
      }
    }
  }

  // Boden-Sonden: gleichmäßig verteilte Vertices für die Durchdringungsprüfung
  const probeStride = Math.max(1, Math.round(all.length / 900));
  const probes = [];
  for (let i = 0; i < pos.count; i += stride * probeStride) probes.push(i);

  // Kontaktschwelle: so hoch wie der hoechste Sohlenpunkt in Bind-Pose.
  // Modelle, die auf den Fussballen stehen, haben eine hoehere Ferse.
  const soleTop = soles.length ? Math.max(...soles.map((s) => s.bind[1] - minY)) : 0.03;

  return {
    contactHeight: +(soleTop + 0.015).toFixed(4),
    height: +(maxY - minY).toFixed(4),
    groundY: +minY.toFixed(5),
    vertexCount: pos.count,
    sampled: all.length,
    radii, radiusDetail, masses, volumes, soles, probes,
    massSum: +Object.values(masses).reduce((s, x) => s + x, 0).toFixed(4)
  };
}

/**
 * Lernt aus Referenzbewegung, wie nah sich Segmentpaare tatsächlich kommen.
 * Ergebnis: erlaubter Mindestabstand pro Paar. Verhindert Fehlalarme dort,
 * wo sich Körperteile in echter Bewegung normal berühren.
 */
export function calibratePairs(samples) {
  // samples: Array von Arrays { id, a:Vector3, b:Vector3, r }
  const minDist = new Map();
  for (const caps of samples) {
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const A = caps[i], B = caps[j];
        const key = A.id + '|' + B.id;
        const d = segDist(A.a, A.b, B.a, B.b) - (A.r + B.r);
        const cur = minDist.get(key);
        if (cur === undefined || d < cur) minDist.set(key, d);
      }
    }
  }
  const out = {};
  for (const [k, v] of minDist) out[k] = +Math.min(0, v - 0.005).toFixed(4);
  return out;
}

function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t; const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const bb = d1.dot(d2), denom = a * e - bb * bb;
      s = denom !== 0 ? THREE.MathUtils.clamp((bb * f - c * e) / denom, 0, 1) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((bb - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}


/**
 * Misst fuer jeden Freiheitsgrad, in welche Richtung ein positiver Wert wirkt,
 * und dreht das Vorzeichen um, wo Name und Wirkung nicht zusammenpassen.
 * Damit stimmt "flex nach vorne" auf jedem Rig, egal wie es gebaut wurde.
 */
export function calibrateSigns(rig, probeDeg = 20) {
  const signs = {};
  const report = [];
  rig.signs = {};
  for (const jname in JOINTS) {
    const endName = END_OF[jname];
    if (!endName) continue;
    signs[jname] = {};
    for (const dof in JOINTS[jname].dof) {
      const meaning = dofMeaning(jname, dof);
      if (!meaning) { signs[jname][dof] = 1; continue; }
      rig.signs = signs;
      signs[jname][dof] = 1;

      rig.apply({}, {});
      const before = rig.worldPos(endName).clone();
      rig.apply({ [jname]: { [dof]: probeDeg } }, {});
      const after = rig.worldPos(endName).clone();
      const d = after.sub(before);

      // Bei gespiegelten Freiheitsgraden dreht die rechte Seite die Erwartung um.
      const isRight = /_r$/.test(jname);
      const want = meaning.want * (meaning.mirror && isRight ? -1 : 1);
      const measured = d[meaning.axis];

      if (Math.abs(measured) < 1e-4) {
        signs[jname][dof] = 1;
        report.push(`  ${(jname + '.' + dof).padEnd(18)} nicht messbar (Drehung um die eigene Achse)`);
      } else {
        const sign = Math.sign(measured) === Math.sign(want) ? 1 : -1;
        signs[jname][dof] = sign;
        report.push(`  ${(jname + '.' + dof).padEnd(18)} ${sign > 0 ? 'passt      ' : 'umgedreht  '} (gemessen ${measured.toFixed(3)} auf Achse ${meaning.axis}, erwartet ${want > 0 ? '+' : '-'})`);
      }
    }
  }
  rig.signs = signs;
  rig.apply({}, {});
  return { signs, report };
}
