// AP3 — Rig-Erkennung auf fremden Modellen.
//
// Eingabe: ein geladenes Modell (three.js-Szene mit Skelett in Bind-Pose).
// Ausgabe: die semantischen Rollen seiner Knochen — Becken, linkes Bein,
// rechter Fuß, wo vorne ist — mit Konfidenz nach docs/plan.md 5.1.
//
// Grundsätze dieses Moduls
//
// 1. Knochennamen werden NICHT gelesen. Entscheidend ist ausschließlich
//    Geometrie: Gelenkpositionen, Hautgewichte, Bodenabstände,
//    Spiegelbildlichkeit. Nur so hält die Erkennung fremden Benennungs-
//    schemata stand — der Robustheitstest ersetzt deshalb alle Namen durch
//    `bone_000…`.
// 2. Körpermaße werden gemessen: Körperhöhe, Bodenlage, Ausdehnung der
//    Fußflächen, Gelenkabstände, Beugungswinkel, Kopf-nach-vorne-Versatz.
// 3. Verfahrensparameter stehen in PARAMS, mit Begründung, und liegen im
//    Bericht unter `params` bei. Alle Längen darin sind Anteile der
//    gemessenen Körperhöhe, außer den zwei als Zählgröße markierten.
// 4. Geraten wird nie. Was unter der Frageschwelle liegt, bekommt keine Rolle.
//    Was zwischen 0,5 und 0,9 liegt, kommt mit Rückfrage in `questions`. Ein
//    Modell ohne zwei Beine wird abgelehnt, nicht als Mensch umgedeutet.
//
// Aufruf:
//   import { detectRig } from './detect.js';
//   const bericht = detectRig(gltf, { file: 'charakter.glb' });
//   bericht.roles.pelvis    // { bone: '…', confidence: 0.98, note?: '…' }
//   bericht.questions       // Zuordnungen in der Rückfragezone, mit Optionen
//   bericht.abgelehnteZuordnungen // unter 0,5: bester Kandidat, keine Rolle
//   bericht.unknown         // Ketten ohne semantische Rolle — weiter nutzbar
//
// @throws {RigAbweisung} wenn das Modell kein aufrechtes zweibeiniges Humanoid
// ist. Jede Meldung enthält Zahlen.

import * as THREE from 'three';


// ─────────────────────────────────────────────────────────────────────────────
// Verfahrensparameter — eine Stelle, begründet, im Bericht ausgegeben
// ─────────────────────────────────────────────────────────────────────────────

/** Alle Längen sind Anteile der gemessenen Körperhöhe, sofern nicht anders
 *  vermerkt. Kein Wert hier ist ein geschätztes Körpermaß. */
export const PARAMS = {
  // Vertices bis zu dieser Höhe über dem tiefsten Punkt gelten als Boden-
  // kontakt. 2 %: eine Fußsohle ist flach, Ballenstand reicht etwas höher.
  // AP2 nutzt für dieselbe Frage 3,5 % (Sohlentoleranz); hier geht es nur um
  // „berührt den Boden“, deshalb das schmalere Band.
  bodenBand: 0.02,
  // Kantenlänge des Rasters für die Bodenclusterung. 1,2 % der Höhe ≈ 2 cm bei
  // 1,7 m: größer verwächst eine Sohle mit der gegenüberliegenden — der
  // innere Abstand zweier Füße beträgt bei diesem Modell nur 4 cm.
  rasterzelle: 0.012,
  // Anteil aller Bodenberührungen, den eine Kette für sich beanspruchen muss,
  // um mit einem Fuß auf dem Boden zu stehen. Zwei Füße liegen nahe 50/50;
  // ein Kleidssaum oder eine Scharnierecke bleibt weit darunter.
  // Gemessen: Xbot 0,50/0,50, CesiumMan 0,50/0,50, Kenney-Figur 0,50/0,50,
  // BrainStem 0,46/0,54. Gelöst wird damit die Mesh-Auflösung: ein hochauf-
  // gelöstes Bein liefert 774 Bodenvertices, ein Low-Poly-Bein 24 — eine
  // absolute Vertexgrenze (vorher 6) ließ die flachen Figuren vollständig
  // ohne Fußcluster dastehen.
  fussMinAnteil: 0.15,
  // Ausdehnung einer Fußfläche nach außen, höchstens dieser Anteil der
  // Körperhöhe. 16 % ≈ halbe Schrittbreite im Grätschstand.
  fussRadiusMax: 0.16,
  // Zwei Fußcluster gehören zu einem Stand, wenn sie zwischen 2 % und 45 %
  // der Körperhöhe auseinanderliegen. Darunter: zwei Teile desselben Fußes.
  // Darüber: Seitstütz, kein Stand.
  fussAbstandMin: 0.02,
  fussAbstandMax: 0.45,
  // Ein Gelenk gilt als in Fußreichweite, wenn es höchstens diese Höhe über
  // dem Boden liegt. 12 %: Knöchel deutlich darunter, Knie deutlich darüber.
  fussReichweite: 0.12,
  // Fußgelenk: ab diesem Knickwinkel der Kette nach unten/vorn gilt das
  // Gelenk als Sprunggelenk. Darunter entscheidet die Lage — mit verringerter
  // Konfidenz, weil dann auch ein Zwischensknochen in Frage kommt.
  fussKnicksMinGrad: 15,
  // Höhenlage der Hüftgelenke als Anteil der Körperhöhe — gemessen an den
  // Ansatzgelenken der zwei Bodenketten, nicht am Gelenk des Kandidaten selbst:
  // Benutzergelenke wie das Wurzelgelenk einer Spielfigur sitzen auf dem Boden
  // und sagen nichts über die Hüfte. Der Bereich deckt Kindproportionen und
  // cartoonige Kurzbeinigkeit ab (an den Kenney-Figuren gemessen 24 %);
  // darunter sitzt die Hüfte in Fußreichweite und ist keine.
  beckenHoeheMin: 0.18,
  beckenHoeheMax: 0.80,
  // Die Aufwärtskette eines Beckens muss bis in diese Höhe unter die Modell-
  // spitze reichen, sonst ist sie kein Rumpf, sondern ein hängendes Kleid.
  rumpfSpitzeToleranz: 0.25,
  // Ab dieser Winkeländerung zwischen zwei Segmenten gilt ein Gelenk als
  // gebeugt — als echtes Gelenk, nicht als eingefügter Zwischensknochen
  // derselben Gliederstrecke (Twist-Knochen sind kollinear).
  beugungMinGrad: 8,
  // Ausschlag eines Knies aus der Hüfte-Fuß-Linie unter diesem Anteil der
  // Körperhöhe gilt nicht als Richtungssignal (durchgestrecktes Bein).
  knieAusschlagMin: 0.003,
  // Fußspitze vor dem Knöchel: weniger als dieser Anteil der Körperhöhe vor
  // dem Gelenk ist keine belastbare Richtungsauskunft.
  fussSpitzeMin: 0.015,
  // Kopfvorsprung gegenüber dem obersten Rumpfgelenk, unter dem das Signal
  // nicht zählt.
  kopfVorneMin: 0.010,
  // Anteil der Vertices im obersten Höhenband, den ein Knochen für sich haben
  // muss, damit die Kopfregion als von ihm getragen gilt. Darunter sitzt dort
  // nur ein Zipfel oder ein Hut.
  kopfMinAnteil: 0.10,
  // Endglieder einer Kette, die kürzer sind als dieser Anteil des längsten
  // Kettensegments, werden als Fingerlauf abgeschnitten. Gemessen wird am
  // längsten Segment, nicht am Mittelwert: eine Kette, die bis in die Fingerspitze
  // reicht, zieht den Mittelwert selbst herunter (an Xbot gerechnet: Mittelwert
  // 0,09 m gegen Oberarm 0,26 m — die Fingerwurzeln blieben über der Grenze und
  // die Hand landete am mittleren Fingerglied).
  fingerKuerze: 0.35,
  // Zählgröße: ab so vielen kurzen Kinderketten an einem Gelenk gilt es als
  // Handgelenk.
  fingerZweige: 3,
  // Schlüsselbein: sein erstes Segment muss deutlich kürzer sein als das
  // folgende und deutlich näher an der Körperachse liegen.
  schulterLängenverhältnis: 0.60,
  schulterSeitenverhältnis: 0.60,
  // Zwei Seitenzweige sind ein Paar, wenn ihre Befestigungshöhe within 8 %
  // und ihre seitliche Reichweite im Verhältnis über 0,45 liegt.
  paarHöheToleranz: 0.08,
  paarWeiteVerhältnis: 0.45,
  // Streuung der Richtungskriterien (Fußspitze, Kniescheibe, Kopf-vorne) bis
  // zu der sie noch als dieselbe Richtung gelten. Darüber: Rückfrage.
  richtungEinigGrad: 40,
  // Spiegelbildprüfung: mittlere Profildifferenz unter diesem Anteil der
  // Körperhöhe gilt als symmetrisch.
  asymmetrieMax: 0.06,
  // Winkel ab dem zwei geprüfte Richtungen als verschiedene Achsen zählen.
  // Darunter sind sie dieselbe Aufwärtsachse, nur ein zweites Mal gemessen:
  // Welt-y und Haupttragheit der Körperoberfläche weichen bei einer aufrechten
  // Figur um wenige Grad voneinander ab. An Xbot gemessen 3,2° (bei Achsen-
  // werten 1,000 gegen 0,975), an der Kenney-Figur 13,3°, weil ihr kurzer
  // Unterleib die Tragheit kippt. Zwischen diesem Winkel und 90° wächst die
  // Konkurrenz linear — siehe globalFaktor.
  achsVerschiedenGrad: 10,
  // Höchster Achsenwert, unter dem kein aufrechtes Skelett erkannt wird.
  achsenwertMin: 0.45,
  // Unter diesem Achsenwert gilt die Haltung als rückfragewürdig (plan.md 6.1:
  // Bind-Posen, die nicht aufrecht sind, führen zu Rückfrage oder Ablehnung).
  achsenwertRückfrage: 0.70,
  // Konfidenzschwellen aus plan.md 5.1 — verbindlich.
  sicherAb: 0.90,
  fragenAb: 0.50,
  // Faktor, den jede seitenabhängige Rolle trägt, wenn die Blickrichtung
  // nicht entscheidbar ist: bringt die Rolle sicher in die Rückfragezone.
  seitenFaktorUnsicher: 0.58,
  // glTF-Kernspezifikation: eine Einheit = ein Meter. Erklärte Übereinkunft,
  // keine Messung; die Modellskala steckt bereits in den Weltkoordinaten.
  unitsPerMeter: 1.0,
};

/** Rollen, die dieses Modul vergibt. Die Vertragspflichtrollen stehen vorn. */
export const ROLLEN = [
  'pelvis',
  'foot_l', 'foot_r',
  'thigh_l', 'thigh_r',
  'shin_l', 'shin_r',
  'toe_l', 'toe_r',
  'spine', 'chest', 'neck', 'head',
  'shoulder_l', 'shoulder_r',
  'arm_l', 'arm_r',
  'forearm_l', 'forearm_r',
  'hand_l', 'hand_r',
];

/**
 * Wie eine Rolle heisst, wenn ein Mensch sie lesen soll.
 *
 * Die Rueckfragen gehen an den Menschen am Bildschirm, nicht an den Agenten.
 * Vorher stand dort woertlich „Ist ‚mixamorigLeftFoot' die Rolle foot_l?
 * Vorschlag mit Konfidenz 0.72, sicher ab 0.9." — drei Fachbegriffe und zwei
 * Schwellwerte in einem Satz. Wer die Werkzeugschicht nicht kennt, kann das
 * nicht beantworten, und wer sie kennt, braucht die Frage nicht.
 *
 * Der Knochen leuchtet im Bild, waehrend gefragt wird (src/ui/rollen-bestaetigung.js).
 * Die Frage muss deshalb nur noch benennen, WAS leuchten soll.
 */
export const ROLLENNAME = {
  pelvis: 'das Becken',
  foot_l: 'der linke Fuß', foot_r: 'der rechte Fuß',
  thigh_l: 'der linke Oberschenkel', thigh_r: 'der rechte Oberschenkel',
  shin_l: 'der linke Unterschenkel', shin_r: 'der rechte Unterschenkel',
  toe_l: 'die linken Zehen', toe_r: 'die rechten Zehen',
  spine: 'die untere Wirbelsäule', chest: 'der Brustkorb',
  neck: 'der Hals', head: 'der Kopf',
  shoulder_l: 'die linke Schulter', shoulder_r: 'die rechte Schulter',
  arm_l: 'der linke Oberarm', arm_r: 'der rechte Oberarm',
  forearm_l: 'der linke Unterarm', forearm_r: 'der rechte Unterarm',
  hand_l: 'die linke Hand', hand_r: 'die rechte Hand',
};

/** Rollenname fuer den Menschen; unbekannte Rollen behalten ihren Bezeichner. */
export function menschlich(rolle) {
  return ROLLENNAME[rolle] ?? rolle;
}

/** Pflichtrollen des RigProfile-Vertrags: fehlt eine, wird abgelehnt. */
export const PFLICHTROLLEN = ['pelvis', 'foot_l', 'foot_r'];

/** Rollen, deren Seite von der Blickrichtung abhängt. */
export const SEITENROLLEN = ROLLEN.filter((r) => /_[lr]$/.test(r));

/** Abgelehnt, statt geraten. Meldung enthält immer Zahlen. */
export class RigAbweisung extends Error {
  constructor(meldung, grund = 'unbekannt', zahlen = {}) {
    super(meldung);
    this.name = 'RigAbweisung';
    this.grund = grund;
    this.zahlen = zahlen;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vektorhelfer
// ─────────────────────────────────────────────────────────────────────────────

const nul3 = () => [0, 0, 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const laenge = (a) => Math.hypot(a[0], a[1], a[2]);
const kreuz = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function norm(a) {
  const l = laenge(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : nul3();
}
/** Winkel zweier Richtungen in Grad; 0 bei entartetem Vektor. */
function winkel(a, b) {
  const la = laenge(a), lb = laenge(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = Math.max(-1, Math.min(1, punkt(a, b) / (la * lb)));
  return Math.acos(c) * 180 / Math.PI;
}
/** 0 unter min, 1 über max, dazwischen linear. */
function stufe(x, min, max) {
  if (max === min) return x >= max ? 1 : 0;
  if (!(x > min)) return 0;
  if (x >= max) return 1;
  return (x - min) / (max - min);
}
/** Wie stufe, aber fallend: 1 unter min, 0 über max. */
function tie(x, min, max) { return 1 - stufe(x, min, max); }
const klemm01 = (x) => Math.max(0, Math.min(1, x));
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Number(x.toFixed(4));
const r5 = (x) => Number(x.toFixed(5));

/** Zwei Richtungen senkrecht zu u, deterministisch aus dem kleinsten Achsen-
 *  anteil von u — gleiche Eingabe, gleiche Basis. */
function basisSenkrecht(u) {
  const k = [Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])];
  const hilfs = k[0] <= k[1] && k[0] <= k[2] ? [1, 0, 0]
    : k[1] <= k[2] ? [0, 1, 0] : [0, 0, 1];
  const e1 = norm(kreuz(u, hilfs));
  const e2 = norm(kreuz(u, e1));
  return [e1, e2];
}

/** Achsenname samt Vorzeichen, der einer Richtung am nächsten kommt. */
function achsName(v) {
  const k = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  const i = k[0] >= k[1] && k[0] >= k[2] ? 0 : k[1] >= k[2] ? 1 : 2;
  return (v[i] < 0 ? '-' : '') + 'xyz'[i];
}

function median(werte) {
  if (!werte.length) return 0;
  const s = werte.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Skelett einsammeln — flach, namenunabhängig, mit Teilbäumen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{scene: object}} gltf Loader-Ergebnis
 * @returns {object} {entries, roots, teilbaum, index, meshes, boneCount}
 */
export function sammleKnochen(gltf) {
  const szene = gltf && gltf.scene;
  if (!szene || typeof szene.traverse !== 'function') {
    throw new RigAbweisung(
      `Erkennung abgelehnt: kein Szenen-Objekt im Loader-Ergebnis (${szene === null || szene === undefined ? String(szene) : typeof szene})`,
      'keine-szene');
  }
  szene.updateMatrixWorld(true);

  const boneObjs = [];
  const meshes = [];
  szene.traverse((o) => {
    if (o.isBone) boneObjs.push(o);
    else if (o.isSkinnedMesh) meshes.push(o);
  });
  // Fallback: Modelle, deren Häutung ohne Bone-Knoten gebaut wurde
  if (boneObjs.length === 0) {
    for (const m of meshes) {
      for (const b of (m.skeleton ? m.skeleton.bones : [])) {
        if (boneObjs.indexOf(b) < 0) boneObjs.push(b);
      }
    }
  }
  if (boneObjs.length === 0 || meshes.length === 0) {
    throw new RigAbweisung(
      `Erkennung abgelehnt: ${boneObjs.length} Knochen, ${meshes.length} gehäutete Meshes — gebraucht werden mindestens ein Knochen und Körperoberfläche`,
      'kein-skelett', { boneCount: boneObjs.length, skinnedMeshCount: meshes.length });
  }

  // ids: Name, bei Mehrdeutigkeit oder leerem Name mit Indexzusatz. Der Name
  // ist Bezeichnung, nie Kriterium.
  const zählung = new Map();
  for (const b of boneObjs) zählung.set(b.name, (zählung.get(b.name) || 0) + 1);

  const index = new Map();
  const entries = [];
  for (const obj of boneObjs) {
    if (index.has(obj)) continue;
    const m = obj.matrixWorld.elements;
    const roh = typeof obj.name === 'string' ? obj.name : '';
    const i = entries.length;
    index.set(obj, i);
    entries.push({
      i, obj,
      name: roh,
      id: zählung.get(roh) > 1 || roh === '' ? `${roh || 'bone'}#${i}` : roh,
      welt: [m[12], m[13], m[14]],
      parent: null,
      kinder: [],
      endpunkte: [],
      tiefe: 0,
    });
  }

  const roots = [];
  for (const e of entries) {
    let a = e.obj.parent;
    while (a && !index.has(a)) a = a.parent;   // Nicht-Knochen überspringen
    if (!a) roots.push(e.i);
    else {
      e.parent = index.get(a);
      entries[e.parent].kinder.push(e.i);
    }
  }

  // Endpunkte (kein Skin-Knochen, z. B. „HeadTop_End“) nur als Messpunkt.
  for (const e of entries) {
    for (const kind of e.obj.children) {
      if (index.has(kind) || kind.isMesh) continue;
      kind.updateWorldMatrix(true, false);
      const m = kind.matrixWorld.elements;
      e.endpunkte.push([m[12], m[13], m[14]]);
    }
  }

  // Teilbäume: jeder Eintrag enthält alle absteigenden Knochen, nicht nur die
  // direkten Kinder — Reichweitenfragen gehen sonst einen Knoten zu kurz.
  const teilbaum = entries.map(() => []);
  const abwaerts = (i, d) => {
    entries[i].tiefe = d;
    for (const k of entries[i].kinder) {
      abwaerts(k, d + 1);
      teilbaum[i].push(k, ...teilbaum[k]);
    }
  };
  for (const r of roots) abwaerts(r, 0);

  return {
    entries, roots, teilbaum, index, meshes,
    boneCount: entries.length,
    namenOhne: entries.filter((e) => e.name === '').length,
    namenDoppelt: entries.length - new Set(entries.map((e) => e.name)).size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Körperoberfläche: Vertices in Weltkoordinaten, dominanter Knochen dazu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bind-Pose-Oberfläche in Weltkoordinaten. Dominanter Knochen je Vertex = der
 * mit dem höchsten Hautgewicht ab 0,5; ohne erreichen Wert bleibt der Vertex
 * ohne Eigentümer (–1) und wird für keine Zuordnung benutzt.
 *
 * Der Weg führt über `getVertexPosition` und `localToWorld` — dasselbe
 * Verfahren wie in der Vermessung (AP2), mit demselben Grund: die rohe
 * Geometrie gehäuteter Meshes liegt nicht im Objektraum, sondern im
 * Skin-Raum. Wer matrixWorld auf die Rohkoordinaten legt, bekommt bei einer
 * Mixamo-Figur 1,8 cm statt 1,8 m.
 */
export function punktwolke(kn) {
  const xs = [];
  const dom = [];
  let mitGewicht = 0, ohneGewicht = 0;
  const v = new THREE.Vector3();

  for (const mesh of kn.meshes) {
    const geo = mesh.geometry;
    const pos = geo && geo.attributes && geo.attributes.position;
    if (!pos) continue;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    if (si && sw) mitGewicht++; else ohneGewicht++;
    mesh.updateWorldMatrix(true, false);
    const bones = mesh.skeleton ? mesh.skeleton.bones : [];
    if (bones.length && typeof mesh.skeleton.update === 'function') {
      mesh.skeleton.update();   // Knochenmatrizen auf den Stand der Szene bringen
    }

    for (let k = 0; k < pos.count; k++) {
      if (typeof mesh.getVertexPosition === 'function') {
        mesh.getVertexPosition(k, v);
      } else {
        v.set(pos.getX(k), pos.getY(k), pos.getZ(k));
      }
      v.applyMatrix4(mesh.matrixWorld);
      xs.push(v.x, v.y, v.z);

      let d = -1;
      if (si && sw && bones.length) {
        let best = 0.5;
        for (let w = 0; w < 4; w++) {
          const gewicht = sw.getComponent(k, w);
          if (gewicht >= best) {
            const di = kn.index.get(bones[si.getComponent(k, w)]);
            if (di !== undefined) { best = gewicht; d = di; }
          }
        }
      }
      dom.push(d);
    }
  }

  const n = dom.length;
  if (n === 0) {
    throw new RigAbweisung(
      `Erkennung abgelehnt: 0 Vertices aus ${kn.meshes.length} gehäuteten Meshes gemessen — ohne Körperoberfläche ist nichts zuzuordnen`,
      'keine-vertices', { vertexCount: 0 });
  }
  return {
    pts: Float64Array.from(xs),
    dom: Int32Array.from(dom),
    count: n,
    meshesMitGewicht: mitGewicht,
    meshesOhneGewicht: ohneGewicht,
    ohneOwner: dom.filter((d) => d < 0).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Aufwärtsachse
// ─────────────────────────────────────────────────────────────────────────────

/** Haupttragheiten der Punktwolke: zyklisches Jacobi auf der Kovarianz. */
function hauptagen(wolke) {
  const p = wolke.pts, n = wolke.count;
  const mid = nul3();
  for (let i = 0; i < n; i++) { mid[0] += p[3 * i]; mid[1] += p[3 * i + 1]; mid[2] += p[3 * i + 2]; }
  mid[0] /= n; mid[1] /= n; mid[2] /= n;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const schritt = Math.max(1, Math.floor(n / 4000));
  let gez = 0;
  for (let i = 0; i < n; i += schritt) {
    const d = [p[3 * i] - mid[0], p[3 * i + 1] - mid[1], p[3 * i + 2] - mid[2]];
    gez++;
    for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) cov[a][b] += d[a] * d[b];
  }
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] /= Math.max(1, gez - 1);
  for (let a = 0; a < 3; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a];

  let m = cov.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let lauf = 0; lauf < 10; lauf++) {
    let größe = 0;
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) größe = Math.max(größe, Math.abs(m[a][b]));
    if (größe < 1e-14) break;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        if (Math.abs(m[a][b]) < 1e-15) continue;
        const theta = (m[b][b] - m[a][a]) / (2 * m[a][b]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = c * t;
        const alt = m.map((r) => r.slice());
        m[a][a] = c * c * alt[a][a] - 2 * c * s * alt[a][b] + s * s * alt[b][b];
        m[b][b] = s * s * alt[a][a] + 2 * c * s * alt[a][b] + c * c * alt[b][b];
        m[a][b] = 0; m[b][a] = 0;
        for (let k = 0; k < 3; k++) {
          if (k !== a && k !== b) {
            const mk = [alt[k][a], alt[k][b]];
            m[k][a] = m[a][k] = c * mk[0] - s * mk[1];
            m[k][b] = m[b][k] = s * mk[0] + c * mk[1];
          }
          const vk = [v[k][a], v[k][b]];
          v[k][a] = c * vk[0] - s * vk[1];
          v[k][b] = s * vk[0] + c * vk[1];
        }
      }
    }
  }
  const out = [];
  for (let k = 0; k < 3; k++) {
    const a = norm([v[0][k], v[1][k], v[2][k]]);
    if (laenge(a) > 0) out.push(a, mul(a, -1));
  }
  return out;
}
/** Kandidaten: Weltachsen beidseitig plus Hauptagen der Körperoberfläche. */
function achsenKandidaten(wolke) {
  const welt = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const out = [];
  for (const u of welt.concat(hauptagen(wolke))) {
    if (laenge(u) < 1e-9) continue;
    if (out.some((s) => winkel(s, u) < 1)) continue;
    out.push(u);
  }
  return out;
}

/** Rasterzellen zu zusammenhängenden Haufen verbinden (8er-Nachbarschaft). */
function verbindeZellen(zellen) {
  const liste = [...zellen.entries()];
  const ort = new Map(liste.map(([k], i) => [k, i]));
  const besucht = new Set();
  const out = [];
  for (let s = 0; s < liste.length; s++) {
    if (besucht.has(s)) continue;
    besucht.add(s);
    const schlange = [s];
    const gruppe = [];
    while (schlange.length) {
      const cur = schlange.pop();
      const [key, e] = liste[cur];
      gruppe.push(e);
      const trenner = key.indexOf(',');
      const ka = Number(key.slice(0, trenner)), kb = Number(key.slice(trenner + 1));
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          const j = ort.get(`${ka + da},${kb + db}`);
          if (j !== undefined && !besucht.has(j)) { besucht.add(j); schlange.push(j); }
        }
      }
    }
    let anzahl = 0, aw = 0, bw = 0;
    const besitz = new Map();
    for (const e of gruppe) {
      anzahl += e.n; aw += e.a * e.n; bw += e.b * e.n;
      for (const [d, k] of e.besitz) besitz.set(d, (besitz.get(d) || 0) + k);
    }
    if (!anzahl) continue;
    const a = aw / anzahl, b = bw / anzahl;
    let radius = 0;
    for (const e of gruppe) radius = Math.max(radius, Math.hypot(e.a - a, e.b - b));
    out.push({ anzahl, a, b, radius, besitz, zellen: gruppe.length });
  }
  out.sort((x, y) => y.anzahl - x.anzahl);
  return out;
}

/**
 * Einen Richtungssatz vollständig vermessen: Höhen, Bodencluster, Kopf-
 * bereich, Gelenkhöhen, Reichweiten, Beckenkandidaten. Das Siegerergebnis
 * wird weiterverwendet — nichts wird zweimal gerechnet.
 */
function vermessung(u, kn, wolke, params) {
  const p = wolke.pts, n = wolke.count;
  const hoehe = new Float64Array(n);
  let tief = Infinity, hoch = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = p[3 * i] * u[0] + p[3 * i + 1] * u[1] + p[3 * i + 2] * u[2];
    hoehe[i] = h;
    if (h < tief) tief = h;
    if (h > hoch) hoch = h;
  }
  const spanne = hoch - tief;
  if (!(spanne > 1e-9)) return null;

  const [e1, e2] = basisSenkrecht(u);
  const band = params.bodenBand * spanne;
  const fussGrenze = tief + params.fussReichweite * spanne;
  const spitzeGrenze = hoch - params.rumpfSpitzeToleranz * spanne;

  // ── Bodencluster im Raster senkrecht zu u
  const zelle = params.rasterzelle * spanne;
  const zellen = new Map();
  const bodenBesitz = new Map();
  let bodenAnzahl = 0;
  for (let i = 0; i < n; i++) {
    if (hoehe[i] > tief + band) continue;
    bodenAnzahl++;
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    const a = x * e1[0] + y * e1[1] + z * e1[2];
    const b = x * e2[0] + y * e2[1] + z * e2[2];
    const key = `${Math.floor(a / zelle)},${Math.floor(b / zelle)}`;
    let e = zellen.get(key);
    if (!e) { e = { a, b, n: 0, besitz: new Map() }; zellen.set(key, e); }
    e.n++;
    const d = wolke.dom[i];
    if (d >= 0) {
      e.besitz.set(d, (e.besitz.get(d) || 0) + 1);
      bodenBesitz.set(d, (bodenBesitz.get(d) || 0) + 1);
    }
  }
  // Kein Größenfilter nach Vertexzahl: die Zahl der Bodenvertices hängt von der
  // Mesh-Auflösung ab, nicht von der Figur (Xbot 774 je Fuß, Kenney-Figur 24).
  // Rauschen fällt später über den Flächenanteil der Kette weg, PARAMS.fussMinAnteil.
  const haufen = verbindeZellen(zellen);

  // ── Höchste und tiefste Körperstelle je Knochen: eine Kette reicht bis an die
  // Modellspitze, auch wenn ihr eigenes Gelenk tief sitzt (Figuren ohne Kopf-
  // oder Fußknochen: die Haut reicht weiter als das Skelett).
  const eigensHoehe = kn.entries.map(() => ({ max: -Infinity, min: Infinity }));
  for (let i = 0; i < n; i++) {
    const d = wolke.dom[i];
    if (d < 0) continue;
    if (hoehe[i] > eigensHoehe[d].max) eigensHoehe[d].max = hoehe[i];
    if (hoehe[i] < eigensHoehe[d].min) eigensHoehe[d].min = hoehe[i];
  }
  for (const e of eigensHoehe) {
    if (!isFinite(e.max)) { e.max = null; e.min = null; }
  }

  // ── Kopfbereich: wer dominiert die obersten Vertices
  const kopfBesitz = new Map();
  let kopfAnzahl = 0;
  for (let i = 0; i < n; i++) {
    if (hoehe[i] < hoch - band) continue;
    kopfAnzahl++;
    const d = wolke.dom[i];
    if (d >= 0) kopfBesitz.set(d, (kopfBesitz.get(d) || 0) + 1);
  }
  let kopfKnochen = -1, kopfMax = 0;
  for (const [d, k] of kopfBesitz) if (k > kopfMax) { kopfMax = k; kopfKnochen = d; }

  // ── Gelenkhöhen, Endpunkthöhen, Reichweiten
  const gj = kn.entries.map((e) => punkt(e.welt, u));
  const endHöhen = kn.entries.map((e) => e.endpunkte.map((q) => punkt(q, u)));
  const reichtBis = (i, grenzwert, oben, besitz) => {
    for (const k of [i, ...kn.teilbaum[i]]) {
      if (besitz.get(k)) return true;
      if (oben ? gj[k] >= grenzwert : gj[k] <= grenzwert) return true;
      if (endHöhen[k].some((h) => (oben ? h >= grenzwert : h <= grenzwert))) return true;
      // Die Haut der Kette reicht weiter als ihr letztes Gelenk: Figuren ohne
      // Kopf- oder Fußknochen erreichen Spitze und Boden nur über sie.
      const koerper = eigensHoehe[k];
      if (koerper.max !== null && (oben ? koerper.max >= grenzwert : koerper.min <= grenzwert)) return true;
    }
    return false;
  };
  const erreichtBoden = kn.entries.map((e, i) => reichtBis(i, fussGrenze, false, bodenBesitz));
  const erreichtSpitze = kn.entries.map((e, i) => reichtBis(i, spitzeGrenze, true, kopfBesitz));

  // ── Beckenkandidaten: Kinderketten, die am Boden bzw. an der Spitze enden
  const kandidaten = [];
  kn.entries.forEach((e, i) => {
    const beine = e.kinder.filter((k) => erreichtBoden[k]);
    if (!beine.length) return;
    const aufwaerts = e.kinder.filter((k) => erreichtSpitze[k] && !erreichtBoden[k]);
    if (!aufwaerts.length) return;
    kandidaten.push({ i, beine, aufwaerts, anteil: (gj[i] - tief) / spanne, tiefe: e.tiefe });
  });

  return {
    u, e1, e2, hoehe, tief, hoch, spanne, band, fussGrenze, spitzeGrenze,
    gelenkHoehe: gj, endHöhen, erreichtBoden, erreichtSpitze, eigensHoehe,
    zellen, haufen, bodenBesitz, bodenAnzahl, kopfBesitz, kopfKnochen, kopfMax, kopfAnzahl,
    kandidaten,
  };
}

/**
 * Spiegelbildprüfung: Höhenprofil der einen Seite gegen die andere.
 * Seitenachse und Mitte kommen aus dem gemessenen Stand (Verbindungslinie der
 * beiden Fußflächen); ohne zwei Fußflächen ist die Prüfung nicht möglich.
 */
function asymmetrie(V, wolke, stand) {
  if (!stand || stand.length !== 2) return 1;
  const seit = norm(add(mul(V.e1, stand[0].a - stand[1].a), mul(V.e2, stand[0].b - stand[1].b)));
  if (!laenge(seit)) return 1;
  const mit = add(mul(V.e1, (stand[0].a + stand[1].a) / 2),
    mul(V.e2, (stand[0].b + stand[1].b) / 2));
  const p = wolke.pts, n = wolke.count;
  const s = new Float64Array(n);
  let weite = 0;
  for (let i = 0; i < n; i++) {
    const q = [p[3 * i] - mit[0], p[3 * i + 1] - mit[1], p[3 * i + 2] - mit[2]];
    const v = punkt(q, seit);
    s[i] = v;
    if (Math.abs(v) > weite) weite = Math.abs(v);
  }
  if (!(weite > 0)) return 1;
  const B = 16;
  const sumA = new Float64Array(B), cntA = new Float64Array(B);
  const sumB = new Float64Array(B), cntB = new Float64Array(B);
  for (let i = 0; i < n; i++) {
    const b = Math.min(B - 1, Math.floor(Math.abs(s[i]) / weite * B));
    if (s[i] >= 0) { sumA[b] += V.hoehe[i]; cntA[b]++; } else { sumB[b] += V.hoehe[i]; cntB[b]++; }
  }
  let diff = 0, belegt = 0;
  for (let b = 0; b < B; b++) {
    if (cntA[b] < 4 || cntB[b] < 4) continue;
    diff += Math.abs(sumA[b] / cntA[b] - sumB[b] / cntB[b]);
    belegt++;
  }
  if (!belegt) return 1;
  return diff / belegt / V.spanne;
}

/**
 * Die Fußflächen der zum Boden reichenden Ketten eines Beckenkandidaten: die
 * Bodenband-Punkte werden über die Hautgewichte den Ketten zugeordnet und zu
 * einer Fläche je Kette zusammengefasst.
 *
 * Nicht die Zahl der geometrischen Klebstoffe entscheidet, wie viele Füße auf
 * dem Boden stehen, sondern wie viele Ketten Bodenfläche besitzen — ein
 * hochaufgelöstes Mesh liefert je Fuß einen einzigen Haufen, ein flaches 16
 * (an der Kenney-Figur gemessen, je Kette 8).
 */
function fussflecken(becken, V, kn) {
  const bäume = becken.beine.map((b) => new Set([b, ...kn.teilbaum[b]]));
  return becken.beine.map((wurzel, nr) => {
    let anzahl = 0, gewicht = 0, aw = 0, bw = 0;
    const punkte = [];
    for (const c of V.haufen) {
      let besitz = 0;
      for (const [d, k] of c.besitz) if (bäume[nr].has(d)) besitz += k;
      if (!besitz) continue;
      anzahl += besitz;
      gewicht += besitz;
      aw += c.a * besitz;
      bw += c.b * besitz;
      punkte.push([c.a, c.b, besitz]);
    }
    if (!anzahl) return { nr, wurzel, anzahl: 0, anteil: 0, a: 0, b: 0, radius: 0 };
    const a = aw / gewicht, b = bw / gewicht;
    let radius = 0;
    for (const [pa, pb] of punkte) {
      radius = Math.max(radius, Math.hypot(pa - a, pb - b));
    }
    return {
      nr, wurzel, anzahl,
      anteil: anzahl / Math.max(1, V.bodenAnzahl),
      a, b, radius,
    };
  });
}

/** Wert einer Achse 0…1 als Produkt ihrer Merkmale, jedes an eine Messung
 *  gebunden. Ein Faktor 0 macht die Achse unmöglich. */
function bewerte(V, kn, wolke, params) {
  const faktoren = [];
  const push = (name, wert, messung) => faktoren.push({ name, wert: klemm01(wert), messung });
  if (!V) {
    push('achse', 0, 'Richtung ohne messbare Ausdehnung');
    return { wert: 0, faktoren };
  }

  const gute = V.kandidaten.filter((c) => c.beine.length === 2);
  push('becken', gute.length ? 1 : 0.02,
    `${gute.length} von ${V.kandidaten.length} Kandidaten mit genau 2 zum Boden reichenden Ketten`);
  if (!gute.length) return { wert: 0, faktoren, V };

  const becken = bestesBecken(gute, params);
  const flecken = fussflecken(becken, V, kn);
  const stand = flecken.filter((f) => f.anzahl > 0
    && f.anteil >= params.fussMinAnteil
    && f.radius / V.spanne <= params.fussRadiusMax);

  push('bodenfuesse', stand.length === 2 ? 1 : stand.length === 3 ? 0.5 : stand.length === 4 ? 0.35
    : stand.length > 4 ? 0.1 : 0.02,
    `${stand.length} von ${flecken.length} Bodenketten stehen auf eigener Fläche `
    + `(${flecken.map((f) => `${kn.entries[f.wurzel].id} ${(f.anteil * 100).toFixed(0)} %`).join(', ')}), `
    + `erwartet 2 ab ${params.fussMinAnteil} Anteil`);
  if (stand.length !== 2) return { wert: 0, faktoren, V, becken, flecken, stand };

  const rMax = Math.max(stand[0].radius, stand[1].radius) / V.spanne;
  push('fussflaeche', tie(rMax, params.fussRadiusMax * 0.6, params.fussRadiusMax),
    `größte Fußausdehnung ${r3(rMax)} der Höhe, Grenze ${params.fussRadiusMax}`);
  const ab = laenge([stand[0].a - stand[1].a, stand[0].b - stand[1].b, 0]) / V.spanne;
  push('fussabstand', stufe(ab, params.fussAbstandMin, params.fussAbstandMin * 3)
    * tie(ab, params.fussAbstandMax * 0.7, params.fussAbstandMax),
    `Fußabstand ${r3(ab)} der Höhe, erlaubt ${params.fussAbstandMin}…${params.fussAbstandMax}`);

  // Hüfthöhe: wo die zwei standgebenden Ketten ansetzen — nicht das Gelenk des
  // Kandidaten selbst, das ist bei Benutzergelenken der Boden.
  const huefteAnteil = median(stand.map((f) => (V.gelenkHoehe[f.wurzel] - V.tief) / V.spanne));
  push('hueftlage', stufe(huefteAnteil, params.beckenHoeheMin, params.beckenHoeheMin + 0.06)
    * tie(huefteAnteil, params.beckenHoeheMax - 0.06, params.beckenHoeheMax),
    `Hüftgelenke der Bodenketten auf ${(huefteAnteil * 100).toFixed(1)} % der Höhe, erlaubt `
    + `${(params.beckenHoeheMin * 100).toFixed(0)}…${(params.beckenHoeheMax * 100).toFixed(0)} %`);

  let oben = -Infinity;
  for (const c of becken.aufwaerts) {
    for (const j of [c, ...kn.teilbaum[c]]) {
      oben = Math.max(oben, V.gelenkHoehe[j], ...V.endHöhen[j],
        V.eigensHoehe[j].max === null ? -Infinity : V.eigensHoehe[j].max);
    }
  }
  const rumpfAnteil = (oben - V.tief) / V.spanne;
  push('rumpf', stufe(rumpfAnteil, 0.75, 0.9),
    `höchster Punkt der Aufwärtskette bis einschließlich ihrer Haut auf ${(rumpfAnteil * 100).toFixed(1)} % der Höhe`);

  const as = asymmetrie(V, wolke, stand);
  push('symmetrie', tie(as, params.asymmetrieMax * 0.3, params.asymmetrieMax * 1.5),
    `Spiegelbildprüfung: mittlere Profildifferenz ${as.toFixed(4)} der Höhe`);

  let wert = 1;
  for (const f of faktoren) wert *= f.wert;
  return { wert, faktoren, V, becken, flecken, stand };
}

/** Beckenwahl: der tiefste Kandidat — ein Wurzelknochen über dem Becken
 *  erfüllt dieselben Bedingungen und soll dem Becken weichen. */
function bestesBecken(kandidaten, params) {
  const mitte = (params.beckenHoeheMin + params.beckenHoeheMax) / 2;
  let tiefst = Infinity;
  for (const c of kandidaten) tiefst = Math.min(tiefst, c.tiefe);
  const engste = kandidaten.filter((c) => c.tiefe === tiefst);
  engste.sort((a, b) => Math.abs(a.anteil - mitte) - Math.abs(b.anteil - mitte));
  return engste[0];
}

/** Beste Achse samt Bewertung. */
function achseFinden(kn, wolke, params) {
  const ergebnisse = [];
  for (const u of achsenKandidaten(wolke)) {
    const V = vermessung(u, kn, wolke, params);
    const b = bewerte(V, kn, wolke, params);
    b.u = u;
    ergebnisse.push(b);
  }
  ergebnisse.sort((a, b) => b.wert - a.wert);
  return { beste: ergebnisse[0] || null, alle: ergebnisse };
}

/**
 * Die Meldung, wenn keine Achse durchdringt. So konkret wie die Vermessung
 * schon gekommen ist: wer zwei Bodenknochen hat, aber auf einem Fuß steht,
 * braucht eine andere Antwort als ein Modell ohne jede Spur eines Skeletts.
 */
function achsenAbweisung(beste, alle, kn, params) {
  const wert = r3(beste ? beste.wert : 0);
  if (beste && beste.flecken) {
    const anzahl = beste.stand ? beste.stand.length : 0;
    return new RigAbweisung(
      `Erkennung abgelehnt: ${anzahl} von ${beste.flecken.length} Bodenknochen stehen auf eigener Fußfläche, `
      + `erwartet genau 2 (bester Achsenwert ${wert} unter der Grenze ${params.achsenwertMin}, `
      + `${beste.V.haufen.length} Bodenflächen im Band von ${r5(beste.V.band)} m, `
      + `Körperhöhe ${r4(beste.V.spanne)} m) — `
      + (anzahl > 2 ? 'vierbeinige Modelle werden nicht unterstützt'
        : 'ohne zwei getrennte Füße ist kein Mensch zu erkennen'),
      anzahl > 2 ? 'mehrere-beine' : 'kein-zweibeiner',
      { bodenketten: anzahl, gepruefteRichtungen: alle.length, achsenwert: wert });
  }
  return new RigAbweisung(
    `Erkennung abgelehnt: kein aufrechtes zweibeiniges Skelett — bester Achsenwert ${wert} unter der Grenze `
    + `${params.achsenwertMin} aus ${alle.length} geprüften Richtungen`
    + (beste && beste.faktoren.length
      ? ` (${beste.faktoren.slice(0, 4).map((f) => `${f.name}=${r3(f.wert)}`).join(', ')})` : ''),
    'keine-aufrichte-achse',
    { achsenwert: wert, gepruefteRichtungen: alle.length, grenze: params.achsenwertMin });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ketten: Wege zwischen Gelenken, Gelenkauswahl
// ─────────────────────────────────────────────────────────────────────────────

/** Knochen auf dem Weg von `von` (inclusiv) abwärts nach `nach`. [] wenn `nach`
 *  nicht im Teilbaum von `von` liegt. */
function pfad(kn, von, nach) {
  const out = [];
  let cur = nach;
  for (let schutz = 0; cur !== null && cur !== undefined && schutz < 10000; schutz++) {
    out.unshift(cur);
    if (cur === von) return out;
    cur = kn.entries[cur].parent;
  }
  return [];
}

/** Kette vom Startknochen zum am weitesten entfernten Gelenk seines Teilbaums. */
function tiefsteKette(kn, start) {
  let best = start, weiteste = -1;
  for (const k of [start, ...kn.teilbaum[start]]) {
    const d = laenge(sub(kn.entries[k].welt, kn.entries[start].welt));
    if (d > weiteste) { weiteste = d; best = k; }
  }
  return pfad(kn, start, best);
}

/** Richtung vom Gelenk zum nächsten Punkt der Kette abwärts. */
function auswärts(kn, V, b) {
  const kinder = kn.entries[b].kinder;
  if (!kinder.length) {
    const e = kn.entries[b].endpunkte;
    return e.length ? sub(e[0], kn.entries[b].welt) : nul3();
  }
  const tiefstes = kinder.reduce((a, c) =>
    (V.gelenkHoehe[c] < V.gelenkHoehe[a] ? c : a), kinder[0]);
  return sub(kn.entries[tiefstes].welt, kn.entries[b].welt);
}
function einwärts(kn, b) {
  const p = kn.entries[b].parent;
  return p === null ? nul3() : sub(kn.entries[b].welt, kn.entries[p].welt);
}

/**
 * Das Fußgelenk einer Beinkette: der Gelenkpunkt in Fußreichweite, an dem die
 * Kette am stärksten nach unten/vorn abknickt. Twist-Knochen sind kollinear
 * und gewinnen deshalb nicht gegen ein echtes Sprunggelenk.
 *
 * Ketten ohne Gelenk in Fußreichweite — eine Spielfigur mit einem einzigen
 * Bein-Knochen — bekommen das tiefste Gelenk der Kette, wenn ihre Haut den
 * Boden berührt: die Kette endet nachweislich im Fuß, ein eigenes Sprunggelenk
 * ist aber nicht vorhanden. Das ist kein Rat, sondern die einzige Stelle, die
 * es in diesem Skelett sein kann; die Konfidenz trägt den Vermerk.
 */
function fussgelenk(kn, V, beinWurzel, baum, params) {
  const bodenAnteil = baum.reduce((s, b) => s + (V.bodenBesitz.get(b) || 0), 0);
  const kandidaten = [];
  for (const b of baum) {
    if (V.gelenkHoehe[b] > V.fussGrenze) continue;
    const ein = einwärts(kn, b), aus = auswärts(kn, V, b);
    const knick = laenge(ein) && laenge(aus) ? winkel(ein, aus) : 0;
    kandidaten.push({ b, knick, besitz: V.bodenBesitz.get(b) || 0, hoehe: V.gelenkHoehe[b] });
  }
  if (!kandidaten.length) {
    if (!bodenAnteil) return null;
    const tiefstes = baum.reduce((a, c) => (V.gelenkHoehe[c] < V.gelenkHoehe[a] ? c : a), beinWurzel);
    return {
      b: tiefstes, knick: 0, besitz: bodenAnteil, hoehe: V.gelenkHoehe[tiefstes],
      sicher: false, ohneGelenk: true,
      kandidaten: [{ bone: kn.entries[tiefstes].id, knick: 0, besitz: bodenAnteil }],
      alternative: [],
    };
  }
  const nachKnick = kandidaten.slice().sort((x, y) => (y.knick - x.knick) || (y.besitz - x.besitz));
  const nachLage = kandidaten.slice().sort((x, y) => y.hoehe - x.hoehe);
  const sicher = nachKnick[0].knick >= params.fussKnicksMinGrad;
  const wähle = sicher ? nachKnick[0] : nachLage[0];
  // Gegenkandidaten sind Gelenke auf derselben Höhe, nicht die Knochen unterhalb
  // des gewählten: Zehen liegen in Fußreichweite, sind aber der Abstieg des
  // Sprunggelenks, keine zweite Antwort auf dieselbe Frage.
  const abwaerts = new Set(kn.teilbaum[wähle.b]);
  const gegner = kandidaten.filter((c) => c.b !== wähle.b
    && !abwaerts.has(c.b) && !baum.slice(0, baum.indexOf(wähle.b)).includes(c.b));
  return {
    ...wähle,
    sicher,
    knick: r3(wähle.knick),
    kandidaten: kandidaten.map((c) => ({ bone: kn.entries[c.b].id, knick: r3(c.knick), besitz: c.besitz })),
    alternative: gegner.map((c) => kn.entries[c.b].id),
  };
}

/**
 * Das mittlere Gelenk einer Kette (Knie, Ellbogen) zwischen zwei verankerten
 * Enden: das Gelenk mit dem stärksten Knick; wenn keiner messbar ist, das dem
 * Mittelweg nächste. Gibt Anzahl gleichwertiger Kandidaten mit aus — die
 * Konfidenz hängt daran.
 */
function mittelgelenk(kn, V, proximal, distal, params) {
  const innen = pfad(kn, proximal, distal).filter((b) => b !== proximal && b !== distal);
  if (!innen.length) return null;
  const pw = kn.entries[proximal].welt, dw = kn.entries[distal].welt;
  const mitte = mul(add(pw, dw), 0.5);
  const achse = norm(sub(dw, pw));
  const halbweg = Math.max(1e-9, laenge(sub(dw, pw)) / 2);
  const kanten = innen.map((b) => {
    const w = kn.entries[b].welt;
    const ein = einwärts(kn, b), aus = auswärts(kn, V, b);
    const knick = laenge(ein) && laenge(aus) ? winkel(ein, aus) : 0;
    const vomWeg = laenge(sub(w, add(pw, mul(achse, punkt(sub(w, pw), achse)))));
    return {
      b, knick: r3(knick),
      wegAnteil: r3(laenge(sub(w, mitte)) / halbweg),
      ausschlag: r5(vomWeg),
    };
  });
  const gebeugt = kanten.filter((k) => k.knick >= params.beugungMinGrad);
  const quelle = gebeugt.length ? 'beugung' : 'mittelweg';
  const rang = gebeugt.length
    ? kanten.slice().sort((a, b) => b.knick - a.knick)
    : kanten.slice().sort((a, b) => a.wegAnteil - b.wegAnteil);
  const wähle = rang[0];
  const gleichwertige = rang.slice(1).filter((k) => (gebeugt.length
    ? Math.abs(k.knick - wähle.knick) < params.beugungMinGrad
    : Math.abs(k.wegAnteil - wähle.wegAnteil) < 0.25)).length;
  return { ...wähle, gelenke: kanten.length, gleichwertige, quelle, rangfolge: rang.map((k) => kn.entries[k.b].id) };
}

/** Handgelenk einer Armkette: der Knochen, an dem viele kurze Kinderketten
 *  sitzen, sonst das Kettenende nach Abscheiden kurzer Endglieder. */
function handgelenk(kn, kette, params) {
  const segmente = [];
  for (let i = 1; i < kette.length; i++) {
    segmente.push(laenge(sub(kn.entries[kette[i]].welt, kn.entries[kette[i - 1]].welt)));
  }
  // Gliederungsmaß der Kette ist ihr längstes Segment — Schulter- oder
  // Oberarmlänge. Der Mittelwert einer bis in die Fingerspitze reichenden
  // Kette wäre von den Fingern selbst heruntergezogen.
  const gliederung = segmente.length ? Math.max(...segmente) : 0;
  const grenze = params.fingerKuerze * gliederung;
  for (const b of kette) {
    const kurze = kn.entries[b].kinder.filter((k) =>
      laenge(sub(kn.entries[k].welt, kn.entries[b].welt)) < grenze);
    if (kurze.length >= params.fingerZweige) {
      return { b, wegen: 'fingerzweige', zweige: kurze.length };
    }
  }
  // Kurze Endglieder abscheiden: ein Glied, das deutlich kürzer ist als die
  // Gliederung der Kette, ist ein Fingerlauf, kein Handgelenk.
  let end = kette.length - 1;
  while (end > 1 && segmente[end - 1] < grenze) end--;
  return { b: kette[end], wegen: end === kette.length - 1 ? 'kettenende' : 'kurze endglieder', zweige: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Blickrichtung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drei geometrische Signale (plan.md 6.1): Ferse-zu-Zeh, Kniescheibe, Kopf-
 * vorsprung. Senkrecht zur Aufwärtsachse und zur Achse zwischen den Füßen.
 * Stimmen sie nicht überein oder fehlt jede Spur, bleibt die Richtung null —
 * dann wird der Mensch gefragt, nicht geraten.
 */
function blickRichtung(kn, V, wolke, u, seit, beine, kopf, params) {
  const signale = [];
  const horizontal = (w) => {
    let v = sub(w, mul(u, punkt(w, u)));
    v = sub(v, mul(seit, punkt(v, seit)));
    return v;
  };
  for (const Bein of beine) {
    const fuss = Bein.fuss.b;
    const knöchel = kn.entries[fuss].welt;
    // Fußspitze: entferntester Bodenvertex dieser Beinkette vom Knöchel
    const bäume = new Set([Bein.wurzel, ...kn.teilbaum[Bein.wurzel]]);
    let weiteste = 0, spitze = null;
    for (let i = 0; i < wolke.count; i++) {
      if (V.hoehe[i] > V.tief + V.band) continue;
      if (!bäume.has(wolke.dom[i])) continue;
      const q = [wolke.pts[3 * i], wolke.pts[3 * i + 1], wolke.pts[3 * i + 2]];
      const d = laenge(sub(q, knöchel));
      if (d > weiteste) { weiteste = d; spitze = q; }
    }
    if (spitze) {
      const r = horizontal(sub(spitze, knöchel));
      const anteil = laenge(r) / V.spanne;
      signale.push({
        art: 'fussspitze', bein: Bein.nr, richtung: r, anteil: r3(anteil),
        zählt: anteil >= params.fussSpitzeMin,
      });
    }
    if (Bein.knie) {
      const hüfte = kn.entries[Bein.wurzel].welt;
      const w = kn.entries[Bein.knie.b].welt;
      const mitte = mul(add(hüfte, knöchel), 0.5);
      const r = horizontal(sub(w, mitte));
      const anteil = laenge(r) / V.spanne;
      signale.push({
        art: 'knie', bein: Bein.nr, richtung: r, anteil: r3(anteil),
        zählt: anteil >= params.knieAusschlagMin,
      });
    }
  }
  if (kopf !== null) {
    const sum = nul3();
    let cnt = 0;
    for (let i = 0; i < wolke.count; i++) {
      if (V.hoehe[i] < V.hoch - V.band || wolke.dom[i] !== kopf) continue;
      sum[0] += wolke.pts[3 * i]; sum[1] += wolke.pts[3 * i + 1]; sum[2] += wolke.pts[3 * i + 2];
      cnt++;
    }
    if (cnt >= Math.max(2, V.kopfAnzahl * params.kopfMinAnteil)) {
      const mittig = mul(sum, 1 / cnt);
      const r = horizontal(sub(mittig, kn.entries[kopf].welt));
      const anteil = laenge(r) / V.spanne;
      signale.push({
        art: 'kopf', seite: '-', richtung: r, anteil: r3(anteil),
        zählt: anteil >= params.kopfVorneMin,
      });
    }
  }

  const nutzbar = signale.filter((s) => s.zählt && laenge(s.richtung) > 1e-9);
  let vor = null, einig = false, streuung = null;
  if (nutzbar.length) {
    let auf = nul3();
    for (const s of nutzbar) auf = add(auf, norm(s.richtung));
    const kandidat = norm(auf);
    if (laenge(kandidat) < 1e-6) {
      // Genau gegenläufig: die Signale löschen einander statt eine Richtung zu
      // ergeben. Das ist keine Entscheidung, sondern ihre Abwesenheit — ohne
      // diese Prüfung würde der Nullvektor als Richtung gemeldet und alle
      // Seitenzuordnungen fielen auf dieselbe Seite.
      streuung = 180;
    } else {
      const abweichungen = nutzbar.map((s) => winkel(s.richtung, kandidat));
      streuung = r3(Math.max(...abweichungen));
      einig = Math.max(...abweichungen) <= params.richtungEinigGrad;
      if (einig) vor = kandidat;
    }
  }
  return { vor, einig, signale, nutzbar: nutzbar.length, streuung };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Konfidenz
// ─────────────────────────────────────────────────────────────────────────────

/** Konfidenz = Produkt der Merkmale; jedes mit seiner Messung im Bericht. */
function konfidenz(global, faktoren) {
  let k = global;
  for (const f of faktoren) k *= f.wert;
  return { confidence: r3(klemm01(k)), evidence: faktoren };
}
const faktor = (name, wert, messung) => ({ name, wert: klemm01(wert), messung });
/** Abstand gegen den nächstbesten Kandidaten derselben Frage. */
const eindeutig = (bester, zweite) => faktor('eindeutig',
  !zweite || !zweite.length ? 1 : 0.35 + 0.65 * (1 - (zweite[0].wert ?? 0) / Math.max(1e-9, bester)),
  !zweite || !zweite.length
    ? 'kein zweiter Kandidat für diese Rolle'
    : `bester Kandidat ${r3(bester)}, nächster ${r3(zweite[0].wert ?? 0)} (${zweite[0].bone})`);
/** Anzahl unabhängiger Signale, dieselbe Stelle zu benennen. */
const bestätigt = (anzahl) => faktor('bestaetigt',
  anzahl >= 3 ? 1 : anzahl === 2 ? 0.92 : anzahl === 1 ? 0.72 : 0.2,
  `${anzahl} unabhängige Signale bestätigen dieselbe Zuordnung`);

// ─────────────────────────────────────────────────────────────────────────────
// 6b. Bekannte Namenskonventionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rollen, die ein Mixamo-Rig ueber seine Knochennamen selbst benennt.
 *
 * Warum das hier steht: Die Konfidenzrechnung schaetzt aus Geometrie — Laenge,
 * Lage, Symmetrie, Zahl der bestaetigenden Signale. Das ist richtig fuer ein
 * unbekanntes Rig. Bei einem Rig, das seine Knochen `mixamorigLeftLeg` nennt,
 * ist es Unfug: dort steht die Antwort im Namen, und die Schaetzung kam
 * trotzdem auf 0,54 fuer den Unterschenkel und 0,72 fuer die Schulter. Die
 * Seite fragte den Menschen daraufhin achtzehn Mal nach einem Modell, das sie
 * selbst mitliefert — und ein Agent, der diese Meldung las, hielt die
 * Zuordnungen fuer eine Vorbedingung und begann sie zu bestaetigen, statt zu
 * animieren.
 *
 * Trifft die Konvention, ist die Zuordnung gemessen und nicht geraten: der
 * Name IST der Beleg. Konfidenz 1, keine Rueckfrage.
 */
const MIXAMO_ROLLEN = {
  pelvis: 'Hips',
  spine: 'Spine',
  chest: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  shoulder_l: 'LeftShoulder', shoulder_r: 'RightShoulder',
  arm_l: 'LeftArm', arm_r: 'RightArm',
  forearm_l: 'LeftForeArm', forearm_r: 'RightForeArm',
  hand_l: 'LeftHand', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', thigh_r: 'RightUpLeg',
  shin_l: 'LeftLeg', shin_r: 'RightLeg',
  foot_l: 'LeftFoot', foot_r: 'RightFoot',
  toe_l: 'LeftToeBase', toe_r: 'RightToeBase',
};

/** Wie viele Rollen mindestens per Name treffen muessen, damit die Konvention
 *  als erkannt gilt. Bei weniger ist es ein Rig, das nur zufaellig aehnlich
 *  heisst — dann bleibt es bei der Geometrie. */
export const KONVENTION_MIN_TREFFER = 12;

/**
 * Sucht eine bekannte Namenskonvention und liefert die Zuordnung daraus.
 *
 * @param {string[]} knochenNamen  alle Knochennamen des Rigs
 * @returns {{name: string, rollen: Record<string,string>}|null}
 */
export function erkenneKonvention(knochenNamen) {
  const nachKlein = new Map();
  for (const n of knochenNamen) nachKlein.set(String(n).toLowerCase(), n);

  const rollen = {};
  for (const [rolle, endung] of Object.entries(MIXAMO_ROLLEN)) {
    // Mixamo schreibt je nach Exporter "mixamorigHips" oder "mixamorig:Hips".
    for (const praefix of ['mixamorig', 'mixamorig:']) {
      const treffer = nachKlein.get((praefix + endung).toLowerCase());
      if (treffer) { rollen[rolle] = treffer; break; }
    }
  }
  const n = Object.keys(rollen).length;
  if (n < KONVENTION_MIN_TREFFER) return null;
  return { name: 'Mixamo', rollen, treffer: n };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Hauptweg
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rig-Erkennung auf einem geladenen Modell.
 * @param {{scene: object}} gltf Ergebnis von loadGLB
 * @param {{file?: string, params?: object}} [opts]
 * @returns {object} Bericht nach docs/plan.md 5.1: world, bones, roles,
 *                   unknown, questions, evidence, params, warnings
 * @throws {RigAbweisung}
 */
export function detectRig(gltf, opts = {}) {
  const params = Object.assign({}, PARAMS, opts.params || {});
  const kn = sammleKnochen(gltf);
  const wolke = punktwolke(kn);
  const warnings = [];
  const fragen = [];

  if (kn.namenOhne > 0 || kn.namenDoppelt > 0) {
    warnings.push(`${kn.namenOhne} Knochen ohne Namen, ${kn.namenDoppelt} doppelte Namen: ids tragen einen Indexzusatz („name#0“) — Namen waren nie Zuordnungskriterium`);
  }
  if (wolke.ohneOwner > 0) {
    warnings.push(`${wolke.ohneOwner} von ${wolke.count} Vertices ohne dominanten Knochen (alle vier Gewichte unter 0,5)`);
  }
  if (wolke.meshesOhneGewicht > 0) {
    warnings.push(`${wolke.meshesOhneGewicht} von ${kn.meshes.length} Meshes ohne skinIndex/skinWeight: ihre Vertices zählen für Höhe und Boden, nicht für die Knochenzugehörigkeit`);
  }

  // ── Aufwärtsachse
  const { beste, alle } = achseFinden(kn, wolke, params);
  if (!beste || beste.wert < params.achsenwertMin) {
    throw achsenAbweisung(beste, alle, kn, params);
  }
  // Gegenhypothese zur Achsenwahl: die stärkste Richtung, die deutlich anders
  // ist als die gewonnene. Nahezu parallele Kandidaten (Weltachse und
  // Haupttragheit) sind dieselbe Achse, ein zweites Mal gemessen — ihr Abstand
  // skaliert die Konkurrenz, bis 90° voll. Siehe PARAMS.achsVerschiedenGrad.
  let zweit = null;
  let streit = 0;
  for (const b of alle) {
    if (b === beste) continue;
    const konkurrenz = stufe(winkel(b.u, beste.u), params.achsVerschiedenGrad, 90)
      * klemm01(b.wert / Math.max(1e-9, beste.wert));
    if (konkurrenz > streit) { streit = konkurrenz; zweit = b; }
  }
  const V = beste.V, u = beste.u;
  if (beste.wert < params.achsenwertRückfrage) {
    warnings.push(`Achsenwahl rückfragewürdig: Wert ${r3(beste.wert)} unter ${params.achsenwertRückfrage}, zweitbeste Richtung ${r3(zweit ? zweit.wert : 0)}`);
  }
  // Alles hängt an dieser Wahl: Güte der Achse skaliert jede Konfidenz, und
  // eine ebenbürtige Richtung in anderem Winkel stellt sie infrage.
  const globalFaktor = klemm01(beste.wert / 0.85) * (1 - 0.55 * klemm01(streit));

  // ── Stand: zwei Ketten auf eigener Fußfläche. Die Prüfung hat die
  //    Achsenwahl schon getroffen (bewerte verwirft jede andere); hier wird
  //    sie nur noch in Zahlen gefasst weitergereicht.
  const becken = beste.becken;
  const stand = beste.stand;

  // Seitenachse: von der einen Fußfläche zur anderen
  const fussAbstandM = laenge([stand[0].a - stand[1].a, stand[0].b - stand[1].b, 0]);
  const seit = norm(add(
    mul(V.e1, stand[0].a - stand[1].a),
    mul(V.e2, stand[0].b - stand[1].b)));
  if (!laenge(seit)) {
    throw new RigAbweisung(
      `Erkennung abgelehnt: die beiden Fußflächen liegen deckungsgleich übereinander (Abstand ${r5(fussAbstandM)} m bei ${r4(V.spanne)} m Körperhöhe) — keine seitliche Achse messbar`,
      'keine-seitenachse', { abstand: r5(fussAbstandM), hoehe: r4(V.spanne) });
  }

  // ── Beine im Einzelnen
  let beine = stand.map((f) => {
    const baum = [f.wurzel, ...kn.teilbaum[f.wurzel]];
    const fuss = fussgelenk(kn, V, f.wurzel, baum, params);
    if (!fuss) return { wurzel: f.wurzel, nr: f.nr, fuss: null, fleck: f };
    const kette = pfad(kn, f.wurzel, fuss.b);
    const knie = mittelgelenk(kn, V, f.wurzel, fuss.b, params);
    return { wurzel: f.wurzel, nr: f.nr, fuss, kette, knie, fleck: f };
  });
  if (beine.some((b) => !b.fuss)) {
    const fehlend = beine.filter((b) => !b.fuss).length;
    throw new RigAbweisung(
      `Erkennung abgelehnt: ${fehlend} von ${beine.length} Bodenknochen ohne Fußgelenk — kein Gelenk in Fußreichweite (unter ${r5(V.fussGrenze)} auf der Aufwärtsachse) gefunden`,
      'kein-fussgelenk', { fehlend, beine: beine.length });
  }

  // ── Rumpf und Kopf
  let kopf = V.kopfKnochen >= 0 ? V.kopfKnochen : null;
  let rumpfBisKopf = kopf === null ? [] : pfad(kn, becken.i, kopf);
  if (rumpfBisKopf.length < 2) {
    // Der Kopfknochen hängt nicht am Becken: höchster Punkt der Aufwärtskette
    let höchstes = null;
    for (const c of becken.aufwaerts) {
      for (const j of [c, ...kn.teilbaum[c]]) {
        if (höchstes === null || V.gelenkHoehe[j] > V.gelenkHoehe[höchstes]) höchstes = j;
      }
    }
    kopf = höchstes;
    rumpfBisKopf = pfad(kn, becken.i, kopf);
  }
  rumpfBisKopf = rumpfBisKopf.filter((b) => b !== becken.i);
  const kopfAusDomianz = V.kopfKnochen >= 0 && rumpfBisKopf.includes(V.kopfKnochen);

  // ── Arme: Seitenzweige des Rumpfes ohne Bodenkontakt, als Spiegelbildpaar
  const amRumpf = new Set(rumpfBisKopf);
  /** Abstand eines Punkts von der Aufwärtsachse durch das Becken — seitliche
   *  Reichweite im Sinne von „wie weit vom Körperweg entfernt“. */
  const seitlicheReichweite = (position) => {
    const w = sub(position, kn.entries[becken.i].welt);
    return laenge(sub(w, mul(u, punkt(w, u))));
  };
  const zweige = [];
  for (const b of [becken.i, ...rumpfBisKopf]) {
    for (const k of kn.entries[b].kinder) {
      if (amRumpf.has(k) || V.erreichtBoden[k]) continue;
      const kette = tiefsteKette(kn, k);
      let seitMax = 0;
      for (const x of [k, ...kn.teilbaum[k]]) {
        seitMax = Math.max(seitMax, seitlicheReichweite(kn.entries[x].welt));
      }
      zweige.push({ wurzel: k, befestigung: b, kette, seitMax });
    }
  }
  const seitenZeiger = (z) => {
    // Vom Becken aus nach außen: die Kette kann aus einem einzigen Knochen
    // bestehen — ihre eigene Richtung wäre dann nicht messbar.
    let weitester = nul3(), weite = -Infinity;
    for (const x of [z.wurzel, ...kn.teilbaum[z.wurzel]]) {
      const w = sub(kn.entries[x].welt, kn.entries[becken.i].welt);
      const q = sub(w, mul(u, punkt(w, u)));
      if (laenge(q) > weite) { weite = laenge(q); weitester = q; }
    }
    return norm(weitester);
  };
  const paare = [];
  for (let i = 0; i < zweige.length; i++) {
    for (let j = i + 1; j < zweige.length; j++) {
      const a = zweige[i], b = zweige[j];
      const ha = V.gelenkHoehe[a.befestigung], hb = V.gelenkHoehe[b.befestigung];
      if (Math.abs(ha - hb) / V.spanne > params.paarHöheToleranz) continue;
      if (punkt(seitenZeiger(a), seitenZeiger(b)) > -0.7) continue;
      const Verhältnis = Math.min(a.seitMax, b.seitMax) / Math.max(1e-9, Math.max(a.seitMax, b.seitMax));
      if (Verhältnis < params.paarWeiteVerhältnis) continue;
      paare.push({ a, b, weite: a.seitMax + b.seitMax, hoehe: (ha + hb) / 2 });
    }
  }
  paare.sort((x, y) => y.weite - x.weite || y.hoehe - x.hoehe);
  const armPaar = paare[0] || null;
  const armAlternative = paare.slice(1).map((x) => r3(x.weite / paare[0].weite));

  // ── Blickrichtung, dann Seiten
  const richtung = blickRichtung(kn, V, wolke, u, seit, beine, kopf, params);
  const vor = richtung.vor;
  const seitenUnsicher = vor === null;
  const links = seitenUnsicher ? null : norm(kreuz(u, vor));

  const seiteVon = (position) => {
    const w = sub(position, kn.entries[becken.i].welt);
    const s = links === null ? punkt(w, seit) : punkt(w, links);
    return s >= 0 ? 'l' : 'r';
  };
  for (const Bein of beine) Bein.seite = seiteVon(kn.entries[Bein.fuss.b].welt);
  if (new Set(beine.map((b) => b.seite)).size !== 2) {
    warnings.push(`beide Beine auf derselben Seite (${beine.map((b) => b.seite).join('/')}) — Zuordnung der Seiten ist nicht entscheidbar`);
  }

  // ── Rollen sammeln
  // Konfidenzordnung plan.md 5.1, drei Zonen:
  //   ab sicherAb            Rolle fest.
  //   fragenAb … sicherAb    Rolle mit Marke `confirm: true` — „unsicher,
  //                          Rückfrage nötig“, Vorschlag in `vorschlag`, Frage
  //                          in `questions`.
  //   unter fragenAb         KEINE Rolle im Feld `roles` — der Kandidat steht
  //                          mit seiner gemessenen Konfidenz in
  //                          `abgelehnteZuordnungen`, damit der Befund mit
  //                          Zahl sichtbar bleibt statt in einer Warnung zu
  //                          verschwinden.
  /** @type {Record<string, {bone: string, confidence: number, note?: string}>} */
  const roles = {};
  const evidence = {};
  const belegt = new Set();
  const seitenFaktor = seitenUnsicher ? params.seitenFaktorUnsicher : 1;
  /** Zuordnungen unter der Frageschwelle: beste Kandidat, nie eine Rolle. */
  const abgelehnteZuordnungen = [];

  // Trifft eine bekannte Namenskonvention, steht die Antwort im Namen: die
  // geometrische Schaetzung wird dann nicht befragt. Sonst schaetzt sie auf
  // einem Mixamo-Rig 0,54 fuer den Unterschenkel, und die Seite fragt den
  // Menschen nach einem Modell, das sie selbst mitbringt.
  const konvention = erkenneKonvention(kn.entries.map((e) => e.id));
  if (konvention) {
    warnings.push(`Namenskonvention ${konvention.name} erkannt: `
      + `${konvention.treffer} Rollen kommen aus den Knochennamen, nicht aus der Schätzung`);
  }

  function setzen(rolle, knochen, faktoren, note) {
    // Seitenrollen nur, wenn die Blickrichtung feststeht: der Name sagt
    // „Left" im Bezugssystem des Rigs, nicht im Raum. Steht nicht fest, wo
    // vorne ist, laesst sich das eine nicht auf das andere abbilden — dann
    // gilt weiter die Messung, samt Rueckfrage.
    const seitenrolle = /_(l|r)$/.test(rolle);
    const ausKonvention = konvention
      && !(seitenrolle && seitenUnsicher)
      && konvention.rollen[rolle];
    if (ausKonvention) {
      roles[rolle] = {
        bone: ausKonvention,
        confidence: 1,
        source: `Namenskonvention ${konvention.name}`,
      };
      evidence[rolle] = [{ name: 'namenskonvention', wert: 1,
        messung: `Knochen heißt „${ausKonvention}“ — die Konvention ${konvention.name} `
          + `benennt damit ${rolle}` }];
      belegt.add(ausKonvention);
      return;
    }
    const k = konfidenz(globalFaktor, faktoren);
    if (k.confidence < params.fragenAb) {
      warnings.push(`Rolle ${rolle} unter der Frageschwelle: Konfidenz ${k.confidence} (Grenze ${params.fragenAb}) — bleibt ohne Rolle`);
      abgelehnteZuordnungen.push({
        rolle,
        bone: kn.entries[knochen].id,
        confidence: k.confidence,
        grenze: params.fragenAb,
        grund: `Konfidenz ${k.confidence} unter der Frageschwelle ${params.fragenAb} — geraten wird nie`,
      });
      return;
    }
    const eintrag = { bone: kn.entries[knochen].id, confidence: k.confidence };
    if (k.confidence < params.sicherAb) {
      // Unsicher, aber fragwürdig: der Kandidat bleibt gesetzt, damit die
      // Auskunftsschicht (describe_rig) ihn als Vorschlag anbieten kann. Der
      // Mensch entscheidet über die Frage in `questions` und confirm_role.
      eintrag.confirm = true;
      eintrag.vorschlag = `unsicher, Rückfrage nötig: bester Kandidat „${kn.entries[knochen].id}“ `
        + `mit Konfidenz ${k.confidence} (sicher ab ${params.sicherAb})`;
      if (note) eintrag.unsicherGrund = `${note} — Konfidenz ${k.confidence} liegt in der Rückfragezone ${params.fragenAb}…${params.sicherAb}`;
    }
    if (note) eintrag.note = note;
    roles[rolle] = eintrag;
    evidence[rolle] = k.evidence;
    belegt.add(knochen);
  }

  // Becken
  const alternativeBecken = V.kandidaten
    .filter((c) => c.i !== becken.i && c.beine.length >= 2)
    .map((c) => ({ bone: kn.entries[c.i].id, wert: Math.abs(c.anteil - 0.5) }));
  setzen('pelvis', becken.i, [
    bestätigt(1 + (kopfAusDomianz ? 1 : 0) + (armeVorhanden() ? 1 : 0)),
    eindeutig(1, alternativeBecken),
    faktor('bodenkontakt', 1, `2 von 2 Fußflächen an diesem Knochen: ${beine.map((b) => kn.entries[b.fuss.b].id).join(', ')}`),
  ], alternativeBecken.length ? `${alternativeBecken.length} weitere Kandidaten mit 2 Bodenknochen` : undefined);
  function armeVorhanden() { return armPaar !== null; }

  // Beine
  for (const Bein of beine) {
    const s = Bein.seite;
    const fuss = Bein.fuss.b;
    setzen(`foot_${s}`, fuss, [
      bestätigt(Bein.fuss.ohneGelenk ? 2 : (Bein.fuss.sicher ? 2 : 1) + 1),
      Bein.fuss.ohneGelenk
        ? faktor('fussflaeche', 0.8, `kein Sprunggelenk im Skelett: die Kette „${kn.entries[Bein.wurzel].id}“ trägt `
          + `${Bein.fuss.besitz} Bodenvertices unterhalb ihres tiefsten Gelenks auf ${r4(Bein.fuss.hoehe)} — `
          + `Rolle sitzt auf dem einzigen Knochen, der dafür in Frage kommt`)
        : faktor('fussknick', Bein.fuss.sicher ? 1 : 0.62,
          `Knick ${Bein.fuss.knick}° an „${kn.entries[fuss].id}“, Grenze ${params.fussKnicksMinGrad}°`),
      eindeutig(1, Bein.fuss.alternative.length
        ? [{ bone: Bein.fuss.alternative[0], wert: 0.55 }] : null),
      seitenFaktor === 1 ? faktor('seite', 1, 'Seite aus Blickrichtung bestimmt')
        : faktor('seite', seitenFaktor, 'Blickrichtung nicht entscheidbar, Seite nur vorläufig'),
    ], Bein.fuss.ohneGelenk
      ? 'ohne eigenes Sprunggelenk: Rolle auf dem Endknochen der Beinkette'
      : (Bein.fuss.alternative.length ? `weitere Kandidaten: ${Bein.fuss.alternative.join(', ')}` : undefined));

    setzen(`thigh_${s}`, Bein.wurzel, [
      bestätigt(2),
      faktor('huefte', 1, `Kette beginnt am Becken „${kn.entries[becken.i].id}“, ${r4(Bein.kette.length ? laenge(sub(kn.entries[Bein.wurzel].welt, kn.entries[becken.i].welt)) : 0)} m unterhalb`),
      seitenFaktor === 1 ? faktor('seite', 1, 'Seite aus Blickrichtung bestimmt')
        : faktor('seite', seitenFaktor, 'Blickrichtung nicht entscheidbar, Seite nur vorläufig'),
    ]);

    if (Bein.knie) {
      setzen(`shin_${s}`, Bein.knie.b, [
        bestätigt(Bein.knie.quelle === 'beugung' ? 2 : 1),
        faktor('kniequelle', Bein.knie.quelle === 'beugung' ? 1 : 0.75,
          `Knie über ${Bein.knie.quelle} gewählt: Knick ${Bein.knie.knick}°, Weganteil ${Bein.knie.wegAnteil}, ${Bein.knie.gelenke} Zwischengelenke`),
        faktor('gleichwertige', Bein.knie.gleichwertige === 0 ? 1 : 0.7,
          `${Bein.knie.gleichwertige} gleichwertige Gelenkkandidaten`),
        seitenFaktor === 1 ? faktor('seite', 1, 'Seite aus Blickrichtung bestimmt')
          : faktor('seite', seitenFaktor, 'Blickrichtung nicht entscheidbar, Seite nur vorläufig'),
      ], Bein.knie.gleichwertige
        ? `${Bein.knie.gleichwertige} weitere Gelenke gleichermaßen möglich (${Bein.knie.rangfolge.join(', ')})`
        : undefined);
    } else {
      warnings.push(`Bein „${kn.entries[Bein.wurzel].id}“: kein Gelenk zwischen Hüfte und Knöchel (${Bein.kette.length} Knochen in der Kette) — shin_${s} bleibt ohne Rolle`);
    }

    const zehen = kn.entries[Bein.fuss.b].kinder
      .filter((k) => V.gelenkHoehe[k] <= V.fussGrenze);
    if (zehen.length) {
      const zehe = zehen.reduce((a, c) =>
        (kn.teilbaum[c].length > kn.teilbaum[a].length ? c : a), zehen[0]);
      setzen(`toe_${s}`, zehe, [
        bestätigt(1),
        faktor('zehenrichtung', 1, `Kinderkette des Fußes, ${r5(V.gelenkHoehe[zehe] - V.tief)} m über Boden`),
        seitenFaktor === 1 ? faktor('seite', 1, 'Seite aus Blickrichtung bestimmt')
          : faktor('seite', seitenFaktor, 'Blickrichtung nicht entscheidbar, Seite nur vorläufig'),
      ]);
    }
  }

  // Rumpf
  const brust = armPaar
    ? tiefsterGemeinsamerAhne(kn, armPaar.a.befestigung, armPaar.b.befestigung)
    : null;
  if (kopf !== null) {
    setzen('head', kopf, [
      bestätigt(kopfAusDomianz ? 2 : 1),
      faktor('kopflage', 1, `dominiert ${V.kopfBesitz.get(kopf) || 0} von ${V.kopfAnzahl} Vertices im Kopfbereich (Band ${r5(V.band)} m)`),
      eindeutig(1, null),
    ], kopfAusDomianz ? undefined : `kein Knochen im Kopfbereich dominierend; höchster Punkt der Aufwärtskette genommen (${V.kopfAnzahl} Kopfbereichs-Vertices)`);
  }
  // Nacken: das Glied direkt unter dem Kopf — aber nur, wenn zwischen Becken
  // und Kopf mindestens drei Glieder liegen. Sonst ist das untere Glied Rumpf
  // (oder Brust) und kein Hals, und neck bleibt ohne Rolle.
  const halsKandidat = rumpfBisKopf.length >= 3 && kopf !== null ? kn.entries[kopf].parent : null;
  const halsKnochen = halsKandidat !== null && halsKandidat !== brust
    && rumpfBisKopf.includes(halsKandidat) ? halsKandidat : null;
  if (halsKnochen !== null) {
    setzen('neck', halsKnochen, [
      bestätigt(1),
      faktor('halslage', 1, `direkt unter dem Kopfknochen, ${rumpfBisKopf.length} Glieder über dem Becken`),
      eindeutig(1, null),
    ]);
  } else if (kopf !== null) {
    warnings.push(`kein eigener Nackenknochen: ${rumpfBisKopf.length} Glieder zwischen Becken und Kopf — neck bleibt ohne Rolle`);
  }
  if (brust !== null && brust !== becken.i) {
    setzen('chest', brust, [
      bestätigt(2),
      faktor('schulterachse', 1, `tiefster gemeinsamer Ahne beider Armketten („${kn.entries[armPaar.a.wurzel].id}“, „${kn.entries[armPaar.b.wurzel].id}“)`),
      eindeutig(1, armAlternative.length ? [{ bone: 'zweitbestes Arm paar', wert: armAlternative[0] }] : null),
    ], armAlternative.length ? `weitere Seitenpaare in Reichweite: ${armAlternative.join(', ')}` : undefined);
  }
  const rumpfAnfang = rumpfBisKopf.length ? rumpfBisKopf[0] : null;
  if (rumpfAnfang !== null && rumpfAnfang !== brust && rumpfAnfang !== kopf) {
    setzen('spine', rumpfAnfang, [
      bestätigt(1),
      faktor('rumpflage', 1, `erstes Glied über dem Becken, ${rumpfBisKopf.length} Glieder bis zum Kopf`),
      eindeutig(1, null),
    ], rumpfBisKopf.length > 3 ? `dazwischen ${rumpfBisKopf.length - 3} Wirbel ohne eigene Rolle` : undefined);
  } else if (rumpfAnfang !== null) {
    warnings.push(`Rumpf hat nur ${rumpfBisKopf.length} Glieder zwischen Becken und Kopf — spine bleibt ohne Rolle`);
  }

  // Arme
  if (armPaar) {
    // Seiten nicht nach Reihenfolge, sondern nach Lage: ein Arm, der nicht
    // gegen den anderen gespiegelt ist, bekommt keine Seite.
    for (const z of [armPaar.a, armPaar.b]) {
      const kette = z.kette;
      const s = seiteVon(kn.entries[z.wurzel].welt);
      const gegenSeiten = armPaar.a === z ? armPaar.b : armPaar.a;
      const sAnderer = seiteVon(kn.entries[gegenSeiten.wurzel].welt);
      if (s === sAnderer) {
        warnings.push(`beide Arme auf derselben Seite (${s}) — Armrollen bleiben ohne Zuordnung`);
        break;
      }
      // Eine Kette aus genau einem Knochen hat weder Ellenbogen noch
      // Handgelenk: nur der Arm selbst ist messbar. Die anderen Rollen werden
      // nicht auf denselben Knochen geschoben, sondern bleiben ohne Rolle.
      if (kette.length < 2) {
        setzen(`arm_${s}`, kette[0], [
          bestätigt(2),
          faktor('schultergelenk', 1, `einknochige Seitenkette an „${kn.entries[z.befestigung].id}“, `
            + `${r4(laenge(sub(kn.entries[kette[0]].welt, kn.entries[z.befestigung].welt)))} m von der Körperachse`),
          seitenfaktor(s),
        ], 'kein Ellenbogen und kein Handgelenk in diesem Skelett: forearm und hand bleiben ohne Rolle');
        continue;
      }
      const hg = handgelenk(kn, kette, params);
      const handIdx = kette.indexOf(hg.b);
      if (handIdx < 0) continue;
      // Schlüsselbein: kurzes, körpernahes erstes Segment einer langen Kette
      let anfang = 0;
      const seitlich = (b) => seitlicheReichweite(kn.entries[b].welt);
      const len = (i) => i + 1 < kette.length ? laenge(sub(kn.entries[kette[i + 1]].welt, kn.entries[kette[i]].welt)) : 0;
      if (handIdx >= 3 && len(0) <= params.schulterLängenverhältnis * len(1)
        && seitlich(kette[0]) <= params.schulterSeitenverhältnis * seitlich(kette[1])) {
        setzen(`shoulder_${s}`, kette[0], [
          bestätigt(1),
          faktor('schluesselbein', 1, `erstes Kettenglied ${r4(len(0))} m lang, folgt ${r4(len(1))} m; Seitenabstand ${r4(seitlich(kette[0]))} gegen ${r4(seitlich(kette[1]))} m`),
          seitenfaktor(s),
        ]);
        anfang = 1;
      }
      const ell = mittelgelenk(kn, V, kette[anfang], hg.b, params);
      setzen(`hand_${s}`, hg.b, [
        bestätigt(hg.wegen === 'fingerzweige' ? 2 : 1),
        faktor('handgelenk', hg.wegen === 'fingerzweige' ? 1 : 0.8,
          `Handgelenk über ${hg.wegen}${hg.zweige ? ` (${hg.zweige} kurze Kinderketten)` : ''}, ${handIdx + 1} von ${kette.length} Gliedern der Kette`),
        seitenfaktor(s),
      ], hg.wegen === 'kettenende' ? 'kein Fingerzweig erkannt: Ende der Kette angenommen' : undefined);
      setzen(`arm_${s}`, kette[anfang], [
        bestätigt(2),
        faktor('schultergelenk', 1, `Kette zweigt an „${kn.entries[z.befestigung].id}“ ab, ${r4(laenge(sub(kn.entries[kette[anfang]].welt, kn.entries[z.befestigung].welt)))} m seitlich`),
        seitenfaktor(s),
      ]);
      if (ell) {
        setzen(`forearm_${s}`, ell.b, [
          bestätigt(ell.quelle === 'beugung' ? 2 : 1),
          faktor('ellbogen', ell.quelle === 'beugung' ? 1 : 0.75,
            `Ellbogen über ${ell.quelle}: Knick ${ell.knick}°, Weganteil ${ell.wegAnteil}, ${ell.gelenke} Zwischengelenke`),
          seitenfaktor(s),
        ], ell.gleichwertige ? `${ell.gleichwertige} gleichwertige Gelenkkandidaten` : undefined);
      } else {
        warnings.push(`Arm „${kn.entries[kette[anfang]].id}“: kein Gelenk zwischen Schulter und Hand (${kette.length} Glieder) — forearm_${s} bleibt ohne Rolle`);
      }
    }
  } else {
    warnings.push(`kein Seitenpaar ohne Bodenkontakt gefunden (${zweige.length} Seitenzweige geprüft) — Armrollen bleiben ohne Zuordnung`);
  }
  function seitenfaktor(s) {
    return seitenUnsicher
      ? faktor('seite', seitenFaktor, 'Blickrichtung nicht entscheidbar, Seite nur vorläufig')
      : faktor('seite', 1, 'Seite aus Blickrichtung bestimmt');
  }

  // ── Pflichtrollen
  for (const rolle of PFLICHTROLLEN) {
    if (!roles[rolle]) {
      throw new RigAbweisung(
        `Erkennung abgelehnt: Pflichtrolle ${rolle} nicht vergeben (${Object.keys(roles).length} von ${ROLLEN.length} Rollen gesetzt, ${kn.entries.length} Knochen, ${wolke.count} Vertices gemessen) — Modell wird abgelehnt statt geraten`,
        'pflichtrolle-fehlt', { vergebeneRollen: Object.keys(roles).length });
    }
  }

  // ── Unbekannte Ketten: ohne Rolle, aber weiter nutzbar (plan.md 5.1)
  const unknown = [];
  const rollenId = new Map();
  for (const [r, v] of Object.entries(roles)) rollenId.set(v.bone, r);
  for (const e of kn.entries) {
    if (rollenId.has(e.id)) continue;
    unknown.push({ bone: e.id, confidence: 0, grund: grundFuer(kn, e.i, roles, beine, armPaar) });
  }

  // ── Rückfragen: alles zwischen 0,5 und 0,9 geht an den Menschen
  if (seitenUnsicher) {
    const paar = beine.map((b) => kn.entries[b.fuss.b].id);
    fragen.push({
      art: 'seitenverwechslung',
      rollen: SEITENROLLEN.filter((r) => roles[r]),
      // Der Mensch sieht beide Fuesse markiert, mit 1 und 2 beschriftet. Die
      // Diagnose (wie viele Richtungssignale ueber der Grenze lagen) gehoert
      // in den Rig-Bericht, nicht in die Frage.
      frage: 'Welcher der beiden markierten Füße ist der LINKE?',
      diagnose: `Blickrichtung nicht messbar: ${richtung.nutzbar} von `
        + `${richtung.signale.length} Richtungssignalen über der Grenze, stärkstes `
        + `${r3(Math.max(0, ...richtung.signale.map((s) => s.anteil)))} der Körperhöhe`,
      optionen: [
        { text: 'Der mit der 1', zuordnung: seitenZuordnung(false) },
        { text: 'Der mit der 2', zuordnung: seitenZuordnung(true) },
      ],
    });
  }
  // Jede Rolle höchstens einmal fragen — die Pflichtrollen stehen auch in
  // `roles`, ohne Entgegenhalten würde dieselbe Frage doppelt beim Menschen
  // landen (an Kenney_Ooli gemessen: 10 Fragen statt 9).
  const zuFragen = [...new Set(PFLICHTROLLEN.concat(Object.keys(roles)))];
  for (const rolle of zuFragen) {
    const r = roles[rolle];
    if (!r || r.confidence >= params.sicherAb) continue;
    const alternativen = Object.entries(roles)
      .filter(([andere]) => andere !== rolle && /_[lr]$/.test(andere) && andere.slice(0, -1) === rolle.slice(0, -1))
      .map(([, v]) => v.bone);
    fragen.push({
      art: 'rollenbestaetigung',
      rolle,
      vorschlag: r.vorschlag,
      // Der fragliche Knochen leuchtet mit der 1, die Alternative mit der 2.
      // Gefragt wird nach dem, was der Mensch SIEHT, nicht nach dem, was im
      // Modell steht. Die Konfidenz gehoert in den Rig-Bericht, nicht hierher.
      frage: `Ist das markierte Teil ${menschlich(rolle)}?`,
      diagnose: `Knochen „${r.bone}“, Konfidenz ${r.confidence}, `
        + `sicher ab ${params.sicherAb}`,
      optionen: [
        { text: 'Ja, das stimmt', bone: r.bone, confidence: r.confidence },
        ...(alternativen.length
          ? [{ text: 'Nein, das andere markierte Teil', bone: alternativen[0], confidence: 0 }]
          : []),
      ],
    });
  }
  /** Seitenrollen vertauschen, wenn der Mensch die andere Seite wählt. */
  function seitenZuordnung(vertauscht) {
    const out = {};
    for (const rolle of SEITENROLLEN) {
      if (!roles[rolle]) continue;
      const base = rolle.replace(/_[lr]$/, '');
      const andere = rolle.slice(-1);
      const get = (seite) => roles[`${base}_${seite}`];
      if (!get('l') || !get('r')) continue;
      out[rolle] = get(vertauscht ? (andere === 'l' ? 'r' : 'l') : andere).bone;
    }
    return out;
  }

  // ── Bericht
  const bonesOut = kn.entries.map((e) => ({
    id: e.id,
    parent: e.parent === null ? null : kn.entries[e.parent].id,
    bindWorld: [r5(e.welt[0]), r5(e.welt[1]), r5(e.welt[2])],
  }));

  return {
    schemaVersion: 1,
    source: {
      file: opts.file || 'unbenannt.glb',
      boneCount: kn.entries.length,
      vertexCount: wolke.count,
      skinnedMeshCount: kn.meshes.length,
    },
    world: {
      up: achsName(u),
      forward: vor ? achsName(vor) : 'unklar',
      left: links ? achsName(links) : 'unklar',
      upVektor: u.map(r5),
      forwardVektor: vor ? vor.map(r5) : null,
      leftVektor: links ? links.map(r5) : null,
      groundY: r5(V.tief),
      height: r4(V.spanne),
      unitsPerMeter: params.unitsPerMeter,
      achsenWert: r3(beste.wert),
    },
    bones: bonesOut,
    roles,
    abgelehnteZuordnungen,
    unknown,
    questions: fragen,
    richtung: {
      entscheidbar: !seitenUnsicher,
      streuungGrad: richtung.streuung,
      signale: richtung.signale.map((s) => ({
        art: s.art, bein: s.bein, anteil: s.anteil, zählt: s.zählt,
      })),
    },
    evidence: {
      achse: beste.faktoren.map((f) => ({ ...f, wert: r3(f.wert) })),
      rollen: evidence,
    },
    params: Object.assign({}, params),
    warnings,
  };
}

/** Tiefster gemeinsamer Ahne zweier Knochen. */
function tiefsterGemeinsamerAhne(kn, a, b) {
  const ahnen = new Set();
  for (let cur = a; cur !== null && cur !== undefined; cur = kn.entries[cur].parent) ahnen.add(cur);
  for (let cur = b; cur !== null && cur !== undefined; cur = kn.entries[cur].parent) {
    if (ahnen.has(cur)) return cur;
  }
  return null;
}

/** Warum ein Knochen keine semantische Rolle bekommen hat. */
function grundFuer(kn, i, roles, beine, armPaar) {
  const inBaum = (wurzel) => i === wurzel || kn.teilbaum[wurzel].includes(i);
  const wurzelDerRolle = (rolle) => {
    for (const [r, v] of Object.entries(roles)) {
      if (r !== rolle) continue;
      const e = kn.entries.find((x) => x.id === v.bone);
      if (e) return e.i;
    }
    return null;
  };
  const hand = ['hand_l', 'hand_r'].map(wurzelDerRolle).filter((x) => x !== null);
  if (hand.some((h) => inBaum(h))) {
    return 'Fingerkette an einer erkannten Hand: ohne semantische Rolle, aber weiter nutzbar';
  }
  for (const Bein of beine) {
    if (!inBaum(Bein.wurzel)) continue;
    const rollen = ['thigh', 'shin', 'foot', 'toe'].map((b) => `${b}_${Bein.seite}`)
      .map(wurzelDerRolle).filter((x) => x !== null);
    if (rollen.some((r) => inBaum(r) && kn.entries[r].tiefe < kn.entries[i].tiefe)) {
      return 'Zwischenknochen einer Beinckette (Zwischengelenk oder Twist): keine eigene Rolle, Kette bleibt nutzbar';
    }
    return 'Abstieg eines Beingelenks ohne Bodenkontakt (Zeh, Fessel): keine eigene Rolle';
  }
  const armWurzeln = armPaar ? [armPaar.a.wurzel, armPaar.b.wurzel] : [];
  for (const w of armWurzeln) {
    if (inBaum(w)) {
      return 'Zwischen- oder Endknochen einer Armkette: keine eigene Rolle, Kette bleibt nutzbar';
    }
  }
  for (const r of ['spine', 'chest', 'neck', 'head']) {
    const rI = wurzelDerRolle(r);
    if (rI !== null && inBaum(rI) && kn.entries[rI].tiefe < kn.entries[i].tiefe) {
      return `Wirbel- oder Rumpfknochen zwischen ${r} und dem nächsten verankerten Gelenk: keine eigene Rolle`;
    }
  }
  return 'Kette ohne Bodenkontakt, ohne Seitenpaar und ohne Rumpfbezug: ohne Rolle nutzbar';
}

export default detectRig;
