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
//
// BEZEICHNER (Auftrag "Drei Nahtstellen", Punkt 1): die sieben Bausteine heißen
// hier genau so wie im Werkzeugkatalog, den der Agent sieht — INTENT_ARTEN in
// src/tools/catalog.js. Der letzte Abschnitt dieses Tests vergleicht die beiden
// Listen direkt; ein zweiter Namenssatz ist damit nicht nur unüblich, sondern
// rot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeAbsicht, pruefeKriterien, BAUSTEINE } from './intent.js';
import { pruefePhysik } from './physics.js';
import { INTENT_ARTEN } from '../tools/catalog.js';

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
//   pelvis, foot_l, foot_r, hand_r, hand_l, neck, head_top
// Ein Salto-Konstrukt, Frame für Frame von Hand gelegt.

const H1 = 1.8;   // Körperhöhe, Referenz aller Anteile

/**
 * Ein Frame-Aufbauhelfer: positions + contact + optional com.
 * `positions` ist dasselbe Feld, das src/validate/physics.js liest — ein
 * gelöster Frame trägt seine Knochendaten unter einem Namen (BRETT.md,
 * Eintrag AP5; Auftrag "Drei Nahtstellen", Punkt 2).
 */
const frame = (positionen, contact = 'kontakt', extra = {}) =>
  ({ positions: positionen, contact, ...extra });

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

/**
 * Die sieben Kriterien des Salto, in den Namen des Werkzeugkatalogs.
 * `scheitel: false` lässt die Scheitelhöhen-Grenzen weg — ohne jeden Flug-Frame
 * ist die Scheitelhöhe nicht messbar, und die Prüfung wirft dann, statt einen
 * Check zu verlieren.
 */
const SALTO_ABSICHT = ({ scheitel = true } = {}) => [
  { kind: 'rotation', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 300 },
  { kind: 'airtime', minSek: 0.5, maxSek: 1.2,
    ...(scheitel ? { minScheitel: 0.7, maxScheitel: 1.4 } : {}) },
  { kind: 'travel', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] },
  { kind: 'contact_change', foot: 'foot_r', von: 14, bis: 15 },
  { kind: 'clearance', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 1.0 },
  { kind: 'part_height', part: 'foot_r', minAnteil: 0.2 },
  { kind: 'part_speed', part: 'pelvis', minHoeheProSek: 0.8 },
];

// ── Abnahmetest "Absicht": Salto erfüllt, tote Timeline scheitert ───────────

test('Absicht: der konstruierte Salto erfüllt alle sieben Bausteine', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, SALTO_ABSICHT());
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
  // Physik- und Absichtsprüfung lesen dasselbe Feld: positions. Der Schulter-
  // punkt des Segments kommt in dieselbe Tabelle.
  const framesPhysik = t.solved.frames.map((f) => ({
    ...f,
    positions: {
      ...f.positions,
      // Segment-Endpunkt arm_l: Schulter über der rechten Hand am Kopf-Höhenbereich.
      shoulder_l: [0.30, 1.45, 0],
    },
  }));
  const r = pruefePhysik(profilePhysik, framesPhysik, FPS);
  assert.equal(r.passed, true, `erwarte grüne Physikprüfung auf der toten Timeline: ${JSON.stringify(r.issues)}`);
});

test('Absicht: dieselbe bewegungslose Timeline fällt durch die ABSICHTSPRÜFUNG', () => {
  const t = TOTE_TIMELINE();
  const r = pruefeAbsicht(RIG, t, SALTO_ABSICHT({ scheitel: false }));
  assert.equal(r.passed, false, 'die tote Timeline darf die Absichtsprüfung nicht bestehen');
  assert.equal(r.checks.length, 7);
  for (const c of r.checks) {
    assert.equal(c.passed, false, `Baustein ${c.name} muss auf einer toten Timeline scheitern`);
    assert.match(c.message, /\d/, `Meldung von ${c.name} enthält eine Zahl`);
  }
});

// ── Je Baustein ein erfüllter und ein verletzter Fall ────────────────────────

// 1. rotation
test('rotation: Kopf-Kette dreht 360 Grad — erfüllt minDeg 300', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'rotation', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 300 }]);
  assert.equal(r.checks[0].name, 'rotation');
  assert.equal(r.checks[0].passed, true);
});

test('rotation: dieselbe Drehung erfüllt minDeg 500 NICHT — Meldung mit Ist und Soll', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'rotation', part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 500 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Grad/);
  assert.match(r.checks[0].message, /\d/);
});

// 2. airtime
test('airtime: 30 Frames Flug bei 30 fps ergeben 1,0 s — erfüllt minSek 0,5', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'airtime', minSek: 0.5 }]);
  assert.equal(r.checks[0].name, 'airtime');
  assert.equal(r.checks[0].passed, true);
});

test('airtime: dieselbe Flugphase verletzt maxSek 0,3', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'airtime', maxSek: 0.3 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Sekunden/);
});

test('airtime: Scheitelhöhe außerhalb des Bereichs wird als eigener Check gemeldet', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'airtime', minSek: 0.3, minScheitel: 99 }]);
  assert.equal(r.passed, false);
  const scheitel = r.checks.find((c) => c.name === 'airtime.apex');
  assert.ok(scheitel, `Scheitelhöhe wird als eigener Check gemeldet: ${JSON.stringify(r.checks)}`);
  assert.equal(scheitel.passed, false);
  assert.match(scheitel.message, /Körperhöhen/);
});

// 3. travel
test('travel: Becken bewegt sich rückwärts — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'travel', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] }]);
  assert.equal(r.checks[0].name, 'travel');
  assert.equal(r.checks[0].passed, true);
});

test('travel: dieselbe Bewegung nach VORN verletzt minHoehe nach vorn', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'travel', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, 1] }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

// 4. contact_change
test('contact_change: Fuß hebt exakt bei Frame 15 — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'contact_change', foot: 'foot_r', von: 14, bis: 15 }]);
  assert.equal(r.checks[0].name, 'contact_change');
  assert.equal(r.checks[0].passed, true);
});

test('contact_change: Abheben bei 15 liegt im Fenster 10..20 — erfüllt (Lauf 9: Fenster 30..35, Abheben 30)', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'contact_change', foot: 'foot_r', von: 10, bis: 20 }]);
  assert.equal(r.checks[0].passed, true, JSON.stringify(r.checks[0]));
  assert.equal(r.checks[0].measured, 15);
  assert.equal(r.checks[0].required, 'frame 10..20');
});

test('contact_change: Fenster 20..30 liegt nach dem Abheben bei 15 — nicht erfüllt, mit Grund', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'contact_change', foot: 'foot_r', von: 20, bis: 30 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Frame \d+/);
  assert.match(r.checks[0].message, /schon vor Frame 20 in der Luft/);
});

// 5. clearance
test('clearance: Hände sind 0,6 Körperhöhen auseinander — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'clearance', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 1.0 }]);
  assert.equal(r.checks[0].name, 'clearance');
  assert.equal(r.checks[0].passed, true);
});

test('clearance: geforderter Mindestabstand 5 Körperhöhen ist unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'clearance', partA: 'hand_l', partB: 'hand_r', minAnteil: 5.0 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

test('clearance: Mindestdauer wird gezählt — 3 s gefordert scheitern', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [
    { kind: 'clearance', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5, minDauerSek: 3.0 }]);
  assert.equal(r.passed, false);
  const dauer = r.checks.find((c) => c.unit === 'frames');
  assert.ok(dauer, 'Mindestdauer wird als eigener Check gemeldet');
  assert.equal(dauer.passed, false);
  assert.match(dauer.message, /Frames/);
});

// 6. part_height
test('part_height: Füße übersteigen 0,2 Körperhöhen — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'part_height', part: 'foot_r', minAnteil: 0.2 }]);
  assert.equal(r.checks[0].name, 'part_height');
  assert.equal(r.checks[0].passed, true);
});

test('part_height: Kopf über 5 Körperhöhen ist unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'part_height', part: 'head_top', minAnteil: 5 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen/);
});

// 7. part_speed
test('part_speed: Becken erreicht mehr als 0,8 Körperhöhen/s — erfüllt', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'part_speed', part: 'pelvis', minHoeheProSek: 0.8 }]);
  assert.equal(r.checks[0].name, 'part_speed');
  assert.equal(r.checks[0].passed, true);
});

test('part_speed: geforderte 50 Körperhöhen/s sind unerreichbar', () => {
  const t = saltoTimeline();
  const r = pruefeAbsicht(RIG, t, [{ kind: 'part_speed', part: 'pelvis', minHoeheProSek: 50 }]);
  assert.equal(r.checks[0].passed, false);
  assert.match(r.checks[0].message, /Körperhöhen pro Sekunde/);
});

// ── Kriterien auf Vollständigkeit VOR dem Speichern ──────────────────────────
// Pro Baustein ein gültiger und ein unvollständiger Fall. Unvollständige
// Kriterien dürfen nicht erst in der laufenden Prüfung als Wurf auffallen
// ("part_height: erwartet part, bekommen undefined"), sondern schon beim
// Setzen — deshalb pruefeKriterien, gegen dieselbe Feldtabelle, die
// werteKriterium beim Messen erzwingt.

test('pruefeKriterien: alle sieben gültigen Kriterien sind vollständig', () => {
  const gueltig = [
    { kind: 'rotation', part: 'head_top', axis: 'x', minDeg: 300 },
    { kind: 'airtime', minSek: 0.5 },
    { kind: 'travel', part: 'pelvis', minHoehe: 0.2, richtung: [0, 0, -1] },
    { kind: 'contact_change', foot: 'foot_r', von: 14, bis: 15 },
    { kind: 'clearance', partA: 'hand_l', partB: 'hand_r', minAnteil: 0.5 },
    { kind: 'part_height', part: 'foot_r', minAnteil: 0.2 },
    { kind: 'part_speed', part: 'pelvis', minHoeheProSek: 0.8 },
  ];
  const r = pruefeKriterien(gueltig);
  assert.equal(r.ok, true, `vollständige Kriterien dürfen nicht abgelehnt werden: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(r.fehler, []);
});

test('pruefeKriterien: je Baustein der unvollständige Fall wird mit Index, Art und Feld gemeldet', () => {
  const unvollstaendig = [
    { kind: 'rotation', part: 'head_top' },                                   // axis fehlt, kein min/maxDeg
    { kind: 'airtime' },                                                      // weder minSek noch maxSek
    { kind: 'travel', part: 'pelvis', richtung: [0, 0, -1] },                 // kein minHoehe/maxHoehe
    { kind: 'contact_change', foot: 'foot_r', von: 14 },                      // bis fehlt
    { kind: 'clearance', partA: 'hand_l', minAnteil: 0.5 },                   // partB fehlt
    { kind: 'part_height', minAnteil: 0.2 },                                  // part fehlt
    { kind: 'part_speed', part: 'pelvis', maxHoeheProSek: 5 },                // vollständig — als Kontrolle
    { kind: 'part_speed', maxHoeheProSek: 5 },                                // part fehlt
  ];
  const r = pruefeKriterien(unvollstaendig);
  assert.equal(r.ok, false, 'unvollständige Kriterien müssen abgelehnt werden');
  // Jede Meldung nennt Index, Art, fehlendes Feld und den kompletten Bedarf:
  for (const f of r.fehler) {
    assert.match(f.meldung, new RegExp(`Kriterium ${f.index} von ${unvollstaendig.length} \\(` + f.kind + '\\)'),
      `Meldung nennt nicht Index und Art: ${f.meldung}`);
  }
  const feld = (index) => r.fehler.filter((f) => f.index === index).map((f) => f.feld).sort();
  assert.deepEqual(feld(0).sort(), ['axis', 'minDeg|maxDeg'], `rotation: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(1), ['minSek|maxSek'], `airtime: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(2), ['minHoehe|maxHoehe'], `travel: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(3), ['bis'], `contact_change: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(4), ['partB'], `clearance: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(5), ['part'], `part_height: ${JSON.stringify(r.fehler)}`);
  assert.deepEqual(feld(6), [], 'vollständiges part_speed-Kriterium erzeugt keinen Fehler');
  assert.deepEqual(feld(7), ['part'], `part_speed: ${JSON.stringify(r.fehler)}`);
  // part_height ohne Felder — genau der Fall aus dem Fehlerbericht. Die
  // Meldung nennt das fehlende Feld und den ganzen Bedarf der Art:
  const ph = r.fehler.find((f) => f.kind === 'part_height');
  assert.ok(ph, 'part_height ohne part wird gemeldet');
  assert.match(ph.meldung, /'part' fehlt/);
  assert.match(ph.meldung, /part_height braucht part, minAnteil oder maxAnteil/);
});

// ── Nahtstelle Werkzeugkatalog ↔ Absichtsprüfung ─────────────────────────────

test('Die Bausteinliste der Prüfung ist die des Werkzeugkatalogs', () => {
  // Kein dritter Namenssatz, keine Reihenfolge als Vertragsbestandteil: die
  // Mengen müssen identisch sein.
  assert.deepEqual([...BAUSTEINE].sort(), [...INTENT_ARTEN].sort(),
    `src/validate/intent.js und src/tools/catalog.js nennen Verschiedenes: `
    + `Prüfung ${BAUSTEINE.join(', ')} — Katalog ${INTENT_ARTEN.join(', ')}`);
  assert.equal(BAUSTEINE.length, 7, `plan.md 6.6 kennt 7 Bausteine, es sind ${BAUSTEINE.length}`);
});

test('Jede Art des Katalogs wird von der Prüfung angenommen', () => {
  // Der Weg, den ein Agent geht: set_intent schreibt die Namen des Katalogs,
  // validate legt sie der Prüfung vor. Kriterium "angenommen" ist, dass die
  // Prüfung die Art kennt — eine Meldung über fehlende Parameter heißt: bekannt.
  const t = saltoTimeline();
  const alle = {
    part: 'head_top', axis: 'x', from: 15, to: 45, minDeg: 1,
    minSek: 0, minScheitel: 0, maxScheitel: 99,
    minHoehe: 0, richtung: [0, 0, -1],
    foot: 'foot_r', von: 14, bis: 15,
    partA: 'hand_l', partB: 'hand_r', minAnteil: 0,
    minHoeheProSek: 0,
  };
  for (const art of INTENT_ARTEN) {
    assert.doesNotThrow(() => pruefeAbsicht(RIG, t, [{ kind: art, ...alle }]),
      `der Katalog bietet "${art}" an, die Prüfung lehnt die Art ab`);
    const r = pruefeAbsicht(RIG, t, [{ kind: art, ...alle }]);
    assert.ok(BAUSTEINE.includes(r.checks[0].name),
      `der Check heißt "${r.checks[0].name}", erwartet ein Name des Katalogs: ${JSON.stringify(r.checks)}`);
  }
});

test('Negativfall zur Namenserweiterung: die deutschen Bausteinnamen der ersten Bauform sind Geschichte', () => {
  // Wird hier NICHT still zurückübersetzt. Ein alten Name muss abgelehnt
  // werden, sonst existieren zwei Namen für dieselbe Sache weiter — genau die
  // Nahtstelle, die den Durchlauf blockiert hat.
  const t = saltoTimeline();
  const deutsch = ['drehung', 'flugphase', 'ortsveraenderung', 'kontaktwechsel',
    'abstand', 'hoehe', 'tempo'];
  for (const art of deutsch) {
    assert.throws(() => pruefeAbsicht(RIG, t, [{ kind: art, part: 'foot_r', minAnteil: 0 }]),
      new RegExp(`kind = .*${art}`), `der alte Name "${art}" wurde angenommen`);
  }
  // Und die Ablehnung nennt, was stattdessen gemeint sein könnte: alle sieben.
  assert.throws(() => pruefeAbsicht(RIG, t, [{ kind: 'hoehe', part: 'foot_r' }]),
    /rotation.*airtime.*travel.*contact_change.*clearance.*part_height.*part_speed/);
});

// ── Fehlermeldungen mit Zahl, Eingabeprüfung ─────────────────────────────────

test('Frame außerhalb der Timeline wird mit Zahl abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht(RIG, t, [{ kind: 'part_height', part: 'foot_r', minAnteil: 0.2, from: 60, to: 70 }]),
    /0 bis 59/);
});

test('unbekannter Baustein wird abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht(RIG, t, [{ kind: 'farbe', part: 'foot_r' }]),
    /farbe.*rotation/);
});

test('fehlende Körperhöhe im Profil wird abgelehnt', () => {
  const t = saltoTimeline();
  assert.throws(
    () => pruefeAbsicht({ ...RIG, world: { ...RIG.world, height: 0 } }, t,
      [{ kind: 'part_height', part: 'foot_r', minAnteil: 0.2 }]),
    /world\.height = 0/);
});

test('Timeline ohne gelöste Frames wird abgelehnt', () => {
  const leer = { fps: FPS, frameCount: 60, solved: { frames: [] } };
  assert.throws(
    () => pruefeAbsicht(RIG, leer, [{ kind: 'part_height', part: 'foot_r', minAnteil: 0.2 }]),
    /0 gelösten Frames|erwartet Array/);
});

test('Frame ohne Knochentabelle wird mit Zahl abgelehnt', () => {
  // Die Absichtsprüfung liest positions — derselbe Feldname wie in der
  // Physikprüfung. Ein Frame, der sie nicht mitbringt, wird nicht geraten.
  const t = saltoTimeline();
  t.solved.frames[7] = { contact: 'kontakt', com: [0, 1, 0] };
  assert.throws(
    () => pruefeAbsicht(RIG, t, [{ kind: 'part_height', part: 'foot_r', minAnteil: 0.2 }]),
    /frames\[7\]\.positions fehlt/);
});

test('leere Absichtsliste ist keine Absicht', () => {
  const t = saltoTimeline();
  assert.throws(() => pruefeAbsicht(RIG, t, []), /nicht-leeres Array von Kriterien/);
});
