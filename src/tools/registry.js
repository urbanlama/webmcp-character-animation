// Registrierung der Werkzeuge bei WebMCP, gemessene API aus AGENTS.md.
//
//   await document.modelContext.registerTool({name, description, inputSchema, execute})
//   document.modelContext.getTools()
//   document.modelContext.executeTool(name, argumenteAlsJsonString) -> String
//
// Diese Schicht liegt davor und prueft, was registriert wird. Grund: die
// Werkzeugbeschreibung ist das Handbuch fuer den Agenten (AGENTS.md,
// Handwerkliches). Ein Werkzeug ohne Beschreibung ist fuer ihn unsichtbar,
// auch wenn es technisch registriert ist — deshalb wird es hier abgelehnt,
// laut und mit Grund, statt still durchgelassen.
//
// Die eine Regel dieser Datei fuer den AUFRUF: ein Werkzeugaufruf wirft nicht.
// Der Agent im ChatGPT-Browser kommt ausschliesslich ueber document.modelContext,
// die Seite selbst ueber rufe(). Beide Wege fuellen dieselbe Funktion
// (unten `ausfuehre`) und erhalten denselben Satz: { isError, content, details }.
// Eine Ausnahme, die bis zum Aufrufer durchhaelt, kommt dort nicht als Meldung
// an, sondern als technischer Absturz — dann nutzt die schoenste
// Fehlermeldung nichts (AGENTS.md: "Jede Fehlermeldung nennt eine Zahl").
//
// REGISTRIEREN ist davon ausgenommen und bleibt laut: eine unbrauchbare
// Werkzeugdefinition ist ein Fehler des Entwicklers, nicht des Agenten, und
// wird abgewiesen, bevor sie den Browser erreicht.

import { WerkzeugFehler, WerkzeugMeldung, wert } from './errors.js';

/** Verfahrensparameter: Mindestlaenge einer Beschreibung in Zeichen. 40 ist
 *  kuerzer als jede Beschreibung des Katalogs (kuerzeste hat 84) und lang
 *  genug, dass ein Platzhalter wie "TODO" oder "macht was" auffliegt. */
export const BESCHREIBUNG_MIN = 40;

/** Groesse einer Werkzeugantwort. Gemessen: 512 KB kommen vollstaendig durch
 *  (plan.md 3.1). Darueber wird abgeschnitten gemeldet statt still verschluckt. */
export const ANTWORT_MAX_BYTES = 512 * 1024;

const NAME_MUSTER = /^[a-z][a-z0-9_]*$/;

/**
 * @param {object} opt
 * @param {object} [opt.modelContext] `document.modelContext`; fehlt es, laeuft
 *        die Registrierung nur intern (Node-Test).
 */
export function createRegistry({ modelContext = null } = {}) {
  /** @type {Map<string, {name, description, inputSchema, execute}>} */
  const werkzeuge = new Map();

  function pruefeDefinition(def) {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) {
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'Werkzeugdefinition', value: def,
        range: 'Objekt mit 4 Feldern: name, description, inputSchema, execute',
        next: 'übergib ein Objekt',
        message: `Werkzeugdefinition ${wert(def)} abgelehnt: erwartet ein Objekt mit `
          + '4 Feldern (name, description, inputSchema, execute)'
      });
    }

    const { name, description, inputSchema, execute } = def;

    if (typeof name !== 'string' || !NAME_MUSTER.test(name) || name.length > 40) {
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'name', value: name,
        range: 'Kleinbuchstaben, Ziffern und Unterstrich, 1 bis 40 Zeichen',
        next: 'benenne das Werkzeug wie im Katalog, z. B. set_duration',
        message: `Werkzeugname ${wert(name)} abgelehnt: erlaubt sind 1 bis 40 Zeichen aus `
          + 'Kleinbuchstaben, Ziffern und Unterstrich; benenne es wie im Katalog, z. B. set_duration'
      });
    }

    if (werkzeuge.has(name)) {
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'name', value: name,
        range: 'je Name genau 1 Werkzeug',
        next: 'wähle einen anderen Namen',
        message: `Werkzeug ${wert(name)} ist bereits registriert: je Name geht genau 1 Werkzeug; `
          + `aktuell sind ${werkzeuge.size} registriert — wähle einen anderen Namen`
      });
    }

    // Der Kern der Pruefung: keine Beschreibung, kein Werkzeug.
    if (typeof description !== 'string' || description.trim().length < BESCHREIBUNG_MIN) {
      const laenge = typeof description === 'string' ? description.trim().length : 0;
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'description', value: description,
        range: `Text mit mindestens ${BESCHREIBUNG_MIN} Zeichen`,
        next: 'nenne Zweck, Bezugssystem und Einheiten der Parameter',
        message: `Werkzeug "${name}" abgelehnt: Beschreibung hat ${laenge} Zeichen, `
          + `verlangt sind mindestens ${BESCHREIBUNG_MIN}; sie ist das Handbuch für den Agenten — `
          + 'nenne Zweck, Bezugssystem und Einheiten der Parameter'
      });
    }

    if (inputSchema === null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)
        || inputSchema.type !== 'object' || typeof inputSchema.properties !== 'object'
        || inputSchema.properties === null || Array.isArray(inputSchema.properties)) {
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'inputSchema', value: inputSchema,
        range: "Objekt mit type 'object' und einem properties-Objekt",
        next: 'nimm { type: "object", properties: {}, required: [] } für parameterlose Werkzeuge',
        message: `Werkzeug "${name}" abgelehnt: inputSchema muss 1 Objekt mit type "object" und `
          + 'einem properties-Objekt sein; für parameterlose Werkzeuge '
          + '{ type: "object", properties: {}, required: [] }'
      });
    }

    if (typeof execute !== 'function') {
      throw new WerkzeugMeldung({
        tool: 'registry', param: 'execute', value: execute,
        range: '1 Funktion',
        next: 'gib eine async-Funktion an, die {content:[...]} zurückgibt',
        message: `Werkzeug "${name}" abgelehnt: execute ist ${wert(execute)}, erwartet wird `
          + '1 Funktion, die {content:[...]} zurückgibt'
      });
    }

    // Jeder Pflichtparameter muss im Schema stehen, sonst kann der Agent ihn
    // nicht kennen. Fehlt einer, waere die Beschreibung unvollstaendig.
    const pflicht = Array.isArray(inputSchema.required) ? inputSchema.required : [];
    for (const p of pflicht) {
      if (!Object.prototype.hasOwnProperty.call(inputSchema.properties, p)) {
        throw new WerkzeugMeldung({
          tool: 'registry', param: 'inputSchema.required', value: p,
          range: `alle ${pflicht.length} Pflichtparameter auch in properties`,
          next: `beschreibe "${p}" in properties`,
          message: `Werkzeug "${name}" abgelehnt: Pflichtparameter "${p}" fehlt in properties; `
            + `alle ${pflicht.length} Pflichtparameter müssen dort beschrieben sein`
        });
      }
    }
  }

  /** Antwort in das WebMCP-Format bringen und die gemessene Grenze wahren. */
  function normalisiere(name, roh) {
    let antwort = roh;
    if (antwort === undefined || antwort === null) {
      antwort = { content: [{ type: 'text', text: '' }] };
    }
    if (typeof antwort === 'string') {
      antwort = { content: [{ type: 'text', text: antwort }] };
    }
    if (!Array.isArray(antwort.content)) {
      antwort = { content: [{ type: 'text', text: JSON.stringify(antwort) }] };
    }
    const bytes = Buffer_byteLength(JSON.stringify(antwort));
    if (bytes > ANTWORT_MAX_BYTES) {
      return {
        content: [{
          type: 'text',
          text: `Antwort von ${name} ist ${Math.round(bytes / 1024)} KB groß, erlaubt sind `
            + `${ANTWORT_MAX_BYTES / 1024} KB; frage weniger Frames oder Ansichten auf einmal ab`
        }],
        isError: true
      };
    }
    return antwort;
  }

  /**
   * Die einzige Ausführungsfunktion. Sie wird registriert UND intern aufgerufen,
   * damit es gar nicht zwei Fehlerformen geben kann. Sie wirft nicht: was
   * irgendwo drinnen fliegt — abgelehnte Eingabe, Programmfehler, sogar eine
   * kaputte Antwort — wird hier zu einer Fehlerantwort.
   */
  async function ausfuehre(def, args) {
    try {
      return normalisiere(def.name, await def.execute(args ?? {}));
    } catch (e) {
      return fehlerantwort(def.name, def.inputSchema, args, e);
    }
  }

  return {
    /**
     * Registriert ein Werkzeug. Wirft bei fehlender oder zu duenner
     * Beschreibung, bevor irgendetwas an den Browser geht — das ist der
     * Entwicklerpfad. Der AUFRUFPFAD wirft später nie mehr, siehe ausfuehre.
     */
    async registriere(def) {
      pruefeDefinition(def);
      const eintrag = {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        execute: (args) => ausfuehre(def, args)
      };
      werkzeuge.set(def.name, eintrag);
      if (modelContext && typeof modelContext.registerTool === 'function') {
        await modelContext.registerTool(eintrag);
      }
      return eintrag;
    },

    /** Was der Agent sieht: Name, Beschreibung, Schema. Ohne execute. */
    getTools() {
      return [...werkzeuge.values()].map(({ name, description, inputSchema }) =>
        ({ name, description, inputSchema }));
    },

    anzahl() {
      return werkzeuge.size;
    },

    /**
     * Ruft ein Werkzeug auf — derselbe Weg, den document.modelContext nimmt,
     * weil er dasselbe `execute` fuellt. Ein Fehlschlag kommt als Antwort mit
     * isError zurueck, nie als Ausnahme.
     */
    async rufe(name, args = {}) {
      const eintrag = werkzeuge.get(name);
      if (!eintrag) {
        const bekannt = [...werkzeuge.keys()];
        return new WerkzeugMeldung({
          tool: 'registry', param: 'name', value: name,
          range: `einer von ${bekannt.length} registrierten Namen`,
          next: 'rufe getTools() auf',
          message: `Werkzeug ${wert(name)} gibt es nicht; registriert sind ${bekannt.length}: `
            + `${bekannt.join(', ')}`
        }).toResult();
      }
      return eintrag.execute(args);
    }
  };
}

/** Verfahrensparameter: So viele Zeichen einer unerwarteten Ausnahme sieht der
 *  Agent. Laengere werden gekuerzt — wie viele verloren gingen, nennt die
 *  Meldung selbst. 400 ist laenger als jede Werkzeugmeldung aus errors.js. */
export const AUSNAHME_MAX_ZEICHEN = 400;

/**
 * Die einzige Stelle, an der eine Ausnahme zu einer Antwort wird. Beide
 * Aufrufwege laufen hier durch, also gibt es danach nur noch eine Fehlerform.
 *
 * @param {string} name   das Werkzeug, das aufgerufen war
 * @param {object} schema sein inputSchema — fuer den Vergleich mit dem, was kam
 * @param {*}      args   was der Aufrufer uebergeben hat
 * @param {*}      e      was geflogen ist (alles, auch Nicht-Fehler)
 */
function fehlerantwort(name, schema, args, e) {
  if (e instanceof WerkzeugFehler) return nenneZahl(e.toResult(), name, schema, args);

  return nenneZahl(new WerkzeugMeldung({
    tool: name,
    param: 'Ausführung',
    value: text(e instanceof Error ? e.name : e, 'Ausnahme ohne Namen'),
    range: `${name} soll 1 Antwort liefern und wirft intern; erlaubt sind 0 Ausnahmen`,
    next: 'hier liegt kein Fehler deiner Eingabe vor; versuche denselben Aufruf erneut '
      + 'und melde ihn, wenn er noch 1 Mal auftritt',
    message: `Werkzeug "${name}" ist abgestürzt, statt zu antworten: ${kuerze(ursprung(e))}. `
      + aufrufZaehlung(name, schema, args)
  }).toResult(), name, schema, args);
}

/**
 * AGENTS.md: "Jede Fehlermeldung nennt eine Zahl." Der Kern der Meldungen wird
 * nicht angetastet — wer ohne Ziffer herauskommt, bekommt die Aufrufzaehlung
 * untergestetzt, damit die Zusage auch fuer den Agenten gilt.
 */
function nenneZahl(antwort, name, schema, args) {
  const content = Array.isArray(antwort?.content) ? antwort.content : [];
  const erste = typeof content[0]?.text === 'string' ? content[0].text : null;
  if (erste !== null && /\d/.test(erste)) return antwort;

  const zusatz = `Diese Meldung nannte keine Zahl; ${aufrufZaehlung(name, schema, args)}`;
  if (erste === null) {
    return { ...antwort, content: [{ type: 'text', text: zusatz }, ...content] };
  }
  return {
    ...antwort,
    content: [{ ...content[0], text: `${erste}\n${zusatz}` }, ...content.slice(1)]
  };
}

/** Was der Aufrufer geliefert hat gegen das, was das Schema beschreibt. */
function aufrufZaehlung(name, schema, args) {
  const uebergeben = felder(args);
  const beschrieben = felder(schema?.properties);
  return `übergeben sind ${uebergeben} Parameter, ${name} beschreibt ${beschrieben}; `
    + 'rufe getTools() auf und schicke die fehlenden Felder mit';
}

/** Anzahl Felder eines Objekts — wirft nie, auch nicht bei null oder 42. */
function felder(objekt) {
  if (objekt === null || typeof objekt !== 'object') return 0;
  try {
    return Object.keys(objekt).length;
  } catch {
    return 0;
  }
}

/** Name und Meldung dessen, was flog — auch von einem Symbol oder von Luft. */
function ursprung(e) {
  if (e instanceof Error) return `${text(e.name, 'Error')}: ${text(e.message, 'ohne Meldung')}`;
  if (e === null || e === undefined) {
    return `${text(e)} geworfen, kein Fehlerobjekt und ohne Meldung`;
  }
  return text(e, 'ohne Meldung');
}

function kuerze(t) {
  if (t.length <= AUSNAHME_MAX_ZEICHEN) return t;
  return `${t.slice(0, AUSNAHME_MAX_ZEICHEN)} … (abgeschnitten nach ${AUSNAHME_MAX_ZEICHEN} `
    + `von ${t.length} Zeichen)`;
}

/** String von allem. Ein Objekt mit kaputtem toString darf nicht ausgerechnet
 *  hier, beim Antworten ueber einen Fehler, erneut werfen. */
function text(v, fallback) {
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

/** Bytelaenge ohne Node-Abhaengigkeit — laeuft auch im Browser. */
function Buffer_byteLength(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length;
}
