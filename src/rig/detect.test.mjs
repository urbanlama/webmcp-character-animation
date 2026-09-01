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
import { detectRig, RigAbweisung, PARAMS, ROLLEN, PFLICHTROLLEN as PARAMS_PFLICHT } from './detect.js';

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

/** Die drei Vertragspflichtrollen je Entwicklungsmodell.
 *  Die Namen ohne Doppelpunkte: der GLTFLoader entfernt sie aus den
 *  Knotenbezeichnungen. Gemessen wird ohnehin nicht nach Namen. */
const PFLICHT_ERWARTET = {
  CesiumMan: { pelvis: 'Skeleton_torso_joint_1', foot_l: 'leg_joint_L_3', foot_r: 'leg_joint_R_3' },
  Michelle: { pelvis: 'mixamorigHips', foot_l: 'mixamorigLeftFoot', foot_r: 'mixamorigRightFoot' },
  RiggedFigure: { pelvis: 'torso_joint_1', foot_l: 'leg_joint_L_3', foot_r: 'leg_joint_R_3' },
  Soldier: { pelvis: 'mixamorigHips', foot_l: 'mixamorigLeftFoot', foot_r: 'mixamorigRightFoot' },
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

/** Vergleicht die getroffenen Rollen gegen die Referenz — nur die geprüften. */
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

test('Prüfhilfe: eine falsche Zuordnung bleibt nicht unentdeckt', async () => {
  // Ohne diesen Test könnten die Vergleiche oben leer durchlaufen: wer nie
  // prüft, dass sein Prüfer anschlägt, hat keinen.
  const bericht = detectRig(await xbot(), { file: 'Xbot.glb' });

  // absichtlich falsch: Seiten getauscht, eine Rolle fehlt in der Referenzliste
  const kaputt = Object.assign({}, XBOT_ERWARTET, {
    foot_l: XBOT_ERWARTET.foot_r,
    foot_r: XBOT_ERWARTET.foot_l,
  });
  delete kaputt.head;
  const abweiche = fehlendeZuordnungen(bericht, kaputt);
  assert.equal(abweiche.length, 2,
    `zwei vertauschte Rollen müssen zwei Meldungen geben, gekommen ${abweiche.length}: ${abweiche.join(' | ')}`);
  assert.ok(abweiche.every((a) => /\d|erwartet/.test(a)), `jede Meldung muss Zahl oder Vergleich nennen: ${abweiche.join(' | ')}`);
  assert.ok(fehlendeZuordnungen(bericht, XBOT_ERWARTET).length === 0,
    'die unverfälschte Referenz muss durchgehen');

  // absichtlich falsche Konfidenzordnung: unter der Frageschwelle gesetzt und
  // eine Fragezonen-Rolle ohne Rückfrage
  const frisiert = JSON.parse(JSON.stringify(bericht));
  frisiert.roles.spine = { bone: 'mixamorigSpine', confidence: PARAMS.fragenAb - 0.2 };
  frisiert.roles.chest = { bone: 'mixamorigSpine2', confidence: 0.7 };
  frisiert.questions = [];
  const probleme = pruefeKonfidenzordnung(frisiert);
  assert.ok(probleme.length >= 2,
    `beiden Verstöße müssen gemeldet werden, gemeldet ${probleme.length}: ${probleme.join(' | ')}`);
  assert.ok(pruefeKonfidenzordnung(bericht).length === 0,
    'der unverfälschte Bericht muss die Ordnung einhalten');
});

test('Grundfall: Xbot bekommt seine Rollen auf den richtigen Knochen', async () => {
  const bericht = detectRig(await xbot(), { file: 'Xbot.glb' });

  assert.deepEqual(fehlendeZuordnungen(bericht, XBOT_ERWARTET), [],
    `Rollenvergabe weicht von der Referenz ab (${bericht.source.boneCount} Knochen, ${bericht.source.vertexCount} Vertices gemessen)`);
  assert.deepEqual(pruefeKonfidenzordnung(bericht), [], 'Konfidenzordnung nach plan.md 5.1 verletzt');
  assert.equal(bericht.world.up, 'y',
    `Aufwärtsachse wird gemessen, gemeldet „${bericht.world.up}“ (plan.md 5.1: Achsname ohne Vorzeichen)`);
  assert.equal(bericht.world.forward, 'z',
    `Blickrichtung aus Ferse-zu-Zeh, Knie und Kopf gemessen, gemeldet „${bericht.world.forward}“`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Umbauten an einem Modell — Name, Achse, Maßstab, Zwischensknochen
// ─────────────────────────────────────────────────────────────────────────────

/** Benennt alle Knochen um in `bone_000…` und liefert die Rückübersetzung. */
function umbenennen(gltf) {
  const ruckweg = new Map();
  let nr = 0;
  gltf.scene.traverse((obj) => {
    if (!obj.isBone) return;
    const neu = `bone_${String(nr).padStart(3, '0')}`;
    ruckweg.set(obj.name, neu);
    obj.name = neu;
    nr++;
  });
  assert.ok(nr > 20, `erwartet ein Skelett mit vielen Knochen, umbenannt: ${nr}`);
  return ruckweg;
}

/**
 * Setzt einen Zwischensknochen in eine Gliederstrecke: kollinear, in der Mitte
 * zwischen den zwei Gelenken, ohne eigenes Hautgewicht. Das ist der harte Fall —
 * ein echter Twist-Knochen, den die Erkennung nicht als Knie oder Ellenbogen
 * annehmen darf, obwohl er in der Kette liegt.
 */
function zwischensknochen(gltf, elterName, kindName, kennung) {
  const suche = (name) => {
    let gefunden = null;
    gltf.scene.traverse((o) => { if (o.isBone && o.name === name) gefunden = o; });
    return gefunden;
  };
  const elter = suche(elterName), kind = suche(kindName);
  assert.ok(elter && kind, `Knochen „${elterName}“ und „${kindName}“ müssen im Skelett sein`);
  gltf.scene.updateMatrixWorld(true);

  const weltKind = kind.getWorldPosition(new THREE.Vector3());
  const weltKindDreh = kind.getWorldQuaternion(new THREE.Quaternion());
  const weltElter = elter.getWorldPosition(new THREE.Vector3());

  const twist = new THREE.Bone();
  twist.name = `twist_${kennung}`;
  elter.add(twist);
  gltf.scene.updateMatrixWorld(true);
  twist.position.copy(elter.worldToLocal(weltKind.clone().lerp(weltElter, 0.5)));
  gltf.scene.updateMatrixWorld(true);

  elter.remove(kind);
  twist.add(kind);
  gltf.scene.updateMatrixWorld(true);
  kind.position.copy(twist.worldToLocal(weltKind.clone()));
  const verdreher = twist.getWorldQuaternion(new THREE.Quaternion()).invert();
  kind.quaternion.copy(verdreher.multiply(weltKindDreh));
  gltf.scene.updateMatrixWorld(true);

  // Kontrolle: das Kind sitzt danach noch am selben Punkt in der Welt.
  const nachher = kind.getWorldPosition(new THREE.Vector3());
  assert.ok(nachher.distanceTo(weltKind) < 1e-6,
    `Zwischensknochen verschiebt das Kindgelenk um ${nachher.distanceTo(weltKind).toFixed(7)} m`);
  assert.ok(weltKind.distanceTo(weltElter) > 0.05,
    `Strecke „${elterName}“→„${kindName}“ ist nur ${weltKind.distanceTo(weltElter).toFixed(4)} m lang — zu kurz zum Einfügen`);
  return twist.name;
}

/** Dreht und skaliert das gesamte Modell — Skelett und Haut gemeinsam. */
function rahme(gltf, { drehung, maßstab }) {
  gltf.scene.rotation.set(drehung[0], drehung[1], drehung[2]);
  gltf.scene.scale.setScalar(maßstab);
  gltf.scene.updateMatrixWorld(true);
}

/**
 * Dreht eine ganze Gliedkette auf 180° um die lotrechte Achse durch ihr
 * Ansatzgelenk: Fußsohle und Kniescheibe zeigen danach nach hinten, der Rest der
 * Figur bleibt, wie er ist. Die Figur steht weiter aufrecht auf zwei Füßen —
 * nur widerspricht jede Richtungsauskunft der einen Seite der der anderen.
 *
 * Gedreht wird der Knochen, nicht die Rohgeometrie: die Erkennung liest die
 * Haut dort, wo die Knochen sie hintransformieren.
 *
 * @param {object} gltf
 * @param {string[]} kettenNamen Knochen, die mitsamt ihrem Abstieg gedreht werden
 * @param {number[]} durchPunkt Weltkoordinat des Ansatzgelenks
 * @returns {number} Anzahl gedrehter Knochen
 */
function kehreKetteUm(gltf, kettenNamen, durchPunkt) {
  gltf.scene.updateMatrixWorld(true);
  const welt = new THREE.Vector3(...durchPunkt);
  const namen = new Set(kettenNamen);
  let gedreht = 0;
  gltf.scene.traverse((obj) => {
    if (!obj.isBone || !namen.has(obj.name)) return;
    // `applyMatrix4` wirkt im Raum des Elternknotens — der Drehpunkt muss
    // daher aus Weltkoordinaten dorthin umgerechnet werden.
    const mittig = obj.parent ? obj.parent.worldToLocal(welt.clone()) : welt.clone();
    const drehung = new THREE.Matrix4()
      .makeTranslation(mittig.x, mittig.y, mittig.z)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(-mittig.x, -mittig.y, -mittig.z));
    obj.applyMatrix4(drehung);
    gedreht++;
  });
  gltf.scene.updateMatrixWorld(true);
  assert.equal(gedreht, namen.size,
    `alle ${namen.size} Kettenknochen müssen im Skelett liegen, gedreht: ${gedreht}`);
  return gedreht;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stufe 2: Robustheit — Namen weg, Achse gedreht, Maßstab fremd, Twist dazu
// ─────────────────────────────────────────────────────────────────────────────

test('Robustheit: umbenannte, gedrehte, skalierte Figur mit Twist-Knochen behält ihre Rollen', async () => {
  const gltf = await xbot();
  const twists = [
    zwischensknochen(gltf, 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'l'),
    zwischensknochen(gltf, 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'r'),
    zwischensknochen(gltf, 'mixamorigLeftForeArm', 'mixamorigLeftHand', 'arm_l'),
    zwischensknochen(gltf, 'mixamorigRightForeArm', 'mixamorigRightHand', 'arm_r'),
  ];
  rahme(gltf, { drehung: [0.18, 2.3, -0.12], maßstab: 0.0217 });
  const ruckweg = umbenennen(gltf);

  const erwartet = {};
  for (const [rolle, name] of Object.entries(XBOT_ERWARTET)) {
    assert.ok(ruckweg.has(name), `Referenzknochen „${name}“ fehlt nach dem Umbenennen`);
    erwartet[rolle] = ruckweg.get(name);
  }

  const bericht = detectRig(gltf, { file: 'Xbot-robust.glb' });
  assert.deepEqual(fehlendeZuordnungen(bericht, erwartet), [],
    `Rollenvergabe weicht ab nach Umbenennung, Drehung, Maßstab 0,0217 und ${twists.length} Zwischensknochen `
    + `(${bericht.source.boneCount} Knochen, Körperhöhe ${bericht.world.height})`);
  assert.deepEqual(pruefeKonfidenzordnung(bericht), [], 'Konfidenzordnung nach plan.md 5.1 verletzt');

  // Die Zwischensknochen dürfen keine Rolle bekommen haben und müssen als
  // nutzlose Kette ausgewiesen sein.
  const twistNamen = twists.map((t) => ruckweg.get(t));
  const gestoehlen = Object.entries(bericht.roles).filter(([, v]) => twistNamen.includes(v.bone));
  assert.deepEqual(gestoehlen, [],
    `Zwischensknochen bekamen Rollen: ${gestoehlen.map(([r, v]) => `${r}→${v.bone}`).join(', ') || 'keiner'}`);
  const unbekannte = new Set(bericht.unknown.map((u) => u.bone));
  for (const t of twistNamen) {
    assert.ok(unbekannte.has(t), `Zwischensknochen „${t}“ fehlt in unknown — die Kette wäre verloren`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stufe 3: fremde Rigs
// ─────────────────────────────────────────────────────────────────────────────

test('Fremde Rigs: die Abnahmemodelle werden korrekt zugeordnet', async () => {
  const getroffen = [];
  const meldungen = [];
  for (const { name, pfad } of ABNAHME) {
    let bericht;
    try {
      bericht = detectRig(await modell(pfad), { file: name + '.glb' });
    } catch (fehler) {
      meldungen.push(`${name}: abgelehnt — ${fehler.message}`);
      continue;
    }
    const abweiche = fehlendeZuordnungen(bericht, KENNEY_ERWARTET);
    const ordnung = pruefeKonfidenzordnung(bericht);
    if (!abweiche.length && !ordnung.length) {
      getroffen.push(name);
    } else {
      meldungen.push(`${name}: ${abweiche.concat(ordnung).join('; ')}`);
    }
  }
  assert.ok(getroffen.length >= 3,
    `mindestens 3 der 5 Abnahmemodelle müssen korrekt zugeordnet werden, getroffen: ${getroffen.length} `
    + `(${getroffen.join(', ') || 'keins'})\n  ${meldungen.join('\n  ')}`);
});

test('Fremde Rigs: die Entwicklungsmodelle treffen ihre Pflichtrollen', async () => {
  const fehlgeschlagen = [];
  for (const [name, erwartet] of Object.entries(PFLICHT_ERWARTET)) {
    let bericht;
    try {
      bericht = detectRig(await modell(ENTWICKLUNG[name]), { file: name + '.glb' });
    } catch (fehler) {
      fehlgeschlagen.push(`${name}: ${fehler.name} — ${fehler.message}`);
      continue;
    }
    const abweiche = fehlendeZuordnungen(bericht, erwartet);
    if (abweiche.length) fehlgeschlagen.push(`${name}: ${abweiche.join('; ')}`);
  }
  assert.deepEqual(fehlgeschlagen, [],
    `Pflichtrollen pelvis/foot_l/foot_r sitzen nicht${'  '}(${Object.keys(PFLICHT_ERWARTET).length} Modelle geprüft)`);
});

test('Unbekanntes bleibt nutzbar: Rollenlose Ketten enden in unknown, nicht im Nichts', async () => {
  const bericht = detectRig(await xbot(), { file: 'Xbot.glb' });
  const rollen = new Set(Object.values(bericht.roles).map((r) => r.bone));
  const gemeldeteKnochen = new Set(bericht.bones.map((b) => b.id));

  assert.equal(bericht.unknown.length + rollen.size, bericht.bones.length,
    `jede Kette muss entweder eine Rolle oder einen Eintrag in unknown haben: ${bericht.unknown.length} unbekannt + ${rollen.size} Rollen gegen ${bericht.bones.length} Knochen`);
  for (const u of bericht.unknown) {
    assert.ok(gemeldeteKnochen.has(u.bone), `unknown nennt „${u.bone}“, der ist kein gemeldeter Knochen`);
    assert.equal(typeof u.grund, 'string', `unknown-Eintrag „${u.bone}“ ohne Begründung`);
    assert.ok(u.grund.length > 10, `Begründung zu kurz: „${u.grund}“`);
    assert.equal(u.confidence, 0, `unbekannt trägt Konfidenz ${u.confidence}, erwartet 0`);
  }
  assert.ok(bericht.unknown.every((u) => !rollen.has(u.bone)), 'ein Knochen hat Rolle und unknown zugleich');
});

test('Mehrdeutiges Rig: der Mensch wird gefragt, statt dass geraten wird', async () => {
  const gltf = await xbot();
  // Referenz: ohne Eingriff ist die Blickrichtung messbar.
  const sauber = detectRig(await xbot(), { file: 'Xbot.glb' });
  assert.equal(sauber.richtung.entscheidbar, true, 'Kontrolle: das Original zeigt klar nach vorn');

  const huefte = [];
  gltf.scene.traverse((o) => {
    if (o.isBone && o.name === 'mixamorigLeftUpLeg') huefte.push(o.getWorldPosition(new THREE.Vector3()));
  });
  assert.equal(huefte.length, 1, `linkes Hüftgelenk gesucht, gefunden ${huefte.length}`);
  const gedreht = kehreKetteUm(gltf, ['mixamorigLeftUpLeg'],
    [huefte[0].x, huefte[0].y, huefte[0].z]);

  const bericht = detectRig(gltf, { file: 'Xbot-mehrdeutig.glb' });
  const gegeneinander = bericht.richtung.signale.filter((s) => s.zählt);
  assert.ok(gegeneinander.length >= 2,
    `es müssen mindestens zwei Richtungssignale messbar bleiben, gemessen: ${gegeneinander.length}`);
  assert.equal(bericht.richtung.entscheidbar, false,
    `gegenläufige Signale (${gedreht} gedrehte Kette, Streuung ${bericht.richtung.streuungGrad}°, `
    + `Signale ${JSON.stringify(bericht.richtung.signale)}) dürfen nicht als Entscheidung durchgehen`);
  assert.equal(bericht.world.forward, 'unklar', `gemeldete Blickrichtung „${bericht.world.forward}“`);
  assert.equal(bericht.world.left, 'unklar', `gemeldete Seitenrichtung „${bericht.world.left}“`);

  const seitenFragen = bericht.questions.filter((q) => q.art === 'seitenverwechslung');
  assert.equal(seitenFragen.length, 1, `eine Rückfrage nach der Seite erwartet, gekommen ${seitenFragen.length}`);
  assert.equal(seitenFragen[0].optionen.length, 2,
    `die Rückfrage muss beide Fußknochen als Optionen nennen, gekommen ${seitenFragen[0].optionen.length}`);

  // Nichts in der Fragezone darf als sicher gemeldet werden — und keine Rolle
  // unter der Frageschwelle überhaupt vorkommen.
  for (const [rolle, eintrag] of Object.entries(bericht.roles)) {
    if (!/_[lr]$/.test(rolle)) continue;
    assert.ok(eintrag.confidence < PARAMS.sicherAb,
      `Seitenrolle ${rolle} mit ${eintrag.confidence} gilt sicher, obwohl die Blickrichtung unklar ist`);
  }
  assert.ok(bericht.roles.pelvis.confidence >= PARAMS.sicherAb,
    `Das Becken ist von der Richtung unabhängig, Konfidenz ${bericht.roles.pelvis.confidence}`);
  assert.deepEqual(pruefeKonfidenzordnung(bericht), [], 'Konfidenzordnung nach plan.md 5.1 verletzt');
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

// ─────────────────────────────────────────────────────────────────────────────
// Stufe 4: Konfidenzzonen (plan.md 5.1) — unsicher markiert statt abgelehnt
// ─────────────────────────────────────────────────────────────────────────────

/** Die Abnahmemodelle der Kenney-Familie: Fußrollen in der Rückfragezone —
 *  genau der gemessene Fall der zehn fremden Modelle. */
test('Fragezone: 0,5–0,9 wird als „unsicher, Rückfrage nötig“ markiert, nicht abgelehnt', async () => {
  const pfad = join(REPO_ROOT, 'models', 'fremde', 'Kenney_Ooli.glb');
  const bericht = detectRig(await modell(pfad), { file: 'Kenney_Ooli.glb' });

  // Der Füllstand vor der Messung (AGENTS.md: jede Meldung mit Zahl).
  assert.ok(bericht.source.boneCount > 0, `Modell hat ${bericht.source.boneCount} Knochen — Messung lief`);
  assert.ok(bericht.world.height > 0,
    `gemessene Körperhöhe ${bericht.world.height} — Modell wurde nicht abgelehnt`);

  for (const rolle of PARAMS_PFLICHT) {
    const r = bericht.roles[rolle];
    assert.ok(r, `Pflichtrolle ${rolle} fehlt im Bericht — Modell wäre abgelehnt worden`);
    assert.ok(r.confidence >= PARAMS.fragenAb,
      `${rolle} mit Konfidenz ${r.confidence} unter der Frageschwelle ${PARAMS.fragenAb}`);
    if (r.confidence < PARAMS.sicherAb) {
      assert.equal(r.confirm, true,
        `${rolle} mit Konfidenz ${r.confidence} in der Rückfragezone ${PARAMS.fragenAb}…${PARAMS.sicherAb} `
        + `ist nicht als „unsicher“ markiert`);
      assert.match(r.vorschlag, /Rückfrage/,
        `${rolle}: die Vorschlagsnotiz muss die Rückfrage benennen: "${r.vorschlag}"`);
      assert.ok(new RegExp(`„${r.bone}“`).test(r.vorschlag),
        `${rolle}: der Vorschlag nennt den besten Kandidaten „${r.bone}“ nicht`);
    }
  }
  // Der Füße bester Kandidat ist „leg-left“ bzw. „leg-right“ — der Vorschlag
  // nennt denselben Knochen wie die Rolle selbst.
  assert.equal(bericht.roles.foot_l.bone, 'leg-left',
    `bester Kandidat für foot_l ist „leg-left“, gekommen „${bericht.roles.foot_l.bone}“`);

  // Zu jeder unsicheren Pflichtrolle gehört eine Frage mit Vorschlag.
  for (const frage of bericht.questions.filter((q) => q.rolle === 'foot_l' || q.rolle === 'foot_r')) {
    // Die Frage selbst ist fuer den Menschen und nennt keine Messgroessen —
    // die stehen in `diagnose` und gehen in den Rig-Bericht.
    assert.match(frage.diagnose, /Konfidenz/,
      `die Diagnose nennt die gemessene Konfidenz: "${frage.diagnose}"`);
    assert.equal(frage.vorschlag, bericht.roles[frage.rolle].vorschlag,
      `die Frage zu ${frage.rolle} trägt denselben Vorschlag wie die Rolle`);
  }
  assert.deepEqual(pruefeKonfidenzordnung(bericht), [], 'Konfidenzordnung verletzt');
});

test('Fragezone, Negativfall: unter 0,5 bleibt es bei der Ablehnung der Rolle', async () => {
  // Der Bericht von Kenney_Ooli gefälscht: dieselbe Zuordnung, Konfidenz unter
  // der Frageschwelle. Eine solche Zuordnung darf im Feld `roles` nicht
  // auftauchen — der Prüfer fängt jede Implementierung, die sie als Rolle
  // durchreicht, auch wenn sie sie gleichzeitig als Frage ausgibt.
  const bericht = JSON.parse(JSON.stringify(detectRig(await xbot(), { file: 'Xbot.glb' })));
  bericht.roles.toe_l = { bone: bericht.roles.toe_l.bone, confidence: PARAMS.fragenAb - 0.01 };

  const probleme = pruefeKonfidenzordnung(bericht);
  assert.ok(probleme.length >= 1,
    `eine Rolle mit Konfidenz ${bericht.roles.toe_l.confidence} (unter ${PARAMS.fragenAb}) `
    + `muss beanstandet werden, beanstandet: ${probleme.length}`);
  assert.match(probleme[0], /entfallen/,
    `die Meldung sagt, dass die Rolle hätte entfallen müssen: "${probleme[0]}"`);
});

test('Ablehnte Zuordnung: unter 0,5 steht der beste Kandidat mit Konfidenz im Bericht', async () => {
  // Am Kenney-Modell liegt jede Zuordnung über 0,5 — der Fall „unter 0,5, aber
  // ein bester Kandidat“ wird über die Verfahrensparameter erzwungen: die
  // Frageschwelle über der Fuß-Konfidenz gedreht, scheitert die Erkennung an
  // der Pflichtrolle foot_l — und der Bericht nennt für genau diese Rolle den
  // besten Kandidaten in `abgelehnteZuordnungen`. Genauso verhält es sich für
  // einen Aufruf ohne Frageschwelle, etwa ein Modell, dessen Pflichtrolle
  // geometrisch unterlegen ist.
  const pfad = join(REPO_ROOT, 'models', 'fremde', 'Kenney_Ooli.glb');
  const params = Object.assign({}, PARAMS, { fragenAb: 0.99 });
  let bericht;
  try {
    bericht = detectRig(await modell(pfad), { file: 'Kenney_Ooli.glb', params });
  } catch (fehler) {
    assert.ok(fehler instanceof RigAbweisung,
      `erwartet RigAbweisung, kam ${fehler.name}: ${fehler.message}`);
    assert.ok(/Pflichtrolle foot_l/.test(fehler.message) || /Pflichtrolle/.test(fehler.message),
      `die Ablehnung nennt die fehlende Pflichtrolle: "${fehler.message}"`);

    // dieselbe Erkennung mit gesenkter Schwelle: die Zuordnung ist immer noch
    // dieselbe (Kandidat „leg-left“, Konfidenz ~0,72 in der Fragezone) — sie
    // trägt jetzt die Marke „unsicher, Rückfrage nötig“, statt die Rolle
    // still zu streichen.
    const locker = Object.assign({}, PARAMS, { fragenAb: 0.70 });
    const lockerBericht = detectRig(await modell(pfad), { file: 'Kenney_Ooli.glb', params: locker });
    assert.ok(lockerBericht.roles.foot_l, `foot_l mit lockerer Schwelle 0,70 vergeben`);
    assert.ok(lockerBericht.roles.foot_l.confidence >= 0.5
      && lockerBericht.roles.foot_l.confidence < 0.99,
      `foot_l Konfidenz ${lockerBericht.roles.foot_l.confidence} liegt in der Fragezone 0,5…0,99`);
    assert.equal(lockerBericht.roles.foot_l.confirm, true,
      'die unsichere Zuordnung trägt die Marke confirm: true');
    assert.match(lockerBericht.roles.foot_l.vorschlag, /Rückfrage/,
      `die Marke nennt „unsicher, Rückfrage nötig“: "${lockerBericht.roles.foot_l.vorschlag}"`);
    return;
  }
  assert.fail('mit fragenAb 0,99 darf das Kenney-Modell nicht durchlaufen — die Prüfung soll den Ablehnungsweg sehen');
});
