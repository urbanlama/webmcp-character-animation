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
 *  größte Kanalabstand über dieser Schwelle liegt. 16 von 255 ≈ 6 %:Knapp
 *  darüber liegt jede Kantenverschiebung, die man auf dem Bild tatsächlich als
 *  andere Linie erkennt; darunter liegt das Antialiasing einer um Bruchteile
 *  eines Pixels verschobenen Linie. */
const SICHTBAR_SCHWELLE = 16;

/** Obergrenze für den sichtbar anderen Pixelanteil einer um 2 mm verschobenen
 *  Pose. Bezug: 2 mm sind bei dem an Xbot gemessenen Maßstab (168 px/m) ein
 *  Drittel eines Pixels — unsichtbar. 1 % der Bildpunkte ist das Zehnfache des
 *  Effekts, den eine subpixelige Verschiebung auf dünnen Strichen hinterlässt. */
const GRENZ_KLEIN_ANTEIL = 0.01;

/** Untergrenze für den sichtbar anderen Pixelanteil zweier deutlich
 *  verschiedener Posen. Bezug: die Gliedmaßen wandern hier um ≥ 20 cm = ≥ 34 px,
 *  ein Bruchteil der Figur reicht, um weit über 10 % der Bildpunkte zu ändern. */
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

  const inPixel = plane.map((p) => p.massstab.koerperHoeheMeter * p.massstab.pxProMeter);
  const erwartete = strip.PANEL_HOEHE_PX / strip.SICHT_HOEHE_FAKTOR;
  for (const [i, werte] of inPixel.entries()) {
    assert.ok(Math.abs(werte - erwartete) / erwartete < 0.005,
      `Figur ${i + 1} füllt ${werte.toFixed(2)} px von ${erwartete.toFixed(2)} px erwarteter Panelhöhe — die Körperhöhe wird nicht gemessen`);
  }
  assert.ok(Math.abs(inPixel[0] - inPixel[1]) / inPixel[0] < 0.01,
    `0,60 m und 2,40 m belegen ${inPixel[0].toFixed(2)} px gegen ${inPixel[1].toFixed(2)} px — dieselbe Proportion ist der Zweck des gemessenen Maßstabs`);

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
  // world.height steuert den Maßstab — wer sie rät, rahmt die Figur falsch, ohne
  // dass eine Zahl im Bericht steht, die das verrät. Geprüft wird deshalb die
  // Bildgeometrie selbst. Gewählt wird das Doppelte: halb so viele Pixel pro Meter,
  // die Figur schrumpft im Bild, während Skelett und Sohlen unangetastet bleiben.
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
  assert.ok(Math.abs(versetzt.massstab.pxProMeter * 2 - echt.massstab.pxProMeter)
    / echt.massstab.pxProMeter < 0.02,
    `bei doppelt getippter Höhe ${versetzt.massstab.pxProMeter.toFixed(1)} px/m gegen gemessene ${echt.massstab.pxProMeter.toFixed(1)} px/m: world.height steuert den Maßstab nicht — der Wert wäre ein Festwert`);
  assert.ok(figuerHoeheInPixel(versetzt) < 0.55 * figuerHoeheInPixel(echt),
    `die Figur füllt bei getippter Höhe ${figuerHoeheInPixel(versetzt).toFixed(0)} px gegen ${figuerHoeheInPixel(echt).toFixed(0)} px — der Tippfehler wäre im Bild nicht zu sehen`);
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
      frameCount: anfrage.frames.length,
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

    const plan = strip.planeStreifen(opts);
    const voll = strip.pruefeVollstaendigkeit(plan);

    // Beschriftungen mit denselben Font-Metriken messen, mit denen sie
    // gezeichnet werden: ctx.measureText, nicht eine Breite pro Zeichen.
    const messLeinwand = document.createElement('canvas');
    const mess = messLeinwand.getContext('2d');
    const ueberlauf = [];
    for (const pan of plan.panels) {
      const texte = []
        .concat(...Object.values(pan.annotationen))
        .concat(pan.koerper, pan.beschriftung)
        .filter((pr) => pr.art === 'text');
      for (const pr of texte) {
        mess.font = `${pr.groesse}px ui-monospace, Consolas, monospace`;
        const b = mess.measureText(pr.text).width;
        const li = pr.anker === 'rechts' ? pr.x - b
          : (pr.anker === 'mitte' ? pr.x - b / 2 : pr.x);
        const links = li - (pan.x + 1);
        const rechts = (pan.x + pan.breite - 1) - (li + b);
        if (links > 0 || rechts > 0) {
          ueberlauf.push({
            ansicht: pan.ansicht, frame: pan.frame, text: pr.text,
            pixel: Math.round(Math.max(links, rechts)),
            ueber: links > 0 ? 'links' : 'rechts',
            feld: `${Math.round(li)}..${Math.round(li + b)} px`,
            panel: `${pan.x}..${pan.x + pan.breite} px`,
          });
        }
      }
    }

    const eintrag = strip.bildeStreifen(opts);
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
    return { eintrag, voll, ueberlauf, groesteVeranderung, planZusammenfassung: {
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
  return page.evaluate(async ([base64A, base64B]) => {
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

    const schwelle = 16;
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
  }, [a, b]);
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
