// AP-Export — glTF-Ausgabe mit Wurzelbewegung (docs/plan.md 6.9).
//
// Schreibt eine gelöste Timeline (plan.md 5.2, `solved.frames`) als GLB mit
// Animation. Der Export trägt die Wurzelbewegung als Position UND Rotation
// der Wurzel — nicht nur Gelenkwinkel. Eine Figur, die auf der Stelle
// springt, statt sich fortzubewegen, ist der typische Fehler dieser Stelle.
//
// Die Prüfung läuft NICHT mit dem eigenen Schreibcode gegen sich selbst
// (plan.md 6.9): der Nachweis ist das unabhängige Wiedereinlesen mit dem
// GLTFLoader (`pruefeExport` unten) und der Zahlenvergleich.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCHNITTSTELLE (schmal, für `export_clip` aus src/tools/)
//
//   import { loadGLB } from '../scene/load.js';
//   import { exportiereClip, pruefeExport } from '../export/gltf.js';
//
//   const gltf = await loadGLB(puffer);                  // geladenes Modell
//   const clip = await exportiereClip(gltf, timeline, rigProfile);
//   // clip.bytes      — Uint8Array, eine vollständige GLB-Datei
//   // clip.warnings   — Frames, die ohne Wurzelwert ausfielen
//   await writeFileSync('clip.glb', clip.bytes);
//
//   const befund = await pruefeExport(timeline, clip.bytes, rigProfile);
//   // befund.passed   — true nur, wenn der Wiedereinlese-Vergleich passt
//   // befund.errors   — jede Meldung nennt Frame, Betrag und Toleranz
//
// timeline: plan.md 5.2. Gelesen werden NUR `fps` und `solved.frames`;
// `phases` und `overrides` bleiben unberührt (Quelle der Wahrheit).
//
// rigProfile: plan.md 5.1. Benutzt werden ausschließlich:
//   roles.pelvis.bone  — Knochen der Wurzel (die animierte Hüfte)
//   joints[id].bone    — Zuordnung Gelenk-id → Knochenname für frame.joints;
//                        ein Gelenk, das dort fehlt, darf stattdessen direkt
//                        unter seinem Knochennamen stehen
//   world.height       — Körperhöhe in Metern, Referenz aller Toleranzen
//
// Bedeutung der Frame-Werte (dokumentierte Vereinbarung dieser Stelle):
//   frame.root.pos    absolute WELTPOSITION der Wurzel in Metern
//   frame.root.quat   absolute WELTAUSRICHTUNG der Wurzel als Quaternion
//   frame.joints[id]  LOKALE Quaternion des Knochenknotens; Identität lässt
//                     den Knochen in seiner Ausgangslage
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadGLB } from '../scene/load.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// plan.md Kapitel 4: alle an einer Stelle, mit Begründung. Alle Toleranzen
// relativ zur Körperhöhe (AGENTS.md).
// ─────────────────────────────────────────────────────────────────────────────

/** Höchste Framerate, für die exportiert wird. Wie in
 *  contracts/timeline.js (fps <= 120): gängige Animationsframeraten. */
export const FPS_MAX = 120;

/** Wiedereinlese-Toleranz für die Wurzelposition, Anteil der Körperhöhe.
 *  1 %: glTF speichert Positionen als float32, der Rundungsfehler liegt
 *  Größenordnungen darunter. Jeder echte Wurzelverlust liegt mindestens in
 *  der Größenordnung einer Körperhöhe und trifft die Schwelle damit
 *  dreistellig. */
export const WURZEL_ABSTAND_TOLERANZ_ANTEIL = 0.01;

/** Wiedereinlese-Toleranz für Rotationen in Radiant (≈ 0,57°). Float32-
 *  Rundung liegt unter 1e-5 rad; 0,01 rad fangen das Rauschen und melden
 *  jeden echten Kanalverlust. */
export const WURZEL_WINKEL_TOLERANZ_RAD = 0.01;

/** Toleranz für die Clip-Länge beim Wiedereinlesen, in halben Frames.
 *  Der Export schreibt einen Keyframe je Frame; endet der Clip um mehr als
 *  einen halben Frame daneben, wurde ein Kanal beschnitten. */
export const ZEIT_TOLERANZ_HALBE_FRAMES = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// FileReader-Decke für Node. Der GLTFExporter serialisiert über Blob und
// FileReader; Node 24 kennt Blob, aber nicht FileReader. Im Browser existiert
// FileReader bereits und die Decke bleibt ungenutzt. Kein npm-Paket.
// ─────────────────────────────────────────────────────────────────────────────

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((ab) => { this.result = ab; this.onloadend?.(); });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((ab) => {
        const u8 = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) {
          bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        }
        this.result = 'data:application/octet-stream;base64,' + btoa(bin);
        this.onloadend?.();
      });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eingabeprüfungen — jede Meldung mit Zahl (AGENTS.md, Handwerkliches)
// ─────────────────────────────────────────────────────────────────────────────

/** Deutsche Dezimaldarstellung für Meldungen. */
function dez(x, stellen = 2) { return x.toFixed(stellen).replace('.', ','); }

function pruefeVektor(v, wo) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new Error(`Export abgelehnt: ${wo} = ${JSON.stringify(v)} — erwartet [x, y, z] in Metern (Weltkoordinaten, oben +Y)`);
  }
}

function pruefeQuat(q, wo) {
  if (!Array.isArray(q) || q.length !== 4 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new Error(`Export abgelehnt: ${wo} = ${JSON.stringify(q)} — erwartet Quaternion [x, y, z, w]`);
  }
}

function pruefeRigProfile(rigProfile) {
  if (!rigProfile || typeof rigProfile !== 'object') {
    throw new Error(`Export abgelehnt: rigProfile = ${rigProfile === null ? 'null' : typeof rigProfile} — erwartet RigProfile nach docs/plan.md 5.1`);
  }
  const hoehe = rigProfile.world?.height;
  if (!(typeof hoehe === 'number' && Number.isFinite(hoehe) && hoehe > 0)) {
    throw new Error(`Export abgelehnt: rigProfile.world.height = ${JSON.stringify(hoehe)} — erwartet Körperhöhe > 0 in Metern`);
  }
  const pelvis = rigProfile.roles?.pelvis?.bone;
  if (typeof pelvis !== 'string' || pelvis === '') {
    throw new Error('Export abgelehnt: rigProfile.roles.pelvis.bone fehlt — ohne Wurzelknochen ist keine Wurzelbewegung adressierbar (plan.md 5.1, Pflichtfeld)');
  }
  return { hoehe, pelvis };
}

function pruefeFps(fps, kontext) {
  if (!Number.isInteger(fps) || fps <= 0 || fps > FPS_MAX) {
    throw new Error(`${kontext}: timeline.fps = ${JSON.stringify(fps)} — erwartet ganzzahlig 1 bis ${FPS_MAX}`);
  }
}

function sammleMesh(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => { if (!mesh && o.isSkinnedMesh) mesh = o; });
  if (!mesh || !mesh.skeleton || mesh.skeleton.bones.length === 0) {
    let boneCount = 0;
    gltf.scene.traverse((o) => { boneCount += o.isBone ? 1 : 0; });
    throw new Error(`Export abgelehnt: geladenes Modell hat ${boneCount} Knochen im Szenenbaum und 0 nutzbare SkinnedMesh-Skelette — Export braucht ein geriggtes Modell`);
  }
  return mesh;
}

function wurzelKnochen(name, mesh) {
  const bone = mesh.skeleton.bones.find((b) => b.name === name);
  if (!bone) {
    throw new Error(`Export abgelehnt: Wurzelknochen „${name}“ fehlt im Skelett mit ${mesh.skeleton.bones.length} Knochen`);
  }
  return bone;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exportiert eine gelöste Timeline als GLB mit Wurzelbewegung.
 *
 * @param {{scene: THREE.Object3D}} gltf  Ergebnis von loadGLB
 * @param {object} timeline  plan.md 5.2 mit `fps` und `solved.frames`
 * @param {object} rigProfile  plan.md 5.1, siehe Schnittstelle im Dateikopf
 * @returns {Promise<{bytes: Uint8Array, warnings: string[]}>}
 * @throws {Error} bei unbrauchbaren Eingaben — jede Meldung mit Zahl
 */
export async function exportiereClip(gltf, timeline, rigProfile) {
  if (!gltf || !(gltf.scene instanceof THREE.Object3D)) {
    throw new Error(`Export abgelehnt: gltf.scene fehlt (Typ ${gltf === null || gltf === undefined ? String(gltf) : typeof gltf}) — das Modell muss über loadGLB geladen sein`);
  }
  if (!timeline || typeof timeline !== 'object') {
    throw new Error(`Export abgelehnt: timeline = ${timeline === null ? 'null' : typeof timeline} — erwartet Timeline nach docs/plan.md 5.2`);
  }
  pruefeFps(timeline.fps, 'Export abgelehnt');
  const { pelvis: wurzelName, hoehe: koerperHoehe } = pruefeRigProfile(rigProfile);

  const frames = timeline.solved?.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error(`Export abgelehnt: timeline.solved.frames = ${Array.isArray(frames) ? 'leeres Array' : 'fehlt oder kein Array'} — der Löser muss zuerst Posen erzeugen (plan.md 5.2)`);
  }
  if (frames.length < 2) {
    throw new Error(`Export abgelehnt: solved.frames enthält ${frames.length} Frame — für eine Animation sind mindestens 2 nötig`);
  }
  const mesh = sammleMesh(gltf);
  const byName = new Map(mesh.skeleton.bones.map((b) => [b.name, b]));

  // Erster Durchlauf: Frames strukturprüfen und die Gelenk-Union sammeln.
  const jointIds = new Set();
  frames.forEach((frame, i) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new Error(`Export abgelehnt: Frame ${i} ist ${frame === null ? 'null' : typeof frame} — erwartet Objekt nach plan.md 5.2`);
    }
    const joints = frame.joints;
    if (joints !== undefined && (typeof joints !== 'object' || joints === null || Array.isArray(joints))) {
      throw new Error(`Export abgelehnt: Frame ${i}.joints = ${JSON.stringify(joints)} — erwartet Objekt { Gelenk: [x,y,z,w] } oder fehlend`);
    }
    for (const [id, quat] of Object.entries(frame.joints ?? {})) {
      pruefeQuat(quat, `Frame ${i}, Gelenk „${id}“`);
      jointIds.add(id);
    }
    if (frame.root !== undefined && frame.root !== null && typeof frame.root !== 'object') {
      throw new Error(`Export abgelehnt: Frame ${i}.root = ${JSON.stringify(frame.root)} — erwartet Objekt {pos, quat} oder fehlend`);
    }
  });

  // Gelenk-ids zu Knochennamen auflösen: RigProfile-Zuordnung zuerst, danach
  // der Knochenname selbst. Unbekannte ids scheitern, sie werden nicht still
  // weggelassen — ein verschlucktes Gelenk wäre ein unbemerkter Verlust.
  const jointKnochen = new Map();
  for (const id of jointIds) {
    const ausProfil = rigProfile.joints?.[id]?.bone;
    if (typeof ausProfil === 'string' && byName.has(ausProfil)) {
      jointKnochen.set(id, ausProfil);
    } else if (byName.has(id)) {
      jointKnochen.set(id, id);
    } else {
      const profilGroesse = Object.keys(rigProfile.joints ?? {}).length;
      throw new Error(`Export abgelehnt: Gelenk „${id}“ ist weder im RigProfile mit ${profilGroesse} Gelenken auf einen Knochen gemappt noch ein Knochenname im Skelett mit ${byName.size} Knochen`);
    }
  }

  // ── Bind-Zustand: gemessen am Modell, nie getippt (AGENTS.md, Regel 1) ─────
  const bones = mesh.skeleton.bones;
  const bind = new Map(bones.map((b) => [b.name, { p: b.position.clone(), q: b.quaternion.clone() }]));
  gltf.scene.updateMatrixWorld(true);
  const wurzel = wurzelKnochen(wurzelName, mesh);
  const eltern = wurzel.parent;
  if (!eltern) {
    throw new Error(`Export abgelehnt: Wurzelknochen „${wurzel.name}“ hat keinen Elternknoten — die Umrechnung von Welt-Metern in Knoten-lokale Werte ist unmöglich`);
  }
  eltern.updateWorldMatrix(true, false);
  const elternMatrixInv = eltern.matrixWorld.clone().invert();
  // Rotation ebenfalls sauber via decompose (die Skalierung darf nicht
  // einmischen).
  const _elternQuat = new THREE.Quaternion();
  eltern.matrixWorld.decompose(new THREE.Vector3(), _elternQuat, new THREE.Vector3());
  const elternQuatInv = _elternQuat.clone().invert();
  const bindWeltPos = wurzel.getWorldPosition(new THREE.Vector3()).toArray();
  const bindWeltQuat = wurzel.getWorldQuaternion(new THREE.Quaternion()).toArray();

  const warnungen = [];
  const zeiten = [];
  const werteWurzelPos = [];
  const werteWurzelRot = [];
  const jointWerte = new Map([...jointIds].map((id) => [id, []]));

  // Zweiter Durchlauf: je Frame den Knochenbaum in die Zielstellung bringen
  // und die Kanalwerte abgreifen.
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // Alle Knochen in die Ausgangslage — Frames erben nichts voneinander.
    for (const b of bones) {
      const b0 = bind.get(b.name);
      b.position.copy(b0.p);
      b.quaternion.copy(b0.q);
    }

    // Gelenke: Werte sind LOKALE Quaternionen des Knochenknotens. Ein Gelenk,
    // das in diesem Frame fehlt, bleibt in der Ausgangslage (Identität im
    // Channel; der Track bekommt ausdrücklich [0,0,0,1], kein Stillschweigen).
    for (const [id, quat] of Object.entries(frame.joints ?? {})) {
      byName.get(jointKnochen.get(id)).quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    }
    for (const id of jointIds) {
      const quat = frame.joints?.[id] ?? [0, 0, 0, 1];
      jointWerte.get(id).push(quat[0], quat[1], quat[2], quat[3]);
    }

    // Wurzel: Position UND Rotation in WELTkoordinaten (plan.md 6.9). Fehlt
    // eines, wird der Bind-Wert eingesetzt — gemessen am Modell, nicht
    // geraten — und ausdrücklich gewarnt.
    let weltPos, weltQuat;
    if (Array.isArray(frame.root?.pos)) {
      pruefeVektor(frame.root.pos, `Frame ${i}, root.pos`);
      weltPos = frame.root.pos.slice();
    } else {
      weltPos = bindWeltPos.slice();
      warnungen.push(`Frame ${i}: root.pos fehlt — Wurzel bleibt auf der Bind-Pose-Position [${bindWeltPos.map((v) => dez(v, 3)).join(', ')}] m, die Ortsveränderung dieses Frames geht verloren`);
    }
    if (frame.root && Array.isArray(frame.root.quat)) {
      pruefeQuat(frame.root.quat, `Frame ${i}, root.quat`);
      weltQuat = frame.root.quat.slice();
    } else {
      weltQuat = bindWeltQuat.slice();
      if (frame.root) {
        warnungen.push(`Frame ${i}: root.quat fehlt — Wurzel übernimmt die Bind-Pose-Rotation, die Drehung dieses Frames geht verloren`);
      }
    }

    // Welt → Knoten-lokal: der Animationskanal spricht den Knochenknoten an;
    // dessen Elternknoten (z. B. mit der Mess-Skalierung 0,01 beim Xbot)
    // bleibt statisch. Erst die Umrechnung macht aus Welt-Metern gültige
    // Knotenwerte.
    const lokalPos = new THREE.Vector3(weltPos[0], weltPos[1], weltPos[2]).applyMatrix4(elternMatrixInv);
    const lokalQuat = new THREE.Quaternion(weltQuat[0], weltQuat[1], weltQuat[2], weltQuat[3]).premultiply(elternQuatInv);
    wurzel.position.copy(lokalPos);
    wurzel.quaternion.copy(lokalQuat);

    zeiten.push(i / timeline.fps);
    werteWurzelPos.push(lokalPos.x, lokalPos.y, lokalPos.z);
    werteWurzelRot.push(lokalQuat.x, lokalQuat.y, lokalQuat.z, lokalQuat.w);
  }

  // Modell in die Ausgangslage zurücksetzen: die Datei enthält die Bind-Pose
  // als Ruhelage, die Bewegung steckt allein in den Animationskanälen.
  for (const b of bones) {
    const b0 = bind.get(b.name);
    b.position.copy(b0.p);
    b.quaternion.copy(b0.q);
  }
  gltf.scene.updateMatrixWorld(true);

  // Kanäle: Wurzel (Position + Rotation) und jede benannte Gelenkrotation.
  const tracks = [
    new THREE.VectorKeyframeTrack(`${wurzel.name}.position`, zeiten, werteWurzelPos),
    new THREE.QuaternionKeyframeTrack(`${wurzel.name}.quaternion`, zeiten, werteWurzelRot),
  ];
  for (const [id, werte] of jointWerte.entries()) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${jointKnochen.get(id)}.quaternion`, zeiten, werte));
  }
  const animation = new THREE.AnimationClip('webmcp-clip', zeiten[zeiten.length - 1], tracks);

  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(gltf.scene, { binary: true, animations: [animation] });
  const bytes = new Uint8Array(glb);
  if (bytes.length === 0) {
    throw new Error(`Export fehlgeschlagen: GLTFExporter lieferte 0 Byte für ${frames.length} Frames bei ${timeline.fps} fps`);
  }
  return { bytes, animation, warnings: warnungen, koerperHoehe };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unabhängiges Wiedereinlesen (Abnahme „Wiedereinlesen“ und „Wurzelbewegung“)
// ─────────────────────────────────────────────────────────────────────────────

/** Quaternion-Abstand in Radiant über den größtmöglichen Bogen. */
function winkelRad(qa, qb) {
  const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Liest die exportierten Bytes mit dem GLTFLoader neu ein und vergleicht
 * Wurzelbewegung und Gelenkverläufe Frame für Frame mit der Timeline.
 * Jede Meldung nennt Frame, Betrag und Toleranz.
 *
 * @param {object} timeline  dieselbe Timeline wie beim Export
 * @param {Uint8Array|ArrayBuffer} bytes  Ergebnis von exportiereClip
 * @param {object} rigProfile  plan.md 5.1 (world.height als Toleranzreferenz)
 * @returns {Promise<{passed: boolean, errors: object[], gemessen: object}>}
 */
export async function pruefeExport(timeline, bytes, rigProfile) {
  if (!timeline || typeof timeline !== 'object') {
    throw new Error(`pruefeExport: timeline = ${timeline === null ? 'null' : typeof timeline} — erwartet Timeline nach plan.md 5.2`);
  }
  pruefeFps(timeline.fps, 'pruefeExport abgelehnt');
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    throw new Error(`pruefeExport: bytes = ${bytes === null ? 'null' : typeof bytes} — erwartet GLB-Bytes von exportiereClip`);
  }
  const { hoehe: koerperHoehe, pelvis: wurzelName } = pruefeRigProfile(rigProfile);
  const byteCount = bytes instanceof Uint8Array ? bytes.length : bytes.byteLength;
  const frames = timeline.solved?.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error(`pruefeExport: timeline.solved.frames = ${Array.isArray(frames) ? 'leeres Array' : 'fehlt oder kein Array'} — ohne gelöste Frames gibt es nichts zum Vergleichen`);
  }
  const frameCount = frames.length;
  const fps = timeline.fps;
  const fehler = [];

  // 1. Wiedereinlesen mit dem GLTFLoader — der unabhängige Nachweis.
  let gltf;
  try {
    gltf = await loadGLB(bytes);
  } catch (err) {
    return {
      passed: false,
      errors: [{ kind: 'wiedereinlesen', frame: null, value: byteCount, unit: 'Byte',
        message: `Datei mit ${byteCount} Byte liest nicht wieder ein: ${err.message}` }],
      gemessen: {},
    };
  }

  // 2. Struktur: genau eine Animation mit Kanälen für die Wurzel.
  const anims = gltf.animations ?? [];
  if (anims.length !== 1) {
    fehler.push({
      kind: 'struktur', frame: null, value: anims.length, unit: 'Animationen',
      message: `Wiedereinlesen enthält ${anims.length} Animationen, exportiert war genau eine`,
    });
    return { passed: false, errors: fehler, gemessen: {} };
  }
  const clip = anims[0];
  const trackByName = new Map(clip.tracks.map((t) => [t.name, t]));
  const posTrack = trackByName.get(`${wurzelName}.position`);
  const quatTrack = trackByName.get(`${wurzelName}.quaternion`);

  const wurzelNode = gltf.scene.getObjectByName(wurzelName);
  let knotenCount = 0;
  gltf.scene.traverse(() => { knotenCount++; });
  if (!wurzelNode) {
    fehler.push({
      kind: 'struktur', frame: null, value: knotenCount, unit: 'Knoten',
      message: `Wiedereinlesen enthält keinen Knoten „${wurzelName}“ — ${knotenCount} Knoten durchsucht`,
    });
    return { passed: false, errors: fehler, gemessen: {} };
  }

  // 3. Zeitleiste: jeder vorhandene Kanal muss einen Keyframe je Frame tragen.
  const zeitToleranz = ZEIT_TOLERANZ_HALBE_FRAMES / fps;
  for (const track of clip.tracks) {
    const letzte = track.times.length ? track.times[track.times.length - 1] : -1;
    const dauerErwartet = (frameCount - 1) / fps;
    if (track.times.length !== frameCount || Math.abs(letzte - dauerErwartet) > zeitToleranz) {
      fehler.push({
        kind: 'zeiten', frame: frameCount - 1,
        value: Number(Number(letzte ?? -1).toFixed(4)), unit: 's',
        message: `Kanal „${track.name}“ hat ${track.times.length} Keyframes und endet bei ${dez(letzte ?? -1, 4)} s — erwartet ${frameCount} Keyframes bis ${dez(dauerErwartet, 4)} s bei ${fps} fps`,
      });
    }
  }

  // 4. Frame-für-Frame-Vergleich: Wurzel in WELT-Metern, Gelenke lokal.
  const abstandToleranz = koerperHoehe * WURZEL_ABSTAND_TOLERANZ_ANTEIL;
  const eltern = wurzelNode.parent;
  eltern.updateWorldMatrix(true, false);
  const elternMatrix = eltern.matrixWorld.clone();
  // Quaternion sauber aus der Matrix lösen: die Matrix enthält die Skalierung
  // der Zwischenknoten (Xbot: 0,01); setFromRotationMatrix würde sie in die
  // Rotation mischen. decompose trennt Translation, Rotation, Skalierung.
  const elternQuat = new THREE.Quaternion();
  eltern.matrixWorld.decompose(new THREE.Vector3(), elternQuat, new THREE.Vector3());
  const bindLokalPos = wurzelNode.position.toArray();
  const bindLokalQuat = wurzelNode.quaternion.toArray();

  let maxPos = { abw: -1, frame: -1 }, maxRot = { abw: -1, frame: -1 };
  let posFaelle = 0, rotFaelle = 0;
  const weltausWiedereinlesen = [];
  let ersterWeltGemessen = null;

  for (let i = 0; i < frameCount; i++) {
    const frame = frames[i] ?? {};
    const t = i / fps;

    // Wurzelposition: Kanalwert (oder bei fehlendem Kanal die statische
    // Ausgangslage des Knotens — genau der Negativfall „stehengebliebene
    // Figur“) in Weltkoordinaten gehoben und gegen root.pos verglichen.
    if (Array.isArray(frame.root?.pos)) {
      pruefeVektor(frame.root.pos, `Timeline, Frame ${i}, root.pos`);
      const lokal = posTrack && i < posTrack.times.length
        ? Array.from(posTrack.values.slice(i * 3, i * 3 + 3))
        : (posTrack ? Array.from(posTrack.values.slice(0, 3)) : bindLokalPos);
      const welt = new THREE.Vector3(...lokal).applyMatrix4(elternMatrix).toArray();
      if (ersterWeltGemessen === null) ersterWeltGemessen = welt;
      const abw = dist3(welt, frame.root.pos);
      if (abw > abstandToleranz) {
        posFaelle++;
        if (abw > maxPos.abw) maxPos = { abw, frame: i };
      }
      weltausWiedereinlesen.push(welt);
    } else {
      weltausWiedereinlesen.push(null);
    }

    if (Array.isArray(frame.root?.quat)) {
      pruefeQuat(frame.root.quat, `Timeline, Frame ${i}, root.quat`);
      const lokal = quatTrack && i < quatTrack.times.length
        ? Array.from(quatTrack.values.slice(i * 4, i * 4 + 4))
        : (quatTrack ? Array.from(quatTrack.values.slice(0, 4)) : bindLokalQuat);
      const weltQ = new THREE.Quaternion(...lokal).premultiply(elternQuat).toArray();
      const abw = winkelRad(weltQ, frame.root.quat);
      if (abw > WURZEL_WINKEL_TOLERANZ_RAD) {
        rotFaelle++;
        if (abw > maxRot.abw) maxRot = { abw, frame: i };
      }
    }
  }

  if (posFaelle > 0) {
    fehler.push({
      kind: 'wurzelposition', frame: maxPos.frame,
      value: Number(maxPos.abw.toFixed(4)), unit: 'm',
      message: `Wurzelposition in Frame ${maxPos.frame} weicht um ${dez(maxPos.abw)} m ab (Toleranz ${dez(abstandToleranz)} m = ${dez(WURZEL_ABSTAND_TOLERANZ_ANTEIL * 100, 0)} % der Körperhöhe ${dez(koerperHoehe, 3)} m); ${posFaelle} von ${frameCount} Frames betroffen`,
    });
  }
  if (rotFaelle > 0) {
    fehler.push({
      kind: 'wurzelrotation', frame: maxRot.frame,
      value: Number(maxRot.abw.toFixed(4)), unit: 'rad',
      message: `Wurzelausrichtung in Frame ${maxRot.frame} weicht um ${dez(maxRot.abw, 4)} rad ${dez((maxRot.abw * 180) / Math.PI, 1)} Grad ab (Toleranz ${WURZEL_WINKEL_TOLERANZ_RAD} rad); ${rotFaelle} von ${frameCount} Frames betroffen`,
    });
  }

  // Ortsveränderung gesamt: die Timeline verlangt sie, der Export muss sie
  // zeigen (Abnahme „Wurzelbewegung“).
  const ersterSoll = Array.isArray(frames[0]?.root?.pos) ? frames[0].root.pos : null;
  if (ersterSoll) {
    const sollWeg = frames.reduce((m, f) => {
      if (!Array.isArray(f?.root?.pos)) return m;
      return Math.max(m, dist3(f.root.pos, ersterSoll));
    }, 0);
    if (sollWeg > abstandToleranz && ersterWeltGemessen) {
      const istWeg = weltausWiedereinlesen.reduce((m, w) => (w ? Math.max(m, dist3(w, ersterWeltGemessen)) : m), 0);
      if (istWeg < abstandToleranz) {
        fehler.push({
          kind: 'fortbewegung', frame: frameCount - 1,
          value: Number(istWeg.toFixed(4)), unit: 'm',
          message: `Die Timeline verlangt eine Ortsveränderung von ${dez(sollWeg)} m, der Export bewegt die Wurzel aber um ${dez(istWeg)} m — der Positionskanal der Wurzel fehlt oder ist wirkungslos`,
        });
      }
    }
  }

  // 5. Gelenkverläufe: Kanäle müssen existieren und die Timeline-Werte tragen.
  const fehlendeKanaele = new Map();   // Gelenk-id → betroffene Frames
  let maxGelenk = { abw: -1, id: null, frame: -1 };
  let gelenkFaelle = 0;
  for (let i = 0; i < frameCount; i++) {
    const frame = frames[i] ?? {};
    for (const [id, quat] of Object.entries(frame.joints ?? {})) {
      pruefeQuat(quat, `Timeline, Frame ${i}, Gelenk „${id}“`);
      const knochenName = rigProfile.joints?.[id]?.bone ?? id;
      const track = trackByName.get(`${knochenName}.quaternion`);
      if (!track) {
        fehlendeKanaele.set(id, (fehlendeKanaele.get(id) ?? 0) + 1);
        continue;
      }
      const lokal = i < track.times.length
        ? Array.from(track.values.slice(i * 4, i * 4 + 4))
        : Array.from(track.values.slice(0, 4));
      const abw = winkelRad(lokal, quat);
      if (abw > WURZEL_WINKEL_TOLERANZ_RAD) {
        gelenkFaelle++;
        if (abw > maxGelenk.abw) maxGelenk = { abw, id, frame: i };
      }
    }
  }
  if (fehlendeKanaele.size > 0) {
    const namen = [...fehlendeKanaele.keys()].join(', ');
    fehler.push({
      kind: 'gelenk', frame: null,
      value: fehlendeKanaele.size, unit: 'Gelenke',
      message: `${fehlendeKanaele.size} Gelenkkanäle fehlen im Wiedereinlesen: ${namen}`,
    });
  }
  if (gelenkFaelle > 0) {
    fehler.push({
      kind: 'gelenk', frame: maxGelenk.frame,
      value: Number(maxGelenk.abw.toFixed(4)), unit: 'rad',
      message: `Gelenk „${maxGelenk.id}“ weicht in Frame ${maxGelenk.frame} um ${dez(maxGelenk.abw, 4)} rad ${( dez((maxGelenk.abw * 180) / Math.PI, 1))} Grad ab (Toleranz ${WURZEL_WINKEL_TOLERANZ_RAD} rad); ${gelenkFaelle} Kanalwerte betroffen`,
    });
  }

  return {
    passed: fehler.length === 0,
    errors: fehler,
    gemessen: {
      frameCount,
      maxWurzelAbstandM: posFaelle > 0 ? Number(maxPos.abw.toFixed(5)) : 0,
      maxWurzelWinkelRad: rotFaelle > 0 ? Number(maxRot.abw.toFixed(6)) : 0,
    },
  };
}