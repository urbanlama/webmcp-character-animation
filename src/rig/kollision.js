// ─────────────────────────────────────────────────────────────────────────────
// Kollisionsgeometrie: Dreieck gegen Dreieck, Gitter als Vorfilter.
//
// Wozu: die Gelenkgrenzen werden am Modell gemessen, nicht katalogisiert
// (src/rig/measure.js, measureJointLimits). Das Kriterium ist ein echter
// Schnitt zweier Hautdreiecke — binär und ohne Schwellenwert. Ein Abstandsmaß
// hätte eine Distanzschwelle gebraucht, die von der Vertexdichte des Modells
// abhängt; genau solche Zahlen soll dieses Projekt nicht enthalten.
//
// Warum nicht die Kapseln aus src/validate/physics.js: Kapseln sind
// rotationssymmetrische Zylinder um die Knochenachse. Der Unterschenkel beugt
// sich innerhalb der Oberschenkelkapsel, ohne sie je zu verlassen, und der
// Rumpf ist eine einzige Kapsel von der Hüfte bis zum Hals. Am Xbot gemessen:
// `knee.bend` bekäme mit Kapseln nie eine Grenze, und der Oberarm im Kopf
// bleibt unter der Kapselschwelle (docs/buehne-befunde-2026-09-02.md, D und E).
//
// Kein three.js: Punkte sind [x, y, z]-Arrays. Damit läuft die Prüfung in Node
// und im Browser, wie der Rest der Rechenschicht (AGENTS.md, Testen).
// ─────────────────────────────────────────────────────────────────────────────

/** Abstand zur Ebene, unterhalb dessen ein Eckpunkt als „in der Ebene“ gilt.
 *  1e-9 m = 1 Nanometer: weit unter jeder Modellgenauigkeit, aber groß genug
 *  gegen das Rundungsrauschen der Skalarprodukte. */
const EBENEN_EPS = 1e-9;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/**
 * Intervall, in dem ein Dreieck die Schnittgerade der beiden Trägerebenen
 * überdeckt — Möller 1997, „A Fast Triangle-Triangle Intersection Test“.
 *
 * vv0..vv2 sind die Eckpunkte auf die dominante Achse der Schnittgeraden
 * projiziert, d0..d2 ihre vorzeichenbehafteten Abstände zur anderen Ebene.
 * Zurück kommt [basis, zaehlerA, zaehlerB, nennerA, nennerB]; das Intervall
 * ergibt sich als basis + zaehler/nenner. `null` heißt koplanar.
 */
function intervall(vv0, vv1, vv2, d0, d1, d2, d0d1, d0d2) {
  if (d0d1 > 0) {
    // d0 und d1 auf derselben Seite: d2 liegt allein.
    return [vv2, (vv0 - vv2) * d2, (vv1 - vv2) * d2, d2 - d0, d2 - d1];
  }
  if (d0d2 > 0) return [vv1, (vv0 - vv1) * d1, (vv2 - vv1) * d1, d1 - d0, d1 - d2];
  if (d1 * d2 > 0 || d0 !== 0) return [vv0, (vv1 - vv0) * d0, (vv2 - vv0) * d0, d0 - d1, d0 - d2];
  if (d1 !== 0) return [vv1, (vv0 - vv1) * d1, (vv2 - vv1) * d1, d1 - d0, d1 - d2];
  if (d2 !== 0) return [vv2, (vv0 - vv2) * d2, (vv1 - vv2) * d2, d2 - d0, d2 - d1];
  return null;
}

/**
 * Schneiden sich die Dreiecke (a0, a1, a2) und (b0, b1, b2)?
 *
 * Koplanare Dreiecke gelten als schnittfrei. Sie treten am geschlossenen
 * Hautnetz nur bei entarteten Flächen auf und würden jede Naht als Kollision
 * melden, an der zwei Dreiecke exakt in derselben Ebene liegen.
 *
 * @param {number[]} a0 @param {number[]} a1 @param {number[]} a2
 * @param {number[]} b0 @param {number[]} b1 @param {number[]} b2
 * @returns {boolean}
 */
export function dreieckSchnitt(a0, a1, a2, b0, b1, b2) {
  // Liegt B ganz auf einer Seite der Trägerebene von A? Dann kein Schnitt.
  const nA = cross(sub(a1, a0), sub(a2, a0));
  const dA = -dot(nA, a0);
  let db0 = dot(nA, b0) + dA, db1 = dot(nA, b1) + dA, db2 = dot(nA, b2) + dA;
  if (Math.abs(db0) < EBENEN_EPS) db0 = 0;
  if (Math.abs(db1) < EBENEN_EPS) db1 = 0;
  if (Math.abs(db2) < EBENEN_EPS) db2 = 0;
  const db0db1 = db0 * db1, db0db2 = db0 * db2;
  if (db0db1 > 0 && db0db2 > 0) return false;

  // Dasselbe umgekehrt.
  const nB = cross(sub(b1, b0), sub(b2, b0));
  const dB = -dot(nB, b0);
  let da0 = dot(nB, a0) + dB, da1 = dot(nB, a1) + dB, da2 = dot(nB, a2) + dB;
  if (Math.abs(da0) < EBENEN_EPS) da0 = 0;
  if (Math.abs(da1) < EBENEN_EPS) da1 = 0;
  if (Math.abs(da2) < EBENEN_EPS) da2 = 0;
  const da0da1 = da0 * da1, da0da2 = da0 * da2;
  if (da0da1 > 0 && da0da2 > 0) return false;

  // Beide Dreiecke kreuzen die Ebene des anderen. Sie schneiden sich genau
  // dann, wenn ihre Intervalle auf der Schnittgeraden beider Ebenen
  // überlappen. Projiziert wird auf die betragsgrößte Komponente der
  // Geradenrichtung — die kleinste Verzerrung.
  const richtung = cross(nA, nB);
  let achse = 0, groesste = Math.abs(richtung[0]);
  if (Math.abs(richtung[1]) > groesste) { groesste = Math.abs(richtung[1]); achse = 1; }
  if (Math.abs(richtung[2]) > groesste) achse = 2;

  const iA = intervall(a0[achse], a1[achse], a2[achse], da0, da1, da2, da0da1, da0da2);
  const iB = intervall(b0[achse], b1[achse], b2[achse], db0, db1, db2, db0db1, db0db2);
  if (!iA || !iB) return false;   // koplanar

  const a = [iA[0] + iA[1] / iA[3], iA[0] + iA[2] / iA[4]].sort((x, y) => x - y);
  const b = [iB[0] + iB[1] / iB[3], iB[0] + iB[2] / iB[4]].sort((x, y) => x - y);
  return !(a[1] < b[0] || b[1] < a[0]);
}

/**
 * Uniformes Raumgitter über Dreiecke. Vorfilter: nur Paare, die sich eine
 * Zelle teilen, gehen in den teuren Schnitttest.
 *
 * Die Zellgröße ist ein reiner Geschwindigkeitsparameter — sie ändert kein
 * Ergebnis, nur wie viele Kandidaten geprüft werden.
 */
export class Kollisionsgitter {
  /** @param {number} zellgroesse Kantenlänge einer Zelle in Metern, > 0. */
  constructor(zellgroesse) {
    if (!(zellgroesse > 0) || !Number.isFinite(zellgroesse)) {
      throw new Error(`Kollisionsgitter abgelehnt: Zellgröße ${zellgroesse} — erwartet eine endliche Länge größer als 0 in Metern`);
    }
    this.zellgroesse = zellgroesse;
    this.zellen = new Map();
    this.anzahl = 0;
  }

  /** Zellbereich, den ein Dreieck überdeckt: [x0, x1, y0, y1, z0, z1]. */
  #bereich(p0, p1, p2) {
    const g = this.zellgroesse;
    return [
      Math.floor(Math.min(p0[0], p1[0], p2[0]) / g), Math.floor(Math.max(p0[0], p1[0], p2[0]) / g),
      Math.floor(Math.min(p0[1], p1[1], p2[1]) / g), Math.floor(Math.max(p0[1], p1[1], p2[1]) / g),
      Math.floor(Math.min(p0[2], p1[2], p2[2]) / g), Math.floor(Math.max(p0[2], p1[2], p2[2]) / g),
    ];
  }

  /** Trägt ein Dreieck unter der gegebenen ID in alle überdeckten Zellen ein. */
  einfuegen(id, p0, p1, p2) {
    const [x0, x1, y0, y1, z0, z1] = this.#bereich(p0, p1, p2);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = `${x},${y},${z}`;
          let liste = this.zellen.get(k);
          if (!liste) { liste = []; this.zellen.set(k, liste); }
          liste.push(id);
        }
      }
    }
    this.anzahl++;
  }

  /**
   * IDs aller Dreiecke, die sich mit dem angefragten Dreieck eine Zelle
   * teilen. Jede ID kommt höchstens einmal, auch wenn sie über viele Zellen
   * reicht.
   *
   * @returns {Set<*>}
   */
  kandidaten(p0, p1, p2) {
    const [x0, x1, y0, y1, z0, z1] = this.#bereich(p0, p1, p2);
    const out = new Set();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const liste = this.zellen.get(`${x},${y},${z}`);
          if (!liste) continue;
          for (const id of liste) out.add(id);
        }
      }
    }
    return out;
  }
}
