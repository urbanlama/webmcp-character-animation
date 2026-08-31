// Wegwerf-Skript: verifiziert die fremden Humanoid-GLBs in Node.
// Meldet je Modell: Knochen, Skins, Meshes, Vertices, AnimationClips,
// Bounding-Box in Metern. Kein Browser, kein Rendering.
//
//   node verify.mjs [pfad-zu-glb ...]
//   node verify.mjs          (prueft alle *.glb im uebergeordneten Ordner)

// Voraussetzung: node_modules/three im Repo-Root (wurde von AP0 angelegt).
// Fallback, falls npm-three je fehlt: unter _check/node_modules/three/ liegt
// ein Stellvertreter, der auf die Kopie in spikes/test-b-motion/assets zeigt
// (three.module.min.js + GLTFLoader.js + utils/BufferGeometryUtils.js unter
// node_modules/three/addons/{loaders,utils}/). Beide Wege funktionieren.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// GLTFLoader nutzt 'self' (Browser-Global) beim Texturladen. In Node fehlt es.
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(HERE, '..');

function parseGlb(buffer, file) {
  return new Promise((res, rej) => {
    const loader = new GLTFLoader();
    loader.parse(buffer, '', (gltf) => res(gltf), (e) => rej(new Error(`${file}: ${e?.message || e}`)));
  });
}

// GLTFLoader erwartet einen echten ArrayBuffer, kein Node-Buffer.
function readGlb(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// CLI-Pfade auf Dateinamen relativ zum Modellordner kürzen; absolute Pfade
// innerhalb von models/fremde bleiben relativ erhalten.
function relFromModels(p) {
  const abs = resolve(p);
  return abs.slice(MODELS.length + 1);
}

function fmt3(x) { return Number(x).toFixed(3); }

function bboxMeters(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  if (box.isEmpty()) return { size: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0], empty: true };
  box.getSize(size);
  return {
    empty: false,
    size: [size.x, size.y, size.z].map(fmt3),
    min: [box.min.x, box.min.y, box.min.z].map(fmt3),
    max: [box.max.x, box.max.y, box.max.z].map(fmt3),
  };
}

function vertexCount(scene) {
  let n = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      const g = o.geometry;
      if (g && g.attributes && g.attributes.position) n += g.attributes.position.count;
    }
  });
  return n;
}

async function verifyFile(file) {
  const path = join(MODELS, file);
  const buffer = readGlb(path);
  const sizeMB = buffer.byteLength / (1024 * 1024);
  try {
    const gltf = await parseGlb(buffer, file);
    const scene = gltf.scene || gltf.scenes?.[0];
    let bones = 0, skins = 0, meshes = 0;
    const boneNames = [];
    const skinJointCounts = [];
    scene.traverse((o) => {
      if (o.isBone) { bones++; boneNames.push(o.name); }
      if (o.isSkinnedMesh && o.skeleton) { skins++; skinJointCounts.push(o.skeleton.bones.length); }
      if (o.isMesh || o.isSkinnedMesh) meshes++;
    });
    // Knochen, die nur als Skeleton-Joint existieren und nicht Teil der Szene sind:
    if (bones === 0 && skins > 0) {
      const seen = new Set();
      scene.traverse((o) => {
        if (o.isSkinnedMesh && o.skeleton) {
          for (const b of o.skeleton.bones) { if (!seen.has(b.uuid)) { seen.add(b.uuid); bones++; boneNames.push(b.name); } }
        }
      });
    }
    const clips = (gltf.animations || []).map((c) => c.name || '(unbenannt)');
    const bb = bboxMeters(scene);
    const verts = vertexCount(scene);
    return {
      file, sizeMB: sizeMB.toFixed(2), ok: true,
      bones, skins, skinJointCounts: skinJointCounts.join('+'),
      meshes, verts, clips, nClips: clips.length,
      bbox: bb,
      boneSample: boneNames.slice(0, 25),
    };
  } catch (e) {
    return { file, sizeMB: sizeMB.toFixed(2), ok: false, error: String(e.message || e) };
  }
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => {
      const abs = resolve(p);
      return abs.startsWith(MODELS) ? relFromModels(p) : p.replace(/^.*[\\/]/, '');
    })
  : readdirSync(MODELS).filter((f) => f.toLowerCase().endsWith('.glb')).sort();

console.log(`Dateien: ${files.length}`);
const results = [];
for (const f of files) {
  process.stdout.write(`Pruefe ${f} ... `);
  const r = await verifyFile(f);
  results.push(r);
  console.log(r.ok ? 'ok' : 'FEHLER');
}

for (const r of results) {
  console.log('\n=====================================================');
  if (!r.ok) {
    console.log(`${r.file}  (${r.sizeMB} MB)`);
    console.log(`  FEHLER: ${r.error}`);
    continue;
  }
  console.log(`${r.file}  (${r.sizeMB} MB)`);
  console.log(`  Knochen         : ${r.bones}`);
  console.log(`  Skins           : ${r.skins} (Joints je Skin: ${r.skinJointCounts || '-'})`);
  console.log(`  Meshes          : ${r.meshes}`);
  console.log(`  Vertices        : ${r.verts}`);
  console.log(`  AnimationClips  : ${r.nClips}${r.clips.length ? ' -> ' + r.clips.join(', ') : ''}`);
  console.log(`  BBox (m) x/y/z  : ${r.bbox.size.join(' / ')}${r.bbox.empty ? '  (leer!)' : ''}`);
  console.log(`  BBox min        : ${r.bbox.min.join(' / ')}`);
  console.log(`  BBox max        : ${r.bbox.max.join(' / ')}`);
  if (r.boneSample.length) console.log(`  Knochennamen    : ${r.boneSample.join(', ')}${r.bones > r.boneSample.length ? ' ...' : ''}`);
}

// Gesamturteil: Zweibein-Kriterium heuristisch ueber die BBox (X-Vorbreitung und
// Y-Hoehe). Als Grobpruefung: Hoehe deutlich > Breite UND > Tiefe.
console.log('\n=====================================================');
console.log('Grobpruefung Humanoid (Heuristik aus BBox):');
for (const r of results) {
  if (!r.ok) continue;
  const [w, h, d] = r.bbox.size.map(Number);
  const verdict = (!r.bbox.empty && h > w && h > d && r.bones >= 15 && r.skins >= 1)
    ? 'grobe Merkmale erfuellt' : 'MERKWUERDIG - von Hand ansehen';
  console.log(`  ${r.file}: Hoehe ${h} m, Breite ${w} m, Tiefe ${d} m, ${r.bones} Knochen -> ${verdict}`);
}