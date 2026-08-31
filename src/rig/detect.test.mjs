// AP3 — Abnahmetest zur Rig-Erkennung (`detect.js`).
//
// Getestet wird die Rollenvergabe auf fremden Rigs nach docs/plan.md 5.1:
//
//   sicher ab 0,9 · zwischen 0,5 und 0,9 wird der Mensch gefragt ·
//   darunter keine Rolle, die Kette bleibt ohne semantische Rolle nutzbar.
//
// Die Vergleichsrollen in ERWARTET stehen da, weil ein Test eine Referenz
// braucht — die Erkennung selbst liest keine Knochennamen. Der Robustheitstest
// ersetzt sie deshalb alle durch `bone_000…`; würden Namen gelesen, fiele er
// durch.
//
// Modelltrennung (verbindlich, Auftrag AP3):
//   Entwicklung  Xbot, CesiumMan, Michelle, RiggedFigure, Soldier, BrainStem
//   Abnahme      Kenney_Ooli, character-oobi/oodi/oopi/oozi
//
// Zwei Vorbemerkungen zu den Hilfen unten:
//
// 1. Node kann keine eingebetteten Bilder entschlüsseln — three.js' GLTFLoader
//    ruft in `loadImageSource` `self.URL` auf, und `self` gibt es in Node
//    nicht (BRETT-Wert: „self is not defined“). Für die Erkennung sind
//    ausschließlich Vertices, Gewichte und Gelenkpositionen maßgeblich, kein
//    Pixel. Die Textilverweise fallen deshalb vor dem Parsen aus dem JSON-Chunk.
// 2. Alle Körpermaße werden gemessen. Dieser Test setzt nirgends eine
//    Körpergröße, einen Radius oder eine Höhe in Meter — verglichen wird nur
//    die Zuordnung Rolle → Knochen und ihre Konfidenz.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as THREE from 'three';
import { loadGLB } from '../scene/load.js';
import { REPO_ROOT, glbZerlegen, glbBauen } from '../scene/testdaten.mjs';
import { detectRig, RigAbweisung, PARAMS, ROLLEN, PFLICHTROLLEN } from './detect.js';

// ─────────────────────────────────────────────────────────────────────────────
// Datenzugriff
// ─────────────────────────────────────────────────────────────────────────────

const ENTWICKLUNG = {
  Xbot: join(REPO_ROOT, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb'),
  CesiumMan: join(REPO_ROOT, 'models', 'fremde', 'CesiumMan.glb'),
  Michelle: join(REPO_ROOT, 'models', 'fremde', 'Michelle.glb'),
  RiggedFigure: join(REPO_ROOT, 'models', 'fremde', 'RiggedFigure.glb'),
  Soldier: join(REPO_ROOT, 'models', 'fremde', 'Soldier.glb'),
  BrainStem: join(REPO_ROOT, 'models', 'fremde', 'BrainStem.glb'),
};

const ABNAHME = ['Kenney_Ooli', 'character-oobi', 'character-oodi', 'character-oopi', 'character-oozi']
  .map((n) => ({ name: n, pfad: join(REPO_ROOT, 'models', 'fremde', n + '.glb') }));

/**
 * Entfernt alle Textilverweise aus einem GLB. Nur die Materialverweise —
 * Geometrie, Skin, Gewichte und Gelenke bleiben unangetastet.
 * @param {Buffer} puffern
 * @returns {Buffer}
 */
function ohneTexturen(puffern) {
  const { json, bin } = glbZerlegen(puffern);
  const streichen = (o) => {
    for (const schluessel of Object.keys(o)) {
      if (/Texture$/i.test(schluessel)) delete o[schluessel];
    }
  };
  for (const material of json.materials || []) {
    streichen(material);
    if (material.pbrMetallicRoughness) streichen(material.pbrMetallicRoughness);
    for (const erweiterung of Object.values(material.extensions || {})) streichen(erweiterung);
  }
  return glbBauen(json, bin);
}

const pufferCache = new Map();

/** Lädt ein Modell (in Bind-Pose) durch denselben Loader wie die Anwendung. */
async function modell(pfad) {
  if (!pufferCache.has(pfad)) pufferCache.set(pfad, ohneTexturen(readFileSync(pfad)));
  const puff = pufferCache.get(pfad);
  return loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
}

const xbot = () => modell(ENTWICKLUNG.Xbot);

// ─────────────────────────────────────────────────────────────────────────────
// Referenz Zuordnung — nach Knochennamen, nur fuer diesen Test
// ─────────────────────────────────────────────────────────────────────────────

/** Die drei Vertragspflichtrollen je Entwicklungsmodell. */
const PFLICHT_ERWARTET = {
  CesiumMan: { pelvis: 'Skeleton_torso_joint_1', foot_l: 'leg_joint_L_3', foot_r: 'leg_joint_R_3' },
  Michelle: { pelvis: 'mixamorig:Hips', foot_l: 'mixamorig:LeftFoot', foot_r: 'mixamorig:RightFoot' },
  RiggedFigure: { pelvis: 'torso_joint_1', foot_l: 'leg_joint_L_3', foot_r: 'leg_joint_R_3' },
  Soldier: { pelvis: 'mixamorig:Hips', foot_l: 'mixamorig:LeftFoot', foot_r: 'mixamorig:RightFoot' },
};

/** Vollstaendige Referenz an Xbot — das Referenzmodell des Projekts. */
const XBOT_ERWARTET = {
  pelvis: 'mixamorigHips',
  thigh_l: 'mixamorigLeftUpLeg', thigh_r: 'mixamorigRightUpLeg',
  shin_l: 'mixamorigLeftLeg', shin_r: 'mixamorigRightLeg',
  foot_l: 'mixamorigLeftFoot', foot_r: 'mixamorigRightFoot',
  toe_l: 'mixamorigLeftToeBase', toe_r: 'mixamorigRightToeBase',
  spine: 'mixamorigSpine', chest: 'mixamorigSpine2', neck: 'mixamorigNeck', head: 'mixamorigHead',
  shoulder_l: 'mixamorigLeftShoulder', shoulder_r: 'mixamorigRightShoulder',
  arm_l: 'mixamorigLeftArm', arm_r: 'mixamorigRightArm',
  forearm_l: 'mixamorigLeftForeArm', forearm_r: 'mixamorigRightForeArm',
  hand_l: 'mixamorigLeftHand', hand_r: 'mixamorigRightHand',
};

/** Das Skelett der Kenney-Familie: ein Knochen je Beinglied, ohne Handgelenk. */
const KENNEY_ERWARTET = {
  pelvis: 'root',
  thigh_l: 'leg-left', thigh_r: 'leg-right',
  foot_l: 'leg-left', foot_r: 'leg-right',
  arm_l: 'arm-left', arm_r: 'arm-right',
};

// ─────────────────────────────────────────────────────────────────────────────
// Prüf-Helfer
// ─────────────────────────────────────────────────────────────────────────────

function rollenPaare(bericht) {
  return Object.entries(bericht.roles).map(([rolle, eintrag]) => [rolle, eintrag.bone]);
}

/** Vergleicht die getroffenen Rollen gegen die Referenz — nur die geprueften. */
function fehlendeZuordnungen(bericht, erwartet) {
  const fehlt = [];
  for (const [rolle, knochen] of Object.entries(erwartet)) {
    const erhalten = bericht.roles[rolle];
    if (!erhalten) fehlt.push(`${rolle}: erwartet „${knochen}“, keine Rolle vergeben`);
    else if (erhalten.bone !== knochen) fehlt.push(`${rolle}: erwartet „${knochen}“, erhalten „${erhalten.bone}“`);
  }
  return fehlt;
}

/**
 * Der Kern der Konfidenzregel aus plan.md 5.1, geprueft an jedem Bericht:
 * unter 0,5 keine Rolle, ab 0,9 sicher, dazwischen eine Rückfrage.
 */
function pruefeKonfidenzordnung(bericht) {
  const probleme = [];
  const erfragt = new Set(bericht.questions.filter((q) => q.rolle).map((q) => q.rolle));
  for (const [rolle, eintrag] of Object.entries(bericht.roles)) {
    if (!(eintrag.confidence >= PARAMS.fragenAb)) {
      probleme.push(`${rolle}: Konfidenz ${eintrag.confidence} unter der Frageschwelle ${PARAMS.fragenAb} — Rolle haette entfallen mussen`);
    } else if (eintrag.confidence >= PARAMS.sicherAb) {
      if (erfragt.has(rolle)) probleme.push(`${rolle}: Konfidenz ${eintrag.confidence} ist sicher, wird aber zurueckgefragt`);
    } else if (!erfragt.has(rolle)) {
      probleme.push(`${rolle}: Konfidenz ${eintrag.confidence} liegt in der Fragezone ${PARAMS.fragenAb}…${PARAMS.sicherAb}, aber keine Rueckfrage gestellt`);
    }
  }
  return probleme;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stufe 1: Grundfall und Ablehnung
// ─────────────────────────────────────────────────────────────────────────────

test('Grundfall: Xbot bekommt seine Rollen auf den richtigen Knochen', async () => {
  const bericht = detectRig(await xbot(), { file: 'Xbot.glb' });

  assert.deepEqual(fehlendeZuordnungen(bericht, XBOT_ERWARTET), [],
    `Rollenvergabe weicht von der Referenz ab (${bericht.source.boneCount} Knochen, ${bericht.source.vertexCount} Vertices gemessen)`);
  assert.deepEqual(pruefeKonfidenzordnung(bericht), [], 'Konfidenzordnung nach plan.md 5.1 verletzt');
  assert.equal(bericht.world.up, '+y',
    `Aufwaertsachse wird gemessen, gemeldet „${bericht.world.up}“`);
  assert.ok(bericht.world.height > 1,
    `gemessene Körperhöhe ${bericht.world.height} m, erwartet über 1 m bei einer erwachsenen Figur`);
  assert.ok(bericht.roles.pelvis.confidence >= PARAMS.sicherAb,
    `Becken muss sicher sitzen, Konfidenz ${bericht.roles.pelvis.confidence}`);
});

test('Ablehnung: ein Modell ohne zwei Beine wird abgelehnt, nicht als Mensch behandelt', async () => {
  const gltf = await xbot();
  // Das rechte Bein wird nicht umbenannt oder versteckt, sondern seine
  // Körperoberfläche verschwindet: jeder Vertex, dessen schwerster Knochen zum
  // rechten Bein gehört, fällt samt seiner Dreiecke aus dem Mesh.
  entferneKette(gltf, ['mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot',
    'mixamorigRightToeBase', 'mixamorigRightToe_End']);

  const vorher = detectRig(await xbot(), { file: 'Xbot.glb' });
  assert.ok(vorher.roles.foot_r, 'Kontrolle: vor dem Eingriff war das rechte Bein erkannt');

  assert.throws(
    () => detectRig(gltf, { file: 'Xbot-ohne-rechtes-Bein.glb' }),
    (fehler) => {
      assert.ok(fehler instanceof RigAbweisung, `erwartet RigAbweisung, kam ${fehler.name}: ${fehler.message}`);
      assert.match(fehler.message, /\d/, `jede Abweisung muss eine Zahl nennen, war: "${fehler.message}"`);
      return true;
    },
    'Einbeinige Figuren sind kein Mensch — Ablehnung statt Umbenennung der Arme zu Beinen'
  );
});

/**
 * Entfernt eine Knochenkette aus der Körperoberfläche: alle Vertices, deren
 * schwerstes Hautgewicht auf einen Knochen der Kette fällt, samt der
 * Dreiecke, die sie berühren.
 */
function entferneKette(gltf, kettenNamen) {
  const verboten = new Set(kettenNamen);
  let entfernt = 0;
  let gefundeneMeshes = 0;

  gltf.scene.traverse((obj) => {
    if (!obj.isSkinnedMesh) return;
    const geo = obj.geometry;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    assert.equal(Object.keys(geo.morphAttributes || {}).length, 0,
      `Mesh „${obj.name}“ hat Morph-Ziele — das Entfernen wäre dort nicht korrekt`);
    gefundeneMeshes++;

    const gelenke = obj.skeleton.bones;
    const neuIndex = new Int32Array(pos.count).fill(-1);
    const p = [];
    const sidx = [];
    const sgew = [];
    for (let v = 0; v < pos.count; v++) {
      let schwerster = -1, schwerstes = 0;
      for (let w = 0; w < 4; w++) {
        const gewicht = sw.getComponent(v, w);
        if (gewicht > schwerstes) { schwerstes = gewicht; schwerster = si.getComponent(v, w); }
      }
      if (schwerstes < 0.5) continue;                       // gehört keinem Knochen
      if (verboten.has(gelenke[schwerster] ? gelenke[schwerster].name : '')) continue;
      neuIndex[v] = p.length / 3;
      for (let a = 0; a < 3; a++) p.push(pos.getComponent(v, a));
      for (let w = 0; w < 4; w++) {
        sidx.push(si.getComponent(v, w));
        sgew.push(sw.getComponent(v, w));
      }
    }
    entfernt += pos.count - p.length / 3;

    const alt = geo.index ? geo.index.array : null;
    const dreiecke = [];
    for (let i = 0; i + 2 < (alt ? alt.length : pos.count); i += 3) {
      const ecke = alt
        ? [alt[i], alt[i + 1], alt[i + 2]]
        : [i, i + 1, i + 2];
      if (ecke.some((v) => neuIndex[v] < 0)) continue;
      dreiecke.push(neuIndex[ecke[0]], neuIndex[ecke[1]], neuIndex[ecke[2]]);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sidx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sgew, 4));
    geo.setIndex(dreiecke);
    geo.boundingSphere = null;
    geo.boundingBox = null;
  });

  assert.ok(gefundeneMeshes > 0, 'kein gehäutetes Mesh gefunden — Eingriff unmöglich');
  assert.ok(entfernt > 0, `es mussten Vertices entfernt werden, entfernt: ${entfernt}`);
  return entfernt;
}
