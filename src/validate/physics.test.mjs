// AP4 — Tests für die Physikprüfungen (src/validate/physics.js).
//
// Alles Prüfmaterial wird hier KONSTRUIERT, keine Modelle, keine Clips.
// Das Rig ist ein festes Prüf-Rig (umsetzung.md AP4: "Kann gegen ein festes
// Rig gebaut werden"). Seine Maße sind Definition, nicht Schätzung; die
// restDistances sind die im Konstrukt gemessenen Bind-Pose-Abstände.
//
// Zu jedem Positivfall gehört der Negativfall aus der Abnahmetabelle
// (docs/umsetzung.md, AP4), mit dem Betrag, der gemeldet werden muss.
// Phasenabhängigkeit (plan.md 6.6) wird je Prüfung mitgeprüft.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefePhysik } from './physics.js';

const FPS = 30;

// ── Festes Prüf-Rig: Körperhöhe 1,8 m, Boden bei y = 0 ──────────────────────

const RIG = {
  world: { height: 1.8, groundY: 0, up: 'y' },
  roles: {
    pelvis: { bone: 'pelvis' },
    foot_l: { bone: 'foot_l' },
    foot_r: { bone: 'foot_r' },
  },
  segments: [
    { id: 'arm_l', from: 'shoulder_l', to: 'hand_l' },
    { id: 'kopf', from: 'neck', to: 'head_top' },
  ],
  // Bind-Pose-Abstand der Segmente arm_l und kopf (beide vertikal,
  // Horizontalabstand 0,30 m — der Konstrukt, nicht geraten):
  restDistances: { 'arm_l|kopf': 0.30 },
  soles: [
    { id: 'sole_l', bone: 'foot_l', local: [0, 0, 0] },
    { id: 'sole_r', bone: 'foot_r', local: [0, 0, 0] },
  ],
  params: {},
};

// Stehende Referenzpose: Füße am Boden, Arm in Ruhelage, Schwerpunkt im Lot
// über der Stützfläche (Fußpunkte z = 0,05, daher com z = 0,05).
const STEH = {
  pelvis: [0, 0.95, 0],
  foot_l: [-0.12, 0, 0.05],
  foot_r: [0.12, 0, 0.05],
  shoulder_l: [0.30, 1.45, 0],
  hand_l: [0.30, 1.00, 0],
  neck: [0, 1.45, 0],
  head_top: [0, 1.62, 0],
};

const stehFrame = (positions, extra = {}) => ({
  positions: structuredClone(positions ?? STEH),
  com: [0, 0.98, 0.05],
  contact: 'kontakt',
  anchored: ['sole_l', 'sole_r'],
  ...extra,
});

const nFrames = (n, positions, extra) => Array.from({ length: n }, () => stehFrame(positions, extra));

// ── 1. Bodendurchdringung ────────────────────────────────────────────────────

test('Boden: ruhig stehende Referenzfigur wird nicht beanstandet', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH), FPS);
  assert.deepEqual(r.issues, []);
  assert.equal(r.passed, true);
});

test('Boden: um 5 cm abgesenkte Figur — genau 5 cm je Bodenknochen gemeldet', () => {
  const gesenkt = {};
  for (const [bone, p] of Object.entries(STEH)) gesenkt[bone] = [p[0], p[1] - 0.05, p[2]];
  const r = pruefePhysik(RIG, nFrames(3, gesenkt), FPS);
  const boden = r.issues.filter((i) => i.kind === 'boden');
  // Nur die beiden Füße liegen unter dem Boden (alle anderen Knochen bleiben
  // über der Ebene): 2 Knochen × 3 Frames, jeder mit exakt 5 cm Tiefe.
  assert.equal(boden.length, 6);
  for (const i of boden) {
    assert.equal(i.value, 0.05);
    assert.equal(i.unit, 'm');
    assert.match(i.message, /5,0 cm/);
  }
});

// ── 2. Selbstdurchdringung (Bind-Pose-Ruheabstände) ──────────────────────────

test('Durchdringung: Referenzpose ohne Verengung wird nicht beanstandet', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH), FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'durchdringung').length, 0);
});

test('Durchdringung: Arm an den Kopf gedreht — Verengung mit Betrag gemeldet', () => {
  // Armsegment parallel zum Kopfsegment bei x = 0,03: Ist-Abstand 0,03 m,
  // Ruheabstand 0,30 m → Verengung exakt 0,27 m.
  const pose = { ...STEH, shoulder_l: [0.03, 1.50, 0], hand_l: [0.03, 1.56, 0] };
  const r = pruefePhysik(RIG, nFrames(3, pose), FPS);
  const dd = r.issues.filter((i) => i.kind === 'durchdringung');
  assert.equal(dd.length, 3);   // je Frame eine Meldung
  for (const i of dd) {
    assert.equal(i.part, 'arm_l|kopf');
    assert.equal(i.value, 0.27);
    assert.equal(i.unit, 'm');
    assert.match(i.message, /27,0 cm/);
  }
});

// ── 3. Balance, nur bei Bodenkontakt ─────────────────────────────────────────

test('Balance: ruhig stehende Figur mit Schwerpunkt im Lot wird nicht beanstandet', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH), FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'balance').length, 0);
});

test('Balance: Hüfte 30 cm zur Seite — Überstand mit Betrag gemeldet', () => {
  // Stützfläche endet bei x = 0,12; com bei x = 0,42 → Überstand exakt 0,30 m.
  const r = pruefePhysik(RIG, nFrames(3, STEH, { com: [0.42, 0.98, 0.05] }), FPS);
  const bal = r.issues.filter((i) => i.kind === 'balance');
  assert.equal(bal.length, 3);
  for (const i of bal) {
    assert.equal(i.value, 0.30);
    assert.equal(i.unit, 'm');
    assert.match(i.message, /30,0 cm/);
  }
});

test('Balance: dieselbe Abweichung im Flug wird nicht geprüft (phasenabhängig)', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH, { contact: 'flug', com: [0.42, 0.98, 0.05] }), FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'balance').length, 0);
});

// ── 4. Fußrutschen, nur bei Kontakt und Verankerung ──────────────────────────

test('Rutschen: verankerter, stillstehender Fuß meldet nichts', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH), FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'rutschen').length, 0);
});

test('Rutschen: verankerter Fuß um 10 cm versetzt — 10 cm gemeldet', () => {
  const versetzt = { ...STEH, foot_l: [-0.02, 0, 0.05] };
  const r = pruefePhysik(RIG, [stehFrame(), stehFrame(versetzt)], FPS);
  const ru = r.issues.filter((i) => i.kind === 'rutschen');
  assert.equal(ru.length, 1);
  assert.equal(ru[0].part, 'foot_l');
  assert.equal(ru[0].frame, 1);
  assert.equal(ru[0].value, 0.10);
  assert.equal(ru[0].unit, 'm');
  assert.match(ru[0].message, /10,0 cm/);
});

test('Rutschen: nicht verankerter Fuß darf sich bei Kontakt bewegen', () => {
  const versetzt = { ...STEH, foot_l: [-0.02, 0, 0.05] };
  const frames = [
    stehFrame(STEH, { anchored: ['sole_r'] }),
    stehFrame(versetzt, { anchored: ['sole_r'] }),
  ];
  const r = pruefePhysik(RIG, frames, FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'rutschen').length, 0);
});

test('Rutschen: Versatz über die Kontakt-Flug-Grenze wird nicht geprüft (phasenabhängig)', () => {
  const versetzt = { ...STEH, foot_l: [-0.02, 0, 0.05] };
  const frames = [stehFrame(), stehFrame(versetzt, { contact: 'flug' })];
  const r = pruefePhysik(RIG, frames, FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'rutschen').length, 0);
});

// ── 5. Ballistik, nur im Flug ────────────────────────────────────────────────

test('Ballistik: freier Fall im Flug wird akzeptiert', () => {
  const dt = 1 / FPS;
  const frames = Array.from({ length: 5 }, (_, i) =>
    stehFrame(STEH, { contact: 'flug', com: [0, 2.0 - 0.5 * 9.81 * (i * dt) ** 2, 0.05] }));
  const r = pruefePhysik(RIG, frames, FPS);
  assert.deepEqual(r.issues, []);
  assert.equal(r.passed, true);
});

test('Ballistik: schwebender Schwerpunkt im Flug — Meldung mit gemessener Beschleunigung', () => {
  const frames = nFrames(5, STEH, { contact: 'flug', com: [0, 2.0, 0.05] });
  const r = pruefePhysik(RIG, frames, FPS);
  const bal = r.issues.filter((i) => i.kind === 'ballistik');
  // Frames 1 bis 3 bilden je ein Flug-Tripel; die Beschleunigung ist 0 statt
  // -9,81 m/s², die Abweichung also exakt 9,81 m/s².
  assert.equal(bal.length, 3);
  for (const i of bal) {
    assert.equal(i.value, 9.81);
    assert.equal(i.unit, 'm/s²');
    assert.equal(i.part, 'schwerpunkt');
    assert.match(i.message, /0,00 m\/s²/);
    assert.match(i.message, /9,81 m\/s²/);
  }
});

test('Ballistik: konstanter Schwerpunkt bei Bodenkontakt wird nicht geprüft (phasenabhängig)', () => {
  const r = pruefePhysik(RIG, nFrames(3, STEH, { com: [0, 2.0, 0.05] }), FPS);
  assert.equal(r.issues.filter((i) => i.kind === 'ballistik').length, 0);
  assert.equal(r.passed, true);
});

test('Ballistik: ohne Framerate wird nicht geraten — Prüfung steht unter ausgelassen', () => {
  const frames = nFrames(5, STEH, { contact: 'flug', com: [0, 2.0, 0.05] });
  const r = pruefePhysik(RIG, frames);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.ausgelassen, ['ballistik']);
});

test('Ballistik: unsinnige Framerate wird mit Zahl abgelehnt', () => {
  const frames = nFrames(5, STEH, { contact: 'flug', com: [0, 2.0, 0.05] });
  assert.throws(() => pruefePhysik(RIG, frames, 0), /fps = 0/);
});
