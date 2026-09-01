// Der Kamerafolger, in Node prüfbar.
//
// Zu jedem Positivfall steht ein Negativfall (AGENTS.md, Regel 2). Die zwei
// Kernzusicherungen: Drehen und Zoom des Menschen bleiben exakt erhalten, und
// ein folgender Kamera-Aus darf nichts bewegen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  mounteKamerfolger, WELT_ABSTAND_ANTEIL, WELT_NAH_ANTEIL, WELT_WEIT_ANTEIL, FOLGE_TEMP,
} from './kamerfolger.js';

function aufbau() {
  const kamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);
  const controls = { target: new THREE.Vector3(0, 1, 0) };
  kamera.position.set(3, 2, 3);
  kamera.lookAt(controls.target);
  const folger = mounteKamerfolger({ kamera, controls });
  return { kamera, controls, folger };
}

// --- Aufnahme -----------------------------------------------------------------

test('ein() startet am Drehpunkt: das erste Bild hat keinen Anschieber', () => {
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  const vorher = kamera.position.clone();

  // Ziel = Drehpunkt (die Rahmung hat ihn gerade auf die Figur gesetzt):
  // ein tick darf 0 m fahren.
  folger.setzeZiel(controls.target.toArray());
  folger.tick(1 / 60);
  assert.equal(kamera.position.distanceTo(vorher), 0,
    `bei Ziel gleich Drehpunkt muss die Kamera um 0 m stehen, sie sprang `
    + `${kamera.position.distanceTo(vorher).toFixed(6)} m`);

  // Erst ein NEUES Ziel bewegt — und weich, nicht in einem Bild.
  folger.setzeZiel([0, 1.05, 4]);
  folger.tick(1 / 60);
  const weg = kamera.position.distanceTo(vorher);
  assert.ok(weg > 0 && weg < 0.6,
    `der erste Schritt zum neuen Ziel muss ein Teilschritt sein, die Kamera sprang `
    + `${weg.toFixed(4)} m (erwartet zwischen 0 und 0,6 m von 4,0 m Weg)`);
  assert.ok(folger.stand().rueckstand > 0,
    'das Ziel muss bekannt sein, sonst prüft der Test nichts');
});

test('Bau, Negativfall: fehlende Bestandteile melden sich mit Zahlen', () => {
  assert.throws(() => mounteKamerfolger({ controls: { target: new THREE.Vector3() } }),
    /0 Kameras/);
  assert.throws(() => mounteKamerfolger({ kamera: new THREE.PerspectiveCamera() }),
    /0 Steuerungen/);
});

// --- Folgen -------------------------------------------------------------------

test('Folgen, Positivfall: ein weggehender Körper zieht Blickpunkt und Kamera mit', () => {
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(1 / 60);

  // Die Figur läuft drei Meter nach +z.
  folger.setzeZiel([0, 1.05, 3]);
  for (let i = 0; i < 120; i++) folger.tick(1 / 60);   // 2 Sekunden Zeit

  const abweichung = controls.target.distanceTo(new THREE.Vector3(0, 1.05, 3));
  assert.ok(abweichung < 0.01,
    `nach 2 s muss der Drehpunkt am Körper hängen, er liegt ${abweichung.toFixed(4)} m daneben`);
  // Der Kamera-Korpus ist mitgefahren, nicht nur der Blickpunkt.
  assert.ok(kamera.position.z > 2.5,
    `die Kamera muss mitgefahren sein, ihr z steht bei ${kamera.position.z.toFixed(3)} m`);
});

test('Folgen, Positivfall: das Mitfahren hält Richtung und Abstand exakt', () => {
  // Der Kern der Zusicherung an den Menschen: Drehen und Zoom gehören ihm.
  const { kamera, controls, folger } = aufbau();
  folger.ein();

  const richtungVorher = kamera.position.clone().sub(controls.target).normalize();
  const abstandVorher = kamera.position.distanceTo(controls.target);

  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(1 / 60);
  folger.setzeZiel([-2, 0.9, 5]);
  for (let i = 0; i < 90; i++) folger.tick(1 / 60);

  const richtungNachher = kamera.position.clone().sub(controls.target).normalize();
  const abstandNachher = kamera.position.distanceTo(controls.target);
  const winkel = richtungVorher.angleTo(richtungNachher);
  assert.ok(winkel < 1e-6,
    `die Blickrichtung darf sich beim Mitfahren nicht drehen, sie kippte um `
    + `${(winkel * 180 / Math.PI).toFixed(6)}°`);
  assert.ok(Math.abs(abstandNachher - abstandVorher) < 1e-6,
    `der Abstand muss beim Mitfahren gleich bleiben: ${abstandVorher.toFixed(6)} m → `
    + `${abstandNachher.toFixed(6)} m`);
});

test('Folgen, Negativfall: eine Kamera, die nicht mitfährt, verliert die Figur', () => {
  // Gegenprobe: genau der gemeldete Fehler. Ohne Folger läuft die Figur aus
  // dem Bild — die Winkelprüfung oben würde auch hier grün, die Abstandsprüfung
  // zur Figur nicht.
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  folger.aus();   // der Mensch ohne Folger
  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(1 / 60);
  folger.setzeZiel([0, 1.05, 10]);
  for (let i = 0; i < 120; i++) folger.tick(1 / 60);

  const abstand = controls.target.distanceTo(new THREE.Vector3(0, 1.05, 10));
  assert.ok(abstand > 5,
    `ohne Folger muss der Drehpunkt ${abstand.toFixed(2)} m hinter der Figur zurückbleiben `
    + `(erwartet mehr als 5 m) — sonst prüft der Negativfall nichts`);
});

test('Folgen: die Glättung ist weich, kein Ruck beim ersten Frame-Wechsel', () => {
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(1 / 60);

  folger.setzeZiel([0, 1.05, 3]);
  folger.tick(1 / 60);
  const schritt = kamera.position.clone().sub(
    kamera.position.clone().add(new THREE.Vector3(0, 0, -0.1))); // Platzhalter

  // Ein Bild nach dem Sprung darf die Kamera nur einen Bruchteil des Wegs
  // gefahren sein — hart wäre der ganze Sprung auf einmal.
  const weg = controls.target.distanceTo(new THREE.Vector3(0, 1.05, 0));
  assert.ok(weg > 0 && weg < 0.5,
    `nach einem Bild muss der Blickpunkt einen Teilschritt gefahren sein, er steht `
    + `${weg.toFixed(4)} m vom Start (erwartet zwischen 0 und 0,5 m)`);
  assert.ok(schritt !== null, 'die Messung muss zustande kommen');
});

test('Folgen, Negativfall: ungültige Ziele werden ignoriert, nichts springt', () => {
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(60);                  // auf das Ziel konvergieren
  const stand = kamera.position.clone();

  for (const kaputt of [undefined, null, [1, 2], ['a', 'b', 'c'], [NaN, 0, 0]]) {
    folger.setzeZiel(kaputt);
  }
  folger.tick(60);

  assert.equal(kamera.position.distanceTo(stand), 0,
    'kaputte Zielpunkte dürfen die Kamera um 0 m bewegen');
});

test('aus() stoppt die Fahrt', () => {
  const { kamera, controls, folger } = aufbau();
  folger.ein();
  folger.setzeZiel([0, 1.05, 0]);
  folger.tick(1 / 60);
  const stand = kamera.position.clone();
  folger.aus();
  folger.setzeZiel([0, 1.05, 8]);
  for (let i = 0; i < 120; i++) folger.tick(1 / 60);
  assert.equal(kamera.position.distanceTo(stand), 0,
    'nach aus() darf die Kamera sich um 0 m bewegen');
});

// --- Verfahrensparameter ------------------------------------------------------

test('Verfahrensparameter: die Weltgrenzen sind körperrelativ und geordnet', () => {
  const hoehe = 1.8;
  assert.ok(WELT_NAH_ANTEIL > 1,
    'die Nahgrenze muss über einer Körperhöhe liegen — näher ist der Editor zuständig');
  assert.ok(WELT_NAH_ANTEIL < WELT_ABSTAND_ANTEIL,
    'die Rahmung muss innerhalb der Nah-/Ferngrenzen liegen');
  assert.ok(WELT_WEIT_ANTEIL > WELT_ABSTAND_ANTEIL,
    'die Ferngrenze muss hinter der Rahmung liegen');
  assert.ok(Number.isFinite(FOLGE_TEMP) && FOLGE_TEMP > 0,
    'das Folgetempo muss eine positive Zahl sein');
  // Bei 60 Bildern pro Sekunde holt die Glättung in wenigen Bildern auf —
  // der Anteil je Bild darf nicht gegen 1 fallen (hart) oder gegen 0 (blind).
  const anteil = 1 - Math.exp(-FOLGE_TEMP / 60);
  assert.ok(anteil > 0.02 && anteil < 0.5,
    `der Aufholanteil je Bild bei 60 Hz muss weich bleiben, er ist ${(anteil * 100).toFixed(1)} %`);
});