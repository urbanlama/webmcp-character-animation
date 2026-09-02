// Abnahmetest — „Ein Gelenknachtrag im Flug wirft die Figur nicht auf den Boden".
//
// Fund aus dem Agentenlauf vom 2. September 2026 (Lauf 8): der Agent besserte
// mit `set_joint` zwei Ellbogenwinkel mitten im Salto nach. `set_joint` legt
// auf einem Frame ohne Haltung ein neues Schlüsselbild an; dieses hat Gelenke,
// aber keine Höhe, und wurde damit zu einem BODEN-Schlüssel. Die Figur klappte
// in einem Frame vom Scheitel auf den Boden und zurück:
//
//   Frame 54   Becken 1,407 m
//   Frame 55   Becken 0,046 m
//   Frame 58   Becken 1,754 m
//
// Die Ballistikprüfung meldete 1721 m/s²; nach dem Löschen der beiden
// Overrides 5 m/s². Aus Sicht des Agenten hat eine Armkorrektur die Bewegung
// zerstört, und keine Antwort hat es gesagt.
//
// Geprüft wird beides: dass die Höhe der gesetzten Bahn folgt, und dass der
// Bericht den Fall benennt — der Agent soll nicht raten müssen, warum sein
// Frame keine eigene Bodenhöhe bekommt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { xbotProfil } from '../rig/xbot-profil.mjs';
import { erfasseBind, baueSkeleton } from './kinematik.js';
import { loeseBewegung } from './loeser.js';

async function aufbau() {
  const profil = await xbotProfil();
  const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
  return { profil, skel: baueSkeleton(profil, erfasseBind(gltf.scene)) };
}

/** Ein Sprung: Absprung auf Frame 40, Scheitel 50, Landung 60. */
function sprung(zusatz = {}) {
  return {
    schemaVersion: 1, fps: 30, frameCount: 90, rotationFormat: 'quaternion',
    phases: [], anchors: [],
    overrides: {
      40: { joints: { knee_l: { bend: 40 } }, root: { pos: [0, 1.04, 0] }, ease: 'smooth' },
      50: { joints: { knee_l: { bend: 90 } }, root: { pos: [0, 2.00, 1.0] }, ease: 'wurf' },
      60: { joints: { knee_l: { bend: 40 } }, root: { pos: [0, 1.04, 2.0] }, ease: 'smooth' },
      ...zusatz,
    },
  };
}

const beckenY = (profil, frames, nr) =>
  frames[nr]?.positions?.[profil.roles.pelvis.bone]?.[1] ?? null;

test('Flughöhe: ein Gelenknachtrag ohne Höhe folgt der gesetzten Bahn, statt auf den Boden zu fallen', async () => {
  const { profil, skel } = await aufbau();

  const ohne = loeseBewegung(profil, skel, sprung(), {});
  const mit = loeseBewegung(profil, skel,
    sprung({ 55: { joints: { elbow_l: { bend: 70 } }, ease: 'smooth' } }), {});

  const bahn = beckenY(profil, ohne.frames, 55);
  const jetzt = beckenY(profil, mit.frames, 55);
  assert.ok(bahn !== null && jetzt !== null, 'Frame 55 muss in beiden Läufen ein Becken haben');

  // Die Bahn ist im Flug; der Boden läge bei rund 1,04 m. Zugelassen ist ein
  // Zentimeter Unterschied — der Ellbogen verschiebt den Schwerpunkt, nicht
  // die Wurzelbahn.
  const abweichung = Math.abs(jetzt - bahn);
  assert.ok(abweichung < 0.01,
    `mit Ellbogen-Nachtrag muss Frame 55 auf der gesetzten Bahn bleiben: ohne ${bahn.toFixed(3)} m, `
    + `mit ${jetzt.toFixed(3)} m, Unterschied ${(abweichung * 100).toFixed(1)} cm`);

  assert.ok(jetzt > 1.4,
    `Frame 55 liegt im Flug und muss deutlich über der Bodenhöhe (rund 1,04 m) stehen, `
    + `gemessen ${jetzt.toFixed(3)} m`);
});

test('Flughöhe: der Bericht nennt den Frame, dessen Bodenhöhe verworfen wurde', async () => {
  const { profil, skel } = await aufbau();
  const { bericht } = loeseBewegung(profil, skel,
    sprung({ 55: { joints: { elbow_l: { bend: 70 } }, ease: 'smooth' } }), {});

  const treffer = (bericht.lucken ?? []).filter((l) => /Frame 55 hat Gelenke, aber keine Höhe/.test(l.meldung ?? ''));
  assert.equal(treffer.length, 1,
    `genau eine Meldung zu Frame 55 erwartet, ${treffer.length} gefunden: `
    + JSON.stringify((bericht.lucken ?? []).map((l) => l.meldung)));
  assert.match(treffer[0].meldung, /set_pose mit root\.pos/,
    'die Meldung muss sagen, wie der Agent die Höhe doch setzt');
});

test('Flughöhe, Negativfall: am Boden bleibt der Gelenknachtrag ein Boden-Schlüssel', async () => {
  const { profil, skel } = await aufbau();
  // Dieselbe Bewegung, aber der Nachtrag liegt VOR dem Absprung: dort ist
  // keine Bahn gesetzt, die Figur steht. Der Frame muss weiter vom Boden
  // bestimmt werden — sonst wäre der Fix zu grob und nähme dem Agenten die
  // automatische Standhöhe weg, die er ausdrücklich als hilfreich nennt.
  const { frames, bericht } = loeseBewegung(profil, skel,
    sprung({ 20: { joints: { elbow_l: { bend: 70 } }, ease: 'smooth' } }), {});

  assert.equal(frames[20].hoehe?.quelle, 'boden',
    `Frame 20 steht am Boden und muss vom Boden bestimmt werden, war `
    + JSON.stringify(frames[20].hoehe));
  const treffer = (bericht.lucken ?? []).filter((l) => /Frame 20 hat Gelenke, aber keine Höhe/.test(l.meldung ?? ''));
  assert.equal(treffer.length, 0,
    `für einen stehenden Frame darf keine Meldung kommen: ${JSON.stringify(treffer)}`);
});
