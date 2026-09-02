// Boden und Balance rechnen mit den SOHLEN, nicht mit dem Fußknochen.
//
// Der Fußknochen liegt am Xbot 7,2 cm über der tiefsten Sohle. Solange Boden,
// Phase und Balance mit ihm rechneten, prüfte der Validator einen Punkt, den
// kein Körper berührt:
//
//   Wurzel 10 cm abgesenkt — alle acht Sohlen im Boden, gemeldet wurden zwei
//   Zehenknochen mit 10,0 cm. Ein Rig ohne Zehenknochen hätte gar nichts
//   gemeldet.
//   Fuß 25 Grad nach unten gekippt — die Sohle steckt 6,0 cm im Boden,
//   gemeldet wurden 3,7 cm.
//   Linkes Bein angehoben, Schwerpunkt über dem angehobenen Fuß — null
//   Balancefehler, weil die Stützfläche die Strecke zwischen beiden
//   FUSSKNOCHEN war und ein angehobener Fuß nicht ausgefiltert wurde.
//
// Geprüft wird am echten Xbot über den Löser (Muster: fussanker.test.mjs).
// Der Negativfall ist jedesmal derselbe Frame OHNE Sohlenverzeichnis — das
// ist genau die alte Rechnung. Meldet sie dasselbe, prüft der Positivfall
// nichts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from '../solver/kinematik.js';
import { loeseBewegung } from '../solver/loeser.js';
import { pruefePhysik } from './physics.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';
const FPS = 30;

/** Absenkung der Wurzel für den Bodenfall, in Metern. */
const ABSENKUNG = 0.05;

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  const bind = erfasseBind(gltf.scene);
  const skel = baueSkeleton(profil, bind);
  // Standhöhe der Wurzel = ihre Höhe in der Bind-Pose. Gemessen, nicht
  // getippt: eine Zahl wie 1,04 wäre für ein anderes Modell falsch.
  const standHoehe = bind.find((b) => b.id === profil.roles.pelvis.bone).pos[1];
  return { profil, skel, standHoehe };
}

/** Eine Haltung über sechs Frames stillstehen lassen. */
function halte(profil, skel, joints, rootPos) {
  const { frames } = loeseBewegung(profil, skel, {
    fps: FPS, frameCount: 6, phases: [],
    overrides: {
      0: { joints, root: { pos: rootPos } },
      5: { joints, root: { pos: rootPos } },
    },
  });
  return frames;
}

/** Dieselben Frames, wie sie ein älterer Löser lieferte: ohne solePositions. */
const ohneSohlenverzeichnis = (frames) => frames.map((f) => {
  const kopie = { ...f };
  delete kopie.solePositions;
  return kopie;
});

const befunde = (profil, frames, kind) =>
  pruefePhysik(profil, frames, FPS).issues.filter((i) => i.kind === kind);

// ── Boden ────────────────────────────────────────────────────────────────────

test('Boden: abgesenkte Wurzel meldet alle acht Sohlen mit dem richtigen Betrag', async () => {
  const { profil, skel, standHoehe } = await aufbau();

  // Ruhehöhe jeder Sohle über der Bodenebene, gemessen im Stand. Der Xbot
  // steht nicht mit allen acht Punkten auf null: sie liegen 1,6 bis 2,7 cm
  // über der Bodenebene. Genau um diesen Betrag weniger tief stecken sie
  // nach dem Absenken im Boden — das ist die Zahl, die stimmen muss.
  const grund = profil.world.groundY;
  const stand = halte(profil, skel, {}, [0, standHoehe, 0]);
  const ruhe = new Map(Object.entries(stand[5].solePositions)
    .map(([id, p]) => [id, p[1] - grund]));
  assert.equal(ruhe.size, 8, `erwartet 8 Sohlenpunkte, das Profil hat ${ruhe.size}`);
  assert.equal(befunde(profil, stand, 'boden').length, 0,
    'die stehende Figur darf keinen Bodenfehler haben');

  const gesenkt = halte(profil, skel, {}, [0, standHoehe - ABSENKUNG, 0]);
  const sohlen = befunde(profil, gesenkt, 'boden').filter((i) => i.part.startsWith('sole_'));

  const proFrame = new Map();
  for (const i of sohlen) {
    if (!proFrame.has(i.frame)) proFrame.set(i.frame, new Set());
    proFrame.get(i.frame).add(i.part);
  }
  for (const [frame, ids] of proFrame) {
    assert.equal(ids.size, 8,
      `Frame ${frame}: ${ids.size} von 8 Sohlen gemeldet — bei 5 cm Absenkung steckt jede im Boden`);
  }
  assert.equal(proFrame.size, 6, `erwartet 6 Frames mit Sohlenmeldungen, gezählt ${proFrame.size}`);

  for (const i of sohlen) {
    const erwartet = ABSENKUNG - ruhe.get(i.part);
    assert.ok(Math.abs(i.value - erwartet) < 0.002,
      `${i.part} in Frame ${i.frame}: gemeldet ${(i.value * 100).toFixed(1)} cm, `
      + `gerechnet ${(erwartet * 100).toFixed(1)} cm (5 cm Absenkung minus `
      + `${(ruhe.get(i.part) * 100).toFixed(1)} cm Ruhehöhe)`);
    assert.equal(i.unit, 'm');
    assert.match(i.message, /\d/);
  }
});

test('Boden, Negativfall: ohne Sohlenverzeichnis melden nur zwei Zehenknochen', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const gesenkt = halte(profil, skel, {}, [0, standHoehe - ABSENKUNG, 0]);
  const alt = befunde(profil, ohneSohlenverzeichnis(gesenkt), 'boden');
  const teile = [...new Set(alt.map((i) => i.part))];

  assert.deepStrictEqual(teile.sort(), ['mixamorigLeftToeBase', 'mixamorigRightToeBase'],
    `die alte Rechnung meldete ${teile.length} Teile: ${teile.join(', ')} — `
    + 'genau darum ging es: acht Sohlen im Boden, gemeldet werden zwei Knochen');
  assert.ok(alt.every((i) => Math.abs(i.value - ABSENKUNG) < 0.002),
    'der Zehenknochen meldet die Absenkung, nicht die Tiefe der Sohle');
});

// ── Balance ──────────────────────────────────────────────────────────────────

/** Auf dem rechten Bein, linkes Bein angehoben. Der Oberkörper entscheidet,
 *  ob der Schwerpunkt über dem Standfuß bleibt. */
const EINBEINIG = { hip_l: { flex: 70 }, knee_l: { bend: 90 } };
const EINBEINIG_VORLAGE = { ...EINBEINIG, spine: { bend: 35 } };

test('Balance: ein angehobener Fuß trägt nicht mehr mit', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, EINBEINIG_VORLAGE, [0, standHoehe, 0]);

  const bal = befunde(profil, frames, 'balance');
  assert.ok(bal.length >= 1,
    'Figur steht auf einem Bein und legt sich 35 Grad vor — das Lot liegt vor dem Standfuß, '
    + `gemeldet wurden ${bal.length} Balancefehler`);
  assert.ok(bal[0].value > profil.world.height * 0.08,
    `der Überstand muss über der Toleranz von 8 % Körperhöhe liegen, gemeldet ${(bal[0].value * 100).toFixed(1)} cm`);
  assert.match(bal[0].message, /\d/);
});

test('Balance, Negativfall: dieselbe Haltung ohne Sohlenverzeichnis bleibt stumm', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, EINBEINIG_VORLAGE, [0, standHoehe, 0]);

  const alt = befunde(profil, ohneSohlenverzeichnis(frames), 'balance');
  assert.equal(alt.length, 0,
    `die alte Rechnung über die Fußknochen meldete ${alt.length} Fehler — `
    + 'sie spannte die Stützfläche zwischen beide Füße, auch wenn einer 30 cm in der Luft hing. '
    + 'Meldet sie dasselbe wie die neue, prüft der Positivfall nichts');
});

test('Balance: Schwerpunkt über dem Standfuß ist kein Fehler', async () => {
  const { profil, skel, standHoehe } = await aufbau();
  const frames = halte(profil, skel, EINBEINIG, [0, standHoehe, 0]);

  const bal = befunde(profil, frames, 'balance');
  assert.equal(bal.length, 0,
    `aufrecht auf einem Bein, Lot über dem Standfuß — ${bal.length} Balancefehler wäre ein Fehlalarm: `
    + bal.map((i) => `Frame ${i.frame} ${(i.value * 100).toFixed(1)} cm`).join(', '));
});
