// Kamera-Framing aus der gemessenen Bounding Box — Abstand, Blickrichtung und
// Clipping-Ebenen werden gerechnet, nicht getippt. Läuft in Node und im
// Browser (nur three-Mathematik, kein Renderer nötig).
//
// Grundsatz (AGENTS.md, Regel 1): Körpermaße werden gemessen, Verfahrens-
// parameter werden benannt. Alle Verfahrensparameter dieser Datei stehen unten
// als Konstanten mit Begründung; sie sind die einzigen festen Zahlen hier.
//
// Der Spike machte es falsch: feste Kameraposition, auf Xbot getippte
// Abstände. Solche Werte passen zu genau einer Figur. Gemessen an einer auf
// 0,60 m und einer auf 2,40 m skalierten Kopie fällt das sofort auf.

import * as THREE from 'three';
import { getBounds } from './load.js';

/**
 * Verfahrensparameter: Zusatzrand des Framings, relativ zur projizierten
 * Körpergröße. 0 würde die Figur exakt bis an den Bildrand strecken; jede
 * Rundungsdifferenz schnitte dann Finger oder Scheitel ab. 0,15 lässt rund
 * 15 % Luft pro Seite und hält die Figur trotzdem bildfüllend.
 */
export const FRAME_MARGIN = 0.15;

/**
 * Verfahrensparameter: Höhe der Sohlenregion, relativ zur Körperhöhe. Aus ihr
 * wird das Vorzeichen der Vorwärtsachse bestimmt, weil Zehen vor dem Rumpf
 * liegen. Gemessen an Xbot: bei 5 % stehen nur 619 Stichprobenpunkte zur
 * Verfügung, bei 12 % zählt bereits die Wade mit. 8 % liefert 753 Punkte und
 * dasselbe Vorzeichen wie beide Nachbarwerte — die Entscheidung hängt also
 * nicht am genauen Wert.
 */
export const SOLE_REGION = 0.08;

/**
 * Verfahrensparameter: Stichprobenweite bei der Vertex-Messung. Jeder fünfte
 * Vertex genügt, um die Sohlenregion zu belegen, und hält die Messung auch bei
 * dichten Meshes unter einer Sekunde.
 */
export const VERTEX_STRIDE = 5;

/**
 * Verfahrensparameter: Bildwinkel der Menschansicht, vertikal, in Grad. Kein
 * Körpermaß, sondern eine Bildentscheidung: 38° ist eng genug, dass die
 * Perspektive eine stehende Figur nicht verzerrt, und weit genug, dass der
 * Kamera-Abstand nicht ins Unhandliche wächst.
 */
export const FOV_DEGREES = 38;

/**
 * Sammelt Vertexpositionen des Modells in Weltkoordinaten.
 *
 * Wichtig und teuer erkauft: Bei einem SkinnedMesh liegen die rohen
 * `position`-Attribute im Bind-Space, nicht im Modellraum. Wer sie nur mit
 * `matrixWorld` transformiert, bekommt Unsinn — an Xbot gemessen ergibt das
 * eine 0,018 m hohe Figur statt 1,806 m, also Faktor 100 daneben.
 * `applyBoneTransform` wendet Bindematrix und Knochen an und liefert die
 * tatsächliche Lage.
 *
 * @param {THREE.Object3D} object3D
 * @param {number} [stride] jeder wievielte Vertex genommen wird
 * @returns {THREE.Vector3[]} Punkte in Weltkoordinaten
 */
export function sampleWorldVertices(object3D, stride = VERTEX_STRIDE) {
  object3D.updateWorldMatrix(true, true);
  const points = [];
  const v = new THREE.Vector3();

  object3D.traverse((obj) => {
    if (!obj.isMesh) return;
    const position = obj.geometry?.attributes?.position;
    if (!position) return;

    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i);
      if (obj.isSkinnedMesh) obj.applyBoneTransform(i, v);
      v.applyMatrix4(obj.matrixWorld);
      points.push(v.clone());
    }
  });

  return points;
}

/**
 * Misst die Vorwärtsachse der Figur — die Richtung, in die sie schaut.
 *
 * Zwei Schritte, beide gemessen:
 *
 * 1. Welche Achse? Die flachere der beiden horizontalen Ausdehnungen der
 *    Bounding Box. Ein Mensch ist breiter als tief; an Xbot 1,805 m in x
 *    gegen 0,320 m in z, also ist z die Tiefenachse.
 * 2. Welches Vorzeichen? Die Sohlenregion — die untersten `SOLE_REGION` der
 *    Körperhöhe — liegt entlang der Tiefenachse vor dem Körperschwerpunkt,
 *    weil Zehen nach vorne zeigen. An Xbot 5,7 cm Versatz bei 1,81 m Höhe.
 *
 * Das ist die von `docs/umsetzung.md` benannte Näherung für AP0. AP2 misst die
 * Vorwärtsachse aus dem Rig und ersetzt sie; das Ergebnis trägt deshalb
 * `source: 'bounding-box+sohlen'`, damit später niemand eine Näherung für eine
 * Rig-Messung hält.
 *
 * @param {THREE.Object3D} object3D
 * @param {THREE.Box3} [bounds] vorab gemessene Box; sonst wird sie gemessen
 * @returns {{axis: 'x'|'z', sign: 1|-1, vector: THREE.Vector3, source: string,
 *            offset: number, sampleCount: number}}
 */
export function measureForwardAxis(object3D, bounds) {
  const box = bounds ?? getBounds(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);

  const axis = size.x <= size.z ? 'x' : 'z';
  const height = size.y;

  const points = sampleWorldVertices(object3D);
  if (points.length === 0) {
    throw new Error(
      'Vorwärtsachse nicht messbar: 0 Vertices im Modell gefunden, mindestens 1 nötig'
    );
  }

  // Sohlenregion gegen Gesamtkörper entlang der Tiefenachse vergleichen.
  const soleLimit = box.min.y + SOLE_REGION * height;
  let soleSum = 0;
  let soleCount = 0;
  let bodySum = 0;

  for (const p of points) {
    const along = p[axis];
    bodySum += along;
    if (p.y <= soleLimit) {
      soleSum += along;
      soleCount++;
    }
  }

  if (soleCount === 0) {
    throw new Error(
      `Vorwärtsachse nicht messbar: 0 von ${points.length} Stichprobenpunkten liegen in der ` +
      `Sohlenregion (unterste ${(SOLE_REGION * 100).toFixed(0)} % von ${height.toFixed(3)} m)`
    );
  }

  const offset = soleSum / soleCount - bodySum / points.length;
  const sign = offset >= 0 ? 1 : -1;

  const vector = new THREE.Vector3();
  vector[axis] = sign;

  return {
    axis,
    sign,
    vector,
    source: 'bounding-box+sohlen',
    offset,
    sampleCount: points.length,
  };
}

/**
 * Richtet die Kamera so aus, dass die Figur mittig, vollständig und dem
 * Betrachter zugewandt im Bild steht. Jeder Wert stammt aus der Messung.
 *
 * Der Abstand deckt Höhe **und** Breite ab. Nur die Höhe zu rechnen ist ein
 * Fehler, der bei genau dieser Figur auffällt: die Bind-Pose ist eine T-Pose,
 * an Xbot 1,805 m breit bei 1,809 m hoch. Wer nur die Höhe ins Bild rechnet,
 * schneidet bei einem hochkant stehenden Bild die Hände ab.
 *
 * Berücksichtigt wird außerdem die Tiefe der Box: bei perspektivischer
 * Projektion erscheint die der Kamera zugewandte Seite größer. Gerechnet wird
 * deshalb gegen die vordere Boxfläche, nicht gegen die Mitte.
 *
 *   halbe Bildhöhe an der vorderen Fläche  = tan(fov/2)          · (d − tiefe)
 *   halbe Bildbreite an der vorderen Fläche = tan(fov/2)·aspect · (d − tiefe)
 *
 * Nach d aufgelöst und mit `FRAME_MARGIN` aufgeweitet ergibt das den Abstand.
 *
 * Auch `near` und `far` kommen aus der Box. Feste Clipping-Ebenen sind
 * derselbe Fehler wie eine feste Position: 0,05 bis 100 passt zu einer 1,8 m
 * großen Figur und schneidet eine 60 m große an.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Object3D} object3D
 * @returns {{box: THREE.Box3, center: THREE.Vector3, distance: number,
 *            forward: object, near: number, far: number, margin: number}}
 */
export function frameCamera(camera, object3D) {
  const box = getBounds(object3D);
  if (box.isEmpty()) {
    throw new Error('Kamera nicht ausrichtbar: Bounding Box ist leer, 0 messbare Objekte');
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  if (size.y <= 0) {
    throw new Error(
      `Kamera nicht ausrichtbar: gemessene Körperhöhe ist ${size.y.toFixed(4)} m, mehr als 0 nötig`
    );
  }

  const forward = measureForwardAxis(object3D, box);

  // Halbe Ausdehnungen aus Kamerasicht. Blickrichtung ist −forward, oben ist
  // +Y; die dritte Achse ergibt sich als Kreuzprodukt. Weil die Vorwärtsachse
  // eine der Koordinatenachsen ist, sind die Projektionen achsenparallel.
  const depthAxis = forward.axis;
  const widthAxis = depthAxis === 'z' ? 'x' : 'z';

  const halfWidth = size[widthAxis] / 2;
  const halfHeight = size.y / 2;
  const halfDepth = size[depthAxis] / 2;

  camera.fov = FOV_DEGREES;
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const aspect = camera.aspect > 0 ? camera.aspect : 1;

  // Abstand von der vorderen Boxfläche, in dem beide Halbmaße hineinpassen.
  const forHeight = halfHeight / tanHalfFov;
  const forWidth = halfWidth / (tanHalfFov * aspect);
  const clearance = Math.max(forHeight, forWidth) * (1 + FRAME_MARGIN);
  const distance = clearance + halfDepth;

  camera.position.copy(center).addScaledVector(forward.vector, distance);
  camera.lookAt(center);
  camera.up.set(0, 1, 0);

  // Clipping-Ebenen aus der Box: vor der vorderen Fläche beginnen, hinter der
  // hinteren enden, mit je einer halben Boxtiefe Reserve für Bewegung.
  const near = Math.max(clearance - halfDepth, distance * 0.01);
  const far = distance + size[depthAxis] * 2 + size.y;
  camera.near = near;
  camera.far = far;

  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return { box, center, distance, forward, near, far, margin: FRAME_MARGIN };
}
