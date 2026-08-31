// A3 — Agentenlast: Werkzeugauswahl aus Name und Beschreibung, ohne Code.
//
// Ersetzt den eigentlichen Katalog (handlers.js, Ausfuehrung) durch einen
// Strohmann-Aufruf: fuehreWerkzeug(name, argsJson) wirft fuer jedes Werkzeug
// ausser selectWerkzeug. Wenn die Auswaehlfunktion trotzdem selectWerkzeug
// ruft oder einen falschen Namen, faengt das der Test.
let erlaubt = null;
let aufrufe = [];

/** Strohmann fuer handlers.js. Nur das freigegebene Werkzeug laesst durch. */
export function fuehreWerkzeug(name, argsJson) {
  aufrufe.push({ name, argsJson });
  if (name !== erlaubt) {
    throw new Error(`fuehreWerkzeug: Werkzeug '${name}' ist hier nicht freigegeben (freigegeben: '${erlaubt}')`);
  }
  return JSON.stringify({ ok: true, tool: name });
}

/** Setzt das freigegebene Werkzeug fuer den naechsten Versuch und leert die Aufrufliste. */
export function erlaubeNur(name) {
  erlaubt = name;
  aufrufe = [];
}

/** Liest die aufgelaufenen Aufrufliste fuer die Assertions im Test. */
export function aufrufListe() {
  return aufrufe;
}