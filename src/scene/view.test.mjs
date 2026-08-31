// AP0, Abnahmetest „Ansicht".
//
// Positivfall: die Figur steht mittig im Bild und ist dem Betrachter zugewandt.
// Negativfall: dasselbe für eine auf 0,60 m und eine auf 2,40 m skalierte
// Kopie. Steht sie dann am Rand oder ragt aus dem Bild, sind Kamerawerte
// eingetippt statt gemessen.
//
// Gemessen wird, nicht angesehen: die acht Ecken der Bounding Box werden mit
// der Kameramatrix in Gerätekoordinaten projiziert. Dort heißt −1 linker bzw.
// unterer Bildrand und +1 rechter bzw. oberer. Was außerhalb liegt, ist
// abgeschnitten. Das Pixelbild prüft `ansicht.browser.mjs` zusätzlich.

import { test } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';

import { loadGLB, getBounds } from './load.js';
import { frameCamera, measureForwardAxis, FRAME_MARGIN } from './view.js';
import { XBOT_PFAD, xbotAufHoehe, alsArrayBuffer } from './testdaten.mjs';

/**
 * Schwellwert: Anteil der Bildhöhe, den die Figur mindestens einnehmen muss.
 * Bei `FRAME_MARGIN` = 0,15 füllt sie rechnerisch rund 87 % der Bildhöhe; im
 * hochkanten Bild bestimmt die Armspanne den Abstand und der Wert sinkt auf
 * rund 65 %. 0,5 liegt unter beidem und schlägt trotzdem an, sobald die Figur
 * als Punkt in der Bildmitte steht.
 */
const MIN_BILDANTEIL = 0.5;

/** Schwellwert: erlaubte Abweichung der Silhouettenmitte von der Bildmitte. */
const MAX_VERSATZ = 0.02;

/** Projiziert die acht Boxecken und misst die Silhouette in Gerätekoordinaten. */
function silhouette(box, camera) {
  const ecken = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        ecken.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
  }
  const xs = ecken.map((e) => e.x);
  const ys = ecken.map((e) => e.y);
  const links = Math.min(...xs), rechts = Math.max(...xs);
  const unten = Math.min(...ys), oben = Math.max(...ys);

  return {
    links, rechts, unten, oben,
    breite: rechts - links,
    hoehe: oben - unten,
    mitteX: (links + rechts) / 2,
    mitteY: (unten + oben) / 2,
    // Halbe NDC-Kantenlänge ist 1; die Bildhöhe misst 2.
    bildanteilHoehe: (oben - unten) / 2,
    tiefsteEcke: Math.min(...ecken.map((e) => e.z)),
    hoechsteEcke: Math.max(...ecken.map((e) => e.z)),
  };
}

/** Lädt eine Datei, rahmt sie und misst — der Ablauf jedes Positivfalls. */
async function rahmen(pfad, aspect = 960 / 720) {
  const gltf = await loadGLB(alsArrayBuffer(pfad));
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 10);
  const ergebnis = frameCamera(camera, gltf.scene);
  return { camera, gltf, ergebnis, sicht: silhouette(ergebnis.box, camera) };
}

/** Prüft die drei Zusagen des Positivfalls an einer gerahmten Ansicht. */
function pruefeAnsicht(sicht, ergebnis, camera, label) {
  assert.ok(
    sicht.links >= -1 && sicht.rechts <= 1,
    `${label}: Figur ragt seitlich aus dem Bild — links ${sicht.links.toFixed(3)}, ` +
    `rechts ${sicht.rechts.toFixed(3)}, erlaubt −1 bis 1`
  );
  assert.ok(
    sicht.unten >= -1 && sicht.oben <= 1,
    `${label}: Figur ragt oben oder unten aus dem Bild — unten ${sicht.unten.toFixed(3)}, ` +
    `oben ${sicht.oben.toFixed(3)}, erlaubt −1 bis 1`
  );
  assert.ok(
    Math.abs(sicht.mitteX) <= MAX_VERSATZ && Math.abs(sicht.mitteY) <= MAX_VERSATZ,
    `${label}: Figur steht nicht mittig — Versatz x ${sicht.mitteX.toFixed(4)}, ` +
    `y ${sicht.mitteY.toFixed(4)}, erlaubt ${MAX_VERSATZ}`
  );
  assert.ok(
    sicht.bildanteilHoehe >= MIN_BILDANTEIL,
    `${label}: Figur füllt nur ${(sicht.bildanteilHoehe * 100).toFixed(1)} % der Bildhöhe, ` +
    `mindestens ${MIN_BILDANTEIL * 100} % nötig`
  );
  // Nichts darf vor der vorderen oder hinter der hinteren Clipping-Ebene
  // liegen; in Gerätekoordinaten heißt das −1 bis 1 in der Tiefe.
  assert.ok(
    sicht.tiefsteEcke >= -1 && sicht.hoechsteEcke <= 1,
    `${label}: Figur wird von den Clipping-Ebenen geschnitten — Tiefe ` +
    `${sicht.tiefsteEcke.toFixed(3)} bis ${sicht.hoechsteEcke.toFixed(3)}, ` +
    `near ${ergebnis.near.toFixed(3)} m, far ${ergebnis.far.toFixed(3)} m`
  );
  // Zugewandt: die Kamera steht auf der gemessenen Vorderseite.
  const achse = ergebnis.forward.axis;
  const kameraSeite = camera.position[achse] - ergebnis.center[achse];
  assert.ok(
    Math.sign(kameraSeite) === ergebnis.forward.sign,
    `${label}: Kamera steht auf der falschen Seite — gemessene Vorwärtsrichtung ` +
    `${ergebnis.forward.sign > 0 ? '+' : '−'}${achse}, Kamera bei ` +
    `${kameraSeite.toFixed(3)} m relativ zur Körpermitte`
  );
}

test('Ansicht, Positivfall: Xbot steht mittig, vollständig und zugewandt im Bild', async () => {
  const { camera, ergebnis, sicht } = await rahmen(XBOT_PFAD);
  pruefeAnsicht(sicht, ergebnis, camera, 'Xbot, Originalgröße');

  // Die Vorwärtsachse muss gemessen sein, nicht angenommen.
  assert.equal(
    ergebnis.forward.source,
    'bounding-box+sohlen',
    'Die Vorwärtsachse muss als gemessene Näherung gekennzeichnet sein'
  );
  assert.ok(
    Math.abs(ergebnis.forward.offset) > 0.001,
    `Sohlenversatz ist ${ergebnis.forward.offset.toFixed(5)} m — zu klein, um ein ` +
    'Vorzeichen darauf zu stützen'
  );
});

test('Ansicht, Negativfall: 0,60 m und 2,40 m große Kopien stehen genauso im Bild', async () => {
  const original = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const box = getBounds(original.scene);
  const ausgangsHoehe = box.max.y - box.min.y;

  for (const zielHoehe of [0.6, 2.4]) {
    const pfad = xbotAufHoehe(zielHoehe, ausgangsHoehe);
    const { camera, ergebnis, sicht } = await rahmen(pfad);

    // Die Skalierung muss tatsächlich gegriffen haben, sonst prüft der Test
    // dreimal dieselbe Figur.
    const gemessen = ergebnis.box.max.y - ergebnis.box.min.y;
    assert.ok(
      Math.abs(gemessen - zielHoehe) < 0.05,
      `Skalierte Kopie ist ${gemessen.toFixed(3)} m hoch, verlangt waren ${zielHoehe} m`
    );

    pruefeAnsicht(sicht, ergebnis, camera, `Xbot auf ${zielHoehe.toFixed(2)} m`);

    // Der Kameraabstand muss mitwachsen — eingetippte Werte täten das nicht.
    const verhaeltnis = ergebnis.distance / gemessen;
    assert.ok(
      verhaeltnis > 1 && verhaeltnis < 10,
      `Kameraabstand ${ergebnis.distance.toFixed(3)} m bei ${gemessen.toFixed(3)} m ` +
      `Körperhöhe ergibt Verhältnis ${verhaeltnis.toFixed(2)} — erwartet zwischen 1 und 10`
    );
  }
});

test('Ansicht: Kameraabstand ist proportional zur Körperhöhe', async () => {
  const original = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ausgangsHoehe = getBounds(original.scene).max.y - getBounds(original.scene).min.y;

  const klein = await rahmen(xbotAufHoehe(0.6, ausgangsHoehe));
  const gross = await rahmen(xbotAufHoehe(2.4, ausgangsHoehe));

  // Viermal so groß heißt viermal so weit weg. Ein eingetippter Abstand wäre
  // für beide gleich und würde hier auffallen.
  const faktor = gross.ergebnis.distance / klein.ergebnis.distance;
  assert.ok(
    Math.abs(faktor - 4) < 0.2,
    `Abstandsverhältnis ist ${faktor.toFixed(3)}, erwartet 4,0 bei vierfacher Körperhöhe ` +
    `(${klein.ergebnis.distance.toFixed(3)} m gegen ${gross.ergebnis.distance.toFixed(3)} m)`
  );
});

test('Ansicht: die T-Pose bleibt auch im hochkanten Bild vollständig sichtbar', async () => {
  // Die Bind-Pose ist eine T-Pose: an Xbot 1,805 m breit bei 1,809 m hoch. Wer
  // nur die Höhe ins Bild rechnet, schneidet im Hochformat die Hände ab.
  const { camera, ergebnis, sicht } = await rahmen(XBOT_PFAD, 720 / 960);
  pruefeAnsicht(sicht, ergebnis, camera, 'Xbot, hochkantes Bild');
});

test('Ansicht: die Vorwärtsachse wird gemessen, nicht angenommen', async () => {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));

  const vorher = measureForwardAxis(gltf.scene);
  assert.equal(vorher.axis, 'z', `Xbot sollte auf der z-Achse nach vorne zeigen, gemessen: ${vorher.axis}`);

  // Modell um 90° um die Hochachse drehen. Eine gemessene Vorwärtsachse dreht
  // sich mit; eine fest auf +Z gesetzte bliebe stehen und zeigte die Figur
  // von der Seite.
  gltf.scene.rotation.y = Math.PI / 2;
  gltf.scene.updateMatrixWorld(true);

  const nachher = measureForwardAxis(gltf.scene);
  assert.equal(
    nachher.axis,
    'x',
    `Nach 90°-Drehung muss die Vorwärtsachse x sein, gemessen: ${nachher.axis} ` +
    `(Versatz ${nachher.offset.toFixed(4)} m)`
  );
});

test('Ansicht, Negativfall: eingetippte Kamerawerte fallen bei 2,40 m durch', async () => {
  // Genau der Aufbau aus dem Spike: feste Position, fester Blickpunkt. Er
  // passt zu einer 1,8 m großen Figur — und muss bei 2,40 m auffallen. Wird
  // dieser Test grün, ohne dass etwas anschlägt, ist die Prüfung stumpf.
  const original = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const ausgangsHoehe = getBounds(original.scene).max.y - getBounds(original.scene).min.y;

  const gltf = await loadGLB(alsArrayBuffer(xbotAufHoehe(2.4, ausgangsHoehe)));
  const box = getBounds(gltf.scene);

  const getippt = new THREE.PerspectiveCamera(38, 960 / 720, 0.05, 100);
  getippt.position.set(0, 1, 4);
  getippt.lookAt(0, 1, 0);
  getippt.updateMatrixWorld(true);

  const sicht = silhouette(box, getippt);
  const ragtRaus =
    sicht.links < -1 || sicht.rechts > 1 || sicht.unten < -1 || sicht.oben > 1;
  const ausserMitte = Math.abs(sicht.mitteY) > MAX_VERSATZ;

  assert.ok(
    ragtRaus || ausserMitte,
    'Eingetippte Kamerawerte müssen bei einer 2,40 m großen Figur auffallen. ' +
    `Gemessen: links ${sicht.links.toFixed(3)}, rechts ${sicht.rechts.toFixed(3)}, ` +
    `unten ${sicht.unten.toFixed(3)}, oben ${sicht.oben.toFixed(3)}, ` +
    `Versatz y ${sicht.mitteY.toFixed(4)}`
  );

  // Gegenprobe: dieselbe Figur, gemessen gerahmt, besteht die Prüfung.
  const gemessen = new THREE.PerspectiveCamera(50, 960 / 720, 0.1, 10);
  const ergebnis = frameCamera(gemessen, gltf.scene);
  pruefeAnsicht(silhouette(ergebnis.box, gemessen), ergebnis, gemessen, 'Xbot auf 2,40 m, gemessen');
});
