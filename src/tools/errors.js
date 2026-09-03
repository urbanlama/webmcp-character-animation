// Fehlermeldungen der Werkzeugschicht, docs/journal/plan.md 5.5 (Schlussabsatz).
//
// Eine Werkzeug-Fehlermeldung nennt immer drei Dinge:
//   1. den Wert, den der Agent geschickt hat
//   2. den erlaubten Bereich
//   3. den naechsten Schritt, mit dem er weiterkommt
//
// Beispiel: "frame 640 liegt außerhalb der Timeline von 0 bis 599; setze
// frameCount zuerst mit set_duration".
//
// Diese Datei ist die einzige Stelle, an der Fehlertexte entstehen. Wer hier
// vorbei formuliert, baut Meldungen ohne Zahl — der Negativfall des Tests
// "Fehlermeldungen" faengt genau das.

/** Zahl fuer die Anzeige: hoechstens drei Nachkommastellen, kein Exponent. */
export function zahl(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
}

/** Wert fuer die Anzeige, so wie der Agent ihn geschickt hat. */
export function wert(v) {
  if (typeof v === 'number') return zahl(v);
  if (typeof v === 'string') return `"${v}"`;
  if (v === undefined) return 'nicht angegeben';
  if (Array.isArray(v)) return `[${v.map(wert).join(', ')}]`;
  return JSON.stringify(v);
}

/**
 * Fehler eines Werkzeugaufrufs. Traegt die drei Bestandteile einzeln, damit
 * Tests sie pruefen koennen, und den fertigen Satz fuer den Agenten.
 */
export class WerkzeugFehler extends Error {
  /**
   * @param {object} f
   * @param {string} f.tool     Werkzeugname, in dem der Fehler auftrat
   * @param {string} f.param    betroffener Parameter (oder Zustandsname)
   * @param {*}      f.value    der gelieferte Wert
   * @param {string} f.range    erlaubter Bereich, enthaelt mindestens eine Zahl
   * @param {string} f.next     naechster Schritt, moeglichst mit Werkzeugnamen
   */
  constructor({ tool, param, value, range, next }) {
    const satz = `${param} ${wert(value)} liegt außerhalb des erlaubten Bereichs: ${range}; ${next}`;
    super(satz);
    this.name = 'WerkzeugFehler';
    this.tool = tool;
    this.param = param;
    this.value = value;
    this.range = range;
    this.next = next;
  }

  /** Werkzeugantwort im WebMCP-Format, als Fehler markiert. */
  toResult() {
    return {
      content: [{ type: 'text', text: this.message }],
      isError: true,
      details: {
        tool: this.tool,
        param: this.param,
        value: this.value,
        range: this.range,
        next: this.next
      }
    };
  }
}

/** Freier Fehlersatz, der die drei Bestandteile selbst formuliert. */
export class WerkzeugMeldung extends WerkzeugFehler {
  constructor({ tool, param, value, range, next, message }) {
    super({ tool, param, value, range, next });
    this.message = message;
  }
}

/**
 * Ganzzahl in [min, max]. Wirft mit Wert, Bereich und naechstem Schritt.
 */
export function pruefeGanzzahl(tool, param, v, min, max, next) {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new WerkzeugFehler({
      tool, param, value: v,
      range: `ganze Zahl von ${min} bis ${max}`,
      next
    });
  }
  return v;
}

/** Zahl in [min, max], mit Einheit im Bereichstext. */
export function pruefeZahl(tool, param, v, min, max, einheit, next) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new WerkzeugFehler({
      tool, param, value: v,
      range: `Zahl von ${zahl(min)} bis ${zahl(max)} ${einheit}`,
      next
    });
  }
  return v;
}

/** Nicht-leerer String. Der Bereich nennt die zulaessige Mindestlaenge. */
export function pruefeText(tool, param, v, next, maxLaenge = 500) {
  if (typeof v !== 'string' || v.length < 1 || v.length > maxLaenge) {
    throw new WerkzeugFehler({
      tool, param, value: v,
      range: `Text mit 1 bis ${maxLaenge} Zeichen`,
      next
    });
  }
  return v;
}

/** Wert aus einer festen Liste. Der Bereich zaehlt die Liste samt Anzahl auf. */
export function pruefeAuswahl(tool, param, v, erlaubt, next) {
  if (!erlaubt.includes(v)) {
    throw new WerkzeugFehler({
      tool, param, value: v,
      range: `einer von ${erlaubt.length} Werten: ${erlaubt.join(', ')}`,
      next
    });
  }
  return v;
}

/** Array mit Laenge in [min, max]. */
export function pruefeListe(tool, param, v, min, max, next) {
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    throw new WerkzeugFehler({
      tool, param, value: Array.isArray(v) ? `Liste mit ${v.length} Einträgen` : v,
      range: `Liste mit ${min} bis ${max} Einträgen`,
      next
    });
  }
  return v;
}

/** Frame im Bereich 0..frameCount-1. Haeufigster Fehler, deshalb eigener Helfer. */
export function pruefeFrame(tool, param, v, frameCount) {
  if (!Number.isInteger(v) || v < 0 || v >= frameCount) {
    throw new WerkzeugMeldung({
      tool, param, value: v,
      range: `ganze Zahl von 0 bis ${frameCount - 1}`,
      next: `setze die Länge zuerst mit set_duration (aktuell ${frameCount} Frames)`,
      message: `${param} ${wert(v)} liegt außerhalb der Timeline von 0 bis ${frameCount - 1}; `
        + `setze die Länge zuerst mit set_duration (aktuell ${frameCount} Frames)`
    });
  }
  return v;
}

/** Objekt (kein Array, kein null). */
export function pruefeObjekt(tool, param, v, next) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new WerkzeugFehler({
      tool, param, value: v,
      range: 'Objekt mit 0 oder mehr Feldern',
      next
    });
  }
  return v;
}
