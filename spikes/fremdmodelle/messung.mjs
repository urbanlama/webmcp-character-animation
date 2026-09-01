// Messung: Läuft die Kette (laden → Rollen erkennen → vermessen → Vertrag →
// lösen) mit den FREMDEN Modellen unter models/fremde/ — nicht nur mit Xbot.glb?
//
// Auftrag aus _auftraege/fremdmodell2.md. Wichtigste Messregel von dort:
// Schritt 2 (Rollen erkennen, src/rig/detect.js) misst JEDESMAL — auch wenn
// Schritt 3 (Vermessung, src/rig/measure.js) gescheitert ist. detect.js ist
// namensunabhängig und kann weiterkommen als measure.js; dieser Unterschied
// ist der interessanteste Teil der Messung. Deshalb: Rollen VOR der Vermessung.
//
// Dies ist eine MESSUNG, keine Reparatur: nichts unter src/ wird angefasst.
// Ein Fehlschlag ist ein Ergebnis und steht mit Meldung und Zahl in der
// Tabelle. Ein Modell, das kein Humanoid ist, DARF scheitern — aber mit
// klarer Ablehnung (RigAbweisung), nicht mit einem Absturz.
//
// Kein Körpermaß wird getippt. Die einzigen Zahlen hier sind Versuchsaufbau
// (Timeline, Frames, Löser-Schrittweite) und die Modellliste.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// BEFUND (Messlauf, 04.09., three r180): Der Node-Zweig des GLTFLoader braucht
// das Browser-Global `self` (node_modules/three/examples/jsm/loaders/
// GLTFLoader.js, Zeile 3377: `const URL = self.URL || self.webkitURL`).
// Xbot.glb trägt 0 Bilder und läuft deshalb ohne; JEDES Modell mit
// eingebetteter Textur steigt dort mit „self is not defined“ — ein
// Umgebungsproblem des Ladens, keine Eigenschaft des Modells. src/ darf laut
// Auftrag nicht angefasst werden, also setzt DIESER Messlauf (und nur er) das
// Global, bevor drei geladen wird. Der Löser/Validator braucht keine Texturen;
// eine Textur, die nicht lädt, meldet der Loader als Warnung und zählt weiter.
// ─────────────────────────────────────────────────────────────────────────────
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

import { loadGLB, validateLoadedModel, getBounds } from '../../src/scene/load.js';
import { measureRigProfile } from '../../src/rig/measure.js';
import { validateRigProfile } from '../../src/contracts/rig-profile.js';
import { detectRig, PARAMS } from '../../src/rig/detect.js';
import { baueSkeleton, erfasseBind } from '../../src/solver/kinematik.js';
import { loeseBewegung } from '../../src/solver/loeser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Versuchsaufbau (keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const MODELL_ORDNER = join(REPO, 'models', 'fremde');

/** Die Modelle des Auftrags (_auftraege/fremdmodell2.md, „Testmaterial“).
 *  Weggelassen: RobotExpressive.glb — steht im Ordner, ist aber nicht im
 *  Auftrag benannt. Der Messlauf meldet trotzdem, welche GLB der Ordner
 *  wirklich enthält, so dass niemand eine Zahl ohne Quelle glauben muss. */
export const AUFTRAGSMODELLE = [
  'CesiumMan.glb',
  'Michelle.glb',
  'RiggedFigure.glb',
  'Soldier.glb',
  'BrainStem.glb',
  'Kenney_Ooli.glb',
  'character-oobi.glb',
  'character-oodi.glb',
  'character-oopi.glb',
  'character-oozi.glb',
];

/** Die gleiche vierphasige Bewegung wie im Xbot-Referenzlauf
 *  (tests/e2e/durchlauf.mjs, Phasen): Sprung mit Landung. Verfahrensparameter
 *  des Versuchs — Werte in Profil-Einheiten (Tiefe: Anteil der Körperhöhe,
 *  Tempo: Körperhöhen je Sekunde, Winkel: Grad). */
export const PHASEN = [
  { id: 'p1', verb: 'crouch', from: 0, to: 18, params: { tiefe: 0.25 } },
  { id: 'p2', verb: 'takeoff', from: 18, to: 26, params: { vy: 2.6 } },
  { id: 'p3', verb: 'airborne', from: 26, to: 44, params: { einrollen: 0.3 } },
  { id: 'p4', verb: 'land', from: 44, to: 58, params: { fuss: 'beide', abfedern: 0.2 } },
];

export const FPS = 30;
export const FRAMES = 60;

/** Der Lauf der tests/e2e/durchlauf.mjs folgt für Schritt 5 derselben
 *  Signatur: loeseBewegung(profile, skel, timeline). */
export function timeline() {
  return {
    schemaVersion: 1,
    fps: FPS,
    frameCount: FRAMES,
    rotationFormat: 'quaternion',
    phases: PHASEN,
    overrides: {},
  };
}

/** Eine Ausnahme mit allem, was eine Tabellenzeile braucht. */
class Stopp extends Error {
  constructor(schritt, meldung) {
    super(meldung);
    this.schritt = schritt;
  }
}

/** Fehlermeldung mit Sicherung der Zahl: jede Meldung in der Tabelle enthält
 *  eine Zahl (AGENTS.md, Handwerkliches) — enthält sie keine, wird das
 *  gemeldet statt es zu verschweigen. */
function kurz(err) {
  const text = String((err && err.message) || err || 'ohne Meldung');
  return /\d/.test(text) ? text : `${text} (Meldung enthält 0 Zahlen)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ein Modell, alle fünf Schritte in der Auftragsreihenfolge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst EIN Modell durch alle Schritte. Wirft NICHT — jede Zeile trägt ihren
 * Fehlschlag als Text, das Skript läuft immer ganz durch.
 *
 * Schrittreihenfolge des Auftrags fmd-2:
 *   1 laden  →  2 Rollen  →  3 vermessen  →  4 Vertrag  →  5 lösen
 * Rollen (2) laufen VOR der Vermessung (3), weil ihr Ergebnis auch dann
 * gemessen wird, wenn die Vermessung scheitert.
 *
 * @param {string} datei  Dateiname unter models/fremde/
 * @param {{puffer?: Uint8Array}} [opts]  Puffer von außen (für den Negativfall des Tests)
 * @returns {object} eine Zeile der Ergebnistabelle
 */
export async function messModell(datei, opts = {}) {
  const zeile = {
    datei,
    // Schritte 2–5: true = gelaufen, null = gestoppt, false = abgelehnt
    stop: null, stopSchritt: 0,
    schritt2: null, schritt3: null, schritt4: null, schritt5: null,
    // Messzahlen, so weit sie entstanden sind
    knochen: null, clips: null, koerperhoehe: null,
    rollenSicher: null, rollenUnsicher: null, rollenUnbekannt: null, blickrichtung: null,
    gelenke: null, segmente: null, sohlen: null, vertragsfehler: null,
    frames: null,
  };
  const stop = async (schritt, fn) => {
    try { return await fn(); }
    catch (err) { zeile.stop = kurz(err); zeile.stopSchritt = schritt; return null; }
  };

  // Der Datei-Vorlauf gehört IN die Absicherung von Schritt 1: wirft
  // readFileSync (fehlende Datei), endet die Zeile wie jede andere Ladestopp-
  // Zeile — das Skript läuft insgesamt immer ganz durch.
  let bytes = null;
  await stop(1, () => { bytes = opts.puffer ?? new Uint8Array(readFileSync(join(MODELL_ORDNER, datei))); });

  // ── 1 Laden ──────────────────────────────────────────────────────────────
  let gltf = bytes === null ? null : await stop(1, async () => {
    const ge = await loadGLB(bytes);
    const pruef = validateLoadedModel(ge);
    zeile.knochen = pruef.boneCount;
    zeile.clips = (ge.animations || []).length;
    const box = getBounds(ge.scene);
    zeile.koerperhoehe = +(box.max.y - box.min.y).toFixed(4);
    return ge;
  });
  if (!gltf) return zeile;

  // ── 2 Rollen erkennen (namenunabhängig) — läuft JEDESMAL ────────────────
  const bericht = await stop(2, () => {
    const b = detectRig(gltf, { file: datei });
    const sicher = Object.values(b.roles).filter((r) => r.confidence >= PARAMS.sicherAb).length;
    const fragenAb = PARAMS.fragenAb;
    const unsicher = Object.values(b.roles)
      .filter((r) => r.confidence >= fragenAb && r.confidence < PARAMS.sicherAb).length;
    zeile.rollenSicher = sicher;
    zeile.rollenUnsicher = unsicher;
    zeile.rollenUnbekannt = (b.unknown || []).length;
    zeile.blickrichtung = b.world?.forward ?? 'unklar';
    zeile.schritt2 = true;
    return b;
  });
  if (!bericht) return zeile;   // RigAbweisung: die klare Ablehnung, kein Absturz

  // ── 3 Vermessen ──────────────────────────────────────────────────────────
  let profil = await stop(3, () => {
    const p = measureRigProfile(gltf, { fileName: datei });
    zeile.gelenke = Object.keys(p.joints || {}).length;
    zeile.segmente = (p.segments || []).length;
    zeile.sohlen = (p.soles || []).length;
    zeile.koerperhoehe = p.world?.height ?? zeile.koerperhoehe;
    zeile.schritt3 = true;
    return p;
  });
  if (!profil) return zeile;

  // ── 4 Vertrag ────────────────────────────────────────────────────────────
  const vertrag = validateRigProfile(profil);
  zeile.vertragsfehler = vertrag.errors.length;
  if (!vertrag.ok) {
    zeile.stop = vertrag.errors.map((e) => `${e.field}: ${e.message}`).join(' | ');
    zeile.stopSchritt = 4;
    return zeile;
  }
  zeile.schritt4 = true;

  // ── 5 Lösen ──────────────────────────────────────────────────────────────
  await stop(5, () => {
    const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
    const { frames, bericht: loesBericht } = loeseBewegung(profil, skel, timeline());
    if (!Array.isArray(frames) || frames.length !== FRAMES) {
      throw new Error(`Löser liefert ${frames?.length ?? typeof frames} Frames für eine Timeline von ${FRAMES} Frames`);
    }
    zeile.frames = frames.length;
    zeile.schritt5 = true;
    zeile.loeserBericht = {
      phasen: loesBericht.phasen.length,
      lucken: loesBericht.lucken.length,
      schwerpunktWeg_m: loesBericht.bewegung?.schwerpunktWeg_m ?? null,
      kontaktwechsel: loesBericht.bewegung?.kontaktwechsel ?? null,
    };
    return frames;
  });
  return zeile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Der ganze Lauf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Läuft alle Auftragsmodelle der Reihe nach durch.
 * @param {string[]} modelle  Dateinamen
 * @param {object} [opts]     an messModell durchgereicht
 * @returns {object} { zeilen, geladen, vermessbar, rollenWeiter, gesamt }
 */
export async function messLauf(modelle = AUFTRAGSMODELLE, opts = {}) {
  const zeilen = [];
  for (const datei of modelle) {
    zeilen.push(await messModell(datei, opts));
  }
  return {
    zeilen,
    geladen: zeilen.filter((z) => z.knochen !== null).length,
    vermessbar: zeilen.filter((z) => z.schritt3 === true).length,
    rollenWeiter: zeilen.filter((z) => z.schritt2 === true && z.schritt3 !== true).length,
    gesamt: zeilen.length,
  };
}

function jaNein(x) { return x === true ? 'ja' : x === false ? 'nein' : '—'; }

function eine(zeile) {
  const stopp = zeile.stop === null
    ? '—'
    : `Schritt ${zeile.stopSchritt}: ${zeile.stop.length > 110 ? `${zeile.stop.slice(0, 110)}…` : zeile.stop}`;
  return [
    zeile.datei,
    String(zeile.knochen ?? '—'),
    String(zeile.koerperhoehe ?? '—'),
    jaNein(zeile.schritt2),
    jaNein(zeile.schritt3),
    jaNein(zeile.schritt4),
    `${zeile.rollenSicher ?? '—'}/${zeile.rollenUnsicher ?? '—'}/${zeile.rollenUnbekannt ?? '—'}`,
    jaNein(zeile.schritt5),
    stopp,
  ];
}

/** Tabellentext — die Abnahmeausgabe. Nennt beide Gesamtzahlen des Auftrags:
 *  wie viele Modelle vermessen werden konnten, und bei wie vielen die
 *  Rollenerkennung weiterkam als die Vermessung. */
export function tabellenText(ergebnis) {
  const kopf = ['Modell', 'Knochen', 'Körperhöhe m', 'Rollen', 'Vermessung',
    'Vertrag', 's/u/u', 'Lösung', 'Stopp-Meldung mit Zahl'];
  const zeilen = [
    `Vermessen: ${ergebnis.vermessbar} von ${ergebnis.gesamt} Modellen (Schritte 3+4 durch). `
      + `Rollen weiter als Vermessung: ${ergebnis.rollenWeiter} von ${ergebnis.gesamt} Modellen. `
      + `Geladen: ${ergebnis.geladen} von ${ergebnis.gesamt}.`,
    '',
    kopf.join(' ¦ '),
    ...ergebnis.zeilen.map((z) => eine(z).join(' ¦ ')),
  ];
  return zeilen.join('\n');
}

/** Meldet das Ergebnis auf die Konsole (Direktaufruf des Skripts). */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const imOrdner = readdirSync(MODELL_ORDNER).filter((f) => f.toLowerCase().endsWith('.glb')).sort();
  const laufListe = AUFTRAGSMODELLE.filter((f) => imOrdner.includes(f));
  const fehlende = AUFTRAGSMODELLE.filter((f) => !imOrdner.includes(f));
  console.log(`models/fremde enthält ${imOrdner.length} GLB: ${imOrdner.join(', ')}`);
  if (laufListe.length === 0) {
    console.log(`Es ist keine der ${AUFTRAGSMODELLE.length} Auftragsdateien im Ordner — 0 Modelle gemessen, 0 Zeilen.`);
    process.exit(0);
  }
  if (fehlende.length > 0) {
    console.log(`AUFTRAGSLISTE: ${fehlende.length} benannte Dateien fehlen im Ordner: ${fehlende.join(', ')} — sie laufen nicht`);
  }
  const ergebnis = await messLauf(laufListe);
  console.log('\n' + tabellenText(ergebnis) + '\n');
  console.log(`Reihenfolge je Zeile: 1 laden → 2 Rollen → 3 Vermessung → 4 Vertrag → 5 lösen. `
    + `Rollenspalte = sicher/unsicher/unbekannt `
    + `(Grenzen aus src/rig/detect.js:PARAMS: fragenAb ${PARAMS.fragenAb}, sicherAb ${PARAMS.sicherAb})`);
}