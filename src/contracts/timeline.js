// Pruefer fuer den Timeline-Vertrag, docs/journal/plan.md 5.2.
//
// Quelle der Wahrheit sind `phases` und `overrides`. `solved` ist abgeleitet und
// darf jederzeit verworfen werden — fehlt es, ist das kein Fehler.
//
// Verfahrensparameter (AGENTS.md, Regel 1): fps <= 120. Begrenzung auf gaengige
// Animationsframeraten; kein reales Clip liegt darueber, und ein hoeherer Wert
// waere fast immer einversehentlich in Sekunden angegebenes Clip.

import { istZahl, istInt, fehler, ergebnis } from './validate.js';

/** Hoechste unterstuetzte Animationsframerate; Verfahrensparameter, siehe Dateikopf. */
const FPS_MAX = 120;

/**
 * validateTimeline(obj) -> { ok, errors: [{field, message}] }
 */
export function validateTimeline(obj) {
  const errors = [];

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fehler(errors, '$', obj, 'Objekt Timeline');
    return ergebnis(errors);
  }

  if (obj.schemaVersion !== 1) {
    fehler(errors, 'schemaVersion', obj.schemaVersion, 'genau 1');
  }

  if (!istInt(obj.fps) || obj.fps <= 0 || obj.fps > FPS_MAX) {
    fehler(errors, 'fps', obj.fps,
      `ganzzahlig > 0 und <= ${FPS_MAX} (Verfahrensparameter, siehe Dateikopf)`);
  }

  if (!istInt(obj.frameCount) || obj.frameCount <= 0) {
    fehler(errors, 'frameCount', obj.frameCount, 'ganzzahlig > 0');
  }

  if (obj.rotationFormat !== 'quaternion') {
    fehler(errors, 'rotationFormat', obj.rotationFormat,
      "genau 'quaternion' — Rotationen sind intern immer Quaternion (plan.md 5.2)");
  }

  const frameCount = obj.frameCount;

  // phases
  if (!Array.isArray(obj.phases)) {
    fehler(errors, 'phases', obj.phases, 'Array von {id, verb, from, to, params}');
  } else {
    const ids = new Set();
    obj.phases.forEach((p, i) => {
      const field = `phases.${i}`;
      if (p === null || typeof p !== 'object' || Array.isArray(p)) {
        fehler(errors, field, p, 'Objekt {id, verb, from, to, params}');
        return;
      }
      if (typeof p.id !== 'string' || p.id === '') {
        fehler(errors, `${field}.id`, p.id, 'nicht-leerer String');
      } else if (ids.has(p.id)) {
        fehler(errors, `${field}.id`, p.id, 'eindeutige id; nochmal wie eine fruehere Phase');
      } else {
        ids.add(p.id);
      }
      if (typeof p.verb !== 'string' || p.verb === '') {
        fehler(errors, `${field}.verb`, p.verb, 'nicht-leerer String (Verb aus dem Inventar, plan.md 6.3)');
      }
      if (!istInt(p.from)) {
        fehler(errors, `${field}.from`, p.from, 'ganzzahliger Frame >= 0');
      } else if (frameCount > 0 && p.from < 0) {
        fehler(errors, `${field}.from`, p.from,
          `Frame im Timeline-Bereich 0 bis ${frameCount === 1 ? '0' : frameCount - 1}`);
      }
      if (!istInt(p.to)) {
        fehler(errors, `${field}.to`, p.to, 'ganzzahliger Frame');
      } else if (!istInt(p.from) || p.from >= p.to) {
        fehler(errors, `${field}.to`, p.to, `Zahl > phases.${i}.from (from = ${p.from})`);
      } else if (istInt(frameCount) && frameCount > 0 && p.to > frameCount) {
        fehler(errors, `${field}.to`, p.to,
          `Frame <= frameCount = ${frameCount} (letzte gültige Grenze ${frameCount})`);
      }
      if (p.params === undefined || p.params === null
          || typeof p.params !== 'object' || Array.isArray(p.params)) {
        fehler(errors, `${field}.params`, p.params, 'Objekt (auch wenn leer)');
      }
    });
  }

  // overrides — Schluessel sind Frame-Zahlen, Werte Objekte
  const ov = obj.overrides;
  if (ov === null || typeof ov !== 'object' || Array.isArray(ov)) {
    fehler(errors, 'overrides', ov, 'Objekt mit Frame-Zahlen als Schluesseln und Objekten als Werten');
  } else {
    for (const [key, v] of Object.entries(ov)) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 0) {
        fehler(errors, `overrides["${key}"]`, key, 'Frame-Zahl, ganzzahlig >= 0');
      } else if (istInt(frameCount) && frameCount > 0 && n >= frameCount) {
        fehler(errors, `overrides["${key}"]`, key,
          `Frame im Timeline-Bereich 0 bis ${frameCount - 1}`);
      } else if (!/^\d+$/.test(key)) {
        fehler(errors, `overrides["${key}"]`, key, 'Schluessel ist ein Frame: reine Zahl ohne Vorzeichen oder Vorkomma');
      }
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        fehler(errors, `overrides["${key}"]`, v, 'Objekt');
      }
    }
  }

  // solved — optional, abgeleitet. Nur wenn vorhanden, wird es geprueft.
  if (obj.solved !== undefined && obj.solved !== null) {
    const s = obj.solved;
    if (typeof s !== 'object' || Array.isArray(s)) {
      fehler(errors, 'solved', s, 'Objekt {frames}');
    } else if (!Array.isArray(s.frames)) {
      fehler(errors, 'solved.frames', s.frames, 'Array mit frameCount Eintraegen');
    } else if (istInt(frameCount) && frameCount > 0 && s.frames.length !== frameCount) {
      fehler(errors, 'solved.frames.length', s.frames.length,
        `genau frameCount = ${frameCount} Eintraege`);
    }
  }

  return ergebnis(errors);
}