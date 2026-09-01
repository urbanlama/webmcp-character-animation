// AP9 — Abnahmetest für den Bildstreifen (src/render/strip.js, docs/plan.md 6.8).
//
// Runner: node --test "src/**/*.test.mjs" — diese Datei liegt neben dem Code.
//
// Die Abnahmetabelle des Auftrags, Reihe für Reihe, je mit Positiv- und
// Negativfall (AGENTS.md, Regel 2):
//
//   Ansichten      — ein Streifen zeigt die benannten Ansichten mit Achsenkreuz,
//                    Bodengitter mit Maßstab, Schwerpunkt, Stützfläche und
//                    Kontaktpunkten. Negativ: ein Streifen ohne Annotationen wird
//                    nicht ausgeliefert.
//   Aussagekraft   — zwei deutlich verschiedene Posen ergeben deutlich verschiedene
//                    Streifen; eine um 2 mm verschobene Pose ergibt KEINEN sichtbar
//                    anderen Streifen. Gemessen wird der Pixelunterschied, in BEIDE
//                    Richtungen scharf.
//   Anhang         — jeder Validierungsbericht trägt seinen Streifen; ein Bericht
//                    ohne Streifen gilt als unvollständig.
//
// Zwei Ebenen, weil nur eine Pixel braucht (so wie strip.js selbst):
//   NODE    — planeStreifen(), pruefeVollstaendigkeit(), createStripRenderer() und
//             alle Eingabeprüfungen laufen ohne Browser durch.
//   BROWSER — Pixel entstehen nur dort (Canvas 2D, WebGL). Der Weg ist derselbe,
//             den tools/browser-test.mjs schon geht: echter Datei-Server, echtes
//             Chromium, Module über document.baseURI. Kein zweiter Aufbau.
//
// Körpermaße (AGENTS.md, Regel 1): dieses Profil wird an Xbot.glb gemessen
// (src/rig/measure.js), keine Höhe, kein Radius und keine Sohle wird getippt. Die
// einzigen Zahlen hier sind Verfahrensgrenzen (Pixelunterschied, Toleranzen) und
// nennen ihren Bezug.

import { test, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import * as strip from './strip.js';
import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { validateValidationReport } from '../contracts/validation-report.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE VERFAHRENSGRENZEN DIESES TESTS (Verfahren, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Ein Pixel gilt im Vergleich zweier Streifen als „sichtbar anders“, wenn der
 *  größte Kanalabstand über dieser Schwelle liegt: 16 von 255 ≈ 6 %. Darüber
 *  liegt jede Kantenverschiebung, die im Bild als andere Linie zu erkennen ist;
 *  darunter das Antialiasing einer um Bruchteile eines Pixels verschobenen Linie. */
const SICHTBAR_SCHWELLE = 16;

/** Obergrenze für den sichtbar anderen Pixelanteil einer um 2 mm verschobenen
 *  Pose. Bezug: 2 mm sind bei dem an Xbot gemessenen Maßstab (168 px/m) 0,34 px —
 *  unter einem Pixel. Nachgemessen im Browser: 0,006 der Bildpunkte ändern sich
 *  sichtbar (3 000 von 492 960), weil entlang der dünnen Striche Antialiasing
 *  mitwandert. 0,02 lässt dafür den vierfachen Raum, ohne die andere Richtung zu
 *  verwässern: eine echte Poseänderung liegt bei 0,167. */
const GRENZ_KLEIN_ANTEIL = 0.02;

/** Untergrenze für den sichtbar anderen Pixelanteil zweier deutlich
 *  verschiedener Posen. Nachgemessen: 0,167 (Kapseln) und 0,147 (Mesh) — die
 *  Gliedmaßen wandern hier um ≥ 20 cm = ≥ 34 px. */
const GRENZ_GROSS_ANTEIL = 0.10;

// ─────────────────────────────────────────────────────────────────────────────
// Messbare Testgrundlage — das Profil kommt aus dem Modell
// ─────────────────────────────────────────────────────────────────────────────

let profilEinmal = null;

/** Vermessenes RigProfile von Xbot.glb; eine Messung für alle Tests (teuer,
 *  unveränderlich). Wer es verändert, bekommt eine Kopie. */
async function gemessenesProfil() {
  if (!profilEinmal) {
    const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
    profilEinmal = measureRigProfile(gltf, { fileName: 'Xbot.glb' });
  }
  return structuredClone(profilEinmal);
}

/** Frisch geladenes Skelett, damit Pose-Änderungen kein anderes Modell treffen. */
async function frischesSkelett() {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  gltf.scene.updateMatrixWorld(true);
  const gelenke = new Map();
  gltf.scene.traverse((o) => { if (o.isBone) gelenke.set(o.name, o); });
  return { scene: gltf.scene, gelenke };
}

/**
 * Liest eine gestellte Pose als Frame aus — über strip.frameAusScene(), also aus
 * derselben Quelle, die auch das Mesh stellt. Verschiebungen werden auf
 * `positions` UND `bones` gleichmäßig angewendet, sonst beschreiben die zwei
 * Angaben desselben Frames zwei verschiedene Posen (strip.js prüft das).
 *
 * @param {Array<[string,string,number]>} drehungen [Knochen, Weltachse, Grad]
 * @param {number[]} [versatzMeter] starrer Versatz der ganzen Figur
 */
async function gerahmtePose(drehungen = [], versatzMeter = null, index = 0) {
  const { scene, gelenke } = await frischesSkelett();
  for (const [name, achse, grad] of drehungen) {
    const knochen = gelenke.get(name);
    if (!knochen) {
      throw new Error(`Pose nicht stellbar: Knochen „${name}“ fehlt im Skelett mit ${gelenke.size} Knochen`);
    }
    const richtung = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[achse];
    knochen.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(...richtung), grad * Math.PI / 180));
  }
  scene.updateMatrixWorld(true);
  const frame = strip.frameAusScene(scene, { frame: index });

  if (versatzMeter) {
    const d = versatzMeter.map(Number);
    for (const id of Object.keys(frame.positions)) {
      frame.positions[id] = frame.positions[id].map((x, a) => x + d[a]);
      frame.bones[id].position = frame.bones[id].position.map((x, a) => x + d[a]);
    }
  }
  return frame;
}

/** Die Standpose aus dem Modell — Referenz aller Pixelvergleiche. */
const stehPose = () => gerahmtePose([], null, 0);
/** Eine Pose, die jeder Betrachter sofort von der Standpose unterscheidet. */
const fremdePose = () => gerahmtePose([
  ['mixamorigLeftUpLeg', 'x', -55],
  ['mixamorigLeftForeArm', 'z', 70],
  ['mixamorigSpine', 'z', -20],
], [0, 0, 0.18], 1);
/** Dieselbe Pose, starr um 2 mm in x verschoben. */
const millimeterPose = () => gerahmtePose([], [0.002, 0, 0], 2);
/** Die Standpose, starr um [links, hoch, vorn] versetzt — der Sprungfall. */
const versetztePose = (versatz, index) => gerahmtePose([], versatz, index);

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 1 — Ansichten (Planebene: läuft in Node)
// ─────────────────────────────────────────────────────────────────────────────

test('Ansichten, Positivfall: alle vier Ansichten, jede Pflichtgruppe besetzt', async () => {
  const profile = await gemessenesProfil();
  const frames = [await stehPose(), await fremdePose()];

  const plan = strip.planeStreifen({
    profile, frames, views: strip.ANSICHTEN, frameCount: frames.length,
  });

  assert.equal(plan.panels.length, frames.length * strip.ANSICHTEN.length,
    `${frames.length} Frames × ${strip.ANSICHTEN.length} Ansichten erwartet ${frames.length * strip.ANSICHTEN.length} Panels, es sind ${plan.panels.length}`);
  assert.deepEqual(plan.views, strip.ANSICHTEN,
    `die Ansichten müssen in der angeforderten Reihenfolge stehen, waren: ${plan.views.join(', ')}`);

  // Genau eine Ansicht pro Zeile, ein Frame pro Spalte — der Streifen liegt
  // nebeneinander in EINEM Bild.
  const zeilen = new Set(plan.panels.map((p) => p.zeile));
  assert.equal(zeilen.size, strip.ANSICHTEN.length,
    `${strip.ANSICHTEN.length} Zeilen erwartet, es sind ${zeilen.size}`);
  assert.ok(plan.breite < plan.hoehe,
    `4 Ansichten × 2 Frames ergeben ein Hochformat ${plan.breite} × ${plan.hoehe} px — die Ansichten gehören nebeneinander in einer Zeile pro Ansicht`);

  // Fünf Pflichtgruppen, je Panel, mitPrimitive-Bestand.
  const bo = [];
  for (const pan of plan.panels) {
    for (const gruppe of strip.PFLICHT_ANNOTATIONEN) {
      const n = (pan.annotationen[gruppe] ?? []).length;
      if (n === 0) bo.push(`${pan.ansicht}/Frame ${pan.frame}: ${gruppe} hat 0 Primitives`);
    }
    // Bodengitter mit Maßstab: ein Raster ohne Zahl ist keiner.
    const meter = pan.annotationen.bodengitter.filter(
      (p) => p.art === 'text' && / m$/.test(p.text));
    if (meter.length === 0) bo.push(`${pan.ansicht}/Frame ${pan.frame}: 0 Meterangaben im Bodengitter`);
    // Achsenkreuz: drei Achsen, je beschriftet.
    const achsen = pan.annotationen.achsenkreuz.filter((p) => p.art === 'text' && /^(x|y|z) /.test(p.text));
    if (achsen.length !== 3) bo.push(`${pan.ansicht}/Frame ${pan.frame}: ${achsen.length} statt 3 beschriftete Achsen`);
    // Schwerpunkt: Marker plus Höhenangabe in Metern und in Körperhöhenanteil.
    if (!pan.annotationen.schwerpunkt.some((p) => p.art === 'text' && /^SP \d+,\d+ m \(\d+ % Höhe\)$/.test(p.text))) {
      bo.push(`${pan.ansicht}/Frame ${pan.frame}: keine Schwerpunkthöhe in Metern und Prozent`);
    }
    // Kontaktpunkte und Stützfläche nennen ihre Zahlen.
    if (!pan.annotationen.kontaktpunkte.some((p) => p.art === 'text' && /^Kontakt \d+\/\d+/.test(p.text))) {
      bo.push(`${pan.ansicht}/Frame ${pan.frame}: keine Kontaktzählung`);
    }
    if (!pan.annotationen.stuetzflaeche.some((p) => p.art === 'text' && /^Stützfläche \d+\/\d+/.test(p.text))) {
      bo.push(`${pan.ansicht}/Frame ${pan.frame}: keine Stützflächenangabe`);
    }
  }
  assert.deepEqual(bo, [], ` Panels ohne vollständige Annotation:\n  ${bo.join('\n  ')}`);

  // Bezugssystem: Charakter, aus dem Modell gemessen — nicht die Bühne.
  assert.equal(plan.bezug.up, 'y');
  assert.equal(plan.bezug.quelle.includes('gemessen'), true,
    `der Bezug muss als Messung ausgewiesen sein, war: "${plan.bezug.quelle}"`);
  const ohneBeschreibung = strip.ANSICHTEN.filter((v) => (plan.bezug.ansichten[v] ?? '').length < 10);
  assert.deepEqual(ohneBeschreibung, [],
    `diese Ansichten erklären dem Agenten nicht, von wo sie schauen: ${ohneBeschreibung.join(', ') || 'keine'}`);

  assert.deepEqual(strip.pruefeVollstaendigkeit(plan), {
    panels: plan.panels.length,
    gruppen: strip.PFLICHT_ANNOTATIONEN.length * plan.panels.length,
    vollstaendig: true,
  });
});

test('Ansichten, Negativfall: ein Streifen ohne Annotationen wird nicht ausgeliefert', async () => {
  const profile = await gemessenesProfil();
  const frames = [await stehPose()];
  const plan = strip.planeStreifen({ profile, frames, views: ['front', 'side'], frameCount: 1 });
  assert.doesNotThrow(() => strip.pruefeVollstaendigkeit(plan),
    'der unveränderte Plan muss durch die eigene Prüfung kommen, sonst beweist der Negativfall nichts');

  // 1) Eine Pflichtgruppe fehlt in einem Panel.
  const ohneKontakt = structuredClone(plan);
  ohneKontakt.panels[0].annotationen.kontaktpunkte = [];
  assert.throws(() => strip.pruefeVollstaendigkeit(ohneKontakt), (err) => {
    assert.match(err.message, /Bildstreifen abgelehnt/, `Meldung muss die Quelle nennen: "${err.message}"`);
    assert.match(err.message, /\d/, `Meldung muss eine Zahl nennen: "${err.message}"`);
    assert.match(err.message, /kontaktpunkte/i, `Meldung muss die fehlende Gruppe nennen: "${err.message}"`);
    return true;
  });

  // 2) Ein Raster ohne Zahl ist kein Maßstab: Metertexte entfernen, Raster lassen.
  const ohneMassstab = structuredClone(plan);
  for (const pan of ohneMassstab.panels) {
    pan.annotationen.bodengitter = pan.annotationen.bodengitter.filter(
      (p) => !(p.art === 'text' && / m$/.test(p.text)));
    assert.ok(pan.annotationen.bodengitter.length > 0,
      `die Gegenprobe braucht Linien ohne Zahlen, Panel ${pan.ansicht} hat ${pan.annotationen.bodengitter.length} Primitives`);
  }
  assert.throws(() => strip.pruefeVollstaendigkeit(ohneMassstab), (err) => {
    assert.match(err.message, /Maßstab/, `Meldung muss den Maßstab nennen: "${err.message}"`);
    assert.match(err.message, /\d/, `Meldung muss eine Zahl nennen: "${err.message}"`);
    return true;
  });

  // 3) Gar kein Panel.
  assert.throws(() => strip.pruefeVollstaendigkeit({ panels: [] }), /\d/,
    'ein Plan ohne Panels muss mit Zahl abgelehnt werden');
});

test('Maßstab, Positivfall: 0,60- und 2,40-m-Figur füllen dieselbe Panelhöhe', async () => {
  const basis = await gemessenesProfil();
  const frame = await stehPose();
  const hoehe = basis.world.height;

  /** Profil und Frame starr um den Faktor k skaliert — der Weg, den ein anderes
   *  Modell nimmt: alle Körpermaße bleiben gemessen, nur die Größe ändert sich.
   *  Die Sohlenpunkte bleiben knochen-lokal unverändert; die Größe steckt im
   *  Weltmaßstab des Knochens, der mit skaliert wird. */
  const skaliere = (k) => {
    const p = structuredClone(basis);
    p.world.height *= k;
    p.world.groundY *= k;
    for (const b of p.bones) b.bindWorld = b.bindWorld.map((x) => x * k);
    for (const s of p.segments) s.radius *= k;
    const f = structuredClone(frame);
    for (const id of Object.keys(f.positions)) {
      f.positions[id] = f.positions[id].map((x) => x * k);
      f.bones[id].position = f.bones[id].position.map((x) => x * k);
      f.bones[id].weltSkala = f.bones[id].weltSkala.map((x) => x * k);
    }
    return { profile: p, frame: f };
  };

  const kleine = skaliere(0.6 / hoehe);
  const grosse = skaliere(2.4 / hoehe);
  assert.ok(Math.abs(kleine.profile.world.height - 0.6) < 1e-9 &&
    Math.abs(grosse.profile.world.height - 2.4) < 1e-9,
    'die beiden Vergleichsprofile müssen 0,60 m und 2,40 m hoch sein');

  const plane = [kleine, grosse].map(({ profile, frame: f }) => strip.planeStreifen({
    profile, frames: [f], views: ['front'], frameCount: 1,
  }));

  // Seit der Rahmung über die Bewegung (Aufgabe 1) misst die Kamera die
  // Bounding-Box der Figur plus Puffer (RAHMEN_LUFT_ANTEIL je Seite) — die
  // Knochenpunkte füllen die Panelhöhe nicht mehr vollständig, aber die
  // PROPORTION bleibt: dieselbe gemessene Figur belegt dieselbe Pixelhöhe,
  // gleich wie groß das Modell ist.
  const inPixel = plane.map((p) => p.massstab.koerperHoeheMeter * p.massstab.pxProMeter);
  for (const [i, werte] of inPixel.entries()) {
    assert.ok(werte > 0,
      `Figur ${i + 1} belegt ${werte.toFixed(2)} px — die Körperhöhe muss in Pixeln messbar sein`);
  }
  assert.ok(Math.abs(inPixel[0] - inPixel[1]) / inPixel[0] < 0.01,
    `0,60 m und 2,40 m belegen ${inPixel[0].toFixed(2)} px gegen ${inPixel[1].toFixed(2)} px — dieselbe Proportion ist der Zweck des gemessenen Maßstabs`);

  // Die Figur füllt die Panelhöhe nicht mehr vollständig (Puffer der Rahmung),
  // aber sie bleibt gut sichtbar: über die Hälfte der Panelhöhe.
  const fuellung = plane.map((p) => {
    const pan = p.panels[0];
    const ys = Object.values(p.pose[0].wo).map((w) => {
      const h = (w[0] - pan.ziel[0]) * pan.Y[0] + (w[1] - pan.ziel[1]) * pan.Y[1]
        + (w[2] - pan.ziel[2]) * pan.Y[2];
      return -h * pan.pxProMeter;
    });
    return Math.abs(Math.max(...ys) - Math.min(...ys));
  });
  for (const [i, px] of fuellung.entries()) {
    assert.ok(px > plane[i].panels[0].hoehe * 0.5,
      `Figur ${i + 1} belegt nur ${px.toFixed(0)} px von ${plane[i].panels[0].hoehe} Panelhöhe — der Puffer frisst die Figur`);
  }

  // Der Rasterabstand in METERN muss sich dagegen mit der Körperhöhe ändern —
  // sonst wäre er ein getippter Festwert und die Zahl am Maßstab beliebig.
  assert.ok(plane[1].massstab.schrittMeter > plane[0].massstab.schrittMeter * 2,
    `Gitterschritt ${plane[0].massstab.schrittMeter} m bei 0,60 m gegen ${plane[1].massstab.schrittMeter} m bei 2,40 m: der Schritt wächst nicht mit der Körperhöhe`);
  for (const p of plane) {
    assert.ok(Math.abs(p.massstab.schrittMeter - p.massstab.koerperHoeheMeter / strip.GITTER_TEILUNG)
      <= p.massstab.schrittMeter,
      `Gitterschritt ${p.massstab.schrittMeter} m bei ${p.massstab.koerperHoeheMeter.toFixed(4)} m Körperhöhe ist nicht an die Körperhöhe gebunden`);
  }

  // Negativfall derselben Reihe: eine getippte Höhe, die am Modell nichts ändert.
  // Seit der Rahmung über die Bewegung bestimmt der GEMESSENE Bereich den Maßstab;
  // world.height steuert noch Puffer (RAHMEN_LUFT_ANTEIL) und Gitterschritt —
  // beide sind Anteile der getippten Höhe. Sie verdoppelt: der Luftanteil
  // verdoppelt sich in Metern, der Rahmen zieht weiter, der Maßstab sinkt —
  // die Figur schrumpft messbar im Bild, während Skelett und Sohlen unangetastet
  // bleiben. Genau der Tippfehler, den das Bild verraten muss.
  const geippt = structuredClone(basis);
  geippt.world.height = hoehe * 2;                // Modell bleibt hoehe m hoch
  const versetzt = strip.planeStreifen({
    profile: geippt, frames: [frame], views: ['front'], frameCount: 1,
  });
  const figuerHoeheInPixel = (p) => {
    const ys = Object.values(p.pose[0].wo).map((w) => w[1]).concat(p.pose[0].com[1]);
    return (Math.max(...ys) - Math.min(...ys)) * p.massstab.pxProMeter;
  };
  const echt = strip.planeStreifen({
    profile: basis, frames: [frame], views: ['front'], frameCount: 1,
  });
  const schrumpfung = figuerHoeheInPixel(versetzt) / figuerHoeheInPixel(echt);
  assert.ok(schrumpfung < 0.98,
    `bei doppelt getippter Höhe füllt die Figur ${figuerHoeheInPixel(versetzt).toFixed(1)} px `
    + `gegen ${figuerHoeheInPixel(echt).toFixed(1)} px (Faktor ${schrumpfung.toFixed(3)}): `
    + 'world.height steuert den Rahmen nicht — der Tippfehler wäre im Bild nicht zu sehen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Rahmung — die Kamera umspannt die BEWEGUNG, nicht die Bind-Pose (Auftrag 1–3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verschiebt alle Weltpositionen eines Frames um [links, hoch, vorn] Meter.
 * Anders als gerahmtePose(…, versatz) greift das auf einen BESTEHENDEN Frame —
 * so wird derselbe Sprung über verschiedene Posen gelegt, ohne das Skelett
 * wieder aufzubauen (teuer, unveränderlich pro Datei).
 */
function verschiebe(frame, versatz) {
  const d = versatz.map(Number);
  const kopie = structuredClone(frame);
  for (const id of Object.keys(kopie.positions)) {
    kopie.positions[id] = kopie.positions[id].map((x, a) => x + d[a]);
    if (kopie.bones[id] && Array.isArray(kopie.bones[id].position)) {
      kopie.bones[id].position = kopie.bones[id].position.map((x, a) => x + d[a]);
    }
  }
  if (Array.isArray(kopie.com)) kopie.com = kopie.com.map((x, a) => x + d[a]);
  return kopie;
}

test('Rahmung, Sprung: 1 m hoch und 2 m weit getragen bleibt in JEDEM Panel vollständig', async () => {
  const profile = await gemessenesProfil();
  const hoehe = profile.world.height;
  // Der Auftrag: Bewegung hebt die Figur UM 1 m und trägt sie UM 2 m weit.
  const HOCH_M = 1.0;
  const WEIT_M = 2.0;
  // Drei Frames des Sprungs: Absprung vom Boden, 1 m über dem Boden und 2 m weit
  // getragen (Apex), Landung 2 m weiter — dieselbe gestellte Figur, dreimal.
  const frames = [
    await versetztePose([0, HOCH_M, 0], 0),                    // 1 m gehoben
    await versetztePose([0, HOCH_M, WEIT_M], 1),               // 1 m hoch, 2 m weit
    await versetztePose([0, 0, WEIT_M], 2),                    // 2 m weit, Boden
  ];

  const plan = strip.planeStreifen({
    profile, frames, views: ['front', 'side', 'quarter', 'top'], frameCount: frames.length,
  });

  // Jede Ansicht ist ihre eigene Zeile; alle Panels einer Zeile nutzen dieselbe
  // Kamera — ohne das wäre Frame gegen Frame nicht vergleichbar (plan.md 6.8).
  for (const ansicht of ['front', 'side', 'quarter', 'top']) {
    const panelsDerAnsicht = plan.panels.filter((p) => p.ansicht === ansicht);
    const kameras = new Set(panelsDerAnsicht.map((p) =>
      JSON.stringify([p.ziel.map((x) => +x.toFixed(6)), +p.pxProMeter.toFixed(6)])));
    assert.equal(kameras.size, 1,
      `${panelsDerAnsicht.length} Panels der Ansicht '${ansicht}' nutzen `
      + `${kameras.size} verschiedene Kameras — die Panels sind dann nicht vergleichbar`);
  }

  // Und: vollständige Sichtbarkeit. Je Panel gemessen an ALLEN gemessenen
  // Knochenpositionen des Frames — dieselbe Quelle, die auch gezeichnet wird
  // (frame.wo). Der Rand (Puffer um Knochendicke und Segmentradius) ist nicht
  // Teil der Messung, die Figur ist es: jeder Punkt vollständig im Rechteck.
  const abgeschnitten = [];
  for (const pan of plan.panels) {
    const frame = plan.pose[pan.spalte];
    for (const [id, w] of Object.entries(frame.wo)) {
      const r = (w[0] - pan.ziel[0]) * pan.X[0] + (w[1] - pan.ziel[1]) * pan.X[1]
        + (w[2] - pan.ziel[2]) * pan.X[2];
      const h = (w[0] - pan.ziel[0]) * pan.Y[0] + (w[1] - pan.ziel[1]) * pan.Y[1]
        + (w[2] - pan.ziel[2]) * pan.Y[2];
      const dx = pan.x + pan.breite / 2 + r * pan.pxProMeter;
      const dy = pan.y + pan.hoehe / 2 - h * pan.pxProMeter;
      if (dx < pan.x || dx > pan.x + pan.breite || dy < pan.y || dy > pan.y + pan.hoehe) {
        abgeschnitten.push(`${pan.ansicht}/Frame ${pan.frame}: Knochen ${id} liegt bei `
          + `(${dx.toFixed(1)}, ${dy.toFixed(1)}) px außerhalb des Panels `
          + `${pan.x}..${pan.x + pan.breite} × ${pan.y}..${pan.y + pan.hoehe} px`);
      }
    }
    for (const s of frame.sohlen) {
      const r = (s.welt[0] - pan.ziel[0]) * pan.X[0] + (s.welt[1] - pan.ziel[1]) * pan.X[1]
        + (s.welt[2] - pan.ziel[2]) * pan.X[2];
      const h = (s.welt[0] - pan.ziel[0]) * pan.Y[0] + (s.welt[1] - pan.ziel[1]) * pan.Y[1]
        + (s.welt[2] - pan.ziel[2]) * pan.Y[2];
      const dx = pan.x + pan.breite / 2 + r * pan.pxProMeter;
      const dy = pan.y + pan.hoehe / 2 - h * pan.pxProMeter;
      if (dx < pan.x || dx > pan.x + pan.breite || dy < pan.y || dy > pan.y + pan.hoehe) {
        abgeschnitten.push(`${pan.ansicht}/Frame ${pan.frame}: Sohle ${s.id} liegt bei `
          + `(${dx.toFixed(1)}, ${dy.toFixed(1)}) px außerhalb des Panels`);
      }
    }
  }
  assert.deepEqual(abgeschnitten, [],
    `${abgeschnitten.length} Körperteile liegen außerhalb des Panels:\n  `
    + abgeschnitten.slice(0, 6).join('\n  '));

  // Der Maßstab bleibt WELTfest (Auftrag 2): im 'side'-Panel ist die Bodenkante
  // (Bodenlinie durch den Bind-Anker) sichtbar UND der getragene Frame liegt
  // höher im Bild. Der Höhenunterschied zwischen dem 1-m-gehobenen und dem
  // am-Boden-Frame misst in Pixeln etwa 1 m — wäre die Kamera mitgezogen, wäre
  // der Unterschied 0 und der Agent sähe ein stilles Bild.
  const seite = plan.panels.filter((p) => p.ansicht === 'side');
  const bodenY = (pan) => {
    // Bind-Anker in der Bildebene dieser Ansicht.
    const rAnker = plan.bezug.anker;
    const pA = [rAnker[0], profile.world.groundY, rAnker[2]];
    const hA = (pA[0] - pan.ziel[0]) * pan.Y[0] + (pA[1] - pan.ziel[1]) * pan.Y[1]
      + (pA[2] - pan.ziel[2]) * pan.Y[2];
    return pan.y + pan.hoehe / 2 - hA * pan.pxProMeter;
  };
  const bodenPanel = seite.find((p) => p.frame === frames[2].frame);
  const hoehePanel = seite.find((p) => p.frame === frames[0].frame);
  const figuerY = (pan) => {
    const frame = plan.pose[pan.spalte];
    const ys = Object.values(frame.wo).map((w) => {
      const h = (w[0] - pan.ziel[0]) * pan.Y[0] + (w[1] - pan.ziel[1]) * pan.Y[1]
        + (w[2] - pan.ziel[2]) * pan.Y[2];
      return -h * pan.pxProMeter;
    });
    return Math.min(...ys);
  };
  const pxProMeter = bodenPanel.pxProMeter;
  const versatzBoden = bodenY(bodenPanel) - figuerY(bodenPanel);
  const versatzSprungPx = (figuerY(hoehePanel) - figuerY(bodenPanel));
  const versatzSprungM = Math.abs(versatzSprungPx) / pxProMeter;
  assert.ok(versatzSprungM > HOCH_M * 0.8,
    `der 1-m-Sprung zeigt im Bild ${versatzSprungM.toFixed(2)} m Höhenunterschied zwischen `
    + `Frame ${hoehePanel.frame} und Frame ${bodenPanel.frame} (bei `
    + `${pxProMeter.toFixed(1)} px/m und ${Math.abs(versatzSprungPx).toFixed(0)} px) — `
    + 'die Kamera wandert nicht, aber die Figur steigt nicht sichtbar');
  assert.ok(bodenY(bodenPanel) > bodenPanel.y && bodenY(bodenPanel) < bodenPanel.y + bodenPanel.hoehe,
    `die Bodenkante liegt bei y = ${bodenY(bodenPanel).toFixed(0)} px außerhalb des Panels `
    + `${bodenPanel.y}..${bodenPanel.y + bodenPanel.hoehe} — der Maßstab wandert aus dem Bild`);

  // Negativfall (AGENTS.md, Regel 2): dass der Test etwas misst, zeigt der
  // Bind-Pose-Modus — dieselbe GESTELLTE Figur, aber die Höhenverschiebung
  // fortgerechnet, bis alle drei Frames auf dem Boden stehen. Der Höhenunter-
  // schied zwischen den Frames muss dort gegen 0 fallen; bliebe er bestehen,
  // würde der Test oben einen Dauerzustand belegen (die Posen sind im Sprung
  // sonst identisch gestaffelt — drei gemeinsame Verschiebungen ändern die
  // Differenz nicht).
  const bindFrames = [verschiebe(frames[0], [0, -HOCH_M, 0]),
    verschiebe(frames[1], [0, -HOCH_M, 0]), frames[2]];
  const planBind = strip.planeStreifen({
    profile, frames: bindFrames, views: ['side'], frameCount: bindFrames.length,
  });
  const figuerYBind = (pan) => {
    const frame = planBind.pose[pan.spalte];
    const ys = Object.values(frame.wo).map((w) => {
      const h = (w[0] - pan.ziel[0]) * pan.Y[0] + (w[1] - pan.ziel[1]) * pan.Y[1]
        + (w[2] - pan.ziel[2]) * pan.Y[2];
      return -h * pan.pxProMeter;
    });
    return Math.min(...ys);
  };
  const bindBoden = planBind.panels.find((p) => p.frame === bindFrames[2].frame);
  const bindHoch = planBind.panels.find((p) => p.frame === bindFrames[0].frame);
  const bindSprungM = Math.abs(figuerYBind(bindBoden) - figuerYBind(bindHoch)) / bindBoden.pxProMeter;
  assert.ok(Math.abs(bindSprungM) < 0.1,
    `ohne Verschiebung misst dieselbe Prüfung ${bindSprungM.toFixed(3)} m Höhenunterschied `
    + 'zwischen identischen Posen — der Test misst Rauschen, nicht die Rahmung');
  console.log(`    gemessen: Sprunghöhe im Bild ${(versatzSprungM).toFixed(3)} m `
    + `(gefordert > ${(HOCH_M * 0.8).toFixed(1)} m), Bind-Pose-Referenz `
    + `${bindSprungM.toFixed(3)} m, Panels ${plan.panels.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Eingaben — jede Ablehnung nennt eine Zahl (AGENTS.md)
// ─────────────────────────────────────────────────────────────────────────────

test('Eingaben, Negativfälle: jede Ablehnung nennt Grund und Zahl', async () => {
  const profile = await gemessenesProfil();
  const frame = await stehPose();
  const ruft = (extra) => () => strip.planeStreifen({
    profile, frames: [frame], views: ['front'], ...extra,
  });

  const faelle = [
    ['Frame außerhalb der Timeline', ruft({ frameCount: 30, frames: [{ ...frame, frame: 34 }] }),
      /Frame 34.*0 bis 29/],
    ['zu viele Frames', () => strip.planeStreifen({
      profile, views: ['front'],
      frames: Array.from({ length: strip.FRAMES_MAX + 1 }, (_, i) => ({ ...frame, frame: i })),
      frameCount: strip.FRAMES_MAX + 1,
    }), new RegExp(`${strip.FRAMES_MAX + 1} Frames.*höchstens ${strip.FRAMES_MAX}`)],
    ['unbekannte Ansicht', ruft({ views: ['vorne'] }), /vorne.*4 Stück/],
    ['doppelte Ansicht', ruft({ views: ['front', 'front'] }), /2 Ansichten mit nur 1/],
    ['leere Ansichtsliste', ruft({ views: [] }), /erwartet 1 bis 4/],
    ['Frame ohne Pose', ruft({ frames: [{ frame: 0 }] }), /weder positions noch bones/],
    ['Knochen, die das Profil nicht kennt', ruft({
      frames: [{ ...frame, bones: { ...frame.bones, FantasieKnochen: frame.bones.mixamorigHips } }],
    }), /1 Knochen.*67 Knochen/],
    ['positions und bones in disagreement', ruft({
      frames: [{
        ...frame,
        positions: { ...frame.positions, mixamorigHips: frame.positions.mixamorigHips.map((x, i) => x + (i === 0 ? 0.5 : 0)) },
      }],
    }), /verschiedene Posen/],
    ['Sohle mit falschem Weltmaßstab', ruft({
      frames: [{
        ...frame,
        bones: Object.fromEntries(Object.entries(frame.bones).map(([k, v]) => [k, {
          ...v, weltSkala: v.weltSkala.map((x) => x * 100),
        }])),
      }],
    }), /Sohle .* liegt \d+,\d+ m vom Gelenk .* entfernt, erlaubt sind/],
    ['fehlende Körperhöhe', () => strip.charakterSystem({ world: { up: 'y', height: 0 } }), /height.*0/],
    ['falsche Auf-Achse', () => strip.charakterSystem({ world: { up: 'z', height: 1.8 } }), /world\.up = "z": erwartet 'y'/],
  ];

  const bo = [];
  for (const [name, ausfuehren, muster] of faelle) {
    let meldung = null;
    try { ausfuehren(); } catch (err) { meldung = err.message; }
    if (meldung === null) { bo.push(`${name}: abgelehnt werden müsste, nichts geworfen`); continue; }
    if (!/\d/.test(meldung)) { bo.push(`${name}: Meldung nennt keine Zahl — "${meldung}"`); continue; }
    if (muster && !muster.test(meldung)) {
      bo.push(`${name}: Meldung ${muster} entspricht nicht — "${meldung}"`);
    }
  }
  assert.deepEqual(bo, [], `Ablehnungen mit Zahl mangelhaft:\n  ${bo.join('\n  ')}`);

  // Gegentest: nichts davon wirft der unveränderte Aufruf.
  assert.doesNotThrow(ruft({ frameCount: 30 }),
    'der saubere Aufruf muss durchkommen — sonst melden die Fälle oben nur einen Dauerzustand');

  // Die Sohlen- und Rahmenprüfung muss ihre Zahl nennen, wenn der Weltmaßstab
  // fehlt: dann sitzt die Sohle auf dem Gelenk und der Streifen sagt es.
  const ohneSkala = strip.planeStreifen({
    profile,
    frames: [{ ...frame, bones: Object.fromEntries(Object.entries(frame.bones).map(([k, v]) => [k, { ...v, weltSkala: undefined }])) }],
    views: ['front'], frameCount: 30,
  });
  assert.equal(ohneSkala.warnungen.length > 0, true,
    'fehlender Weltmaßstab muss als Warnung auftauchen, warnungen waren 0');
  assert.match(ohneSkala.warnungen.join(' '), /\d/,
    `Warnung muss eine Zahl nennen: ${ohneSkala.warnungen.join(' | ')}`);
});

test('Renderer-Port: Frame-Zahlen der Timeline als Eingabe, 12 als Grenze, Canvas-Pflicht', async () => {
  const profile = await gemessenesProfil();
  const frames = [await stehPose(), await fremdePose()];
  const port = strip.createStripRenderer({ profile, frames, frameCount: frames.length });

  assert.deepEqual(port.views, strip.ANSICHTEN,
    `der Port muss die ${strip.ANSICHTEN.length} benannten Ansichten nennen, waren: ${port.views.join(', ')}`);

  // Abfragen, die durch die Eingabeprüfung kommen, landen in Node bei der
  // Canvas-Pflicht: WebGL und Canvas 2D gibt es hier nicht. Dass genau dieser
  // Fehler kommt, beweist, dass davor nichts abgelehnt wurde.
  assert.throws(() => port.streifen({ frames: [0], views: ['side'] }), /Canvas/,
    'eine gültige Abfrage muss in Node an der Canvas-Pflicht enden, nicht an einer Eingabeprüfung');

  // frameQuelle, die jeden Index bedient: hier prüft strip.js den Timeline-Bereich
  // selbst, nicht nur das Auflösen.
  const immerPort = strip.createStripRenderer({
    profile, frameCount: 2, frameQuelle: () => frames[0],
  });

  const abgelehnt = [
    ['keine Frames', () => port.streifen({ views: ['side'] }), /frames.*erwartet 1 bis 12/],
    ['fehrender Frame', () => port.streifen({ frames: [7], views: ['side'] }),
      /Frame 7 ist nicht aufgelöst — 1 von 1/],
    ['nicht ganzzahlig', () => port.streifen({ frames: [1.5], views: ['side'] }),
      /frames-Eintrag 1\.5/],
    ['über der Grenze', () => port.streifen({
      frames: Array.from({ length: strip.FRAMES_MAX + 1 }, () => 0), views: ['side'] }),
      new RegExp(`${strip.FRAMES_MAX + 1} Frames angefordert: höchstens ${strip.FRAMES_MAX}`)],
    ['unbekannte Ansicht', () => port.streifen({ frames: [0], views: ['hinten'] }), /hinten/],
    ['Timeline-Bereich', () => immerPort.streifen({ frames: [7], views: ['side'] }),
      /Frame 7 liegt außerhalb der Timeline von 0 bis 1/],
  ];
  const bo = [];
  for (const [name, abfrage, muster] of abgelehnt) {
    let meldung = null;
    try { abfrage(); } catch (err) { meldung = err.message; }
    if (meldung === null) bo.push(`${name}: nichts abgelehnt`);
    else if (!muster.test(meldung)) bo.push(`${name}: ${muster} erwartet, war "${meldung}"`);
    else if (!/\d/.test(meldung)) bo.push(`${name}: Meldung ohne Zahl — "${meldung}"`);
  }
  assert.deepEqual(bo, [], `Port-Prüfungen mangelhaft:\n  ${bo.join('\n  ')}`);

  // frameQuelle statt Array — derselbe Weg, den src/tools/index.js nutzt.
  const ausQuelle = strip.createStripRenderer({
    profile, frameCount: 2, frameQuelle: (i) => frames[i],
  });
  assert.throws(() => ausQuelle.streifen({ frames: [0], views: ['side'] }), /Canvas/,
    'über frameQuelle aufgelöste Frames müssen genauso durch die Eingabeprüfung kommen');
  assert.throws(() => strip.createStripRenderer({ profile }), /frameQuelle|0 Quellen/,
    'ohne Frame-Quelle muss der Port beim Bau ablehnen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Pixelschiene — Canvas 2D und WebGL gibt es nur im Browser. Der Aufbau ist
// derselbe, den tools/browser-test.mjs schon geht: echter Datei-Server mit
// Port 0, echtes Chromium, Module über document.baseURI. Kein zweiter Weg, und
// keine fremde Datei wird dafür angefasst.
// ─────────────────────────────────────────────────────────────────────────────

const HIER = dirname(fileURLToPath(import.meta.url));
const STARTZEILE = /Server läuft: (http:\/\/localhost:\d+\/)/;

let hoelle = null;

/** Startet Server und Browser genau einmal; der erste Pixeltest tut es. */
async function seite() {
  if (hoelle) return hoelle;
  const { chromium } = await import('playwright');

  const prozess = spawn(process.execPath, [join(HIER, '..', '..', 'tools', 'serve.mjs')], {
    cwd: join(HIER, '..', '..'),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const basis = await new Promise((resolve, reject) => {
    const zeitlimit = setTimeout(() => {
      prozess.kill();
      reject(new Error('Datei-Server meldet seine Startzeile mit URL nicht innerhalb von 10000 ms'));
    }, 10000);
    let gepuffert = '';
    prozess.stdout.setEncoding('utf8');
    prozess.stdout.on('data', (chunk) => {
      gepuffert += chunk;
      const gemeldete = gepuffert.match(STARTZEILE);
      if (gemeldete) { clearTimeout(zeitlimit); resolve(gemeldete[1]); }
    });
    prozess.on('exit', (code) => {
      clearTimeout(zeitlimit);
      if (code !== 0) reject(new Error(`Server endete vor der Startmeldung, Code ${code}`));
    });
  });

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.goto(basis, { waitUntil: 'load' });
  hoelle = { browser, prozess, page, basis };
  return hoelle;
}

after(async () => {
  await hoelle?.browser?.close();
  hoelle?.prozess?.kill();
});

/**
 * Streift in der echten Seite ein: planeStreifen → pruefeVollstaendigkeit →
 * bildeStreifen. Gibt das Bild (Base64) und die mit echten Font-Metriken
 * gemessenen Beschriftungsüberläufe zurück.
 *
 * @param {object} p { profile, frames, views, mitMesh }
 */
async function streifeInDerSeite(p) {
  const { page } = await seite();
  return page.evaluate(async (anfrage) => {
    const strip = await import(new URL('src/render/strip.js', document.baseURI).href);
    const opts = {
      profile: anfrage.profile,
      frames: anfrage.frames,
      views: anfrage.views,
      frameCount: anfrage.frameCount ?? anfrage.frames.length,
    };

    let scene = null;
    let vorher = null;
    if (anfrage.mitMesh) {
      const { loadGLB } = await import(new URL('src/scene/load.js', document.baseURI).href);
      const antwort = await fetch(new URL('spikes/test-b-motion/assets/Xbot.glb',
        document.baseURI).href);
      if (!antwort.ok) {
        throw new Error(`Testmodell nicht ladbar: HTTP ${antwort.status} für ${antwort.url}`);
      }
      const gltf = await loadGLB(await antwort.arrayBuffer());
      scene = gltf.scene;
      vorher = strip.frameAusScene(scene, { frame: 0 });
      // Das Stellen jeder Frame-Pose übernimmt bildeStreifen selbst — hier wird
      // nur die Szene übergeben. Danach muss sie unverändert sein, denn die
      // Menschenansicht derselben Seite zeigt dasselbe Modell.
      opts.scene = scene;
    }

    const eintrag = strip.bildeStreifen(opts);

    // Die Budgettreppe kann die Panelauflösung senken, die Zeitkürzung
    // (PANELS_ZEIT_MAX) Frames wegnehmen. Gemessen wird deshalb an dem Bild,
    // das tatsächlich ausgeliefert wird: die gezeigten Frames stehen im
    // Eintrag, die Panelbreite lässt sich aus der Bildbreite exakt
    // zurückrechnen, und der Plan wird mit genau diesen Werten neu gebaut.
    const panelBreite = (eintrag.width - strip.PANEL_ABSTAND_PX) / eintrag.frames.length
      - strip.PANEL_ABSTAND_PX;
    const gezeigt = eintrag.frames.map((fi) =>
      anfrage.frames.find((f) => f.frame === fi));
    const plan = strip.planeStreifen({
      ...opts, frames: gezeigt, skala: panelBreite / strip.PANEL_BREITE_PX,
    });
    if (plan.breite !== eintrag.width) {
      throw new Error(`der nachgebaute Plan ist ${plan.breite} px breit, ausgeliefert wurden `
        + `${eintrag.width} px — gemessen würde an einem anderen Bild als dem ausgelieferten`);
    }
    const voll = strip.pruefeVollstaendigkeit(plan);

    // Beschriftungen mit denselben Font-Metriken messen, mit denen sie
    // gezeichnet werden: ctx.measureText, nicht eine Breite pro Zeichen.
    const messLeinwand = document.createElement('canvas');
    const mess = messLeinwand.getContext('2d');
    const ueberlauf = [];
    const alleTexte = new Set();
    for (const pan of plan.panels) {
      const texte = []
        .concat(...Object.values(pan.annotationen))
        .concat(pan.koerper, pan.beschriftung)
        .filter((pr) => pr.art === 'text');
      for (const pr of texte) {
        alleTexte.add(pr.text);
        mess.font = `${pr.groesse}px ui-monospace, Consolas, monospace`;
        const b = mess.measureText(pr.text).width;
        const li = pr.anker === 'rechts' ? pr.x - b
          : (pr.anker === 'mitte' ? pr.x - b / 2 : pr.x);
        const links = pan.x - li;                       // > 0: über die linke Kante
        const rechts = (li + b) - (pan.x + pan.breite); // > 0: über die rechte Kante
        if (links > 1 || rechts > 1) {
          ueberlauf.push({
            ansicht: pan.ansicht, frame: pan.frame, text: pr.text,
            pixel: Math.round(Math.max(links, rechts)),
            ueber: links > rechts ? 'links' : 'rechts',
            feld: `${Math.round(li)}..${Math.round(li + b)} px`,
            panel: `${pan.x}..${pan.x + pan.breite} px`,
          });
        }
      }
    }

    let groesteVeranderung = null;
    if (scene) {
      const nachher = strip.frameAusScene(scene, { frame: 0 });
      groesteVeranderung = 0;
      for (const id of Object.keys(vorher.positions)) {
        for (let a = 0; a < 3; a++) {
          groesteVeranderung = Math.max(groesteVeranderung,
            Math.abs(nachher.positions[id][a] - vorher.positions[id][a]));
        }
      }
    }
    return { eintrag, voll, ueberlauf, groesteVeranderung, texte: [...alleTexte], planZusammenfassung: {
      panels: plan.panels.length, breite: plan.breite, hoehe: plan.hoehe,
      massstab: plan.massstab, warnungen: plan.warnungen,
      gruppen: Object.fromEntries(Object.keys(plan.panels[0].annotationen).map((g) => [
        g, plan.panels.reduce((n, pan) => n + pan.annotationen[g].length, 0)])),
    } };
  }, p);
}

/** Zählt Pixelunterschiede zweier PNGs in der Seite (echter PNG-Decoder). */
async function pixelvergleich(a, b) {
  const { page } = await seite();
  return page.evaluate(async ([base64A, base64B, schwelle]) => {
    const lade = (daten) => new Promise((resolve, reject) => {
      const bild = new Image();
      bild.onload = () => resolve(bild);
      bild.onerror = () => reject(new Error(`PNG nicht lesbar (${daten.length} Base64-Zeichen)`));
      bild.src = `data:image/png;base64,${daten}`;
    });
    const [ia, ib] = await Promise.all([lade(base64A), lade(base64B)]);
    const leinwand = document.createElement('canvas');
    leinwand.width = Math.max(ia.width, ib.width);
    leinwand.height = Math.max(ia.height, ib.height);
    const ctx = leinwand.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const pa = ctx.getImageData(0, 0, leinwand.width, leinwand.height).data;
    ctx.clearRect(0, 0, leinwand.width, leinwand.height);
    ctx.drawImage(ib, 0, 0);
    const pb = ctx.getImageData(0, 0, leinwand.width, leinwand.height).data;

    let alle = 0;
    let sichtbar = 0;
    let groester = 0;
    const gesamt = leinwand.width * leinwand.height;
    for (let i = 0; i < gesamt; i++) {
      const o = i * 4;
      const d = Math.max(
        Math.abs(pa[o] - pb[o]), Math.abs(pa[o + 1] - pb[o + 1]), Math.abs(pa[o + 2] - pb[o + 2]));
      if (d > 0) alle++;
      if (d > schwelle) sichtbar++;
      if (d > groester) groester = d;
    }
    return {
      breiteA: ia.width, hoeheA: ia.height, breiteB: ib.width, hoeheB: ib.height,
      gesamt,
      jedeAnteil: alle / gesamt,
      sichtbarAnteil: sichtbar / gesamt,
      sichtbarPixel: sichtbar,
      groesterKanalabstand: groester,
      schwelle,
    };
  }, [a, b, SICHTBAR_SCHWELLE]);
}


// ─────────────────────────────────────────────────────────────────────────────
// Reihe 3 — Anhang (Node-Hälfte: die Bildpflicht selbst)
// ─────────────────────────────────────────────────────────────────────────────
test('Anhang, Negativfall: ein Bericht ohne Streifen gilt als unvollständig', async () => {
  const berichtOhneBild = {
    frameCount: 2, phases: [{ state: 'kontakt', from: 0, to: 2 }],
    physics: { passed: true, issues: [] },
    intent: { passed: true, checks: [] },
    style: { passed: true, issues: [] },
    images: [],
  };
  const befund = validateValidationReport(berichtOhneBild);
  assert.equal(befund.ok, false,
    'ein Bericht mit 0 Bildverweisen muss am eigenen Schema scheitern');
  assert.ok(befund.errors.some((e) => e.field === 'images'),
    `die Ablehnung muss images nennen, Fehler waren: ${befund.errors.map((e) => e.field).join(', ')}`);

  assert.throws(() => strip.haengeStreifenAn({ ...berichtOhneBild }, []), (err) => {
    assert.match(err.message, /^Bildstreifen abgelehnt: 0 /, `Meldung muss mit der Zahl 0 beginnen: "${err.message}"`);
    assert.match(err.message, /5\.3/, `Meldung muss die Stelle im Plan nennen: "${err.message}"`);
    return true;
  });

  assert.throws(() => strip.haengeStreifenAn({ ...berichtOhneBild }, [
    { view: 'front', frames: [0], ref: 'strip_front_0.png', data: '' },
  ]), (err) => {
    assert.match(err.message, /1 von 1/, `Meldung muss die Zahl streifen ohne Bild nennen: "${err.message}"`);
    assert.match(err.message, /unvollständig/, `Meldung muss den Grund nennen: "${err.message}"`);
    return true;
  });

  // Positivfall derselben Reihe: ein Eintrag mit Bild füllt images so, wie das
  // eigene Schema es verlangt — und der Bericht besteht damit die Vertragsprüfung.
  const bericht = strip.haengeStreifenAn({ ...berichtOhneBild }, [{
    view: 'front+side', views: ['front', 'side'], frames: [0, 1],
    ref: 'strip_front+side_0-1.png', data: 'iVBORw0KGgo-', mimeType: 'image/png',
  }]);
  assert.deepEqual(bericht.images, [{
    view: 'front+side', frames: [0, 1], ref: 'strip_front+side_0-1.png',
  }], `angehängter Streifen muss {view, frames, ref} lassen: ${JSON.stringify(bericht.images)}`);
  assert.equal(validateValidationReport(bericht).ok, true,
    `Bericht mit angehängtem Streifen muss das eigene Schema bestehen: ${JSON.stringify(validateValidationReport(bericht).errors)}`);
  assert.equal(validateValidationReport(berichtOhneBild).ok, false,
    'derselbe Bericht ohne Streifen muss scheitern — sonst beweist der Positivfall nichts');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 4 — Zeitgrenze (Auftrag "Der Bildstreifen frisst den Rechner")
// Gemessen wurde an Xbot, SwiftShader (spikes/tmp-strip-zeit.mjs, 31.08.2026):
// 24 Panels brauchten 1133 ms, 48 Panels 2151 ms. PANELS_ZEIT_MAX = 24 ist
// die Kürzung VOR dem Rendern — hier wird nachgemessen, dass sie greift.
// ─────────────────────────────────────────────────────────────────────────────

test('Zeitgrenze, Positivfall: 48 angeforderte Panels werden auf 24 gekürzt und sagen es', async () => {
  const profile = await gemessenesProfil();
  const vorrat = await rahmenVorrat(strip.FRAMES_MAX);
  const t0 = performance.now();

  const plan = strip.planeStreifen({
    profile, frames: vorrat, views: strip.ANSICHTEN, frameCount: strip.FRAMES_MAX,
  });
  const dauerMs = performance.now() - t0;

  // Die Kürzung passiert VOR dem Zeichnen: der Plan trägt PANELS_ZEIT_MAX
  // Panels, nicht 48, und die Dauer bleibt im Millisekundenbereich.
  assert.equal(plan.panels.length, strip.PANELS_ZEIT_MAX,
    `${plan.panels.length} Panels geplant, erwartet ${strip.PANELS_ZEIT_MAX} `
    + `(Grenze PANELS_ZEIT_MAX, gemessen 1133 ms für 24, 2151 ms für 48 Panels)`);
  assert.ok(dauerMs < strip.STRIPE_ZEIT_MS,
    `der Plan brauchte ${Math.round(dauerMs)} ms, Grenze ${strip.STRIPE_ZEIT_MS} ms`);
  assert.match(plan.warnungen.join(' '), /Zeitgrenze/,
    `die Kürzung muss als Warnung stehen, warnungen waren: ${plan.warnungen.join(' | ') || 'keine'}`);
  assert.match(plan.warnungen.join(' '), /\d/,
    `die Kürzungswarnung nennt eine Zahl: ${plan.warnungen.join(' | ')}`);

  // Die gezeigten Frames sind die ERSTEN n (sortierte Auswahl deckt Stütz,
  // Druck und Flug ab); die angeforderten Frame-Indices stehen voll im Plan.
  const gezeigt = plan.frames.map((f) => f.index);
  assert.deepEqual(gezeigt, [0, 1, 2, 3, 4, 5],
    `die ersten 6 Frames je Ansicht gezeigt, war: ${gezeigt.join(', ')}`);

  // Negativfall derselben Reihe (AGENTS.md, Regel 2): unter der Grenze wird
  // NICHT gekürzt und keine Zeitwarnung erfunden.
  const klein = strip.planeStreifen({
    profile, frames: vorrat.slice(0, 6), views: strip.ANSICHTEN,
    frameCount: strip.FRAMES_MAX,
  });
  assert.equal(klein.panels.length, 24, `${klein.panels.length} Panels, erwartet 24`);
  assert.equal(klein.warnungen.some((w) => w.includes('Zeitgrenze')), false,
    `unter der Grenze keine Zeitwarnung: ${klein.warnungen.join(' | ')}`);
});

test('Zeitgrenze, Negativfall: die Kürzung ist die Ursache für 24 nicht 48 Panels', async () => {
  const profile = await gemessenesProfil();
  const vorrat = await rahmenVorrat(strip.FRAMES_MAX);

  // Der echte Vergleichspunkt: PANELS_ZEIT_MAX liegt UNTER dem 12×4-Maximum —
  // sonst würde die Grenze gar nicht kürzen und der Positivfall oben bewiese
  // einen Dauerzustand statt eines Mechanismus.
  assert.ok(strip.PANELS_ZEIT_MAX < strip.FRAMES_MAX * strip.ANSICHTEN.length,
    `PANELS_ZEIT_MAX = ${strip.PANELS_ZEIT_MAX}, das 12×4-Maximum sind `
    + `${strip.FRAMES_MAX * strip.ANSICHTEN.length} — die Grenze kürzt beim Maximum nicht`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pixelschiene — die Abnahmetabelle wird mit echten Bildpunkten geprüft
// ─────────────────────────────────────────────────────────────────────────────

/** Das Maximum an Frames, das Werkzeug `look` verlangen kann. */
async function rahmenVorrat(anzahl) {
  const aus = [];
  for (let i = 0; i < anzahl; i++) {
    aus.push(await gerahmtePose(
      [['mixamorigLeftUpLeg', 'x', -3 * i], ['mixamorigRightForeArm', 'z', 2 * i]],
      null, i));
  }
  return aus;
}

/** Dieselbe Pose, aber 0,30 m über dem Boden: Phase Flug, 0 Kontaktpunkte. */
const flugPose = () => gerahmtePose([], [0, 0.3, 0], 0);

/** Frame ohne Gelenkausrichtung — die Form, die timeline.solved mitbringt, wenn
 *  nur `positions` gelöst wurden. Dann sitzen die Sohlen auf den Gelenken. */
async function ohneAusrichtungPose() {
  const f = await stehPose();
  for (const id of Object.keys(f.bones)) delete f.bones[id].weltSkala;
  return f;
}

test('Bild, Positivfall: ein PNG mit allen vier Ansichten und unbeschnittenen Zahlen', async () => {
  const profile = await gemessenesProfil();
  const frames = [await stehPose(), await fremdePose()];

  const { eintrag, voll, ueberlauf, planZusammenfassung } = await streifeInDerSeite({
    profile, frames, views: strip.ANSICHTEN, frameCount: frames.length,
  });

  // WebMCP-Bildanhang: { type:'image', data, mimeType } (AGENTS.md, gemessen).
  assert.equal(eintrag.mimeType, 'image/png', `mimeType war: ${eintrag.mimeType}`);
  assert.match(eintrag.data, /^iVBORw0K/, 'die Daten müssen ein Base64-PNG ohne Datenpräfix sein');
  assert.ok(eintrag.bytes >= strip.MIN_BILD_BYTES,
    `Bild ist ${eintrag.bytes} Byte: unter ${strip.MIN_BILD_BYTES} Byte passt kein annotierter Streifen`);
  assert.ok(eintrag.bytes <= strip.ANTWORT_BUDGET_BYTES,
    `Bild ist ${eintrag.bytes} Byte über der gemessenen Antwortgrenze von ${strip.ANTWORT_BUDGET_BYTES} Byte (512 KB)`);
  assert.equal(eintrag.data.length % 4, 0, 'Base64 muss ohne Auffüllungslücke durch die API gehen');

  // Genau EIN Bild, alle Ansichten nebeneinander.
  assert.equal(eintrag.view, strip.ANSICHTEN.join('+'), `Ansichtsname war: ${eintrag.view}`);
  assert.deepEqual(eintrag.frames, [0, 1], `Frames im Bild: ${JSON.stringify(eintrag.frames)}`);
  assert.equal(eintrag.ref, `strip_${strip.ANSICHTEN.join('+')}_0-1.png`, `ref war: ${eintrag.ref}`);
  assert.equal(eintrag.panels, frames.length * strip.ANSICHTEN.length,
    `${eintrag.panels} Panels, erwartet ${frames.length * strip.ANSICHTEN.length}`);
  assert.equal(planZusammenfassung.panels, eintrag.panels);
  assert.equal(voll.vollstaendig, true);

  // Fünf Pflichtgruppen, über alle Panels gezählt.
  const leere = Object.entries(planZusammenfassung.gruppen).filter(([, n]) => n === 0)
    .map(([g]) => g);
  assert.deepEqual(leere, [], `diese Pflichtgruppen haben im gerenderten Bild 0 Primitives: ${leere.join(', ')}`);
  for (const gruppe of strip.PFLICHT_ANNOTATIONEN) {
    assert.ok(eintrag.annotationen[gruppe] > 0,
      `der Eintrag weist ${gruppe} mit ${eintrag.annotationen[gruppe]} Primitives aus`);
  }

  // Die Zahlen im Bild müssen lesbar bleiben: mit echten Font-Metriken gemessen.
  assert.deepEqual(ueberlauf, [],
    `${ueberlauf.length} Beschriftungen laufen über die Panelbreite und werden abgeschnitten:\n  `
    + ueberlauf.slice(0, 6).map((u) => `${u.ansicht}/Frame ${u.frame} ${u.ueber} ${u.pixel} px `
      + `[${u.feld} in ${u.panel}] „${u.text}“`).join('\n  '));

  // Der Maßstab steht als Zahl im Bild und stammt aus der gemessenen Körperhöhe.
  assert.equal(planZusammenfassung.massstab.koerperHoeheMeter, profile.world.height,
    `die gemessene Körperhöhe ${profile.world.height} m muss im Maßstab stehen, war ${planZusammenfassung.massstab.koerperHoeheMeter}`);
});

test('Aussagekraft, beide Richtungen: verschiedene Posen groß, 2 mm Versatz unsichtbar', async () => {
  const profile = await gemessenesProfil();
  const steh = await stehPose();
  const fremd = await fremdePose();
  const mm = await millimeterPose();
  const anfrage = (frames) => ({ profile, frames, views: strip.ANSICHTEN, frameCount: 3 });

  const basis = await streifeInDerSeite(anfrage([steh]));
  const gleich = await streifeInDerSeite(anfrage([steh]));
  const klein = await streifeInDerSeite(anfrage([mm]));
  const gross = await streifeInDerSeite(anfrage([fremd]));

  // 1) Der Messung selbst über den Weg getraut: zweimal derselbe Streifen muss
  //    BITGENAU gleich sein. Rötet hier etwas, ist der Vergleich unbrauchbar und
  //    die beiden folgenden Behauptungen sind wertlos.
  const identisch = await pixelvergleich(basis.eintrag.data, gleich.eintrag.data);
  assert.equal(identisch.sichtbarPixel, 0,
    `derselbe Streifen zweimal gerendert unterscheidet sich in ${identisch.sichtbarPixel} von ${identisch.gesamt} Pixeln — der Vergleich misst Rauschen`);

  // Nachgemessener Maßstab: wie viele Pixel sind 2 mm an diesem Modell?
  const millimeterInPixel = 0.002 * basis.planZusammenfassung.massstab.pxProMeter;
  assert.ok(millimeterInPixel < 1,
    `2 mm sind bei ${basis.planZusammenfassung.massstab.pxProMeter.toFixed(1)} px/m bereits ${millimeterInPixel.toFixed(2)} px — der Maßstab ist zu grob für die Aussage „unsichtbar“`);

  // 2) Kleine Richtung: eine um 2 mm verschobene Pose ergibt KEINEN sichtbar
  //    anderen Streifen.
  const kleiner = await pixelvergleich(basis.eintrag.data, klein.eintrag.data);
  assert.ok(kleiner.sichtbarAnteil < GRENZ_KLEIN_ANTEIL,
    `2 mm Versatz ändern ${kleiner.sichtbarAnteil.toFixed(4)} der Pixel (${kleiner.sichtbarPixel} Stück) über der Schwelle von ${SICHTBAR_SCHWELLE}/255 — erwartet unter ${GRENZ_KLEIN_ANTEIL}; bei ${millimeterInPixel.toFixed(2)} px Verschiebung wäre ein größerer Wert ein falscher Maßstab`);

  // 3) Große Richtung: zwei deutlich verschiedene Posen ergeben deutlich
  //    verschiedene Streifen.
  const groesser = await pixelvergleich(basis.eintrag.data, gross.eintrag.data);
  assert.ok(groesser.sichtbarAnteil > GRENZ_GROSS_ANTEIL,
    `zwei deutlich verschiedene Posen ändern nur ${groesser.sichtbarAnteil.toFixed(4)} der Pixel — erwartet über ${GRENZ_GROSS_ANTEIL}; wäre der Wert klein, zeigt der Streifen Bewegung nicht`);

  // 4) Die Schärfe in beide Richtungen, als Verhältnis: der Faktor zwischen den
  //    beiden Fällen ist die eigentliche Aussage.
  const faktor = groesser.sichtbarAnteil / Math.max(kleiner.sichtbarAnteil, 1 / kleiner.gesamt);
  assert.ok(faktor > 8,
    `verschiedene Posen ändern nur ${faktor.toFixed(1)}-mal so viele Pixel wie ein 2-mm-Versatz `
    + `(${groesser.sichtbarAnteil.toFixed(4)} gegen ${kleiner.sichtbarAnteil.toFixed(4)}) — `
    + `unter 8 trennt der Streifen nicht zwischen Bewegung und Maßstabsfehler`);
});

test('Bild, WebGL-Pfad: die Figur steht als Mesh im Panel und die Szene bleibt unverändert', async () => {
  const profile = await gemessenesProfil();
  const steh = await stehPose();
  const fremd = await fremdePose();

  const mesh = await streifeInDerSeite({
    profile, frames: [steh], views: strip.ANSICHTEN, frameCount: 3, mitMesh: true,
  });
  assert.equal(mesh.eintrag.meshGezeichnet, true,
    `mit Szene muss das Mesh gezeichnet werden, meldet der Eintrag meshGezeichnet = ${mesh.eintrag.meshGezeichnet}`);
  assert.equal(mesh.eintrag.panels, strip.ANSICHTEN.length,
    `${mesh.eintrag.panels} Panels, erwartet ${strip.ANSICHTEN.length}`);
  assert.ok(mesh.eintrag.bytes <= strip.ANTWORT_BUDGET_BYTES,
    `Mesh-Streifen ist ${mesh.eintrag.bytes} Byte, Grenze ${strip.ANTWORT_BUDGET_BYTES}`);
  assert.match(mesh.eintrag.warnungen.join(' '), /Licht/,
    `eine Szene ohne Lichtquelle muss das melden, Warnungen waren: ${mesh.eintrag.warnungen.join(' | ') || 'keine'}`);

  // Die Menschenansicht zeigt dasselbe Modell: der Streifen darf die Szene nicht
  // in der letzten Panel-Pose zurücklassen.
  assert.equal(mesh.groesteVeranderung, 0,
    `nach dem Rendern weichen die Knochenpositionen der Szene um ${mesh.groesteVeranderung} m von vorher ab — dieRestore-Funktion stellt nicht wieder her`);

  // Gegenprobe: stellt bildeStreifen die Pose je Panel, müssen sich zwei
  // Mesh-Streifen verschiedener Posen deutlich unterscheiden. Bliebe das Mesh in
  // der Bind-Pose stehen, wäre der Unterschied 0 — genau der tote Fall.
  const meshFremd = await streifeInDerSeite({
    profile, frames: [fremd], views: strip.ANSICHTEN, frameCount: 3, mitMesh: true,
  });
  const unterschied = await pixelvergleich(mesh.eintrag.data, meshFremd.eintrag.data);
  assert.ok(unterschied.sichtbarAnteil > GRENZ_GROSS_ANTEIL,
    `zwei Mesh-Streifen verschiedener Posen unterscheiden sich in nur ${unterschied.sichtbarAnteil.toFixed(4)} `
    + `der Pixel (${unterschied.sichtbarPixel} von ${unterschied.gesamt}) — das Mesh wird nicht je Frame gestellt`);

  // Und: Kapseln ohne Szene und Mesh mit Szene sind verschiedene Bilder — die
  // Szene wird also tatsächlich gerastert und nicht nur an der Overlay-Ebene gemalt.
  const kapseln = await streifeInDerSeite({
    profile, frames: [steh], views: strip.ANSICHTEN, frameCount: 3,
  });
  const art = await pixelvergleich(kapseln.eintrag.data, mesh.eintrag.data);
  assert.ok(art.sichtbarAnteil > GRENZ_GROSS_ANTEIL,
    `Kapsel- und Mesh-Streifen derselben Pose unterscheiden sich in ${art.sichtbarAnteil.toFixed(4)} der Pixel — `
    + 'ein von beiden rendert nicht, was es vorgibt');
});

test('Anhang, Positivfall: der echte Streifen hängt an einem echten Bericht', async () => {
  const profile = await gemessenesProfil();
  const frames = [await stehPose(), await fremdePose()];
  const { page } = await seite();

  const eintraege = await page.evaluate(async (anfrage) => {
    const strip = await import(new URL('src/render/strip.js', document.baseURI).href);
    const port = strip.createStripRenderer({
      profile: anfrage.profile,
      frames: anfrage.frames,
      frameCount: anfrage.frames.length,
    });
    return port.streifen({ frames: [0, 1], views: ['side', 'front'] });
  }, { profile, frames });

  assert.equal(eintraege.length, 1,
    `genau EIN Bild mit beiden Ansichten (plan.md 6.8), es sind ${eintraege.length}`);
  const [bild] = eintraege;
  assert.ok(bild.bytes > strip.MIN_BILD_BYTES && bild.bytes <= strip.ANTWORT_BUDGET_BYTES,
    `Bildgröße ${bild.bytes} Byte hält nicht die Grenzen ${strip.MIN_BILD_BYTES} bis ${strip.ANTWORT_BUDGET_BYTES}`);

  const bericht = {
    frameCount: 2, phases: [{ state: 'kontakt', from: 0, to: 2 }],
    physics: { passed: true, issues: [] },
    intent: { passed: true, checks: [] },
    style: { passed: true, issues: [] },
    images: [],
  };
  strip.haengeStreifenAn(bericht, eintraege);
  assert.deepEqual(bericht.images, [{
    view: 'side+front', frames: [0, 1], ref: 'strip_side+front_0-1.png',
  }], `images nach dem Anhängen: ${JSON.stringify(bericht.images)}`);

  const befund = validateValidationReport(bericht);
  assert.equal(befund.ok, true,
    `Bericht mit echtem Streifen scheitert am eigenen Schema: ${JSON.stringify(befund.errors)}`);

  // Die Antwortform für den Agenten: Text und Bild in derselben Antwort.
  const anhang = [{ type: 'image', data: bild.data, mimeType: bild.mimeType }];
  assert.equal(anhang[0].data.length, bild.data.length,
    `Bildanhang verliert auf dem Weg in die Antwort ${bild.data.length - anhang[0].data.length} Zeichen`);
});

test('Lesbarkeit, beide Ränder: kein Etikett wird abgeschnitten — weder im Maximum noch in den Ausnahmefällen', async () => {
  const profile = await gemessenesProfil();
  const vorrat = await rahmenVorrat(strip.FRAMES_MAX);

  const faelle = [
    ['Maximum 12 Frames × 4 Ansichten', {
      profile, frames: vorrat, views: strip.ANSICHTEN, frameCount: strip.FRAMES_MAX,
    }, strip.PANELS_ZEIT_MAX, (e) => {
      // Die Zeitgrenze kürzt hier: 48 Panels (12 × 4) überschreiten gemessen
      // 2 s und das Bytebudget; geliefert werden PANELS_ZEIT_MAX Panels — die
      // ersten Frames in allen vier Ansichten. Die Kürzung muss laut im
      // Eintrag stehen (plan.md 5.5).
      assert.ok(e.bytes <= strip.ANTWORT_BUDGET_BYTES,
        `Maximum ausgeliefert mit ${e.bytes} Byte über der Grenze von ${strip.ANTWORT_BUDGET_BYTES}`);
      assert.equal(e.panels, strip.PANELS_ZEIT_MAX,
        `Zeitgrenze: ${e.panels} Panels, erwartet ${strip.PANELS_ZEIT_MAX}`);
      assert.match(e.warnungen.join(' '), /Zeitgrenze/,
        `die Kürzung muss als Warnung mit Zahl stehen, warnungen waren: ${e.warnungen.join(' | ') || 'keine'}`);
    }],
    ['Flugphase, 0 Kontaktpunkte', {
      profile, frames: [await flugPose()], views: strip.ANSICHTEN, frameCount: 1,
    }, strip.ANSICHTEN.length, (e, texte) => {
      assert.ok(texte.some((t) => /^kein Bodenkontakt /.test(t)),
        `der Flugfall muss „kein Bodenkontakt" zeigen, Etiketten waren: ${texte.slice(0, 12).join(' | ')}`);
    }],
    ['Sohlen ohne Gelenkausrichtung', {
      profile, frames: [await ohneAusrichtungPose()], views: strip.ANSICHTEN, frameCount: 1,
    }, strip.ANSICHTEN.length, (e, texte) => {
      assert.ok(texte.some((t) => /ohne Ausrichtung/.test(t)),
        `der Ausnahmefall muss seine Behelfsstellung zeigen, Etiketten waren: ${texte.slice(0, 12).join(' | ')}`);
    }],
  ];

  const bo = [];
  for (const [name, anfrage, panelsErwartet, nachweis] of faelle) {
    const { eintrag, ueberlauf, texte } = await streifeInDerSeite(anfrage);
    assert.equal(eintrag.panels, panelsErwartet,
      `${name}: ${eintrag.panels} Panels, erwartet ${panelsErwartet}`);
    try { nachweis(eintrag, texte); } catch (err) { bo.push(`${name}: ${err.message}`); }
    for (const u of ueberlauf) {
      bo.push(`${name} ${u.ansicht}/Frame ${u.frame}: „${u.text}“ läuft ${u.ueber} ${u.pixel} px `
        + `über die Panelkante (${u.feld} in ${u.panel})`);
    }
  }
  assert.deepEqual(bo, [], `${bo.length} Beschriftungen abgeschnitten oder Nachweis fehlgeschlagen:\n  `
    + bo.slice(0, 8).join('\n  '));

  // Gegenprobe der Messung: derselbe Plan auf derselben ausgelieferten Stufe,
  // nur mit der Schrift UNVERKLEINERT — genau der Zustand, in dem 48 Etiketten
  // über ihre Panelkante liefen. Meldet die Messung auch dann 0 Überläufe, misst
  // sie nichts und der Positivfall oben bewiese nichts.
  const { page } = await seite();
  const stufe = strip.SKALA_STUFEN[1];
  const gegenprobe = await page.evaluate(async (p) => {
    const s = await import(new URL('src/render/strip.js', document.baseURI).href);
    const plan = s.planeStreifen({
      profile: p.profile, frames: p.frames, views: ['front'], frameCount: 1, skala: p.stufe,
    });
    const ctx = document.createElement('canvas').getContext('2d');
    let n = 0;
    let groester = 0;
    for (const pan of plan.panels) {
      const texte = [].concat(...Object.values(pan.annotationen)).concat(pan.beschriftung)
        .filter((pr) => pr.art === 'text');
      for (const pr of texte) {
        ctx.font = `${pr.groesse / p.faktor}px ui-monospace, Consolas, monospace`;
        const b = ctx.measureText(pr.text).width;
        const li = pr.anker === 'rechts' ? pr.x - b : (pr.anker === 'mitte' ? pr.x - b / 2 : pr.x);
        const ueber = Math.max(pan.x - li, (li + b) - (pan.x + pan.breite));
        if (ueber > 1) { n++; groester = Math.max(groester, Math.round(ueber)); }
      }
    }
    return { n, groester, breite: plan.panels[0].breite };
  }, { profile, frames: [await stehPose()], stufe, faktor: (Math.round(strip.PANEL_BREITE_PX * stufe)) / strip.PANEL_BREITE_PX });
  assert.ok(gegenprobe.n > 0,
    `die Überlaufmessung greift nicht: mit unveränderter Schrift auf ${gegenprobe.breite} px breiten `
    + `Panels (${stufe} Stufe) werden ${gegenprobe.n} Etiketten als überlaufend gemeldet, größter `
    + `Überstand ${gegenprobe.groester} px — bei 0 wäre der Positivfall oben wertlos`);
});
