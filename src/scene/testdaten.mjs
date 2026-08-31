// Testdaten für AP0. Erzeugt GLB-Dateien zur Laufzeit, statt Binärdateien ins
// Repo zu legen — so ist jederzeit nachlesbar, wodurch sich ein Testfall vom
// Positivfall unterscheidet.
//
// Kein *.test.mjs im Namen: `node --test` sammelt diese Datei damit nicht als
// Testdatei ein, sie wird nur importiert.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HIER = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HIER, '..', '..');

/** Das einzige geriggte Bewegungsmaterial im Repo (docs/umsetzung.md). */
export const XBOT_PFAD = join(REPO_ROOT, 'spikes', 'test-b-motion', 'assets', 'Xbot.glb');

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Verzeichnis für erzeugte Testdateien; liegt außerhalb des Repos. */
export function testdatenVerzeichnis() {
  const dir = join(tmpdir(), 'webmcp-ap0-testdaten');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Zerlegt ein GLB in seine beiden Chunks.
 * @param {Buffer} buffer
 * @returns {{json: object, bin: Buffer|null}}
 */
export function glbZerlegen(buffer) {
  const kopf = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (kopf.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`Keine GLB-Datei: Magic ist 0x${kopf.getUint32(0, true).toString(16)}, erwartet 0x46546c67`);
  }

  let json = null;
  let bin = null;
  let offset = 12;

  while (offset < buffer.length) {
    const laenge = kopf.getUint32(offset, true);
    const typ = kopf.getUint32(offset + 4, true);
    const daten = buffer.subarray(offset + 8, offset + 8 + laenge);
    if (typ === CHUNK_JSON) json = JSON.parse(daten.toString('utf8'));
    else if (typ === CHUNK_BIN) bin = Buffer.from(daten);
    offset += 8 + laenge;
  }

  if (!json) throw new Error('GLB ohne JSON-Chunk: 0 von mindestens 1 gefunden');
  return { json, bin };
}

/** Fügt Füllbytes an, bis die Länge durch 4 teilbar ist (GLB-Vorgabe). */
function auffuellen(buffer, fuellbyte) {
  const rest = buffer.length % 4;
  if (rest === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - rest, fuellbyte)]);
}

/**
 * Setzt ein GLB aus JSON- und BIN-Chunk wieder zusammen.
 * @param {object} json
 * @param {Buffer|null} bin
 * @returns {Buffer}
 */
export function glbBauen(json, bin) {
  const jsonChunk = auffuellen(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = bin && bin.length ? auffuellen(bin, 0x00) : null;

  const teile = [];
  const gesamt = 12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);

  const kopf = Buffer.alloc(12);
  kopf.writeUInt32LE(GLB_MAGIC, 0);
  kopf.writeUInt32LE(2, 4);
  kopf.writeUInt32LE(gesamt, 8);
  teile.push(kopf);

  const jsonKopf = Buffer.alloc(8);
  jsonKopf.writeUInt32LE(jsonChunk.length, 0);
  jsonKopf.writeUInt32LE(CHUNK_JSON, 4);
  teile.push(jsonKopf, jsonChunk);

  if (binChunk) {
    const binKopf = Buffer.alloc(8);
    binKopf.writeUInt32LE(binChunk.length, 0);
    binKopf.writeUInt32LE(CHUNK_BIN, 4);
    teile.push(binKopf, binChunk);
  }

  return Buffer.concat(teile);
}

/**
 * Skaliert ein GLB, indem ein neuer Wurzelknoten über alle bisherigen
 * Wurzelknoten gesetzt wird. Das ist verlässlicher, als vorhandene Knoten zu
 * ändern: deren Skalierung kann bereits belegt sein — Xbot steht auf 0,01.
 *
 * @param {Buffer} buffer  Ausgangs-GLB
 * @param {number} faktor  Skalierungsfaktor
 * @returns {Buffer}
 */
export function glbSkalieren(buffer, faktor) {
  const { json, bin } = glbZerlegen(buffer);
  const szeneIndex = json.scene ?? 0;
  const szene = json.scenes[szeneIndex];

  json.nodes.push({
    name: `testskalierung_${faktor}`,
    children: [...szene.nodes],
    scale: [faktor, faktor, faktor],
  });
  szene.nodes = [json.nodes.length - 1];

  return glbBauen(json, bin);
}

/**
 * Erzeugt eine Kopie von Xbot mit einer bestimmten Körperhöhe in Metern.
 * Der Faktor wird aus der gemessenen Ausgangshöhe gerechnet, nicht geraten.
 *
 * @param {number} zielHoeheMeter
 * @param {number} ausgangsHoeheMeter gemessene Höhe des Originals
 * @returns {string} Pfad der erzeugten Datei
 */
export function xbotAufHoehe(zielHoeheMeter, ausgangsHoeheMeter) {
  const faktor = zielHoeheMeter / ausgangsHoeheMeter;
  const glb = glbSkalieren(readFileSync(XBOT_PFAD), faktor);
  const pfad = join(testdatenVerzeichnis(), `xbot_${zielHoeheMeter.toFixed(2)}m.glb`);
  writeFileSync(pfad, glb);
  return pfad;
}

/**
 * Erzeugt ein gültiges GLB mit genau einem Würfel-Mesh und keinerlei Skinning:
 * keine `skins`, keine JOINTS_0/WEIGHTS_0, keine Knochen.
 *
 * Das ist der Negativfall für den Ladetest. Bewusst von Hand gebaut statt aus
 * Xbot abgeleitet: so ist ausgeschlossen, dass ein Rest des Originalskeletts
 * die Prüfung zufällig besteht.
 *
 * @returns {string} Pfad der erzeugten Datei
 */
export function wuerfelOhneSkelett() {
  // Ein Würfel als 12 Dreiecke, 8 Ecken, Kantenlänge 1 m.
  const ecken = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const indizes = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ]);

  const eckenBytes = Buffer.from(ecken.buffer);
  const indexBytes = auffuellen(Buffer.from(indizes.buffer), 0x00);
  const bin = Buffer.concat([eckenBytes, indexBytes]);

  const json = {
    asset: { version: '2.0', generator: 'AP0 Testdaten — Würfel ohne Skelett' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'WuerfelOhneSkelett' }],
    meshes: [{
      name: 'Wuerfel',
      primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: 8, type: 'VEC3',
        min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: eckenBytes.length, target: 34962 },
      { buffer: 0, byteOffset: eckenBytes.length, byteLength: indizes.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const pfad = join(testdatenVerzeichnis(), 'wuerfel_ohne_skelett.glb');
  writeFileSync(pfad, glbBauen(json, bin));
  return pfad;
}

/** Liest eine Datei als ArrayBuffer, wie ihn `loadGLB` erwartet. */
export function alsArrayBuffer(pfad) {
  const b = readFileSync(pfad);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
