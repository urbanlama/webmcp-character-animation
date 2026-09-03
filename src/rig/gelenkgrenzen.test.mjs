// Gelenkgrenzen am Modell gemessen statt katalogisiert.
//
// Belegte Fälle aus docs/journal/buehne-befunde-2026-09-02.md, Befund E: `arm.swing
// -130`, `arm.lift 100` und `knee.bend 150` erzeugen Stellungen, die kein
// Mensch kann, und kein Werkzeug meldet es. Diese Datei prüft, dass das
// Messverfahren die drei Fälle trifft — und dass es die Figur dabei nicht
// unbeweglich macht.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGLB, measureJointLimits, measureJoints, GRENZ_PARAMS } from './measure.js';

const XBOT = 'beispiel/Xbot.glb';

let gltf = null;
let grenzen = null;

before(async () => {
  const buf = readFileSync(XBOT);
  gltf = await loadGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  grenzen = measureJointLimits(gltf);
}, { timeout: 600000 });

// ── Die drei belegten Fälle ─────────────────────────────────────────────────

test('knee.bend: der Unterschenkel verschwindet nicht mehr im Oberschenkel', () => {
  const k = grenzen.limits['knee_l.bend'];
  assert.equal(k.source.max, 'gemessen', 'die obere Grenze muss aus dem Modell kommen');
  assert.ok(k.limit[1] < 150,
    `knee_l.bend endet bei ${k.limit[1]}°, der Katalogwert 150° muss unterschritten werden`);
  assert.ok(k.limit[1] > 100,
    `knee_l.bend endet bei ${k.limit[1]}° — unter 100° wäre die Hocke nicht mehr fahrbar`);
});

test('arm.lift: der Oberarm steckt nicht mehr im Kopf', () => {
  const a = grenzen.limits['arm_l.lift'];
  assert.equal(a.source.max, 'gemessen');
  assert.ok(a.limit[1] < 100,
    `arm_l.lift endet bei ${a.limit[1]}°, der Katalogwert 100° schiebt den Oberarm in den Kopf`);
});

test('arm.swing: ohne Kollision bleibt der Katalogwert stehen, ausdrücklich gekennzeichnet', () => {
  // Der Arm schwingt bei -130° frei nach hinten weg. Was ihn im echten Körper
  // stoppt, sind Bänder und das Schulterblatt — keine Selbstberührung. Ein
  // Kollisionsverfahren kann diese Grenze nicht finden, und genau das muss es
  // sagen, statt die Grenze stillschweigend zu öffnen.
  const s = grenzen.limits['arm_l.swing'];
  assert.equal(s.source.min, 'anatomisch',
    'ohne Schnitt darf die Herkunft nicht „gemessen“ heißen');
  assert.equal(s.limit[0], -130, 'der Katalogwert bleibt unverändert stehen');
});

// ── Sicherung gegen eine unbewegliche Figur ─────────────────────────────────

test('keine gemessene Grenze ist enger als die Entwicklungsclips fahren', () => {
  // Harte Untergrenze ohne eingetippte Zahl: die vier Entwicklungsclips
  // (AGENTS.md Regel 3) sind ausgelieferte Bewegung dieses Modells. Was sie
  // fahren, muss erlaubt bleiben. Klemmt eine gemessene Grenze davor, ist das
  // Verfahren zu streng und die Figur verliert Bewegung, die sie kann.
  const gefahren = clipSpannen(gltf);
  const zuEng = [];
  for (const [kanal, g] of Object.entries(grenzen.limits)) {
    const c = gefahren.get(kanal);
    if (!c) continue;
    if (g.source.min === 'gemessen' && g.limit[0] > c.min + 0.5) {
      zuEng.push(`${kanal} unten: Grenze ${g.limit[0].toFixed(1)}° > Clip ${c.min.toFixed(1)}°`);
    }
    if (g.source.max === 'gemessen' && g.limit[1] < c.max - 0.5) {
      zuEng.push(`${kanal} oben: Grenze ${g.limit[1].toFixed(1)}° < Clip ${c.max.toFixed(1)}°`);
    }
  }
  assert.deepEqual(zuEng, [], `${zuEng.length} Kanäle klemmen ausgelieferte Bewegung ab`);
});

test('Negativfall: ohne den Ausschluss der Gelenkregion wird die Figur unbeweglich', () => {
  // Beim Beugen schiebt sich die Haut in der Beuge zusammen und schneidet
  // sich selbst — Skinning, keine Kollision. Ohne Ausschluss liefert das
  // Verfahren am Xbot knee.bend 40° statt 130°. Dieser Test muss rot werden,
  // wenn der Ausschluss je verschwindet.
  const ohne = measureJointLimits(gltf, { ausschlussRadius: 0, joints: ['knee_l'] });
  assert.ok(ohne.limits['knee_l.bend'].limit[1] < 60,
    `ohne Ausschluss müsste knee_l.bend weit unter 60° klemmen, gemessen ${ohne.limits['knee_l.bend'].limit[1]}°`);
});

// ── Herkunft je Kanal, nicht je Gelenk ──────────────────────────────────────

test('die Herkunft steht pro Kanal und pro Richtung', () => {
  const s = grenzen.limits['arm_l.swing'];
  assert.equal(typeof s.source.min, 'string');
  assert.equal(typeof s.source.max, 'string');
  // Am Xbot ist genau dieser Kanal gemischt: unten kein Schnitt (anatomisch),
  // oben schneidet der Arm den Rumpf (gemessen). Wäre die Herkunft pro Gelenk
  // vermerkt, ginge diese Unterscheidung verloren.
  const gemischt = Object.values(grenzen.limits).some((g) => g.source.min !== g.source.max);
  assert.ok(gemischt, 'mindestens ein Kanal muss unten und oben verschiedene Herkunft haben');
});

test('measureJoints übernimmt gemessene Grenzen samt Herkunft', () => {
  const j = measureJoints(gltf, { limits: grenzen });
  const knie = j.joints.knee_l.dof.bend;
  assert.deepEqual(knie.limit, grenzen.limits['knee_l.bend'].limit);
  assert.equal(knie.limitSource.max, 'gemessen');
  assert.equal(j.joints.knee_l.limitSource, undefined,
    'die pauschale Herkunft je Gelenk ist ersetzt, nicht ergänzt');
});

test('ohne gemessene Grenzen bleibt der Katalog stehen und heißt anatomisch', () => {
  const j = measureJoints(gltf);
  const knie = j.joints.knee_l.dof.bend;
  assert.deepEqual(knie.limit, [0, 150]);
  assert.equal(knie.limitSource.min, 'anatomisch');
  assert.equal(knie.limitSource.max, 'anatomisch');
});

// ── Verfahrensparameter sichtbar ────────────────────────────────────────────

test('die Verfahrensparameter stehen im Ergebnis', () => {
  // AGENTS.md Regel 1: Verfahrensparameter sind unvermeidbar, aber sie stehen
  // an einer Stelle, mit Begründung, und werden ausgegeben.
  assert.ok(grenzen.params.schrittGrad > 0);
  assert.ok(grenzen.params.feinGrad > 0);
  assert.ok(grenzen.params.zellgroesseM > 0);
  assert.equal(grenzen.params.ausschluss, 'radiensumme');
  assert.equal(grenzen.params.schrittGrad, GRENZ_PARAMS.schrittGrad);
});

test('das Ergebnis nennt, welches Segmentpaar die Grenze gesetzt hat', () => {
  const k = grenzen.limits['knee_l.bend'];
  assert.match(k.treffer.max, /shin_l\|thigh_l|thigh_l\|shin_l/,
    `knee_l.bend muss von Unterschenkel und Oberschenkel begrenzt werden, gemeldet: ${k.treffer.max}`);
  assert.equal(grenzen.limits['arm_l.swing'].treffer.min, null,
    'ohne Schnitt gibt es kein begrenzendes Paar');
});

// ── Hilfsmittel ─────────────────────────────────────────────────────────────

/**
 * Winkelspanne je Kanal über die vier Entwicklungsclips (AGENTS.md Regel 3:
 * run, headShake und sneak_pose bleiben der Abnahme vorbehalten).
 */
function clipSpannen(g) {
  const ERLAUBT = new Set(['idle', 'walk', 'agree', 'sad_pose']);
  const joints = measureJoints(g).joints;
  let skeleton = null;
  g.scene.traverse((o) => { if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton; });
  const bind = new Map(skeleton.bones.map((b) => [b.name, b.quaternion.clone()]));
  const out = new Map();
  for (const clip of g.animations) {
    if (!ERLAUBT.has(clip.name)) continue;
    const tracks = new Map();
    for (const t of clip.tracks) {
      if (t.name.endsWith('.quaternion')) tracks.set(t.name.slice(0, -11), t);
    }
    for (const [jn, j] of Object.entries(joints)) {
      const track = tracks.get(j.bone);
      if (!track) continue;
      const qb = bind.get(j.bone);
      for (const [dn, d] of Object.entries(j.dof)) {
        const key = `${jn}.${dn}`;
        let e = out.get(key);
        if (!e) { e = { min: 0, max: 0 }; out.set(key, e); }
        const achse = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2;
        for (let i = 0; i < track.values.length / 4; i++) {
          const q = [track.values[i * 4], track.values[i * 4 + 1], track.values[i * 4 + 2], track.values[i * 4 + 3]];
          // Delta zur Bind-Pose, um die Katalogachse zerlegt.
          const inv = [-qb.x, -qb.y, -qb.z, qb.w];
          const d0 = [
            inv[3] * q[0] + inv[0] * q[3] + inv[1] * q[2] - inv[2] * q[1],
            inv[3] * q[1] - inv[0] * q[2] + inv[1] * q[3] + inv[2] * q[0],
            inv[3] * q[2] + inv[0] * q[1] - inv[1] * q[0] + inv[2] * q[3],
            inv[3] * q[3] - inv[0] * q[0] - inv[1] * q[1] - inv[2] * q[2],
          ];
          let grad = 2 * Math.atan2(d0[achse], d0[3]) * 180 / Math.PI;
          if (grad > 180) grad -= 360;
          if (grad < -180) grad += 360;
          const w = grad / d.sign;
          if (!Number.isFinite(w)) continue;
          if (w < e.min) e.min = w;
          if (w > e.max) e.max = w;
        }
      }
    }
  }
  return out;
}
