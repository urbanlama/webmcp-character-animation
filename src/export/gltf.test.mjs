// AP-Export, Abnahmetests (Auftragstabelle „Export — glTF-Ausgabe mit
// Wurzelbewegung“).
//
//   | Test          | Positivfall                                   | Negativfall
//   | Wiedereinlesen| Export liest neu ein, Gelenkverläufe stimmen  | beschädigter Export wird bemerkt und gemeldet
//   | Wurzelbewegung| Ortsveränderung überlebt den Export           | fehlende Fortbewegung wird gemeldet
//
// Der Nachweis läuft nicht mit dem eigenen Schreibcode gegen sich selbst:
// `pruefeExport` liest mit dem GLTFLoader (src/scene/load.js) neu ein und
// vergleicht die Zahlen (plan.md 6.9).
//
// Negativfälle (AGENTS.md, Regel 2): zu jedem Test gehört ein absichtlich
// kaputter Fall, der rot werden MUSS — hier durch assert.throws bzw. einen
// nicht bestehenden `pruefeExport`-Befund erzwungen.
//
// Läuft ohne Browser (Brett-Eintrag 2026-08-30: Node ist der Standard).

import { test } from 'node:test';
import assert from 'node:assert';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { exportiereClip, pruefeExport,
  WURZEL_ABSTAND_TOLERANZ_ANTEIL, WURZEL_WINKEL_TOLERANZ_RAD } from './gltf.js';

// ─────────────────────────────────────────────────────────────────────────────
// RigProfile: Rollen und Körperhöhe werden GEMESSEN (AGENTS.md, Regel 1),
// nicht getippt. Für das Skelett-Setup reicht ein minimales Profil; die
// Körperhöhe kommt unten aus der gemessenen Bounding Box.
// ─────────────────────────────────────────────────────────────────────────────

const PELVIS = 'mixamorigHips';
const ARM_L = 'mixamorigLeftArm';

/** Normiert eine Quaternion (Testwerte werden als [x,y,z,w] angegeben). */
function normiere(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return q.map((v) => v / l);
}

/** Erzeugt eine gelöste Timeline: Wurzelbewegung in Welt-Metern plus eine
 *  Gelenkdrehung am linken Arm, plan.md 5.2. */
function timelineMitWurzelbewegung() {
  const frames = [];
  for (let i = 0; i < 10; i++) {
    const s = i / 9;
    frames.push({
      root: {
        pos: [2.0 * s, 1.04, 0],                    // 2 m Ortsveränderung auf +X
        quat: [0, Math.sin((Math.PI / 2) * s * 0.5), 0, Math.cos((Math.PI / 2) * s * 0.5)],
      },
      joints: {
        arm_l: normiere([0, 0, Math.sin(Math.PI * s) * 0.5, Math.cos(Math.PI * s) * 0.5]),
      },
    });
  }
  return {
    schemaVersion: 1,
    fps: 30,
    frameCount: 10,
    rotationFormat: 'quaternion',
    phases: [],
    overrides: {},
    solved: { frames },
  };
}

/** Dieselbe Timeline OHNE Ortsveränderung — Grundlage des Negativfalls. */
function timelineStehend() {
  const t = timelineMitWurzelbewegung();
  for (const f of t.solved.frames) {
    f.root.pos = [0, 1.04, 0];   // Wurzel bleibt, nur die Gelenke bewegen sich
  }
  return t;
}

async function geladenesXbot() {
  return loadGLB(alsArrayBuffer(XBOT_PFAD));
}

function rigProfileMitHoehe(hoehe) {
  return {
    schemaVersion: 1,
    world: { up: 'y', forward: 'z', left: 'x', groundY: 0, height: hoehe, unitsPerMeter: 1 },
    roles: { pelvis: { bone: PELVIS, confidence: 1 } },
    joints: {
      // Zuordnung Gelenk-id → Knochenname, wie sie die Messschicht liefert.
      arm_l: { bone: ARM_L },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Abnahme „Wiedereinlesen“ — Positivfall
// ─────────────────────────────────────────────────────────────────────────────

test('Export, Positivfall: GLB liest wieder ein, Wurzel und Gelenkverläufe stimmen mit der Timeline', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();

  // Körperhöhe messen (AGENTS.md, Regel 1), nicht tippen: Bounding Box der
  // Szene in Weltkoordinaten.
  gltf.scene.updateMatrixWorld(true);
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const hoehe = box.max.y - box.min.y;
  assert.ok(hoehe > 0.1, `Gemessene Körperhöhe ${hoehe.toFixed(4)} m, erwartet > 0,1 m`);
  const profile = rigProfileMitHoehe(hoehe);

  const clip = await exportiereClip(gltf, timeline, profile);
  assert.ok(clip.bytes.length > 1000,
    `Export ergab ${clip.bytes.length} Byte, erwartet eine vollständige GLB`);
  assert.ok(clip.warnings.length === 0,
    `Export sollte ohne Verluste laufen, ${clip.warnings.length} Warnungen: ${clip.warnings[0] ?? ''}`);

  // GLB-Kennung: die ersten 4 Byte sind „glTF“.
  const magic = String.fromCharCode(...clip.bytes.subarray(0, 4));
  assert.equal(magic, 'glTF', `Datei beginnt mit "${magic}", erwartet GLB-Magic „glTF“`);

  const befund = await pruefeExport(timeline, clip.bytes, profile);
  assert.deepEqual(befund.errors, [],
    `Wiedereinlese-Vergleich soll ohne Befund bleiben, gemeldet: ${JSON.stringify(befund.errors)}`);
  assert.equal(befund.passed, true, 'Positivfall muss durchgehen');
  assert.equal(befund.gemessen.frameCount, 10,
    `Frame-Zahl im Befund ${befund.gemessen.frameCount}, erwartet 10`);
});

test('Export, Positivfall: Gelenkverlauf im Wiedereinlesen trägt die Timeline-Werte Kanal für Kanal', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  const clip = await exportiereClip(gltf, timeline, profile);
  const zurueck = await loadGLB(clip.bytes);

  assert.equal(zurueck.animations.length, 1,
    `Wiedereinlesen hat ${zurueck.animations.length} Animationen, erwartet genau 1`);
  const tracks = new Map(zurueck.animations[0].tracks.map((t) => [t.name, t]));

  // Jeder Kanal der Timeline existiert im Wiedereinlesen und endet korrekt.
  const dauerErwartet = 9 / 30;
  for (const name of [`${PELVIS}.position`, `${PELVIS}.quaternion`, `${ARM_L}.quaternion`]) {
    const track = tracks.get(name);
    assert.ok(track, `Kanal „${name}“ fehlt; vorhanden: ${[...tracks.keys()].join(', ')}`);
    assert.equal(track.times.length, 10,
      `Kanal „${name}“ hat ${track.times.length} Keyframes, erwartet 10 (einer je Frame)`);
    assert.ok(
      Math.abs(track.times[track.times.length - 1] - dauerErwartet) < 0.5 / 30,
      `Kanal „${name}“ endet bei ${track.times[track.times.length - 1]} s, erwartet ${dauerErwartet} s`
    );
  }

  // Werte am Beispiel des Arms: Kanal 0 und Ende gegen die Timeline.
  const armTrack = tracks.get(`${ARM_L}.quaternion`);
  const soll0 = timeline.solved.frames[0].joints.arm_l;
  const soll9 = timeline.solved.frames[9].joints.arm_l;
  const ist0 = Array.from(armTrack.values.slice(0, 4));
  const ist9 = Array.from(armTrack.values.slice(36, 40));
  const winkel = (qa, qb) => {
    const d = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
    return 2 * Math.acos(Math.min(1, d));
  };
  assert.ok(winkel(ist0, soll0) < WURZEL_WINKEL_TOLERANZ_RAD,
    `Arm-Kanal Keyframe 0 weicht um ${winkel(ist0, soll0).toFixed(6)} rad ab, Toleranz ${WURZEL_WINKEL_TOLERANZ_RAD}`);
  assert.ok(winkel(ist9, soll9) < WURZEL_WINKEL_TOLERANZ_RAD,
    `Arm-Kanal Keyframe 9 weicht um ${winkel(ist9, soll9).toFixed(6)} rad ab, Toleranz ${WURZEL_WINKEL_TOLERANZ_RAD}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Abnahme „Wurzelbewegung“ — Positivfall
// ─────────────────────────────────────────────────────────────────────────────

test('Export, Wurzelbewegung: Ortsveränderung von 2 m überlebt Export und Wiedereinlesen', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  const clip = await exportiereClip(gltf, timeline, profile);
  const zurueck = await loadGLB(clip.bytes);

  const track = zurueck.animations[0].tracks.find((t) => t.name === `${PELVIS}.position`);
  assert.ok(track, 'Positionskanal der Wurzel fehlt im Wiedereinlesen');

  const eltern = zurueck.scene.getObjectByName(PELVIS).parent;
  eltern.updateWorldMatrix(true, false);
  const lokal0 = Array.from(track.values.slice(0, 3));
  const lokal9 = Array.from(track.values.slice(27, 30));
  const welt0 = new (await import('three')).Vector3(...lokal0).applyMatrix4(eltern.matrixWorld).toArray();
  const welt9 = new (await import('three')).Vector3(...lokal9).applyMatrix4(eltern.matrixWorld).toArray();
  const weg = Math.hypot(welt9[0] - welt0[0], welt9[1] - welt0[1], welt9[2] - welt0[2]);

  const sollWeg = 2.0;   // Timeline: root.pos von [0,…] nach [2,1.04,0]
  assert.ok(
    Math.abs(weg - sollWeg) <= WURZEL_ABSTAND_TOLERANZ_ANTEIL * profile.world.height,
    `Gemessene Ortsveränderung ${weg.toFixed(4)} m, Timeline verlangt ${sollWeg.toFixed(4)} m`
  );
  assert.ok(weg > 0.1,
    `Wurzel bewegt sich nur ${weg.toFixed(4)} m — Wurzelbewegung ist nicht im Export (typischer Fehler dieser Stelle)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Abnahme „Wiedereinlesen“ — Negativfälle
// ─────────────────────────────────────────────────────────────────────────────

test('Export, Negativfall: absichtlich beschädigter Export wird beim Wiedereinlesen bemerkt und gemeldet', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  const clip = await exportiereClip(gltf, timeline, profile);

  // Beschädigung: die Positions-Werte des Wurzelkanals werden auf 0 gesetzt.
  // Wessen Bytes das sind, wird aus der GLB-Struktur GELESEN (Accessor →
  // bufferView → Binär-Offset), nicht geraten — kein blindes Überschreiben,
  // das der Loader sonst widerstandslos schluckt. Der Export prangt danach
  // genau wie der Fehlerfall „Figur bewegt sich nicht“.
  const dv = new DataView(clip.bytes.buffer, clip.bytes.byteOffset, clip.bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67, 'Ausgangsdatei muss GLB sein');
  const jsonLen = dv.getUint32(12, true);
  const jsonStart = 20;
  const json = JSON.parse(new TextDecoder().decode(clip.bytes.subarray(jsonStart, jsonStart + jsonLen)));
  const posCh = json.animations[0].channels.find((c) => c.target.path === 'translation');
  assert.ok(posCh, 'Ausgangsdatei muss einen Wurzel-Positionskanal haben');
  const sampler = json.animations[0].samplers[posCh.sampler];
  const acc = json.accessors[sampler.output];
  const bv = json.bufferViews[acc.bufferView];
  const binStart = jsonStart + jsonLen + 8;
  const ziel = binStart + bv.byteOffset + (acc.byteOffset ?? 0);

  const kaputt = clip.bytes.slice();
  const werte = bv.byteLength;      // 10 Frames × 3 float32 = 120 Byte
  for (let i = 0; i < werte; i++) kaputt[ziel + i] = 0x00;

  const befund = await pruefeExport(timeline, kaputt, profile);
  assert.equal(befund.passed, false,
    'Ein beschädigter Export darf nicht als unverändert gelten');
  assert.ok(befund.errors.length > 0,
    'Ein beschädigter Export muss einen Befund liefern');
  const meldung = befund.errors.map((e) => e.message).join(' | ');
  assert.match(meldung, /Wurzelposition|fortbewegung|Ortsveränderung/,
    `Meldung soll den Befund benennen, war: "${meldung}"`);
  assert.match(meldung, /\d/,
    `Fehlermeldung soll eine Zahl enthalten (AGENTS.md), war: "${meldung}"`);
});

test('Export, Negativfall: ein gelöschter Positionskanal meldet die fehlende Wurzelbewegung mit Betrag', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  const clip = await exportiereClip(gltf, timeline, profile);

  // Gezielter Negativfall: der Wurzel-Positionskanal wird aus der GLB
  // entfernt — genau der Fehler „Figur bewegt sich nicht, obwohl die
  // Timeline es verlangt“. Die GLB-Struktur dafür wird hier direkt
  // zerschnitten: JSON-Chunk neu schreiben, in dem die Animation nur den
  // Rotationskanal behält.
  const dv = new DataView(clip.bytes.buffer, clip.bytes.byteOffset, clip.bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67, 'Ausgangsdatei muss GLB sein');
  const jsonLen = dv.getUint32(12, true);
  const jsonStart = 20;
  const json = JSON.parse(new TextDecoder().decode(clip.bytes.subarray(jsonStart, jsonStart + jsonLen)));

  const anim = json.animations[0];
  const channelsOhnePos = [];
  const samplersOhnePos = [];
  const alterIndex = new Map();          // alter Sampler-Index → neuer
  for (const ch of anim.channels) {
    // Positionskanal erkennen: der Kanal auf .position hat als Ziel den
    // Hips-Knoten mit Pfad „translation“.
    if (ch.target.path !== 'translation') {
      if (!alterIndex.has(ch.sampler)) {
        alterIndex.set(ch.sampler, samplersOhnePos.length);
        samplersOhnePos.push(anim.samplers[ch.sampler]);
      }
      ch.sampler = alterIndex.get(ch.sampler);   // Indizes nachziehen
      channelsOhnePos.push(ch);
    }
  }
  assert.ok(anim.channels.length - channelsOhnePos.length === 1,
    `Es sollte genau 1 Translation-Kanal geben, gefunden ${anim.channels.length - channelsOhnePos.length}`);
  anim.channels = channelsOhnePos;
  anim.samplers = samplersOhnePos;

  // GLB neu zusammensetzen: Der JSON-Chunk ist auf 4 Byte aufzufüllen; der
  // BIN-Chunk-Kopf sitzt unmittelbar hinter dem aufgefüllten JSON-Chunk.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const fuelle = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonPadded = new Uint8Array(jsonBytes.byteLength + fuelle);
  jsonPadded.set(jsonBytes);
  if (fuelle > 0) jsonPadded.fill(0x20, jsonBytes.byteLength);
  const binStart = jsonStart + jsonLen;
  const binLen = dv.getUint32(binStart, true);       // BIN-Chunk-Kopf: Länge
  assert.equal(dv.getUint32(binStart + 4, true), 0x004e4942,
    'Hinter dem JSON-Chunk muss der BIN-Chunk (0x004e4942) folgen');
  const teile = [];
  const kopf = new Uint8Array(12);
  new DataView(kopf.buffer).setUint32(0, 0x46546c67, true);
  new DataView(kopf.buffer).setUint32(4, 2, true);
  const gesamt = 12 + 8 + jsonPadded.byteLength + 8 + binLen;
  new DataView(kopf.buffer).setUint32(8, gesamt, true);
  teile.push(kopf);
  const jKopf = new Uint8Array(8);
  new DataView(jKopf.buffer).setUint32(0, jsonPadded.byteLength, true);
  new DataView(jKopf.buffer).setUint32(4, 0x4e4f534a, true);
  teile.push(jKopf, jsonPadded);
  const bKopf = new Uint8Array(8);
  new DataView(bKopf.buffer).setUint32(0, binLen, true);
  new DataView(bKopf.buffer).setUint32(4, 0x004e4942, true);
  teile.push(bKopf, clip.bytes.subarray(binStart + 8, binStart + 8 + binLen));

  const neu = new Uint8Array(gesamt);
  let off = 0;
  for (const t of teile) { neu.set(t, off); off += t.byteLength; }

  const befund = await pruefeExport(timeline, neu, profile);
  assert.equal(befund.passed, false,
    'Export ohne Wurzel-Positionskanal darf nicht durchgehen');
  const meldung = befund.errors.map((e) => e.message).join(' | ');
  assert.match(meldung, /Ortsveränderung|Wurzelposition/,
    `Meldung soll die fehlende Wurzelbewegung benennen, war: "${meldung}"`);
  assert.match(meldung, /\d/,
    `Meldung soll eine Zahl mit Betrag nennen (AGENTS.md), war: "${meldung}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Weitere Negativfälle: unbrauchbare Eingaben scheitern mit Zahl
// ─────────────────────────────────────────────────────────────────────────────

test('Export, Negativfall: Timeline ohne solved.frames wird mit Zahl abgelehnt', async () => {
  const gltf = await geladenesXbot();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  await assert.rejects(
    () => exportiereClip(gltf, { schemaVersion: 1, fps: 30, frameCount: 10 }, profile),
    (err) => {
      assert.match(err.message, /solved\.frames/);
      assert.match(err.message, /\d/, `Meldung soll eine Zahl enthalten, war: "${err.message}"`);
      return true;
    },
    'Eine Timeline ohne gelöste Frames darf nicht still als leere GLB durchgehen'
  );
});

test('Export, Negativfall: falsche Framerate wird mit Zahl und erlaubtem Bereich abgelehnt', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  timeline.fps = 240;   // über FPS_MAX
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  await assert.rejects(
    () => exportiereClip(gltf, timeline, profile),
    (err) => {
      assert.match(err.message, /fps/);
      assert.match(err.message, /\d/, `Meldung soll eine Zahl enthalten, war: "${err.message}"`);
      return true;
    }
  );
});

test('Export, Negativfall: unbekanntes Gelenk wird nicht still weggelassen, sondern mit Zahl abgelehnt', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  timeline.solved.frames[3].joints.knie_links = [0, 0, 0, 1];
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);

  await assert.rejects(
    () => exportiereClip(gltf, timeline, profile),
    (err) => {
      assert.match(err.message, /knie_links/);
      assert.match(err.message, /\d/, `Meldung soll eine Zahl enthalten, war: "${err.message}"`);
      return true;
    }
  );
});

test('Export, Negativfall: RigProfile ohne Pelvis-Rolle wird abgelehnt (kein Raten)', async () => {
  const gltf = await geladenesXbot();
  const timeline = timelineMitWurzelbewegung();
  const box = new (await import('three')).Box3().setFromObject(gltf.scene);
  const profile = rigProfileMitHoehe(box.max.y - box.min.y);
  delete profile.roles.pelvis;

  await assert.rejects(
    () => exportiereClip(gltf, timeline, profile),
    (err) => {
      assert.match(err.message, /pelvis/);
      assert.match(err.message, /\d/, `Meldung soll eine Zahl enthalten, war: "${err.message}"`);
      return true;
    }
  );
});