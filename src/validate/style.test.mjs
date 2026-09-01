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
// Clip-Test geprüft (siehe am Ende dieser Datei und im Spike-Aufruf).
//
// ZWEITER STRANG (Auftrag "Drei Nahtstellen", Punkt 3): jeder Befund nennt
// einen Ort. Geprüft wird deshalb in jede Richtung — der gemeldete Frame ist
// der gemessene (er wandert mit, wenn die Bewegung wandert), und ein Befund
// ohne Ort wird vom Vertragsprüfer abgelehnt. Die Frames der Befunde werden
// gegen die Rahmenbedingungen gemessen: ganzzahlig, >= 0, innerhalb der
// Timeline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeStil, KOERPER, DICHTE_MIN, TOTE_FRAMES_BLOCK_MAX, BEWEGUNG_SCHWELLE_ANTEIL } from './style.js';
import { validateValidationReport } from '../contracts/validation-report.js';

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

// Ein gelöster Frame trägt seine Knochendaten in `positions` — dasselbe Feld
// wie in src/validate/physics.js (Entscheidung Punkt 2).
const frame = (positionen, extra = {}) => ({ positions: positionen, ...extra });

/** Kontinuierliche Handbewegung: 60 Frames, hand_r wandert gleichmäßig und
 *  beschleunigt weich. Positivfall für alle drei Prüfungen. */
const weicheBewegung = () => Array.from({ length: 60 }, (_, i) =>
  frame({ hand_r: [0.3 + 0.03 * i, 1.0 + Math.sin(i / 5) * 0.10, 0] }));

/**
 * Treppen-Timeline: Abschnitte aus Bewegung und Stillstand.
 * abschnitte: [{ von, bis, bewegt }] — `bis` ist der letzte Frame des
 * Abschnitts. Ein bewegter Abschnitt hebt die Hand um `schritt` m je Frame, ein
 * toter lässt sie stehen — die Frames eines toten Abschnitts sind damit
 * gemessen bewegungslos (ihre Positionsänderung gegenüber dem Vorgänger ist 0).
 */
function treppe(n, abschnitte, schritt = 0.05) {
  let y = 1.0;
  return Array.from({ length: n }, (_, i) => {
    const a = abschnitte.find((s) => i >= s.von && i <= s.bis);
    assert.ok(a, `Frame ${i} liegt in keinem Abschnitt bis ${n - 1}`);
    if (a.bewegt && i > 0) y += schritt;
    return frame({ hand_r: [0.3, y, 0] });
  });
}

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
  // Der längste (einzige) tote Block beginnt bei Frame 1: ab Frame 1 hat sich
  // nichts mehr bewegt — hingeschaut werden kann aber schon ab Frame 0, deshalb
  // meldet die Prüfung den ersten toten Frame des Blocks.
  assert.equal(dichte.frame, 1, `gemeldeter Frame: ${dichte.frame}`);
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

// ── 1c. Der Ort des Dichtebefunds ────────────────────────────────────────────

/**
 * Zwei tote Blöcke verschiedener Länge: 60 Frames, bewegt in 0..4 und 15..19
 * und 45..59, tot in 5..14 (10 Frames) und 20..44 (25 Frames). Der längste
 * Block ist der zweite, sein erster Frame ist 20.
 */
const ZWEI_BLOCKE = [
  { von: 0, bis: 4, bewegt: true },
  { von: 5, bis: 14, bewegt: false },
  { von: 15, bis: 19, bewegt: true },
  { von: 20, bis: 44, bewegt: false },
  { von: 45, bis: 59, bewegt: true },
];

test('Bewegungsdichte: gemeldet wird der erste Frame des längsten toten Blocks', () => {
  const frames = treppe(60, ZWEI_BLOCKE);
  const r = pruefeStil(RIG, frames, FPS, {});
  assert.equal(r.issues.length, 1, `nur die Bewegungsdichte meldet: ${JSON.stringify(r.issues)}`);
  const dichte = r.issues[0];
  assert.equal(dichte.kind, 'bewegungsdichte');
  // Erwartet 20, geliefert:
  assert.equal(dichte.frame, 20,
    'der gemeldete Frame muss der erste Frame des 25 Frames langen Blocks sein');
  assert.equal(dichte.part, KOERPER, 'über den ganzen Körper, nicht über einen Knochen');
  assert.match(dichte.message, /ab Frame 20/, 'die Meldung nennt denselben Frame wie das Feld');
});

test('Negativfall zum Befundort: wandert der längste Block, wandert der Frame mit', () => {
  // Derselbe Aufbau, aber der LANGE Block liegt vorn (10..34, 25 Frames) und
  // der kurze hinten (40..48, 9 Frames). Wäre der Frame hartgeschrieben oder
  // nur "irgendein toter Frame", fiele dieser Test auf einen anderen Wert.
  const frames = treppe(60, [
    { von: 0, bis: 9, bewegt: true },
    { von: 10, bis: 34, bewegt: false },
    { von: 35, bis: 39, bewegt: true },
    { von: 40, bis: 48, bewegt: false },
    { von: 49, bis: 59, bewegt: true },
  ]);
  const r = pruefeStil(RIG, frames, FPS, {});
  assert.equal(r.issues.length, 1, JSON.stringify(r.issues));
  assert.equal(r.issues[0].frame, 10,
    `erwartet 10 (Anfang des langen Blocks), geliefert ${r.issues[0].frame}`);
});

test('Bewegungsdichte: eine Timeline aus einem Frame meldet Frame 0', () => {
  // 1 Frame heißt 0 Vergleiche: es hat nichts gemessen Bewegung stattgefunden.
  // Der einzige Bewegungsverlust dieser Timeline liegt bei Frame 0 — das ist
  // abgelesen, nicht erfunden, und die Meldung sagt die Zahl der Vergleiche.
  const r = pruefeStil(RIG, [frame({ hand_r: [0.3, 1.0, 0] })], FPS, {});
  const dichte = r.issues.find((i) => i.kind === 'bewegungsdichte');
  assert.ok(dichte, 'eine Timeline ohne Vergleich ist keine Bewegung');
  assert.equal(dichte.frame, 0);
  assert.equal(dichte.part, KOERPER);
  assert.match(dichte.message, /Frame 0 und 0/);
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
  // Der Ort des Befunds ist der Frame der Hauptbewegung, vor dem die
  // Gegenbewegung fehlt — die Prüfung kannte ihn schon für das Fenster davor.
  assert.equal(ant.frame, 10, `erwartet 10, geliefert ${ant.frame}`);
  assert.equal(ant.part, KOERPER);
  assert.ok(ant.von <= ant.frame && ant.bis >= ant.frame,
    `der gemessene Bereich ${ant.von}..${ant.bis} muss den Befundframe ${ant.frame} enthalten`);
});

test('Antizipation, Negativfall zum Befundort: zwei Frames später springen, zwei Frames später melden', () => {
  // Dasselbe Konstrukt mit abFrame 12: der gemeldete Frame folgt der Angabe,
  // er steht nicht fest.
  const frames = Array.from({ length: 40 }, (_, i) =>
    frame({ hand_r: [0.3, i < 12 ? 1.0 : 1.0 + 0.08 * (i - 12), 0] }));
  const r = pruefeStil(RIG, frames, FPS, {
    hauptbewegung: { part: 'hand_r', abFrame: 12, richtung: [0, 1, 0] },
  });
  const ant = r.issues.find((i) => i.kind === 'antizipation');
  assert.ok(ant, 'Antizipation wird beanstandet');
  assert.equal(ant.frame, 12, `erwartet 12, geliefert ${ant.frame}`);
});

// ── 3. Ruckfreiheit ──────────────────────────────────────────────────────────

test('Ruck: gleichmäßige Bewegung ohne Sprung besteht (Positivfall Referenzclip)', () => {
  const r = pruefeStil(RIG, weicheBewegung(), FPS, {});
  assert.equal(r.issues.filter((i) => i.kind === 'ruck').length, 0);
});

test('Ruck: ein eingefügter Positionssprung wird beanstandet (Negativfall)', () => {
  const frames = weicheBewegung();
  frames[30] = frame({ hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] });
  const r = pruefeStil(RIG, frames, FPS, {});
  const ruck = r.issues.filter((i) => i.kind === 'ruck');
  assert.ok(ruck.length >= 1, `Positionssprung wird beanstandet: ${JSON.stringify(r.issues)}`);
  assert.equal(r.passed, false);
  for (const i of ruck) {
    assert.match(i.message, /\d/);
    assert.match(i.message, /Frame \d+/);
    // Das Datenfeld ist die Wahrheit, nicht die Prosa: steht die Frame-Zahl im
    // Text, muss sie im Feld stehen — und umgekehrt.
    const imText = Number(i.message.match(/bei Frame (\d+)/)?.[1]);
    assert.equal(i.frame, imText,
      `frame-Feld ${i.frame} und Meldungstext "Frame ${imText}" widersprechen sich`);
    assert.equal(i.part, 'hand_r', 'der Ruck geschieht an einem Knochen, der wird genannt');
  }
  assert.ok(ruck.every((i) => i.frame === 30 || i.frame === 31),
    `der Sprung sitzt bei Frame 30, gemeldet: ${ruck.map((i) => i.frame)}`);
});

test('Ruck, Negativfall zum Befundort: der Sprung bei Frame 45 meldet Frame 45', () => {
  const frames = weicheBewegung();
  frames[45] = frame({ hand_r: [0.3 + 0.03 * 45 + 0.5, 1.0 + Math.sin(45 / 5) * 0.10, 0] });
  const r = pruefeStil(RIG, frames, FPS, {});
  const ruck = r.issues.filter((i) => i.kind === 'ruck');
  assert.ok(ruck.length >= 1, JSON.stringify(r.issues));
  assert.ok(ruck.some((i) => i.frame === 45),
    `erwartet einen Befund bei Frame 45, geliefert: ${ruck.map((i) => i.frame).join(', ')}`);
  assert.ok(ruck.every((i) => !/bei Frame 30\b/.test(i.message)),
    'ein Sprung bei 45 darf nicht bei 30 gemeldet werden');
});

test('Ruck: derselbe Sprung mit erklärtem Aufprall wird nicht beanstandet (Ausnahme plan.md 6.6)', () => {
  const frames = weicheBewegung();
  frames[30] = frame({ hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] });
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

test('Frame ohne Knochentabelle wird abgelehnt', () => {
  // Der Feldname ist `positions` — dasselbe Feld, das physics.js liest. Ein
  // Frame, der seine Knochendaten unter `bones` anliefert (die alte Bauform),
  // wird NICHT stillschweigend gelesen.
  assert.throws(
    () => pruefeStil(RIG, [{ com: [0, 1, 0] }, frame({ hand_r: [0.3, 1.0, 0] })], FPS, {}),
    /frames\[0\]\.positions fehlt/);
  assert.throws(
    () => pruefeStil(RIG, [{ bones: { hand_r: [0.3, 1.0, 0] } }, frame({ hand_r: [0.3, 1.0, 0] })], FPS, {}),
    /frames\[0\]\.positions fehlt/);
});

// ── Befundorte und Vertrag (Auftrag "Drei Nahtstellen", Punkt 3) ─────────────

/** Je einer der drei Befunde, aus konstruierten Timelines — die Ruckprüfung
 *  meldet pro Sprung zwei Frames, hier zählt einer je Art. */
function alleDreiBefunde() {
  const einer = (r, kind) => {
    const i = r.issues.find((x) => x.kind === kind);
    assert.ok(i, `${kind} wurde nicht gemeldet: ${JSON.stringify(r.issues)}`);
    return i;
  };
  return [
    einer(pruefeStil(RIG, treppe(60, ZWEI_BLOCKE), FPS, {}), 'bewegungsdichte'),
    einer(pruefeStil(RIG, Array.from({ length: 40 }, (_, i) =>
      frame({ hand_r: [0.3, i < 10 ? 1.0 : 1.0 + 0.08 * (i - 10), 0] })), FPS,
      { hauptbewegung: { part: 'hand_r', abFrame: 10, richtung: [0, 1, 0] } }), 'antizipation'),
    einer(pruefeStil(RIG, (() => {
      const f = weicheBewegung();
      f[30] = frame({ hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] });
      return f;
    })(), FPS, {}), 'ruck'),
  ];
}

test('Jeder Stilbefund nennt frame und part — und der Frame liegt in der Timeline', () => {
  const beispiele = [
    ['bewegungsdichte', treppe(60, ZWEI_BLOCKE), {}],
    ['antizipation', Array.from({ length: 40 }, (_, i) =>
      frame({ hand_r: [0.3, i < 10 ? 1.0 : 1.0 + 0.08 * (i - 10), 0] })),
      { hauptbewegung: { part: 'hand_r', abFrame: 10, richtung: [0, 1, 0] } }],
    ['ruck', (() => {
      const f = weicheBewegung();
      f[30] = frame({ hand_r: [0.3 + 0.03 * 30 + 0.5, 1.0 + Math.sin(30 / 5) * 0.10, 0] });
      return f;
    })(), {}],
  ];
  for (const [kind, frames, options] of beispiele) {
    const r = pruefeStil(RIG, frames, FPS, options);
    const betreffende = r.issues.filter((i) => i.kind === kind);
    assert.ok(betreffende.length >= 1, `${kind}: nichts gemeldet, erwartet mindestens 1 Befund`);
    for (const i of betreffende) {
      assert.ok(Number.isInteger(i.frame) && i.frame >= 0,
        `${kind}: frame = ${JSON.stringify(i.frame)}: erwartet ganze Zahl >= 0`);
      assert.ok(i.frame < frames.length,
        `${kind}: frame ${i.frame} liegt außerhalb der Timeline von 0 bis ${frames.length - 1}`);
      assert.equal(typeof i.part, 'string');
      assert.ok(i.part.length > 0, `${kind}: part fehlt — der Befund nennt kein Wovon`);
    }
  }
});

/** Ein Bericht mit den Stilbefunden, sonst die leeren übrigen Schichten. */
const berichtMitStil = (issues, frameCount = 60) => ({
  frameCount,
  phases: [{ state: 'kontakt', from: 0, to: frameCount }],
  physics: { passed: true, issues: [] },
  intent: { passed: true, checks: [] },
  style: { passed: issues.length === 0, issues },
  images: [{ view: 'side', frames: issues.map((i) => i.frame).filter(Number.isInteger), ref: 'strip://test' }],
});

test('Abnahme 2: ein Bericht mit allen drei Stilbefunden besteht den Vertragsprüfer', () => {
  const issues = alleDreiBefunde();
  assert.equal(issues.length, 3, `drei Befunde erwartet, geliefert ${issues.length}: ${JSON.stringify(issues)}`);
  assert.deepEqual(issues.map((i) => i.kind), ['bewegungsdichte', 'antizipation', 'ruck']);
  const pruefung = validateValidationReport(berichtMitStil(issues));
  assert.deepStrictEqual(pruefung.errors, [], 'der Vertragsprüfer lehnt die Stilbefunde ab');
  assert.equal(pruefung.ok, true);
});

test('Abnahme 3, Negativfall: ein Ruckbefund ohne frame wird vom Vertrag abgelehnt', () => {
  const issues = alleDreiBefunde();
  const ohneFrame = issues.map((i) => {
    if (i.kind !== 'ruck') return i;
    const { frame, ...rest } = i;      // das Datenfeld abnehmen, der Text bleibt
    return rest;
  });
  const pruefung = validateValidationReport(berichtMitStil(ohneFrame));
  assert.equal(pruefung.ok, false,
    'ein Befund ohne Ort darf nicht durchgehen — sonst ist die Prüfung umgangen');
  assert.ok(pruefung.errors.some((e) => /\.frame$/.test(e.field)),
    `kein Fehler auf einem frame-Feld: ${JSON.stringify(pruefung.errors)}`);
  assert.ok(pruefung.errors.some((e) => /\d/.test(e.message)),
    'die Fehlermeldung des Vertrags nennt eine Zahl');
});

test('Abnahme 3, zweiter Negativfall: ein Stilbefund ohne jeden Ort wird abgelehnt', () => {
  // Bewusst ortslos: weder frame noch frames noch von/bis. Genau die Sorte
  // Meldung, gegen die dieses Projekt gebaut ist.
  const ortslos = {
    kind: 'bewegungsdichte', value: 0.1, unit: 'anteil', part: KOERPER,
    message: 'nur 10 % der Frames enthalten Bewegung',
  };
  const pruefung = validateValidationReport(berichtMitStil([ortslos]));
  assert.equal(pruefung.ok, false);
  assert.ok(pruefung.errors.some((e) => /frame|frames|von|bis/.test(e.field + e.message)),
    `kein Hinweis auf den fehlenden Ort: ${JSON.stringify(pruefung.errors)}`);
  // Derselbe Befund MIT Ort geht durch — der Fall prüft also die Ortsregel und
  // nicht irgendetwas anderes am Objekt.
  const mitOrt = { ...ortslos, frame: 20, frames: [20, 21], von: 20, bis: 44 };
  assert.equal(validateValidationReport(berichtMitStil([mitOrt])).ok, true);
});

test('Abnahme 3, dritter Negativfall: ein Teilbefund ohne part wird abgelehnt', () => {
  const issues = alleDreiBefunde();
  const ohnePart = issues.map(({ part, ...rest }) => rest);
  const pruefung = validateValidationReport(berichtMitStil(ohnePart));
  assert.equal(pruefung.ok, false,
    `Befunde ohne part wurden akzeptiert: ${JSON.stringify(ohnePart)}`);
  assert.ok(pruefung.errors.some((e) => /\.part$/.test(e.field)),
    `kein Fehler auf einem part-Feld: ${JSON.stringify(pruefung.errors)}`);
});

test('Kreuzbedingung des Vertrags: Befunde und passed true schließen sich aus', () => {
  const issues = alleDreiBefunde();
  const pruefung = validateValidationReport({ ...berichtMitStil(issues), style: { passed: true, issues } });
  assert.equal(pruefung.ok, false);
  assert.ok(pruefung.errors.some((e) => e.field === 'style.passed'),
    JSON.stringify(pruefung.errors));
});

// ── Referenzclips ────────────────────────────────────────────────────────────
// Die echten Clips können hier nicht geprüft werden: das Sampling braucht
// three.js mit dem Xbot-Modell, also die Entwicklungs-Skripte. Das wird im
// separaten Clip-Test erledigt (spikes/tmp-ap6-probe.mjs als Vorlage) und
// beim Abnahmelauf mit allen sieben Clips wiederholt. Hier bleibt das
// Konstrukt-Negativ- und -Positivmaterial.
