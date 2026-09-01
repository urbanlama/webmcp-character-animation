// AP9 — Bildstreifen für den Agenten (docs/plan.md 6.8).
//
// Der Agent, der diese Seite bedient, ist blind, wenn er nur Zahlen bekommt. Dieser
// Streifen gibt ihm Augen: mehrere fest benannte Ansichten nebeneinander in EINEM
// Bild, im Charakter-Bezugssystem, jede Ansicht annotiert mit Achsenkreuz,
// Bodengitter mit Maßstab, Schwerpunkt, Stützfläche und Kontaktpunkten. Diese
// Ansichten sind für den Agenten gemacht und dürfen technisch aussehen — die
// Ansicht des Menschen liegt in src/scene/view.js und wird hier nicht angefasst.
//
// Was gemessen wird und was Verfahren ist (AGENTS.md, Regel 1):
//   GEMESSEN  — Körperhöhe, Bodenebene, Vorwärts- und Linksachse, Gelenkpositionen,
//               Segmentradien und -massen, Sohlenpunkte: alles aus dem RigProfile.
//   VERFAHREN — Panelgröße, Sichtfaktor, Gitterteilung, Achsenlänge, Budgetgrenze.
//               Sie stehen als benannte Konstanten unten, mit Begründung. Keine von
//               ihnen ist eine Körpermaß.
//
// Zwei Ebenen, weil nur eine davon Pixel braucht:
//   planeStreifen()  — reine Geometrie, läuft in Node. Legt fest, WELCHE Linien,
//                      Kreise, Polygone und Zahlen in WELCHEM Pixelrechteck landen.
//   bildeStreifen()  — rasterisiert den Plan. Braucht ein Canvas und, wenn die Figur
//                      als Mesh erscheinen soll, WebGL — läuft deshalb im Browser
//                      (Abnahme über Playwright gegen die echte Seite).
//
// Anschluss an AP7: createStripRenderer() liefert den Port, den src/tools/ports.js
// benennt: streifen({ frames, views }) -> [{ view, frames, ref, data, mimeType }].
// `frames` sind Frame-ZAHLEN der Timeline, die Auflösung zur Pose übernimmt der
// Aufrufer über `frameQuelle`. Zurück kommt GENAU EIN Bild: der Streifen enthält alle
// angeforderten Ansichten in einem Bild (plan.md 6.8, "mehrere in einem Bild").
//
// Hart geprüft, weil die Abnahme daran hängt:
//   - Ein Streifen ohne vollständige Annotationen wird nicht ausgeliefert.
//   - Frame-Zahlen außerhalb der Timeline werden mit Zahl abgelehnt.
//   - Alle Maßstäbe hängen an der gemessenen Körperhöhe: ein Modell auf 0,60 m
//     bekommt dieselbe Proportion im Bild wie eines auf 2,40 m.

import * as THREE from 'three';
import { validateRigProfile } from '../contracts/rig-profile.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE VERFAHRENSPARAMETER (keine Körpermaße — AGENTS.md, Regel 1)
// Ändert einer davon, müssen die Abnahmetests erneut laufen.
// ─────────────────────────────────────────────────────────────────────────────

/** Die vier festen Ansichten, im Charakter-Bezugssystem. Die Namen stimmen mit
 *  ANSICHTEN aus src/tools/catalog.js überein (Werkzeug `look`). */
export const ANSICHTEN = ['front', 'side', 'quarter', 'top'];

/** Panelbreite und Panelhöhe in Pixeln. Bildentscheidung: 300 × 380 hält bei
 *  3 Frames × 4 Ansichten die Figur lesbar und bleibt unter dem Antwortbudget. */
export const PANEL_BREITE_PX = 300;
export const PANEL_HOEHE_PX = 380;

/** Abstand zwischen Panels in Pixeln. */
export const PANEL_ABSTAND_PX = 8;

/** Anteil der gemessenen Körperhöhe, den ein Panel in der Höhe zeigt. 1,25 lässt
 *  25 % Luft für erhobene Arme und für den Maßstabsbalken — und hält 2 mm Versatz
 *  unter einen Pixel (Abnahmetest Aussagekraft, dort in beide Richtungen scharf). */
export const SICHT_HOEHE_FAKTOR = 1.25;

/** Gewünschte Gitterteilung: ein Schritt ≈ 1/10 der Körperhöhe, danach auf einen
 *  glatten Meterwert gerundet, damit die Zahlen an Leiste und Lineal lesbar sind. */
export const GITTER_TEILUNG = 10;

/** Länge einer Achse des Achsenkreuzes, Anteil der Körperhöhe. */
export const ACHSEN_LENTEIL = 0.18;

/** Kontaktschwelle als Anteil der Körperhöhe, falls das RigProfile sie nicht
 *  mitbringt. Vorgezogen wird immer profile.params.soleTolerance — die Messung. */
export const KONTAKT_SCHWELLE_ANTEIL = 0.035;

/** Höchste Panelzahl eines Streifens: 4 Ansichten × 12 Frames ist das Maximum,
 *  das Werkzeug `look` verlangen kann. */
export const MAX_PANELS = 48;

/** Meiste Frames pro Antwort — dieselbe Schranke wie Werkzeug `look` (catalog.js). */
export const FRAMES_MAX = 12;

/** Gemessen (AGENTS.md, WebMCP): Antworten bis 512 KB kommen vollständig durch. */
export const ANTWORT_BUDGET_BYTES = 512 * 1024;

/** Unter dieser PNG-Größe kann kein annotierter Streifen stecken. Fängt
 *  Platzhalterbilder (1 × 1 px) und vollständig schwarze Flächen ab. */
export const MIN_BILD_BYTES = 4096;

/** Prüfschwelle dafür, dass `positions` und `bones` desselben Frames dieselbe Pose
 *  beschreiben, Anteil der Körperhöhe. */
export const POSE_UEBEREINSTIMMUNG_ANTEIL = 0.02;

/** Größter zulässiger Abstand eines berechneten Sohlenpunkts von seinem Fußgelenk,
 *  Anteil der Körperhöhe. Ein Sohlenpunkt ist Teil des Fußes; kommt er weiter weg,
 *  stimmt die Umrechnung von Knochen-lokal nach Welt nicht — meist ein fehlender
 *  Weltmaßstab. An Xbot gemessen: ohne Maßstab landete der Sohlenpunkt 16,95 m statt
 *  0,17 m vom Gelenk, weil die Modellwurzel auf 0,01 steht. */
export const SOHLE_ABSTAND_MAX_ANTEIL = 0.15;

/** Himmelslicht- und Richtungslicht-Intensität für den Fall, dass die übergebene
 *  Szene gar keine Lichtquelle enthält. reiner Render-Aufwand, keine Körpermaß:
 *  ohne Licht wäre jedes Mesh panel schwarz und der Streifen wertlos. */
export const LICHT_HEMISPHAERISCH = 2.1;
export const LICHT_RICHTUNG = 2.2;

/** Stufen, mit denen die Panelauflösung gesenkt wird, bis das Budget hält. */
export const SKALA_STUFEN = [1, 0.72, 0.5];

/** BENANNTER VERFAHRENSPARAMETER (kein Körpermaß — AGENTS.md, Regel 1): höchste
 *  Panelzahl eines Streifens, damit ein Aufruf zuverlässig unter der Zeitgrenze
 *  bleibt. Gemessen an Xbot.glb im headless Chromium mit SwiftShader — dem
 *  SLOW-Fall, mit Grafikkarte wird es schneller (spikes/tmp-strip-zeit.mjs,
 *  31.08.2026):
 *    12 Frames × 1 Ansicht    251 ms  (12 Panels, volle Panelgröße)
 *     6 Frames × 2 Ansichten  249 ms  (12 Panels, PNG 437 KB, volle Größe)
 *    12 Frames × 2 Ansichten 1133 ms (24 Panels — die Budgettreppe in
 *                                     bildeStreifen rendert denselben Streifen
 *                                     bis zu 3-mal, je Panel rund 47 ms)
 *    12 Frames × 4 Ansichten 2151 ms (48 Panels — scheitert zusätzlich am
 *                                     Bytebudget, 554 553 Byte > 524 288)
 *  24 Panels sind der größte gemessene Fall, der mit sicherem Abstand unter
 *  der Grenze liegt und sicher ins Bytebudget passt. Darüber werden die Frames
 *  JE ANSICHT gekürzt — im Panelrechteck ändert sich nichts, nur die Spaltenzahl.
 *  Wird der Wert geändert: erneut gegen Xbot messen und die Zahlen hier
 *  fortschreiben. */
export const PANELS_ZEIT_MAX = 24;

/** Die Zeitgrenze selbst, Auftragsvorgabe "verlässlich unter zwei Sekunden".
 *  Steht im Bericht, wenn gekürzt wurde, und im Grenztest (Reihe Zeitgrenze). */
export const STRIPE_ZEIT_MS = 2000;

/** Harte Zeitgrenze je bildeStreifen()/streifen()-Aufruf in Millisekunden.
 *
 *  BENANNTER VERFAHRENSPARAMETER, gemessen an Xbot.glb (headless Chromium,
 *  SwiftShader, spikes/tmp-strip-zeit.mjs, 31.08.2026):
 *    12 Frames × 1 Ansicht   251 ms   (12 Mesh-Panels, voller Skala)
 *     6 Frames × 2 Ansichten 249 ms   (12 Panels, voller Skala, PNG 437 KB)
 *    12 Frames × 2 Ansichten 1133 ms  (24 Panels — Budgettreppe rendert
 *                                      denselben Streifen bis zu 3-mal)
 *    12 Frames × 4 Ansichten >2151 ms und dann abgelehnt (PNG > 512 KB)
 *  Ein Panel kostet auf der CPU rund 20 ms Rendern plus Codieren; der Rest
 *  ist Plan+Bild über die drei SKALA_STUFEN hinweg. Grenze 2000 ms: doppelt
 *  so lang wie der gemessene Worst Case, der durchkommt — und die Obergrenze
 *  des Auftrags ("ein Aufruf verlässlich unter zwei Sekunden"). Der Werkzeug-
 *  Timeout AUFRUF_MAX_MS (src/tools/registry.js, 20 000 ms) wird dadurch nie
 *  erreicht: Die Grenze kürzt VOR dem Rendern und beantwortet in Sekunden. */
export const STRIPE_ZEIT_LIMIT_MS = 2000;

/** Ziel, unter dem ein Aufruf zurückkommen muss — dieselbe Zahl wie im Auftrag.
 *  Der Grenztest (src/render/strip.test.mjs, Reihe Zeitgrenze) hält sie scharf. */
export const STRIPE_ZIEL_MS = 2000;

/** Halbe Breite eines Maßstabsetiketts in Pixeln. Begrenzt, wie nah eine Zahl an
 *  den Panelrand rücken darf, ohne abgeschnitten zu werden: das längste Etikett
 *  ist „0,00 m" mit 6 Zeichen, ein Zeichen dieser Monospace-Größe ist höchstens
 *  6 px breit, die Hälfte davon ist 18 px. PANEL_BREITE_PX ist eine Panelgröße,
 *  keine Körpermaß — derselbe Charakter wie die übrigen Werte hier. */
export const ETIKETT_HALB_PX = 18;

/** Die fünf Gruppen, ohne die ein Panel nicht ausgeliefert wird. */
export const PFLICHT_ANNOTATIONEN = [
  'achsenkreuz', 'bodengitter', 'schwerpunkt', 'stuetzflaeche', 'kontaktpunkte',
];

/** Reihenfolge, in der die Gruppen übereinander gezeichnet werden. */
const EBENEN_REIHENFOLGE = [
  'bodengitter', 'stuetzflaeche', 'kontaktpunkte', 'achsenkreuz', 'schwerpunkt',
];

/** Harte, ungemischte Farbtöne: der Agent unterscheidet Gruppen nach Farbton. */
export const FARBE = {
  panel: '#0a0e13',
  gitter: '#243040',
  boden: '#5b7186',
  text: '#cbd5e1',
  textSchwach: '#8b949e',
  achseX: '#ef4444',   // links
  achseY: '#22c55e',   // hoch
  achseZ: '#3b82f6',   // vorn
  schwerpunkt: '#f59e0b',
  lot: '#b45309',
  stuetzflaeche: '#a855f7',
  kontakt: '#e11d48',
  koerper: '#64748b',
  gelenk: '#cbd5e1',
  rand: '#30363d',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helfer
// ─────────────────────────────────────────────────────────────────────────────

function fehler(text) { throw new Error('Bildstreifen abgelehnt: ' + text); }

/** Millisekundenzahl für Fehlermeldungen — gerundet, mit Nachkommastelle 0,
 *  damit die Meldung eine Zahl nennt (AGENTS.md, Handwerkliches). */
function msZahl(ms) { return Math.round(ms); }

/** Zahl mit deutschem Dezimalkomma — auch das Bild ist Handbuch für den Agenten.
 *  Kleine Beträge werden zu 0, nicht zu "-0,00". */
function zahl(wert, stellen = 2) {
  const v = Math.abs(wert) < Math.pow(10, -stellen) / 2 ? 0 : Number(wert);
  return v.toFixed(stellen).replace('.', ',');
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const skalar = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a) => [-a[0], -a[1], -a[2]];
const laenge = (a) => Math.hypot(a[0], a[1], a[2]);
function kreuz(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = laenge(a);
  if (!(l > 0)) fehler(`Normalisierung fehlgeschlagen: Vektor [${a.join(', ')}] hat die Länge 0`);
  return [a[0] / l, a[1] / l, a[2] / l];
}
function istPunkt(p) {
  return Array.isArray(p) && p.length === 3 && p.every((x) => Number.isFinite(x));
}
function istQuaternion(q) {
  return Array.isArray(q) && q.length === 4 && q.every((x) => Number.isFinite(x));
}

/** Achsenangabe aus dem RigProfile ('x', 'y', 'z', notfalls mit '-') als Einheitsvektor. */
function achsenVektor(angabe, feld) {
  if (typeof angabe !== 'string') {
    fehler(`${feld} = ${JSON.stringify(angabe)}: erwartet 'x', 'y' oder 'z' (optional mit '-')`);
  }
  const treffer = /^(-?)([xyz])$/.exec(angabe);
  if (!treffer) {
    fehler(`${feld} = '${angabe}': erwartet 'x', 'y' oder 'z' (optional mit '-' gedreht)`);
  }
  const v = [0, 0, 0];
  v['xyz'.indexOf(treffer[2])] = treffer[1] === '-' ? -1 : 1;
  return v;
}

/** Rundet einen gewünschten Gitterschritt auf den nächsten glatten Meterwert. */
export function glatterSchritt(wunschMeter) {
  if (!(wunschMeter > 0) || !Number.isFinite(wunschMeter)) {
    fehler(`Gitterschritt nicht bestimmbar: gewünscht ${wunschMeter} m, mehr als 0 nötig`);
  }
  const base = Math.pow(10, Math.floor(Math.log10(wunschMeter)));
  const normiert = wunschMeter / base;
  const kandidaten = [1, 2, 2.5, 5, 10];
  const gewaehlt = kandidaten.find((k) => k >= normiert - 1e-9) ?? 10;
  return Number((gewaehlt * base).toPrecision(4));
}

/** Konvexe Hülle von 2D-Punkten, positiver Umlaufsinn. Derselbe Algorithmus wie in
 *  src/rig/measure.js — dort nicht exportiert, deshalb 18 eigene Zeilen statt eine
 *  fremde Datei anzufassen. */
function huehle2D(punkte) {
  if (punkte.length < 3) return punkte.map((p) => [p[0], p[1]]);
  const pts = punkte.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const kreuz2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const unten = [];
  for (const p of pts) {
    while (unten.length >= 2 && kreuz2(unten[unten.length - 2], unten[unten.length - 1], p) <= 0) unten.pop();
    unten.push(p);
  }
  const oben = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (oben.length >= 2 && kreuz2(oben[oben.length - 2], oben[oben.length - 1], p) <= 0) oben.pop();
    oben.push(p);
  }
  unten.pop();
  oben.pop();
  const huelle = unten.concat(oben);
  let umlauf = 0;
  for (let i = 0; i < huelle.length; i++) {
    const a = huelle[i], b = huelle[(i + 1) % huelle.length];
    umlauf += a[0] * b[1] - b[0] * a[1];
  }
  if (umlauf < 0) huelle.reverse();
  return huelle;
}

function polygonFlaeche(punkte) {
  let a = 0;
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i], q = punkte[(i + 1) % punkte.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Charakter-Bezugssystem und die vier festen Ansichten
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liest das Bezugssystem aus dem RigProfile: hoch, vorn, links, Bodenhöhe, Körperhöhe.
 * Nichts wird angenommen — eine andere Ausrichtung als up='y' wird abgelehnt statt
 * umgerechnet (wie in src/validate/physics.js).
 */
export function charakterSystem(profile) {
  const w = profile && profile.world;
  if (!w || typeof w !== 'object' || Array.isArray(w)) {
    fehler(`world fehlt im RigProfile: Körperhöhe und Bodenebene werden gemessen, nicht `
      + `getippt (übergeben: ${JSON.stringify(w ?? null)})`);
  }
  if (w.up !== 'y') {
    fehler(`world.up = ${JSON.stringify(w.up)}: erwartet 'y' — andere Ausrichtungen werden `
      + `nicht geraten (plan.md 5.1)`);
  }
  if (!(Number.isFinite(w.height) && w.height > 0)) {
    fehler(`world.height = ${JSON.stringify(w.height)}: erwartet gemessene Körperhöhe > 0 m, `
      + `daran hängen alle Maßstäbe und Toleranzen`);
  }
  const U = achsenVektor(w.up, 'world.up');
  const F = achsenVektor(w.forward ?? 'z', 'world.forward');
  const L = achsenVektor(w.left ?? 'x', 'world.left');
  if (dot(F, L) !== 0 || dot(F, U) !== 0 || dot(L, U) !== 0) {
    fehler(`world.forward/left/up sind nicht paarweise senkrecht — Skalarprodukte `
      + `F·L=${dot(F, L)}, F·U=${dot(F, U)}, L·U=${dot(L, U)}`);
  }
  return {
    U, F, L,
    groundY: Number.isFinite(w.groundY) ? w.groundY : 0,
    height: w.height,
  };
}

/** Ursprung des Charakter-Bezugssystems: Mitte der Bind-Pose auf der Bodenebene.
 *  Horizontal über alle gemessenen Gelenkpositionen gemittelt, damit das Raster an
 *  der Figur liegt — und für alle Frames gleich bleibt, sonst verschwindet jede
 *  Ortsveränderung aus dem Bild. */
function bindAnker(profile, system) {
  const bones = Array.isArray(profile.bones) ? profile.bones : [];
  const summe = [0, 0, 0];
  let nutzt = 0;
  for (const b of bones) {
    if (!istPunkt(b.bindWorld)) continue;
    summe[0] += b.bindWorld[0];
    summe[2] += b.bindWorld[2];
    nutzt++;
  }
  if (nutzt === 0) {
    fehler(`Bind-Anker nicht messbar: ${bones.length} Knochen im RigProfile, 0 mit gültiger `
      + `bindWorld — ohne Anker hat das Bodengitter keinen Ursprung`);
  }
  return [summe[0] / nutzt, system.groundY, summe[2] / nutzt];
}

/** Blickrichtung (Auge -> Ziel) und Auf-Richtung der Ansicht, im Charakter-System. */
function ansichtRichtung(system, ansicht) {
  const { U, F, L } = system;
  switch (ansicht) {
    case 'front':
      return { blick: neg(F), auf: U, sag: 'von vorn; die linke Hand erscheint rechts im Bild' };
    case 'side':
      return { blick: neg(L), auf: U,
        sag: 'von links auf die linke Körperseite; vorn zeigt nach links im Bild' };
    case 'quarter':
      return { blick: neg(add(F, L)), auf: U, sag: 'schräg von vorn links' };
    case 'top':
      return { blick: neg(U), auf: F, sag: 'von oben; vorn zeigt nach oben im Bild' };
    default:
      return null;
  }
}

/** Kamerabasis einer Ansicht: X rechts ins Bild, Y hoch ins Bild, blick vom Auge
 *  zum Ziel. Reine Vektorrechnung, damit Overlay und Mesh dieselbe Projektion nutzen. */
function kamerabasis(system, ansicht) {
  const r = ansichtRichtung(system, ansicht);
  if (!r) {
    fehler(`Ansicht '${ansicht}' ist unbekannt: erlaubt sind ${ANSICHTEN.length} Stück — `
      + `${ANSICHTEN.join(', ')}`);
  }
  const blick = norm(r.blick);
  const X = norm(kreuz(blick, r.auf));
  const Y = kreuz(X, blick);
  return { blick, X, Y, sag: r.sag };
}

/** Orthografische Projektion eines Weltpunkts ins Panel. */
function projiziere(pan, p) {
  const r = dot(sub(p, pan.ziel), pan.X);
  const h = dot(sub(p, pan.ziel), pan.Y);
  return [
    pan.x + pan.breite / 2 + r * pan.pxProMeter,
    pan.y + pan.hoehe / 2 - h * pan.pxProMeter,
  ];
}

/** Lage eines Weltpunkts in der Bodenebene, als Charakter-Koordinaten [links, vorn]. */
function ebene(system, p) { return [dot(p, system.L), dot(p, system.F)]; }

/** Rückweg: Punkt der Bodenebene aus [links, vorn] in Weltkoordinaten. */
function weltAusEbene(system, e) {
  return add(add(skalar(system.L, e[0]), skalar(system.F, e[1])), skalar(system.U, system.groundY));
}

// ─────────────────────────────────────────────────────────────────────────────
// Eingaben prüfen — jede Meldung enthält eine Zahl
// ─────────────────────────────────────────────────────────────────────────────

function pruefeProfil(profile) {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    fehler(`RigProfile fehlt: übergeben ist ${JSON.stringify(profile)} — Körpermaße werden `
      + `gemessen, nicht getippt`);
  }
  const { ok, errors } = validateRigProfile(profile);
  if (!ok) {
    const ersten = errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join(' | ');
    fehler(`RigProfile ist nicht gültig (${errors.length} Fehler, die ersten `
      + `${Math.min(3, errors.length)}): ${ersten}`);
  }
  if (profile.soles.length === 0) {
    fehler('RigProfile enthält 0 Sohlenpunkte: ohne gemessene Kontaktflächen gibt es keine '
      + 'Stützfläche und keine Kontaktpunkte — ein Streifen ohne Annotationen wird nicht ausgeliefert');
  }
  if (profile.segments.length === 0) {
    fehler('RigProfile enthält 0 Segmente: Schwerpunkt und Körperdicke sind dann nicht messbar');
  }
}

function pruefeViews(views) {
  if (!Array.isArray(views) || views.length === 0) {
    fehler(`views = ${Array.isArray(views) ? 'leeres Array' : JSON.stringify(views ?? null)}: `
      + `erwartet 1 bis ${ANSICHTEN.length} Ansichten aus ${ANSICHTEN.join(', ')}`);
  }
  if (new Set(views).size !== views.length) {
    fehler(`views nennt ${views.length} Ansichten mit nur ${new Set(views).size} verschiedenen — `
      + `jede Ansicht genau einmal`);
  }
  for (const v of views) {
    if (!ANSICHTEN.includes(v)) {
      fehler(`Ansicht '${v}' ist unbekannt: erlaubt sind ${ANSICHTEN.length} Stück — `
        + `${ANSICHTEN.join(', ')} (die Ansichten liegen im Charakter-Bezugssystem, nicht in dem der Bühne)`);
    }
  }
}

/** Schwerpunkt aus den gemessenen Segmentmassen und den gestellten Segmentmitten. */
function schwerpunktMessen(profile, wo, index) {
  let masse = 0;
  const summe = [0, 0, 0];
  let nutzt = 0;
  for (const s of profile.segments) {
    const a = wo[s.from];
    const b = wo[s.to];
    if (!a || !b || !(s.mass > 0)) continue;
    nutzt++;
    masse += s.mass;
    summe[0] += ((a[0] + b[0]) / 2) * s.mass;
    summe[1] += ((a[1] + b[1]) / 2) * s.mass;
    summe[2] += ((a[2] + b[2]) / 2) * s.mass;
  }
  if (!(masse > 0)) {
    fehler(`Frame ${index}: Schwerpunkt nicht rechnbar über ${nutzt} von `
      + `${profile.segments.length} Segmenten (Gesamtmasse ${zahl(masse, 5)} kg)`);
  }
  return { com: skalar(summe, 1 / masse), segmente: nutzt };
}

/**
 * Prüft die Frame-Liste und rechnet je Frame, was gezeichnet wird.
 *
 * Ein Frame trägt `positions` (Weltpositionen je Knochen, wie src/validate/physics.js
 * sie erwartet) und/oder `bones` (je Knochen `position`, `quaternion` und `weltSkala`
 * — nötig, um die Figur als Mesh zu stellen und Sohlenpunkte korrekt umzurechnen).
 * Optional `com`, `contact` ('kontakt'|'flug') und `anchored`.
 *
 * `frameAusScene()` liefert alle drei Bones-Angaben aus einer Szene, ohne dass sie
 * jemand eintippt.
 */
function pruefeFrames(profile, system, frames, opts) {
  if (!Array.isArray(frames) || frames.length === 0) {
    fehler(`frames = ${Array.isArray(frames) ? 'leeres Array' : JSON.stringify(frames ?? null)}: `
      + `erwartet mindestens 1 Frame, sonst zeigt das Bild nichts`);
  }
  if (frames.length > FRAMES_MAX) {
    fehler(`${frames.length} Frames angefordert: höchstens ${FRAMES_MAX}, mehr passt nicht in eine `
      + `Antwort von ${Math.round(ANTWORT_BUDGET_BYTES / 1024)} KB`);
  }
  const frameCount = opts.frameCount;
  const bereich = Number.isInteger(frameCount) && frameCount > 0 ? `0 bis ${frameCount - 1}` : 'ab 0';
  const knochenIds = new Set((profile.bones ?? []).map((b) => b.id));

  const gebraucht = new Set();
  for (const s of profile.segments) { gebraucht.add(s.from); gebraucht.add(s.to); }
  for (const s of profile.soles) gebraucht.add(s.bone);
  for (const r of Object.values(profile.roles ?? {})) if (r && r.bone) gebraucht.add(r.bone);

  const schwelleMeter = system.height * (profile.params?.soleTolerance ?? KONTAKT_SCHWELLE_ANTEIL);
  const ueberstimmungTol = system.height * POSE_UEBEREINSTIMMUNG_ANTEIL;

  return frames.map((f, i) => {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) {
      fehler(`frames[${i}] = ${JSON.stringify(f)}: erwartet Objekt mit positions und/oder bones`);
    }
    const index = Number.isInteger(f.frame) ? f.frame : i;
    if (index < 0 || (Number.isInteger(frameCount) && frameCount > 0 && index >= frameCount)) {
      fehler(`Frame ${index} liegt außerhalb der Timeline von ${bereich} (frameCount = `
        + `${frameCount === undefined ? 'nicht angegeben' : frameCount})`);
    }

    const pos = f.positions ?? null;
    const pose = f.bones ?? null;
    if (!pos && !pose) {
      fehler(`Frame ${index} liefert weder positions noch bones: 0 von ${gebraucht.size} `
        + `gebrauchten Knochen sind positioniert — ohne Pose wäre jedes Panel dasselbe Bild`);
    }

    // Alle mitgelieferten Positionen werden gezeichnet, geprüft wird die Mindestmenge.
    const wo = {};
    if (pos) {
      for (const [id, p] of Object.entries(pos)) if (istPunkt(p)) wo[id] = [p[0], p[1], p[2]];
    }
    if (pose) {
      for (const [id, k] of Object.entries(pose)) {
        if (k && istPunkt(k.position)) wo[id] = [k.position[0], k.position[1], k.position[2]];
      }
    }
    const fehlend = [...gebraucht].filter((id) => !wo[id]);
    if (fehlend.length > 0) {
      fehler(`Frame ${index} positioniert ${gebraucht.size - fehlend.length} von ${gebraucht.size} `
        + `gebrauchten Knochen; es fehlen ${fehlend.length}: ${fehlend.slice(0, 4).join(', ')}`
        + (fehlend.length > 4 ? ' …' : ''));
    }

    if (pose && knochenIds.size > 0) {
      const fremde = Object.keys(pose).filter((k) => !knochenIds.has(k));
      if (fremde.length > 0) {
        fehler(`Frame ${index} nennt ${fremde.length} Knochen, die das RigProfile mit `
          + `${knochenIds.size} Knochen nicht kennt, z. B. ${fremde.slice(0, 3).join(', ')}`);
      }
    }

    // Zwei Angaben derselben Pose müssen zusammenpassen, sonst zeigt das Bild die
    // eine und die Zahl die andere.
    if (pos && pose) {
      let maxAbw = 0;
      let worst = null;
      for (const [id, p] of Object.entries(pos)) {
        const q = pose[id] && pose[id].position;
        if (!istPunkt(p) || !istPunkt(q)) continue;
        const d = laenge(sub(p, q));
        if (d > maxAbw) { maxAbw = d; worst = id; }
      }
      if (maxAbw > ueberstimmungTol) {
        fehler(`Frame ${index}: positions und bones beschreiben verschiedene Posen — größter `
          + `Unterschied ${zahl(maxAbw, 4)} m an ${worst}, erlaubt ${zahl(ueberstimmungTol, 4)} m `
          + `(${POSE_UEBEREINSTIMMUNG_ANTEIL * 100} % der gemessenen Körperhöhe `
          + `${zahl(system.height, 3)} m)`);
      }
    }

    // Sohlenpunkte: aus dem gemessenen Knochen-lokalen Punkt mit der vollen
    // Welttransformation des Knochens gerechnet. Fehlt Ausrichtung ODER Weltmaßstab,
    // sitzt der Punkt auf dem Gelenk und wird im Bild als behelfsmäßig ausgewiesen —
    // gerechnete Genauigkeit nur, wo sie auch gemessen wurde.
    const groesterAbstandMeter = system.height * SOHLE_ABSTAND_MAX_ANTEIL;
    const sohlen = [];
    let ohneAusrichtung = 0;
    for (const s of profile.soles) {
      const kn = pose && pose[s.bone];
      const gelenk = wo[s.bone];
      const q = kn && kn.quaternion;
      const weltSkala = kn && kn.weltSkala;
      let welt;
      if (kn && istPunkt(kn.position) && istQuaternion(q) && istPunkt(weltSkala)) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(kn.position[0], kn.position[1], kn.position[2]),
          new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize(),
          new THREE.Vector3(weltSkala[0], weltSkala[1], weltSkala[2]),
        );
        const v = new THREE.Vector3(s.local[0], s.local[1], s.local[2]).applyMatrix4(m);
        welt = [v.x, v.y, v.z];
        const abstand = laenge(sub(welt, gelenk));
        if (!(abstand <= groesterAbstandMeter)) {
          fehler(`Frame ${index}: Sohle ${s.id} liegt ${zahl(abstand, 2)} m vom Gelenk ${s.bone} `
            + `entfernt, erlaubt sind ${zahl(groesterAbstandMeter, 2)} m `
            + `(${SOHLE_ABSTAND_MAX_ANTEIL * 100} % der gemessenen Körperhöhe ${zahl(system.height, 2)} m) `
            + `— die Umrechnung von Knochen-lokal nach Welt stimmt nicht, meist fehlt der `
            + `Weltmaßstab des Knochens (frames.bones.${s.bone}.weltSkala)`);
        }
      } else {
        welt = gelenk.slice();
        ohneAusrichtung++;
      }
      sohlen.push({
        id: s.id, bone: s.bone, welt, gelenk,
        amBoden: (welt[1] - system.groundY) <= schwelleMeter,
      });
    }

    const kontakt = sohlen.filter((s) => s.amBoden);
    const phase = (f.contact === 'flug' || f.contact === 'kontakt')
      ? f.contact
      : (kontakt.length > 0 ? 'kontakt' : 'flug');

    const vorgegeben = istPunkt(f.com);
    const gemessen = vorgegeben ? null : schwerpunktMessen(profile, wo, index);

    return {
      index,
      wo,
      pose,
      sohlen,
      kontakt,
      phase,
      verankert: Array.isArray(f.anchored) ? f.anchored : null,
      com: vorgegeben ? [f.com[0], f.com[1], f.com[2]] : gemessen.com,
      comQuelle: vorgegeben ? 'vorgegeben' : `gemessen über ${gemessen.segmente} Segmente`,
      sohlenOhneAusrichtung: ohneAusrichtung,
    };
  });
}

/** Wie viel Luft um die gemessene Bewegungs-Bounding-Box mindestens bleibt,
 *  Anteil der Körperhöhe: Ohne Puffer läge die äußerste Knochenposition exakt
 *  auf der Panelkante — von der Kontur um Knochendicke und Segmentradius bliebe
 *  dann nichts zu sehen. */
export const RAHMEN_LUFT_ANTEIL = 0.10;

// ─────────────────────────────────────────────────────────────────────────────
// Rahmung über die Bewegung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst den Bewegungsbereich: die äußersten Positionen aller Körperteile über
 * alle übergebenen Frames. GEMESSEN (AGENTS.md, Regel 1) — aus den Weltpunkten,
 * die der Aufrufer mitbringt: Knochenpositionen, Schwerpunkt und Sohlenpunkte.
 * Der Sohlenpunkt liegt an der Fußunterseite, der Schwerpunkt im Körperkern —
 * die Knochen liefern ohnehin die äußersten Ränder, beide werden mitgenommen,
 * damit nichts Gemessenes fehlt.
 *
 * @param {object[]} frames geprüfte Frames (je `wo` mit Weltpositionen)
 * @param {object} system charakterSystem(profile) — nur für die Fehlermeldung
 * @returns {{min:[number,number,number], max:[number,number,number]}}
 */
function bewegungsBereich(frames, system) {
  if (!Array.isArray(frames) || frames.length === 0) {
    fehler(`Bewegungsbereich nicht messbar: ${Array.isArray(frames) ? frames.length : 0} `
      + `Frames übergeben, mindestens 1 nötig`);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const nimm = (p) => {
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  };
  for (const f of frames) {
    for (const p of Object.values(f.wo)) nimm(p);
    nimm(f.com);
    for (const s of f.sohlen) nimm(s.welt);
  }
  return { min, max };
}

/**
 * Ein orthografisches Framing über ALLE übergebenen Punktfelder, in der
 * Bildebene der Ansicht (X = rechts ins Bild, Y = hoch ins Bild): je Richtung
 * der größte Bedarf der Felder plus Luft, der Maßstab danach so, dass der
 * weite Richtung ins Panel passt. Alle Panels derselben Ansicht bekommen
 * DASSELBE Ergebnis — der Streifen bleibt vergleichbar (plan.md 6.8).
 *
 * @param {Array<{min:[number,number,number], max:[number,number,number]}>} felder
 *        z. B. [bewegungsBereich(...), {min: anker, max: anker}] — der Bind-
 *        Anker gehört als Punkt mit hinein, an ihm hängen Achsenkreuz und
 *        Maßstabsbalken, beide müssen sichtbar bleiben
 * @param {{X:number[], Y:number[], blick:number[], sag:string}} basis kamerabasis()
 * @param {number} panelBreite px
 * @param {number} panelHoehe px
 * @param {number} luftMeter Puffer um das Feld, Anteil der Körperhöhe
 * @returns {{ziel: number[], pxProMeter: number}}
 */
function panelKamera(felder, basis, panelBreite, panelHoehe, luftMeter) {
  const spanX = [];
  const spanY = [];
  for (const f of felder) {
    // Alle 8 Ecken der wellen-achsigen Bounding-Box projizieren: die Ansichten
    // liegen im Charakter-System (quarter blickt schräg), dort hängt der
    // äußerste Bildrand an Ecken wie (links, vorn) — nicht an min/max allein.
    for (const x of [f.min[0], f.max[0]]) {
      for (const y of [f.min[1], f.max[1]]) {
        for (const z of [f.min[2], f.max[2]]) {
          const p = [x, y, z];
          spanX.push(dot(p, basis.X));
          spanY.push(dot(p, basis.Y));
        }
      }
    }
  }
  if (spanX.some((x) => !Number.isFinite(x)) || spanY.some((y) => !Number.isFinite(y))) {
    fehler(`Bewegungsbereich enthält einen nicht endlichen Punkt — Rahmung nicht möglich `
      + `(min = ${JSON.stringify(felder[0]?.min)}, max = ${JSON.stringify(felder[0]?.max)})`);
  }
  const bedarfX = Math.max(...spanX) - Math.min(...spanX) + 2 * luftMeter;
  const bedarfY = Math.max(...spanY) - Math.min(...spanY) + 2 * luftMeter;
  if (!(bedarfX > 0) || !(bedarfY > 0)) {
    fehler(`Bewegungsbereich nicht rahmbar: ${zahl(bedarfX, 4)} × ${zahl(bedarfY, 4)} m `
      + `Breite × Höhe in der Bildebene — von einer Figur ohne Ausdehnung gibt es kein Bild`);
  }
  // Der Maßstab folgt dem WEITEN Bedarf: die andere Richtung hat dann Luft und
  // der Maßstabsbalken bleibt lesbar.
  const pxProMeter = Math.min(panelBreite / bedarfX, panelHoehe / bedarfY);

  // Ziel: Mitte des Rahmens in beiden Bildrichtungen. Nur die Anteile entlang
  // X und Y sind im orthografischen Bild sichtbar; die Tiefe des Ziels legt
  // nur das Nah/Far-Fenster von kameraFuerPan fest und ist hier gleichgültig.
  const mitteX = (Math.max(...spanX) + Math.min(...spanX)) / 2;
  const mitteY = (Math.max(...spanY) + Math.min(...spanY)) / 2;
  return { ziel: add(skalar(basis.X, mitteX), skalar(basis.Y, mitteY)), pxProMeter };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zeichengruppen — jeweils Primitives in Pixelkoordinaten
// ─────────────────────────────────────────────────────────────────────────────

const linie = (g, a, b, farbe, breite, extra) => g.push({ art: 'linie', a, b, farbe, breite, ...extra });
const punkt = (g, p, r, fuellung, extra) => g.push({ art: 'punkt', x: p[0], y: p[1], r, fuellung, ...extra });
const text = (g, p, s, farbe, groesse, anker = 'links') =>
  g.push({ art: 'text', x: p[0], y: p[1], text: s, farbe, groesse, anker });

/**
 * Ground-Raster WELTkoordinaten: Linien beider Richtungen in der Bodenebene der
 * Bind-Pose, um den gemessenen Anker, in Schritten des gemessenen Maßstabs.
 *
 * Das Raster liegt am Charakter-Anker und liegt über alle Frames gleich — nur so ist
 * eine Ortsveränderung im Bild zu sehen, statt vom mitziehenden Bild verschluckt zu
 * werden. Mit Szenen wird es als 3D-Liniensatz vor das Mesh gezeichnet (tiefer-
 * getestet, also hinter dem Körper sichtbar); ohne Szene wird es in jedes Panel
 * projiziert.
 *
 * Die Reichweite folgt der Rahmung (Aufgabe 2): die Kamera legt den Maßstab nach
 * der Bewegung fest, das Raster muss mindestens das sichtbare Stück Bodenebene
 * abdecken — sonst steht die getragene Figur auf einer leeren Fläche.
 *
 * @param {object} system charakterSystem(profile)
 * @param {number[]} anker Bind-Anker
 * @param {number} schritt Gitterschritt in Metern
 * @param {number} reichweiteMeter abzudeckender Radius um den Anker, gemessen
 */
function gitterWeltLinien(system, anker, schritt, reichweite) {
  if (!(reichweite > 0) || !Number.isFinite(reichweite)) {
    fehler(`Gitterreichweite nicht messbar: ${reichweite} m — erwartet der Radius des `
      + `gerahmten Bewegungsbereichs um den Bind-Anker, mehr als 0 m`);
  }
  const stufen = Math.ceil(reichweite / schritt);
  const linien = [];
  const bodenLinien = [];
  for (let k = -stufen; k <= stufen; k++) {
    const versatzL = skalar(system.L, k * schritt);
    const versatzF = skalar(system.F, k * schritt);
    const a = {
      a: add(add(anker, versatzL), skalar(system.F, -reichweite)),
      b: add(add(anker, versatzL), skalar(system.F, reichweite)),
    };
    const b = {
      a: add(add(anker, versatzF), skalar(system.L, -reichweite)),
      b: add(add(anker, versatzF), skalar(system.L, reichweite)),
    };
    linien.push(a, b);
    if (k === 0) bodenLinien.push(a, b);   // die beiden durch den Anker: heller
  }
  return { linien, bodenLinien, reichweite };
}

/** Maßstabsleiste auf der Bodenkante und Höhenlineal am linken Rand. */
function zeichneMassstab(pan, system, anker, schritt) {
  const g = pan.annotationen.bodengitter;
  const bodenPy = projiziere(pan, anker)[1];
  const xR = pan.x + pan.breite - 12;
  const stufen = Math.max(1, Math.floor(pan.breite * 0.32 / (schritt * pan.pxProMeter) + 1e-9));

  for (let k = 0; k <= stufen; k++) {
    const x = xR - k * schritt * pan.pxProMeter;
    linie(g, [x, bodenPy], [x, bodenPy - (k % 2 === 0 ? 8 : 4)], FARBE.boden, 1);
    if (k % 2 === 0) {
      // mittig, es sei denn, das Etikett würde über die rechte Panelkante laufen:
      // dort wird die Zahl abgeschnitten und der Maßstab ist unlesbar. Geprüft
      // wird mit ETIKETT_HALB_PX, weil die Ebene hier noch keine Font-Metriken
      // kennt — gemessen wird der Überlauf im Abnahmetest mit measureText().
      const laeuftUeber = x + ETIKETT_HALB_PX > pan.x + pan.breite - 2;
      text(g, [x, bodenPy - 11], zahl(k * schritt, 2) + ' m', FARBE.textSchwach, 9,
        laeuftUeber ? 'rechts' : 'mitte');
    }
  }
  linie(g, [xR, bodenPy], [xR - stufen * schritt * pan.pxProMeter, bodenPy], FARBE.boden, 1.5);
  text(g, [xR, bodenPy - 23], `1 Kasten = ${zahl(schritt, 2)} m`, FARBE.text, 9, 'rechts');

  const x0 = pan.x + 12;
  for (let k = 1; k * schritt * pan.pxProMeter < bodenPy - (pan.y + 26); k++) {
    const y = bodenPy - k * schritt * pan.pxProMeter;
    linie(g, [x0, y], [x0 + (k % 2 === 0 ? 9 : 5), y], FARBE.boden, 1);
    if (k % 2 === 0) text(g, [x0 + 12, y + 3], zahl(k * schritt, 2) + ' m', FARBE.textSchwach, 9);
  }
  linie(g, [x0, bodenPy], [x0, pan.y + 26], FARBE.boden, 1);
}

/** Achsenkreuz im Bind-Anker: x = links, y = hoch, z = vorn; Richtungen gemessen. */
function zeichneAchsenkreuz(pan, system, anker) {
  const g = pan.annotationen.achsenkreuz;
  const len = system.height * ACHSEN_LENTEIL;
  const ursprung = projiziere(pan, anker);
  const achsen = [
    { richtung: system.L, beschriftung: 'x links', farbe: FARBE.achseX },
    { richtung: system.U, beschriftung: 'y hoch', farbe: FARBE.achseY },
    { richtung: system.F, beschriftung: 'z vorn', farbe: FARBE.achseZ },
  ];
  for (const a of achsen) {
    const ende = projiziere(pan, add(anker, skalar(a.richtung, len)));
    linie(g, ursprung, ende, a.farbe, 2);
    punkt(g, ende, 2.5, a.farbe);
    text(g, [ende[0] + 4, ende[1] - 4], a.beschriftung, a.farbe, 9);
  }
  // Das Ursprungsetikett steht zentriert am Achsenkreuz-Ursprung. Läuft es über
  // die rechte Panelkante — möglich, seit die Kamera über die Bewegung rahmt und
  // der Bind-Anker nicht mehr panelmittig liegt — wird es rechtsbündig an die
  // Kante gerückt (Aufgabe 1: nichts Entscheidendes abgeschnitten). Der Schwell-
  // wert nutzt ETIKETT_HALB_PX; das Etikett ist länger als 6 Zeichen, der Wert
  // triggert also konservativ früh. Gemessen wird der Überlauf im Abnahmetest
  // mit echten Font-Metriken (measureText).
  const etikettKante = pan.x + pan.breite - 6;
  text(g, [ursprung[0], ursprung[1] + 12],
    `Ursprung Bind-Pose, Boden ${zahl(system.groundY, 2)} m`, FARBE.textSchwach, 9,
    ursprung[0] + ETIKETT_HALB_PX * 4 > etikettKante ? 'rechts' : 'mitte');
}

/** Der Körper: mit Szene die dünnen Knochenlinien über dem Mesh, ohne Szene die
 *  gemessenen Segmentradien als Kapseln. Gehört nicht zu den fünf Pflichtgruppen. */
function zeichneKoerper(pan, profile, frame, mitMesh) {
  const g = pan.koerper;
  if (!mitMesh) {
    for (const s of profile.segments) {
      linie(g, projiziere(pan, frame.wo[s.from]), projiziere(pan, frame.wo[s.to]), FARBE.koerper,
        Math.max(2, 2 * s.radius * pan.pxProMeter), { rund: true, alpha: 0.8 });
    }
  } else {
    for (const b of profile.bones) {
      if (!b.parent || !frame.wo[b.parent] || !frame.wo[b.id]) continue;
      linie(g, projiziere(pan, frame.wo[b.parent]), projiziere(pan, frame.wo[b.id]),
        FARBE.gelenk, 1, { alpha: 0.4 });
    }
  }
  for (const id of Object.keys(frame.wo)) {
    punkt(g, projiziere(pan, frame.wo[id]), mitMesh ? 1.6 : 2.2, FARBE.gelenk,
      { alpha: mitMesh ? 0.7 : 1 });
  }
}

/** Schwerpunkt: Marker, Lot auf die Bodenebene, Höhe in Metern und in Anteil. */
function zeichneSchwerpunkt(pan, system, frame) {
  const g = pan.annotationen.schwerpunkt;
  const p = projiziere(pan, frame.com);
  const r = Math.max(4, system.height * 0.022 * pan.pxProMeter);
  const lot = projiziere(pan, [frame.com[0], system.groundY, frame.com[2]]);

  linie(g, p, lot, FARBE.lot, 1, { strich: [4, 3] });
  punkt(g, lot, 2.5, FARBE.lot);
  punkt(g, p, r, null, { rand: FARBE.schwerpunkt, breite: 2 });
  linie(g, [p[0] - r - 4, p[1]], [p[0] + r + 4, p[1]], FARBE.schwerpunkt, 1.5);
  linie(g, [p[0], p[1] - r - 4], [p[0], p[1] + r + 4], FARBE.schwerpunkt, 1.5);

  const hoeheMeter = frame.com[1] - system.groundY;
  const anteil = 100 * hoeheMeter / system.height;
  // Die Zahl steht unten rechts im Fußblock; direkt am Marker läge sie auf dem Körper.
  text(g, [pan.x + pan.breite - 6, pan.y + pan.hoehe - 17],
    `SP ${zahl(hoeheMeter, 2)} m (${zahl(anteil, 0)} % Höhe)`, FARBE.schwerpunkt, 9, 'rechts');
}

/** Stützfläche: konvexe Hülle der Sohlenpunkte mit Bodenkontakt, in der Bodenebene. */
function zeichneStuetzflaeche(pan, system, frame) {
  const g = pan.annotationen.stuetzflaeche;
  const amBoden = frame.kontakt;

  if (amBoden.length === 0) {
    text(g, [pan.x + pan.breite - 6, pan.y + pan.hoehe - 6],
      `kein Bodenkontakt ${amBoden.length}/${frame.sohlen.length} Sohlen`,
      FARBE.stuetzflaeche, 10, 'rechts');
    return;
  }

  const ebenen = amBoden.map((s) => ebene(system, s.welt));
  const huelle = huehle2D(ebenen);
  const pixel = huelle.map((e) => projiziere(pan, weltAusEbene(system, e)));

  if (pixel.length >= 3) {
    g.push({
      art: 'polygon', punkte: pixel, fuellung: FARBE.stuetzflaeche,
      rand: FARBE.stuetzflaeche, breite: 1.5, alpha: 0.3,
    });
  } else {
    for (const p of pixel) punkt(g, p, 3, FARBE.stuetzflaeche);
    if (pixel.length === 2) linie(g, pixel[0], pixel[1], FARBE.stuetzflaeche, 2);
  }

  const ls = ebenen.map((e) => e[0]);
  const fs = ebenen.map((e) => e[1]);
  const breite = Math.max(...ls) - Math.min(...ls);
  const tiefe = Math.max(...fs) - Math.min(...fs);
  // Die Eckenzahl der Hülle bleibt hier weg: sie ist die für den Agenten
  // unverfänglichste der vier Angaben und dieses Etikett muss in das schmalste
  // Panel passen, das die Budgettreppe liefert (12 Frames × 4 Ansichten).
  text(g, [pan.x + pan.breite - 6, pan.y + pan.hoehe - 6],
    `Stützfläche ${amBoden.length}/${frame.sohlen.length} Sohlen, `
    + `${zahl(breite, 2)}×${zahl(tiefe, 2)} m, ${zahl(polygonFlaeche(huelle), 3)} m²`,
    FARBE.stuetzflaeche, 9, 'rechts');
}

/** Kontaktpunkte: alle gemessenen Sohlenpunkte; belastete gefüllt, freie hohl. */
function zeichneKontaktpunkte(pan, system, frame) {
  const g = pan.annotationen.kontaktpunkte;
  const r = Math.max(3, system.height * 0.014 * pan.pxProMeter);
  frame.sohlen.forEach((s, i) => {
    const p = projiziere(pan, s.welt);
    if (s.amBoden) {
      punkt(g, p, r, FARBE.kontakt);
      // Beschriftungen abwechselnd über und unter dem Punkt: in der Draufsicht
      // liegen acht Sohlenpunkte dicht beieinander.
      text(g, [p[0] + r + 2, p[1] + (i % 2 === 0 ? -4 : 9)],
        s.id.replace(/^sole_/, ''), FARBE.kontakt, 8);
    } else {
      punkt(g, p, r, null, { rand: FARBE.kontakt, breite: 1, alpha: 0.6 });
    }
  });
  const verankert = frame.verankert
    ? frame.sohlen.filter((s) => frame.verankert.includes(s.id) && s.amBoden).length
    : null;
  text(g, [pan.x + pan.breite - 6, pan.y + pan.hoehe - 28],
    `Kontakt ${frame.kontakt.length}/${frame.sohlen.length}`
    + (verankert === null ? '' : `, verankert ${verankert}`), FARBE.kontakt, 9, 'rechts');

  if (frame.sohlenOhneAusrichtung > 0) {
    text(g, [pan.x + pan.breite - 6, pan.y + pan.hoehe - 39],
      `${frame.sohlenOhneAusrichtung} Sohlen auf dem Gelenk (ohne Ausrichtung)`,
      FARBE.kontakt, 9, 'rechts');
  }
}

/** Kopfzeile jedes Panels: Ansicht, Frame, Phase und die gemessene Körperhöhe. */
function zeichneBeschriftung(pan, system, frame, schritt) {
  const g = pan.beschriftung;
  text(g, [pan.x + 6, pan.y + 13],
    `${pan.ansicht} · Frame ${frame.index} · ${frame.phase}`, FARBE.text, 11);
  text(g, [pan.x + pan.breite - 6, pan.y + 13],
    `Körperhöhe ${zahl(system.height, 2)} m`, FARBE.textSchwach, 9, 'rechts');
}

// ─────────────────────────────────────────────────────────────────────────────
// Ebene 1: der Plan — reine Geometrie, läuft in Node
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legt Panels, Maßstab und alle Zeichenprimitives fest.
 *
 * @param {object} opts
 * @param {object}         opts.profile      RigProfile (plan.md 5.1), vermessen
 * @param {object[]}       opts.frames       Frames mit positions und/oder bones
 * @param {string[]}       [opts.views]      Ansichten aus ANSICHTEN; Reihenfolge = Zeilen
 * @param {number}         [opts.frameCount] Timeline-Länge; Frames außerhalb werden abgelehnt
 * @param {THREE.Object3D} [opts.scene]      Szene => Figur als Mesh; ohne Szene wird sie aus
 *                                           den gemessenen Segmentradien als Kapseln gerastert
 * @param {number}         [opts.skala]      Multiplikator der Panelauflösung (Budgetabgleich)
 */
export function planeStreifen(opts) {
  const { profile } = opts;
  pruefeProfil(profile);
  const views = opts.views === undefined ? ['front', 'side'] : opts.views;
  pruefeViews(views);

  const system = charakterSystem(profile);
  const aufgestellt = pruefeFrames(profile, system, opts.frames, opts);

  const mitMesh = opts.scene !== undefined && opts.scene !== null;
  const anzahlPanels = aufgestellt.length * views.length;
  if (anzahlPanels > MAX_PANELS) {
    fehler(`${aufgestellt.length} Frames × ${views.length} Ansichten = ${anzahlPanels} Panels, `
      + `höchstens ${MAX_PANELS}`);
  }

  if (mitMesh) {
    const ohne = aufgestellt.filter((f) => !f.pose).map((f) => f.index);
    if (ohne.length > 0) {
      fehler(`Scene übergeben, aber ${ohne.length} von ${aufgestellt.length} Frames (z. B. `
        + `${ohne.slice(0, 3).join(', ')}) liefern keine Gelenkausrichtung: das Mesh bliebe in der `
        + `Bind-Pose stehen und jedes Panel zeigte dasselbe Bild — genau der Fehler, den dieser `
        + `Streifen suchen soll`);
    }
  }

  // Zeitkürzung, Schritt 2 im Auftrag "Der Bildstreifen frisst den Rechner":
  // die Panelzahl wird VOR dem Rendern auf PANELS_ZEIT_MAX gekürzt — gemessen
  // an Xbot.glb, SwiftShader (spikes/tmp-strip-zeit.mjs, 31.08.2026), siehe
  // die Begründung am Parameter PANELS_ZEIT_MAX. Über 24 Panels hinaus werden
  // die Frames JE ANSICHT gekürzt: die ersten n liegen im Bild (bei sortierter
  // Auswahl decken sie Stütz, Druck und Flug ab), die angeforderte Zahl und
  // die Kürzung stehen als Warnung am Streifen (plan.md 5.5 — nichts
  // verschwindet still). Der Fall 12 Frames × 4 Ansichten, der heute 2151 ms
  // rendert und dann am Bytebudget scheitert, kürzt hier auf 6 Frames und
  // kommt in unter einer Sekunde mit 24 Panels zurück.
  const framesAngefordert = aufgestellt.length;
  const panelsErst = framesAngefordert * views.length;
  let gekuert = 0;
  if (panelsErst > PANELS_ZEIT_MAX) {
    const behalte = Math.max(1, Math.floor(PANELS_ZEIT_MAX / views.length));
    aufgestellt.length = behalte;
    gekuert = framesAngefordert - behalte;
  }

  const skala = Number.isFinite(opts.skala) && opts.skala > 0 ? opts.skala : 1;
  const panelBreite = Math.max(40, Math.round(PANEL_BREITE_PX * skala));
  const panelHoehe = Math.max(40, Math.round(PANEL_HOEHE_PX * skala));

  // ── Rahmung über die BEWEGUNG, nicht über die Bind-Pose ───────────────────
  //
  // Der Auftrag der Panels ist Vergleichbarkeit: derselbe Bildausschnitt in
  // jeder Spalte. Rahmt die Kamera gegen die Bind-Pose, trägt die erste
  // Ortsveränderung die Figur aus dem Bild — der Agent beurteilt dann ein Bild,
  // dem das Entscheidende fehlt. Also:
  //
  //   1. Der Bewegungsbereich wird GEMESSEN: äußerste Positionen aller
  //      Körperteile über alle gezeigten Frames (plus Schwerpunkt und Sohlen).
  //      Erst nach der Zeitkürzung — weggekürzte Frames sind nicht im Bild und
  //      dürfen den Rahmen nicht weiter ziehen.
  //   2. JE Ansicht wird EINE Kamera über den ganzen Bereich gelegt. Alle
  //      Panels einer Zeile nutzen sie gemeinsam; der Maßstab ergibt sich aus
  //      dem größeren Bedarf der beiden Bildrichtungen, geteilt durch die
  //      Panelgröße (plan.md 6.8: nebeneinander, vergleichbar).
  //   3. Puffer und Bodenlinie sind Anteile der gemessenen Körperhöhe — der
  //      Rahmen bleibt relativ, niemals ein getipptes Meter.
  //
  // Je Ansicht ein eigener Maßstab, denn die Ausdehnung der Bewegung hängt von
  // der Blickrichtung ab (ein Sprung ist von der Seite höher als von vorn
  // breit). Verglichen wird Frame gegen Frame INNERHALB einer Zeile — dafür
  // ist die Kamera dort identisch.
  const rahmenBereich = bewegungsBereich(aufgestellt, system);

  const anker = bindAnker(profile, system);
  const schritt = glatterSchritt(system.height / GITTER_TEILUNG);
  const luft = system.height * RAHMEN_LUFT_ANTEIL;
  // Je Ansicht EINE Kamera über den ganzen Bewegungsbereich plus Bind-Anker —
  // alle Panels der Zeile nutzen sie gemeinsam, sonst ist Frame gegen Frame
  // nicht vergleichbar (plan.md 6.8). Der Anker gehört mit hinein: an ihm
  // hängen Achsenkreuz und Maßstabsbalken, beide müssen sichtbar bleiben.
  const kameras = new Map();
  for (const ansicht of views) {
    kameras.set(ansicht, panelKamera(
      [rahmenBereich, { min: anker, max: anker }], kamerabasis(system, ansicht),
      panelBreite, panelHoehe, luft));
  }
  // Das Raster bleibt WELTfest (Aufgabe 2): Bodengitter und Höhenmarken wandern
  // nicht mit, sie bleiben an ihrer Weltposition. Seine Reichweite folgt der
  // gerahmten Fläche — das größte Kamerafenster der Streifens, damit die
  // getragene Figur nicht auf einer leeren Fläche steht. Der Faktor 2: auch
  // der Anker liegt irgendwo im Fenster, die Reichweite muss von IHN bis in
  // die fernste sichtbare Bodenecke reichen; plus Luft.
  const maxHalbMeter = Math.max(...views.map((v) => {
    const k = kameras.get(v);
    return Math.max(panelBreite, panelHoehe) / 2 / k.pxProMeter;
  }));
  const gitter = gitterWeltLinien(system, anker, schritt,
    Math.max(system.height * SICHT_HOEHE_FAKTOR, 2 * maxHalbMeter + luft));

  const panels = [];
  views.forEach((ansicht, zeile) => {
    const basis = kamerabasis(system, ansicht);
    const kamera = kameras.get(ansicht);
    aufgestellt.forEach((frame, spalte) => {
      const pan = {
        ansicht,
        frame: frame.index,
        spalte,
        zeile,
        x: PANEL_ABSTAND_PX + spalte * (panelBreite + PANEL_ABSTAND_PX),
        y: PANEL_ABSTAND_PX + zeile * (panelHoehe + PANEL_ABSTAND_PX),
        breite: panelBreite,
        hoehe: panelHoehe,
        ziel: kamera.ziel, X: basis.X, Y: basis.Y, blick: basis.blick, sag: basis.sag,
        pxProMeter: kamera.pxProMeter,
        halbBreiteMeter: panelBreite / 2 / kamera.pxProMeter,
        halbHoeheMeter: panelHoehe / 2 / kamera.pxProMeter,
        schritt,
        annotationen: {
          achsenkreuz: [], bodengitter: [], schwerpunkt: [],
          stuetzflaeche: [], kontaktpunkte: [],
        },
        koerper: [],
        beschriftung: [],
      };
      if (!mitMesh) {
        // Ohne WebGL wird das Welt-Raster in das Panel projiziert.
        for (const l of gitter.linien) {
          linie(pan.annotationen.bodengitter, projiziere(pan, l.a), projiziere(pan, l.b),
            FARBE.gitter, 1);
        }
      }
      zeichneMassstab(pan, system, anker, schritt);
      zeichneStuetzflaeche(pan, system, frame);
      zeichneKontaktpunkte(pan, system, frame);
      zeichneAchsenkreuz(pan, system, anker);
      zeichneSchwerpunkt(pan, system, frame);
      zeichneKoerper(pan, profile, frame, mitMesh);
      zeichneBeschriftung(pan, system, frame, schritt);
      panels.push(pan);
    });
  });

  const warnungen = [];
  if (gekuert > 0) {
    warnungen.push(`Zeitgrenze: ${gekuert} von ${framesAngefordert} Frames entfernt, `
      + `gezeigt sind die ersten ${aufgestellt.length} in ${views.length} Ansicht`
      + `${views.length === 1 ? '' : 'en'} (${aufgestellt.length * views.length} von `
      + `${panelsErst} Panels, Grenze ${PANELS_ZEIT_MAX} Panel — gemessen gegen die `
      + `${STRIPE_ZEIT_MS}-ms-Grenze; die angeforderten Frame-Zahlen stehen im Bericht)`);
  }
  if (!mitMesh) {
    warnungen.push(`ohne Scene gerastert: 0 Mesh-Panels, Figur aus ${profile.segments.length} `
      + `gemessenen Segmentradien als Kapseln`);
  }
  const ohneAusrichtung = aufgestellt.reduce((n, f) => n + f.sohlenOhneAusrichtung, 0);
  if (ohneAusrichtung > 0) {
    warnungen.push(`${ohneAusrichtung} Sohlenpunkte über ${aufgestellt.length} Frames ohne `
      + 'Gelenkausrichtung — auf dem Knochenpunkt gesetzt und im Bild benannt');
  }

  // Schrumpft die Budgettreppe (bildeStreifen) die Panels, muss die Schrift mit
  // schrumpfen: die Panelgrößen stehen in Pixeln, die Textbreiten ebenso. Ohne
  // diesen Faktor liefen bei 12 Frames × 4 Ansichten — dem Maximum, das Werkzeug
  // `look` verlangen kann — 48 Beschriftungen über ihre Panelkante und wurden
  // abgeschnitten (gemessen mit echten Font-Metriken im Abnahmetest).
  const schriftFaktor = panelBreite / PANEL_BREITE_PX;
  if (schriftFaktor !== 1) {
    for (const pan of panels) {
      const gruppen = [...Object.values(pan.annotationen), pan.koerper, pan.beschriftung];
      for (const g of gruppen) {
        for (const p of g) {
          if (p.art === 'text') p.groesse = Math.max(4, +(p.groesse * schriftFaktor).toFixed(2));
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    views: views.slice(),
    panels,
    breite: aufgestellt.length * (panelBreite + PANEL_ABSTAND_PX) + PANEL_ABSTAND_PX,
    hoehe: views.length * (panelHoehe + PANEL_ABSTAND_PX) + PANEL_ABSTAND_PX,
    panel: { breite: panelBreite, hoehe: panelHoehe, abstand: PANEL_ABSTAND_PX },
    gitterWelt: gitter.linien,
    bodenWelt: gitter.bodenLinien,
    frames: aufgestellt.map((f) => ({
      index: f.index,
      phase: f.phase,
      kontakt: f.kontakt.length,
      sohlen: f.sohlen.length,
      schwerpunkt: f.com.map((x) => Number(x.toFixed(4))),
      schwerpunktQuelle: f.comQuelle,
    })),
    pose: aufgestellt,
    meshGezeichnet: mitMesh,
    massstab: {
      schrittMeter: schritt,
      sichtHoeheMeter: Number((panelHoehe / kameras.get(views[0]).pxProMeter).toFixed(4)),
      pxProMeter: Number(kameras.get(views[0]).pxProMeter.toFixed(4)),
      meterProPixel: Number((1 / kameras.get(views[0]).pxProMeter).toFixed(6)),
      koerperHoeheMeter: system.height,
      groundY: system.groundY,
    },
    bezug: {
      anker: anker.map((x) => Number(x.toFixed(4))),
      up: 'y',
      forward: profile.world.forward,
      left: profile.world.left,
      quelle: 'RigProfile world + bones[].bindWorld (gemessen)',
      ansichten: Object.fromEntries(views.map((v) => [v, kamerabasis(system, v).sag])),
    },
    warnungen,
  };
}

/**
 * Ein Streifen ohne Annotationen wird nicht ausgeliefert (Abnahmetest Ansichten,
 * Negativfall). Prüft jedes Panel gegen alle fünf Pflichtgruppen und verlangt am
 * Bodengitter einen beschrifteten Maßstab — ein Raster ohne Zahl ist keiner.
 */
export function pruefeVollstaendigkeit(plan) {
  if (!plan || !Array.isArray(plan.panels) || plan.panels.length === 0) {
    fehler(`Plan enthält ${(plan && plan.panels ? plan.panels.length : 0)} Panels: mindestens 1 nötig`);
  }
  const fehlt = [];
  let ohneMassstab = 0;
  for (const pan of plan.panels) {
    const gruppen = pan.annotationen || {};
    for (const gruppe of PFLICHT_ANNOTATIONEN) {
      const n = Array.isArray(gruppen[gruppe]) ? gruppen[gruppe].length : 0;
      if (n === 0) {
        fehlt.push(`${pan.ansicht}/Frame ${pan.frame}: ${gruppe} hat 0 von mindestens 1 Primitive`);
      }
    }
    const mitMeterText = (gruppen.bodengitter || [])
      .filter((p) => p.art === 'text' && typeof p.text === 'string' && p.text.endsWith(' m')).length;
    if (mitMeterText === 0) ohneMassstab++;
  }
  if (fehlt.length > 0) {
    fehler(`${plan.panels.length} Panels, ${fehlt.length} ohne vollständige Annotation — `
      + `${fehlt.slice(0, 3).join('; ')}${fehlt.length > 3 ? ` (${fehlt.length} insgesamt)` : ''}`);
  }
  if (ohneMassstab > 0) {
    fehler(`${ohneMassstab} von ${plan.panels.length} Panels haben ein Bodengitter ohne `
      + `beschrifteten Maßstab (0 Texte mit Meterangabe) — ein Raster ohne Zahl ist kein Maßstab`);
  }
  return {
    panels: plan.panels.length,
    gruppen: PFLICHT_ANNOTATIONEN.length * plan.panels.length,
    vollstaendig: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame aus einer Szene lesen — läuft in Node und im Browser (nur three-Mathematik)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liest die derzeit gestellte Pose einer Szene als Frame aus: je Knochen
 * Weltposition, Weltquaternion und Weltmaßstab. Damit ist die Eingabe, die dieser
 * Streifen braucht, aus derselben Quelle gemessen, die auch das Mesh stellt — niemand
 * tippt Skalenfaktoren ab.
 *
 * @param {THREE.Object3D} scene Szene mit Skelett
 * @param {object} [opts] { frame, contact, anchored } — Übergaben für den Frame
 * @returns {object} Frame mit bones und positions
 */
export function frameAusScene(scene, opts = {}) {
  if (!scene || typeof scene.traverse !== 'function') {
    fehler(`frameAusScene braucht eine Szene: übergeben ist ${JSON.stringify(scene ?? null)} `
      + `(0 Objekte durchsucht)`);
  }
  scene.updateMatrixWorld(true);
  const bones = {};
  const positions = {};
  let anzahl = 0;
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isBone) return;
    o.matrixWorld.decompose(p, q, s);
    bones[o.name] = {
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
      weltSkala: [s.x, s.y, s.z],
    };
    positions[o.name] = [p.x, p.y, p.z];
    anzahl++;
  });
  if (anzahl === 0) {
    fehler('frameAusScene: 0 Knochen in der Szene gefunden — ein Streifen braucht ein Skelett');
  }
  const frame = { bones, positions, Knochen: anzahl };
  if (Number.isInteger(opts.frame)) frame.frame = opts.frame;
  if (opts.contact === 'kontakt' || opts.contact === 'flug') frame.contact = opts.contact;
  if (Array.isArray(opts.anchored)) frame.anchored = opts.anchored.slice();
  return frame;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ebene 2: Pixel — Canvas 2D für das Overlay, WebGL für das Mesh
// ─────────────────────────────────────────────────────────────────────────────

/** Male ein Primitiv. Nur die 2D-Canvas-API, damit der Plan gegen jedes Canvas läuft. */
function malePrimitive(ctx, p) {
  ctx.save();
  if (p.alpha !== undefined) ctx.globalAlpha = p.alpha;
  switch (p.art) {
    case 'linie': {
      ctx.strokeStyle = p.farbe;
      ctx.lineWidth = p.breite ?? 1;
      ctx.lineCap = p.rund ? 'round' : 'butt';
      ctx.setLineDash(p.strich ?? []);
      ctx.beginPath();
      ctx.moveTo(p.a[0], p.a[1]);
      ctx.lineTo(p.b[0], p.b[1]);
      ctx.stroke();
      break;
    }
    case 'punkt': {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      if (p.fuellung) {
        ctx.fillStyle = p.fuellung;
        ctx.fill();
      }
      if (p.rand) {
        ctx.strokeStyle = p.rand;
        ctx.lineWidth = p.breite ?? 1;
        ctx.stroke();
      }
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      ctx.moveTo(p.punkte[0][0], p.punkte[0][1]);
      for (let i = 1; i < p.punkte.length; i++) ctx.lineTo(p.punkte[i][0], p.punkte[i][1]);
      ctx.closePath();
      if (p.fuellung) {
        ctx.fillStyle = p.fuellung;
        ctx.fill();
      }
      if (p.rand) {
        ctx.strokeStyle = p.rand;
        ctx.lineWidth = p.breite ?? 1;
        ctx.stroke();
      }
      break;
    }
    case 'text': {
      ctx.fillStyle = p.farbe;
      ctx.textAlign = p.anker === 'rechts' ? 'right' : (p.anker === 'mitte' ? 'center' : 'left');
      ctx.textBaseline = 'alphabetic';
      ctx.font = `${p.groesse}px ui-monospace, Consolas, monospace`;
      ctx.fillText(p.text, p.x, p.y);
      break;
    }
    default:
      ctx.restore();
      fehler(`Unbekannte Primitive '${p.art}': erlaubt sind linie, punkt, polygon, text `
        + `(4 Arten, ${p.art} ist keine davon)`);
  }
  ctx.restore();
}

/** Male den Overlay-Teil eines Plans in ein 2D-Context. */
export function zeichneOverlay(ctx, plan, { hintergrund = true } = {}) {
  for (const pan of plan.panels) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pan.x, pan.y, pan.breite, pan.hoehe);
    ctx.clip();
    if (hintergrund) {
      ctx.fillStyle = FARBE.panel;
      ctx.fillRect(pan.x, pan.y, pan.breite, pan.hoehe);
    }
    for (const gruppe of EBENEN_REIHENFOLGE) {
      for (const p of pan.annotationen[gruppe]) malePrimitive(ctx, p);
    }
    for (const p of pan.koerper) malePrimitive(ctx, p);
    for (const p of pan.beschriftung) malePrimitive(ctx, p);
    ctx.restore();
    ctx.strokeStyle = FARBE.rand;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(pan.x + 0.5, pan.y + 0.5, pan.breite - 1, pan.hoehe - 1);
  }
}

/** Orthografische three-Kamera zu denselben Basisvektoren wie das Overlay. */
function kameraFuerPan(pan, system) {
  const dist = system.height * 4;
  const cam = new THREE.OrthographicCamera(
    -pan.halbBreiteMeter, pan.halbBreiteMeter, pan.halbHoeheMeter, -pan.halbHoeheMeter,
    Math.max(0.001, dist - system.height * 2), dist + system.height * 2,
  );
  const auge = add(pan.ziel, skalar(pan.blick, -dist));
  cam.position.set(auge[0], auge[1], auge[2]);
  cam.up.set(pan.Y[0], pan.Y[1], pan.Y[2]);
  cam.lookAt(pan.ziel[0], pan.ziel[1], pan.ziel[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/** Ground-Raster als 3D-Liniensatz (für Mesh-Panels, tiefergetestet hinter dem Körper). */
function linienSatz(linien, farbeHex) {
  const punkte = [];
  for (const l of linien) {
    punkte.push(l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(punkte, 3));
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(farbeHex) });
  const satz = new THREE.LineSegments(geo, mat);
  satz.frustumCulled = false;
  return satz;
}

function gitterAlsLinienSatz(plan) {
  const gruppe = new THREE.Group();
  gruppe.name = 'ap9-bodengitter';
  gruppe.add(linienSatz(plan.gitterWelt, FARBE.gitter));
  gruppe.add(linienSatz(plan.bodenWelt, FARBE.boden));
  return gruppe;
}

/** Enthält die Szene mindestens eine Lichtquelle? Ohne jede würde das Mesh schwarz. */
function zahlLichtquellen(scene) {
  let n = 0;
  scene.traverse((o) => { if (o.isLight) n++; });
  return n;
}

/** Behelfslicht für lichtlose Szenen: zwei Lampen, Aufwandsparameter, keine Körpermaß. */
function lichtErsatz(system) {
  const gruppe = new THREE.Group();
  gruppe.name = 'ap9-behilfe-licht';
  const himmel = new THREE.HemisphereLight(0xbfd8ff, 0x28303c, LICHT_HEMISPHAERISCH);
  const richtung = new THREE.DirectionalLight(0xffffff, LICHT_RICHTUNG);
  richtung.position.set(system.height, system.height * 2, system.height * 0.6);
  gruppe.add(himmel, richtung);
  return gruppe;
}

/** Alle Knochen der Szene mit Bind-Zustand, Weltmaßstab und Tiefenreihenfolge. */
function knochenInfo(scene) {
  const boneMap = new Map();
  scene.traverse((o) => { if (o.isBone) boneMap.set(o.name, o); });
  if (boneMap.size === 0) {
    throw new Error('Pose nicht stellbar: 0 Knochen in der übergebenen Szene');
  }
  scene.updateMatrixWorld(true);

  const bind = new Map();
  for (const [name, bone] of boneMap) {
    let tiefe = 0;
    for (let p = bone.parent; p; p = p.parent) if (p.isBone) tiefe++;
    const weltPos = new THREE.Vector3();
    const weltQuat = new THREE.Quaternion();
    const weltSkala = new THREE.Vector3();
    bone.matrixWorld.decompose(weltPos, weltQuat, weltSkala);
    bind.set(name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
      weltSkala,
      bindLokal: bone.matrix.clone(),
      tiefe,
    });
  }
  const reihenfolge = [...boneMap.values()].sort((a, b) => bind.get(a.name).tiefe - bind.get(b.name).tiefe);
  return { boneMap, bind, reihenfolge };
}

function parentWeltVon(bone, welt) {
  if (!bone.parent) return new THREE.Matrix4();
  if (bone.parent.isBone) {
    const w = welt.get(bone.parent.name);
    if (w) return w;
    return bone.parent.matrixWorld;
  }
  return bone.parent.matrixWorld;
}

/**
 * Stellt die Szene auf die Welttransformationen eines Frames.
 *
 * Die Weltmaßstäbe der Bind-Pose bleiben erhalten — ein Modell, dessen Wurzel auf
 * 0,01 steht, darf durch das Stellen nicht auf 1,00 springen.
 *
 * @param {THREE.Object3D} scene Szene mit Skelett
 * @param {object} frame Frame mit `bones`
 * @param {object} [info] vorgeladene `knochenInfo(scene)`; sonst wird sie geholt
 * @returns {Function} stellt den vorherigen Zustand wieder her
 */
export function stellePose(scene, frame, info) {
  const { boneMap, bind, reihenfolge } = info || knochenInfo(scene);
  const welt = new Map();
  for (const bone of reihenfolge) {
    const i = bind.get(bone.name);
    welt.set(bone.name, parentWeltVon(bone, welt).clone().multiply(i.bindLokal));
  }
  for (const bone of reihenfolge) {
    const ziel = (frame.pose || frame.bones || {})[bone.name];
    if (!ziel || !istPunkt(ziel.position)) continue;
    const i = bind.get(bone.name);
    const q = new THREE.Quaternion(0, 0, 0, 1);
    const k = ziel.quaternion;
    if (istQuaternion(k)) {
      q.set(k[0], k[1], k[2], k[3]).normalize();
    }
    const zielWelt = new THREE.Matrix4().compose(
      new THREE.Vector3(ziel.position[0], ziel.position[1], ziel.position[2]), q, i.weltSkala,
    );
    const lokal = new THREE.Matrix4().multiplyMatrices(
      new THREE.Matrix4().copy(parentWeltVon(bone, welt)).invert(), zielWelt,
    );
    lokal.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateMatrix();
    welt.set(bone.name, parentWeltVon(bone, welt).clone().multiply(bone.matrix));
  }
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });

  return function wiederherstellen() {
    for (const [name, i] of bind) {
      const bone = boneMap.get(name);
      if (!bone) continue;
      bone.position.copy(i.position);
      bone.quaternion.copy(i.quaternion);
      bone.scale.copy(i.scale);
      bone.updateMatrix();
    }
    scene.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
  };
}

function neuesCanvas(breite, hoehe) {
  if (typeof document === 'undefined' || !document.createElement) {
    throw new Error(`Bildstreifen braucht ein Canvas: WebGL rendert im Browser, übergeben wurden `
      + `0 Canvas (${breite} × ${hoehe} Pixel verlangt)`);
  }
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  return c;
}

/** PNG als Base64 ohne Datenpräfix, plus Bytezahl. */
function pngAusCanvas(canvas) {
  const url = String(canvas.toDataURL('image/png'));
  const base64 = url.split(',')[1] ?? '';
  return { base64, bytes: Math.ceil(base64.length * 3 / 4) };
}

/**
 * Rastert den Streifen und liefert GENAU EIN Bild mit allen angeforderten Ansichten.
 * Läuft im Browser (Canvas 2D, bei Szene auch WebGL).
 *
 * @param {object} opts wie planeStreifen, zusätzlich { canvas, renderer }
 * @returns {object} Eintrag für die WebMCP-Antwort
 */
export function bildeStreifen(opts) {
  let letzteMenge = null;

  for (const skala of SKALA_STUFEN) {
    const plan = planeStreifen({ ...opts, skala });
    pruefeVollstaendigkeit(plan);

    const canvas = opts.canvas ?? neuesCanvas(plan.breite, plan.hoehe);
    canvas.width = plan.breite;
    canvas.height = plan.hoehe;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`kein 2D-Kontext auf dem Canvas ${canvas.width} × ${canvas.height} Pixel`);
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, plan.breite, plan.hoehe);

    if (plan.meshGezeichnet) {
      const system = charakterSystem(opts.profile);
      const info = knochenInfo(opts.scene);
      const gl = opts.renderer || new THREE.WebGLRenderer({
        canvas: neuesCanvas(plan.breite, plan.hoehe), antialias: true, preserveDrawingBuffer: true,
      });
      const eigenerRenderer = !opts.renderer;
      const gitter = gitterAlsLinienSatz(plan);
      opts.scene.add(gitter);
      const lichtquellen = zahlLichtquellen(opts.scene);
      const licht = lichtquellen === 0 ? lichtErsatz(system) : null;
      if (licht) {
        opts.scene.add(licht);
        plan.warnungen.push(`Szene hat 0 Lichtquellen: Behelfslicht eingefügt `
          + `(Himmelslicht ${LICHT_HEMISPHAERISCH}, Richtung ${LICHT_RICHTUNG}) — ohne Licht wäre `
          + `jedes Panel schwarz`);
      }
      try {
        gl.setPixelRatio(1);
        gl.setSize(plan.breite, plan.hoehe, false);
        gl.setScissorTest(true);
        for (const pan of plan.panels) {
          const rueckgabe = stellePose(opts.scene, plan.pose[pan.spalte], info);
          try {
            const glY = plan.hoehe - pan.y - pan.hoehe;
            gl.setViewport(pan.x, glY, pan.breite, pan.hoehe);
            gl.setScissor(pan.x, glY, pan.breite, pan.hoehe);
            gl.render(opts.scene, kameraFuerPan(pan, system));
          } finally {
            rueckgabe();
          }
        }
        gl.setScissorTest(false);
        gl.setViewport(0, 0, plan.breite, plan.hoehe);
        ctx.drawImage(gl.domElement, 0, 0);
      } finally {
        opts.scene.remove(gitter);
        if (licht) opts.scene.remove(licht);
        gitter.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        if (eigenerRenderer) gl.dispose();
      }
    }

    zeichneOverlay(ctx, plan, { hintergrund: !plan.meshGezeichnet });

    const { base64, bytes } = pngAusCanvas(canvas);
    letzteMenge = { bytes, skala };
    if (!base64.startsWith('iVBORw0K')) {
      fehler(`Bild ist kein PNG: die ersten 8 Base64-Zeichen sind '${base64.slice(0, 8)}', `
        + `erwartet 'iVBORw0K'`);
    }
    if (bytes < MIN_BILD_BYTES) {
      fehler(`Bild ist ${bytes} Byte groß: unter ${MIN_BILD_BYTES} Byte passt kein annotierter `
        + `Streifen mit ${plan.panels.length} Panels — vermutlich eine leere Fläche`);
    }
    if (bytes <= ANTWORT_BUDGET_BYTES) {
      return eintragAus(plan, base64, bytes);
    }
  }
  fehler(`Streifen passt nicht in das Antwortbudget: ${letzteMenge.bytes} Byte bei der kleinsten `
    + `Skala ${SKALA_STUFEN[SKALA_STUFEN.length - 1]}, Grenze ${ANTWORT_BUDGET_BYTES} Byte `
    + `(${Math.round(ANTWORT_BUDGET_BYTES / 1024)} KB) — weniger Frames oder weniger Ansichten verlangen`);
}

function zaeheAnnotationen(plan) {
  const summe = Object.fromEntries(PFLICHT_ANNOTATIONEN.map((g) => [g, 0]));
  for (const pan of plan.panels) {
    for (const g of PFLICHT_ANNOTATIONEN) summe[g] += pan.annotationen[g].length;
  }
  return summe;
}

function eintragAus(plan, base64, bytes) {
  return {
    view: plan.views.join('+'),
    views: plan.views.slice(),
    frames: plan.frames.map((f) => f.index),
    ref: `strip_${plan.views.join('+')}_${plan.frames.map((f) => f.index).join('-')}.png`,
    data: base64,
    mimeType: 'image/png',
    width: plan.breite,
    height: plan.hoehe,
    bytes,
    panels: plan.panels.length,
    meshGezeichnet: plan.meshGezeichnet,
    massstab: plan.massstab,
    bezug: plan.bezug,
    framesZusammenfassung: plan.frames,
    annotationen: zaeheAnnotationen(plan),
    warnungen: plan.warnungen,
    quelle: 'AP9 — Maßstab und Körpermaße aus dem gemessenen RigProfile',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anschluss an AP7 (src/tools/ports.js: renderer.streifen({ frames, views }))
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baut den Renderer-Port für die Werkzeugschicht.
 *
 * @param {object} opts
 * @param {THREE.Object3D} [opts.scene]       Szene mit Modell => Mesh-Ansichten
 * @param {object}         opts.profile       RigProfile
 * @param {Function}       [opts.frameQuelle] (index) -> Frame; sonst opts.frames[index]
 * @param {object[]}       [opts.frames]      aufgelöste Frames, indexierbar über Frame-Zahl
 * @param {number}         [opts.frameCount]  Timeline-Länge für die Bereichsprüfung
 */
export function createStripRenderer(opts = {}) {
  const { scene, profile } = opts;
  if (!profile || typeof profile !== 'object') {
    fehler(`createStripRenderer braucht ein RigProfile: übergeben ist `
      + `${JSON.stringify(profile ?? null)}`);
  }
  if (typeof opts.frameQuelle !== 'function' && !Array.isArray(opts.frames)) {
    fehler('createStripRenderer braucht frameQuelle(index) oder ein frames-Array: 0 Quellen übergeben');
  }
  const hole = typeof opts.frameQuelle === 'function' ? opts.frameQuelle : (i) => opts.frames[i];

  return {
    quelle: 'AP9',
    views: ANSICHTEN.slice(),
    /**
     * @param {{frames: number[], views?: string[]}} anfrage Frame-Zahlen der Timeline
     * @returns {object[]} genau EIN Bild mit allen angeforderten Ansichten
     */
    streifen(anfrage = {}) {
      const indices = anfrage.frames;
      if (!Array.isArray(indices) || indices.length === 0) {
        fehler(`frames = ${Array.isArray(indices) ? 'leeres Array' : JSON.stringify(indices ?? null)}: `
          + `erwartet 1 bis ${FRAMES_MAX} Frame-Zahlen der Timeline`);
      }
      if (indices.length > FRAMES_MAX) {
        fehler(`${indices.length} Frames angefordert: höchstens ${FRAMES_MAX} pro Antwort `
          + `(${Math.round(ANTWORT_BUDGET_BYTES / 1024)} KB Budget)`);
      }
      const views = anfrage.views === undefined ? ['front', 'side'] : anfrage.views;
      pruefeViews(views);

      const aufgelost = indices.map((i) => {
        if (!Number.isInteger(i) || i < 0) {
          fehler(`frames-Eintrag ${JSON.stringify(i)}: erwartet ganzzahlige Frame-Zahl >= 0`);
        }
        const f = hole(i);
        if (!f || typeof f !== 'object') {
          fehler(`frameQuelle(${i}) liefert ${JSON.stringify(f ?? null)}: Frame ${i} ist nicht `
            + `aufgelöst — 1 von ${indices.length} angeforderten Frames fehlt`);
        }
        return { ...f, frame: i };
      });

      const eintrag = bildeStreifen({
        scene, profile, frames: aufgelost, views,
        frameCount: opts.frameCount, canvas: opts.canvas, renderer: opts.renderer,
      });
      // Die Zeitkürzung in planeStreifen kann Frames wegnehmen (PANELS_ZEIT_MAX).
      // Der Bericht trägt weiterhin die ANGEFORDERTEN Frame-Zahlen (view, frames,
      // ref in haengeStreifenAn kommen von hier außen, nicht aus dem Bild) —
      // die Kürzung selbst steht als Warnung im Eintrag, nichts verschwindet
      // still (plan.md 5.5).
      return [eintrag];
    },
  };
}

/**
 * Hängt Streifen an einen Validierungsbericht — plan.md 5.3: Zahlen ohne Bild werden
 * nicht ausgeliefert. Ein Bericht ohne Bildverweis gilt als unvollständig.
 */
export function haengeStreifenAn(bericht, eintraege) {
  if (bericht === null || typeof bericht !== 'object' || Array.isArray(bericht)) {
    fehler(`ValidationReport fehlt: übergeben ist ${JSON.stringify(bericht)} — der Streifen hängt `
      + `sich an den Bericht, nicht an eine Nachfrage`);
  }
  const listen = Array.isArray(eintraege) ? eintraege : [];
  if (listen.length === 0) {
    fehler('0 Bildstreifen übergeben: jeder Validierungsbericht trägt seinen Streifen, ohne dass '
      + 'jemand danach fragt (plan.md 5.3)');
  }
  const ohneBild = listen.filter((e) => !e || typeof e.data !== 'string' || e.data.length === 0).length;
  if (ohneBild > 0) {
    fehler(`${ohneBild} von ${listen.length} Streifen haben kein Bild in der Antwort: ein Bericht `
      + 'ohne Streifen gilt als unvollständig');
  }
  bericht.images = listen.map((e) => ({
    view: String(e.view),
    frames: (e.frames || []).slice(),
    ref: String(e.ref),
  }));
  return bericht;
}
