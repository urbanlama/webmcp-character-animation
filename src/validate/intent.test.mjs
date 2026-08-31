// AP6 — Tests für die Absichtsprüfung (src/validate/intent.js).
//
// Alles Prüfmaterial wird hier KONSTRUIERT, keine Modelle. Das Rig ist ein
// festes Prüf-Rig (wie bei AP4): Körperhöhe 1,8 m, Boden bei y = 0. Seine
// Maße sind Definition, nicht Schätzung.
//
// Zu jedem Positivfall gehört der Negativfall aus der Abnahmetabelle
// (docs/umsetzung.md, AP6): je Baustein ein erfüllter und ein verletzter Fall.
// Der Abnahmetest "Absicht" braucht einen Salto — den gibt es noch nicht
// (der Löser entsteht parallel), also wird er als von Hand konstruierte
// Timeline geprüft, die einen Salto beschreibt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeAbsicht } from './intent.js';
import { pruefePhysik } from './physics.js';

const FPS = 30;

// ── Festes Prüf-Rig: Körperhöhe 1,8 m, Boden bei y = 0 ──────────────────────

const RIG = {
  schemaVersion: 1,
  world: { height: 1.8, groundY: 0, up: 'y' },
  roles: {
    pelvis: { bone: 'pelvis' },
    foot_l: { bone: 'foot_l' },
    foot_r: { bone: 'foot_r' },
  },
  segments: [],
  soles: [],
  params: {},
};

// Knochen-ids des Prüfrigs:
//   pelvis, foot_l, foot_r, hand_r, hand_l, head_top
// Ein Salto-Konstrukt, Frame für Frame von Hand gelegt.

const H1 = 1.8;   // Körperhöhe, Referenz aller Anteile

/** Ein Frame-Aufbauhelfer: bones + contact + optional com. */
const frame = (bones, contact = 'kontakt', extra = {}) =>
  ({ bones, contact, ...extra });

// ── Konstrukt: Rückwärtssalto aus dem Stand (60 Frames, 2 s) ────────────────
// Phasen (Frames):
//   0–9    hocken: Becken sinkt um 0,25 Körperhöhe, Hand_r senkt sich
//   10–14  Strecken: Becken steigt, Fußkontakt löst sich bei Frame 15
//   15–44  Flug: Parabel, Becken dreht eine volle Umdrehung um x,
//          Scheitelhöhe com.y 1,35 Körperhöhen, Füße über dem Boden
//   45–55  Landung: Fußkontakt wieder ab Frame 45, Abfedern
//   56–59  aufrichten

function saltoTimeline() {
  const n = 60;
  const frames = [];
  for (let i = 0; i < n; i++) {
    let pelvisY, footY, handY, contact, comY;
    if (i <= 9) {
      const t = i / 9;
      pelvisY = 0.95 - 0.30 * t * 0.35;      // leichtes Einsinken
      footY = 0;
      handY = 1.0 - 0.3 * 1.8 * t;           // Hand senkt sich als Antizipation
      contact = 'kontakt';
      comY = pelvisY + 0.03;
    } else if (i <= 14) {
      pelvisY = 0.95 - 0.30 + 0.35 * 1.8 * ((i - 9) / 5);
      footY = 0;
      handY = 1.0 - 0.3 * 1.8 + 0.3 * 1.8 * ((i - 9) / 5);
      contact = 'kontakt';
      comY = pelvisY + 0.03;
    } else if (i <= 44) {
      const t = (i - 14) / 30;               // 0..1 über die Flugdauer
      const sek = t * 1.0;                   // Flugdauer 1,0 s
      const vy = 2.2, g = 9.81;
      const h = vy * sek - 0.5 * g * sek * sek;   // Parabel, Scheitel bei 0,25 m
      pelvisY = 1.05 + Math.max(0, h);
      footY = Math.max(0, 0.55 + h * 1.6);   // Füße steigen bis über 0,2 Körperhöhen
      handY = pelvisY - 0.5;
      contact = 'flug';
      comY = pelvisY + 0.03;
    } else {
      pelvisY = 0.95;
      footY = 0;
      handY = 1.0;
      contact = 'kontakt';
      comY = pelvisY + 0.03;
    }
    // Rückwärtssalto: im Flug dreht die Figur rückwärts um die x-Achse. Die
    // Kopf-Kette (neck, head_top) rotiert um das Becken — gemessen wird die
    // Drehung an dieser Kette. Der Schwerpunkt wandert nach hinten, die
    // Landung liegt hinter dem Absprung.
    const drehwinkel = i <= 14 ? 0 : i <= 44 ? -2 * Math.PI * (i - 15) / 30 : 0;
    const pelvisZ = i <= 14 ? 0 : i <= 44 ? -1.8 * Math.sin(Math.PI * (i - 14) / 30) * 0.36
      : -0.5 + 0.5 * ((i - 44) / 15);
    const neckDy = 0.50 * Math.cos(drehwinkel);
    const neckDz = 0.50 * Math.sin(drehwinkel);
    const headDy = 0.67 * Math.cos(drehwinkel);
    const headDz = 0.67 * Math.sin(drehwinkel);
    const handRichtung = i <= 14 ? 1 : i <= 44 ? -1 : 1;   // Arme umklappen
    const handAbstand = 0.55;   // Hände auf ±0,55 Körperhöhen auseinander
    frames.push(frame({
      pelvis: [0, pelvisY, pelvisZ],
      foot_l: [-0.12, footY, 0.05],
      foot_r: [0.12, footY, 0.05],
      hand_r: [handAbstand * H1 / 1.8, handY, pelvisZ + 0.1 * handRichtung],
      hand_l: [-handAbstand * H1 / 1.8, handY, pelvisZ + 0.1 * handRichtung],
      neck: [0, pelvisY + neckDy, pelvisZ + neckDz],
      head_top: [0, pelvisY + headDy, pelvisZ + headDz],
    }, contact, { com: [0, comY, pelvisZ] }));
  }
  return { fps: FPS, frameCount: n, solved: { frames } };
}

// Bewegungslose Timeline: alles still. Sie MUSS die Physikprüfung bestehen
// (das ist der belegte Befund: jede Physikprüfung an einer toten Timeline
// ist grün) und MUSS an der Absichtsprüfung scheitern.
const TOTE_TIMELINE = () => {
  const n = 60;
  const frames = Array.from({ length: n }, () => frame({
    pelvis: [0, 0.95, 0],
    foot_l: [-0.12, 0, 0.05],
    foot_r: [0.12, 0, 0.05],
    hand_r: [0.30, 1.00, 0],
    hand_l: [-0.30, 1.00, 0],
    neck: [0, 1.45, 0],
    head_top: [0, 1.62, 0],
  }, 'kontakt', { com: [0, 0.98, 0.05] }));
  return { fps: FPS, frameCount: n, solved: { frames } };
};

// ── Abnahmetest "Absicht": Salto erfüllt, tote Timeline scheitert ───────────

test('Absicht: der konstruierte Salto erfüllt alle sieben Bausteine', () => {
  const t = saltoTimeline();
  const intent = [
    // 1. Drehung: Kopf-Kette dreht 360 Grad um die x-Achse im Flug
    { kind: 'drehung', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 300 },
    // 2. Flugphase: mindestens 0,5 s, Scheitel unter 1,4 Körperhöhen
    { kind: 'flugphase', minSek: 0.5, maxSek: 1.2, minScheitel: 0.7, maxScheitel: 1.4 },
    // 3. Ortsveränderung: Becken bewegt sich rückwärts
    { kind: 'ortsveraenderung', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] },
    // 4. Kontaktwechsel: der rechte Fuß hebt bei Frame 15
    { kind: 'kontaktwechsel', foot: 'foot_r', von: 14, bis: 15 },
    // 5. Abstand: beide Hände weit auseinander, für mindestens 1 s
    { kind: 'abstand', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 1.0 },
    // 6. Höhe: die Füße übersteigen 0,2 Körperhöhen
    { kind: 'hoehe', part: 'foot_r', minAnteil: 0.2 },
    // 7. Tempo: das Becken bewegt sich mit mindestens 0,8 Körperhöhen/s
    { kind: 'tempo', part: 'pelvis', minHoeheProSek: 0.8 },
  ];
  const r = pruefeAbsicht(RIG, t, intent);
  assert.equal(r.checks.length, 7);
  for (const c of r.checks) {
    assert.equal(c.passed, true, `Baustein ${c.name}: ${JSON.stringify(c)}`);
  }
  assert.equal(r.passed, true);
});

test('Absicht: eine bewegungslose Timeline besteht die PHYSIKPRÜFUNG', () => {
  // Belegt die Ausgangslage: die Physikprüfung allein fängt tote Timelines nicht.
  const t = TOTE_TIMELINE();
  const profilePhysik = {
    ...RIG,
    segments: [
      { id: 'arm_l', from: 'shoulder_l', to: 'hand_l' },
      { id: 'kopf', from: 'neck', to: 'head_top' },
    ],
    // Ruheabstand des KONSTRUKTS (nicht geschätzt): das Armsegment läuft von
    // shoulder_l (x = 0,30) schräg nach hand_l (x = −0,30) und kommt dem
    // Kopf (bei x = 0) bis auf den hier ausgerechneten Abstand von 0,18 m —
    // gemessen mit dem Segmentabstand-Verfahren der Physikprüfung.
    restDistances: { 'arm_l|kopf': 0.18 },
  };
  // Die Physikprüfung liest frame.positions (ihr eigener Vertrag, plan.md 5.3),
  // die Absichts- und Stilprüfung lesen frame.bones.
  const framesPhysik = t.solved.frames.map((f) => ({
    ...f,
    positions: {
      ...f.bones,
      // Segment-Endpunkt arm_l: Schulter über der rechten Hand am Kopf-Höhenbereich.
      shoulder_l: [0.30, 1.45, 0],
    },
  }));
  const r = pruefePhysik(profilePhysik, framesPhysik, FPS);
  assert.equal(r.passed, true, `erwarte grüne Physikprüfung auf der toten Timeline: ${JSON.stringify(r.issues)}`);
});

test('Absicht: dieselbe bewegungslose Timeline fällt durch die ABSICHTSPRÜFUNG', () => {
  const t = TOTE_TIMELINE();
  const intent = [
    { kind: 'drehung', part: 'pelvis', axis: 'x', from: 0, to: 59, minDeg: 300 },
    { kind: 'flugphase', minSek: 0.5 },
    { kind: 'ortsveraenderung', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] },
    { kind: 'kontaktwechsel', foot: 'foot_r', von: 14, bis: 15 },
    { kind: 'abstand', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 1.0 },
    { kind: 'hoehe', part: 'foot_r', minAnteil: 0.2 },
    { kind: 'tempo', part: 'pelvis', minHoeheProSek: 0.8 },
  ];
  const r = pruefeAbsicht(RIG, t, intent);
  assert.equal(r.passed, false, 'die tote Timeline darf die Absichtsprüfung nicht bestehen');
  for (const c of r.checks) {
    assert.equal(c.passed, false, `Baustein ${c.name} muss auf einer toten Timeline scheitern`);
    assert.match(c.message, /\d/, `Meldung von ${c.name} enthält eine Zahl`);
  }
});

// ── Je Baustein ein erfüllter und ein verletzter Fall ────────────────────────

// 1. drehung
test('drehung: Kopf-Kette dreht 360 Grad — erfüllt minDeg 300', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'drehung', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 300 }]);
  assert.equal(r.checks[0].passed, true);
});

test('drehung: dieselbe Drehung erfüllt minDeg 500 NICHT — Meldung mit Ist und Soll', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'drehung', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 500 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Grad/);
  assert.match(r.checks[0].message, /\d/);
});

// 2. flugphase
test('flugphase: 30 Frames Flug bei 30 fps ergeben 1,0 s — erfüllt minSek 0,5', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'flugphase', minSek: 0.5 }]);
  assert.equal(r.checks[0].passed, true);
});

test('flugphase: dieselbe Flugphase verletzt maxSek 0,3', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'flugphase', maxSek: 0.3 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Sekunden/);
});

test('flugphase: Scheitelhöhe außerhalb des Bereichs wird als eigener Check gemeldet', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'flugphase', minSek: 0.3, minScheitel: 99 }]);
  assert.equal(r.passed, false);
  const scheitel = r.checks.find((c) => c.name === 'flugphase.scheitel');
  assert.ok(scheitel, 'Scheitelhöhe wird als eigener Check gemeldet');
  assert.equal(scheitel.passed, false);
  assert.match(scheitel.message, /Körperhöhen/);
});

// 3. ortsveraenderung
test('ortsveraenderung: Becken bewegt sich rückwärts — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'ortsveraenderung', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] }]);
  assert.equal(r.checks[0].passed, true);
});

test('ortsveraenderung: dieselbe Bewegung nach VORN verletzt minHoehe nach vorn', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'ortsveraenderung', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, 1] }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

// 4. kontaktwechsel
test('kontaktwechsel: Fuß hebt exakt bei Frame 15 — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'kontaktwechsel', foot: 'foot_r', von: 14, bis: 15 }]);
  assert.equal(r.checks[0].passed, true);
});

test('kontaktwechsel: geforderter Abhebe-Frame 44 weicht vom gemessenen ab', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'kontaktwechsel', foot: 'foot_r', von: 14, bis: 30 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Frame \d+/);
});

// 5. abstand
test('abstand: Hände sind 0,6 Körperhöhen auseinander — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'abstand', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 1.0 }]);
  assert.equal(r.checks[0].passed, true);
});

test('abstand: geforderter Mindestabstand 5 Körperhöhen ist unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'abstand', partA: 'hand_l', partB: 'hand_r', minAnteil: 5.0 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

test('abstand: Mindestdauer wird gezählt — 3 s gefordert scheitern', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'abstand', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 3.0 }]);
  assert.equal(r.passed, false);
  const dauer = r.checks.find((c) => c.unit === 'frames');
  assert.ok(dauer, 'Mindestdauer wird als eigener Check gemeldet');
  assert.equal(dauer.passed, false);
  assert.match(dauer.message, /Frames/);
});

// 6. hoehe
test('hoehe: Füße übersteigen 0,2 Körperhöhen — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'hoehe', part: 'foot_r', minAnteil: 0.2 }]);
  assert.equal(r.checks[0].passed, true);
});

test('hoehe: Kopf über 5 Körperhöhen ist unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'hoehe', part: 'head_top', minAnteil: 5 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

// 7. tempo
test('tempo: Becken erreicht mehr als 0,8 Körperhöhen/s — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'tempo', part: 'pelvis', minHoeheProSek: 0.8 }]);
  assert.equal(r.checks[0].passed, true);
});

test('tempo: geforderte 50 Körperhöhen/s sind unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'tempo', part: 'pelvis', minHoeheProSek: 50 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen pro Sekunde/);
});

// ── Fehlermeldungen mit Zahl, Eingabeprüfung ─────────────────────────────────

test('Frame außerhalb der Timeline wird mit Zahl abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht(RIG, t, [{ kind: 'hoehe', part: 'foot_r', minAnteil: 0.2, from: 60, to: 70 }]),
    /0 bis 59/);
});

test('unbekannter Baustein wird abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht(RIG, t, [{ kind: 'farbe', part: 'foot_r' }]),
    /farbe.*drehung/);
});

test('fehlende Körperhöhe im Profil wird abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht({ ...RIG, world: { ...RIG.world, height: 0 } }, t,
      [{ kind: 'hoehe', part: 'foot_r', minAnteil: 0.2 }]),
    /world\.height = 0/);
});

test('Timeline ohne gelöste Frames wird abgelehnt', () => {
  const leer = { fps: FPS, frameCount: 60, solved: { frames: [] } };
  assert.throws(
    () => pruefeAbsicht(RIG, leer, [{ kind: 'hoehe', part: 'foot_r', minAnteil: 0.2 }]),
    /0 gelösten Frames|erwartet Array/);
});

test('leere Absichtsliste ist keine Absicht', () => {
  const t = saltoTimeline();
  assert.throws(() => pruefeAbsicht(RIG, t, []), /nicht-leeres Array von Kriterien/);
});