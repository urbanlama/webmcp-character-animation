// GLB-Hilfe für die AP4-Tests: liest die Xbot.glb in reinem Node (kein three.js,
// keine npm-Abhängigkeit) und stellt Sampler für Knochen-Weltpositionen bereit.
// Einheiten: Meter. Die Einheit steht nicht im Vertrag — die Armature-Skala wird
// aus der Datei gelesen, nicht getippt.

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buffer) {
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    throw new Error(`magic = 0x${magic.toString(16)}: erwartet 0x46546c67 ("glTF")`);
  }
  const jsonLen = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLen).toString('utf8'));
  let off = 20 + jsonLen;
  let bin = null;
  if (off < buffer.length) {
    const binLen = buffer.readUInt32LE(off);
    const binType = buffer.readUInt32BE(off + 4);
    if (binType === 0x004e4942 || (binType >>> 8) === 0x42494e) { bin = buffer.subarray(off + 8, off + 8 + binLen); }
  }
  if (!bin) throw new Error('kein BIN-Chunk in der GLB-Datei gefunden');
  return { json, bin };
}

function readAccessor(bin, json, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const n = NCOMP[acc.type];
  const cs = COMP_SIZE[acc.componentType];
  const stride = bv.byteStride || n * cs;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = [];
  for (let k = 0; k < acc.count; k++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * cs;
      switch (acc.componentType) {
        case 5126: row.push(dv.getFloat32(o, true)); break;
        case 5125: row.push(dv.getUint32(o, true)); break;
        case 5123: row.push(dv.getUint16(o, true)); break;
        case 5122: row.push(dv.getInt16(o, true)); break;
        case 5121: row.push(dv.getUint8(o, true)); break;
        case 5120: row.push(dv.getInt8(o, true)); break;
        default: throw new Error(`componentType ${acc.componentType}: nicht unterstützt`);
      }
    }
    out.push(n === 1 ? row[0] : row);
  }
  return out;
}

function mat4Invert(m) {
  const A = [m.slice(0, 4), m.slice(4, 8), m.slice(8, 12), m.slice(12, 16)];
  const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) throw new Error('Bind-Matrix singulär, nicht invertierbar');
    [A[i], A[p]] = [A[p], A[i]]; [I[i], I[p]] = [I[p], I[i]];
    const d = A[i][i];
    for (let c = 0; c < 4; c++) { A[i][c] /= d; I[i][c] /= d; }
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let c = 0; c < 4; c++) { A[r][c] -= f * A[i][c]; I[r][c] -= f * I[i][c]; }
    }
  }
  return I.flat();
}

function mat4Mul(m, n) {
  const r = new Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      r[row * 4 + col] =
        m[row * 4] * n[col] + m[row * 4 + 1] * n[4 + col] +
        m[row * 4 + 2] * n[8 + col] + m[row * 4 + 3] * n[12 + col];
    }
  }
  return r;
}

export function mat4Apply(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ];
}

function mat4FromTRS(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0],
    (xy + wz) * s[0], (1 - (xx + zz)) * s[1], (yz - wx) * s[2], t[1],
    (xz - wy) * s[0], (yz + wx) * s[1], (1 - (xx + yy)) * s[2], t[2],
    0, 0, 0, 1,
  ];
}

function quatSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) {
    const r = a.map((v, i) => v + (bb[i] - v) * t);
    const n = Math.hypot(r[0], r[1], r[2], r[3]);
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th = Math.acos(Math.min(1, d));
  const st = Math.sin(th);
  const s0 = Math.sin((1 - t) * th) / st;
  const s1 = Math.sin(t * th) / st;
  return [s0 * a[0] + s1 * bb[0], s0 * a[1] + s1 * bb[1], s0 * a[2] + s1 * bb[2], s0 * a[3] + s1 * bb[3]];
}

/**
 * Lädt ein GLB mit genau einem Skin. Rückgabe:
 *  joints: [{ name, gltfNode }]  in Skin-Reihenfolge
 *  bindMatrices: [16] je Joint, zeilenweise, im Mesh-Node-Weltraum
 *  meshNodeWorld: [16] zeilenweise (enthält die globale Einheiten-Skala)
 *  animations: [{ name, samplePosition(jointIndex, t) -> [x,y,z] }]
 *  boneNamesByIdx: {gltfNodeIndex -> 'Name'}
 */
export function loadGlb(buffer) {
  const { json, bin } = parseGlb(buffer);
  const readAcc = (i) => readAccessor(bin, json, i);
  const skin = json.skins[0];
  if (!skin) throw new Error('kein skins[0]: Datei hat kein geriggtes Skelett');

  const ibmCol = readAcc(skin.inverseBindMatrices);
  const ibmRow = ibmCol.map((m) => [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ]);
  const bindWorld = ibmRow.map(mat4Invert);

  // Elternkette je Node, lokale Matrizen
  const nodeCount = json.nodes.length;
  const parent = new Array(nodeCount).fill(-1);
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  function localMat(i) {
    const n = json.nodes[i];
    if (n.matrix) {
      return [
        n.matrix[0], n.matrix[4], n.matrix[8], n.matrix[12],
        n.matrix[1], n.matrix[5], n.matrix[9], n.matrix[13],
        n.matrix[2], n.matrix[6], n.matrix[10], n.matrix[14],
        n.matrix[3], n.matrix[7], n.matrix[11], n.matrix[15],
      ];
    }
    return mat4FromTRS(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);
  }
  function worldMat(i) {
    const chain = [];
    let cur = i;
    while (cur !== -1) { chain.push(cur); cur = parent[cur]; }
    let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for (let k = chain.length - 1; k >= 0; k--) m = mat4Mul(m, localMat(chain[k]));
    return m;
  }

  let meshNode = -1;
  for (let i = 0; i < nodeCount; i++) {
    const n = json.nodes[i];
    if (n.mesh !== undefined && n.skin !== undefined) {
      const mesh = json.meshes[n.mesh];
      if (mesh.primitives.some((p) => p.attributes.JOINTS_0 !== undefined)) { meshNode = i; break; }
    }
  }
  if (meshNode === -1) throw new Error('kein geskinntes Mesh mit JOINTS_0 gefunden');
  const meshNodeWorld = worldMat(meshNode);

  const joints = skin.joints.map((nodeIdx, i) => ({
    name: (json.nodes[nodeIdx].name || `joint_${i}`).replace(/^mixamorig:/, ''),
    gltfNode: nodeIdx,
  }));
  const jointByNode = new Map(skin.joints.map((nodeIdx, i) => [nodeIdx, i]));

  // Für Animations-Sampling: Weltposition eines Joints = meshNodeWorld × jointLocalChain ...
  // In glTF lautet die Skin-Formel: jointMatrix_j = inv(meshNodeWorld) × jointWorld × IBM.
  // Geskinnte Position = Σ w_i × jointMatrix_i × v, alles im Weltraum des Mesh-Nodes.
  // Wir wollen Knochen-Weltpositionen im Weltraum über meshNodeWorld: jointWorld = Welt.
  // jointWorld gilt im globalen Weltraum; da meshNodeWorld bei Xbot nur Skala ist,
  // multiplizieren wir am Ende damit heraus. Konkret: pos_world = meshNodeWorld × pos_skinSpace.
  // Wir rechnen die Kette je Joint relativ zur Skins-Wurzel auf.

  // Skeleton roots: Nodes im Skin, deren parent kein Joint ist.
  const jointSet = new Set(skin.joints);
  function jointChainMat(nodeIdx) {
    // Weltmatrix des Joints über die Node-Elternkette, Zeilenform.
    const chain = [];
    let cur = nodeIdx;
    while (cur !== -1) { chain.push(cur); cur = parent[cur]; }
    let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for (let k = chain.length - 1; k >= 0; k--) m = mat4Mul(m, localMat(chain[k]));
    return m;
  }

  const animations = (json.animations || []).map((a) => {
    // Kanäle nach (node, path) indizieren
    const chanByNodePath = new Map();
    a.channels.forEach((ch) => {
      chanByNodePath.set(ch.target.node + '|' + ch.target.path, ch.sampler);
    });
    const samplers = a.samplers.map((s) => ({
      times: readAcc(s.input),
      vals: readAcc(s.output),
    }));
    function sampleAt(samplerIdx, t) {
      const { times, vals } = samplers[samplerIdx];
      // vals ist Array-of-Zeilen (je Zeile ncomp Werte), readAccessor liefert Zeilen
      const ncomp = vals.length > 0 ? (Array.isArray(vals[0]) ? vals[0].length : 1) : 0;
      if (ncomp === 0 || times.length === 0) throw new Error(`leerer Sampler in Animation "${a.name}"`);
      const last = times.length - 1;
      const asVec = (row) => (ncomp === 1 ? [row] : row);
      if (t <= times[0]) return asVec(vals[0]);
      if (t >= times[last]) return asVec(vals[last]);
      let lo = 0, hi = last;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
      const span = times[hi] - times[lo];
      const alpha = span > 0 ? (t - times[lo]) / span : 0;
      const va = vals[lo], vb = vals[hi];
      if (ncomp === 4) return quatSlerp(va, vb, alpha);
      return va.map((v, i) => v + (vb[i] - v) * alpha);
    }
    return {
      name: a.name,
      duration: samplers.length ? Math.max(...samplers.map((s) => s.times[s.times.length - 1])) : 0,
      hasChannel(node, path) { return chanByNodePath.has(node + '|' + path); },
      sample(node, path, t) {
        const si = chanByNodePath.get(node + '|' + path);
        if (si === undefined) return null;
        return sampleAt(si, t);
      },
    };
  });

  // Samplet die Weltposition eines Joints zur Zeit t: Kette von der Joint-Wurzel bis
  // zum Joint, lokale TRS aus Animation oder Restpose, dann × meshNodeWorld-Skala.
  function jointWorldPos(anim, nodeIdx, t, cachedLocal) {
    const chain = [];
    let cur = nodeIdx;
    while (cur !== -1) { chain.push(cur); cur = parent[cur]; }
    let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for (let k = chain.length - 1; k >= 0; k--) {
      const n = chain[k];
      let lm;
      if (cachedLocal.has(n)) lm = cachedLocal.get(n);
      else {
        const nd = json.nodes[n];
        let tr = nd.translation || [0, 0, 0];
        let ro = nd.rotation || [0, 0, 0, 1];
        let sc = nd.scale || [1, 1, 1];
        if (anim) {
          const trAnim = anim.sample(n, 'translation', t);
          if (trAnim) tr = trAnim;
          const roAnim = anim.sample(n, 'rotation', t);
          if (roAnim) ro = roAnim;
        }
        lm = mat4FromTRS(tr, ro, sc);
        cachedLocal.set(n, lm);
      }
      m = mat4Mul(m, lm);
    }
    return mat4Apply(m, [0, 0, 0]);
  }

  function sampleJointPositions(animName, t) {
    const anim = animations.find((x) => x.name === animName);
    if (!anim) throw new Error(`Animation "${animName}" nicht gefunden; vorhanden: ${animations.map((x) => x.name).join(', ')}`);
    const cached = new Map();
    const out = joints.map((j) => jointWorldPos(anim, j.gltfNode, t, cached));
    return out; // je Joint [x,y,z] in Metern (meshNodeWorld wendet die Einheit an)
  }

  function bindJointPositions() {
    return joints.map((_, i) => [
      bindWorld[i][3], bindWorld[i][7], bindWorld[i][11],
    ]);
  }

  return {
    joints, bindWorld, meshNodeWorld, animations,
    sampleJointPositions, bindJointPositions,
    json,
  };
}