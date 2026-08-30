// Messschicht. Liefert Zahlen, keine Urteile.
// Jede Prüfung ist phasenabhängig: Balance gilt nur bei Bodenkontakt,
// Ballistik nur in der Flugphase.

import * as THREE from 'three';
import { JOINTS, isAdjacent } from './rig.js';

export const THRESHOLDS = {
  contactHeight: 0.030,   // m, darunter gilt ein Punkt als am Boden
  groundTol:     0.015,   // m, erlaubte Durchdringung
  selfTol:       0.005,   // m, erlaubte Kapselüberlappung
  slipTol:       0.020,   // m pro Frame bei bestehendem Kontakt
  balanceTol:    0.050,   // m, erlaubter Überstand des Schwerpunkts
  gravity:       9.81,
  gravityTol:    3.0      // m/s², erlaubte Abweichung in der Flugphase
};

function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

function hull2d(pts) {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((m, n) => m.x - n.x || m.y - n.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Abstand von p zum Polygon. Negativ = innerhalb. */
function distToPolygon(p, poly) {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) return p.distanceTo(poly[0]);
  const segDist2 = (a, b) => {
    const ab = b.clone().sub(a), t = ab.lengthSq() ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  };
  if (poly.length === 2) return segDist2(poly[0], poly[1]);
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    best = Math.min(best, segDist2(a, b));
  }
  return inside ? -best : best;
}

/** Misst einen einzelnen Frame. Der Rig muss bereits in Pose stehen. */
export function measureFrame(rig, poseObj) {
  const caps = rig.capsules();
  const contacts = rig.contactPoints();
  const com = rig.centerOfMass();

  // Boden: exakt über die gehäuteten Vertices, nicht über Kapseln geschätzt.
  let deepest = { seg: null, depth: 0 };
  const groundHits = [];
  const low = rig.lowestVertex();
  if (low && low.y < -THRESHOLDS.groundTol) {
    // nächstgelegene Kapsel benennen, damit der Bericht sagt, welcher Körperteil es ist
    let near = null, nearD = Infinity;
    for (const c of caps) {
      const d = Math.min(low.pos.distanceTo(c.a), low.pos.distanceTo(c.b));
      if (d < nearD) { nearD = d; near = c.id; }
    }
    deepest = { seg: near, depth: +(-low.y).toFixed(4) };
    groundHits.push({ seg: near, depth: deepest.depth, at: [+low.pos.x.toFixed(3), +low.pos.y.toFixed(3), +low.pos.z.toFixed(3)] });
  }

  // Selbstdurchdringung
  const selfHits = [];
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      const A = caps[i], Bc = caps[j];
      if (isAdjacent(A.id, Bc.id)) continue;
      const d = segDist(A.a, A.b, Bc.a, Bc.b);
      const overlap = (A.r + Bc.r) - d;
      // erlaubte Überlappung: aus echter Bewegung gelernt, sonst Grundtoleranz
      const learned = rig.pairTol ? (rig.pairTol[A.id + '|' + Bc.id] ?? rig.pairTol[Bc.id + '|' + A.id]) : undefined;
      const allowed = learned !== undefined ? Math.max(THRESHOLDS.selfTol, -learned) : THRESHOLDS.selfTol;
      if (overlap > allowed) selfHits.push({ a: A.id, b: Bc.id, overlap: +overlap.toFixed(4), allowed: +allowed.toFixed(4) });
    }
  }

  // Bodenkontakt
  const ch = (rig.profile && rig.profile.contactHeight) || THRESHOLDS.contactHeight;
  const grounded = contacts.filter((c) => c.pos.y < ch);
  const airborne = grounded.length === 0;

  // Balance nur bei Kontakt
  let balance = null;
  if (!airborne) {
    const poly = hull2d(grounded.map((c) => new THREE.Vector2(c.pos.x, c.pos.z)));
    const d = distToPolygon(new THREE.Vector2(com.x, com.z), poly);
    balance = { distance: +d.toFixed(4), inside: d < 0, contacts: grounded.map((c) => c.id) };
  }

  // Gelenkgrenzen
  const limitHits = [];
  if (poseObj) {
    for (const j in poseObj) {
      const def = JOINTS[j];
      if (!def) { limitHits.push({ joint: j, problem: 'unbekanntes Gelenk' }); continue; }
      for (const dof in poseObj[j]) {
        const lim = def.limits[dof];
        if (!lim) { limitHits.push({ joint: j, dof, problem: 'unbekannter Freiheitsgrad' }); continue; }
        const v = Number(poseObj[j][dof]);
        if (v < lim[0] || v > lim[1]) limitHits.push({ joint: j, dof, value: v, allowed: lim });
      }
    }
  }

  return {
    com: { x: +com.x.toFixed(4), y: +com.y.toFixed(4), z: +com.z.toFixed(4) },
    airborne,
    contacts: grounded.map((c) => ({ id: c.id, y: +c.pos.y.toFixed(4), x: +c.pos.x.toFixed(4), z: +c.pos.z.toFixed(4) })),
    allContacts: contacts.map((c) => ({ id: c.id, x: +c.pos.x.toFixed(4), y: +c.pos.y.toFixed(4), z: +c.pos.z.toFixed(4) })),
    ground: { worst: deepest.depth, seg: deepest.seg, hits: groundHits },
    self: selfHits,
    balance,
    limits: limitHits
  };
}

/** Fasst eine Folge gemessener Frames zu Verstößen zusammen. */
export function analyze(frames, fps) {
  const dt = 1 / fps;
  const issues = [];
  const add = (kind, frame, msg, value, fix) => issues.push({ kind, frame, msg, value, fix });

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];

    if (f.ground.worst > 0) {
      add('boden', i, `${f.ground.seg} steckt ${(f.ground.worst * 100).toFixed(1)} cm im Boden`,
          f.ground.worst, 'Wurzel anheben oder Bein strecken');
    }
    for (const s of f.self) {
      add('durchdringung', i, `${s.a} und ${s.b} überlappen sich um ${(s.overlap * 100).toFixed(1)} cm (erlaubt: ${((s.allowed||0) * 100).toFixed(1)} cm)`,
          s.overlap, 'Gliedmaßen auseinander bewegen');
    }
    for (const l of f.limits) {
      add('gelenk', i, l.problem
        ? `${l.joint}${l.dof ? '.' + l.dof : ''}: ${l.problem}`
        : `${l.joint}.${l.dof} steht auf ${l.value}°, erlaubt ist ${l.allowed[0]}° bis ${l.allowed[1]}°`,
        l.value, 'Winkel in den erlaubten Bereich bringen');
    }
    if (f.balance && !f.balance.inside && f.balance.distance > THRESHOLDS.balanceTol) {
      add('balance', i, `Schwerpunkt liegt ${(f.balance.distance * 100).toFixed(1)} cm außerhalb der Stützfläche (Kontakt: ${f.balance.contacts.join(', ')})`,
          f.balance.distance, 'Hüfte über die Füße bringen oder Fuß versetzen');
    }

    // Fußrutschen: Kontaktpunkt, der in zwei Frames am Boden ist, darf sich kaum bewegen
    if (i > 0) {
      const prev = frames[i - 1];
      for (const c of f.contacts) {
        const p = prev.contacts.find((x) => x.id === c.id);
        if (!p) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d > THRESHOLDS.slipTol) {
          add('rutschen', i, `${c.id} hat Bodenkontakt, rutscht aber ${(d * 100).toFixed(1)} cm`,
              d, 'Fuß in beiden Frames an dieselbe Stelle setzen');
        }
      }
    }

    // Ballistik: in der Flugphase muss der Schwerpunkt fallen wie ein Stein
    if (i > 0 && i < frames.length - 1) {
      const a = frames[i - 1], b = frames[i + 1];
      if (a.airborne && f.airborne && b.airborne) {
        const acc = (a.com.y - 2 * f.com.y + b.com.y) / (dt * dt);
        const accX = (a.com.x - 2 * f.com.x + b.com.x) / (dt * dt);
        const accZ = (a.com.z - 2 * f.com.z + b.com.z) / (dt * dt);
        if (Math.abs(acc + THRESHOLDS.gravity) > THRESHOLDS.gravityTol) {
          add('flugbahn', i, `In der Luft: senkrechte Beschleunigung ${acc.toFixed(1)} m/s², erwartet ${-THRESHOLDS.gravity} m/s²`,
              acc, acc > -THRESHOLDS.gravity ? 'Schwerpunkt fällt zu langsam – Wurzel stärker absenken' : 'Schwerpunkt fällt zu schnell');
        }
        const horiz = Math.hypot(accX, accZ);
        if (horiz > THRESHOLDS.gravityTol) {
          add('flugbahn', i, `In der Luft: waagerechte Beschleunigung ${horiz.toFixed(1)} m/s², erwartet 0`,
              horiz, 'waagerechte Geschwindigkeit während des Flugs konstant halten');
        }
      }
    }
  }

  const phases = [];
  let cur = null;
  frames.forEach((f, i) => {
    const state = f.airborne ? 'flug' : 'kontakt';
    if (!cur || cur.state !== state) { cur = { state, from: i, to: i }; phases.push(cur); }
    else cur.to = i;
  });

  const byKind = {};
  for (const it of issues) byKind[it.kind] = (byKind[it.kind] || 0) + 1;

  return { issues, byKind, total: issues.length, phases };
}
