// AP9 — Abnahmetest für das Einzelbild (`look`), src/render/strip.js.
//
// Runder: node --test "src/**/*.test.mjs" — diese Datei liegt neben dem Code.
//
// Befund vom 2. September 2026 (docs/buehne-befunde-2026-09-02.md, Kapitel 1.1
// bis 1.5): `look` lieferte nie ein Bild, sondern ein Raster aus Frames × An-
// sichten, dessen Auflösung sank, je mehr der Agent sehen wollte — bis auf
// 4 px Schrift. Eine Kamera hatte er nicht: vier feste Ansichten, kein Zoom,
// kein Ziel. Was hier geprüft wird, ist die Gegenrichtung:
//
//   Ein Bild   — ein Aufruf zeigt EINEN Frame in voller Panelgröße.
//   Kamera     — Richtung, Höhe, Ziel und Weite kommen vom Aufrufer.
//   Vergleich  — derselbe Kameraauftrag ergibt über Frames hinweg denselben
//                Maßstab; sonst ist eine Abfolge aus Einzelaufrufen wertlos.
//   Etiketten  — die Zeilen im Fußblock stehen untereinander, nicht aufeinander
//                (Kapitel 1.3: strip.js schrieb zwei Etiketten auf dieselbe Zeile).
//
// Körpermaße (AGENTS.md, Regel 1): das Profil wird an Xbot.glb gemessen. Die
// einzigen Zahlen hier sind Verfahrensgrenzen und nennen ihren Bezug.

import { test } from 'node:test';
import assert from 'node:assert';

import * as strip from './strip.js';
import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { xbotProfil } from '../rig/xbot-profil.mjs';

/** Toleranz beim Vergleich zweier Richtungsvektoren: 1e-9 liegt weit unter
 *  jedem Rundungsfehler der Winkelrechnung und weit über der Auslöschung. */
const RICHTUNG_TOLERANZ = 1e-9;

/** Toleranz in Pixeln, mit der ein Zielpunkt in der Panelmitte liegen muss.
 *  Ein halber Pixel: darunter ist die Mitte nicht mehr darstellbar. */
const MITTE_TOLERANZ_PX = 0.5;

// Profil aus dem geteilten Cache (src/rig/xbot-profil.mjs): einmal gemessen,
// prozessuebergreifend geteilt, jeder Aufrufer bekommt eine eigene Kopie.
function gemessenesProfil() {
  return xbotProfil({ fileName: 'Xbot.glb' });
}

/** Ein Frame aus dem geladenen Modell, wahlweise starr versetzt. */
async function pose(index = 0, versatzMeter = null) {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  gltf.scene.updateMatrixWorld(true);
  const frame = strip.frameAusScene(gltf.scene, { frame: index });
  if (versatzMeter) {
    for (const id of Object.keys(frame.positions)) {
      frame.positions[id] = frame.positions[id].map((x, a) => x + versatzMeter[a]);
      frame.bones[id].position = frame.bones[id].position.map((x, a) => x + versatzMeter[a]);
    }
  }
  return frame;
}

/** Plant ein Einzelbild mit den Voreinstellungen, die der Aufrufer nicht nennt. */
async function planeBild(kamera = {}, frame = null) {
  const profile = await gemessenesProfil();
  const f = frame ?? await pose(0);
  return strip.planeStreifen({ profile, frames: [f], kamera });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 1 — Ein Bild, volle Größe
// ─────────────────────────────────────────────────────────────────────────────

test('Einzelbild: ein Aufruf ergibt genau ein Panel in voller Größe', async () => {
  const plan = await planeBild();

  assert.strictEqual(plan.panels.length, 1,
    `${plan.panels.length} Panels geplant, erwartet genau 1 — ein Aufruf ist ein Bild`);
  assert.strictEqual(plan.panel.breite, strip.BILD_BREITE_PX);
  assert.strictEqual(plan.panel.hoehe, strip.BILD_HOEHE_PX);
  assert.ok(strip.BILD_BREITE_PX >= 2 * strip.PANEL_BREITE_PX,
    `Einzelbild ${strip.BILD_BREITE_PX} px breit, Rasterpanel ${strip.PANEL_BREITE_PX} px — `
    + 'das Einzelbild muss deutlich größer sein, sonst ist nichts gewonnen');
});

test('Einzelbild, Negativfall: zwei Frames in einem Bild werden mit Zahl abgelehnt', async () => {
  const profile = await gemessenesProfil();
  const frames = [await pose(0), await pose(1)];

  assert.throws(
    () => strip.planeStreifen({ profile, frames, kamera: {} }),
    (e) => /2/.test(e.message) && /Frame/i.test(e.message),
    'zwei Frames im Einzelbild müssen mit der Zahl 2 abgelehnt werden');
});

test('Einzelbild: die Schrift wächst mit dem Panel, statt gleich klein zu bleiben', async () => {
  const gross = await planeBild();
  const profile = await gemessenesProfil();
  const raster = strip.planeStreifen({ profile, frames: [await pose(0)], views: ['front'] });

  const kleinste = (plan) => Math.min(...plan.panels.flatMap((pan) =>
    [...Object.values(pan.annotationen), pan.beschriftung].flat()
      .filter((p) => p.art === 'text').map((p) => p.groesse)));

  assert.ok(kleinste(gross) > kleinste(raster),
    `Einzelbild schreibt mit ${kleinste(gross)} px, das Raster mit ${kleinste(raster)} px — `
    + 'im größeren Bild muss die Schrift mitwachsen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 2 — Die Kamera gehört dem Aufrufer
// ─────────────────────────────────────────────────────────────────────────────

test('Richtung: 0° blickt von vorn, 90° von links, 180° von hinten', async () => {
  const profile = await gemessenesProfil();
  const system = strip.charakterSystem(profile);
  const nah = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < RICHTUNG_TOLERANZ);

  const vorn = strip.kamerabasisAusWinkel(system, 0, 0);
  const links = strip.kamerabasisAusWinkel(system, 90, 0);
  const hinten = strip.kamerabasisAusWinkel(system, 180, 0);

  assert.ok(nah(vorn.blick, system.F.map((x) => -x)),
    `0° blickt ${JSON.stringify(vorn.blick)}, erwartet entgegen forward ${JSON.stringify(system.F)}`);
  assert.ok(nah(links.blick, system.L.map((x) => -x)),
    `90° blickt ${JSON.stringify(links.blick)}, erwartet entgegen left ${JSON.stringify(system.L)}`);
  assert.ok(nah(hinten.blick, system.F),
    `180° blickt ${JSON.stringify(hinten.blick)}, erwartet in Richtung forward`);
});

test('Höhe: 90° blickt senkrecht von oben, vorn zeigt nach oben im Bild', async () => {
  const profile = await gemessenesProfil();
  const system = strip.charakterSystem(profile);
  const oben = strip.kamerabasisAusWinkel(system, 0, 90);

  assert.ok(oben.blick.every((x, i) => Math.abs(x - (-system.U[i])) < RICHTUNG_TOLERANZ),
    `hoehe 90° blickt ${JSON.stringify(oben.blick)}, erwartet entgegen up ${JSON.stringify(system.U)}`);
  assert.ok(oben.Y.every((x, i) => Math.abs(x - system.F[i]) < RICHTUNG_TOLERANZ),
    `bei Draufsicht zeigt die Bildhochachse ${JSON.stringify(oben.Y)}, erwartet forward `
    + `${JSON.stringify(system.F)} — sonst weiß der Betrachter nicht, wo vorn ist`);
});

test('Weite: ganz, halb und nah zeigen gemessene Anteile der Körperhöhe', async () => {
  const profile = await gemessenesProfil();
  const hoehe = profile.world.height;

  for (const weite of Object.keys(strip.WEITE_ANTEILE)) {
    const plan = await planeBild({ weite });
    const erwartet = strip.WEITE_ANTEILE[weite] * hoehe;
    assert.ok(Math.abs(plan.massstab.sichtHoeheMeter - erwartet) < 0.01,
      `weite "${weite}" zeigt ${plan.massstab.sichtHoeheMeter} m, erwartet `
      + `${erwartet.toFixed(4)} m (${strip.WEITE_ANTEILE[weite]} × ${hoehe.toFixed(4)} m Körperhöhe)`);
  }

  const ganz = await planeBild({ weite: 'ganz' });
  const nah = await planeBild({ weite: 'nah' });
  assert.ok(nah.massstab.pxProMeter > 3 * ganz.massstab.pxProMeter,
    `nah zeigt ${nah.massstab.pxProMeter} px/m, ganz ${ganz.massstab.pxProMeter} px/m — `
    + 'nah muss ein Vielfaches auflösen, sonst ist es kein Heranfahren');
});

test('Ziel: ein benanntes Körperteil rückt in die Bildmitte', async () => {
  const profile = await gemessenesProfil();
  const frame = await pose(0);
  const plan = strip.planeStreifen({
    profile, frames: [frame], kamera: { ziel: 'foot_l', weite: 'nah' },
  });

  const pan = plan.panels[0];
  const bone = profile.roles.foot_l.bone;
  const welt = frame.positions[bone];
  assert.ok(Array.isArray(welt), `foot_l zeigt auf Knochen "${bone}", der im Frame keine Position hat`);

  const px = strip.projiziere(pan, welt);
  const mitte = [pan.x + pan.breite / 2, pan.y + pan.hoehe / 2];
  assert.ok(Math.hypot(px[0] - mitte[0], px[1] - mitte[1]) < MITTE_TOLERANZ_PX,
    `foot_l landet bei ${px.map((x) => x.toFixed(2))}, Panelmitte ist ${mitte} — `
    + `Abstand ${Math.hypot(px[0] - mitte[0], px[1] - mitte[1]).toFixed(2)} px`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 3 — Eine Abfolge aus Einzelaufrufen bleibt vergleichbar
// ─────────────────────────────────────────────────────────────────────────────

test('Abfolge: derselbe Kameraauftrag ergibt über Frames hinweg denselben Maßstab', async () => {
  const profile = await gemessenesProfil();
  const kamera = { richtung_grad: 90, weite: 'ganz' };

  const a = strip.planeStreifen({ profile, frames: [await pose(0)], kamera });
  const b = strip.planeStreifen({
    profile, frames: [await pose(1, [0.9, 0, 1.4])], kamera,
  });

  // Der Maßstab hängt allein an Weite und gemessener Körperhöhe — NICHT an dem,
  // was der einzelne Frame gerade an Fläche einnimmt. Das ist der Unterschied
  // zum Rasterstreifen, der über den Bewegungsbereich rahmt und damit bei jedem
  // Aufruf einen anderen Maßstab liefern kann.
  const erwartet = strip.BILD_HOEHE_PX / (strip.WEITE_ANTEILE.ganz * profile.world.height);
  for (const [name, plan] of [['Frame 0', a], ['Frame 1, 1,65 m versetzt', b]]) {
    assert.ok(Math.abs(plan.massstab.pxProMeter - erwartet) < 0.01,
      `${name} zeigt ${plan.massstab.pxProMeter} px/m, erwartet ${erwartet.toFixed(4)} px/m `
      + `(${strip.BILD_HOEHE_PX} px / (${strip.WEITE_ANTEILE.ganz} × `
      + `${profile.world.height.toFixed(4)} m)) — sonst sind zwei Aufrufe nicht vergleichbar`);
  }
  assert.strictEqual(a.massstab.schrittMeter, b.massstab.schrittMeter,
    'auch die Gitterteilung muss gleich bleiben');
});

test('Abfolge: die weit versetzte Figur bleibt im Bild', async () => {
  const profile = await gemessenesProfil();
  const versatz = [0.9, 0, 1.4];
  const frame = await pose(1, versatz);
  const plan = strip.planeStreifen({ profile, frames: [frame], kamera: { weite: 'ganz' } });
  const pan = plan.panels[0];

  const draussen = Object.values(frame.positions).filter((p) => {
    const px = strip.projiziere(pan, p);
    return px[0] < pan.x || px[0] > pan.x + pan.breite
      || px[1] < pan.y || px[1] > pan.y + pan.hoehe;
  }).length;

  assert.strictEqual(draussen, 0,
    `${draussen} von ${Object.keys(frame.positions).length} Knochen liegen außerhalb des `
    + 'Panels — bei weite "ganz" gehört die ganze Figur ins Bild');
});

test('Abfolge: die Antwort nennt die benutzte Kamera in Zahlen', async () => {
  const plan = await planeBild({ richtung_grad: 45, hoehe_grad: 20, weite: 'halb' });

  assert.strictEqual(plan.kamera.richtungGrad, 45);
  assert.strictEqual(plan.kamera.hoeheGrad, 20);
  assert.strictEqual(plan.kamera.weite, 'halb');
  assert.strictEqual(plan.kamera.ziel, 'figur');
  assert.ok(Array.isArray(plan.kamera.zielWelt) && plan.kamera.zielWelt.length === 3,
    `zielWelt = ${JSON.stringify(plan.kamera.zielWelt)}: ohne Weltkoordinaten kann der `
    + 'Aufrufer zwei Bilder nicht zueinander in Beziehung setzen');
  assert.ok(typeof plan.kamera.sag === 'string' && plan.kamera.sag.length > 0,
    'die Kamera muss in Worten sagen, wovon sie blickt');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reihe 4 — Der Fußblock (Kapitel 1.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Mittlere Zeichenbreite als Anteil der Schriftgröße. Die Planebene kennt keine
 *  Font-Metriken (die gibt es erst im Browser); 0,55 ist die Näherung, mit der
 *  strip.js selbst schon rechnet (ETIKETT_HALB_PX). */
const ZEICHEN_BREITE_ANTEIL = 0.55;

/** Das Rechteck, das ein Textprimitiv im Panel belegt. */
function textKasten(p) {
  const breite = p.text.length * p.groesse * ZEICHEN_BREITE_ANTEIL;
  const links = p.anker === 'rechts' ? p.x - breite
    : p.anker === 'mitte' ? p.x - breite / 2 : p.x;
  return { links, rechts: links + breite, oben: p.y - p.groesse, unten: p.y };
}

/**
 * Textpaare am unteren Panelrand, deren Kästen sich überschneiden.
 *
 * Geprüft werden nur Etiketten mit `kante: true` — die, die an der Panelkante
 * hängen und deren Platz das Layout vergibt (Fußblock, Maßstabsleiste,
 * Maßstabskasten). Etiketten, die an einem Weltpunkt kleben (Sohlennamen,
 * Achsenkreuz), sind hier nicht gemeint: die stehen dort, wo der Körper steht.
 */
function ueberdruck(pan) {
  const texte = [...Object.values(pan.annotationen), pan.beschriftung].flat()
    .filter((p) => p.art === 'text' && p.kante === true);
  const treffer = [];
  for (let i = 0; i < texte.length; i++) {
    for (let j = i + 1; j < texte.length; j++) {
      const a = textKasten(texte[i]);
      const b = textKasten(texte[j]);
      if (a.links < b.rechts && b.links < a.rechts && a.oben < b.unten && b.oben < a.unten) {
        treffer.push(`"${texte[i].text}" (y ${texte[i].y.toFixed(0)}) über `
          + `"${texte[j].text}" (y ${texte[j].y.toFixed(0)})`);
      }
    }
  }
  return treffer;
}

test('Etiketten: die Kantenetiketten überdrucken sich nicht', async () => {
  const plan = await planeBild();
  const pan = plan.panels[0];
  const kanten = [...Object.values(pan.annotationen), pan.beschriftung].flat()
    .filter((p) => p.art === 'text' && p.kante === true);

  assert.ok(kanten.length >= 4,
    `${kanten.length} Kantenetiketten gefunden, erwartet mindestens 4 (Stützfläche, Kontakt, `
    + 'Schwerpunkt, Maßstabskasten) — ohne Markierung prüft dieser Test nichts');

  const treffer = ueberdruck(pan);
  assert.deepStrictEqual(treffer, [],
    `${treffer.length} von ${kanten.length} Kantenetiketten überschneiden sich: ${treffer.join(' | ')}`);
});

test('Etiketten: auch im Rasterstreifen überdrucken sich die Kantenetiketten nicht', async () => {
  const profile = await gemessenesProfil();
  const plan = strip.planeStreifen({
    profile, frames: [await pose(0), await pose(1)], views: ['front', 'side'],
  });

  const schlecht = plan.panels
    .map((pan) => ({ pan, treffer: ueberdruck(pan) }))
    .filter((x) => x.treffer.length > 0);

  assert.strictEqual(schlecht.length, 0,
    `${schlecht.length} von ${plan.panels.length} Panels überdrucken unten Text — `
    + schlecht.map((x) => `${x.pan.ansicht}/Frame ${x.pan.frame}: ${x.treffer.join(', ')}`).join(' | '));
});

test('Ziel: jedes GELENK aus describe_rig ist anfahrbar, nicht nur die drei Rollen', async () => {
  const profile = await gemessenesProfil();
  const frame = await pose(0);
  // Der Belegbildlauf vom 2.9.2026 fiel hier durch: `roles` trägt nur die drei
  // Pflichtrollen (pelvis, foot_l, foot_r). Ein Ziel, das nur Rollen kennt,
  // kann „zeig mir das linke Knie groß" nicht beantworten — die Gelenknamen
  // sind aber genau die, mit denen der Agent die Pose gesetzt hat.
  const gelenke = Object.keys(profile.joints);
  assert.ok(gelenke.length > Object.keys(profile.roles).length,
    `${gelenke.length} Gelenke gegen ${Object.keys(profile.roles).length} Rollen — `
    + 'ohne diesen Unterschied prüft der Test nichts');

  const unerreichbar = gelenke.filter((name) => {
    try {
      strip.planeStreifen({ profile, frames: [frame], kamera: { ziel: name, weite: 'nah' } });
      return false;
    } catch { return true; }
  });

  assert.deepEqual(unerreichbar, [],
    `${unerreichbar.length} von ${gelenke.length} Gelenken lassen sich nicht anfahren: `
    + unerreichbar.join(', '));
});

test('Ziel, Negativfall: die Meldung nennt Gelenke UND Rollen', async () => {
  const profile = await gemessenesProfil();
  const frames = [await pose(0)];

  assert.throws(
    () => strip.planeStreifen({ profile, frames, kamera: { ziel: 'ellenbogen_links' } }),
    (e) => e.message.includes('knee_l') && e.message.includes('foot_l')
      && e.message.includes(String(Object.keys(profile.joints).length)),
    'die Meldung muss beide Namensmengen mit Zahl anbieten — der Agent soll nicht raten');
});
