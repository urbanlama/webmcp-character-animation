// Die Hand des Menschen an der Kamera.
//
// Bis hierher war die Seite ein Bild: ein 3D-Raum, in dem sich nichts bewegen
// ließ. Wer eine Figur beurteilen soll — steht der Fuß auf dem Boden, dreht
// die Schulter durch —, muss um sie herumgehen können. Dieses Modul hängt
// OrbitControls (vendor/controls/OrbitControls.js) an die Leinwand und regelt
// das Verhältnis zwischen zwei Ansprüchen:
//
//   Die Startansicht kommt aus der Messung. src/scene/view.js rahmt die Figur
//   aus Bounding Box, Körperhöhe und gemessener Vorwärtsachse. Diese Datei
//   rechnet keine Kameraposition — sie ruft die Messung auf und übernimmt
//   deren Ergebnis. Deshalb ist die Rückkehr zur Startansicht kein
//   gespeicherter Schnappschuss, sondern ein erneuter Messaufruf: was
//   zurückkommt, ist per Konstruktion derselbe Wert wie beim Laden.
//
//   Von dort aus gehört die Ansicht dem Menschen. Ziehen dreht, das Rad fährt
//   heran, die rechte Taste verschiebt. Nichts davon schreibt in die Szene.
//
// Kein Dämpfen (enableDamping bleibt aus): mit Nachlauf müsste jede Rückkehr
// erst ausschwingen, bevor die Kamera exakt auf den gemessenen Werten steht.
// Ein Wert, der erst nach ein paar Bildern stimmt, ist in einem Messgerät der
// falsche Kompromiss.

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyClipPlanes } from '../scene/view.js';

/**
 * Verfahrensparameter: kleinster Abstand zum Drehpunkt, relativ zur
 * gemessenen Körperhöhe. Ohne ihn fährt das Rad durch die Figur hindurch und
 * die Ansicht kippt in ein Inneres, aus dem der Nutzer ohne Rücksprung nicht
 * herausfindet. 0,05 lässt bei einer 1,8 m großen Figur 9 cm — nah genug für
 * ein Gelenk, weit genug, um noch etwas zu sehen.
 */
export const NAH_ANTEIL = 0.05;

/**
 * Verfahrensparameter: größter Abstand zum Drehpunkt, relativ zum gemessenen
 * Startabstand. Beim Wegfahren wird die Figur irgendwann zum Punkt; ab dem
 * Zehnfachen der gerahmten Entfernung ist nichts mehr zu beurteilen.
 */
export const WEIT_FAKTOR = 10;

/**
 * Hängt die Kamerasteuerung an ein Element.
 *
 * @param {object} opt
 * @param {import('three').PerspectiveCamera} opt.kamera
 * @param {HTMLElement} opt.element   die Leinwand, auf der gezogen wird
 * @param {() => ({center: object, distance: number, box: object})} opt.rahme
 *        ruft die Messung auf (frameCamera) und liefert deren Ergebnis;
 *        wirft, solange kein Modell geladen ist
 * @param {Function} [opt.aufAenderung]  nach jeder Ansichtsänderung gerufen
 * @returns {{starteNeu: Function, zurueck: Function, aus: Function,
 *            unberuehrt: Function, stand: Function, controls: OrbitControls}}
 */
export function mounteKamerasteuerung({ kamera, element, rahme, aufAenderung }) {
  if (!kamera) {
    throw new Error('mounteKamerasteuerung: 0 Kameras übergeben, erwartet 1 THREE.Camera');
  }
  if (!element || typeof element.addEventListener !== 'function') {
    throw new Error('mounteKamerasteuerung: 0 bedienbare Elemente übergeben, erwartet 1 mit addEventListener');
  }
  if (typeof rahme !== 'function') {
    throw new Error('mounteKamerasteuerung: 0 Messfunktionen übergeben, erwartet 1 (frameCamera-Aufruf)');
  }

  const controls = new OrbitControls(kamera, element);
  controls.enableDamping = false;
  // Die Tastenbelegung, die jedes 3D-Werkzeug hat: links dreht, Rad fährt,
  // rechts und Mitte verschieben. Zwei Tasten fürs Verschieben, weil manche
  // Zeigegeräte keine mittlere haben.
  controls.mouseButtons = { LEFT: 0, MIDDLE: 2, RIGHT: 2 }; // ROTATE, PAN, PAN
  controls.touches = { ONE: 0, TWO: 2 }; // ein Finger dreht, zwei zoomen+schieben
  controls.enabled = false; // erst mit einem gemessenen Modell bedienbar
  // Ohne Modell gibt es keine gemessene Höhe; die Grenzen werden bei jedem
  // Rahmen aus der Messung neu gesetzt.
  controls.minDistance = 0;
  controls.maxDistance = Infinity;

  let beruehrt = false;
  let gerahmt = null;
  let gemesseneBox = null;

  function melde() {
    // Near und far folgen jeder echten Kamerabewegung. Stehen gebliebene
    // Clipping-Ebenen schneiden beim Heranfahren die Arme (near) und beim
    // Wegfahren den ganzen Körper (far). Nicht gefordert während der Rahmung
    // selbst: frameCamera setzt die Ebenen aus der Messung, und der
    // anschließende starteNeu() setzt die Kamera bitgenau zurück — dort wäre
    // das Nachziehen ein zweiter, abweichender Wert.
    if (gemesseneBox) applyClipPlanes(kamera, gemesseneBox);
    if (beruehrtPruefen()) beruehrt = true;
    if (aufAenderung) aufAenderung();
  }

  /**
   * Ob die Kamera von der gemessenen Startansicht abweicht. Gefragt wird
   * nicht "wurde geklickt", sondern "steht sie woanders" — sonst zählte auch
   * ein folgenloser Klick als Eingriff, und eine Fenstergrößenänderung
   * dürfte danach nicht mehr neu rahmen.
   */
  function beruehrtPruefen() {
    if (!gerahmt) return false;
    return kamera.position.distanceTo(gerahmt.position) > gerahmt.toleranz
      || controls.target.distanceTo(gerahmt.target) > gerahmt.toleranz;
  }

  controls.addEventListener('change', melde);

  /**
   * Setzt die Kamera auf die gemessene Startansicht und macht sie zum
   * Bezugspunkt für die Rückkehr.
   *
   * Gerufen beim Laden eines Modells, nach einer Größenänderung der Leinwand
   * und bei jeder Rückkehr — immer über dieselbe Messung.
   *
   * @returns {object} Ergebnis der Messung (frameCamera)
   */
  function starteNeu() {
    const mass = rahme();
    const zentrum = mass.center;
    controls.target.set(zentrum.x, zentrum.y, zentrum.z);
    kamera.lookAt(controls.target);

    // Grenzen aus der Messung, nicht getippt: die Höhe der Bounding Box gibt
    // die Nahgrenze, der gerahmte Abstand die Ferngrenze.
    const hoehe = mass.box?.max?.y - mass.box?.min?.y;
    controls.minDistance = Number.isFinite(hoehe) && hoehe > 0
      ? hoehe * NAH_ANTEIL
      : mass.distance * NAH_ANTEIL;
    controls.maxDistance = mass.distance * WEIT_FAKTOR;

    controls.enabled = true;
    controls.saveState();

    // controls.update() rechnet die Position über Kugelkoordinaten neu und
    // trifft den gemessenen Wert nur bis auf Rechenrauschen (gemessen:
    // 2,2e-16 m). Für ein Messgerät ist "fast" der falsche Wert: der gerahmte
    // Punkt wird nach dem Aktualisieren wieder eingesetzt, damit die
    // Startansicht bitgenau die aus der Messung ist.
    const gemessenePosition = kamera.position.clone();
    const gemessenesZentrum = controls.target.clone();
    controls.update();
    kamera.position.copy(gemessenePosition);
    controls.target.copy(gemessenesZentrum);
    // Nach controls.update() neu setzen, nicht davor: update() feuert beim
    // Modellwechsel ein change-Ereignis, und der change-Horcher rechnet die
    // Clipping-Ebenen dann aus einer alten Kameraposition nach — die
    // bitgenauen Rahmenwerte wären weg. Erst hier darf nachgezogen werden.
    gemesseneBox = mass.box ?? null;
    kamera.lookAt(controls.target);
    // Die Clipping-Ebenen gehören zur Startansicht: exakt die Werte der
    // Messung, nicht die des Zwischenstands, den der change-Horcher während
    // controls.update() eingetragen hat.
    if (Number.isFinite(mass.near) && Number.isFinite(mass.far)) {
      kamera.near = mass.near;
      kamera.far = mass.far;
      kamera.updateProjectionMatrix();
    }
    kamera.updateMatrixWorld(true);

    gerahmt = {
      position: kamera.position.clone(),
      target: controls.target.clone(),
      // Toleranz relativ zur Szenengröße (AGENTS.md: Toleranzen relativ zur
      // Körperhöhe). Ein Millionstel des Rahmenabstands ist Rechenrauschen,
      // alles darüber ist eine Bewegung des Nutzers.
      toleranz: mass.distance * 1e-6,
    };
    beruehrt = false;
    if (aufAenderung) aufAenderung();
    return mass;
  }

  /**
   * Zurück auf die gemessene Startansicht. Kein gespeicherter Schnappschuss,
   * sondern derselbe Messaufruf wie beim Laden.
   */
  function zurueck() {
    if (!controls.enabled) return null;
    return starteNeu();
  }

  /** Nimmt die Steuerung außer Betrieb — beim Entfernen des Modells. */
  function aus() {
    controls.enabled = false;
    gerahmt = null;
    gemesseneBox = null;
    beruehrt = false;
  }

  function abmelden() {
    controls.removeEventListener('change', melde);
    controls.dispose();
  }

  return {
    controls,
    starteNeu,
    zurueck,
    aus,
    abmelden,
    /** Ob die Kamera noch exakt auf der gemessenen Startansicht steht. */
    unberuehrt() { return !beruehrt && !beruehrtPruefen(); },
    /** Für Tests und Diagnose. */
    stand() {
      return {
        bedienbar: controls.enabled,
        abstand: controls.getDistance(),
        azimut: controls.getAzimuthalAngle(),
        polar: controls.getPolarAngle(),
        minAbstand: controls.minDistance,
        maxAbstand: controls.maxDistance,
      };
    },
  };
}
