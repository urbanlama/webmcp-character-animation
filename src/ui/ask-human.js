// Rueckfrage an den Menschen, docs/plan.md 6.7 und Werkzeug 15 aus 5.5.
//
// Der Agent ruft ask_human auf, der Aufruf bleibt offen, der Mensch klickt,
// die Antwort kommt im selben Aufruf zurueck. Dazwischen liegt dieser Broker:
// er kennt kein DOM und laesst sich deshalb in Node testen. Die browserseitige Oberflaeche haengt
// sich mit abonniere() daran und ruft beim Klick antworte(index) auf; der
// Einbau in die Seite gehoert AP0/AP8, nicht dieser Datei.
//
// Drei Dinge, die hier zusammenkommen:
//   - Budget: drei Fragen pro Auftrag, einstellbar bis null (6.7)
//   - genau eine offene Frage: zwei gleichzeitig kann der Mensch nicht klicken
//   - Abbruch: bricht der Mensch ab oder laedt neu, endet der wartende Aufruf
//     mit einem Fehler. Das Werkzeug darf dann nichts geaendert haben — dafuer
//     sorgt store.aendere(), das bei einer Ausnahme nichts uebernimmt.

import { WerkzeugFehler, WerkzeugMeldung } from '../tools/errors.js';

/** Verfahrensparameter: Fragen pro Auftrag. Begruendung in plan.md 6.7 — fuenf
 *  Sekunden Rueckfrage statt zwanzig Minuten Fehlbau, aber nicht mehr, sonst
 *  wird aus dem Agenten ein Fragebogen. */
export const BUDGET_STANDARD = 3;

export function createAskBroker({ budget = BUDGET_STANDARD } = {}) {
  let offen = null;          // { id, question, options, aufloesen, ablehnen }
  let verbraucht = 0;
  let laufendeId = 0;
  const zuhoerer = new Set();

  function melde() {
    const stand = offen
      ? { id: offen.id, question: offen.question, options: offen.options.slice() }
      : null;
    for (const z of zuhoerer) z(stand, { budget, verbraucht, uebrig: budget - verbraucht });
  }

  return {
    /** Die Oberflaeche abonniert; liefert die Abmeldefunktion. */
    abonniere(fn) {
      zuhoerer.add(fn);
      fn(offen ? { id: offen.id, question: offen.question, options: offen.options.slice() } : null,
        { budget, verbraucht, uebrig: budget - verbraucht });
      return () => zuhoerer.delete(fn);
    },

    /** Was die UI-Anzeige braucht: wie viele Fragen noch gehen. */
    stand() {
      return { budget, verbraucht, uebrig: budget - verbraucht, wartet: offen !== null };
    },

    /**
     * Stellt die Frage und wartet auf den Klick.
     * @returns {Promise<{answer: string, index: number}>}
     */
    frage({ question, options, pflicht = false }) {
      // Die zwei festen Momente aus plan.md 6.7 — Rollen bestaetigen nach dem
      // Upload, Absicht bestaetigen vor dem Bauen — sind Pflichtfragen. Sie
      // kosten kein Budget, sonst schaltet ein Budget von 0 den Ablauf ab,
      // den 6.7 als "kein Notausgang" bezeichnet.
      if (!pflicht && budget - verbraucht <= 0) {
        return Promise.reject(new WerkzeugMeldung({
          tool: 'ask_human',
          param: 'Fragebudget',
          value: verbraucht,
          range: `0 bis ${budget} Fragen je Auftrag`,
          next: budget === 0
            ? 'das Budget steht auf 0 Fragen; entscheide selbst oder lass den Menschen es in der Oberfläche erhöhen'
            : 'entscheide selbst oder lass den Menschen das Budget in der Oberfläche erhöhen',
          message: `Fragebudget erschöpft: ${verbraucht} von ${budget} Fragen gestellt; `
            + (budget === 0
              ? 'das Budget steht auf 0 Fragen — entscheide selbst oder lass es in der Oberfläche erhöhen'
              : 'entscheide selbst oder lass den Menschen es in der Oberfläche erhöhen')
        }));
      }
      if (offen !== null) {
        return Promise.reject(new WerkzeugMeldung({
          tool: 'ask_human',
          param: 'offene Fragen',
          value: 1,
          range: 'genau 0 offene Fragen vor einer neuen Frage',
          next: 'warte die Antwort auf die laufende Frage ab',
          message: `1 Frage wartet bereits auf eine Antwort ("${offen.question}"); `
            + 'es geht genau 1 Frage zur Zeit — warte die laufende Antwort ab'
        }));
      }

      laufendeId += 1;
      if (!pflicht) verbraucht += 1;
      const id = `f${laufendeId}`;

      return new Promise((aufloesen, ablehnen) => {
        offen = { id, question, options: options.slice(), pflicht, aufloesen, ablehnen };
        melde();
      });
    },

    /**
     * Der Mensch hat geklickt. Loest den wartenden Aufruf auf.
     * @param {number} index Position der geklickten Antwortmoeglichkeit
     */
    antworte(index) {
      if (offen === null) {
        throw new WerkzeugMeldung({
          tool: 'ask_human', param: 'offene Fragen', value: 0,
          range: 'genau 1 offene Frage',
          next: 'es wartet gerade kein Werkzeug auf eine Antwort',
          message: '0 Fragen offen: es wartet gerade kein Werkzeug auf eine Antwort'
        });
      }
      if (!Number.isInteger(index) || index < 0 || index >= offen.options.length) {
        throw new WerkzeugFehler({
          tool: 'ask_human', param: 'index', value: index,
          range: `ganze Zahl von 0 bis ${offen.options.length - 1}`,
          next: `die Frage hat ${offen.options.length} Antwortmöglichkeiten`
        });
      }
      const { aufloesen, options } = offen;
      offen = null;
      melde();
      aufloesen({ answer: options[index], index });
    },

    /**
     * Abbruch durch den Menschen oder durch ein Neuladen der Seite. Der
     * wartende Werkzeugaufruf endet mit einem Fehler; geaendert wurde nichts.
     */
    abbrechen(grund = 'der Mensch hat die Frage abgebrochen') {
      if (offen === null) return false;
      const { ablehnen, question, pflicht } = offen;
      offen = null;
      if (!pflicht) verbraucht -= 1;   // eine abgebrochene Frage kostet kein Budget
      melde();
      ablehnen(new WerkzeugMeldung({
        tool: 'ask_human', param: 'Antwort', value: 0,
        range: 'genau 1 Antwort',
        next: 'baue ohne diese Antwort weiter oder frage anders',
        message: `0 Antworten erhalten, ${grund} ("${question}"); `
          + 'nichts wurde geändert — baue ohne diese Antwort weiter oder frage anders'
      }));
      return true;
    },

    /** Budget zur Laufzeit setzen; 0 schaltet Rueckfragen ab (plan.md 6.7). */
    setzeBudget(n) {
      if (!Number.isInteger(n) || n < 0 || n > 20) {
        throw new WerkzeugFehler({
          tool: 'ask_human', param: 'budget', value: n,
          range: 'ganze Zahl von 0 bis 20',
          next: '0 schaltet Rückfragen ab'
        });
      }
      budget = n;
      melde();
    }
  };
}
