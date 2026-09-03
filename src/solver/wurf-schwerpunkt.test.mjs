// Abnahmetest — „Im Flug folgt der SCHWERPUNKT der Wurfparabel, nicht die Wurzel."
//
// Agentenlauf 7 vom 2. September 2026 (Session f64b54b5): Der Agent baute einen
// Rückwärtssalto und bekam von `validate` Ballistikbefunde von 63 m/s². Er hat
// daraufhin dreimal den Schwerpunkt über die Flugphase gemessen, den Abstand zur
// Sollparabel je Frame ausgerechnet und die Wurzelhöhen von Hand nachgezogen —
// rund 6 der 26 Minuten Laufzeit. Ergebnis: 25 m/s², bestanden nie.
//
// Ursache: `ease: 'wurf'` legt die WURZELHÖHE auf die Parabel (wurfHoehe()), die
// Physikprüfung misst aber den SCHWERPUNKT. Solange die Pose im Flug steht, ist
// das dasselbe — der Schwerpunkt hängt dann starr an der Wurzel. Sobald sich die
// Pose ändert (jeder Tuck, jedes Schwungbein), wandert der Schwerpunkt gegen die
// Wurzel, und die Prüfung meldet eine Beschleunigung, die die Bewegung nicht hat.
// Es gab keine Steuergröße, mit der der Agent das hätte treffen können.
//
// Dass es nicht am Salto hängt, steht in demselben Lauf: die drei gewöhnlichen
// Laufschritte in Lauf 8 (Flugphasen von je drei Frames) meldeten 50, 51 und
// 104 m/s² — dort schwingt nur ein Bein nach vorn.
//
// Der Umbau ist abwärtskompatibel: die gesetzten Schlüsselbilder bleiben
// WURZELHÖHEN und werden exakt getroffen. Nur der Weg dazwischen wird so gelegt,
// dass der Schwerpunkt mit g fällt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGLB } from '../scene/load.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung, wurfHoehe } from './loeser.js';
import { pruefePhysik, BALLISTIK_TOLERANZ_ANTEIL, G } from '../validate/physics.js';
import { xbotProfil } from '../rig/xbot-profil.mjs';

const XBOT = 'beispiel/Xbot.glb';

async function aufbau() {
  const profil = await xbotProfil();
  const puff = readFileSync(XBOT);
  const glb = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  return { profil, skel: baueSkeleton(profil, erfasseBind(glb.scene)) };
}

const { profil, skel } = await aufbau();
const FPS = 30;

function loese(overrides, frameCount) {
  return loeseBewegung(profil, skel, { fps: FPS, frameCount, phases: [], overrides, anchors: [] });
}

/** Senkrechtbeschleunigung aus der zweiten Differenz — dieselbe Rechnung wie die Physikprüfung. */
function beschleunigung(frames, i) {
  const dt = 1 / FPS;
  return (frames[i - 1].com[1] - 2 * frames[i].com[1] + frames[i + 1].com[1]) / (dt * dt);
}

/** Größte Abweichung von −g über eine Framespanne, m/s². */
function groessteAbweichung(frames, von, bis) {
  let hoechste = 0;
  for (let i = von; i <= bis; i++) {
    hoechste = Math.max(hoechste, Math.abs(beschleunigung(frames, i) + G));
  }
  return hoechste;
}

const STRECK = { knee_l: { bend: 5 }, knee_r: { bend: 5 }, hip_l: { flex: 5 }, hip_r: { flex: 5 } };
const TUCK = { knee_l: { bend: 120 }, knee_r: { bend: 120 }, hip_l: { flex: 100 }, hip_r: { flex: 100 } };

// Der Fall aus Lauf 7: gestreckt ab, im Scheitel eingerollt, gestreckt zur
// Landung. Der Tuck bei Frame 10 setzt KEINE Höhe — er soll die Flugbahn nicht
// anfassen, nur die Pose.
const SALTOFLUG = {
  0: { joints: STRECK, root: { pos: [0, 1.15, 0] }, ease: 'wurf' },
  10: { joints: TUCK },
  20: { joints: STRECK, root: { pos: [0, 1.15, 0] }, ease: 'wurf' },
};

test('Tuck im Flug: der Schwerpunkt fällt trotzdem mit g', () => {
  const { frames } = loese(SALTOFLUG, 21);
  const abweichung = groessteAbweichung(frames, 1, 19);
  assert.ok(
    abweichung <= BALLISTIK_TOLERANZ_ANTEIL * G,
    `Schwerpunkt weicht um ${abweichung.toFixed(2)} m/s² von g ab — erlaubt sind `
    + `${(BALLISTIK_TOLERANZ_ANTEIL * G).toFixed(2)} m/s². Die Wurzel folgt der Parabel statt des Schwerpunkts.`,
  );
});

test('Dieselbe Bewegung durch die Physikprüfung: kein Ballistikbefund', () => {
  const { frames } = loese(SALTOFLUG, 21);
  const bericht = pruefePhysik(profil, frames, FPS);
  const ballistik = bericht.issues.filter((i) => i.kind === 'ballistik');
  assert.deepEqual(
    ballistik.map((i) => `Frame ${i.frame}: ${i.value} ${i.unit}`), [],
    'die Prüfung, an der der Agent gemessen wird, muss still sein',
  );
});

test('Die gesetzten Wurzelhöhen gelten weiter — auf den Millimeter', () => {
  const { frames } = loese(SALTOFLUG, 21);
  for (const n of [0, 20]) {
    const y = frames.find((f) => f.frame === n).root.pos[1];
    assert.ok(Math.abs(y - 1.15) < 1e-6, `Frame ${n}: Wurzel bei ${y.toFixed(4)} m statt 1,15 m gesetzt`);
  }
});

test('Gehaltene Pose im Flug: unverändert die alte Wurfparabel auf der Wurzel', () => {
  // Ohne Posenänderung hängt der Schwerpunkt starr an der Wurzel. Dann muss
  // exakt herauskommen, was wurfHoehe() schon immer geliefert hat — sonst wäre
  // der Umbau eine stille Änderung an jedem bestehenden Sprung.
  const { frames } = loese({
    0: { joints: STRECK, root: { pos: [0, 1.15, 0] }, ease: 'wurf' },
    20: { joints: STRECK, root: { pos: [0, 1.4, 0] }, ease: 'wurf' },
  }, 21);
  const T = 20 / FPS;
  for (let n = 0; n <= 20; n++) {
    const soll = wurfHoehe(1.15, 1.4, T, n / FPS);
    const ist = frames.find((f) => f.frame === n).root.pos[1];
    assert.ok(Math.abs(ist - soll) < 1e-6,
      `Frame ${n}: Wurzel bei ${ist.toFixed(4)} m, wurfHoehe() sagt ${soll.toFixed(4)} m`);
  }
});
