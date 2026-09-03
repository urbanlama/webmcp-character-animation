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
//
// Zweiter Negativfall: ein Anker, den die Beinkette WIRKLICH nicht halten kann
// (60 cm Wurzelfahrt, Huefte an der Grenze −30°), muss als Konflikt mit Betrag
// im Bericht stehen. Ohne ihn wuerde der Test einen Loeser durchwinken, der
// jeden Anker stumm verfehlt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';
import { ANKER_TOLERANZ_ANTEIL } from './ik.js';
import { xbotProfil } from '../rig/xbot-profil.mjs';

const XBOT = 'beispiel/Xbot.glb';

async function aufbau() {
  // Profil des UNVERAENDERTEN Xbot aus dem geteilten Cache
  // (src/rig/xbot-profil.mjs): einmal gemessen, prozessuebergreifend
  // geteilt, jeder Aufrufer bekommt eine eigene Kopie. Veraenderte Modelle
  // (Overrides, fremde Posen) messen weiter selbst. Die Kopie haelt die
  // Isolation zwischen den Tests.
  const profil = await xbotProfil();
  const skel = baueSkeleton(profil, erfasseBind((await ladeModell()).scene));
  return { profil, skel };
}


async function ladeModell() {
  const puff = readFileSync(XBOT);
  return loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
}

/**
 * Becken wandert nach vorn.
 *
 * `weite` in Metern. 0,22 m ist eine Schrittweite, die die gemessene Beinkette
 * traegt; das Becken sinkt dabei leicht, so wie beim Gehen. Nachgemessen am
 * Xbot (Koerperhoehe 1,809 m) liegt der Umschlagpunkt zwischen 0,22 m — der
 * Fuss haelt auf 0,04 mm — und 0,25 m, wo `knee_l.bend` an seiner Grenze 0°
 * steht und der Anker nicht mehr zu halten ist.
 *
 * `hoehe` ist die gesetzte Wurzelhoehe auf Frame 20 (Frame 0 steht dann auf
 * der Bind-Hoehe 1,04 m). `null` heisst: keine Hoehe gesetzt, die Figur steht
 * auf dem Boden, und der Anker darf das Becken sinken lassen (Bodenstand seit
 * dem Buehnenlauf vom 2. September 2026).
 *
 * `joints` ist LEER, solange nichts anderes verlangt wird: nur dann ist die
 * Beinkette frei und der Loeser darf zeigen, was er kann. Wer hier Winkel
 * setzt, prueft Durchgang 2 von halteAnker (gesetzte Kanaele geben nach).
 *
 * SCHWUNGBEIN: ein gestrecktes freies Bein steht bei sinkendem Becken im
 * Boden — dann hebt der Loeser die ganze Figur an (Rang 2 vor Rang 3), und
 * der Anker ist verfehlt. Wer den Anker halten will, hebt das freie Bein.
 */
const SCHWUNGBEIN = { hip_r: { flex: 25 }, knee_r: { bend: 45 } };

function timeline(anchors, weite = 0.22, hoehe = 1.00, joints = {}) {
  return {
    fps: 30, frameCount: 40, phases: [],
    overrides: {
      0: { joints, root: { pos: [0, hoehe === null ? null : 1.04, 0] }, ease: 'smooth' },
      20: { joints, root: { pos: [0, hoehe, weite] }, ease: 'smooth' },
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

test('Fussanker: bei 22 cm Wurzelfahrt bleibt der Fuss stehen, ohne Konflikt', async () => {
  // Was dieser Test frueher verlangte und warum er umgedreht wurde:
  //
  // Er forderte bei 22 cm ausdruecklich `weg >= 0.05` — der Fuss MUSSTE
  // mindestens 5 cm wandern, weil die Beinkette angeblich nicht reicht. Das
  // war eine Fehldiagnose. Gemessen am Xbot: hip_l.flex = −14° allein bringt
  // den Fuss auf 0,9 cm heran, die Gelenkgrenze liegt bei −30°. Die Kette
  // reicht muehelos.
  //
  // Der wahre Grund war ein Gewichtsfehler in der IK: der Haltungsrest stand
  // in Grad (Gewicht 4), der Ankerrest in Metern (Gewicht 100). 14° Huefte
  // kosteten 56, ein Fussfehler von 19 cm nur 19 — die Optimierung blieb nach
  // 3 Iterationen im Minimum des Haltungsziels stehen (18,9 cm Rest, auch bei
  // 1000 Iterationen). Seit der Haltungsrest ueber HALTUNG_HEBEL_JE_GRAD in
  // Meter umgerechnet wird und mit Gewicht 1 laeuft, loest dieselbe Aufgabe
  // in 8 Iterationen auf 0,04 mm.
  //
  // Toleranz ist ANKER_TOLERANZ_ANTEIL der Koerperhoehe — dieselbe Schwelle,
  // ab der ik.js einen Anker als gehalten zaehlt (AGENTS.md: alle Toleranzen
  // relativ zur Koerperhoehe).
  const { profil, skel } = await aufbau();
  const toleranz = skel.height * ANKER_TOLERANZ_ANTEIL;
  const knochen = skel.rollenKnochen.foot_l;

  // Keine Hoehe gesetzt: das Becken sinkt, so weit das Standbein es braucht
  // (am Xbot 3,4 cm). Das Schwungbein ist angehoben, sonst stuende es im
  // Boden und die Figur wuerde angehoben — siehe Negativfall in
  // bodenstand.test.mjs.
  const { frames, bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }], 0.22, null, SCHWUNGBEIN));

  const weg = fussweg(frames, knochen, 0, 20);
  assert.ok(weg < toleranz,
    `bei 22 cm Wurzelfahrt mit freier Huefte muss der Fuss unter `
    + `${(toleranz * 100).toFixed(2)} cm bleiben, gewandert ist er ${(weg * 100).toFixed(2)} cm`);

  assert.ok(bericht.hinweise.some((h) => /Anker foot_l/.test(h)),
    `der Bericht muss den gehaltenen Anker nennen: ${JSON.stringify(bericht.hinweise)}`);

  const konflikte = bericht.konflikt.filter((k) => k.bedingung === 'fussanker');
  assert.equal(konflikte.length, 0,
    `ein haltbarer Anker darf keinen Konflikt melden, gemeldet wurden ${konflikte.length}: `
    + `${JSON.stringify(konflikte.map((k) => k.meldung))}`);

  // Der andere Fuss bleibt frei: der Anker gilt nur fuer den genannten.
  const rechts = fussweg(frames, skel.rollenKnochen.foot_r, 0, 20);
  assert.ok(rechts > 0.15,
    `foot_r ist nicht verankert und muss weiter mitwandern, gewandert ist er ${(rechts * 100).toFixed(1)} cm`);
});

test('Fussanker, Negativfall: ein unerreichbarer Anker MUSS Konflikt mit Betrag melden', async () => {
  // 60 cm Wurzelfahrt bei aufrechtem Becken. Nachgemessen am Xbot steht
  // hip_l.flex dabei an seiner Grenze −30° und knee_l.bend an seiner Grenze
  // 0° (das Knie muesste ueberstrecken, um so weit nach vorn zu reichen);
  // 20,7 cm bleiben uebrig. Der Loeser darf das nicht stillschweigend
  // verfehlen — er haelt so weit er kann und schreibt den Rest in den Bericht
  // (AGENTS.md: "Der Loeser korrigiert, der Validator prueft die
  // Nachbedingung" — ein Loeser DARF scheitern, dann muss er es sagen).
  const { profil, skel } = await aufbau();
  const { frames, bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }], 0.60, 1.04));

  const weg = fussweg(frames, skel.rollenKnochen.foot_l, 0, 20);
  assert.ok(weg < 0.60,
    `auch unerreichbar muss der Anker besser sein als gar keiner (60 cm), `
    + `gewandert ist er ${(weg * 100).toFixed(1)} cm`);

  const konflikt = bericht.konflikt.find((k) => k.bedingung === 'fussanker');
  assert.ok(konflikt,
    `der Bericht muss den Ankerbruch als Konflikt melden: ${JSON.stringify(bericht.konflikt)}`);
  assert.match(konflikt.meldung, /\d/,
    'der Konflikt muss eine Zahl nennen (Betrag der Abweichung)');
  assert.ok(konflikt.betrag > skel.height * ANKER_TOLERANZ_ANTEIL,
    `der gemeldete Betrag muss ueber der Toleranz liegen, er ist ${konflikt.betrag} m`);

  // Der Grund wird gemessen, nicht behauptet: hier steht die Kette wirklich an
  // der Grenze, also DARF er "am Anschlag" heissen — und muss den Kanal nennen.
  assert.ok(konflikt.an_grenze.length > 0,
    `bei 60 cm muss mindestens ein Kanal an seiner Gelenkgrenze stehen, `
    + `gemeldet sind ${konflikt.an_grenze.length}`);
  assert.match(konflikt.grund, /Anschlag/,
    `der Grund muss den Anschlag nennen: „${konflikt.grund}"`);
});

test('Fussanker: gesetzte Beinwinkel geben nach — und das steht mit Zahl im Bericht', async () => {
  // Durchgang 2 von halteAnker. Der Agent hat hip_l.flex auf beiden
  // Schluesselbildern auf 0 gesetzt; damit ist der Kanal aus der freien Kette
  // ausgeschlossen (Durchgang 1). Die uebrigen 5 Kanaele halten den Fuss bei
  // 22 cm nicht — also kommt hip_l.flex doch dazu, und der Bericht sagt es.
  //
  // Stumm umschreiben waere der Fehler vom 1. September 2026: 11 gesetzte
  // Beinwinkel wurden um ueber 10° verbogen, ohne dass es irgendwo stand.
  const { profil, skel } = await aufbau();
  const toleranz = skel.height * ANKER_TOLERANZ_ANTEIL;
  const { frames, bericht } = loeseBewegung(profil, skel,
    timeline([{ foot: 'foot_l', von: 0, bis: 20 }], 0.22, 1.00,
      { hip_l: { flex: 0 }, ...SCHWUNGBEIN }));

  const weg = fussweg(frames, skel.rollenKnochen.foot_l, 0, 20);
  assert.ok(weg < toleranz,
    `der Fuss muss auch mit gesetzter Huefte halten (unter ${(toleranz * 100).toFixed(2)} cm), `
    + `gewandert ist er ${(weg * 100).toFixed(2)} cm`);

  const nachgeben = bericht.hinweise.find((h) => /nachgeben/.test(h));
  assert.ok(nachgeben,
    `der Bericht muss melden, dass gesetzte Winkel nachgegeben haben: `
    + `${JSON.stringify(bericht.hinweise)}`);
  assert.match(nachgeben, /\d+ von \d+ Frames/,
    `die Meldung muss nennen, in wie vielen Frames: „${nachgeben}"`);
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

test('Fussanker: was das Bein nicht hergibt, wird genau EINMAL gemeldet', async () => {
  // 40 cm Schrittweite bei aufrechtem Becken: die gemessene Beinkette reicht
  // dafuer nicht (13,9 cm bleiben uebrig). Ein Konflikt pro Anker, nicht einer
  // pro Frame — sonst ertrinkt der Agent in 21 identischen Meldungen.
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
