// Befund-Erhebung zum internen Auftrag „Bestätigung ist kosmetisch“.
//
// Frage: Läuft nach einer bestätigten oder korrigierten Rolle ein NEUES Messen?
//   1. Pfad A — der Weg der Vermessung: measureRigProfile mit opts.roles
//      (measure.js: „die Antwort des Menschen … ersetzt die Zuordnung“).
//      Wird mit der korrigierten Rolle NEU GEMESSEN?
//   2. Pfad B — der Weg der Werkzeuge: createToolLayer + confirm_role, dann
//      describe_body. Fließt die Bestätigung hier in die Zahlen?
//
// Ausgabe als JSON auf stdout und in befund.json; Auswertung in BEFUND.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGLB } from '../../src/scene/load.js';
import { XBOT_PFAD, alsArrayBuffer, glbZerlegen, glbBauen } from '../../src/scene/testdaten.mjs';
import { measureRigProfile } from '../../src/rig/measure.js';
import { createToolLayer } from '../../src/tools/index.js';
import { echtePorts } from '../../src/tools/ports.js';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const r3 = (x) => +(x ?? 0).toFixed(3);

// Xbot ohne Texturen (Node kann die eingebetteten Bilder nicht entschlüsseln).
function ohneTexturen(puffer) {
  const { json, bin } = glbZerlegen(puffer);
  const streichen = (o) => {
    for (const schluessel of Object.keys(o)) {
      if (/Texture$/i.test(schluessel)) delete o[schluessel];
    }
  };
  for (const material of json.materials || []) {
    streichen(material);
    if (material.pbrMetallicRoughness) streichen(material.pbrMetallicRoughness);
    for (const erweiterung of Object.values(material.extensions || {})) streichen(erweiterung);
  }
  return glbBauen(json, bin);
}

const roh = ohneTexturen(readFileSync(XBOT_PFAD));

// ── Pfad A: Korrektur über opts.roles — wird neu gemessen? ─────────────────

const gltfOhne = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
const profilOhne = measureRigProfile(gltfOhne, { fileName: 'Xbot.glb' });

const alt = profilOhne.roles.pelvis.bone;   // erkanntes Becken
const falsch = profilOhne.bones.find((b) => b.id !== alt).id;

const gltfMit = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
// Korrigiertes Becken: derselbe Mechanismus, den rollenAufloesen für die
// Antwort des Menschen vorhält (opts.roles).
const profilMit = measureRigProfile(gltfMit, {
  fileName: 'Xbot.glb',
  roles: { pelvis: falsch },
});

const torsoOhne = profilOhne.segments.find((s) => s.id === 'torso');
const torsoMit = profilMit.segments.find((s) => s.id === 'torso');

const pfadA = {
  was: 'measureRigProfile mit opts.roles = { pelvis: <falscher Knochen> }',
  pelvisVorher: alt,
  korrekturZu: falsch,
  pelvisNachher: profilMit.roles.pelvis.bone,
  pelvisKonfidenzNachher: profilMit.roles.pelvis.confidence,
  torsoRadiusVorher_m: torsoOhne.radius,
  torsoRadiusNachher_m: torsoMit.radius,
  torsoMasseVorher_kg: torsoOhne.mass,
  torsoMasseNachher_kg: torsoMit.mass,
  masseGesamtVorher_kg: r3(profilOhne.segments.reduce((a, s) => a + s.mass, 0)),
  masseGesamtNachher_kg: r3(profilMit.segments.reduce((a, s) => a + s.mass, 0)),
  schwerpunktVorher: profilOhne.roles.pelvis.bone,
};

// Pfad A, zweiter Korrekturhebel: die linke Fußrolle auf den Knochen legen,
// den die Erkennung als Zeh gemessen hat. Wenn aus der neuen Zuordnung NEU
// gemessen wird, müssen Sohlen, Gelenke und Masse mitziehen.
const { detectRig } = await import('../../src/rig/detect.js');
const zehLinks = detectRig(gltfOhne).roles.toe_l.bone;
const fussLinks = profilOhne.roles.foot_l.bone;
const messSoProfil = (roles) => {
  const g = gltfOhne;   // dasselbe Objekt — auch dann muss neu gemessen werden
  return measureRigProfile(g, { fileName: 'Xbot.glb', roles });
};
const fussProfil = measureRigProfile(
  await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength)),
  { fileName: 'Xbot.glb', roles: { foot_l: zehLinks } });
const fussSohleVorher = profilOhne.soles.find((s) => s.id === 'sole_l_front_out');
const fussSohleNachher = fussProfil.soles.find((s) => s.id === 'sole_l_front_out');
const fussGelenkVorher = profilOhne.joints.ankle_l;
const fussGelenkNachher = fussProfil.joints.ankle_l;

const pfadA2 = {
  was: 'Korrektur foot_l → (erkannter) Zeh, dasselbe gltf-Objekt mehrfach vermessen',
  footLVorher: fussLinks,
  korrekturZu: zehLinks,
  footLNachher: fussProfil.roles.foot_l.bone,
  sohleKnochenVorher: fussSohleVorher.bone,
  sohleKnochenNachher: fussSohleNachher.bone,
  sohleLokalVorher: fussSohleVorher.local,
  sohleLokalNachher: fussSohleNachher.local,
  ankleKnochenVorher: fussGelenkVorher.bone,
  ankleKnochenNachher: fussGelenkNachher.bone,
  ankleSignVorher: fussGelenkVorher.dof.point.sign,
  ankleSignNachher: fussGelenkNachher.dof.point.sign,
  massenGesamt: {
    ohne: r3(profilOhne.segments.reduce((a, s) => a + s.mass, 0)),
    mitFusskorrektur: r3(fussProfil.segments.reduce((a, s) => a + s.mass, 0)),
  },
};

// Negativfall (AGENTS.md, Regel 2): Korrektur auf einen Knochen, den es
// nicht gibt — muss mit Zahl abgelehnt werden.
let negativ = null;
try {
  measureRigProfile(gltfOhne, { fileName: 'Xbot.glb', roles: { foot_l: 'gibt-es-nicht' } });
  negativ = { geworfen: false };
} catch (err) {
  negativ = { geworfen: true, meldung: err.message, nenntZahl: /\d/.test(err.message) };
}

// ── Pfad B: confirm_role + describe_body wie auf der Seite ─────────────────

const gltf = await loadGLB(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
const ports = echtePorts();
await ports.setzeModell(gltf, { fileName: 'Xbot.glb' });
const schicht = await createToolLayer({ ports });
const store = schicht.store;

const bodyVorher = JSON.parse((await schicht.rufe('describe_body', {})).content[0].text);

await schicht.rufe('confirm_role', { role: 'pelvis', bone: falsch });

const bodyNachher = JSON.parse((await schicht.rufe('describe_body', {})).content[0].text);

const torsoWerkzeug = (body) => body.segments.find((s) => s.id === 'torso');

// Der Werkzeugweg braucht dieselben Nachweise wie Pfad A: Sohlen und Gelenke
// bleiben nach einer confirm_role-Korrektur ungefragt — hier mit derselben
// foot_l-Zeh-Korrektur.
const bodyVorher2 = JSON.parse((await schicht.rufe('describe_body', {})).content[0].text);
await schicht.rufe('confirm_role', { role: 'foot_l', bone: zehLinks });
const bodyNachher2 = JSON.parse((await schicht.rufe('describe_body', {})).content[0].text);

const pfadB = {
  was: 'confirm_role im Werkzeug, dann describe_body',
  korrekturZu: falsch,
  bestatigtImStore: store.lies().roleConfirmations,
  profilBleibtAuf: ports.rig.body().segments.find((s) => s.id === 'torso').from,
  torsoRadiusVorher_m: torsoWerkzeug(bodyVorher).radius,
  torsoRadiusNachher_m: torsoWerkzeug(bodyNachher).radius,
  masseGesamtVorher_kg: bodyVorher.masseGesamt_kg,
  masseGesamtNachher_kg: bodyNachher.masseGesamt_kg,
  identisch: JSON.stringify(bodyVorher) === JSON.stringify(bodyNachher),
  footLKorrektur: {
    korrekturZu: zehLinks,
    sohleKnochenBleibt: bodyNachher2.soles.find((s) => s.id === 'sole_l_front_out').bone,
    masseGesamtFusskorrektur_kg: bodyNachher2.masseGesamt_kg,
    identisch: JSON.stringify(bodyVorher2) === JSON.stringify(bodyNachher2),
  },
};

writeFileSync(join(HIER, 'befund.json'), JSON.stringify({ pfadA, pfadA2, pfadB, negativ }, null, 2));
console.log(JSON.stringify({ pfadA, pfadA2, pfadB, negativ }, null, 2));