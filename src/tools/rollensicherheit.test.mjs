// confirm_role liegt in der Kiste, solange keine Rolle unsicher ist.
//
// Die Begründung ist keine Meinung, sondern eine Messung: am Xbot — dem
// einzigen Modell, das die Seite lädt — haben alle drei Pflichtrollen
// (pelvis, foot_l, foot_r) Konfidenz 1. Es gibt nichts zu bestätigen. Die
// Rollen-Rückfrageoberfläche ist seit Commit de77965 abgeschaltet; ein
// sichtbares Werkzeug ohne Anlass kostete im Agentenlauf echte Aufrufe: der
// Agent las den Hinweis in describe_rig als Pflicht und machte sich daran,
// achtzehn Zuordnungen zu bestätigen, statt die Bewegung zu bauen.
//
// Positivfall: alle Pflichtrollen sind sicher, also ist das Werkzeug
// unsichtbar — und der Rumpf bleibt trotzdem aufrufbar.
// Negativfall: wäre eine Pflichtrolle unsicher, MUSS dieser Test rot werden.
// Er ist die Bremse gegen ein Modell, bei dem der Mensch korrigieren müsste,
// aber kein Werkzeug dafür registriert ist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { measureRigProfile } from '../rig/measure.js';
import { KATALOG, KATALOG_SICHTBAR, KISTE } from './catalog.js';
import { createToolLayer } from './index.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function xbotProfil() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  return measureRigProfile(gltf);
}

test('Rollen: am Xbot ist keine Pflichtrolle unsicher', async () => {
  const profil = await xbotProfil();
  const unsicher = Object.entries(profil.roles)
    .filter(([, e]) => typeof e.confidence === 'number' && e.confidence < 1)
    .map(([rolle, e]) => `${rolle} = ${e.bone} (${e.confidence})`);

  assert.deepEqual(unsicher, [],
    `${unsicher.length} Rollen sind unsicher: ${unsicher.join(', ')} — `
    + 'dann muss confirm_role zurück in den sichtbaren Katalog (kiste: true entfernen) '
    + 'und describe_rig es wieder nennen, sonst kann niemand korrigieren');
  assert.equal(Object.keys(profil.roles).length, 3,
    `erwartet 3 Pflichtrollen im Profil, gezählt ${Object.keys(profil.roles).length}`);
});

test('Rollen: confirm_role ist deshalb in der Kiste und wird nicht registriert', async () => {
  assert.ok(KISTE.includes('confirm_role'),
    `confirm_role fehlt in der Kiste; sie enthält ${KISTE.length}: ${KISTE.join(', ')}`);
  assert.ok(!KATALOG_SICHTBAR.some((t) => t.name === 'confirm_role'),
    'confirm_role darf im sichtbaren Katalog nicht vorkommen');

  const schicht = await createToolLayer({});
  const namen = schicht.getTools().map((t) => t.name);
  assert.ok(!namen.includes('confirm_role'),
    `confirm_role ist registriert; der Agent sieht ${namen.length} Werkzeuge: ${namen.join(', ')}`);
  assert.equal(namen.length, KATALOG_SICHTBAR.length,
    `${namen.length} registriert, ${KATALOG_SICHTBAR.length} sichtbar im Katalog`);
});

test('Rollen: der Rumpf von confirm_role bleibt aufrufbar', async () => {
  // Unsichtbar heißt nicht ausgebaut: über die Werkzeugkiste (werkzeugkiste:
  // true) ist das Werkzeug erreichbar, damit die Oberfläche es wieder
  // einschalten kann, sobald es eine Rückfrage dafür gibt.
  assert.ok(KATALOG.some((t) => t.name === 'confirm_role'),
    'confirm_role muss im Katalog bleiben');

  const schicht = await createToolLayer({ werkzeugkiste: true });
  const antwort = await schicht.rufe('confirm_role', { role: 'foot_l', bone: 'mixamorigLeftFoot' });
  const text = (antwort.content ?? []).map((c) => c.text ?? '').join(' ');
  assert.ok(text.length > 0, 'der Aufruf muss antworten, nicht ins Leere laufen');
  assert.match(text, /\d/, 'die Antwort muss eine Zahl nennen (Handwerkliches, AGENTS.md)');
});

test('Rollen, Negativfall: eine unsichere Rolle im Profil fällt auf', async () => {
  // Dieselbe Prüfung wie im ersten Test, auf einem absichtlich verstellten
  // Profil. Läuft sie hier durch, prüft der erste Test nichts.
  const profil = await xbotProfil();
  const verstellt = {
    ...profil,
    roles: { ...profil.roles, foot_l: { ...profil.roles.foot_l, confidence: 0.62 } },
  };
  const unsicher = Object.entries(verstellt.roles)
    .filter(([, e]) => typeof e.confidence === 'number' && e.confidence < 1);

  assert.equal(unsicher.length, 1,
    `erwartet genau 1 unsichere Rolle im verstellten Profil, gezählt ${unsicher.length}`);
});
