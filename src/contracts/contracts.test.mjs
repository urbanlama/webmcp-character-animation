// Abnahme AP1 — Datenverträge.
//
// Jedes Format wird gegen zwei Beispiele geprüft: ein gültiges, das angenommen
// werden muss, und ein absichtlich kaputtes, das abgelehnt werden muss. Der
// Negativfall prüft zusätzlich, WELCHES Feld beanstandet wird — ein Test, der
// nur "wurde abgelehnt" feststellt, würde auch bei einem Prüfer grün, der alles
// ablehnt.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateRigProfile } from './rig-profile.js';
import { validateTimeline } from './timeline.js';
import { validateValidationReport } from './validation-report.js';

const hier = dirname(fileURLToPath(import.meta.url));
const beispiele = join(hier, '..', '..', 'samples', 'contracts');

const lies = (name) => JSON.parse(readFileSync(join(beispiele, name), 'utf8'));

// Je Format: Prüffunktion, Dateipräfix und das Feld, das der kaputte Fall
// beanstanden muss.
const formate = [
  { name: 'RigProfile', pruefe: validateRigProfile, datei: 'rig-profile', feld: 'roles.foot_r' },
  { name: 'Timeline', pruefe: validateTimeline, datei: 'timeline', feld: 'phases.4.to' },
  { name: 'ValidationReport', pruefe: validateValidationReport, datei: 'validation-report', feld: 'physics.passed' },
];

for (const { name, pruefe, datei, feld } of formate) {
  test(`${name}: gültiges Beispiel wird angenommen`, () => {
    const ergebnis = pruefe(lies(`${datei}.gueltig.json`));
    assert.deepStrictEqual(
      ergebnis.errors, [],
      `${name} lehnt sein eigenes gültiges Beispiel ab: ${JSON.stringify(ergebnis.errors)}`
    );
    assert.strictEqual(ergebnis.ok, true);
  });

  test(`${name}: kaputtes Beispiel wird abgelehnt, mit benanntem Feld`, () => {
    const ergebnis = pruefe(lies(`${datei}.kaputt.json`));
    assert.strictEqual(ergebnis.ok, false, `${name} nimmt sein kaputtes Beispiel an`);

    const felder = ergebnis.errors.map((e) => e.field);
    assert.ok(
      felder.includes(feld),
      `${name} beanstandet ${JSON.stringify(felder)}, erwartet war ${feld}`
    );
  });

  test(`${name}: jede Meldung nennt Feld und Grund`, () => {
    for (const e of pruefe(lies(`${datei}.kaputt.json`)).errors) {
      assert.ok(e.field && e.field.length > 0, `Meldung ohne Feldangabe: ${JSON.stringify(e)}`);
      assert.ok(
        e.message && e.message.includes(e.field),
        `Meldung nennt ihr eigenes Feld nicht: ${JSON.stringify(e)}`
      );
    }
  });
}

// Der Negativfall des Testaufbaus selbst: Ein leeres Objekt ist für jedes der
// drei Formate ungültig. Läuft diese Prüfung grün durch, obwohl der Prüfer
// nichts beanstandet, ist der Prüfer kaputt und nicht die Eingabe.
test('leeres Objekt wird von jedem Format abgelehnt', () => {
  for (const { name, pruefe } of formate) {
    const ergebnis = pruefe({});
    assert.strictEqual(ergebnis.ok, false, `${name} nimmt ein leeres Objekt an`);
    assert.ok(ergebnis.errors.length > 0, `${name} lehnt ab, ohne einen Grund zu nennen`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Befunde nach Ort: Punktbefunde brauchen frame UND part, schichtweite dürfen
// beides weglassen, müssen aber einen Bereich nennen. Zu jedem Positivfall der
// Negativfall (AGENTS.md, Regel 2) — die Lockerung ohne ihren Negativfall wäre
// keine Lockerung, sondern die Abschaffung der Prüfung.
// ─────────────────────────────────────────────────────────────────────────────

/** Bericht mit genau einem Stilbefund, damit jede Regel einzeln prüfbar ist. */
function berichtMitBefund(befund) {
  return {
    frameCount: 90,
    phases: [{ state: 'kontakt', from: 0, to: 90 }],
    physics: { passed: true, issues: [] },
    intent: { passed: true, checks: [] },
    style: { passed: false, issues: [befund] },
    images: [{ view: 'side', frames: [0, 45], ref: 'strip_side_0-45.png' }],
  };
}

const constGrund = {
  value: 0.31, unit: 'anteil', message: 'nur 31 % der Frames enthalten Bewegung',
};

test('Punktbefund: frame und part werden angenommen', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'boden', frame: 34, part: 'foot_r', value: 0.048, unit: 'm',
    message: 'foot_r steckt 4,8 cm im Boden',
  }));
  assert.deepStrictEqual(r.errors, [], JSON.stringify(r.errors));
  assert.equal(r.ok, true);
});

test('Negativfall Punktbefund: ein boden-Befund ohne frame wird abgelehnt', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'boden', part: 'foot_r', value: 0.048, unit: 'm',
    message: 'foot_r steckt 4,8 cm im Boden',
  }));
  assert.equal(r.ok, false, 'ein Punktbefund ohne Frame darf nicht durchgehen');
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.frame'),
    `beanstandete Felder: ${JSON.stringify(r.errors.map((e) => e.field))}`);
  assert.ok(r.errors.some((e) => /\d/.test(e.message)),
    'die Meldung nennt eine Zahl');
});

test('Negativfall Punktbefund: ein boden-Befund ohne part wird abgelehnt', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'boden', frame: 34, value: 0.048, unit: 'm',
    message: 'foot_r steckt 4,8 cm im Boden',
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.part'),
    `beanstandete Felder: ${JSON.stringify(r.errors.map((e) => e.field))}`);
});

test('ruck ist Punktbefund: sein Frame gehört ins Datenfeld, nicht in die Prosa', () => {
  const mitFrame = validateValidationReport(berichtMitBefund({
    kind: 'ruck', frame: 30, part: 'hand_r', value: 41.2, unit: 'verhaeltnis',
    message: 'hand_r verschiebt sich bei Frame 30 um 50,0 cm',
  }));
  assert.equal(mitFrame.ok, true, JSON.stringify(mitFrame.errors));

  // Der alte Zustand aus src/validate/style.js: die Zahl stand nur im Text.
  const nurText = validateValidationReport(berichtMitBefund({
    kind: 'ruck', part: 'hand_r', value: 41.2, unit: 'verhaeltnis',
    message: 'hand_r verschiebt sich bei Frame 30 um 50,0 cm',
  }));
  assert.equal(nurText.ok, false,
    'ein ruck-Befund ohne frame-Feld darf weiterhin nicht durchgehen');
  assert.ok(nurText.errors.some((e) => e.field === 'style.issues.0.frame'));
});

test('schichtweiter Befund: ohne frame und part, aber mit frames-Liste wird angenommen', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'bewegungsdichte', ...constGrund, frames: [45, 46, 47],
  }));
  assert.deepStrictEqual(r.errors, [], JSON.stringify(r.errors));
  assert.equal(r.ok, true);
});

test('schichtweiter Befund: mit Bereich von/bis wird angenommen', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'antizipation', value: 0.004, unit: 'koerperhoehen',
    message: 'keine Gegenbewegung vor Frame 10', von: 4, bis: 10,
  }));
  assert.deepStrictEqual(r.errors, [], JSON.stringify(r.errors));
  assert.equal(r.ok, true);
});

test('Negativfall Schichtbefund: ohne jede Ortsangabe wird er abgelehnt', () => {
  // Weder frames noch von/bis noch frame — die Lockerung darf keinen
  // ortslosen Befund durchlassen.
  const r = validateValidationReport(berichtMitBefund({
    kind: 'bewegungsdichte', ...constGrund,
  }));
  assert.equal(r.ok, false,
    'ein schichtweiter Befund ohne Bereichsangabe wurde angenommen — die Prüfung ist abgeschafft, nicht gelockert');
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.frames'),
    `beanstandete Felder: ${JSON.stringify(r.errors.map((e) => e.field))}`);
  assert.ok(r.errors.some((e) => e.message.includes('0 Frames')),
    `die Meldung nennt die Zahl 0: ${JSON.stringify(r.errors)}`);
});

test('Negativfall Schichtbefund: eine leere frames-Liste ist keine Ortsangabe', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'bewegungsdichte', ...constGrund, frames: [],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.frames'));
});

test('Schichtbefund mit Bereich: bis vor von wird abgelehnt', () => {
  const r = validateValidationReport(berichtMitBefund({
    kind: 'antizipation', value: 0.004, unit: 'koerperhoehen',
    message: 'keine Gegenbewegung vor Frame 10', von: 10, bis: 4,
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.bis' && /\d/.test(e.message)),
    `beanstandete Felder: ${JSON.stringify(r.errors)}`);
});

test('Schichtbefund darf frame und part trotzdem tragen — dann müssen sie stimmen', () => {
  const gut = validateValidationReport(berichtMitBefund({
    kind: 'bewegungsdichte', ...constGrund, frame: 45, part: 'koerper', frames: [45, 46],
  }));
  assert.equal(gut.ok, true, JSON.stringify(gut.errors));

  const schlecht = validateValidationReport(berichtMitBefund({
    kind: 'bewegungsdichte', ...constGrund, frame: -3, frames: [45, 46],
  }));
  assert.equal(schlecht.ok, false, 'ein negativer Frame geht auch schichtweit nicht');
  assert.ok(schlecht.errors.some((e) => e.field === 'style.issues.0.frame'));
});

test('Unbekannte Befundart wird wie ein Punktbefund behandelt', () => {
  // Die Ausnahmeliste ist geschlossen: nur was darin steht, darf ortlos sein.
  const r = validateValidationReport(berichtMitBefund({
    kind: 'irgendwas', value: 1, unit: 'x', message: 'irgendwas ist', part: 'koerper',
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'style.issues.0.frame'),
    `beanstandete Felder: ${JSON.stringify(r.errors.map((e) => e.field))}`);
});
