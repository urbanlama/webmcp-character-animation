// AP8 — Berichts-Zusammenbau (docs/plan.md 5.3, 6.8).
//
// Drei Prüfschichten, getrennt gebaut, kommen beim Agenten nie einzeln an,
// sondern als EIN Bericht — und an dem hängt immer ein Bild:
//   src/validate/physics.js  — Physik   pruefePhysik(profile, frames, fps)
//   src/validate/intent.js   — Absicht  pruefeAbsicht(profile, timeline, intent)
//   src/validate/style.js    — Stil     pruefeStil(profile, frames, fps, options)
//
// Diese Datei ruft alle drei auf und setzt den ValidationReport im Format aus
// plan.md 5.3 zusammen: { frameCount, phases, physics, intent, style, images }.
// Der Bericht wird vor der Rückgabe mit validateValidationReport aus
// src/contracts/validation-report.js geprüft — besteht er das eigene Schema
// nicht, ist das ein Fehler und er geht nicht raus.
//
// ── NAHTSTELLE ZUM BILDSTREIFEN (AP9, src/render/strip.js) ──────────────────
// src/render/strip.js entsteht parallel. Diese Datei kennt davon genau EINE
// Funktion, nichts weiter:
//
//   strip(auswahl) -> Bildeinträge
//
//   Argument: auswahl — Array AUFSTEIGEND sortierter Frame-Einträge, je
//     { frame: <Frame-Zahl der Timeline>, ...gelöster Frame aus timeline.solved
//       (bones / positions / com / contact) }
//   Erwartete Rückgabe: nicht-leeres Array von Bildeinträgen
//     [{ view: <Ansichtsname, string>, frames: <Frame-Zahlen, number[]>,
//        ref: <Bildverweis, string>, ... }, ...]
//   — exakt die Gestalt, die ein Eintrag von bildeStreifen() /
//     createStripRenderer().streifen() hat. Der Bericht übernimmt daraus
//     { view, frames, ref } als Einträge von `images`.
//
// REGEL (plan.md 5.3): Ein Bericht ohne Bildverweis gilt als unvollständig und
// wird NICHT ausgeliefert. Liefert die Streifen-Funktion nichts, bricht der
// Zusammenbau mit einer Zahl in der Meldung ab.
//
// Frame-Auswahl (plan.md 6.8): nicht alle Frames ins Bild, sondern die
// kritischen — die beanstandeten Frames plus die Phasengrenzen. Findet keine
// Prüfung etwas, liegen gleichmäßig verteilte Frames über die Timeline: eine
// Animation, in der nichts passiert, besteht jede Prüfung, und der Agent soll
// trotzdem sehen, was passiert.
//
// Grundregeln (AGENTS.md): keine Körpermaße im Code — alles kommt aus dem
// RigProfile bzw. dem Timeline-Objekt. Die einzige getippte Zahl ist der
// BENANNTE PARAMETER MAX_BILDFRAMES unten, mit Begründung.

import { pruefePhysik } from './physics.js';
import { pruefeAbsicht } from './intent.js';
import { pruefeStil } from './style.js';
import { validateValidationReport } from '../contracts/validation-report.js';
import { istInt } from '../contracts/validate.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTER PARAMETER (Verfahrensparameter, kein Körpermaß)
// ─────────────────────────────────────────────────────────────────────────────

/** Wie viele Frames der Bericht ins Bild nimmt: genau einer.
 *
 *  Bis zum 2. September 2026 waren es sechs, in zwei Ansichten nebeneinander
 *  geklebt — zwölf Kacheln, jede Figur fingernagelgroß, und darauf war eine
 *  Fehlhaltung nachweislich nicht erkennbar (docs/buehne-befunde-2026-09-02.md,
 *  Punkt 1). Gezeigt wird jetzt EIN Moment, dafür groß und aus zwei Richtungen.
 *  Den Verlauf liefert `trace`, den zeitlichen Zusammenhang also nicht mehr der
 *  Bericht. */
export const MAX_BILDFRAMES = 1;

export const BERICHT_SKALA = 0.72;

/** Die zwei Blickrichtungen des Prüfberichts, um 90 Grad versetzt.
 *
 *  Warum zwei und nicht einer: aus einem einzelnen Blick ist ein 3D-Raum nicht
 *  eindeutig — ein Arm VOR dem Körper und ein Arm NEBEN dem Körper sehen von
 *  vorn gleich aus. Zwei versetzte Blicke lösen das auf.
 *
 *  Warum nicht mehr: jede weitere Ansicht kostet Bildgröße im selben
 *  Antwortbudget. Bis zum 2. September 2026 klebte der Bericht sechs Frames in
 *  zwei Ansichten zusammen — zwölf Kacheln, jede Figur fingernagelgroß, und
 *  darauf war eine Fehlhaltung nachweislich nicht erkennbar
 *  (docs/buehne-befunde-2026-09-02.md, Punkt 1).
 *
 *  30 Grad ist der Standardblick von `look` (RICHTUNG_STANDARD_GRAD), 120 der
 *  um 90 Grad gedrehte dazu. */
export const BERICHT_ANSICHTEN = [
  { richtung_grad: 30, hoehe_grad: 10, weite: 'ganz', skala: BERICHT_SKALA, sparsam: true },
  { richtung_grad: 120, hoehe_grad: 10, weite: 'ganz', skala: BERICHT_SKALA, sparsam: true },
];

/** Zwei Bilder in voller Groesse (640x800) sprengen das Antwortbudget: gemessen
 *  537 KB gegen 512 KB erlaubt, weil Base64 ein Drittel aufschlaegt. 0,72
 *  halbiert die Flaeche und laesst beide Blicke zusammen mit dem Bericht
 *  durch — 461x576 je Bild, immer noch das 2,3-fache der alten Rasterkachel
 *  (300x380), auf der nachweislich nichts zu erkennen war. */

// ─────────────────────────────────────────────────────────────────────────────
// Helfer
// ─────────────────────────────────────────────────────────────────────────────

function fehler(text) { throw new Error('Bericht abgelehnt: ' + text); }

/** Kontaktschwelle als Anteil der Körperhöhe, falls das RigProfile sie nicht
 *  mitbringt. Vorgezogen wird immer profile.params.soleTolerance — die
 *  gemessene Schwelle. Gleicher Fallback wie in src/validate/physics.js. */
const KONTAKT_SCHWELLE_ANTEIL = 0.035;

/** Phase eines Frames als 'kontakt' | 'flug' — Vorgabe aus dem Frame, sonst
 *  gemessen über die Sohlenhöhe, exakt wie in src/validate/physics.js
 *  (phaseOf): dieselbe Schwelle, dieselbe Richtung, kein eigenes Verfahren. */
function zustandVon(profile, frame) {
  if (frame.contact === 'kontakt' || frame.contact === 'flug') return frame.contact;
  const height = profile.world.height;
  const groundY = profile.world.groundY ?? 0;
  const schwelle = height * (profile.params?.soleTolerance ?? KONTAKT_SCHWELLE_ANTEIL);
  const amBoden = (profile.soles ?? []).some((s) => {
    const p = frame.positions?.[s.bone];
    return p && Array.isArray(p) && (p[1] - groundY) < schwelle;
  });
  return amBoden ? 'kontakt' : 'flug';
}

/** Phasenblöcke aus den Frame-Zuständen: { state, from, to }, `to` als
 *  letzter Frame des Blocks INKLUSIV +1 (plan.md 5.3: {from: 0, to: 18},
 *  {from: 19, to: 44} — zwei Blöcke 0..17 und 18..43 wären 45 Frames; die
 *  Beispielwerte zählen `to` daher als exklusiv). */
function bauePhasen(profile, frames) {
  const bloecke = [];
  for (let i = 0; i < frames.length; i++) {
    const state = zustandVon(profile, frames[i]);
    const letzter = bloecke[bloecke.length - 1];
    if (letzter && letzter.state === state) {
      letzter.to = i + 1;
    } else {
      bloecke.push({ state, from: i, to: i + 1 });
    }
  }
  return bloecke;
}

/** Beanstandete Frame-Zahlen aus physics und style. Style-Meldungen tragen
 *  je nach Art keinen `frame` (ruck, antizipation) oder ein `frames`-Feld
 *  (bewegungsdichte) — beides wird eingesammelt, wo eine Zahl drinsteht. */
function beanstandeteFrames(physics, style) {
  const treffer = [];
  for (const it of physics.issues ?? []) {
    if (istInt(it.frame)) treffer.push(it.frame);
  }
  for (const it of style.issues ?? []) {
    if (istInt(it.frame)) treffer.push(it.frame);
    if (Array.isArray(it.frames)) {
      for (const f of it.frames) if (istInt(f)) treffer.push(f);
    }
  }
  return treffer;
}

/** Frame-Auswahl für den Bildstreifen: beanstandete Frames plus
 *  Phasengrenzen; wenn beides leer ist, gleichmäßig verteilt. */
export function waehleBildframes(frameCount, beanstandet, phasen) {
  if (!istInt(frameCount) || frameCount <= 0) {
    fehler(`frameCount = ${JSON.stringify(frameCount)}: erwartet ganzzahlige Timelinellänge > 0, `
      + `ohne sie kann kein Frame in den Bildstreifen gewählt werden`);
  }
  // Der Frame mit den MEISTEN Beanstandungen. Der frueheste waere der falsche:
  // eine Bewegung beginnt oft mit einer harmlosen Randmeldung, waehrend der
  // eigentliche Bruch in der Mitte sitzt. Gezaehlt statt gewichtet, weil die
  // Meldungen verschiedene Einheiten tragen (cm, Grad, m/s²) und ein Vergleich
  // ueber sie hinweg eine erfundene Gewichtung braeuchte.
  const zaehlung = new Map();
  for (const f of beanstandet ?? []) {
    const n = Number(f);
    if (!istInt(n) || n < 0 || n >= frameCount) continue;
    zaehlung.set(n, (zaehlung.get(n) ?? 0) + 1);
  }
  if (zaehlung.size > 0) {
    // Gleichstand: der frueheste. Wo eine Bewegung zuerst bricht, steht die
    // Ursache; was danach kommt, ist oft Folge.
    const sortiert = [...zaehlung].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return [sortiert[0][0]];
  }

  // Keine Beanstandung: die Mitte. Fehlerfreiheit ist kein Erfolg — der Agent
  // sieht trotzdem, was er gebaut hat (plan.md 5.3).
  return [Math.floor(frameCount / 2)];
}

/** Bildeinträge in die Vertragsform bringen und die Bildpflicht erzwingen. */
function baueImages(eintraege) {
  if (!Array.isArray(eintraege) || eintraege.length === 0) {
    fehler(`${Array.isArray(eintraege) ? eintraege.length : typeof eintraege} Bildstreifen vom `
      + `Renderer bekommen: 0 — ein Bericht ohne Bildverweis gilt als unvollständig und wird `
      + `nicht ausgeliefert (plan.md 5.3)`);
  }
  return eintraege.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      fehler(`Bildstreifen ${i} = ${JSON.stringify(e)}: erwartet Objekt { view, frames, ref }`);
    }
    if (typeof e.view !== 'string' || e.view === '') {
      fehler(`Bildstreifen ${i}: view = ${JSON.stringify(e.view)}: erwartet nicht-leeren Ansichtsnamen`);
    }
    if (typeof e.ref !== 'string' || e.ref === '') {
      fehler(`Bildstreifen ${i} (${e.view}): ref = ${JSON.stringify(e.ref)}: erwartet nicht-leeren Bildverweis`);
    }
    if (!Array.isArray(e.frames) || e.frames.length === 0) {
      fehler(`Bildstreifen ${i} (${e.view}): frames = ${JSON.stringify(e.frames)}: erwartet `
        + `nicht-leeres Array der Frame-Zahlen im Bild`);
    }
    return { view: e.view, frames: e.frames.map(Number), ref: e.ref };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Öffentliche Funktion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * baueValidationReport({ profile, timeline, intent, stil, strip })
 *   -> { frameCount, phases, physics, intent, style, images }  (plan.md 5.3)
 *
 * profile:  RigProfile gemäß plan.md 5.1 — gemessen, nicht getippt
 * timeline: Timeline gemäß plan.md 5.2 mit gelöstem solved-Abschnitt
 * intent:   Kriterien-Array für pruefeAbsicht (siehe src/validate/intent.js)
 * stil:     optional — options für pruefeStil ({ hauptbewegung, ausnahmen })
 * strip:    Nahtstelle zum Bildstreifen, siehe Kopfdokumentation. Pflicht.
 *
 * Wirft, wenn Eingaben fehlen oder der fertige Bericht das eigene Schema aus
 * src/contracts/validation-report.js nicht besteht — dann geht nichts raus.
 */
export function baueValidationReport({ profile, timeline, intent, stil, strip } = {}) {
  if (typeof strip !== 'function') {
    fehler(`strip = ${typeof strip}: erwartet eine Funktion (auswahl) => Bildeinträge — `
      + `ohne Bildstreifen wird kein Bericht zusammengesetzt, Zahlen ohne Bild werden `
      + `nicht ausgeliefert (plan.md 5.3, 6.8)`);
  }
  if (!timeline || typeof timeline !== 'object') {
    fehler(`timeline = ${typeof timeline}: erwartet Timeline-Objekt gemäß plan.md 5.2`);
  }
  const frames = timeline.solved?.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    fehler(`timeline.solved.frames = ${Array.isArray(frames) ? frames.length : typeof frames}: `
      + `erwartet nicht-leeres Array gelöster Frames — ohne Posen keine Prüfungen und kein Bild`);
  }
  if (!istInt(timeline.frameCount) || timeline.frameCount <= 0) {
    fehler(`timeline.frameCount = ${JSON.stringify(timeline.frameCount)}: erwartet ganzzahlige `
      + `Timelinellänge > 0`);
  }
  if (timeline.frameCount !== frames.length) {
    fehler(`timeline.frameCount = ${timeline.frameCount}, aber solved.frames enthält `
      + `${frames.length} Frames — die Quellen der Wahrheit (phases und overrides) und die `
      + `Lösung passen nicht zusammen`);
  }
  const frameCount = timeline.frameCount;

  // ── 1. Die drei Prüfschichten aufrufen ─────────────────────────────────────
  const physics = pruefePhysik(profile, frames, timeline.fps);

  // Fehlt die Absicht, wird IHRE Schicht übersprungen — nicht der Bericht
  // verworfen.
  //
  // Vorher stand hier ein `fehler(...)`, und `validate` ohne vorher gesetzte
  // Absicht endete in einer Fehlerantwort. Der Haken: die Physikprüfung läuft
  // eine Zeile darüber vollständig durch, ihr Ergebnis liegt fertig vor — und
  // wurde mitsamt dem Bericht weggeworfen. Ein Agent, der nur wissen will, ob
  // seine Bewegung physikalisch trägt, bekam nichts und musste erst eine
  // Absicht formulieren, die er an dieser Stelle gar nicht prüfen wollte.
  //
  // Am 2. September 2026 gegen die laufende Seite nachgestellt:
  //
  //   Werkzeug "validate" ist abgestürzt, statt zu antworten:
  //   Bericht abgelehnt: intent = 0: erwartet nicht-leeres Array …
  //
  // Die Absicht ist eine ZUSÄTZLICHE Schicht (plan.md 3.2). Fehlt sie, fehlt
  // ihr Ergebnis, nicht der ganze Bericht; dass sie fehlt, steht als Satz im
  // Bericht statt als Absturz davor. `passed` bleibt dabei ehrlich: eine
  // Schicht, die nichts geprüft hat, kann nichts durchfallen lassen — und der
  // Satz nennt den Grund, damit niemand das grüne Feld als bestandene
  // Absichtsprüfung liest.
  const ohneAbsicht = !Array.isArray(intent) || intent.length === 0;
  const intentErgebnis = ohneAbsicht
    ? {
      passed: true,
      checks: [],
      uebersprungen: 'keine Absicht gesetzt (0 Kriterien): die Absichtsschicht hat nichts '
        + 'geprüft — Physik und Stil unten gelten trotzdem. Mit set_intent kommen die '
        + 'Absichtskriterien dazu (Drehung, Flugzeit, Strecke, Kontaktwechsel, Abstand, '
        + 'Höhe, Tempo).',
    }
    : pruefeAbsicht(profile, timeline, intent);

  const style = pruefeStil(profile, frames, timeline.fps, stil ?? {});

  // ── 2. Phasenblöcke aus den Frame-Zuständen ────────────────────────────────
  const phases = bauePhasen(profile, frames);

  // ── 3. Kritische Frames auswählen und den Bildstreifen holen ───────────────
  const beanstandet = beanstandeteFrames(physics, style);
  const bildframes = waehleBildframes(frameCount, beanstandet, phases);
  const auswahl = bildframes.map((f) => ({ frame: f, ...frames[f] }));
  const images = baueImages(strip(auswahl));

  // ── 4. Bericht zusammenbauen und gegen das eigene Schema prüfen ────────────
  const bericht = {
    frameCount,
    phases,
    physics,
    intent: intentErgebnis,
    style,
    images,
  };
  const pruefung = validateValidationReport(bericht);
  if (!pruefung.ok) {
    const erste = pruefung.errors
      .slice(0, 3)
      .map((e) => `${e.field}: ${e.message}`)
      .join(' | ');
    fehler(`Zusammengesetzter Bericht besteht das eigene Schema nicht: ${pruefung.errors.length} `
      + `Fehler, die ersten ${Math.min(3, pruefung.errors.length)} — ${erste}`);
  }
  return bericht;
}

export default baueValidationReport;