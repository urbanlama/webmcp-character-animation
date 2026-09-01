// Die Welt-Kamera fährt mit.
//
// In der Welt läuft die Figur wirklich durch den Raum (ansichtsmodus.js stellt
// dort den Originalframe, nicht die Editor-Darstellung auf der Stelle). Ohne
// diesen Folger stand die Kamera fest, wo rahmeWelt() sie absetzte: nach drei
// Schritten war die Figur aus dem Bild. Der Folger verschiebt Kamera und
// Drehpunkt um genau die Strecke, die die Figur gefahren ist — nichts anderes.
//
//   Was der Mensch behält: Drehen (Azimut und Höhe) und der Zoom. Beide leben
//   in der Richtung und im Abstand der Kamera zum Drehpunkt, und der Folger
//   rührt beides nicht an — er addiert nur den Weg der Figur.
//
//   Was der Folger tut: den Blickpunkt der Figur hinterherziehen, weich
//   geglättet. Ein hartes Mitfahren würde jeden Frame-Wechsel als Ruck in die
//   Kamera übersetzen; die Glättung holt in Bruchteilen einer Sekunde auf und
//   lässt den Weg als Fahrt lesen statt als Sprung.
//
// Der Anker ist der gemessene Beckenpunkt des gelösten Frames (root.pos). Er
// kommt aus dem Löser, nicht aus einer Bounding Box: setFromObject liefert bei
// skinnierten Meshes die Bind-Pose, und die steht am Ursprung, egal wo die
// Figur gerade ist. Ein liegendes oder springendes Becken ist ein ehrlicher
// Körperschwerpunkt-Näherungspunkt — besser als jede Boxmitte.

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE VERFAHRENSPARAMETER (keine Körpermaße — AGENTS.md, Regel 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verfahrensparameter: Soll-Abstand der Weltkamera zum Körper, relativ zur
 * gemessenen Körperhöhe. Bei 45° Sichtfeld füllt die Figur etwa 30 % der
 * Bildhöhe — Boden, Schatten und Raum um sie herum bleiben im Bild. Der Wert
 * ist aus der gewünschten Startrahmung abgemessen, nicht getippt: 1,81 m
 * Körperhöhe auf 32 % Bildhöhe ergeben sichtbare 5,6 m, und bei 45°
 * Sichtfeld sitzt die Kamera dafür 3,64 Körperhöhen entfernt.
 * rahmeWelt() (index.html) rahmt damit.
 */
export const WELT_ABSTAND_ANTEIL = 3.64;

/**
 * Verfahrensparameter: Seitenwinkel der Startrahmung in Radiant. Die Welt
 * liest sich als Raum nur mit einem Hauch Seitenblick — aber der Blick soll
 * frontal bleiben, wie im gewünschten Startbild. 8° zeigen Tiefe, ohne die
 * Frontalansicht zu verlassen.
 */
export const WELT_SEITWINKEL = 8 * Math.PI / 180;

/**
 * Verfahrensparameter: Blickhöhe des Startbilds, relativ zur Körperhöhe über
 * dem Boden. Die Körpermitte (0,5) steht im gewünschten Bild knapp unter der
 * Bildmitte — der Blick zielt dorthin, nicht auf die Brust (0,58).
 */
export const WELT_ZIEL_ANTEIL = 0.5;

/**
 * Verfahrensparameter: Kamerahöhe ÜBER dem Blickpunkt, relativ zur
 * Körperhöhe. Im gewünschten Startbild liegt der Horizont bei 28 % Bildhöhe —
 * das entspricht einer Blickneigung von 10,2° und, über den Rahmabstand,
 * 0,66 Körperhöhen über dem Blickpunkt (zusammen rund 1,16 Körperhöhen über
 * dem Boden). Vorher stand die Kamera 1,5 Körperhöhen über dem Blickpunkt und
 * schaute steil herab.
 */
export const WELT_ANHEBUNG_ANTEIL = 0.66;

/**
 * Verfahrensparameter: kleinster Abstand in der Welt, relativ zur Körperhöhe.
 * Näher als das 1,6-Fache der Körperhöhe wird die Weltansicht zur
 * Gelenklupe — dafür ist der Editor da. Hier gilt der ganze Körper im Raum.
 */
export const WELT_NAH_ANTEIL = 1.6;

/**
 * Verfahrensparameter: größter Abstand in der Welt, relativ zur Körperhöhe.
 * Darüber wird die Figur zum Punkt im Raster. Die Grenze muss deutlich über
 * der Startrahmung (3,9) liegen — eine Startansicht am Klemmanschlag ließe
 * kein Wegfahren mehr zu.
 */
export const WELT_WEIT_ANTEIL = 6.0;

/**
 * Verfahrensparameter: Nachziehtempo des Blickpunkts in 1/s. Die Glättung ist
 * exponentiell: nach 1/TEMP Sekunden ist die Lücke auf 1/e geschlossen. 8
 * bedeutet — bei 60 Bildern pro Sekunde —, dass die Kamera einer gehenden
 * Figur in etwa vier Bildern folgt: schnell genug, um sie nicht aus dem Bild
 * zu lassen, langsam genug, um Frame-Sprünge nicht als Ruck zu zeigen.
 */
export const FOLGE_TEMP = 8;

/**
 * Hängt den Kamerafolger an eine Kamera mit OrbitControls.
 *
 * @param {object} opt
 * @param {import('three').PerspectiveCamera} opt.kamera
 * @param {{target: import('three').Vector3}} opt.controls
 *        die live geschaltete OrbitControls-Instanz; der Folger verschiebt
 *        ihren Drehpunkt mit, fasst ihre Grenzen und Tasten aber nie an
 * @returns {{setzeZiel: Function, ein: Function, aus: Function,
 *            tick: Function}}
 */
export function mounteKamerfolger({ kamera, controls }) {
  if (!kamera) {
    throw new Error('mounteKamerfolger: 0 Kameras übergeben, erwartet 1 THREE.Camera');
  }
  if (!controls?.target) {
    throw new Error('mounteKamerfolger: 0 Steuerungen mit Drehpunkt übergeben, erwartet 1 OrbitControls');
  }

  let aktiv = false;
  /** Glättung: der Punkt, an dem die Kamera tatsächlich hängt. */
  let fokus = null;
  /** Wahrheit: der gemessene Beckenpunkt des aktuellen Frames. */
  let ziel = null;

  /**
   * Meldet den Beckenpunkt des aktuell gestellten Frames in Weltkoordinaten.
   * Ungültige Eingaben werden still ignoriert — der Aufrufer ist der
   * stelleFrame-Weg der Abspielleiste, und ein Frame ohne root.pos darf das
   * Abspielen nicht abbrechen.
   *
   * @param {number[]|undefined} pos  [x, y, z] in Metern
   */
  function setzeZiel(pos) {
    if (!aktiv) return;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return;
    ziel = new THREE.Vector3(pos[0], pos[1], pos[2]);
  }

  /**
   * Nimmt die Fahrt auf. Der Folgpunkt startet am aktuellen Drehpunkt — die
   * Rahmung (rahmeWelt) hat ihn gerade auf die Figur gesetzt, und das erste
   * Bild darf keinen Anschieber haben.
   */
  function ein() {
    fokus = controls.target.clone();
    ziel = fokus.clone();
    aktiv = true;
  }

  /** Steigt aus — beim Zurückwechseln in den Editor und beim Entladen. */
  function aus() {
    aktiv = false;
    fokus = null;
    ziel = null;
  }

  /**
   * Ein Zeitschritt des Renderlaufs. Zieht Kamera und Drehpunkt um den
   * geglätteten Weg der Figur weiter — Drehung und Zoom bleiben unberührt.
   *
   * @param {number} dtSek  Sekunden seit dem letzten Bild
   * @returns {boolean} ob die Kamera bewegt wurde
   */
  function tick(dtSek) {
    if (!aktiv || !fokus || !ziel) return false;
    const dt = Number.isFinite(dtSek) ? Math.max(dtSek, 0) : 0;
    const neu = fokus.clone().lerp(ziel, 1 - Math.exp(-dt * FOLGE_TEMP));
    const delta = neu.clone().sub(fokus);
    fokus.copy(neu);
    if (delta.lengthSq() === 0) return false;
    // Kamera und Drehpunkt fahren denselben Weg: Richtung und Abstand der
    // Kamera zum Körper — also das, was der Mensch mit Rad und Ziehen
    // einstellt — bleiben exakt erhalten.
    kamera.position.add(delta);
    controls.target.add(delta);
    kamera.lookAt(controls.target);
    return true;
  }

  /** Für Tests und Diagnose. */
  function stand() {
    return {
      aktiv,
      fokus: fokus ? fokus.toArray() : null,
      ziel: ziel ? ziel.toArray() : null,
      rueckstand: fokus && ziel ? fokus.distanceTo(ziel) : 0,
    };
  }

  return { setzeZiel, ein, aus, tick, stand };
}