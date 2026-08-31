// AP6 — Tests für die Stilprüfung (src/validate/style.js).
//
// Alles Prüfmaterial wird hier KONSTRUIERT: ein festes Prüf-Rig (Körperhöhe
// 1,8 m, Boden y = 0) und von Hand gelegte Frames. Zu jedem Positivfall
// gehört der Negativfall aus der Abnahmetabelle (docs/umsetzung.md, AP6):
//
//   Bewegungsdichte | Referenzclip löst nichts aus | Clip mit 22 toten Frames wird beanstandet
//   Antizipation    | Referenzsprung besteht      | Sprung ohne Absenken wird beanstandet
//   Ruck            | Referenzclip besteht        | eingefügter Positionssprung wird beanstandet
//
// Die vier ENTWICKLUNGSCLIPS (idle, walk, agree, sad_pose) sind als
// Konstrukt nachgebaut — die echten Clips werden über den separaten
// Clip-Test geprüft (siehe am Ende dieses Vertrags und im Spike-Aufruf).

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeStil, DICHTE_MIN, TOTE_FRAMES_BLOCK_MAX, BEWEGUNG_SCHWELLE_ANTEIL } from './style.js';

const FPS = 30;
const H = 1.8;   // Körperhöhe des Prüfrigs

// ── Festes Prüf-Rig ──────────────────────────────────────────────────────────

const RIG = {
  schemaVersion: 1,
  world: { height: H, groundY: 0, up: 'y' },
  roles: { pelvis: { bone: 'pelvis' } },
  segments: [],
  soles: [],
  params: {},
};

const frame = (bones, extra = {}) => ({ bones, ...extra });

/** Kontinuierliche Handbewegung: 60 Frames, hand_r wandert gleichmäßig und
 *  beschleunigt weich. Positivfall für alle drei Prüfungen. */
const weicheBewegung = () => Array.from({ length: 60 }, (_, i) =>
  frame({ hand_r: [0.3 + 0.03 * i, 1.0 + Math.sin(i / 5) * 0.10, 0] }));

// ── 1. Bewegungsdichte ───────────────────────────────────────────────────────

test('Bewegungsdichte: 22 tote Frames werden beanstandet (Negativfall Abnahmetabelle)', () => {
  // 45 bewegte + 22 tote Frames: der Test-B-Fall aus der Abnahmetabelle —
  // ein Drittel der Timeline bewegtlos AM STÜCK.
  const frames = Array.from({ length: 67 }, (_, i) =>
    frame({ hand_r: [0.3, i < 45 ? 1.0 + 0.05 * ((i % 5) - 2) : 1.0, 0] }));
  const r = pruefeStil(RIG, frames, FPS, {});
  const dichte = r.issues.find((i) => i.kind === 'bewegungsdichte');
  assert.ok(dichte, 'Bewegungsdichte wird beanstandet');
  assert.equal(r.passed, false);
  assert.match(dichte.message, /\d/);
  assert.ok(Array.isArray(dichte.frames), 'die toten Frames werden gemeldet');
});

test('Bewegungsdichte: 22 verstreute tote Frames mit Atmung dazwischen bleiben still (idle-Verhalten)', () => {
  // Konstruktion wie das Referenz-Verhalten von idle: toteFrames einzeln
  // verstreut, dazwischen Bewegung. Der längste tote Block bleibt unter der
  // Block-Schwelle, der Anteil bewegter Frames deutlich über DICHTE_MIN.
  const frames = Array.from({ length: 76 }, (_, i) => {
    const atmet = (i % 4 === 0) ? 0 : 0.01 * Math.sin(i / 3);   // meist Bewegung
    return frame({ hand_r: [0.3, 1.0 + atmet, 0] });
  });
  const r = pruefeStil(RIG, frames, FPS, {});
  assert.equal(r.issues.filter((i) => i.kind === 'bewegungsdichte').length, 0,
    `verstreutes Atmen darf nicht beanstandet werden: ${JSON.stringify(r.issues)}`);
});

test('Bewegungsdichte: gleichmäßige Bewegung löst nichts aus (Positivfall Referenzclip-Verhalten)', () => {
  const r = pruefeStil(RIG, weicheBewegung(), FPS, {});
  assert.equal(r.issues.filter((i) => i.kind === 'bewegungsdichte').length, 0);
});

test('Bewegungsdichte: eine bewegungslose Timeline fällt durch', () => {
  const frames = Array.from({ length: 60 }, () =>
    frame({ hand_r: [0.30, 1.00, 0] }));
  const r = pruefeStil(RIG, frames, FPS, {});
  assert.equal(r.passed, false);
  const dichte = r.issues.find((i) => i.kind === 'bewegungsdichte');
  assert.ok(dichte);
  assert.match(dichte.message, /0 %/);
});

test('Bewegungsdichte: Frames in einer erklärten Halt-Phase zählen nicht als tote Frames', () => {
  // 30 bewegte + 25 tote Frames, aber die 25 toten sind ein erklärter Halt.
  const frames = Array.from({ length: 55 }, (_, i) =>
    frame({ hand_r: [0.3, i < 30 ? 1.0 + 0.05 * Math.sin(i / 3) : 1.0, 0] }));
  const mitAusnahme = pruefeStil(RIG, frames, FPS, {
    ausnahmen: [{ von: 30, bis: 54, art: 'halt', grund: 'bewusster Stillstand vor dem nächsten Schritt' }],
  });
  assert.equal(mitAusnahme.issues.filter((i) => i.kind === 'bewegungsdichte').length, 0);
  // Dieselbe Timeline ohne die Ausnahme wird beanstandet.
  const ohne = pruefeStil(RIG, frames, FPS, {});
  assert.ok(ohne.issues.some((i) => i.kind === 'bewegungsdichte'));
});

// ── 1b. Die Dichteschwelle selbst ────────────────────────────────────────────

test('Bewegungsdichte: dünne, gleichmäßig verteilte Bewegung fällt allein durch DICHTE_MIN', () => {
  // Der Fall, den sonst nichts fängt: 61 Frames, in jedem sechsten ein Schritt
  // von 1,1 % Körperhöhe. Nichts ballt sich — der längste tote Block ist 5
  // Frames, jeder Schritt ist nur das 1,1-Fache des Medians seiner Nachbarn
  // (Grenze 8), und ohne benannte Hauptbewegung fällt die Antizipationsprüfung
  // weg. Die Dichte liegt bei 10/60 = 0,167: zwischen 0 und DICHTE_MIN.
  // Beanstandet wird dieser Clip ausschließlich, weil die Schwelle steht.
  const SCHRITT_ALLE = 6;
  const schrittM = 0.011 * H;
  assert.ok(schrittM > BEWEGUNG_SCHWELLE_ANTEIL * H,
    `Schritt ${schrittM} m muss über der Bewegungsschwelle von ${(BEWEGUNG_SCHWELLE_ANTEIL * H).toFixed(5)} m liegen, sonst zählen die Frames als tot`);

  const frames = Array.from({ length: 61 }, (_, i) =>
    frame({ hand_r: [0.3, 1.0 + schrittM * Math.floor(i / SCHRITT_ALLE), 0] }));
  const r = pruefeStil(RIG, frames, FPS, {});

  assert.equal(r.issues.length, 1,
    `nur die Bewegungsdichte meldet, gemeldet wurden: ${JSON.stringify(r.issues)}`);
  const dichte = r.issues.find((i) => i.kind === 'bewegungsdichte');
  assert.ok(dichte, `dünne Bewegung wird beanstandet — bei DICHTE_MIN = ${DICHTE_MIN} fällt der Fall durch`);

  // Der Grund ist die Schwelle und nichts anderes: die gemessene Dichte liegt
  // über 0 (es ist Bewegung vorhanden) und unter DICHTE_MIN, und der gemeldete
  // längste tote Block bleibt innerhalb der Blockgrenze.
  assert.ok(dichte.value > 0, `gemessene Dichte ${dichte.value} > 0: die Timeline ist nicht bewegungslos`);
  assert.ok(dichte.value < DICHTE_MIN,
    `gemessene Dichte ${dichte.value} liegt unter der Schwelle ${DICHTE_MIN} — nur deshalb wird beanstandet`);
  const langsterBlock = Number(dichte.message.match(/längster Block (\d+)/)?.[1]);
  assert.ok(langsterBlock <= TOTE_FRAMES_BLOCK_MAX,
    `längster toter Block ${langsterBlock} Frames bleibt unter der Grenze ${TOTE_FRAMES_BLOCK_MAX}: die Blockregel ist nicht der Grund`);
  assert.match(dichte.message, /\d/, 'die Meldung nennt Zahlen');
});

// ── 2. Antizipation ──────────────────────────────────────────────────────────

test('Antizipation: das Handgelenk senkt sich vor dem Sprung (Positivfall Referenzsprung)', () => {
  // Konstruktion: Frames 0–9 senkt sich die Hand um 0,05 Körperhöhen,
  // ab Frame 10 springt sie hoch.
  const frames = Array.from({ length: 40 }, (_, i) =>
    frame({ hand_r: [0.3, i < 10 ? 1.2 - 0.02 * i : 1.0 + 0.08 * (i - 10), 0] }));
  const r = pruefeStil(RIG, frames, FPS, {
    hauptbewegung: { part: 'hand_r', abFrame: 10, richtung: [0, 1, 0] },
  });
  assert.equal(r.issues.filter((i) => i.kind === 'antizipation').length, 0,
    JSON.stringify(r.issues));
  assert.equal(r.passed, true);
});

test('Antizipation: ein Sprung ohne Absenken wird beanstandet (Negativfall)', () => {
  const frames = Array.from({ length: 40 }, (_, i) =>
    frame({ hand_r: [0.3, i < 10 ? 1.0 : 1.0 + 0.08 * (i - 10), 0] }));
  const r = pruefeStil(RIG, frames, FPS, {
    hauptbewegung: { part: 'hand_r', abFrame: 10, richtung: [0, 1, 0] },
  });
  const ant = r.issues.find((i) => i.kind === 'antizipation');
  assert.ok(ant, 'Antizipation wird beanstandet');
  assert.equal(r.passed, false);
  assert.match(ant.message, /\d/);
});


// ── 3. Ruckfreiheit ──────────────────────────────────────────────────────────

test('Ruck: gleichmäßige Bewegung ohne Sprung besteht (Positivfall Referenzclip)', () => {
  const r = pruefeStil(RIG, weicheBewegung(), FPS, {});
  assert.equal(r.issues.filter((i) => i.kind === 'ruck').length, 0);
});

test('Ruck: ein eingefügter Positionssprung wird beanstandet (Negativfall)', () => {
  const frames = weicheBewegung();
  frames[30] = { bones: { hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] } };
  const r = pruefeStil(RIG, frames, FPS, {});
  const ruck = r.issues.filter((i) => i.kind === 'ruck');
  assert.ok(ruck.length >= 1, `Positionssprung wird beanstandet: ${JSON.stringify(r.issues)}`);
  assert.equal(r.passed, false);
  for (const i of ruck) {
    assert.match(i.message, /\d/);
    assert.match(i.message, /Frame \d+/);
  }
});

test('Ruck: derselbe Sprung mit erklärtem Aufprall wird nicht beanstandet (Ausnahme plan.md 6.6)', () => {
  const frames = weicheBewegung();
  frames[30] = { bones: { hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] } };
  const r = pruefeStil(RIG, frames, FPS, {
    ausnahmen: [{ von: 29, bis: 32, art: 'impact', grund: 'Aufprall nach dem Sturz' }],
  });
  assert.equal(r.issues.filter((i) => i.kind === 'ruck').length, 0);
  assert.equal(r.passed, true);
});

test('Ruck: eine Ausnahme ohne Grund wird abgelehnt (Ausnahmen müssen erklärt werden)', () => {
  const frames = weicheBewegung();
  assert.throws(
    () => pruefeStil(RIG, frames, FPS, { ausnahmen: [{ von: 29, bis: 32, art: 'impact' }] }),
    /ohne grund/);
});

test('Ruck: eine Ausnahme mit falschem Art-Wert wird abgelehnt', () => {
  const frames = weicheBewegung();
  assert.throws(
    () => pruefeStil(RIG, frames, FPS, { ausnahmen: [{ von: 29, bis: 32, art: 'wunder', grund: 'x' }] }),
    /art = "wunder"/);
});

// ── Eingabeprüfung ───────────────────────────────────────────────────────────

test('fehlende Körperhöhe im Profil wird abgelehnt', () => {
  const frames = weicheBewegung();
  assert.throws(
    () => pruefeStil({ ...RIG, world: { ...RIG.world, height: 0 } }, frames, FPS, {}),
    /world\.height = 0/);
});

test('fehlende Framerate wird mit Zahl abgelehnt', () => {
  const frames = weicheBewegung();
  assert.throws(() => pruefeStil(RIG, frames, undefined, {}), /fps = undefined/);
});

test('leere Frame-Liste wird mit Zahl abgelehnt', () => {
  assert.throws(() => pruefeStil(RIG, [], FPS, {}), /frames = leeres Array/);
});

test('Frame ohne Knochen-Feld wird abgelehnt', () => {
  assert.throws(
    () => pruefeStil(RIG, [ { com: [0, 1, 0] }, frame({ hand_r: [0.3, 1.0, 0] }) ], FPS, {}),
    /frames\[0\]\.bones fehlt/);
});

// ── Referenzclips ────────────────────────────────────────────────────────────
// Die echten Clips können hier nicht geprüft werden: das Sampling braucht
// three.js mit dem Xbot-Modell, also die Entwicklungs-Skripte. Das wird im
// separaten Clip-Test erledigt (spikes/tmp-ap6-probe.mjs als Vorlage) und
// beim Abnahmelauf mit allen sieben Clips wiederholt. Hier bleibt das
// Konstrukt-Negativ- und -Positivmaterial.