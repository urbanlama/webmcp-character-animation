// Befunderhebung zu BEFUND.md: für jedes Modell aus models/fremde/ läuft
// detectRig() und die Ausgabe nennt je Pflichtrolle Konfidenz, Zone und
// besten Kandidaten. Nur Messung — nichts an src/ wird geändert.
//
// Aufruf:  node spikes/fremdmodelle/befund-erhebung.mjs
//
// Das Global `self` setzt DIESER Lauf (nur er): der Node-Zweig des GLTFLoader
// braucht es für eingebettete Texturen — Umgebungsproblem des Ladens, keine
// Eigenschaft der Modelle (siehe Kopf von messung.mjs).

if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGLB } from '../../src/scene/load.js';
import { detectRig, PARAMS, PFLICHTROLLEN, ROLLEN } from '../../src/rig/detect.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ORDNER = join(HIER, '..', '..', 'models', 'fremde');

/** Zone nach plan.md 5.1 */
function zone(k) {
  if (k >= PARAMS.sicherAb) return 'sicher';
  if (k >= PARAMS.fragenAb) return 'unsicher';
  return 'abgelehnt';
}

const dateien = readdirSync(ORDNER).filter((f) => f.toLowerCase().endsWith('.glb')).sort();

/** Alle Rollen unter sicherAb, aufsteigend — die Fragezone zuerst. */
function unsichereRollen(bericht) {
  return Object.entries(bericht.roles)
    .filter(([, v]) => v.confidence < PARAMS.sicherAb)
    .sort((a, b) => a[1].confidence - b[1].confidence)
    .map(([r, v]) => `${r}→${v.bone}@${v.confidence}(${zone(v.confidence)})`);
}

for (const datei of dateien) {
  const bytes = new Uint8Array(readFileSync(join(ORDNER, datei)));
  let gltf;
  try {
    gltf = await loadGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (err) {
    console.log(`${datei}: LADEN GESCHEITERT — ${err.message}`);
    continue;
  }
  let bericht;
  try {
    bericht = detectRig(gltf, { file: datei });
  } catch (err) {
    console.log(`${datei}: ABGELEHNT (${err.grund ?? err.name}) — ${err.message}`);
    continue;
  }
  const pflicht = PFLICHTROLLEN.map((r) => {
    const v = bericht.roles[r];
    if (!v) return `${r}=keine Rolle`;
    return `${r}→${v.bone}@${v.confidence}(${zone(v.confidence)}${v.confirm ? ', Rückfrage nötig' : ''})`;
  }).join(' ');
  console.log(`${datei}: ${pflicht}`);
  console.log(`  Fragezone gesamt: ${unsichereRollen(bericht).join(' ') || 'keine'}`);
  if (bericht.abgelehnteZuordnungen?.length) {
    console.log(`  Unter fragenAb (${PARAMS.fragenAb}): `
      + bericht.abgelehnteZuordnungen.map((z) => `${z.rolle}→${z.bone}@${z.confidence}`).join(' '));
  }
}