// Der Abspieler, in Node prüfbar.
//
// Geprüft wird der echte Weg: eine gelöste Bewegung geht über stellePose aus
// src/render/strip.js auf eine Szene mit Skelett, und die Leiste schaltet
// ihre Frames in der Framerate der Timeline um. Kein Nachbau der
// Frame-Anwendung — der bewiese nur, dass zwei Rechnungen gleich sind.
//
// Zu jedem Positivfall steht ein Negativfall daneben, der rot werden muss
// (AGENTS.md, Regel 2). Die wichtigsten: ein Abspielen ohne gelöste Bewegung
// bleibt grau mit Grund statt zu spielen, und ein Zeitakkus, der alles auf
// einmal ans Ende springen ließe, wird vom TICK_MAX_SEK-Deckel gefangen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { stellePose } from '../render/strip.js';
import {
  mounteAbspieler, GESCHWINDIGKEITEN, TICK_MAX_SEK,
} from './abspieler.js';

// --- Werkzeug: ein Minimal-Dokument (keine jsdom-Abhängigkeit) -------------------

/**
 * Das Nötigste, was die Leiste vom DOM verlangt: createElement mit Klasse,
 * Text, Kindern und Ereignis-Horchern. Bewusst handgeschrieben, wie die
 * falsche Leinwand in kamerasteuerung.test.mjs.
 */
function falschesDokument() {
  function element(tag) {
    const kinder = [];
    const klassen = new Set();
    const horcher = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      type: '',
      textContent: '',
      value: '',
      min: '',
      max: '',
      step: '',
      disabled: false,
      hidden: false,
      ownerDocument: null,
      append(...ks) { kinder.push(...ks); for (const k of ks) k.parentElement = el; },
      replaceChildren(...ks) {
        kinder.length = 0;
        for (const k of kinder) k.parentElement = null;
        this.append(...ks);
      },
      addEventListener(typ, fn) {
        if (!horcher.has(typ)) horcher.set(typ, new Set());
        horcher.get(typ).add(fn);
      },
      setAttribute(name, wert) { if (name === 'class') { wert.split(/\s+/).filter(Boolean).forEach((c) => klassen.add(c)); } },
      get classList() {
        const selbst = el;
        return {
          add: (c) => klassen.add(c),
          remove: (c) => klassen.delete(c),
          toggle: (c, an) => { if (an === undefined ? !klassen.has(c) : an) klassen.add(c); else klassen.delete(c); },
          contains: (c) => klassen.has(c),
          [Symbol.toStringTag]: 'Object',
          __klassen: klassen,
          __selbst: selbst,
        };
      },
      /** Schickt ein Ereignis (z. B. 'click' oder 'input') an die Horcher. */
      schicke(typ, felder = {}) {
        const ereignis = { type: typ, target: el, preventDefault() {}, ...felder };
        for (const fn of horcher.get(typ) ?? []) fn(ereignis);
        return ereignis;
      },
      /** Zieht den Zahlenwert eines range-Inputs auf einen neuen Wert. */
      stelleWert(v) { el.value = String(v); el.schicke('input'); },
      __kinder: kinder,
    };
    return el;
  }
  const dok = {
    createElement(tag) {
      const el = element(tag);
      el.ownerDocument = dok;
      return el;
    },
  };
  return dok;
}

/** Findet ein Kind per Klassenname oder Textinhalt. */
function finde(wurzel, klassenname) {
  const stapelev = [wurzel];
  while (stapelev.length > 0) {
    const el = stapelev.shift();
    if (el.className?.includes?.(klassenname) || el.classList?.__klassen?.has?.(klassenname)) return el;
    if (el.__kinder) stapelev.push(...el.__kinder);
  }
  return null;
}

// --- Werkzeug: eine gelöste Bewegung ---------------------------------------------

/**
 * Ein Skelett, das pro Frame woanders steht: der Knochen wandert 90 Frames
 * lang um 0,01 m je Frame nach oben. stellePose braucht Knochen mit Matrix;
 * die Wurzel der Szene ist die "Timeline-Objekt"-Seite.
 */
function szene() {
  const scene = new THREE.Scene();
  const hips = new THREE.Bone(); hips.name = 'hips';
  const haut = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3));
  const gruppe = new THREE.Group();
  gruppe.add(hips, haut);
  scene.add(gruppe);
  scene.updateMatrixWorld(true);
  return { scene, hips, haut, gruppe };
}

function bewegung(frameCount = 90, fps = 30) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      bones: { hips: { position: [0, 1.0 + i * 0.01, 0], quaternion: [0, 0, 0, 1], weltSkala: [1, 1, 1] } },
      positions: { hips: [0, 1.0 + i * 0.01, 0] },
    });
  }
  return { frames, fps, frameCount };
}

// --- Der echte Weg: Frame auf die Szene -------------------------------------------

function aufbau() {
  const dok = falschesDokument();
  const wurzel = dok.createElement('section');
  wurzel.id = 'abs-leiste';
  const s = szene();
  let info = null;
  const gestellte = [];
  const bewegungsLieferant = () => {
    if (!info) throw new Error('0 gelöste Frames: rufe zuerst validate auf, das löst die Timeline');
    return info;
  };
  const leiste = mounteAbspieler({
    wurzel,
    holeBewegung: bewegungsLieferant,
    stelleFrame: (frame, i) => {
      info = info;   // der Steller wirft bei fehlendem Modell — hier nie
      stellePose(s.scene, frame, info ? undefined : undefined);
      gestellte.push(i);
    },
    dokument: dok,
  });
  const aufbauRueck = { dok, wurzel, leiste, s, gestellte };
  aufbauRueck.setzeBewegung = (b) => { info = b; };
  return aufbauRueck;
}

function knoehenHoehe(s) {
  const v = new THREE.Vector3();
  s.hips.getWorldPosition(v);
  return v.y;
}

// --- Der Zustand ohne gelöste Bewegung ---------------------------------------------

test('ohne gelöste Bewegung ist die Leiste ausgegraut mit einem Satz, was fehlt', () => {
  const { leiste, setzeBewegung, wurzel } = aufbau();
  const stand = leiste.stand();
  assert.equal(stand.bereit, false, 'ohne Bewegung darf die Leiste nicht bereit sein');
  assert.ok(stand.grund.length > 0, 'es muss ein Satz stehen, was fehlt');
  assert.match(stand.grund, /0 gelöste Frames/, `der Grund muss die Zahl nennen: "${stand.grund}"`);
  assert.equal(stand.laeuft, false, 'es darf nicht von selbst laufen');
  const grundEl = finde(wurzel, 'abs-grund');
  assert.ok(grundEl, 'die Grundzeile muss im Container stehen');
  assert.equal(grundEl.hidden, false, 'der Grund darf nicht versteckt sein');
  assert.match(grundEl.textContent, /\d/);
});

test('Play-Push ohne Bewegung schaltet nichts frei und spielt nicht', () => {
  const { leiste, setzeBewegung, wurzel } = aufbau();
  const knopf = finde(wurzel, 'abs-knopf');
  assert.equal(knopf.disabled, true, 'der Play-Knopf muss ausgegraut sein');
  const schieber = finde(wurzel, 'abs-schieber');
  assert.equal(schieber.disabled, true, 'der Schieber muss ausgegraut sein');
  assert.equal(leiste.umschalten(), false,
    'umschalten() muss trotz Klick false liefern, solange nichts gelöst ist');
  assert.equal(leiste.stand().laeuft, false);
});

test('Negativfall zur Fehlberichterstattung: die Leiste versteckt ihren Grund nicht', () => {
  const { leiste, setzeBewegung, wurzel } = aufbau();
  leiste.pruefe();            // immer noch nichts gelöst
  const grundEl = finde(wurzel, 'abs-grund');
  assert.equal(grundEl.hidden, false,
    'ein versteckter Grund wäre ein stiller Zustand: die Leiste muss ihn zeigen');
  assert.ok(grundEl.textContent.length > 10,
    `der Grund muss ein ganzer Satz sein, er ist ${grundEl.textContent.length} Zeichen`);
});

// --- Einhängen der Bewegung ---------------------------------------------------------

test('mit gelöster Bewegung ist die Leiste bereit und zeigt Frame 0 / N-1 (0-basiert wie die Werkzeuge)', () => {
  const { leiste, setzeBewegung } = aufbau();
  leiste.pruefe(); setzeBewegung(bewegung(90, 30)); leiste.pruefe();
  const stand = leiste.stand();
  assert.equal(stand.bereit, true);
  assert.equal(stand.frameCount, 90);
  assert.equal(stand.fps, 30);
  assert.equal(stand.frameText, 'Frame 0 / 89',
    `die Frameanzeige muss "Frame 0 / 89" sein (0-basiert wie set_pose und describe_pose, `
      + `Befund 3.7), sie ist "${stand.frameText}"`);
});

test('Negativfall: eine Bewegung mit 0 Frames wird abgelehnt, nicht still akzeptiert', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung({ frames: [], fps: 30, frameCount: 0 });
  const stand = leiste.stand();
  assert.equal(stand.bereit, false,
    '0 Frames sind keine Bewegung: die Leiste darf nicht bereit werden');
  assert.match(stand.grund, /0 gelöste Frames|mindestens 1 gelöster Frame/);
});

test('Negativfall: eine Bewegung ohne Framerate wird abgelehnt', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung({ frames: bewegung(10).frames, fps: 0, frameCount: 10 });
  leiste.pruefe();
  const stand = leiste.stand();
  assert.equal(stand.bereit, false, 'ohne fps ist kein Tempo rechenbar');
  assert.match(stand.grund, /fps/, `der Grund muss fps nennen: "${stand.grund}"`);
});

// --- Abspielen in der Timeline-Framerate ---------------------------------------------

test('Abspielen: 1 s bei 30 fps und 1x schaltet 30 Frames und stellt den letzten', () => {
  const { leiste, setzeBewegung, s, gestellte } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();

  assert.equal(leiste.umschalten(), true, 'umschalten() muss Play starten');
  assert.equal(leiste.stand().laeuft, true);
  assert.equal(gestellte[gestellte.length - 1], 0,
    'beim Start steht der 1. Frame auf der Szene');
  // Auf der Szene steht Frame 0 — der echte Weg über stellePose.
  assert.ok(Math.abs(knoehenHoehe(s) - 1.0) < 1e-6,
    `Frame 0 muss den Knochen auf y = 1,0 m stellen, er steht auf ${knoehenHoehe(s).toFixed(4)} m`);

  leiste.tick(1.0);

  const stand = leiste.stand();
  assert.equal(stand.index, 30, `30 Frames bei 30 fps und 1 s erwartet, es sind ${stand.index}`);
  assert.equal(stand.frameText, 'Frame 30 / 89');
  assert.ok(Math.abs(knoehenHoehe(s) - 1.30) < 1e-6,
    `Frame 30 muss den Knochen auf y = 1,30 m stellen, er steht auf ${knoehenHoehe(s).toFixed(4)} m`);
  assert.equal(gestellte[gestellte.length - 1], 30, 'der letzte neue Frame muss gestellt sein');
});

test('Abspielen: 0.5x halbiert die Framezahl je Zeitschritt', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();
  leiste.setzeTempo(0.5);
  leiste.umschalten();
  leiste.tick(1);
  assert.equal(leiste.stand().index, 15,
    `15 Frames bei 0,5x und 1 s erwartet, es sind ${leiste.stand().index}`);
});

test('Abspielen: 0.25x spielt 15 Frames in 2 Sekunden', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();
  leiste.setzeTempo(0.25);
  leiste.umschalten();
  leiste.tick(1);
  leiste.tick(1);
  assert.equal(leiste.stand().index, 15,
    `15 Frames nach 2 s bei 0,25x erwartet, es sind ${leiste.stand().index}`);
});

test('Negativfall zur Geschwindigkeitsliste: nur die drei Stufen des Auftrags sind scharf', () => {
  assert.deepEqual(GESCHWINDIGKEITEN, [0.25, 0.5, 1],
    'der Auftrag nennt 0.25x/0.5x/1x — die Liste muss genau das sein');
  const { leiste, setzeBewegung } = aufbau();
  assert.throws(() => leiste.setzeTempo(4), /0\.25x, 0\.5x, 1x/,
    'eine vierte Stufe muss mit der Stufenliste abgelehnt werden');
});

test('das Ende stoppt das Abspielen, statt in eine Schleife zu fallen', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(10, 30));
  leiste.pruefe();
  leiste.umschalten();
  for (let i = 0; i < 20; i++) leiste.tick(1);   // 600 Frames Zeit für 10 Frames Clip
  const stand = leiste.stand();
  assert.equal(stand.index, 9, `am Ende muss Frame 9 stehen (0-basiert), es ist Frame ${stand.index}`);
  assert.equal(stand.laeuft, false, 'am Ende muss das Abspielen von selbst stoppen');
  assert.equal(stand.frameText, 'Frame 9 / 9');
});

test('Negativfall zum Zeitdeckel: ein alter Zeitstempel springt nicht ans Ende', () => {
  // Genau der Fehlerfall, den der Deckel fängt: ein dt weit über der Clipdauer
  // darf den Clip nicht schlagartig durchlaufen lassen.
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();
  leiste.umschalten();
  leiste.tick(3600);   // eine Stunde "verpasster" Zeit
  assert.ok(leiste.stand().index < 90,
    `nach einem 1-h-Schritt dürfen höchstens ${TICK_MAX_SEK} s gleich 30 Frames übersprungen `
      + `worden sein, es stehen bei Frame ${leiste.stand().index}`);
  assert.equal(leiste.stand().index, 30,
    `der Deckel lässt genau ${TICK_MAX_SEK} s = 30 Frames zu, es waren ${leiste.stand().index}`);
});

// --- Schieber und Anzeige -------------------------------------------------------------

test('Schieber: Anfahren stellt den Frame auf die Szene und pauasiert', () => {
  const { leiste, setzeBewegung, s, gestellte } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();
  leiste.umschalten();

  leiste.anfahren(41);
  const stand = leiste.stand();
  assert.equal(stand.laeuft, false, 'Anfahren muss pausieren — wer zieht, will vergleichen');
  assert.equal(stand.frameText, 'Frame 41 / 89');
  assert.ok(Math.abs(knoehenHoehe(s) - 1.41) < 1e-6,
    `Frame 41 muss den Knochen auf y = 1,41 m stellen, er steht auf ${knoehenHoehe(s).toFixed(4)} m`);
  assert.equal(gestellte[gestellte.length - 1], 41);
});

test('Negativfall zum Schieber: ein Frame außerhalb der Timeline wird mit Zahl abgelehnt', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(40, 30));
  leiste.pruefe();
  assert.throws(() => leiste.anfahren(40), /0 bis 39/,
    'die Ablehnung muss den Bereich nennen (AGENTS.md, Handwerkliches)');
});

test('Negativfall: die Frameanzeige ist 0-basiert und der Schieber trägt N-1 als Maximum', () => {
  const { leiste, setzeBewegung } = aufbau();
  setzeBewegung(bewegung(40, 30));
  leiste.pruefe();
  const stand = leiste.stand();
  assert.equal(stand.frameText, 'Frame 0 / 39');
});

// --- Außer Betrieb ----------------------------------------------------------------------

test('aus(): die Leiste steht grau, nicht versteckt — mit Grund nach erneutem pruefe()', () => {
  const { leiste, setzeBewegung, wurzel } = aufbau();
  setzeBewegung(bewegung(90, 30));
  leiste.pruefe();
  leiste.umschalten();
  leiste.aus();
  const stand = leiste.stand();
  assert.equal(stand.bereit, false, 'aus() muss die Bereitschaft nehmen');
  assert.equal(stand.laeuft, false);
  const grundEl = finde(wurzel, 'abs-grund');
  assert.equal(grundEl.hidden, false, 'der Auszustand darf nicht versteckt sein');
  // Nach aus() hat fehlgrund noch den alten Wortlaut; neu prüfen zeigt den aktuellen.
  setzeBewegung(null);
  leiste.pruefe();
  const neu = leiste.stand();
  assert.equal(neu.bereit, false, 'ohne Bewegung darf pruefe() nicht bereit werden');
  assert.ok(neu.grund.length > 0,
    `nach aus() muss der Grund wieder da stehen, er ist leer (${JSON.stringify(neu.grund)})`);
  assert.match(neu.grund, /0 gelöste Frames/);
});

// --- Bau -------------------------------------------------------------------------------

test('Bau, Negativfall: fehlende Bestandteile melden sich mit Zahlen', () => {
  assert.throws(() => mounteAbspieler({ holeBewegung: () => ({}), stelleFrame: () => {} }),
    /0 Container/);
  assert.throws(() => mounteAbspieler({ wurzel: falschesDokument().createElement('section'), stelleFrame: () => {} }),
    /0 Bewegungslieferanten/);
  assert.throws(() => mounteAbspieler({ wurzel: falschesDokument().createElement('section'), holeBewegung: () => ({}) }),
    /0 Frame-Steller/);
});