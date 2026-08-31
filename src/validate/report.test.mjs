// Tests für die Berichts-Zusammenführung (AP8) — src/validate/report.js.
// Runner: node --test "src/**/*.test.mjs"
// Jeder Test nennt seinen Positiv- und Negativfall (AGENTS.md, Regel 2).

import { test } from 'node:test';
import assert from 'node:assert';
import { baueValidationReport } from './report.js';
import { validateValidationReport } from '../contracts/validation-report.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — dieselbe Form wie die echten Eingaben (plan.md 5.1/5.2)
// Körpermaße hier als Testdaten: 1,6-m-Figur, Hüfte bei 0,8 m, Boden 0.
// ─────────────────────────────────────────────────────────────────────────────

function baueProfil() {
  return {
    schemaVersion: 1,
    source: { file: 'test.glb', boneCount: 3, vertexCount: 12 },
    world: { up: 'y', forward: 'z', left: 'x', groundY: 0, height: 1.6, unitsPerMeter: 1.0 },
    bones: [
      { id: 'huefte', parent: null, bindWorld: [0, 0.8, 0] },
      { id: 'bein_l', parent: 'huefte', bindWorld: [0, 0.8, 0] },
      { id: 'bein_r', parent: 'huefte', bindWorld: [0, 0.8, 0] },
    ],
    roles: {
      pelvis: { bone: 'huefte', confidence: 1.0 },
      foot_l: { bone: 'bein_l', confidence: 1.0 },
      foot_r: { bone: 'bein_r', confidence: 1.0 },
    },
    joints: {},
    segments: [
      { id: 'oberschenkel_l', from: 'huefte', to: 'bein_l', radius: 0.06, mass: 8, volume: 0.008 },
      { id: 'oberschenkel_r', from: 'huefte', to: 'bein_r', radius: 0.06, mass: 8, volume: 0.008 },
    ],
    soles: [
      { id: 'sole_l', bone: 'bein_l', local: [0, -0.8, 0.05] },
      { id: 'sole_r', bone: 'bein_r', local: [0, -0.8, 0.05] },
    ],
    restDistances: {},
    params: { radiusPercentile: 0.90, soleTolerance: 0.035, contactMargin: 0.015 },
    warnings: [],
  };
}

/** Steh-Frame: alle Knochen bei 0,8 m. contact setzt die Phase explizit. */
function stehFrame(contact = 'kontakt') {
  return {
    bones: { huefte: [0, 0.8, 0], bein_l: [0, 0.8, 0], bein_r: [0, 0.8, 0] },
    positions: { huefte: [0, 0.8, 0], bein_l: [0, 0.8, 0], bein_r: [0, 0.8, 0] },
    com: [0, 0.82, 0],
    contact,
  };
}

/** Flug-Frame: alles 1,0 m über dem Boden. */
function flugFrame(contact = 'flug') {
  return {
    bones: { huefte: [0, 1.0, 0], bein_l: [0, 1.0, 0], bein_r: [0, 1.0, 0] },
    positions: { huefte: [0, 1.0, 0], bein_l: [0, 1.0, 0], bein_r: [0, 1.0, 0] },
    com: [0, 1.02, 0],
    contact,
  };
}

/** Boden-Durchstoß: bein_r liegt 0,1 m unter dem Boden. */
function bodenFrame() {
  return {
    ...stehFrame('kontakt'),
    positions: { huefte: [0, 0.8, 0], bein_l: [0, 0.8, 0], bein_r: [0, -0.1, 0] },
  };
}

/** 24-Frame-Timeline: 2 s Steh-Halt (verb stand, Stil-Ausnahme 'halt'), dann
 *  aufsteigende Bewegung mit Parabelflug. Phasen aus den Frame-Zuständen:
 *  Frames 0..7 Kontakt, 8..15 Flug, 16..23 Kontakt. */
function baueTimeline() {
  const t = (i) => i / 30, dt = 1 / 30, g = 9.81;
  const H = 1.6;                                    // Körperhöhe
  const absprung = t(8);                            // Zeitpunkt des Absprungs
  const v0 = 1.2;                                   // Absprunggeschwindigkeit m/s
  const yVon = (i) =>
    i <= 8 ? 0.8
    : i <= 15
      ? 0.8 + v0 * (t(i) - absprung) - 0.5 * g * (t(i) - absprung) ** 2
      : 0.8;                                        // Landung, vereinfacht
  // bein_r: Antizipation (Rückbewegung vor Frame 8), dann Vorwärtsbewegung.
  const xVon = (i) => (i < 5 ? 0 : i < 8 ? -0.02 : i < 16 ? 0.01 * (i - 8) : 0.08);
  const frames = [];
  for (let i = 0; i < 24; i++) {
    const y = yVon(i), x = xVon(i);
    frames.push({
      bones: {
        huefte: [0, y, 0],
        bein_l: [0, y, 0],
        bein_r: [x, y - 0.3, 0],
      },
      positions: {
        huefte: [0, y, 0],
        bein_l: [0, y, 0],
        bein_r: [x, y - 0.3, 0],
      },
      com: [0, y + 0.02, 0],
      contact: i < 8 ? 'kontakt' : i < 16 ? 'flug' : 'kontakt',
      anchored: i < 8 ? ['sole_l', 'sole_r'] : [],
    });
  }
  return {
    schemaVersion: 1,
    fps: 30,
    frameCount: 24,
    rotationFormat: 'quaternion',
    phases: [
      { id: 'p1', verb: 'stand', from: 0, to: 8, params: {} },
      { id: 'p2', verb: 'takeoff', from: 8, to: 16, params: { vy: v0 } },
      { id: 'p3', verb: 'land', from: 16, to: 24, params: {} },
    ],
    overrides: {},
    solved: { frames },
  };
}

/** Absicht: der Schwerpunkt steigt im Flug. Die Parabel mit v0 = 1,2 m/s
 *  steigt um 0,073 m = 0,046 Körperhöhen; der Sollbereich 0,03..0,5 erfasst
 *  das mit Abstand. */
const ABSICHT = [
  { kind: 'ortsveraenderung', part: 'com', richtung: [0, 1, 0], minHoehe: 0.03, maxHoehe: 0.5 },
];

/** Stil-Options: der Halt in Phase 1 ist ein erklärter Stand (plan.md 6.6). */
const STIL = {
  hauptbewegung: { part: 'bein_r', abFrame: 9, richtung: [1, 0, 0] },
  ausnahmen: [{ von: 0, bis: 8, art: 'halt', grund: 'bewusster Stand vor dem Absprung (Phase p1, verb stand)' }],
};

/** Attrappe des Bildstreifens: liefert dieselbe Gestalt wie
 *  createStripRenderer().streifen() aus AP9. */
function streifenAttrappe(views = ['side']) {
  return (auswahl) => views.map((view) => ({
    view,
    frames: auswahl.map((f) => f.frame),
    ref: `strip_${view}_${auswahl.map((f) => f.frame).join('-')}.png`,
    data: 'iVBORw0KG', mimeType: 'image/png',
  }));
}

const BASIS = () => ({
  profile: baueProfil(),
  timeline: baueTimeline(),
  intent: ABSICHT.map((k) => ({ ...k })),
  stil: STIL,
  strip: streifenAttrappe(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Zusammenbau — Positivfall
// ─────────────────────────────────────────────────────────────────────────────

test('Positivfall: ein Bericht aus allen drei Schichten besteht validateValidationReport', () => {
  const bericht = baueValidationReport(BASIS());
  // Alle drei Schichten sind im Bericht:
  assert.ok(bericht.physics, 'physics fehlt im Bericht');
  assert.ok(bericht.intent, 'intent fehlt im Bericht');
  assert.ok(bericht.style, 'style fehlt im Bericht');
  assert.equal(bericht.frameCount, 24);
  // und das Schema stimmt:
  const pruefung = validateValidationReport(bericht);
  assert.equal(pruefung.ok, true, `Schema-Verstoß: ${JSON.stringify(pruefung.errors)}`);
});

test('Phasen: die Timeline ergibt die drei Blöcke Kontakt/Flug/Kontakt', () => {
  const bericht = baueValidationReport(BASIS());
  assert.deepEqual(bericht.phases, [
    { state: 'kontakt', from: 0, to: 8 },
    { state: 'flug', from: 8, to: 16 },
    { state: 'kontakt', from: 16, to: 24 },
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Zusammenbau — Negativfälle (muss rot werden)
// ─────────────────────────────────────────────────────────────────────────────

test('Negativfall: fehlt eine Schicht, wird der Bericht mit dem Feldnamen abgelehnt', () => {
  // Konkret: ohne intent bricht der Zusammenbau mit dem Feldnamen ab.
  const ohneIntent = BASIS();
  delete ohneIntent.intent;
  assert.throws(() => baueValidationReport(ohneIntent), /intent = /);
  // Ohne Absichtskriterien (leeres Array) ebenfalls — die Absichtsschicht
  // nimmt keine leere Kriterienliste an.
  const leereIntent = BASIS();
  leereIntent.intent = [];
  assert.throws(() => baueValidationReport(leereIntent), /intent = 0/);
  // Und ohne strip wird gar kein Bericht zusammengebaut:
  const ohneStrip = BASIS();
  delete ohneStrip.strip;
  assert.throws(() => baueValidationReport(ohneStrip), /strip = /);
});

test('Negativfall: ein Bericht mit fehlender Schicht wird vom Schema abgelehnt', () => {
  // Handgelegt: ein Bericht ohne style wird vom Vertrag nicht akzeptiert.
  const kaputt = {
    frameCount: 24,
    phases: [{ state: 'kontakt', from: 0, to: 24 }],
    physics: { passed: true, issues: [] },
    intent: { passed: true, checks: [] },
    // style fehlt absichtlich
    images: [{ view: 'side', frames: [0], ref: 'strip_side_0.png' }],
  };
  const pruefung = validateValidationReport(kaputt);
  assert.equal(pruefung.ok, false);
  assert.ok(
    pruefung.errors.some((e) => e.field.startsWith('style.'))
      || pruefung.errors.some((e) => e.field === 'style'),
    `Feldname "style" fehlt in den Meldungen: ${JSON.stringify(pruefung.errors)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Bildpflicht — Positiv- und Negativfall
// ─────────────────────────────────────────────────────────────────────────────

test('Positivfall: jeder ausgelieferte Bericht trägt mindestens einen Eintrag in images', () => {
  const bericht = baueValidationReport(BASIS());
  assert.ok(Array.isArray(bericht.images) && bericht.images.length > 0,
    'images fehlt oder ist leer');
  for (const img of bericht.images) {
    assert.equal(typeof img.view, 'string');
    assert.ok(img.view.length > 0);
    assert.ok(Array.isArray(img.frames) && img.frames.length > 0);
    assert.equal(typeof img.ref, 'string');
    assert.ok(img.ref.length > 0);
  }
});

test('Negativfall: ein Bericht ohne Bildverweis wird nicht ausgeliefert, sondern gemeldet', () => {
  // Streifen-Funktion ohne Bild → der Zusammenbau bricht ab.
  const ohneBild = BASIS();
  ohneBild.strip = () => [];
  assert.throws(() => baueValidationReport(ohneBild), /0 Bildstreifen/);

  // Und der Vertrag weist einen Bericht ohne images ebenfalls zurück:
  const kaputt = {
    frameCount: 24,
    phases: [{ state: 'kontakt', from: 0, to: 24 }],
    physics: { passed: true, issues: [] },
    intent: { passed: true, checks: [] },
    style: { passed: true, issues: [] },
    // images fehlt
  };
  const pruefung = validateValidationReport(kaputt);
  assert.equal(pruefung.ok, false);
  assert.ok(pruefung.errors.some((e) => e.field === 'images'));
});

test('Negativfall: ein Streifen ohne Ansichtsnamen wird abgelehnt', () => {
  const schlechterStreifen = () => [{ view: '', frames: [0], ref: 'strip.png' }];
  const eingaben = BASIS();
  eingaben.strip = schlechterStreifen;
  assert.throws(() => baueValidationReport(eingaben), /view = ""/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Frame-Auswahl
// ─────────────────────────────────────────────────────────────────────────────

test('Beanstandete Frames stehen im Bildstreifen', () => {
  // Frame 3 stoßt durch den Boden — der Physik meldet Frame 3, und genau
  // dieser Frame muss im Streifen stehen.
  const eingaben = BASIS();
  eingaben.timeline.solved.frames[3] = bodenFrame();
  const bericht = baueValidationReport(eingaben);
  assert.ok(bericht.physics.issues.length > 0, 'der Durchstoß wurde nicht gemeldet');
  const gemeldeteFrames = bericht.physics.issues.map((it) => it.frame);
  assert.ok(gemeldeteFrames.includes(3), `Frame 3 fehlt in den Meldungen: ${gemeldeteFrames}`);
  const imBild = new Set(bericht.images.flatMap((i) => i.frames));
  for (const f of gemeldeteFrames) {
    assert.ok(imBild.has(f), `beanstandeter Frame ${f} fehlt im Bildstreifen ${[...imBild]}`);
  }
});

test('Bei fehlerfreier Bewegung sind trotzdem Frames enthalten, nicht null', () => {
  const bericht = baueValidationReport(BASIS());
  assert.equal(bericht.physics.passed, true, 'der Positivfall sollte physikfrei sein');
  assert.equal(bericht.intent.passed, true, 'der Positivfall sollte absichtsfrei sein');
  assert.equal(bericht.style.passed, true, 'der Positivfall sollte stilfrei sein');
  assert.ok(Array.isArray(bericht.images) && bericht.images.length > 0);
  const imBild = bericht.images.flatMap((i) => i.frames);
  assert.ok(imBild.length > 0, 'kein Frame im Bild — auch fehlerfreie Bewegung bekommt ein Bild');
  // gleichmäßig verteilt über 24 Frames: erster und letzter Frame dabei
  assert.ok(imBild.includes(0) && imBild.includes(23),
    `Erster/letzter Frame fehlen: ${imBild}`);
});

test('Phasengrenzen stehen im Bildstreifen', () => {
  const bericht = baueValidationReport(BASIS());
  const imBild = new Set(bericht.images.flatMap((i) => i.frames));
  // Phasengrenzen der Timeline: 0 (Start), 7 (letzter Kontakt), 8 (erster
  // Flug), 15 (letzter Flug), 16 (erste Landung), 23 (Ende)
  for (const f of [0, 7, 8, 15, 16, 23]) {
    assert.ok(imBild.has(f), `Phasengrenze ${f} fehlt im Bildstreifen ${[...imBild]}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Gesamturteil
// ─────────────────────────────────────────────────────────────────────────────

test('Eine saubere Bewegung ergibt passed in allen drei Schichten', () => {
  const bericht = baueValidationReport(BASIS());
  assert.equal(bericht.physics.passed, true, JSON.stringify(bericht.physics.issues));
  assert.equal(bericht.intent.passed, true, JSON.stringify(bericht.intent.checks));
  assert.equal(bericht.style.passed, true, JSON.stringify(bericht.style.issues));
});

test('Eine bewegungslose Timeline besteht die Physik und fällt durch die Absicht', () => {
  // Stehende Figur, der Schwerpunkt steigt nicht → ortsveraenderung min 0,05
  // Körperhöhen ist verletzt, aber alle Physikprüfungen sind grün.
  const bewegungslos = BASIS();
  // Frames 8..15 ohne Flug: überall Kontakt und konstante Höhe — nichts passiert.
  for (let i = 8; i < 16; i++) {
    bewegungslos.timeline.solved.frames[i] = stehFrame('kontakt');
  }
  bewegungslos.intent = [
    { kind: 'ortsveraenderung', part: 'com', richtung: [0, 1, 0], minHoehe: 0.03 },
  ];
  // Kein Hauptbewegungs-Verweis: nichts bewegt sich, Antizipation entfällt.
  bewegungslos.stil = {
    ausnahmen: [{ von: 0, bis: 23, art: 'halt', grund: 'bewusstes Stehen über die ganze Timeline (Phase stand)' }],
  };
  const bericht = baueValidationReport(bewegungslos);
  // Physik: sauber — genau der Befund aus plan.md 3.2
  assert.equal(bericht.physics.passed, true,
    `Physik sollte grün sein: ${JSON.stringify(bericht.physics.issues)}`);
  // Absicht: durchgefallen
  assert.equal(bericht.intent.passed, false,
    'die Absicht sollte durchfallen — da bewegt sich nichts');
  // und beides steht im selben Bericht:
  assert.ok(bericht.intent.checks.some((c) => c.passed === false));
  assert.equal(bericht.physics.passed, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Harte Fehlermeldungen (AGENTS.md: Fehlermeldungen enthalten immer eine Zahl)
// ─────────────────────────────────────────────────────────────────────────────

test('Fehlermeldungen enthalten eine Zahl', () => {
  // falsche frameCount-Angabe → Meldung nennt beide Zahlen
  const eingaben = BASIS();
  eingaben.timeline.frameCount = 99;
  assert.throws(() => baueValidationReport(eingaben), /frameCount = 99[\s\S]*24 Frames/);
  // leere Timeline → Meldung nennt die Länge 0
  const leer = BASIS();
  leer.timeline.solved.frames = [];
  leer.timeline.frameCount = 0;
  assert.throws(() => baueValidationReport(leer), /timeline\.frameCount = 0|timeline\.solved\.frames = 0/);
});