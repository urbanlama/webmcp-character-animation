// Abnahmetest — „Der Anker behaelt seinen Ort, wenn die Spanne wandert".
//
// Reibungsbericht Lauf 7, Punkt 5: der Sollort eines Ankers kam aus dem ERSTEN
// Frame seiner Spanne (halteAnker, `inSpanne[0].positions`). Verkuerzte der
// Agent die Spanne vorne — aus 0–20 wurde 10–20 —, nahm der Anker die
// Fussposition von Frame 10. Dort steht der Fuss aber schon weiter, weil er
// bis dahin unverankert mitgewandert ist. Der Agent aenderte einen Zeitraum,
// und der Fuss zog mit um.
//
// Seit dem 2. September 2026 darf ein Anker `ortFrame` tragen: den Frame, aus
// dem sein Sollort stammt. Der Handler setzt ihn beim Ersetzen eines
// bestehenden Ankers (siehe src/tools/anker-ersetzen.test.mjs), der Loeser
// liest ihn hier.
//
// Positivfall: Spanne 10–20 mit ortFrame 0 haelt den Fuss dort, wo ihn die
// Spanne 0–20 gehalten haette.
// Negativfall: dieselbe Spanne OHNE ortFrame muss den Fuss woanders
// festnageln — sonst misst der Test nicht, was er zu messen behauptet.
// Zweiter Negativfall: ein ortFrame ausserhalb der Timeline darf nicht still
// verschluckt werden, sondern faellt auf den Spannenanfang zurueck.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { xbotProfil } from '../rig/xbot-profil.mjs';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function aufbau() {
  const profil = await xbotProfil();
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  return { profil, skel: baueSkeleton(profil, erfasseBind(gltf.scene)) };
}

// Angehobenes freies Bein, sonst steckt es im Boden und die Figur wird
// angehoben (bodenstand.test.mjs) — dann misst dieser Test die Bodenfreiheit
// statt den Anker.
const SCHWUNGBEIN = { hip_r: { flex: 25 }, knee_r: { bend: 45 } };

/** 22 cm Wurzelfahrt ueber 20 Frames — die Weite, die die Beinkette traegt. */
function timeline(anchors) {
  return {
    fps: 30, frameCount: 40, phases: [],
    overrides: {
      0: { joints: SCHWUNGBEIN, root: { pos: [0, null, 0] }, ease: 'smooth' },
      20: { joints: SCHWUNGBEIN, root: { pos: [0, null, 0.22] }, ease: 'smooth' },
    },
    anchors,
  };
}

const fussAuf = (frames, knochen, frame) =>
  frames.find((f) => f.frame === frame)?.positions?.[knochen] ?? null;

const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('ortFrame haelt den Sollort fest, wenn die Spanne vorne verkuerzt wird', async () => {
  const { profil, skel } = await aufbau();
  const knochen = skel.rollenKnochen.foot_l;

  const voll = loeseBewegung(profil, skel, timeline([{ foot: 'foot_l', von: 0, bis: 20 }]));
  const mitOrt = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 10, bis: 20, ortFrame: 0 }]));
  const ohneOrt = loeseBewegung(profil, skel, timeline([{ foot: 'foot_l', von: 10, bis: 20 }]));

  const zielVoll = fussAuf(voll.frames, knochen, 20);
  const zielMitOrt = fussAuf(mitOrt.frames, knochen, 20);
  const zielOhneOrt = fussAuf(ohneOrt.frames, knochen, 20);
  assert.ok(zielVoll && zielMitOrt && zielOhneOrt, 'alle drei Laeufe muessen Fusspositionen liefern');

  // Positivfall: derselbe Ort wie bei der vollen Spanne. 1 cm Spielraum, weil
  // die Frames 0–9 in der verkuerzten Fassung frei laufen und die IK von einer
  // anderen Starthaltung aus in den Anker faehrt.
  const dazwischen = abstand(zielMitOrt, zielVoll);
  assert.ok(dazwischen < 0.01,
    `mit ortFrame 0 muss der Fuss dort stehen wie bei Spanne 0–20, Abstand ist `
    + `${(dazwischen * 100).toFixed(2)} cm`);

  // Negativfall: ohne ortFrame nagelt derselbe Anker den Fuss messbar woanders
  // fest — genau der Umzug aus dem Reibungsbericht.
  const umzug = abstand(zielOhneOrt, zielVoll);
  assert.ok(umzug > 0.03,
    `ohne ortFrame MUSS der Fuss mitwandern (sonst prueft der Positivfall nichts), `
    + `gewandert ist er nur ${(umzug * 100).toFixed(2)} cm`);
});

test('Negativfall: ein ortFrame ausserhalb der Timeline faellt auf den Spannenanfang zurueck', async () => {
  const { profil, skel } = await aufbau();
  const knochen = skel.rollenKnochen.foot_l;

  const daneben = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 10, bis: 20, ortFrame: 999 }]));
  const ohne = loeseBewegung(profil, skel, timeline([{ foot: 'foot_l', von: 10, bis: 20 }]));

  const a = fussAuf(daneben.frames, knochen, 20);
  const b = fussAuf(ohne.frames, knochen, 20);
  assert.ok(a && b, 'beide Laeufe muessen Fusspositionen liefern');
  assert.ok(abstand(a, b) < 0.005,
    `ein unbrauchbarer ortFrame muss wie kein ortFrame wirken, Abstand ist `
    + `${(abstand(a, b) * 100).toFixed(2)} cm`);
  assert.equal(daneben.bericht.lucken.some((l) => /ortFrame/.test(l.meldung ?? '')), true,
    `der Bericht muss den unbrauchbaren ortFrame nennen: ${JSON.stringify(daneben.bericht.lucken)}`);
});
