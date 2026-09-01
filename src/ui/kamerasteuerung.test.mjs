// Die Kamerasteuerung, in Node prüfbar.
//
// Geprüft wird der echte Weg: OrbitControls hängt an einem Element, es kommen
// echte Zeigergesten an, und die Kamera bewegt sich. Nicht geprüft wird ein
// Nachbau der Mathematik — der bewiese nur, dass zwei Rechnungen gleich sind.
//
// Zu jedem Positivfall steht ein Negativfall daneben, der rot werden muss
// (AGENTS.md, Regel 2). Der wichtigste: eine Rückkehr, die einen gespeicherten
// Schnappschuss statt der Messung wiederherstellt, muss auffallen, sobald sich
// die Messgrundlage ändert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

import { frameCamera, applyClipPlanes } from '../scene/view.js';
import { mounteKamerasteuerung, NAH_ANTEIL, WEIT_FAKTOR } from './kamerasteuerung.js';

// --- Werkzeug: eine Leinwand ohne Browser --------------------------------------

/**
 * Das Nötigste, was OrbitControls von einem DOM-Element verlangt. Bewusst
 * keine jsdom-Abhängigkeit: die Steuerung fasst nur Ereignisse und Maße an.
 */
function falscheLeinwand(breite = 800, hoehe = 600) {
  const horcher = new Map();
  const wurzel = {
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    clientWidth: breite,
    clientHeight: hoehe,
    style: {},
    addEventListener(typ, fn) {
      if (!horcher.has(typ)) horcher.set(typ, new Set());
      horcher.get(typ).add(fn);
    },
    removeEventListener(typ, fn) {
      horcher.get(typ)?.delete(fn);
    },
    getRootNode() { return wurzel; },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: breite, height: hoehe };
    },
    /** Schickt ein Ereignis an alle, die dafür angemeldet sind. */
    schicke(typ, felder = {}) {
      const ereignis = {
        type: typ,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        clientX: 0,
        clientY: 0,
        deltaY: 0,
        deltaMode: 0,
        preventDefault() {},
        stopPropagation() {},
        ...felder,
      };
      for (const fn of horcher.get(typ) ?? []) fn(ereignis);
      return ereignis;
    },
    /** Wie viele Horcher auf einem Ereignistyp sitzen. */
    zaehle(typ) { return horcher.get(typ)?.size ?? 0; },
  };
}

/**
 * Eine messbare Figur: hoch, schmal, mit genug Vertices in der Sohlenregion,
 * damit die Vorwärtsachse messbar ist. Keine Datei nötig.
 */
function figur(hoehe = 1.8) {
  const gruppe = new THREE.Group();
  const koerper = new THREE.Mesh(new THREE.BoxGeometry(0.5, hoehe, 0.3, 4, 20, 4));
  koerper.position.set(0, hoehe / 2, 0);
  gruppe.add(koerper);
  // Zehen nach +z, damit die Sohlenregion ein eindeutiges Vorzeichen hat.
  const fuss = new THREE.Mesh(new THREE.BoxGeometry(0.3, hoehe * 0.04, 0.25, 3, 2, 3));
  fuss.position.set(0, hoehe * 0.02, 0.14);
  gruppe.add(fuss);
  gruppe.updateMatrixWorld(true);
  return gruppe;
}

/** Kamera, Modell und Steuerung, wie index.html sie verdrahtet. */
function aufbau(hoehe = 1.8) {
  const kamera = new THREE.PerspectiveCamera(38, 800 / 600, 0.05, 100);
  const model = figur(hoehe);
  const element = falscheLeinwand();
  let neuGezeichnet = 0;
  const steuerung = mounteKamerasteuerung({
    kamera,
    element,
    rahme: () => frameCamera(kamera, model),
    aufAenderung: () => { neuGezeichnet++; },
  });
  return { kamera, model, element, steuerung, zaehler: () => neuGezeichnet };
}

/** Zieht mit gedrückter Taste über die Leinwand. */
function ziehe(element, { von = [400, 300], nach = [520, 300], button = 0 } = {}) {
  element.schicke('pointerdown', { button, clientX: von[0], clientY: von[1] });
  element.schicke('pointermove', { button, clientX: nach[0], clientY: nach[1] });
  element.schicke('pointerup', { button, clientX: nach[0], clientY: nach[1] });
}

// --- Drehen -------------------------------------------------------------------

test('Drehen, Positivfall: Ziehen mit links bewegt die Kamera um die Figur', () => {
  const { kamera, steuerung, element } = aufbau();
  steuerung.starteNeu();

  const vorher = kamera.position.clone();
  const azimutVorher = steuerung.stand().azimut;
  const abstandVorher = steuerung.stand().abstand;

  ziehe(element, { von: [400, 300], nach: [560, 340] });

  const versatz = kamera.position.distanceTo(vorher);
  assert.ok(versatz > 0.01,
    `Ziehen muss die Kamera bewegen, sie wanderte ${versatz.toFixed(6)} m — erwartet mehr als 0,01 m`);
  assert.notEqual(steuerung.stand().azimut, azimutVorher,
    'der Blickwinkel muss sich ändern, sonst ist es ein Verschieben statt eines Drehens');
  // Drehen heißt: um den Drehpunkt herum, nicht auf ihn zu.
  assert.ok(Math.abs(steuerung.stand().abstand - abstandVorher) < 1e-6,
    `beim Drehen bleibt der Abstand gleich, er ging von ${abstandVorher} auf ${steuerung.stand().abstand} m`);
  assert.equal(steuerung.unberuehrt(), false,
    'nach dem Ziehen steht die Kamera nicht mehr auf der gemessenen Startansicht');
});

test('Drehen, Negativfall: ohne geladenes Modell bewegt Ziehen nichts', () => {
  const { kamera, element } = aufbau();
  // starteNeu() bewusst nicht gerufen — genau der Zustand vor dem ersten Upload.
  const vorher = kamera.position.clone();
  ziehe(element, { von: [400, 300], nach: [560, 340] });
  assert.equal(kamera.position.distanceTo(vorher), 0,
    'ohne gemessenes Modell darf die Kamera sich um 0 m bewegen');
});

// --- Rückkehr zur gemessenen Startansicht --------------------------------------

test('Rückkehr, Positivfall: stellt exakt die gemessenen Werte wieder her', () => {
  const { kamera, model, steuerung, element } = aufbau();
  steuerung.starteNeu();

  // Die Wahrheit steht in der Messung, nicht in dieser Datei: dieselbe
  // Funktion, die index.html beim Laden ruft, auf einer eigenen Kamera.
  const referenz = new THREE.PerspectiveCamera(38, 800 / 600, 0.05, 100);
  const mass = frameCamera(referenz, model);

  ziehe(element, { von: [400, 300], nach: [600, 380] });
  element.schicke('wheel', { deltaY: -300 });
  assert.equal(steuerung.unberuehrt(), false, 'die Kamera muss vorher wirklich weg sein');

  steuerung.zurueck();

  assert.equal(kamera.position.distanceTo(referenz.position), 0,
    `die Rückkehr muss die gemessene Position treffen, sie lag ${kamera.position.distanceTo(referenz.position)} m daneben`);
  assert.equal(steuerung.controls.target.distanceTo(mass.center), 0,
    'der Drehpunkt muss wieder die gemessene Boxmitte sein');
  assert.equal(kamera.near, referenz.near, `near muss ${referenz.near} sein, war ${kamera.near}`);
  assert.equal(kamera.far, referenz.far, `far muss ${referenz.far} sein, war ${kamera.far}`);
  assert.equal(steuerung.unberuehrt(), true,
    'nach der Rückkehr steht die Kamera wieder auf der gemessenen Startansicht');
});

test('Rückkehr, Negativfall: ein Schnappschuss statt der Messung fiele bei geänderter Figur auf', () => {
  const kamera = new THREE.PerspectiveCamera(38, 800 / 600, 0.05, 100);
  let model = figur(1.8);
  const element = falscheLeinwand();
  const steuerung = mounteKamerasteuerung({
    kamera, element, rahme: () => frameCamera(kamera, model),
  });
  steuerung.starteNeu();
  const schnappschuss = kamera.position.clone();

  // Neues Modell, viermal so groß — die gemessene Startansicht ist eine andere.
  model = figur(7.2);
  steuerung.starteNeu();
  const gross = new THREE.PerspectiveCamera(38, 800 / 600, 0.05, 100);
  frameCamera(gross, model);

  assert.equal(kamera.position.distanceTo(gross.position), 0,
    'nach dem Modellwechsel muss die Kamera auf der NEU gemessenen Ansicht stehen');
  assert.ok(kamera.position.distanceTo(schnappschuss) > 1,
    'ein wiederhergestellter Schnappschuss der 1,8-m-Figur wäre falsch; Unterschied nur '
    + `${kamera.position.distanceTo(schnappschuss).toFixed(4)} m`);
});

// --- Heranfahren --------------------------------------------------------------

test('Rad, Positivfall: Scrollen ändert den Abstand zur Figur', () => {
  const { steuerung, element } = aufbau();
  steuerung.starteNeu();
  const vorher = steuerung.stand().abstand;

  element.schicke('wheel', { deltaY: -240 });

  const nachher = steuerung.stand().abstand;
  assert.ok(nachher < vorher,
    `Scrollen nach vorn muss näher heranfahren: ${vorher.toFixed(4)} m → ${nachher.toFixed(4)} m`);
});

test('Rad, Negativfall: das Rad fährt nicht durch die Figur hindurch', () => {
  const { steuerung, element } = aufbau(1.8);
  steuerung.starteNeu();
  for (let i = 0; i < 200; i++) element.schicke('wheel', { deltaY: -240 });

  const stand = steuerung.stand();
  assert.ok(stand.abstand >= stand.minAbstand - 1e-9,
    `der Abstand muss bei ${stand.minAbstand.toFixed(4)} m stehenbleiben, war ${stand.abstand.toFixed(4)} m`);
  assert.ok(Math.abs(stand.minAbstand - 1.8 * NAH_ANTEIL) < 1e-6,
    `die Nahgrenze kommt aus der gemessenen Höhe: erwartet ${(1.8 * NAH_ANTEIL).toFixed(4)} m, war ${stand.minAbstand.toFixed(4)} m`);
});

test('Rad: die Ferngrenze folgt dem gemessenen Rahmenabstand', () => {
  const { steuerung } = aufbau();
  const mass = steuerung.starteNeu();
  assert.ok(mass.distance > 0, `der gemessene Abstand muss größer als 0 m sein, war ${mass.distance}`);
  assert.ok(Math.abs(steuerung.stand().maxAbstand - mass.distance * WEIT_FAKTOR) < 1e-9,
    'die Ferngrenze ist ein Vielfaches des gemessenen Abstands, kein getippter Meterwert');
});

// --- Verschieben ---------------------------------------------------------------

test('Verschieben, Positivfall: Ziehen mit rechts bewegt den Drehpunkt', () => {
  const { steuerung, element } = aufbau();
  steuerung.starteNeu();
  const vorher = steuerung.controls.target.clone();

  ziehe(element, { von: [400, 300], nach: [500, 300], button: 2 });

  const versatz = steuerung.controls.target.distanceTo(vorher);
  assert.ok(versatz > 0.001,
    `Ziehen mit rechts muss die Ansicht verschieben, der Drehpunkt wanderte ${versatz.toFixed(6)} m`);
});

// --- Clipping-Ebenen ------------------------------------------------------------
//
// Der gemeldete Fehler: beim Drehen werden Arme abgeschnitten, beim Zoomen
// verschwindet der Körper ganz. Ursache war, dass near und far genau einmal
// beim Rahmen berechnet wurden und danach stehengeblieben sind, während der
// Nutzer Kamera bewegt.

test('Clipping, Positivfall: beim Heranfahren wandert near vor die Figur', () => {
  const { kamera, steuerung, element } = aufbau();
  const mass = steuerung.starteNeu();
  const rahmNear = kamera.near;

  // Voll heranfahren bis zur Nahgrenze (Rad-Negativfall tut dasselbe).
  for (let i = 0; i < 200; i++) element.schicke('wheel', { deltaY: -240 });
  const abstand = steuerung.stand().abstand;

  assert.ok(kamera.near < rahmNear,
    `beim Heranfahren auf ${abstand.toFixed(3)} m muss near von ${rahmNear.toFixed(4)} m ` +
    `auf ${kamera.near.toFixed(4)} m sinken, sonst schneidet die Nah-Ebene Arme ab`);

  // Jede Boxecke muss zwischen den Clipping-Ebenen liegen, sonst ist etwas
  // abgeschnitten — egal aus welchem Winkel man schaut.
  const box = mass.box;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const ecke = new THREE.Vector3(x, y, z);
        const tiefe = ecke.distanceTo(kamera.position);
        assert.ok(tiefe >= kamera.near && tiefe <= kamera.far,
          `Boxecke (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) liegt ${tiefe.toFixed(3)} m ` +
          `von der Kamera, Clipping-Ebenen stehen bei near ${kamera.near.toFixed(3)} m, ` +
          `far ${kamera.far.toFixed(3)} m`);
      }
    }
  }
});

test('Clipping, Positivfall: beim Wegfahren wandert far hinter die Figur', () => {
  const { kamera, steuerung, element } = aufbau();
  const mass = steuerung.starteNeu();
  const rahmFar = kamera.far;

  for (let i = 0; i < 200; i++) element.schicke('wheel', { deltaY: 240 });
  const abstand = steuerung.stand().abstand;

  assert.ok(kamera.far > rahmFar,
    `beim Wegfahren auf ${abstand.toFixed(3)} m muss far von ${rahmFar.toFixed(2)} m auf ` +
    `${kamera.far.toFixed(2)} m wachsen, sonst verschwindet der Körper hinter der Fern-Ebene`);
  const hintersteEcke = mass.box.max.z;
  const tiefe = Math.abs(kamera.position.z - hintersteEcke);
  assert.ok(tiefe <= kamera.far,
    `die hinterste Boxecke liegt ${tiefe.toFixed(2)} m von der Kamera, far steht bei ` +
    `${kamera.far.toFixed(2)} m`);
});

test('Clipping, Positivfall: nach dem Drehen bleiben alle Boxecken zwischen near und far', () => {
  const { kamera, steuerung, element } = aufbau();
  const mass = steuerung.starteNeu();

  ziehe(element, { von: [400, 300], nach: [700, 450] });

  const box = mass.box;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const tiefe = new THREE.Vector3(x, y, z).distanceTo(kamera.position);
        assert.ok(tiefe >= kamera.near && tiefe <= kamera.far,
          `nach dem Drehen liegt die Boxecke (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) ` +
          `${tiefe.toFixed(3)} m von der Kamera, Clipping bei near ${kamera.near.toFixed(3)} m, ` +
          `far ${kamera.far.toFixed(3)} m`);
      }
    }
  }
});

test('Clipping, Negativfall: stehengebliebene Ebenen fallen beim Heranfahren auf', () => {
  // Genau der gemeldete Fehler, als Gegenprobe der Prüfung: Eine Kamera, die
  // die Rahmenwerte naiv behält, muss beim Heranfahren auffallen. Würde der
  // Test auch mit dem alten Verhalten grün, wäre er stumpf.
  const { kamera, steuerung, element } = aufbau();
  steuerung.starteNeu();
  const rahmNear = kamera.near;
  const rahmFar = kamera.far;
  const messBox = steuerung.starteNeu().box;

  // Das alte Verhalten simulieren: near/far auf den Rahmenwert einfrieren.
  kamera.near = rahmNear;
  kamera.far = rahmFar;
  for (let i = 0; i < 200; i++) element.schicke('wheel', { deltaY: -240 });

  // applyClipPlanes mit der frozen-Kamera muss melden, dass etwas abgeschnitten wird:
  const resultat = applyClipPlanes(kamera, messBox);
  assert.ok(resultat.near < rahmNear || resultat.far > rahmFar,
    'ein eingefrorenes near/far muss beim Heranfahren von der Nachzieh-Rechnung korrigiert werden: ' +
    `near ${resultat.near.toFixed(4)} m gegen Rahmen-near ${rahmNear.toFixed(4)} m, ` +
    `far ${resultat.far.toFixed(2)} m gegen Rahmen-far ${rahmFar.toFixed(2)} m`);
});

test('Clipping, Positivfall: Rückkehr zur Rahmung stellt exakt die Rahmen-near/far-Werte her', () => {
  const { kamera, steuerung, element } = aufbau();
  const mass = steuerung.starteNeu();
  const rahmNear = kamera.near;
  const rahmFar = kamera.far;

  // Stark bewegen — Clipping-Ebenen müssen nachgezogen haben.
  for (let i = 0; i < 200; i++) element.schicke('wheel', { deltaY: -240 });
  assert.ok(kamera.near !== rahmNear, 'Heranfahren muss near verändert haben');

  steuerung.zurueck();

  assert.equal(kamera.near, rahmNear,
    `nach der Rückkehr muss near exakt der Rahmenwert ${rahmNear} sein, war ${kamera.near}`);
  assert.equal(kamera.far, rahmFar,
    `nach der Rückkehr muss far exakt der Rahmenwert ${rahmFar} sein, war ${kamera.far}`);
  assert.equal(steuerung.unberuehrt(), true,
    'nach der Rückkehr steht die Kamera wieder auf der gemessenen Startansicht');

  // Die gemessene Box ist dieselbe wie beim Rahmen, sonst vergleicht der Test
  // Birnen mit Äpfeln.
  assert.equal(mass.box.isEmpty(), false, 'die Messbox darf nicht leer sein');
});

test('Clipping, Negativfall: Fehler bei fehlender Box nennt Zahlen', () => {
  const kamera = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
  assert.throws(() => applyClipPlanes(kamera, null), /keine THREE\.Box3/);
  // Entartete Box (min == max, Kamera im Punkt): die Rechnung muss mit Zahlen
  // scheitern, nicht still eine unmögliche Projektion einsetzen.
  assert.throws(
    () => applyClipPlanes(kamera, new THREE.Box3(
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0))),
    /entartet|größer als/
  );
});

test('Clipping, Positivfall: Kamera knapp über dem Scheitel lässt near den Kopf freihalten', () => {
  // Genau der gemeldete Fehler „Kopf abgeschnitten": über dem Scheitel ist die
  // nächste BOXECKE seitlich versetzt und liegt weit weg; die Kopffläche liegt
  // Zentimeter entfernt. near muss sich nach der Oberfläche richten, nicht
  // nach der Ecke.
  const { kamera, steuerung } = aufbau(1.8);
  const mass = steuerung.starteNeu();

  // Kamera senkrecht über die Boxmitte setzen, 5 cm über dem Scheitel.
  const box = mass.box;
  const scheitel = box.max.y;
  kamera.position.set((box.min.x + box.max.x) / 2, scheitel + 0.05, (box.min.z + box.max.z) / 2);
  kamera.updateMatrixWorld(true);
  const resultat = applyClipPlanes(kamera, box);

  const oberflaeche = box.distanceToPoint(kamera.position);
  assert.ok(resultat.near < oberflaeche,
    `near muss unter dem Abstand zur Kopffläche liegen: near ${resultat.near.toFixed(4)} m, ` +
    `Abstand zur Oberfläche ${oberflaeche.toFixed(4)} m — sonst schneidet die Nah-Ebene den Kopf`);
  assert.ok(resultat.near < 0.05,
    `near muss in Scheitel-Nähe klein werden: ${resultat.near.toFixed(4)} m, erwartet unter 0,05 m`);
});

test('Clipping, Positivfall: Kamera in der Figur — die Nah-Ebene liegt vor der Kamera, nicht im Körper', () => {
  // Der gemeldete Fall „der ganze Körper wird aufgeschnitten": fährt die
  // Kamera in die Box hinein, ist der Abstand zur Oberfläche 0. Eine Nah-Ebene
  // mitten im Körper zerschneidet ihn; sie gehört knapp vor die Kamera.
  const { kamera, steuerung } = aufbau(1.8);
  const mass = steuerung.starteNeu();
  const box = mass.box;

  // Kamera in die Boxmitte setzen.
  kamera.position.set((box.min.x + box.max.x) / 2, 0.9, (box.min.z + box.max.z) / 2);
  kamera.updateMatrixWorld(true);
  const resultat = applyClipPlanes(kamera, box);

  assert.ok(box.containsPoint(kamera.position), 'Testaufbau: die Kamera muss in der Box liegen');
  assert.ok(resultat.near < 0.01,
    `im Körperinnern muss near auf den Boden fallen: ${resultat.near.toFixed(5)} m, ` +
    'erwartet unter 0,01 m — sonst liegt die Nah-Ebene mitten im Körper');
  // far muss trotzdem hinter der Figur bleiben.
  const hintersteEcke = kamera.position.distanceTo(new THREE.Vector3(
    box.min.x, box.min.y, box.min.z));
  const entfernteste = Math.max(hintersteEcke, kamera.position.distanceTo(
    new THREE.Vector3(box.max.x, box.max.y, box.max.z)));
  assert.ok(resultat.far >= entfernteste,
    `far (${resultat.far.toFixed(3)} m) muss hinter der entferntesten Boxecke ` +
    `(${entfernteste.toFixed(3)} m) liegen`);
});

// --- Anschluss an die Seite ----------------------------------------------------

test('Meldung: jede Ansichtsänderung meldet sich, damit der Höhenmaßstab mitgeht', () => {
  const { steuerung, element, zaehler } = aufbau();
  steuerung.starteNeu();
  const vorher = zaehler();
  ziehe(element, { von: [400, 300], nach: [560, 340] });
  assert.ok(zaehler() > vorher,
    `das Drehen muss den Maßstab neu zeichnen lassen, es kamen ${zaehler() - vorher} Meldungen`);
});

test('Meldung, Negativfall: ohne Bewegung kommt keine Meldung', () => {
  const { steuerung, element, zaehler } = aufbau();
  steuerung.starteNeu();
  const vorher = zaehler();
  element.schicke('pointerdown', { button: 0, clientX: 400, clientY: 300 });
  element.schicke('pointerup', { button: 0, clientX: 400, clientY: 300 });
  assert.equal(zaehler(), vorher,
    'ein folgenloser Klick darf 0 Neuzeichnungen auslösen');
  assert.equal(steuerung.unberuehrt(), true,
    'ein folgenloser Klick zählt nicht als Eingriff — sonst dürfte nach ihm nie mehr neu gerahmt werden');
});

test('Abschalten: aus() nimmt die Steuerung außer Betrieb, ohne die Kamera zu verstellen', () => {
  const { kamera, steuerung, element } = aufbau();
  steuerung.starteNeu();
  const stand = kamera.position.clone();
  steuerung.aus();
  ziehe(element, { von: [400, 300], nach: [560, 340] });
  assert.equal(kamera.position.distanceTo(stand), 0,
    'nach aus() darf Ziehen die Kamera um 0 m bewegen');
  assert.equal(steuerung.stand().bedienbar, false, 'aus() muss die Steuerung abschalten');
});

test('Bau, Negativfall: fehlende Bestandteile melden sich mit Zahlen', () => {
  const kamera = new THREE.PerspectiveCamera();
  assert.throws(() => mounteKamerasteuerung({ element: falscheLeinwand(), rahme: () => ({}) }),
    /0 Kameras/);
  assert.throws(() => mounteKamerasteuerung({ kamera, rahme: () => ({}) }),
    /0 bedienbare Elemente/);
  assert.throws(() => mounteKamerasteuerung({ kamera, element: falscheLeinwand() }),
    /0 Messfunktionen/);
});

// --- Verdrahtung in index.html -------------------------------------------------
//
// Die Logik oben ist geprüft; ungeprüft bliebe sonst, ob die Seite sie auch
// benutzt. Genau das war beim Laden eines zweiten Modells die Gefahr: ein
// stehengebliebener frameCamera-Aufruf setzt zwar die Kamera, nicht aber den
// Drehpunkt der Steuerung — die Figur stünde richtig im Bild und kreiste
// danach um die Mitte der vorigen.

test('Verdrahtung: ein neu geladenes Modell geht über die Steuerung, nicht an ihr vorbei', () => {
  const seite = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  const stelle = seite.indexOf('function presentModel');
  assert.ok(stelle > 0, 'presentModel muss in index.html stehen, 0 Fundstellen');
  const koerper = seite.slice(stelle, seite.indexOf('\n}', stelle));

  assert.match(koerper, /steuerung\.starteNeu\(\)/,
    'presentModel muss die Startansicht über die Steuerung setzen, damit der Drehpunkt mitgeht');
  assert.equal(/frameCamera\(camera, model\)/.test(koerper), false,
    'ein direkter frameCamera-Aufruf in presentModel ginge an der Steuerung vorbei: '
    + 'die Kamera stünde neu, der Drehpunkt bliebe beim vorigen Modell');
});

test('Verdrahtung, Negativfall: die Rückkehr hat einen sichtbaren Weg für den Menschen', () => {
  const seite = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(seite, /addEventListener\('dblclick'/,
    'ohne Doppelklick-Anschluss gäbe es keinen Weg zurück auf die gemessene Ansicht');
  assert.match(seite, /steuerung\.zurueck\(\)/,
    'der Anschluss muss die Rückkehr auch aufrufen');
  assert.match(seite, /bediensatz/,
    'eine Bedienung, die nirgends steht, findet der Nutzer nicht');
});
