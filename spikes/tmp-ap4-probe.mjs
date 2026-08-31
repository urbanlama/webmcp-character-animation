// Wegwerf-Inspektion für AP4: prüft die Skin-Mathe der Xbot.glb in reinem Node.
// Wird gelöscht, sobald die Konventionen feststehen.
import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('./test-b-motion/assets/Xbot.glb', import.meta.url));
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
let binStart = 20 + jsonLen;
const binLen = buf.readUInt32LE(binStart);
const bin = buf.subarray(binStart + 8, binStart + 8 + binLen);

const COMP = { 5120: ['i8', 1], 5121: ['u8', 1], 5122: ['i16', 2], 5123: ['u16', 2], 5125: ['u32', 4], 5126: ['f32', 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(accIdx) {
  const acc = json.accessors[accIdx];
  const [type, csize] = COMP[acc.componentType];
  const n = NCOMP[acc.type];
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride || n * csize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset + base, acc.count * stride);
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      const off = i * stride + c * csize;
      if (type === 'f32') row.push(dv.getFloat32(off, true));
      else if (type === 'u16') row.push(dv.getUint16(off, true));
      else if (type === 'u8') row.push(dv.getUint8(off, true));
      else if (type === 'u32') row.push(dv.getUint32(off, true));
      else throw new Error('Typ ' + type);
    }
    out.push(n === 1 ? row[0] : row);
  }
  return out;
}

// --- Bind-Pose-Weltmatrizen der Joints aus den inversen Bind-Matrizen ---
function invert4(m) {
  // m: col-major Float32Array(16) wie glTF
  const inv = [], det = 'placeholder';
  // kleines generisches Verfahren per Gauß
  const n = 4, M = [ [...m.slice(0,4)], [...m.slice(4,8)], [...m.slice(8,12)], [...m.slice(12,16)] ];
  const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]]; [I[i], I[p]] = [I[p], I[i]];
    const d = M[i][i];
    for (let c = 0; c < n; c++) { M[i][c] /= d; I[i][c] /= d; }
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      for (let c = 0; c < n; c++) { M[r][c] -= f * M[i][c]; I[r][c] -= f * I[i][c]; }
    }
  }
  return I.flat();
}

const skin = json.skins[0];
const ibmRaw = readAccessor(skin.inverseBindMatrices); // 67 MAT4, col-major
const bindMats = ibmRaw.map(m => invert4(Float32Array.from(m)));
const joints = skin.joints; // node-Indizes
const jointName = (i) => json.nodes[i].name.replace('mixamorig:', '');

for (const name of ['Hips', 'LeftFoot', 'RightFoot', 'Head', 'LeftToe_End', 'LeftHand']) {
  const idx = joints.findIndex((ni) => jointName(ni) === name);
  const t = bindMats[idx];
  const px = t[12], py = t[13], pz = t[14];
  console.log(`bind ${name}: pos=[${px.toFixed(4)}, ${py.toFixed(4)}, ${pz.toFixed(4)}]`);
}

// --- Schema-Check: Mesh-Vertices in welcher Einheit? ---
const posAccId = json.meshes[0].primitives[0].attributes.POSITION;
const pos = readAccessor(posAccId);
const a0 = json.accessors[posAccId];
console.log('mesh0 POSITION min', a0.min, 'max', a0.max);

// Vergleich: erstes Vertex überall — roh vs. geskinnt bei Animationszeit 0 (Pose = Bind?)
// Prüft, ob jointMatrix_j = meshNodeWorld × jointWorld × IBM == Identität in Bind-Pose.
console.log('erster Vertex (roh):', pos[0].map(v => v.toFixed(5)));

//Animation: Sampling-Layout eines Kanals für Hips in 'idle'
const anim = json.animations.find(a => a.name === 'walk');
const hipsNode = json.nodes.findIndex(n => n.name.includes('Hips'));
const ch = anim.channels.find(c => c.target.node === hipsNode && c.target.path === 'rotation');
console.log('walk Hips rotation sampler:', ch.sampler, 'interpolation:', anim.samplers[ch.sampler].interpolation || 'LINEAR');
const tin = readAccessor(anim.samplers[ch.sampler].input).slice(0, 5);
console.log('Erste Sampler-Zeiten:', tin);