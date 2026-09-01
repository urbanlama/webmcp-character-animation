// Der Höhenmaßstab an der Figur — die eine Stelle, an der die Seite zeigt,
// was sie ist: ein Messgerät.
//
// Regel 1 des Projekts (AGENTS.md): Körpermaße werden gemessen, nie getippt.
// Bisher stand das Ergebnis dieser Regel als Zahlenreihe unter der Leinwand,
// weit weg von der Figur, auf die es sich bezieht. Hier steht es an ihr: eine
// Skala auf der gemessenen Bodenebene, Marken im Halbmeterschritt, und eine
// Linie auf Scheitelhöhe mit der gemessenen Körperhöhe.
//
// Die Bildschirmpositionen entstehen nicht aus geschätzten Pixeln, sondern
// aus derselben Kamera, die die Figur zeichnet: jeder Weltpunkt wird über
// camera.project() in Bildkoordinaten überführt. Ändert sich die Ansicht,
// wandern die Marken mit — sie können nicht falsch stehen, ohne dass auch die
// Figur falsch stünde.
//
// src/scene/view.js bleibt unangetastet; dieses Modul liest die Kamera nur.

import * as THREE from 'three';

/** Schrittweite der Marken in Metern. Verfahrensparameter: ein halber Meter
 * ergibt bei einer menschengroßen Figur vier bis fünf Marken — genug zum
 * Ablesen, zu wenig zum Flirren. */
export const SCHRITT_METER = 0.5;

/**
 * Rechnet die Bildschirmhöhe eines Weltpunkts aus, in Pixeln vom oberen Rand
 * der Leinwand. Reine Funktion, damit sie ohne Browser prüfbar ist.
 *
 * @param {THREE.Vector3} punkt   Weltpunkt
 * @param {THREE.Camera}  kamera  dieselbe Kamera, die das Bild zeichnet
 * @param {number} breite  Leinwandbreite in Pixeln
 * @param {number} hoehe   Leinwandhöhe in Pixeln
 * @returns {{x: number, y: number, sichtbar: boolean}}
 */
export function aufBildschirm(punkt, kamera, breite, hoehe) {
  const v = punkt.clone().project(kamera);
  return {
    x: (v.x * 0.5 + 0.5) * breite,
    y: (-v.y * 0.5 + 0.5) * hoehe,
    // Hinter der Kamera oder außerhalb des Bildes: die Marke wird nicht gesetzt,
    // statt an den Rand geklemmt zu werden. Eine geklemmte Marke wäre eine
    // falsche Ablesung.
    sichtbar: v.z < 1 && v.y >= -1.05 && v.y <= 1.05,
  };
}

/**
 * Die Marken, die eine Figur bekommt: volle Halbmeter vom Boden aufwärts,
 * plus die Scheitelmarke mit der gemessenen Körperhöhe.
 *
 * @param {number} hoehe  gemessene Körperhöhe in Metern
 * @returns {Array<{meter: number, text: string, scheitel: boolean}>}
 */
export function markenFuer(hoehe) {
  if (!Number.isFinite(hoehe) || hoehe <= 0) {
    throw new Error(`markenFuer: Körperhöhe ${hoehe} m ist nicht messbar, erwartet > 0 m`);
  }
  const marken = [];
  for (let m = 0; m < hoehe - 0.12; m += SCHRITT_METER) {
    marken.push({
      meter: m,
      text: m === 0 ? '0' : m.toFixed(1),
      scheitel: false,
    });
  }
  marken.push({ meter: hoehe, text: hoehe.toFixed(4), scheitel: true });
  return marken;
}

/**
 * Hängt den Maßstab als Auflage über die Leinwand.
 *
 * Er liegt im DOM, nicht in der Szene: so bleibt die Schrift gestochen scharf,
 * unabhängig von der Renderauflösung, und die Szene bleibt unberührt.
 *
 * @param {object} opt
 * @param {HTMLElement}     opt.wurzel  Auflage-Element über der Leinwand
 * @param {THREE.Camera}    opt.kamera
 * @returns {{zeige: Function, aus: Function, stand: Function}}
 */
export function mounteHoehenmassstab({ wurzel, kamera }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteHoehenmassstab: 0 Container übergeben, erwartet 1 Element');
  }
  if (!kamera) {
    throw new Error('mounteHoehenmassstab: 0 Kameras übergeben, erwartet 1 THREE.Camera');
  }
  const dok = wurzel.ownerDocument;
  let letzte = null;

  /**
   * Zeichnet den Maßstab für ein Modell neu.
   *
   * @param {object} arg
   * @param {THREE.Object3D} arg.model     geladenes Modell
   * @param {number}         arg.groundY   gemessene Bodenebene in Metern
   * @param {number}         arg.hoehe     gemessene Körperhöhe in Metern
   */
  function zeige({ model, groundY, hoehe }) {
    letzte = { model, groundY, hoehe };
    // Erst sichtbar machen, dann messen: ein Element mit hidden hat
    // clientWidth 0, und der Maßstab hätte sich selbst wegdividiert.
    wurzel.hidden = false;
    const breite = wurzel.clientWidth;
    const bildhoehe = wurzel.clientHeight;
    if (breite < 2 || bildhoehe < 2) return;

    // Die Marken werden in der Standebene der Figur abgetragen, nicht am
    // Bildrand: bei einer perspektivischen Kamera hängt die Bildhöhe eines
    // Meters von der Tiefe ab. Gemessen wird deshalb über der Mitte der
    // Bounding Box — genau dort, wo die Figur steht.
    const box = new THREE.Box3().setFromObject(model);
    const mitte = box.getCenter(new THREE.Vector3());

    // Wo die Figur im Bild anfängt. Die Striche enden davor, statt durch sie
    // hindurchzulaufen: ein Maßstab wird an ein Werkstück angelegt, nicht
    // darübergezeichnet. Gemessen an denselben acht Ecken der Bounding Box,
    // die auch die Kamera rahmt.
    let figurLinks = breite;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const ecke = aufBildschirm(new THREE.Vector3(x, y, z), kamera, breite, bildhoehe);
          figurLinks = Math.min(figurLinks, ecke.x);
        }
      }
    }
    // Abstand zur Figur, damit der Strich sie berührt statt sie anzustoßen.
    const strichEnde = figurLinks - 28;
    // Steht die Figur breit im Bild — T-Pose auf schmaler Leinwand —, bleibt
    // links kein Platz für die lange Linie. Dann zieht auch die Scheitelmarke
    // nur ihren Teilstrich; ein 6 px langer Rest sähe nach Fehler aus.
    // 174 px: Zahlenfeld (78) plus Abstand (12) plus eine Linie, die als Linie
    // erkennbar ist (mindestens 84).
    const langeLinie = strichEnde > 174;

    const teile = [];
    for (const marke of markenFuer(hoehe)) {
      const punkt = new THREE.Vector3(mitte.x, groundY + marke.meter, mitte.z);
      const { y, sichtbar } = aufBildschirm(punkt, kamera, breite, bildhoehe);
      if (!sichtbar) continue;

      const zeile = dok.createElement('div');
      zeile.className = marke.scheitel
        ? (langeLinie ? 'massmarke scheitel' : 'massmarke scheitel kurz')
        : 'massmarke';
      zeile.style.top = `${y.toFixed(1)}px`;
      // Nur die Scheitelmarke zieht bis an die Figur heran — sie trägt die
      // Körperhöhe und ist die eine Aussage des Maßstabs. Die Halbmeter sind
      // ihr Raster und bleiben kurze Teilstriche (Stil in index.html).
      if (marke.scheitel && langeLinie) {
        zeile.style.right = `${(breite - strichEnde).toFixed(1)}px`;
      }

      const wert = dok.createElement('span');
      wert.className = 'massmarke-wert';
      wert.textContent = marke.scheitel ? `${marke.text} m` : marke.text;

      const strich = dok.createElement('span');
      strich.className = 'massmarke-strich';

      zeile.append(wert, strich);
      teile.push(zeile);
    }

    wurzel.replaceChildren(...teile);
    wurzel.hidden = false;
  }

  /** Rechnet nach einer Größenänderung neu, ohne neue Messwerte. */
  function neuZeichnen() {
    if (letzte) zeige(letzte);
  }

  function aus() {
    letzte = null;
    wurzel.replaceChildren();
    wurzel.hidden = true;
  }

  aus();
  return {
    zeige,
    neuZeichnen,
    aus,
    /** Für Tests und Diagnose. */
    stand() {
      return {
        marken: wurzel.querySelectorAll('.massmarke').length,
        hoehe: letzte?.hoehe ?? null,
      };
    },
  };
}
