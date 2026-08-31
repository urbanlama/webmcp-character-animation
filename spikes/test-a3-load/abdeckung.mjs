// A3 — Agentenlast: Schwaeche-Finder ueber Wortabdeckung.
//
// Zweitinstrument neben auswahl.mjs: misst mechanisch, welche Woerter einer
// Nutzerfrage in Name+Beschreibung eines Werkzeugs wiederkehren (als Stamm,
// Umlaute normalisiert). Ein Werkzeug, das 0 der Kernwoerter seiner typischen
// Aufgaben teilt, hat eine erkennbar schwache Beschreibung — genau das steht
// dann in ERGEBNIS.md.
//
// Stamm: die letzten Endungen (e, en, er, es, t, n) werden abgetrennt; ab vier
// Buchstaben gilt der Stamm als Treffer. Das ist bewusst grob — es soll einen
// Hinweis liefern, nicht ein Urteil.

import { KATALOG } from '../../src/tools/catalog.js';

/** Umlaute und Eszett auf ASCII-Normalform bringen. */
export function normal(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** Woerter ab vier Buchstaben, ohne Nebensatzzeichen. */
export function woerter(text) {
  return normal(text).match(/[a-z0-9]{4,}/g) || [];
}

/** Stamm: Endungen abschneiden, mindestens vier Buchstaben lassen. */
export function stamm(wort) {
  const s = normal(wort).replace(/(en|er|es|e|t|n)$/, '');
  return s.length >= 4 ? s : normal(wort);
}

/**
 * Misst je Frage, wie viele ihrer Kernwoerter in name+description des
 * genannten Werkzeugs wiederkehren.
 * @param {string} frage Alltagssprache
 * @param {string} werkzeugName zu pruefendes Werkzeug
 * @returns {{total:number, treffer:string[], fehlen:string[]}}
 */
export function abdeckung(frage, werkzeugName) {
  const eintrag = KATALOG.find(e => e.name === werkzeugName);
  if (!eintrag) {
    throw new Error(`Werkzeug '${werkzeugName}' fehlt im Katalog mit ${KATALOG.length} Einträgen`);
  }
  const text = normal(`${eintrag.name} ${eintrag.description}`);
  const alle = woerter(frage);
  const treffer = alle.filter(w => text.includes(stamm(w)));
  return {
    total: alle.length,
    treffer,
    fehlen: alle.filter(w => !treffer.includes(w))
  };
}