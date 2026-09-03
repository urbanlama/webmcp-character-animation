// Pruefer fuer den ValidationReport-Vertrag, docs/journal/plan.md 5.3.
//
// Kreuzbedingung: issues nicht leer MUSS passed === false bedeuten. Ein Bericht,
// der Beanstandungen listet und trotzdem "passed: true" meldet, ist unbrauchbar
// und wird abgelehnt.
// Pflichtfeld: images mit mindestens einem Eintrag — "Jeder Bericht enthaelt
// immer einen Bildverweis. Zahlen ohne Bild werden nicht ausgeliefert." (plan.md 5.3)
//
// Befunde nach Ort: Punktbefunde tragen frame UND part (boden, durchdringung,
// balance, rutschen, ballistik, ruck). Schichtweite Befunde haben keinen
// einzelnen Frame und keine einzelne Partie — sie duerfen beides weglassen,
// muessen aber einen Bereich nennen (frames-Liste oder von/bis). Erfundene
// Zahlen sind schlimmer als fehlende, ortlose Befunde unbrauchbar.

import { istZahl, istInt, fehler, ergebnis } from './validate.js';

const ZUSTAENDE = ['kontakt', 'flug'];

/**
 * Befunde nach Ort. Zwei Klassen, zwei Regeln:
 *
 *   Punktbefunde  — geschehen in GENAU EINEM Frame an GENAU EINEM Koerperteil.
 *                   `frame` und `part` sind zwingend.
 *   Schichtbefunde  — geschehen UEBER einen Bereich und haben keinen einzelnen
 *                   Frame (Bewegungsdichte, Antizipation). `frame` und `part`
 *                   duerfen fehlen — MUESSEN aber eine Ortsangabe mitbringen:
 *                   eine nicht-leere `frames`-Liste oder `von`/`bis`.
 *
 * Kein Befund ohne jeden Ort. Die Lockerung erlaubt das Weglassen einer Zahl,
 * die es nicht gibt — nie das Weglassen jeder Ortsangabe.
 */
export const SCHICHTBEFUNDE = ['bewegungsdichte', 'antizipation'];

/** Die Punktbefunde, Names wegen in der Fehlermeldung. Alles, was nicht unter
 *  SCHICHTBEFUNDE faellt, wird als Punktbefund geprueft — `ruck` gehoert dazu:
 *  sein Frame stand frueher nur im Meldungstext und steht jetzt im Feld. */
export const PUNKTBEFUNDE = ['boden', 'durchdringung', 'balance', 'rutschen', 'ballistik', 'ruck'];

/** Ortsangabe eines schichtweiten Befundes: frames-Liste oder von/bis. */
function pruefeOrt(errors, f, it) {
  const art = typeof it.kind === 'string' && it.kind !== '' ? it.kind : 'schichtweiter Befund';
  const frameZahl = Array.isArray(it.frames) ? it.frames.length : 0;
  const hatBereich = it.von !== undefined || it.bis !== undefined;

  if (it.frame !== undefined && (!istInt(it.frame) || it.frame < 0)) {
    fehler(errors, `${f}.frame`, it.frame,
      `ganzzahliger Frame >= 0, wenn vorhanden — '${art}' ist schichtweit, sein Bereich steht in frames oder von/bis`);
  }
  if (it.part !== undefined && (typeof it.part !== 'string' || it.part === '')) {
    fehler(errors, `${f}.part`, it.part,
      `nicht-leerer String oder weggelassen — bei '${art}' gibt es kein einzelnes Koerperteil`);
  }
  if (Array.isArray(it.frames) && frameZahl > 0) {
    const schlecht = it.frames.filter((x) => !istInt(x) || x < 0).length;
    if (schlecht > 0) {
      fehler(errors, `${f}.frames`, it.frames,
        `Array von ganzen Frame-Zahlen >= 0 — ${schlecht} von ${frameZahl} Eintraegen ungueltig`);
    }
  }
  if (hatBereich) {
    if (!istInt(it.von) || it.von < 0) {
      fehler(errors, `${f}.von`, it.von, 'ganzzahliger Frame >= 0 (Bereichsanfang des Befundes)');
    }
    if (!istInt(it.bis) || it.bis < 0) {
      fehler(errors, `${f}.bis`, it.bis,
        `ganzzahliger Frame >= 0 (Bereichsende), von = ${JSON.stringify(it.von)}`);
    } else if (istInt(it.von) && it.bis < it.von) {
      fehler(errors, `${f}.bis`, it.bis, `Frame >= von = ${it.von}`);
    }
  }
  if (frameZahl === 0 && !hatBereich) {
    fehler(errors, `${f}.frames`, it.frames,
      `nicht-leere frames-Liste oder von/bis — '${art}' ist schichtweit und darf frame und part `
      + `weglassen, aber nicht jeden Ort: 0 Frames, 0 Bereich`);
  }
}

function pruefeIssues(errors, field, block) {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    fehler(errors, field, block, 'Objekt {passed, issues}');
    return;
  }
  if (typeof block.passed !== 'boolean') {
    fehler(errors, `${field}.passed`, block.passed, 'true oder false');
  }
  if (!Array.isArray(block.issues)) {
    fehler(errors, `${field}.issues`, block.issues, 'Array (auch wenn leer)');
    return;
  }
  block.issues.forEach((it, i) => {
    const f = `${field}.issues.${i}`;
    if (it === null || typeof it !== 'object' || Array.isArray(it)) {
      fehler(errors, f, it, 'Objekt {kind, frame, value, unit, part, message} — schichtweite '
        + `Befunde (${SCHICHTBEFUNDE.join(', ')}) statt frame: frames oder von/bis`);
      return;
    }
    if (typeof it.kind !== 'string' || it.kind === '') {
      fehler(errors, `${f}.kind`, it.kind, 'nicht-leerer String');
    }
    const schichtweit = SCHICHTBEFUNDE.includes(it.kind);
    if (schichtweit) {
      pruefeOrt(errors, f, it);
    } else {
      if (!istInt(it.frame) || it.frame < 0) {
        fehler(errors, `${f}.frame`, it.frame,
          `ganzzahliger Frame >= 0 — Punktbefund '${it.kind}' geschehen in einem Frame `
          + `(schichtweit nur: ${SCHICHTBEFUNDE.join(', ')})`);
      }
      if (typeof it.part !== 'string' || it.part === '') {
        fehler(errors, `${f}.part`, it.part,
          `nicht-leerer String (betroffenes Koerperteil) — Punktbefund '${it.kind}'`);
      }
    }
    if (!istZahl(it.value)) {
      fehler(errors, `${f}.value`, it.value, 'Zahl (gemessener Betrag)');
    }
    if (typeof it.unit !== 'string' || it.unit === '') {
      fehler(errors, `${f}.unit`, it.unit, 'nicht-leerer String (z. B. "m", "grad")');
    }
    if (typeof it.message !== 'string' || it.message === '') {
      fehler(errors, `${f}.message`, it.message, 'nicht-leerer String');
    }
    if (it.fix !== undefined && typeof it.fix !== 'string') {
      fehler(errors, `${f}.fix`, it.fix, 'String oder weggelassen');
    }
  });
  if (block.issues.length > 0 && block.passed !== false) {
    fehler(errors, `${field}.passed`, block.passed,
      `genau false — ${field}.issues enthaelt ${block.issues.length} Eintraege`);
  }
}

/**
 * validateValidationReport(obj) -> { ok, errors: [{field, message}] }
 */
export function validateValidationReport(obj) {
  const errors = [];

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fehler(errors, '$', obj, 'Objekt ValidationReport');
    return ergebnis(errors);
  }

  if (!istInt(obj.frameCount) || obj.frameCount <= 0) {
    fehler(errors, 'frameCount', obj.frameCount, 'ganzzahlig > 0');
  }
  const frameCount = obj.frameCount;

  // phases
  if (!Array.isArray(obj.phases)) {
    fehler(errors, 'phases', obj.phases, "Array von {state: 'kontakt'|'flug', from, to}");
  } else {
    obj.phases.forEach((p, i) => {
      const field = `phases.${i}`;
      if (p === null || typeof p !== 'object' || Array.isArray(p)) {
        fehler(errors, field, p, "Objekt {state, from, to}");
        return;
      }
      if (!ZUSTAENDE.includes(p.state)) {
        fehler(errors, `${field}.state`, p.state, `einer von ${JSON.stringify(ZUSTAENDE)}`);
      }
      if (!istInt(p.from)) {
        fehler(errors, `${field}.from`, p.from, 'ganzzahliger Frame >= 0');
      } else if (p.from < 0) {
        fehler(errors, `${field}.from`, p.from, 'Frame >= 0');
      }
      if (!istInt(p.to)) {
        fehler(errors, `${field}.to`, p.to, 'ganzzahliger Frame');
      } else if (!istInt(p.from) || p.from >= p.to) {
        fehler(errors, `${field}.to`, p.to, `Zahl > phases.${i}.from (from = ${p.from})`);
      } else if (istInt(frameCount) && frameCount > 0 && p.to > frameCount) {
        fehler(errors, `${field}.to`, p.to, `Frame <= frameCount = ${frameCount}`);
      }
    });
  }

  // physics — issues-Form ist verpflichtend
  const ph = obj.physics;
  if (ph === null || typeof ph !== 'object' || Array.isArray(ph) || !Array.isArray(ph.issues)) {
    fehler(errors, 'physics', ph, 'Objekt {passed, issues}');
  } else {
    pruefeIssues(errors, 'physics', ph);
  }

  // intent
  const intent = obj.intent;
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
    fehler(errors, 'intent', intent, 'Objekt {passed, checks}');
  } else {
    if (typeof intent.passed !== 'boolean') {
      fehler(errors, 'intent.passed', intent.passed, 'true oder false');
    }
    if (!Array.isArray(intent.checks)) {
      fehler(errors, 'intent.checks', intent.checks, 'Array (auch wenn leer)');
    } else {
      intent.checks.forEach((c, i) => {
        const f = `intent.checks.${i}`;
        if (c === null || typeof c !== 'object' || Array.isArray(c)) {
          fehler(errors, f, c, 'Objekt {name, required, measured, unit, passed}');
          return;
        }
        if (typeof c.name !== 'string' || c.name === '') {
          fehler(errors, `${f}.name`, c.name, 'nicht-leerer String');
        }
        if (c.required === undefined) {
          fehler(errors, `${f}.required`, c.required, 'vorhanden (Sollwert oder -bereich)');
        }
        if (!istZahl(c.measured)) {
          fehler(errors, `${f}.measured`, c.measured, 'Zahl (gemessener Wert)');
        }
        if (typeof c.unit !== 'string' || c.unit === '') {
          fehler(errors, `${f}.unit`, c.unit, 'nicht-leerer String (z. B. "grad")');
        }
        if (typeof c.passed !== 'boolean') {
          fehler(errors, `${f}.passed`, c.passed, 'true oder false');
        }
      });
    }
  }

  // style — gleiche Kreuzbedingung wie physics
  if (obj.style === undefined) {
    fehler(errors, 'style', obj.style, 'Objekt {passed, issues}');
  } else {
    pruefeIssues(errors, 'style', obj.style);
  }

  // images — Pflichtfeld, mindestens ein Eintrag
  const imgs = obj.images;
  if (imgs === undefined || imgs === null) {
    fehler(errors, 'images', imgs,
      'Array mit mindestens 1 Eintrag — jeder Bericht enthaelt immer einen Bildverweis');
  } else if (!Array.isArray(imgs) || imgs.length < 1) {
    fehler(errors, 'images', imgs, 'Array mit mindestens 1 Eintrag — Zahlen ohne Bild werden nicht ausgeliefert');
  } else {
    imgs.forEach((im, i) => {
      const f = `images.${i}`;
      if (im === null || typeof im !== 'object' || Array.isArray(im)) {
        fehler(errors, f, im, 'Objekt {view, frames, ref}');
        return;
      }
      if (typeof im.view !== 'string' || im.view === '') {
        fehler(errors, `${f}.view`, im.view, 'nicht-leerer String (Ansichtsname)');
      }
      if (!Array.isArray(im.frames) || !im.frames.every((x) => istInt(x) && x >= 0)) {
        fehler(errors, `${f}.frames`, im.frames, 'Array von ganzen Frame-Zahlen >= 0');
      }
      if (typeof im.ref !== 'string' || im.ref === '') {
        fehler(errors, `${f}.ref`, im.ref, 'nicht-leerer String (Bildverweis)');
      }
    });
  }

  return ergebnis(errors);
}