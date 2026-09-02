// Abnahmetest — „Der Agent sieht den Ablauf einer Bewegung in EINEM Bild".
//
// Befund vom 2. September 2026 (docs/buehne-befunde-2026-09-02.md, Punkt 1):
// Der alte Bildstreifen klebte bis zu sechs Frames nebeneinander. Auf so einem
// Bild ist eine Bewegung nicht lesbar — jede Figur fingernagelgross, und
// zwischen zwei Standbildern steht nicht, was dazwischen passiert ist.
//
// Seit dem Umbau liefern `look` und `validate` je EINEN Moment in voller
// Groesse. Damit fehlte dem Agenten der Verlauf ganz: er haette ihn Frame fuer
// Frame zusammensuchen muessen, und was er vergisst, sieht er nie.
//
// Die Spur loest das anders als ein Raster: nicht Standbilder nebeneinander,
// sondern die BAHN der Endeffektoren ueber die ganze Timeline, in ein Bild
// gelegt. Die Bahn zeigt die Form der Bewegung, der Abstand der Punkte das
// Timing (eng = langsam, weit = schnell, Knaeuel = Stillstand), ein Knick den
// Richtungswechsel. Ein Animator liest eine Bewegung genau so.
//
// Positivfall: eine Bahn je verfolgtem Punkt, ein Punkt je Frame, in
// Bildkoordinaten des Panels.
// Negativfall: fehlende Positionen reissen die Spur nicht ab, sie werden
// uebersprungen — sonst faellt das ganze Bild aus, weil ein Knochen fehlt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spurPunkte, SPUR_ROLLEN } from './spur.js';

/** Eine Timeline, in der die linke Hand geradlinig steigt. */
function frames(n) {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    positions: {
      hand_l: [0, 1 + i * 0.05, 0],
      hand_r: [0.2, 1, 0],
      foot_l: [0, 0.1, 0],
      foot_r: [0.2, 0.1, 0],
      pelvis: [0.1, 1.0, 0],
    },
  }));
}

const rollen = { hand_l: 'hand_l', hand_r: 'hand_r', foot_l: 'foot_l', foot_r: 'foot_r', pelvis: 'pelvis' };

test('Je verfolgtem Punkt eine Bahn, je Frame ein Punkt', () => {
  const bahnen = spurPunkte(frames(10), rollen);
  assert.equal(bahnen.length, SPUR_ROLLEN.length,
    `${bahnen.length} Bahnen, erwartet ${SPUR_ROLLEN.length} — je verfolgter Punkt eine`);
  for (const b of bahnen) {
    assert.equal(b.punkte.length, 10, `Bahn ${b.rolle} hat ${b.punkte.length} Punkte, erwartet 10`);
    assert.equal(b.punkte[0].frame, 0);
    assert.equal(b.punkte[9].frame, 9);
  }
});

test('Die Bahn trägt die Weltposition, damit das Panel sie projizieren kann', () => {
  const [erste] = spurPunkte(frames(3), rollen);
  for (const p of erste.punkte) {
    assert.ok(Array.isArray(p.welt) && p.welt.length === 3,
      `Punkt ohne Weltposition: ${JSON.stringify(p)}`);
    assert.ok(p.welt.every(Number.isFinite), `Weltposition mit NaN: ${JSON.stringify(p.welt)}`);
  }
});

test('Fehlende Position überspringt den Frame, sie reißt die Spur nicht ab', () => {
  const f = frames(6);
  delete f[3].positions.hand_l;
  const bahnen = spurPunkte(f, rollen);
  const hand = bahnen.find((b) => b.rolle === 'hand_l');
  assert.equal(hand.punkte.length, 5, 'der Frame ohne Position fällt weg, die übrigen bleiben');
  assert.deepEqual(hand.punkte.map((p) => p.frame), [0, 1, 2, 4, 5],
    'die Frame-Zahlen bleiben die echten — eine Lücke ist sichtbar, nicht weggerechnet');
});

test('Ein Punkt, den das Modell nicht führt, liefert keine leere Bahn', () => {
  const bahnen = spurPunkte(frames(4), { hand_l: 'hand_l' });
  assert.equal(bahnen.length, 1, 'nur die Rolle, die das Modell wirklich hat');
  assert.equal(bahnen[0].rolle, 'hand_l');
});

test('SPUR_ROLLEN sind die Punkte, an denen man eine Bewegung liest', () => {
  // Haende und Fuesse tragen die Form, das Becken die Verlagerung des
  // Koerpers. Mehr Bahnen machen das Bild zum Knaeuel.
  assert.deepEqual([...SPUR_ROLLEN].sort(),
    ['foot_l', 'foot_r', 'hand_l', 'hand_r', 'pelvis']);
});
