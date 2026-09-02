// Abnahmetest — „Die Live-Anzeige löst dieselbe Timeline wie die Werkzeuge".
//
// Lauf vom 1. September 2026 (Session 5c6a601a): der Agent setzte mit
// hold_foot Anker für beide Füße über Frames 79–159. measure, look und validate
// lösten mit den Ankern (alsTimeline), die Abspielleiste in index.html baute
// den Löser-Eingang von Hand und ließ `anchors` weg. Ergebnis, Frame 134:
//
//     Werkzeuge (mit Ankern):  Fuß 0,14 m, Bein 11° zur Senkrechten, Kontakt
//     Anzeige (ohne Anker):    Fuß 0,40 m, Bein 58°, Flug
//
// Der Agent meldete „Verbeugung sitzt", der Mensch sah einen kippenden Körper.
//
// Geprüft wird auf zwei Wegen:
//   1. alsTimeline trägt die Anker (und alles andere aus dem Vertrag) weiter.
//   2. Es gibt im Quelltext genau EINE Stelle, die einen Löser-Eingang aus dem
//      Zustand baut. index.html und ports.js dürfen keine eigene Feldliste
//      mehr führen — genau dort war das Feld verloren gegangen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { alsTimeline, leererZustand } from './state.js';

const quelle = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('alsTimeline reicht die Fussanker und alle Vertragsfelder weiter', () => {
  const z = leererZustand();
  z.frameCount = 160;
  z.fps = 30;
  z.overrides = { '134': { joints: { spine: { bend: 35 } }, ease: 'smooth' } };
  z.anchors = [{ foot: 'foot_l', von: 79, bis: 159 }, { foot: 'foot_r', von: 79, bis: 159 }];
  z.intent = { checks: [] };          // gehört NICHT in den Löser-Eingang

  const tl = alsTimeline(z);
  assert.deepEqual(tl.anchors, z.anchors, 'Anker fehlen im Löser-Eingang');
  assert.equal(tl.frameCount, 160);
  assert.equal(tl.fps, 30);
  assert.equal(tl.overrides, z.overrides);
  assert.equal(tl.phases, z.phases);
  assert.equal(tl.rotationFormat, 'quaternion');
  assert.equal('intent' in tl, false, 'intent gehört nicht in den Löser-Eingang');
  // Negativfall: ein Zustand ohne anchors-Feld liefert eine leere Liste, kein undefined.
  const ohne = alsTimeline({ ...z, anchors: undefined });
  assert.deepEqual(ohne.anchors, []);
});

test('index.html baut keinen eigenen Löser-Eingang mehr, sondern gibt den Zustand roh an ports', () => {
  const html = quelle('../../index.html');
  assert.equal(/loeseFuerSzene\(\s*\{/.test(html), false,
    'index.html übergibt ein handgebautes Objekt an loeseFuerSzene — dort ging `anchors` verloren');
  assert.match(html, /loeseFuerSzene\(z\)/,
    'index.html soll den rohen Zustand (store.roh()) an loeseFuerSzene geben');
});

test('ports.loeseFuerSzene baut den Eingang über alsTimeline', () => {
  const ports = quelle('./ports.js');
  assert.match(ports, /import \{ alsTimeline \} from '\.\/state\.js'/);
  assert.match(ports, /solver\.loese\(alsTimeline\(zustand\)\)/,
    'loeseFuerSzene muss alsTimeline auf den Zustand anwenden');
});

test('Negativfall: eine zweite Feldliste im Quelltext fällt auf', () => {
  // Der Prüfweg 2 muss eine Kopie der alten index.html-Fassung erkennen.
  const alt = 'const frames = werkzeugPorts.loeseFuerSzene({ schemaVersion: z.schemaVersion, fps: z.fps });';
  assert.equal(/loeseFuerSzene\(\s*\{/.test(alt), true);
});
