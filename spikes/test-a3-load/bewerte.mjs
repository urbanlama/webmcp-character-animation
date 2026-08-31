// A3 — Agentenlast: Bewertung und Negativmuster.
//
// Die positive Bewertung prueft das Abnahmekriterium: bei fuenf
// Standardaufgaben trifft die Auswahl das richtige Werkzeug. Die zweite
// Funktion ist absichtlich kaputt (AGENTS.md, Regel 2): ein Bewertungs-
// muster, das die richtigen Werkzeuge mit den falschen verwechselt, damit
// der Test zeigen kann, dass er ueberhaupt warnen kann.

import { waehleWerkzeug } from './waehle.mjs';
import { AUFGABEN } from './aufgaben.mjs';

/**
 * Bewertung der Aufgaben. Liefert je Aufgabe die vom Scoring ermittelte Wahl
 * und das richtige Werkzeug.
 * @param {Array} aufgaben Liste der Aufgaben (Standard: AUFGABEN)
 */
export function bewerte(aufgaben = AUFGABEN) {
  return aufgaben.map(a => {
    const rangliste = waehleWerkzeug(a.frage);
    return {
      id: a.id,
      typ: a.typ,
      frage: a.frage,
      oben: rangliste[0].name,
      zweiter: rangliste[1].name,
      abstand: rangliste[0].score - rangliste[1].score,
      richtig: a.richtig,
      griffig: a.griffig || null,
      treffer: rangliste[0].name === a.richtig
    };
  });
}

/**
 * KAPUTTE Bewertungsvariante, nur fuer den Negativtest: vertauscht bewusst
 * die Wahl mit dem zweitplatzierten Werkzeug. Muss in der Summe daneben
 * liegen und damit rot werden.
 */
export function WAHLEN_NEGATIV(aufgaben = AUFGABEN) {
  return bewerte(aufgaben).map(r => ({ ...r, oben: r.zweiter, treffer: r.zweiter === r.richtig }));
}