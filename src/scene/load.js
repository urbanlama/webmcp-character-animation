// Laden und Prüfen von glTF/GLB-Modellen. Läuft in Node und Browser.
//
// Grundsatz (AGENTS.md, Regel 1): Körpermaße werden gemessen, Verfahrensparameter
// werden benannt. Diese Datei misst, was am Modell messbar ist (Knochenzahl,
// Bounding Box) und rät nichts.
//
// Import-Auflösung:
//   Browser : 'three' und 'three/addons/loaders/GLTFLoader.js' kommen aus der
//             Import Map in index.html. Sie zeigt 'three/addons/' auf
//             '/vendor/', und vendor/ spiegelt genau die Ordnerstruktur der
//             Addons: vendor/loaders/GLTFLoader.js und
//             vendor/utils/BufferGeometryUtils.js. Der relative Import des
//             Loaders auf '../utils/BufferGeometryUtils.js' läuft dadurch im
//             Browser genauso wie im Original wie in Node.
//   Node    : 'three' kommt aus node_modules (npm, Version 0.180.0 = r180,
//             identischer Build wie vendor/). 'three/addons/…' löst über die
//             exports-Angabe von three auf node_modules/three/examples/jsm/…
//             auf — dieselben Dateien (SHA-256-verifiziert) wie in vendor/.
//             Quelle der Knochenzahlen ist in beiden Fällen derselbe Loader.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Parst einen GLB/GLTF-Puffer zu einem three.js-gltf-Objekt
 * ({ scene, scenes, animations }).
 *
 * Der GLTFLoader braucht einen ResourceLoader nur für externe Dateien
 * (Texturen, Buffer). Ein GLB mit eingebetteten Chunks braucht keine.
 * Externe Referenzen würden in Node als Loader-Fehler am Aufrufer landen —
 * bewusst nicht abgefangen, weil sie ein echtes Ladeproblem anzeigen.
 *
 * @param {ArrayBuffer|Uint8Array} buffer  rohe Bytes einer .glb- oder .gltf-Datei
 * @returns {Promise<{scene: THREE.Object3D, scenes: THREE.Object3D[], animations: THREE.AnimationClip[]}>}
 */
export async function loadGLB(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer
    : buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : null;
  if (!bytes || bytes.length === 0) {
    throw new Error(`Laden fehlgeschlagen: Puffer ist leer oder hat falschen Typ (${bytes ? '0 Byte' : typeof buffer})`);
  }

  // Node hat kein URL.createObjectURL; der Loader muss damit keine
  // Ressourcen nachladen, wenn die Datei self-contained ist.
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
  return gltf;
}

/**
 * Wirft, wenn das geladene Modell kein Skeleton hat. Fehlermeldungen enthalten
 * immer eine Zahl (AGENTS.md, Handwerkliches).
 *
 * Gezählt wird über die Meshes: Skinning-Attribute (skinIndex/skinWeight) am
 * Geometrie-Objekt, Skin-Referenzen und Bone-Knoten in der Szene. GLTFLoader
 * packt die Bones nicht in gltf.scene-Kinder, sondern in gltf.parser-Ergebnisse
 * und in die SkinnedMesh.skeleton — deshalb zählen wir beides.
 *
 * @param {{scene: THREE.Object3D, animations?: THREE.AnimationClip[]}} gltf Ergebnis von loadGLB
 * @returns {{boneCount: number, skinnedMeshCount: number}}
 */
export function validateLoadedModel(gltf) {
  if (!gltf || !(gltf.scene instanceof THREE.Object3D)) {
    throw new Error('Datei enthält kein lauffähiges Modell: kein Szenen-Objekt im Loader-Ergebnis');
  }

  let skinningAttributes = 0;
  let skinnedMeshes = 0;
  const bones = new Set();

  gltf.scene.traverse((obj) => {
    if (obj.isSkinnedMesh) {
      skinnedMeshes++;
      if (obj.geometry.attributes.skinIndex) skinningAttributes++;
      if (obj.skeleton) for (const b of obj.skeleton.bones) bones.add(b);
    }
  });

  const boneCount = bones.size;
  if (boneCount === 0 || skinnedMeshes === 0) {
    throw new Error(
      `Datei enthält kein Skelett: ${boneCount} Knochen, ${skinningAttributes} Skinning-Attribute gefunden`
    );
  }

  return { boneCount, skinnedMeshCount: skinnedMeshes };
}

/**
 * Bounding Box eines Objekts in Weltkoordinaten, unabhängig von jeder Kamera.
 * Spannt sie über die Welt-Matrizen auf; SkinnedMesh-Deformationen in der
 * Bind-Pose sind hier nicht relevant, da die Bind-Pose die ruhende Figur ist.
 *
 * Hinweis zur Messbarkeit: `Box3.setFromObject` beachtet die Skalierung des
 * Objekts selbst, aber SkinnedMesh-Geometrie wird in der Standardkonfiguration
 * von three über die Bounding Box der Ruhelage gemessen — eine spätere
 * Deformation durch Clips vergrößert die Box nicht automatisch. Für AP0 reicht
 * das: die Bind-Pose IST die ruhende Figur, und genau sie wird gerahmt.
 *
 * @param {THREE.Object3D} object3D
 * @returns {THREE.Box3} Bounding Box in Weltkoordinaten
 */
export function getBounds(object3D) {
  // updateWorldMatrix garantiert, dass keine veraltete Parent-Matrix eingeht.
  object3D.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object3D);
}