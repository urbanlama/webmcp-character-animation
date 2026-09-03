// Node-Test für src/scene/load.js — Paket AP0.
// Konvention laut Brett-Eintrag 2026-08-30 21:52: default export ist ein Array
// von { name, async run() } — tests/run.mjs findet und führt sie darüber aus.
//
// Gemessen wird am echten Modell (beispiel/Xbot.glb, die
// Referenzdatei). Perzentil- und Toleranzgrenzen sind Verfahrensparameter und
// stehen im Code mit Begründung.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ok, strictEqual, throws } from 'node:assert/strict';

import { loadGLB, validateLoadedModel, getBounds } from '../../src/scene/load.js';

const hier = dirname(fileURLToPath(import.meta.url));
const XBOT = join(hier, '..', '..', 'beispiel', 'Xbot.glb');

// Verfahrensparameter der Grenzen, benannt mit Begründung:
//   Knochenzahl >= 20  — ein humanoides Rig mit Armen, Beinen, Wirbelsäule und
//     Fingern hat deutlich mehr; Mixamo-Rigs liegen typisch bei 65+. 20 lässt
//     grobe Humanoidskelette ohne Fingerkettchen zu, aber kein Frag-modell.
//   Höhe zwischen 0,5 und 3 m — 0,5 m unterhalb liegt Spielzeug-/Tabletop-
//     Maßstab, 3 m oberhalb Riesen-Maßstab; beides ist für die challenge-
//     humanoiden Modelle ausgeschlossen, und Figuren außerhalb des Fensters
//     sind höchstwahrscheinlich falsch skalierte Exporte.
const MIN_BONES = 20;
const MIN_HEIGHT_M = 0.5;
const MAX_HEIGHT_M = 3.0;

const testfaelle = [
  {
    name: 'laden_xbot_gemessene_zahlen',
    async run() {
      const buffer = readFileSync(XBOT);
      const gltf = await loadGLB(buffer);
      const check = validateLoadedModel(gltf);

      // Grenze aus Verfahrensparameter (oben benannt), nicht geraten.
      ok(check.boneCount >= MIN_BONES,
        `Knochenzahl ${check.boneCount} unterhalb der Untergrenze ${MIN_BONES} — kein humanoides Rig`);

      const box = getBounds(gltf.scene);
      const size = box.getSize(new (box.min.constructor)());
      ok(size.y >= MIN_HEIGHT_M && size.y <= MAX_HEIGHT_M,
        `Körperhöhe ${size.y.toFixed(3)} m liegt außerhalb des Fenster ${MIN_HEIGHT_M}–${MAX_HEIGHT_M} m`);

      // Gemessene Zahlen im Klartext melden — die Übersicht des Runners
      // zeigt nur ok/fail, diese Zeile landet im Test-Log:
      console.log(
        `    gemessen: ${check.boneCount} Knochen, ${check.skinnedMeshCount} SkinnedMesh(es), ` +
        `BBox ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m`
      );
    }
  },

  {
    name: 'laden_kein_skelett_abgelehnt_mit_zahl',
    async run() {
      // Negativfall: eine Datei, die kein Skelett trägt. Eine reine Textdatei
      // (kein glTF-Magic „glTF”) wird bereits vom Loader abgelehnt; ein
      // glTF ohne Skin, aber mit Mesh, läuft bis validateLoadedModel durch —
      // genau dort muss sie mit Zahlen abgelehnt werden. Wir bauen beides:
      //   (a) 3 Bytes Müll, prüfen dass der Wurf eine Zahl enthält
      //   (b) ein glTF-Mesh ohne Skin, prüfen dass validateLoadedModel
      //       mit „0 Knochen“ wirft
      let gemeldet = '';
      try {
        await loadGLB(new Uint8Array([0x00, 0x01, 0x02]));
        throw new Error('Negativfall kaputt: 3 Bytes Müll wurden ohne Fehler geladen');
      } catch (err) {
        gemeldet = String(err?.message || err);
      }
      ok(/\d/.test(gemeldet),
        `Ladefehlermeldung enthält keine Zahl: „${gemeldet}“`);

      // Minimal-gles glTF JSON: ein Mesh ohne Primitives, ohne Skin.
      const gltfJson = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'leeres_modell' }],
      };
      const enc = new TextEncoder();
      // Der JSON-Chunk muss auf 4 Byte aufgefüllt sein; Auffüllen mit
      // Leerzeichen ist im glTF-Standard erlaubt und bleibt gültiges JSON.
      const jsonRaw = JSON.stringify(gltfJson);
      const padded = jsonRaw + ' '.repeat((4 - (enc.encode(jsonRaw).length % 4)) % 4);
      const jsonBytes = enc.encode(padded);
      const total = 12 + 8 + jsonBytes.length;
      const glb = new Uint8Array(total);
      const dv = new DataView(glb.buffer);
      dv.setUint32(0, 0x46546C67, true);          // 'glTF'
      dv.setUint32(4, 2, true);                    // Version
      dv.setUint32(8, total, true);                // Gesamtlänge
      dv.setUint32(12, jsonBytes.length, true);    // Chunk-Länge
      dv.setUint32(16, 0x4E4F534A, true);          // 'JSON'
      glb.set(jsonBytes, 20);

      const gltf = await loadGLB(glb);
      throws(
        () => validateLoadedModel(gltf),
        (err) => {
          gemeldet = String(err?.message || err);
          return /0 Knochen/.test(gemeldet) && /0 Skinning-Attribute/.test(gemeldet);
        },
        `validateLoadedModel wirft nicht mit „0 Knochen, 0 Skinning-Attribute“; lautete: „${gemeldet}“`
      );
      ok(/\d/.test(gemeldet), `Fehlermeldung enthält keine Zahl: „${gemeldet}“`);
      ok(gemeldet.includes('kein Skelett'),
        `Fehlermeldung nennt den Grund nicht: „${gemeldet}“`);
    }
  },
];

export default testfaelle;

// Direktes Ausfuehren: `node tests/node/load.test.mjs`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let pass = 0, fail = 0;
  for (const t of testfaelle) {
    try {
      await t.run();
      pass += 1;
      console.log(`ok    ${t.name}`);
    } catch (e) {
      fail += 1;
      console.log(`FAIL  ${t.name}` + (e && e.message
        ? ` -- ${e.message.split('\n').slice(0, 6).join(' / ')}`
        : ''));
    }
  }
  console.log(`\n${pass} ok, ${fail} fail`);
  process.exitCode = fail === 0 ? 0 : 1;
}