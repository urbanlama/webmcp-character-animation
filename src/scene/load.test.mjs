// AP0, Abnahmetest „Laden".
//
// Positivfall: Xbot.glb wird geladen, die Figur ist als geriggtes Modell
// erkennbar.
// Negativfall: eine Datei ohne Skelett wird mit benanntem Grund abgelehnt.
//
// Läuft ohne Browser (Brett-Eintrag 2026-08-30 21:52: Node ist der Standard).

import { test } from 'node:test';
import assert from 'node:assert';

import { loadGLB, validateLoadedModel, getBounds } from './load.js';
import { XBOT_PFAD, wuerfelOhneSkelett, alsArrayBuffer } from './testdaten.mjs';

test('Laden, Positivfall: Xbot.glb ergibt ein geriggtes Modell mit messbarer Höhe', async () => {
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  const befund = validateLoadedModel(gltf);

  assert.ok(
    befund.boneCount > 0,
    `Xbot.glb sollte Knochen haben, gefunden: ${befund.boneCount}`
  );
  assert.ok(
    befund.skinnedMeshCount > 0,
    `Xbot.glb sollte gehäutete Meshes haben, gefunden: ${befund.skinnedMeshCount}`
  );

  // Die Figur muss auch räumlich existieren, nicht nur als Knochenliste.
  const box = getBounds(gltf.scene);
  const hoehe = box.max.y - box.min.y;
  assert.ok(
    hoehe > 0.1,
    `Gemessene Körperhöhe ist ${hoehe.toFixed(4)} m, erwartet mehr als 0,1 m`
  );

  // Das Bewegungsmaterial gehört zur Datei; ohne Clips wäre sie für die
  // späteren Pakete wertlos.
  assert.ok(
    gltf.animations.length > 0,
    `Xbot.glb sollte Referenzclips enthalten, gefunden: ${gltf.animations.length}`
  );
});

test('Laden, Negativfall: Datei ohne Skelett wird mit benanntem Grund abgelehnt', async () => {
  const gltf = await loadGLB(alsArrayBuffer(wuerfelOhneSkelett()));

  // Die Datei selbst ist gültig — sie lädt. Abgelehnt wird sie erst bei der
  // Prüfung, und zwar mit Grund und Zahl.
  assert.throws(
    () => validateLoadedModel(gltf),
    (err) => {
      assert.match(
        err.message,
        /Skelett/i,
        `Fehlermeldung soll den Grund benennen, war: "${err.message}"`
      );
      assert.match(
        err.message,
        /\d/,
        `Fehlermeldung soll eine Zahl enthalten (AGENTS.md), war: "${err.message}"`
      );
      return true;
    },
    'Ein Würfel ohne Skinning muss abgelehnt werden, nicht als Figur durchgehen'
  );
});

test('Laden, Negativfall: leerer Puffer wird abgelehnt', async () => {
  await assert.rejects(
    () => loadGLB(new ArrayBuffer(0)),
    (err) => {
      assert.match(
        err.message,
        /\d/,
        `Fehlermeldung soll eine Zahl enthalten, war: "${err.message}"`
      );
      return true;
    }
  );
});
