// Rig-Schicht: semantische Gelenke, Freiheitsgrade, Massenverteilung.
// Für den Spike auf das Mixamo-Schema festgelegt (bewusst hartkodiert).

import * as THREE from 'three';

const B = (n) => 'mixamorig' + n;

// Semantischer Name -> Knochen. Reihenfolge = Ausgabereihenfolge in Berichten.
export const JOINTS = {
  pelvis:      { bone: B('Hips'),          dof: { tilt: 'x', turn: 'y', roll: 'z' }, limits: { tilt: [-40, 40], turn: [-90, 90], roll: [-30, 30] } },
  spine_low:   { bone: B('Spine'),         dof: { bend: 'x', turn: 'y', side: 'z' }, limits: { bend: [-25, 35], turn: [-25, 25], side: [-25, 25] } },
  spine_mid:   { bone: B('Spine1'),        dof: { bend: 'x', turn: 'y', side: 'z' }, limits: { bend: [-25, 35], turn: [-25, 25], side: [-25, 25] } },
  spine_top:   { bone: B('Spine2'),        dof: { bend: 'x', turn: 'y', side: 'z' }, limits: { bend: [-25, 35], turn: [-25, 25], side: [-25, 25] } },
  neck:        { bone: B('Neck'),          dof: { bend: 'x', turn: 'y', side: 'z' }, limits: { bend: [-40, 40], turn: [-45, 45], side: [-30, 30] } },
  head:        { bone: B('Head'),          dof: { bend: 'x', turn: 'y', side: 'z' }, limits: { bend: [-35, 30], turn: [-45, 45], side: [-30, 30] } },

  shoulder_l:  { bone: B('LeftShoulder'),  dof: { shrug: 'z', fwd: 'y' },            limits: { shrug: [-20, 25], fwd: [-25, 25] } },
  shoulder_r:  { bone: B('RightShoulder'), dof: { shrug: 'z', fwd: 'y' },            limits: { shrug: [-25, 20], fwd: [-25, 25] } },
  arm_l:       { bone: B('LeftArm'),       dof: { lift: 'z', fwd: 'y', twist: 'x' }, limits: { lift: [-170, 40], fwd: [-90, 130], twist: [-90, 90] } },
  arm_r:       { bone: B('RightArm'),      dof: { lift: 'z', fwd: 'y', twist: 'x' }, limits: { lift: [-40, 170], fwd: [-130, 90], twist: [-90, 90] } },
  elbow_l:     { bone: B('LeftForeArm'),   dof: { bend: 'y', twist: 'x' },           limits: { bend: [-150, 2], twist: [-90, 90] } },
  elbow_r:     { bone: B('RightForeArm'),  dof: { bend: 'y', twist: 'x' },           limits: { bend: [-2, 150], twist: [-90, 90] } },
  hand_l:      { bone: B('LeftHand'),      dof: { bend: 'z', side: 'y' },            limits: { bend: [-80, 80], side: [-30, 30] } },
  hand_r:      { bone: B('RightHand'),     dof: { bend: 'z', side: 'y' },            limits: { bend: [-80, 80], side: [-30, 30] } },

  hip_l:       { bone: B('LeftUpLeg'),     dof: { flex: 'x', spread: 'z', twist: 'y' }, limits: { flex: [-30, 130], spread: [-45, 30], twist: [-45, 45] } },
  hip_r:       { bone: B('RightUpLeg'),    dof: { flex: 'x', spread: 'z', twist: 'y' }, limits: { flex: [-30, 130], spread: [-30, 45], twist: [-45, 45] } },
  knee_l:      { bone: B('LeftLeg'),       dof: { bend: 'x' },                       limits: { bend: [0, 150] } },
  knee_r:      { bone: B('RightLeg'),      dof: { bend: 'x' },                       limits: { bend: [0, 150] } },
  ankle_l:     { bone: B('LeftFoot'),      dof: { point: 'x', tilt: 'z' },           limits: { point: [-45, 55], tilt: [-25, 25] } },
  ankle_r:     { bone: B('RightFoot'),     dof: { point: 'x', tilt: 'z' },           limits: { point: [-45, 55], tilt: [-25, 25] } },
  toes_l:      { bone: B('LeftToeBase'),   dof: { bend: 'x' },                       limits: { bend: [-40, 60] } },
  toes_r:      { bone: B('RightToeBase'),  dof: { bend: 'x' },                       limits: { bend: [-40, 60] } }
};

// Kollisionskapseln: Segment von Knochen A nach Knochen B, mit Radius (Meter).
export const SEGMENTS = [
  { id: 'torso',      from: B('Hips'),           to: B('Neck'),            r: 0.135, mass: 0.43 },
  { id: 'head',       from: B('Neck'),           to: B('HeadTop_End'),     r: 0.100, mass: 0.081 },
  { id: 'upperarm_l', from: B('LeftArm'),        to: B('LeftForeArm'),     r: 0.050, mass: 0.027 },
  { id: 'forearm_l',  from: B('LeftForeArm'),    to: B('LeftHand'),        r: 0.042, mass: 0.016 },
  { id: 'hand_l',     from: B('LeftHand'),       to: B('LeftHandMiddle3'), r: 0.038, mass: 0.006 },
  { id: 'upperarm_r', from: B('RightArm'),       to: B('RightForeArm'),    r: 0.050, mass: 0.027 },
  { id: 'forearm_r',  from: B('RightForeArm'),   to: B('RightHand'),       r: 0.042, mass: 0.016 },
  { id: 'hand_r',     from: B('RightHand'),      to: B('RightHandMiddle3'),r: 0.038, mass: 0.006 },
  { id: 'thigh_l',    from: B('LeftUpLeg'),      to: B('LeftLeg'),         r: 0.075, mass: 0.100 },
  { id: 'shin_l',     from: B('LeftLeg'),        to: B('LeftFoot'),        r: 0.055, mass: 0.043 },
  { id: 'foot_l',     from: B('LeftFoot'),       to: B('LeftToe_End'),     r: 0.045, mass: 0.015 },
  { id: 'thigh_r',    from: B('RightUpLeg'),     to: B('RightLeg'),        r: 0.075, mass: 0.100 },
  { id: 'shin_r',     from: B('RightLeg'),       to: B('RightFoot'),       r: 0.055, mass: 0.043 },
  { id: 'foot_r',     from: B('RightFoot'),      to: B('RightToe_End'),    r: 0.045, mass: 0.015 }
];

// Segmentpaare, die sich berühren dürfen (benachbart oder anatomisch unvermeidlich).
const ADJACENT = new Set();
(function () {
  const pairs = [
    ['torso','head'], ['torso','upperarm_l'], ['torso','upperarm_r'],
    ['torso','thigh_l'], ['torso','thigh_r'],
    ['upperarm_l','forearm_l'], ['forearm_l','hand_l'],
    ['upperarm_r','forearm_r'], ['forearm_r','hand_r'],
    ['thigh_l','shin_l'], ['shin_l','foot_l'],
    ['thigh_r','shin_r'], ['shin_r','foot_r'],
    ['thigh_l','thigh_r'],
    ['head','upperarm_l'], ['head','upperarm_r']
  ];
  for (const [a, b] of pairs) { ADJACENT.add(a + '|' + b); ADJACENT.add(b + '|' + a); }
})();
export const isAdjacent = (a, b) => ADJACENT.has(a + '|' + b);

export const CONTACT_POINTS = [
  { id: 'heel_l', bone: B('LeftFoot'),   offset: [0, -0.07, -0.045] },
  { id: 'toe_l',  bone: B('LeftToe_End'),offset: [0, -0.02, 0] },
  { id: 'heel_r', bone: B('RightFoot'),  offset: [0, -0.07, -0.045] },
  { id: 'toe_r',  bone: B('RightToe_End'),offset: [0, -0.02, 0] },
  { id: 'hand_l', bone: B('LeftHand'),   offset: [0, 0, 0] },
  { id: 'hand_r', bone: B('RightHand'),  offset: [0, 0, 0] }
];

// Was ein positiver Wert bedeuten SOLL, gemessen am Ende der Kette.
// achse: 'x' nach links, 'y' hoch, 'z' vorne. mirror: rechte Seite spiegelt x.
export const DOF_MEANING = {
  bend:  { axis: 'z', want: +1, mirror: false },   // Wirbelsaeule/Kopf: nach vorne beugen
  side:  { axis: 'x', want: +1, mirror: true  },   // zur Seite neigen: positiv = zur eigenen linken
  turn:  { axis: 'x', want: +1, mirror: true  },
  tilt:  { axis: 'x', want: +1, mirror: true  },
  roll:  { axis: 'x', want: +1, mirror: true  },
  shrug: { axis: 'y', want: +1, mirror: false },   // Schulter hoch
  fwd:   { axis: 'z', want: +1, mirror: false },   // nach vorne
  lift:  { axis: 'y', want: +1, mirror: false },   // Arm heben
  twist: { axis: 'x', want: +1, mirror: true  },
  flex:  { axis: 'z', want: +1, mirror: false },   // Hueftbeugung: Knie nach vorne
  spread:{ axis: 'x', want: +1, mirror: true  },   // Bein nach aussen
  point: { axis: 'y', want: -1, mirror: false }    // Fussspitze nach unten strecken
};
// Sonderfaelle, die sich nicht am Kettenende messen lassen:
//   knee.bend  -> Ferse nach hinten (z negativ)
//   elbow.bend -> Hand nach vorne  (z positiv)
const DOF_SPECIAL = { knee: { bend: { axis: 'z', want: -1, mirror: false } },
                      elbow:{ bend: { axis: 'z', want: +1, mirror: false } },
                      toes: { bend: { axis: 'y', want: +1, mirror: false } } };
export const dofMeaning = (joint, dof) => {
  const group = joint.replace(/_(l|r)$/, '');
  return (DOF_SPECIAL[group] && DOF_SPECIAL[group][dof]) || DOF_MEANING[dof] || null;
};

// Welches Kettenende zeigt die Wirkung eines Gelenks am deutlichsten?
export const END_OF = {
  pelvis:'mixamorigHead', spine_low:'mixamorigHead', spine_mid:'mixamorigHead', spine_top:'mixamorigHead',
  neck:'mixamorigHeadTop_End', head:'mixamorigHeadTop_End',
  shoulder_l:'mixamorigLeftHand', arm_l:'mixamorigLeftHand', elbow_l:'mixamorigLeftHand', hand_l:'mixamorigLeftHandMiddle3',
  shoulder_r:'mixamorigRightHand', arm_r:'mixamorigRightHand', elbow_r:'mixamorigRightHand', hand_r:'mixamorigRightHandMiddle3',
  hip_l:'mixamorigLeftToe_End', knee_l:'mixamorigLeftToe_End', ankle_l:'mixamorigLeftToe_End', toes_l:'mixamorigLeftToe_End',
  hip_r:'mixamorigRightToe_End', knee_r:'mixamorigRightToe_End', ankle_r:'mixamorigRightToe_End', toes_r:'mixamorigRightToe_End'
};

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const DEG = Math.PI / 180;

export class Rig {
  constructor(scene) {
    this.bones = new Map();
    this.skinned = null;
    scene.traverse((o) => {
      if (o.isBone) this.bones.set(o.name, o);
      if (o.isSkinnedMesh && !this.skinned) this.skinned = o;
    });
    this.root = this.bones.get(B('Hips'));
    // Bind-Pose sichern: alle Agent-Winkel sind Abweichungen davon.
    this.bind = new Map();
    for (const [name, b] of this.bones) {
      this.bind.set(name, { q: b.quaternion.clone(), p: b.position.clone() });
    }
    this.rootBindPos = this.root.position.clone();
    this.signs = {};              // gemessene Vorzeichen je Gelenk/Freiheitsgrad
    this.profile = null;          // wird nach dem Laden aus dem Mesh gemessen
    this.pairTol = {};            // gelernte Mindestabstände je Segmentpaar
    this.totalMass = SEGMENTS.reduce((s, x) => s + x.mass, 0);
  }

  /** Übernimmt das gemessene Körperprofil. Ab hier wird nichts mehr geschätzt. */
  setProfile(profile) {
    this.profile = profile;
    this.totalMass = SEGMENTS.reduce((s, x) => s + (profile.masses[x.id] ?? x.mass), 0);
  }

  reset() {
    for (const [name, b] of this.bones) {
      const bd = this.bind.get(name);
      b.quaternion.copy(bd.q);
      b.position.copy(bd.p);
    }
  }

  /** pose: { joint: { dofName: grad, ... } }, root: { x,y,z, tilt,turn,roll } */
  apply(pose, root) {
    this.reset();
    for (const jname in pose) {
      const def = JOINTS[jname];
      if (!def) continue;
      const bone = this.bones.get(def.bone);
      if (!bone) continue;
      const q = new THREE.Quaternion();
      for (const dof in pose[jname]) {
        const axis = def.dof[dof];
        if (!axis) continue;
        const sign = (this.signs[jname] && this.signs[jname][dof]) || 1;
        const deg = (Number(pose[jname][dof]) || 0) * sign;
        q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS[axis], deg * DEG));
      }
      bone.quaternion.copy(this.bind.get(def.bone).q).multiply(q);
    }
    if (root) {
      this.root.position.set(
        this.rootBindPos.x + (root.x || 0),
        this.rootBindPos.y + (root.y || 0),
        this.rootBindPos.z + (root.z || 0)
      );
      const q = new THREE.Quaternion();
      if (root.turn) q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS.y, root.turn * DEG));
      if (root.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS.x, root.tilt * DEG));
      if (root.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS.z, root.roll * DEG));
      // Beckendrehung aus der Pose bleibt erhalten, die Wurzeldrehung kommt davor.
      this.root.quaternion.premultiply(q);
    }
    this.root.updateMatrixWorld(true);
  }

  worldPos(boneName, out) {
    const b = this.bones.get(boneName);
    if (!b) return null;
    return b.getWorldPosition(out || new THREE.Vector3());
  }

  /** Massegewichteter Schwerpunkt über die Segmentmitten. */
  centerOfMass() {
    const com = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const s of SEGMENTS) {
      const ba = this.bones.get(s.from), bb = this.bones.get(s.to);
      if (!ba || !bb) continue;
      ba.getWorldPosition(a); bb.getWorldPosition(b);
      const m = this.profile ? (this.profile.masses[s.id] ?? s.mass) : s.mass;
      com.addScaledVector(a.clone().add(b).multiplyScalar(0.5), m);
    }
    return com.divideScalar(this.totalMass);
  }

  /** Kapsel-Endpunkte aller Segmente in Weltkoordinaten. */
  capsules() {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const out = [];
    for (const s of SEGMENTS) {
      const ba = this.bones.get(s.from), bb = this.bones.get(s.to);
      if (!ba || !bb) continue;
      ba.getWorldPosition(a); bb.getWorldPosition(b);
      const r = this.profile ? (this.profile.radii[s.id] ?? s.r) : s.r;
      out.push({ id: s.id, a: a.clone(), b: b.clone(), r });
    }
    return out;
  }

  contactPoints() {
    // Sohlenpunkte kommen aus dem gemessenen Profil; Hände zusätzlich als mögliche Stützpunkte.
    const out = [];
    if (this.profile && this.profile.soles.length) {
      for (const s of this.profile.soles) {
        const bone = this.bones.get(s.bone);
        if (!bone) continue;
        out.push({ id: s.id, pos: bone.localToWorld(new THREE.Vector3(s.local[0], s.local[1], s.local[2])) });
      }
    }
    for (const cp of CONTACT_POINTS) {
      if (!cp.id.startsWith('hand')) continue;
      const bone = this.bones.get(cp.bone);
      if (bone) out.push({ id: cp.id, pos: bone.localToWorld(new THREE.Vector3(...cp.offset)) });
    }
    return out;
  }

  /** Tiefster Punkt des gehäuteten Meshs — exakt, nicht über Kapseln genähert. */
  lowestVertex() {
    if (!this.profile || !this.skinned) return null;
    const v = new THREE.Vector3();
    let minY = Infinity, at = null;
    for (const i of this.profile.probes) {
      this.skinned.getVertexPosition(i, v);
      this.skinned.localToWorld(v);
      if (v.y < minY) { minY = v.y; at = v.clone(); }
    }
    return { y: minY, pos: at };
  }

  describe() {
    const out = {};
    for (const j in JOINTS) {
      out[j] = { dof: Object.keys(JOINTS[j].dof), limits: JOINTS[j].limits };
    }
    return out;
  }
}
