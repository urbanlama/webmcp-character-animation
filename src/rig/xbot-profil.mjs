// Das Profil des UNVERAENDERTEN Xbot, einmal gemessen und ueber Prozessgrenzen
// hinweg geteilt.
//
// WARUM
//
// measureRigProfile() kostet am Xbot rund 2 s, davon 1,9 s die Gelenkgrenz-
// messung (Begruendung im Kommentar in measure.js, Abschnitt "Gelenke").
// 29 Testdateien brauchen genau dieses eine Profil. `node --test` gibt jeder
// Datei einen eigenen Prozess, ein Cache im Modul haelt also nur innerhalb
// einer Datei. Deshalb liegt das Ergebnis hier auf Platte.
//
// WARUM v8 STATT JSON
//
// serialize/deserialize aus node:v8 gibt NaN, Infinity, -0, Maps und Sets
// unveraendert zurueck. JSON macht aus NaN ein null — eine gemessene Grenze,
// die es nicht gibt, waere danach eine Grenze bei 0.
//
// WARUM DER SCHLUESSEL SO BREIT IST
//
// Ein Cache, der eine Aenderung am Messverfahren nicht bemerkt, macht jeden
// Test darunter wertlos: er prueft dann das alte Ergebnis. Der Schluessel
// deckt deshalb den Quelltext der GESAMTEN Importkette ab measure.js ab (also
// auch detect.js und kollision.js), die Xbot.glb selbst und die Optionen des
// Aufrufers. Aendert sich eines davon, wird neu gemessen.
//
// WOFUER NICHT
//
// Nur fuer den unveraenderten Xbot. Wer ein VERAENDERTES Modell misst
// (skaliert, umbenannte Knochen, fremdes Rig, Rollenkorrektur), misst selbst —
// diese Faelle sind der Gegenstand des jeweiligen Tests.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer, testdatenVerzeichnis } from '../scene/testdaten.mjs';
import { measureRigProfile } from './measure.js';

const HIER = dirname(fileURLToPath(import.meta.url));

/**
 * Frisch geladener Xbot. Jeder Aufruf liefert einen eigenen Szenengraphen:
 * measureRigProfile dreht Knochen durch und stellt die Bind-Pose danach
 * wieder her, aber ein Loeserlauf auf demselben Graphen tut das nicht.
 * @returns {Promise<object>}
 */
export function ladeXbot() {
  return loadGLB(alsArrayBuffer(XBOT_PFAD));
}

/** Relative Importe einer Datei, statisch und dynamisch. */
const IMPORT_MUSTER = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/**
 * Quelltexte der Importkette ab einer Wurzeldatei, in fester Reihenfolge.
 * Nur relative Pfade — `three` ist eine Abhaengigkeit mit fester Version, die
 * steckt ueber package-lock.json schon in der Entscheidung des Aufrufers.
 */
function ketteLesen(wurzel) {
  const gesehen = new Set();
  const texte = [];
  const offen = [wurzel];
  while (offen.length) {
    const pfad = offen.shift();
    if (gesehen.has(pfad) || !existsSync(pfad)) continue;
    gesehen.add(pfad);
    const text = readFileSync(pfad, 'utf8');
    texte.push(text);
    for (const treffer of text.matchAll(IMPORT_MUSTER)) {
      offen.push(resolve(dirname(pfad), treffer[1]));
    }
  }
  return texte.sort().join('\0');
}

let verfahrenHash = null;

/** Hash ueber Messverfahren und Modell. Einmal je Prozess. */
function verfahren() {
  if (verfahrenHash === null) {
    const h = createHash('sha256');
    h.update(ketteLesen(join(HIER, 'measure.js')));
    h.update(readFileSync(XBOT_PFAD));
    verfahrenHash = h.digest('hex').slice(0, 16);
  }
  return verfahrenHash;
}

/**
 * Optionen als Text fuer den Cache-Schluessel, oder null, wenn JSON etwas
 * davon verschlucken wuerde.
 */
function alsSchluesselText(wert) {
  try {
    const text = JSON.stringify(wert, (_s, v) => {
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') {
        throw new Error('nicht abbildbar');
      }
      return v;
    });
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

const imProzess = new Map();

/**
 * Profil des unveraenderten Xbot. Der Aufrufer bekommt eine eigene Kopie und
 * darf sie veraendern.
 *
 * @param {object} [opts] Optionen fuer measureRigProfile. Muessen JSON-artig
 *   sein; alles andere wird nicht zwischengespeichert, sondern gemessen.
 * @returns {Promise<object>}
 */
export async function xbotProfil(opts = {}) {
  // Optionen, die JSON nicht vollstaendig abbildet (eine Funktion etwa faellt
  // beim Serialisieren stumm weg), gehen nicht in den Schluessel ein und
  // duerfen deshalb nicht aus dem Cache bedient werden.
  const optionen = alsSchluesselText(opts);
  if (optionen === null) return measureRigProfile(await ladeXbot(), opts);

  const schluessel = `${verfahren()}-${createHash('sha256').update(optionen).digest('hex').slice(0, 12)}`;
  const vorhanden = imProzess.get(schluessel);
  if (vorhanden) return structuredClone(vorhanden);

  const datei = join(testdatenVerzeichnis(), `xbot-profil-${schluessel}.v8`);
  if (existsSync(datei)) {
    try {
      const profil = deserialize(readFileSync(datei));
      imProzess.set(schluessel, profil);
      return structuredClone(profil);
    } catch {
      // Halb geschriebene oder aus einer anderen Node-Version stammende Datei:
      // wegwerfen und neu messen. Ein kaputter Cache darf keinen Test faellen.
      try { unlinkSync(datei); } catch { /* schon weg */ }
    }
  }

  const profil = measureRigProfile(await ladeXbot(), opts);
  imProzess.set(schluessel, profil);
  // Erst daneben schreiben, dann umbenennen: laufen mehrere Testdateien
  // gleichzeitig, sieht keine von ihnen eine halb geschriebene Datei.
  const zwischen = `${datei}.${process.pid}.tmp`;
  try {
    writeFileSync(zwischen, serialize(profil));
    renameSync(zwischen, datei);
  } catch {
    try { unlinkSync(zwischen); } catch { /* schon weg */ }
  }
  return structuredClone(profil);
}

/** Loescht den Cache dieses Prozesses. Fuer Tests am Cache selbst. */
export function cacheVergessen() {
  imProzess.clear();
  verfahrenHash = null;
}
