// Der Boden unter der Figur, Befund 4 aus der Browser-Sichtprüfung.
//
// Ohne Boden kann der Mensch nicht sehen, ob die Füße stehen — und
// Bodenkontakt, Standfläche und Fußanker sind die Größen, an denen diese
// Anwendung Bewegung beurteilt. Kein Kosmetikfehler. Abgrenzung: die
// technischen Ansichten für den Agenten (Achsenkreuz, Maßstab, Schwerpunkt,
// Stützfläche) baut src/render/strip.js; hier geht es nur um den Boden unter
// der Figur für das menschliche Auge.
//
// Regel 1 des Projekts (AGENTS.md): Körpermaße werden gemessen, nie getippt.
// Die Bodenebene kommt deshalb nicht aus einer Konstante, sondern aus der
// gemessenen Unterseite des geladenen Modells — dieselbe Größe, die
// src/rig/measure.js als world.groundY meldet (detect.test.mjs line 681: die
// Differenz beider liegt unter 1 % der Körperhöhe). Genau genommen misst
// messeBodenebene() selbst am Modell, statt ein Profil zu verlangen: dann
// funktioniert das Gitter auch, bevor ein RigProfile existiert. Ein
// vorhandenes Profil.world.groundY schlägt die eigene Messung, beide Wege
// laufen über dieselbe Modellgeometrie.
//
// Kein Schatten (Schattenwurf braucht eine zweite Renderbahn und ist hier
// nicht das Versprechen) — ein ruhendes Gitter auf der gemessenen Ebene.

import * as THREE from 'three';

/** Gittergröße als Vielfaches der gemessenen Körperhöhe. Verfahrensparameter:
 * weit genug, dass die Figur mit Füßen immer drin steht, klein genug, dass
 * das Gitter nicht die Bühne frisst. 4 × Körperhöhe ist das Vierfache der
 * größten Figur im Bild — sie kann nicht herauslaufen, ohne dass die Kamera
 * sie längst verloren hätte. */
export const GITTER_HOEHE_ANTEIL = 2.4;

/** Unterteilung des Gitters. Verfahrensparameter: bei 12 Zellen ist eine
 * Zelle rund eine Fünftel-Körperhöhe — groß genug, dass die Linien in der
 * flachen Kameraneigung als Fläche gelesen werden. Bei 40 Zellen liefen sie
 * am Bildrand zu einem Streifenmuster zusammen, das wie eine Bildstörung
 * aussah und der Figur die Aufmerksamkeit nahm. */
export const GITTER_UNTERTEILUNG = 12;

/** Farbe des Gitters. Reines Aussehen, keine Messgroesse. Neutral statt
 * blaustichig: die Umgebung soll keine eigene Farbe haben, die einzige
 * Farbfläche im Bild ist die Figur. */
const GITTER_FARBE = 0x3c3c43;

/**
 * Misst die Bodenebene eines Modells. Erst der gemessene RigProfile-Wert, wenn
 * er mitgeliefert wird, sonst die Unterseite der gemessenen Bounding Box —
 * jeweils in Weltmetern. Wirft mit Zahl im Text, wenn nichts messbar ist.
 *
 * @param {THREE.Object3D} model  geladenes Modell
 * @param {number} [profilGroundY] gemessenes world.groundY aus dem RigProfile
 * @returns {{ groundY: number, hoehe: number }} Bodenebene und Körperhöhe in Metern
 */
export function messeBodenebene(model, profilGroundY) {
  if (!model) {
    throw new Error('messeBodenebene: 0 Modelle übergeben, erwartet 1 geladenes Modell — '
      + 'ohne Modell ist keine Bodenebene messbar');
  }
  const box = new THREE.Box3().setFromObject(model);
  if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) {
    throw new Error('messeBodenebene: 0 messbare Eckpunkte in der Bounding Box (min.y = '
      + `${box.min.y}, max.y = ${box.max.y}) — das Modell hat keine Geometrie`);
  }
  if (box.max.y - box.min.y <= 0) {
    throw new Error(`messeBodenebene: Körperhöhe ${(box.max.y - box.min.y).toFixed(4)} m `
      + `≤ 0 m (Bounding Box y ${box.min.y.toFixed(4)}..${box.max.y.toFixed(4)} m) — `
      + 'keine messbare Bodenebene möglich');
  }
  // Beide Werte stammen aus derselben Messung; ein Profilwert überschreibt
  // nur, wenn er endlich ist. Keiner der beiden wird getippt.
  const groundY = Number.isFinite(profilGroundY) ? profilGroundY : box.min.y;
  return { groundY, hoehe: box.max.y - box.min.y };
}

/**
 * Hängt ein ruhendes Bodengitter in die Szene — auf der gemessenen Ebene.
 * Das geladene Modell wird nicht angefasst.
 *
 * @param {object} opt
 * @param {THREE.Object3D} opt.scene Szene, in die das Gitter gehängt wird
 * @param {THREE.Object3D} opt.model geladenes Modell, Ausgang der Messung
 * @param {number} [opt.profilGroundY] gemessenes world.groundY aus dem RigProfile,
 *        schlägt die eigene Bounding-Box-Messung
 * @returns {{ aus: () => void, abmelden: () => void, stand: () => object }}
 */
export function createBodengitter({ scene, model, profilGroundY } = {}) {
  if (!scene) {
    throw new Error('createBodengitter: 0 Szenen übergeben, erwartet 1 THREE.Scene');
  }

  const { groundY, hoehe } = messeBodenebene(model, profilGroundY);
  const groesse = hoehe * GITTER_HOEHE_ANTEIL;

  const gitter = new THREE.GridHelper(groesse, GITTER_UNTERTEILUNG, GITTER_FARBE, GITTER_FARBE);
  gitter.name = 'bodengitter';
  gitter.position.y = groundY;
  // Das Gitter ist Hintergrund, nicht Inhalt: leicht transparent, damit die
  // Figur vor ihm lesbar bleibt, und ohne depthWrite, damit Knochen-Marker
  // (knochen-leuchten.js, renderOrder 999-1000, depthTest aus) weiter oben
  // bleiben als das Gitter.
  gitter.material.transparent = true;
  gitter.material.opacity = 0.5;
  gitter.material.depthWrite = false;
  scene.add(gitter);

  return {
    /** Raeumt das Gitter ab. */
    aus() {
      scene.remove(gitter);
      gitter.geometry?.dispose?.();
      gitter.material?.dispose?.();
    },
    /** Fuer Tests und Diagnose: wo steht der Boden, wie groß ist das Gitter. */
    stand() {
      return { groundY, hoehe, groesse, zellen: GITTER_UNTERTEILUNG };
    },
    abmelden() {
      this.aus();
    },
  };
}