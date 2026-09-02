// probe_joint probiert den Kanal, den der Agent nennt — nicht den, den sich
// die Werkzeugschicht aussucht.
//
// Befund: probe_joint nahm intern den ersten Kanal mit signSource 'gemessen'
// und sagte es nicht. Am Xbot hat arm_l drei Kanäle (lift, swing, twist);
// geprobt wurde immer lift. Wollte der Agent wissen, wohin swing schwenkt,
// bekam er ein Bild von lift — und keinen Hinweis darauf, dass er etwas
// anderes gesehen hat, als er wissen wollte.
//
// Positivfall: mit channel wird genau dieser Kanal bewegt, ohne channel nennt
// die Antwort den genommenen und die übrigen.
// Negativfall: ein Kanal, den es an diesem Gelenk nicht gibt, MUSS eine
// Fehlermeldung mit Zahl und Namen ergeben — sonst probiert das Werkzeug
// stillschweigend etwas anderes, und genau das war der Fehler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadGLB } from '../scene/load.js';
import { createToolLayer } from './index.js';
import { echtePorts } from './ports.js';

const XBOT = 'spikes/test-b-motion/assets/Xbot.glb';

async function schichtMitXbot() {
  const puff = readFileSync(XBOT);
  const gltf = await loadGLB(puff.buffer.slice(puff.byteOffset, puff.byteOffset + puff.byteLength));
  const ports = echtePorts();
  await ports.bereit;
  await ports.setzeModell(gltf, { fileName: 'Xbot.glb' });
  return createToolLayer({ ports });
}

const text = (antwort) => (antwort.content ?? []).map((c) => c.text ?? '').join(' ');

test('probe_joint: der genannte Kanal wird geprobt', async () => {
  const s = await schichtMitXbot();

  const swing = text(await s.rufe('probe_joint', { joint: 'arm_l', angleDeg: 20, channel: 'swing' }));
  assert.match(swing, /Kanal swing/, `Antwort nennt swing nicht: ${swing.slice(0, 200)}`);
  assert.match(swing, /von dir gewaehlt/, 'die Antwort muss sagen, dass die Wahl vom Agenten kam');
  // swing dreht arm_l um y, lift um z. Steht die Achse falsch, wurde ein
  // anderer Kanal bewegt, als der Agent verlangt hat.
  assert.match(swing, /um Achse y/, `swing läuft am Xbot um y: ${swing.slice(0, 200)}`);

  const lift = text(await s.rufe('probe_joint', { joint: 'arm_l', angleDeg: 20, channel: 'lift' }));
  assert.match(lift, /Kanal lift/);
  assert.match(lift, /um Achse z/, `lift läuft am Xbot um z: ${lift.slice(0, 200)}`);
});

test('probe_joint ohne channel: die Antwort nennt den genommenen und die übrigen Kanäle', async () => {
  const s = await schichtMitXbot();
  const ohne = text(await s.rufe('probe_joint', { joint: 'arm_l', angleDeg: 20 }));

  assert.match(ohne, /Kanal lift/, 'ohne Angabe wird der erste gemessene Kanal genommen');
  assert.match(ohne, /nicht angegeben/, 'die Antwort muss sagen, dass sie selbst gewählt hat');
  assert.match(ohne, /2 weitere Kanaele an diesem Gelenk: swing, twist/,
    `die übrigen Kanäle müssen mit Zahl und Namen dastehen: ${ohne.slice(0, 250)}`);

  // Ein Gelenk mit genau zwei Kanälen: die Zählung muss auch dort stimmen.
  const elbow = text(await s.rufe('probe_joint', { joint: 'elbow_l', angleDeg: 20 }));
  assert.match(elbow, /1 weiterer Kanal an diesem Gelenk: twist/,
    `elbow_l hat bend und twist: ${elbow.slice(0, 250)}`);
});

test('probe_joint, Negativfall: ein unbekannter Kanal wird mit Zahl und Namen abgelehnt', async () => {
  const s = await schichtMitXbot();
  const antwort = await s.rufe('probe_joint', { joint: 'arm_l', angleDeg: 20, channel: 'bend' });
  const t = text(antwort);

  // bend gibt es am Ellbogen, nicht am Arm — der wahrscheinlichste Irrtum.
  assert.match(t, /bend/, 'die Meldung muss den abgelehnten Kanal nennen');
  assert.match(t, /3 Kanaele/, `die Meldung muss die Zahl der Kanäle nennen: ${t.slice(0, 250)}`);
  assert.match(t, /lift, swing, twist/, 'die Meldung muss die möglichen Kanäle nennen');
  assert.doesNotMatch(t, /um Achse/,
    'ein unbekannter Kanal darf NICHT still durch einen anderen ersetzt werden');
});
