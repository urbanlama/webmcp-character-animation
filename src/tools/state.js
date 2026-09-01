// Sitzungszustand der Werkzeugschicht und der Undo-Stapel, docs/plan.md 5.2.
//
// Quelle der Wahrheit sind `phases` und `overrides` (dazu `fps`, `frameCount`
// und `intent`, die der Agent ebenfalls setzt). `solved` ist abgeleitet und
// wird nicht in den Schnappschuss aufgenommen — es darf jederzeit verworfen
// werden und wuerde den Vergleich "bitgleich" sonst an einem Wert scheitern
// lassen, der gar nicht zur Quelle gehoert.
//
// Jede Aenderung laeuft durch aendere(). Das gibt zwei Zusicherungen:
//   - atomar: wirft der Rumpf, bleibt der Zustand unangetastet und der Stapel
//     waechst nicht (das ist der Abbruchfall aus dem Test "Rueckfrage")
//   - rueckdrehbar: gelingt der Rumpf, liegt der vorige Zustand auf dem Stapel

import { offenerRest } from './rollen-priorisierung.js';

/** Verfahrensparameter: mehr Schritte haelt der Stapel nicht vor. 50 deckt eine
 *  volle Agentensitzung ab (16 Werkzeuge, typisch < 30 Aufrufe je Auftrag) und
 *  begrenzt den Speicher auf ein Vielfaches der Timeline-Groesse. */
export const UNDO_TIEFE = 50;

/** Standard-Framerate, bis der Agent etwas anderes setzt. Timeline-Vertrag 5.2. */
export const FPS_STANDARD = 30;

/** Tiefe Kopie ueber JSON — der Zustand ist reines JSON, kein Datum, keine Map. */
function kopie(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Kanonische Serialisierung: Schluessel sortiert, damit zwei Zustaende mit
 * gleicher Bedeutung auch gleich aussehen. Grundlage des Vergleichs
 * "bitgleich zum Ausgangszustand" im Undo-Test.
 */
export function fingerabdruck(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(fingerabdruck).join(',')}]`;
  const schluessel = Object.keys(v).sort();
  return `{${schluessel.map((k) => `${JSON.stringify(k)}:${fingerabdruck(v[k])}`).join(',')}}`;
}

/** Leerer Ausgangszustand: eine Timeline ohne Phasen, ohne Overrides. */
export function leererZustand() {
  return {
    schemaVersion: 1,
    fps: FPS_STANDARD,
    frameCount: 0,
    rotationFormat: 'quaternion',
    phases: [],
    overrides: {},
    intent: null,
    // Festgenagelte Fuesse: [{foot, von, bis}] — der Loeser haelt sie.
    anchors: [],
    // Vom Menschen bestaetigte Rollenzuordnungen (confirm_role). Gehoert nicht
    // zum Timeline-Vertrag und wird beim Export ausgeblendet, ist aber
    // rueckdrehbar wie alles andere, was der Agent aendert.
    roleConfirmations: {},
    // Unbeantwortet gebliebene Rollenfragen mit dem Budget, das zur Verfuegung
    // stand (Auftrag "Zu viele unsichere Rollen": kein stilles Verschlucken).
    // Gehoert wie roleConfirmations nicht zum Timeline-Vertrag. offeneRollen
    // traegt Namen, budget die Fragezahl, die sie offen ließ.
    offeneRollenFragen: { offeneRollen: [], budget: 0, meldung: '0 von 0 unsicheren Rollen blieben ungefragt (Budget: 0 Fragen): keine' }
  };
}

export function createStore(start = leererZustand()) {
  let zustand = kopie(start);
  const stapel = [];
  let laufendeId = 0;
  // Zaehlt JEDE angenommene Aenderung, auch das Zurueckdrehen. Die Anzeige
  // fragt ihn, statt eine Liste aendernder Werkzeugnamen zu pflegen: eine
  // solche Liste vergisst man, und das Vergessen faellt niemandem auf — der
  // Browser zeigt dann stumm einen aelteren Stand als der Loeser rechnet.
  let rev = 0;

  return {
    /** Lesekopie. Wer sie veraendert, veraendert den Zustand nicht. */
    lies() {
      return kopie(zustand);
    },

    /** Direkter Lesezugriff ohne Kopie, nur fuer Pruefungen im selben Aufruf. */
    roh() {
      return zustand;
    },

    fingerabdruck() {
      return fingerabdruck(zustand);
    },

    /**
     * Stand der Aenderungen, monoton steigend. Wer ihn beim letzten Blick
     * gemerkt hat, weiss beim naechsten, ob sich etwas geruehrt hat.
     * @returns {number} 0 vor der ersten Aenderung
     */
    revision() {
      return rev;
    },

    /** Anzahl rueckdrehbarer Schritte. */
    tiefe() {
      return stapel.length;
    },

    /**
     * Fuehrt eine Aenderung atomar aus.
     * @param {(entwurf: object) => *} rumpf bekommt eine Arbeitskopie
     * @returns {*} was der Rumpf zurueckgibt
     */
    aendere(rumpf) {
      const entwurf = kopie(zustand);
      const ergebnis = rumpf(entwurf);       // wirft -> unten wird nichts angefasst
      stapel.push(kopie(zustand));
      if (stapel.length > UNDO_TIEFE) stapel.shift();
      zustand = entwurf;
      rev += 1;
      return ergebnis;
    },

    /**
     * Nimmt die letzte Aenderung zurueck.
     * @returns {boolean} false, wenn nichts mehr auf dem Stapel liegt
     */
    undo() {
      if (stapel.length === 0) return false;
      zustand = stapel.pop();
      rev += 1;
      return true;
    },

    /** Neue eindeutige Phasen-Id, fortlaufend ab p1. */
    neueId() {
      laufendeId += 1;
      return `p${laufendeId}`;
    },

    /**
     * Zeichnet den ungefragten Rest der Rollenfragen auf — atomar und
     * rueckdrehbar wie jede Aenderung. Genau hier liegt die Sichtbarkeit aus
     * dem Auftrag "Zu viele unsichere Rollen": was nicht gefragt wurde, steht
     * mit Namen im Zustand, statt still verschluckt zu werden.
     *
     * @param {{fragen: object[], beantwortet: string[], budget: number}} auftrag
     *        fragen im Format von detect.js (je mit rolle), beantwortet die
     *        Rollennamen der festgelegten Zuordnungen, budget das verbrauchte
     *        bzw. verfuegbare Fragebudget (0 = gar nicht gefragt)
     * @returns {{offeneRollen: string[], meldung: string}}
     */
    vermerkeOffeneRollen({ fragen, beantwortet, budget }) {
      return this.aendere((z) => {
        const { offeneRollen, meldung } = offenerRest(fragen, beantwortet, budget);
        z.offeneRollenFragen = { offeneRollen, budget, meldung };
        return { offeneRollen, meldung };
      });
    }
  };
}
