// Abnahmetest — "Ein festgenagelter Fuss bleibt stehen".
//
// Warum es das Werkzeug gibt, gemessen an zwei Agentenlaeufen am 1. September
// 2026: der Agent setzt Gelenkwinkel, wird aber an Weltpositionen gemessen.
// Damit ein Standfuss beim Gehen stehen bleibt, muesste er die Beinkette im
// Kopf rechnen — fuer jeden Frame, waehrend sich das Becken bewegt. Er hat es
// versucht (213 Sekunden fuer einen Block) und die Fuesse rutschten trotzdem
// bis 31 cm.
//
// Positivfall: das Becken wandert 22 cm, der verankerte Fuss bleibt.
// Negativfall: OHNE Anker MUSS derselbe Fuss mitwandern — sonst misst der Test
// nicht, was er zu messen behauptet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function aufbau() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const profil = measureRigProfile(gltf);
  const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
  return { profil, skel };
}

/**
 * Becken wandert nach vorn, die Beine bleiben unveraendert.
 *
 * `weite` in Metern. 0,22 m ist eine Schrittweite, die die gemessene Beinlaenge
 * hergibt; das Becken sinkt dabei leicht, so wie beim Gehen. Bei 0,40 m reicht
 * das Bein nicht mehr — dieser Fall wird unten getrennt geprueft, denn ein
 * Anker, der nicht zu halten ist, muss GEMELDET werden.
 */
function timeline(anchors, weite = 0.22, hoehe = 1.00) {
  return {
    fps: 30, frameCount: 40, phases: [],
    overrides: {
      0: { joints: { hip_l: { flex: 0 }, hip_r: { flex: 0 } }, root: { pos: [0, 1.04, 0] }, ease: 'smooth' },
      20: { joints: { hip_l: { flex: 0 }, hip_r: { flex: 0 } }, root: { pos: [0, hoehe, weite] }, ease: 'smooth' },
    },
    anchors,
  };
}

/** Wie weit der Fuss zwischen zwei Frames in der Welt wandert, in Metern. */
function fussweg(frames, knochen, von, bis) {
  const a = frames.find((f) => f.frame === von)?.positions?.[knochen];
  const b = frames.find((f) => f.frame === bis)?.positions?.[knochen];
  if (!a || !b) return null;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

test('Fussanker, Negativfall: ohne Anker wandert der Fuss mit dem Becken', async () => {
  const { profil, skel } = await aufbau();
  const { frames } = loeseBewegung(profil, skel, timeline([]));
  const knochen = skel.rollenKnochen.foot_l;

  const weg = fussweg(frames, knochen, 0, 20);
  assert.ok(weg > 0.15,
    `ohne Anker muss der Fuss dem Becken folgen (22 cm), gewandert ist er ${(weg * 100).toFixed(1)} cm`);
});

test('Fussanker: mit Anker bleibt der Fuss stehen — oder der Loeser meldet den Konflikt', async () => {
  // Zwei Haer grade, beide gemessen am Xbot:
  //
  //   Bei 5 cm Wurzelfahrt haelt die Beinkette den Fuss (gemessen: 1,3 cm
  //   Wanderung). Bei 22 cm Wurzelfahrt mit gestrecktem Ausgangsbein reicht
  //   die Hueftgrenze nicht mehr (gemessen: 18,9 cm Restabweichung) — und der
  //   Loeser DARF den Fuss dann nicht still verbiegen: Er muss den Konflikt
  //   mit Betrag melden (AGENTS.md: "Der Loeser korrigiert, der Validator
  //   prueft die Nachbedingung" — ein Loeser kann scheitern, genau dann muss
  //   der Bericht etwas melden).
  //
  // Der alte Test verlangte stillen Erfolg bei 22 cm. Das ging nur, weil der
  // Anker damals die gesetzten Winkel des Agenten mit Gewicht 100 gegen 4
  // wegbog — gemessener Befund: der Agent sah seine Haltung zerstoert. Das
  // Wegbogen ist abgeschafft; der Konflikt ist das korrekte Verhalten.
  const { profil, skel } = await aufbau();

  // 1. Haltbarer Fall: kleine Wurzelfahrt, der Fuss bleibt wirklich stehen.
  const klein = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }], 0.03));
  const knochen = skel.rollenKnochen.foot_l;
  const wegKlein = fussweg(klein.frames, knochen, 0, 20);
  assert.ok(wegKlein < 0.05,
    `bei 3 cm Wurzelfahrt darf der Fuss hoechstens 5 cm wandern, gewandert ist er ${(wegKlein * 100).toFixed(1)} cm`);
  assert.ok(klein.bericht.hinweise.some((h) => /Anker foot_l/.test(h)),
    `der Bericht muss den gehaltenen Anker nennen: ${JSON.stringify(klein.bericht.hinweise)}`);

  // 2. Unerreichbarer Fall: 22 cm Wurzelfahrt, gestrecktes Bein — scheitert
  //    sichtbar. Der Konflikt nennt Fuss, Betrag und nächsten Schritt.
  const { frames, bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }]));
  const weg = fussweg(frames, knochen, 0, 20);
  assert.ok(weg >= 0.05,
    `bei 22 cm Wurzelfahrt mit gestrecktem Bein ist der Fuss nicht zu halten — `
    + `eine stille "Erfolg"-Anpassung von ${(weg * 100).toFixed(1)} cm wäre der alte Fehler`);
  const konflikt = bericht.konflikt.find((k) => /Anker foot_l/.test(k.meldung ?? ''));
  assert.ok(konflikt,
    `der Bericht muss den Ankerbruch als Konflikt melden: ${JSON.stringify(bericht.konflikt)}`);
  assert.match(konflikt.meldung, /\d/,
    'der Konflikt muss eine Zahl nennen (Betrag der Abweichung)');

  // Der andere Fuss bleibt frei: der Anker gilt nur fuer den genannten.
  const rechts = fussweg(frames, skel.rollenKnochen.foot_r, 0, 20);
  assert.ok(rechts > 0.15,
    `foot_r ist nicht verankert und muss weiter mitwandern, gewandert ist er ${(rechts * 100).toFixed(1)} cm`);
});

test('Fussanker: eine unbekannte Rolle wird gemeldet, nicht verschluckt', async () => {
  const { profil, skel } = await aufbau();
  const { bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'gibt_es_nicht', von: 0, bis: 20 }]));

  assert.ok(bericht.lucken.some((l) => /gibt_es_nicht/.test(l.meldung)),
    `die Luecke muss die unbekannte Rolle nennen: ${JSON.stringify(bericht.lucken)}`);
});

test('Fussanker: ein Bereich ohne geloeste Frames wird gemeldet', async () => {
  const { profil, skel } = await aufbau();
  const { bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 900, bis: 950 }]));

  assert.ok(bericht.lucken.some((l) => /900/.test(l.meldung)),
    `die Luecke muss den leeren Bereich mit Zahl nennen: ${JSON.stringify(bericht.lucken)}`);
});

test('Fussanker: was das Bein nicht hergibt, wird mit Betrag gemeldet', async () => {
  // 40 cm Schrittweite bei aufrechtem Becken: die gemessene Beinlaenge reicht
  // dafuer nicht. Der Loeser darf das nicht stillschweigend verfehlen — er
  // haelt so weit er kann und schreibt den Rest in den Bericht.
  const { profil, skel } = await aufbau();
  const { frames, bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }], 0.4, 1.04));

  const weg = fussweg(frames, skel.rollenKnochen.foot_l, 0, 20);
  assert.ok(weg < 0.4,
    `auch unerreichbar muss der Anker besser sein als gar keiner (40 cm), gewandert ist er ${(weg * 100).toFixed(1)} cm`);

  const gemeldet = bericht.konflikt.filter((k) => k.bedingung === 'fussanker');
  assert.equal(gemeldet.length, 1, `1 Konflikt erwartet, bekommen ${gemeldet.length}`);
  assert.match(gemeldet[0].meldung, /\d/, 'die Meldung nennt den verfehlten Betrag');
});
