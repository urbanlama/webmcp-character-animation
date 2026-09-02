// Abnahmetest — „Die Figur steht auf dem Boden, es sei denn, der Agent hebt sie an".
//
// Bühnenlauf vom 2. September 2026, Befund A: jede Beinpose verkürzte die
// Beinkette, die Wurzel blieb stehen, die Figur schwebte. Eine normale Hocke
// (knee.bend 60, hip.flex 50) hing 15,5 cm über dem Boden (am Xbot
// nachgemessen: tiefste Sohle 0,155 m bei Wurzel 1,04 m). Der Agent musste die
// Absenkung raten — 0,79 m steckte dann 11 cm im Boden — und bekam für
// „schwebt", „steckt" und „steht" dieselbe Meldung. Weil „Flug" galt, fielen
// Balance und Fußrutschen still aus.
//
// Entscheidung: der Boden ist der Normalzustand der Wurzelhöhe. Der Löser
// stellt in jedem Frame OHNE gesetzte Höhe den tiefsten Punkt der Figur
// (Sohlen und Knochen) auf die Bodenebene. Eine Zahl in root.pos[1] hebt sie
// ausdrücklich an; unter den Boden geht es nie (plan.md 6.4, Rang 2 — der
// Löser hebt an und meldet den Betrag).
//
// Negativfälle: eine GESETZTE Höhe muss weiter schweben (sonst gäbe es keinen
// Sprung mehr), und ein Frame aus einem Flug-Verb darf nicht abgesetzt werden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { BODEN_TOLERANZ_ANTEIL } from '../validate/physics.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
  return { profil, skel };
}

const HOCKE = { knee_l: { bend: 60 }, knee_r: { bend: 60 }, hip_l: { flex: 50 }, hip_r: { flex: 50 } };

/** Tiefster Punkt aus Sohlen UND Knochen über der Bodenebene, Meter. */
function tiefsterPunkt(frame, boden) {
  const sohlen = Object.values(frame.solePositions ?? {}).map((p) => p[1]);
  const knochen = Object.values(frame.positions ?? {}).map((p) => p[1]);
  return Math.min(...sohlen, ...knochen) - boden;
}

const { profil, skel } = await aufbau();
const boden = skel.groundY;
// Was noch als „steht" gilt: dieselbe Toleranz, unter der der Validator eine
// Bodendurchdringung nicht meldet (1 % Körperhöhe, 1,8 cm am Xbot).
const steht = skel.height * BODEN_TOLERANZ_ANTEIL;

function loese(overrides, frameCount = 4, anchors = []) {
  return loeseBewegung(profil, skel, { fps: 30, frameCount, phases: [], overrides, anchors });
}

test('Hocke ohne Wurzelangabe: die Figur steht auf dem Boden', () => {
  const { frames, bericht } = loese({ 0: { joints: HOCKE }, 3: { joints: HOCKE } });
  const f = frames[0];
  const abstand = tiefsterPunkt(f, boden);
  assert.ok(Math.abs(abstand) < steht,
    `tiefster Punkt ${(abstand * 100).toFixed(2)} cm vom Boden — erlaubt ±${(steht * 100).toFixed(2)} cm`);
  assert.equal(f.contact, 'kontakt', 'eine Hocke hat Bodenkontakt');
  assert.ok(f.root.pos[1] < 1.0, `Wurzel muss unter die Bind-Höhe sinken, steht bei ${f.root.pos[1].toFixed(3)} m`);
  assert.equal(f.hoehe?.quelle, 'boden', 'der Frame sagt, dass der Boden die Höhe bestimmt hat');
  assert.ok(f.hoehe.absenkung_m > 0.10, `Absenkung ${f.hoehe.absenkung_m} m — am Xbot sind es rund 15 cm`);
  assert.ok(bericht.hinweise.some((h) => /Boden/.test(h) && /\d/.test(h)),
    'der Bericht nennt die Absenkung mit Zahl');
});

test('Negativfall: eine gesetzte Höhe schwebt weiter — sonst gäbe es keinen Sprung', () => {
  const { frames } = loese({
    0: { joints: HOCKE, root: { pos: [0, 1.04, 0] } },
    3: { joints: HOCKE, root: { pos: [0, 1.04, 0] } },
  });
  const f = frames[0];
  const abstand = tiefsterPunkt(f, boden);
  assert.ok(abstand > 0.10, `mit root.pos y = 1,04 muss die Hocke schweben; tiefster Punkt ${(abstand * 100).toFixed(1)} cm`);
  assert.equal(f.contact, 'flug');
  assert.equal(f.hoehe?.quelle, 'gesetzt');
});

test('Zu tief gesetzt: der Löser hebt an und meldet den Betrag (Rang 2)', () => {
  const { frames, bericht } = loese({
    0: { joints: HOCKE, root: { pos: [0, 0.79, 0] } },
    3: { joints: HOCKE, root: { pos: [0, 0.79, 0] } },
  });
  const f = frames[0];
  const abstand = tiefsterPunkt(f, boden);
  assert.ok(Math.abs(abstand) < steht, `steckt noch ${(-abstand * 100).toFixed(1)} cm im Boden`);
  assert.equal(f.hoehe?.quelle, 'angehoben');
  assert.ok(f.hoehe.angehoben_m > 0.05, `Anhebung ${f.hoehe.angehoben_m} m — erwartet rund 10 cm`);
  const k = bericht.konflikt.find((x) => x.bedingung === 'boden');
  assert.ok(k, `kein Konflikt „boden" im Bericht: ${JSON.stringify(bericht.konflikt)}`);
  assert.ok(k.betrag > 0.05 && /cm/.test(k.meldung), `Konflikt ohne Betrag: ${k.meldung}`);
});

test('Wurzelhöhe null heißt Boden, x und z gelten trotzdem', () => {
  const { frames } = loese({
    0: { joints: HOCKE, root: { pos: [0.3, null, 0] } },
    3: { joints: HOCKE, root: { pos: [0.3, null, 0.2] } },
  });
  const f = frames[3];
  assert.ok(Math.abs(tiefsterPunkt(f, boden)) < steht, 'steht auf dem Boden');
  assert.ok(Math.abs(f.root.pos[0] - 0.3) < 1e-6 && Math.abs(f.root.pos[2] - 0.2) < 1e-6,
    `x/z müssen gelten: ${f.root.pos}`);
  assert.equal(f.hoehe?.quelle, 'boden');
});

test('Stand zu Hocke: jeder Zwischenframe steht auf dem Boden', () => {
  const { frames } = loese({ 0: { joints: {} }, 12: { joints: HOCKE } }, 13);
  for (const f of frames) {
    const abstand = tiefsterPunkt(f, boden);
    assert.ok(Math.abs(abstand) < steht,
      `Frame ${f.frame}: tiefster Punkt ${(abstand * 100).toFixed(2)} cm vom Boden`);
  }
});

test('Sprung: Boden-Keyframes vor und nach einer gesetzten Höhe, dazwischen die Kurve', () => {
  const STRECK = { knee_l: { bend: 5 }, knee_r: { bend: 5 }, hip_l: { flex: 5 }, hip_r: { flex: 5 } };
  const { frames } = loese({
    0: { joints: HOCKE },                                              // Ausholen, Boden
    8: { joints: STRECK, ease: 'wurf' },                               // Absprung, Boden — Höhe NICHT geraten
    12: { joints: HOCKE, root: { pos: [0, 1.5, 0] }, ease: 'wurf' },   // Scheitel, gesetzt
    16: { joints: HOCKE },                                             // Landung, Boden
  }, 17);
  const bei = (n) => frames.find((f) => f.frame === n);
  assert.ok(Math.abs(tiefsterPunkt(bei(0), boden)) < steht, 'Ausholen steht');
  assert.ok(Math.abs(tiefsterPunkt(bei(8), boden)) < steht, 'Absprung steht');
  assert.ok(Math.abs(bei(12).root.pos[1] - 1.5) < 1e-6, `Scheitel bei ${bei(12).root.pos[1]} statt 1,5 m`);
  assert.ok(Math.abs(tiefsterPunkt(bei(16), boden)) < steht, 'Landung steht');
  for (const n of [9, 10, 11, 13, 14, 15]) {
    assert.ok(tiefsterPunkt(bei(n), boden) > 0.02, `Frame ${n} muss in der Luft sein`);
    assert.equal(bei(n).hoehe?.quelle, 'gesetzt', `Frame ${n}: zwischen Boden und gesetzter Höhe gilt die Kurve`);
  }
  // Der Aufstieg 8 → 12 ist eine Wurfparabel: die Wurzel steigt monoton.
  for (let n = 9; n <= 12; n++) {
    assert.ok(bei(n).root.pos[1] > bei(n - 1).root.pos[1], `Frame ${n}: Wurzel muss steigen`);
  }
});

test('Negativfall: ein Frame aus dem Flug-Verb wird nicht abgesetzt', () => {
  // Parameter wie in loeser.test.mjs: tiefe als Anteil der Körperhöhe, vy in
  // Körperhöhen je Sekunde (plan.md 5.5).
  const tl = {
    fps: 30, frameCount: 40, phases: [
      { id: 'p1', verb: 'crouch', from: 0, to: 10, params: { tiefe: 0.08 } },
      { id: 'p2', verb: 'takeoff', from: 10, to: 16, params: { vy: 1.6 } },
      { id: 'p3', verb: 'airborne', from: 16, to: 34, params: { tuck: 0 } },
    ],
    overrides: { 22: { joints: { arm_l: { lift: 60 } } }, 26: { joints: { arm_l: { lift: 60 } } } },
  };
  const { frames } = loeseBewegung(profil, skel, tl);
  const f = frames.find((x) => x.frame === 24);
  assert.equal(f.contact, 'flug', 'ein Armwinkel im Flug darf die Figur nicht auf den Boden holen');
  assert.equal(f.hoehe?.quelle, 'phase', 'die Höhe gehört dem Flug-Verb');
  assert.ok(tiefsterPunkt(f, boden) > 0.05, `Frame 24 im Flug, tiefster Punkt ${(tiefsterPunkt(f, boden) * 100).toFixed(1)} cm`);
});

test('Negativfall: gestrecktes Schwungbein im Schritt — die Figur wird angehoben, der Anker verfehlt, und der Bericht sagt warum', () => {
  // 22 cm Schritt, Standfuß verankert, Höhe nicht gesetzt: das Becken sinkt
  // für das Standbein (3,4 cm), das gestreckte freie Bein steckt dann im
  // Boden. Rang 2 (Boden) geht vor Rang 3 (Anker): angehoben, Anker verfehlt.
  // Der Agent muss den GRUND lesen können — sonst verkürzt er die Ankerspanne
  // statt das Bein zu heben.
  const { frames, bericht } = loese(
    { 0: { joints: {}, root: { pos: [0, null, 0] } }, 20: { joints: {}, root: { pos: [0, null, 0.22] } } },
    21,
    [{ foot: 'foot_l', von: 0, bis: 20 }],
  );
  const f = frames[20];
  assert.ok(Math.abs(tiefsterPunkt(f, boden)) < steht, 'nichts steckt im Boden');
  assert.ok(f.hoehe.angehoben_m > 0.02, `Frame 20 muss angehoben sein, ist ${f.hoehe.angehoben_m ?? 0} m`);
  const k = bericht.konflikt.find((x) => x.bedingung === 'fussanker');
  assert.ok(k, `Anker muss als verfehlt gemeldet sein: ${JSON.stringify(bericht.konflikt)}`);
  assert.match(k.grund, /angehoben/, `der Grund nennt die Anhebung: „${k.grund}"`);
  assert.match(k.grund, /\d+,\d cm/, 'mit Betrag');
  assert.match(k.meldung, /freie Bein/, `der Rat sagt, das freie Bein zu heben: „${k.meldung}"`);
});

test('hold_foot in der Hocke: der Anker liegt am Boden, nicht in der Luft', () => {
  const { frames, bericht } = loese(
    { 0: { joints: HOCKE }, 6: { joints: HOCKE, root: { pos: [0, null, 0.08] } } },
    7,
    [{ foot: 'foot_l', von: 0, bis: 6 }],
  );
  const fussknochen = skel.rollenKnochen.foot_l;
  const start = frames[0].positions[fussknochen];
  const ende = frames[6].positions[fussknochen];
  // Der Fußknochen sitzt am Xbot rund 8,4 cm über der Sohle: verankert am
  // Boden heißt Knochenhöhe unter 12 cm — in der schwebenden Hocke lag er bei 24 cm.
  assert.ok(start[1] - boden < 0.12, `Fuß bei ${((start[1] - boden) * 100).toFixed(1)} cm Knochenhöhe — der Anker hängt in der Luft`);
  const weg = Math.hypot(ende[0] - start[0], ende[1] - start[1], ende[2] - start[2]);
  assert.ok(weg < 0.02, `verankerter Fuß wandert ${(weg * 100).toFixed(1)} cm`);
  assert.equal(bericht.konflikt.filter((k) => k.bedingung === 'fussanker').length, 0,
    `Anker verfehlt: ${JSON.stringify(bericht.konflikt)}`);
});
