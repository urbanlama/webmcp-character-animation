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
