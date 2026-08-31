// Der fragliche Knochen leuchtet, docs/plan.md 6.7, Moment 1.
//
// Ohne das ist die Rollenfrage nicht beantwortbar: „Ist mixamorigLeftFoot die
// Rolle foot_l?“ kann niemand beurteilen, der nicht sieht, welcher Knochen
// gemeint ist. Deshalb bekommt jede Antwortmoeglichkeit einen Marker in der
// Szene, beschriftet mit der Nummer ihrer Karte im Fragepanel.
//
// Die Marker haengen in einer eigenen Gruppe und werden restlos wieder
// abgeraeumt — das geladene Modell wird nicht angefasst.

import * as THREE from 'three';

/** Verfahrensparameter: Markerradius als Anteil der gemessenen Modellhoehe.
 * Nicht in Metern, weil eine 0,60 m und eine 2,40 m grosse Figur sonst
 * verschieden grosse Marker im Bild haetten — die Kamera rahmt beide gleich
 * (plan.md 6.8), also muss der Marker mitskalieren. */
export const MARKER_ANTEIL = 0.04;

/** Farbe des Markers. Reines Aussehen, keine Messgroesse. */
const MARKER_FARBE = 0xffc857;

/**
 * @param {object} opt
 * @param {THREE.Object3D} opt.scene Szene, in die die Marker gehaengt werden
 * @param {THREE.Object3D} opt.model geladenes Modell, in dem die Knochen liegen
 */
export function createKnochenLeuchten({ scene, model }) {
  if (!scene || !model) {
    throw new Error('createKnochenLeuchten: 0 von 2 nötigen Angaben (scene, model) fehlen nicht — beide sind Pflicht');
  }

  const gruppe = new THREE.Group();
  gruppe.name = 'knochen-leuchten';
  scene.add(gruppe);

  /** Hoehe des Modells in Weltmetern — Bezug fuer die Markergroesse. */
  function modellhoehe() {
    const box = new THREE.Box3().setFromObject(model);
    const groesse = new THREE.Vector3();
    box.getSize(groesse);
    return groesse.y;
  }

  /** detect.js haengt an mehrfach vergebene Namen einen Indexzusatz („name#0“). */
  function knochenFinden(name) {
    return model.getObjectByName(name)
      ?? model.getObjectByName(String(name).replace(/#\d+$/, ''))
      ?? null;
  }

  function beschriftung(text, groesse) {
    const leinwand = document.createElement('canvas');
    leinwand.width = 64; leinwand.height = 64;
    const stift = leinwand.getContext('2d');
    stift.fillStyle = '#0e1116';
    stift.beginPath(); stift.arc(32, 32, 30, 0, Math.PI * 2); stift.fill();
    stift.fillStyle = '#ffc857';
    stift.font = 'bold 40px sans-serif';
    stift.textAlign = 'center'; stift.textBaseline = 'middle';
    stift.fillText(text, 32, 34);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(leinwand), depthTest: false, transparent: true
    }));
    sprite.scale.setScalar(groesse);
    sprite.renderOrder = 1000;
    return sprite;
  }

  return {
    /**
     * Laesst die genannten Knochen leuchten. Vorher Gezeigtes wird abgeraeumt.
     * @param {Array<{bone: string, marke?: string}>} eintraege
     * @returns {{gezeigt: number, fehlend: string[]}}
     */
    zeige(eintraege = []) {
      this.aus();
      const radius = modellhoehe() * MARKER_ANTEIL;
      const fehlend = [];
      let gezeigt = 0;

      for (const eintrag of eintraege) {
        const knochen = knochenFinden(eintrag.bone);
        if (!knochen) { fehlend.push(eintrag.bone); continue; }

        knochen.updateWorldMatrix(true, false);
        const ort = new THREE.Vector3().setFromMatrixPosition(knochen.matrixWorld);

        // depthTest aus: der Marker sitzt im Inneren des Meshes und waere sonst
        // von der Haut verdeckt — genau dann sieht der Mensch ihn nicht.
        const kugel = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 16, 12),
          new THREE.MeshBasicMaterial({
            color: MARKER_FARBE, transparent: true, opacity: 0.55, depthTest: false
          })
        );
        kugel.position.copy(ort);
        kugel.renderOrder = 999;
        kugel.userData.bone = eintrag.bone;
        gruppe.add(kugel);

        // Das Schild braucht eine Canvas-Textur, also ein DOM. In Node laeuft
        // derselbe Ablauf ohne Schild weiter, damit er dort pruefbar bleibt.
        if (eintrag.marke && typeof document !== 'undefined') {
          const schild = beschriftung(eintrag.marke, radius * 2.2);
          schild.position.copy(ort).y += radius * 1.8;
          schild.userData.bone = eintrag.bone;
          gruppe.add(schild);
        }
        gezeigt += 1;
      }

      return { gezeigt, fehlend };
    },

    /** Raeumt alle Marker ab. Danach haengt nichts Fremdes mehr in der Szene. */
    aus() {
      for (const kind of [...gruppe.children]) {
        gruppe.remove(kind);
        kind.geometry?.dispose?.();
        kind.material?.map?.dispose?.();
        kind.material?.dispose?.();
      }
    },

    /** Fuer Tests und Diagnose: welche Knochen gerade leuchten. */
    stand() {
      return gruppe.children
        .filter((k) => k.isMesh)
        .map((k) => k.userData.bone);
    },

    /** Haengt die Gruppe wieder aus der Szene aus. */
    abmelden() {
      this.aus();
      scene.remove(gruppe);
    }
  };
}
