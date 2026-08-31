// Was der Agent gerade tut, sichtbar fuer den Menschen.
//
// Der Agent arbeitet minutenlang, waehrend der Mensch zusieht. Ohne Rueckmeldung
// wirkt die Seite tot — und „tot wirkende Seite“ ist teuer bei einem Wettbewerb,
// der Execution bewertet (plan.md 1). Deshalb eine ruhige Spur: welches
// Werkzeug, wann, mit welchem Ergebnis. Kein Log zum Mitlesen.
//
// Angehaengt wird ohne einen Eingriff in src/tools/: die Werkzeugschicht
// bekommt statt document.modelContext eine Huelle, die jedes registrierte
// execute umwickelt und danach unveraendert weiterreicht. Name, Beschreibung
// und Schema bleiben, wie die Schicht sie registriert hat — der Agent sieht
// keinen Unterschied.

/** Verfahrensparameter: sichtbare Zeilen. Mehr wird ein Log, weniger verliert
 * den Zusammenhang zwischen Aufruf und Ergebnis. */
export const ZEILEN_STANDARD = 8;

/** Laenge der Ergebniszeile in Zeichen. Der Mensch soll sehen, dass gearbeitet
 * wird, nicht die Werkzeugantwort lesen — die geht an den Agenten. */
const ERGEBNIS_LAENGE = 90;

/**
 * Legt eine Huelle um document.modelContext, die jeden Werkzeugaufruf meldet.
 * Aendert nichts an den Werkzeugen selbst.
 *
 * @param {object} echt  document.modelContext
 * @param {{notiere: Function}} senke  bekommt jeden Aufruf gemeldet
 */
export function spurKontext(echt, senke) {
  if (!echt || typeof echt.registerTool !== 'function') {
    throw new Error('spurKontext: 0 brauchbare modelContext übergeben, erwartet 1 mit registerTool()');
  }

  // Nicht spreaden: bei einer echten WebMCP-Umsetzung liegen die Methoden am
  // Prototyp, ein {...echt} liefert dann ein leeres Objekt. Deshalb wird jede
  // bekannte Methode einzeln und an das Original gebunden weitergereicht.
  const huelle = {
    async registerTool(werkzeug) {
      const umwickelt = {
        ...werkzeug,
        async execute(args) {
          const start = Date.now();
          try {
            const antwort = await werkzeug.execute(args);
            senke.notiere({
              name: werkzeug.name,
              dauerMs: Date.now() - start,
              // Die Schicht liefert Fehler als Antwort mit isError, nicht als Ausnahme.
              fehler: antwort?.isError === true,
              text: ersteZeile(antwort)
            });
            return antwort;
          } catch (err) {
            senke.notiere({
              name: werkzeug.name, dauerMs: Date.now() - start,
              fehler: true, text: err.message
            });
            throw err;
          }
        }
      };
      return echt.registerTool(umwickelt);
    }
  };

  for (const methode of ['registerTools', 'unregisterTool', 'getTools', 'executeTool']) {
    if (typeof echt[methode] === 'function') {
      huelle[methode] = (...args) => echt[methode](...args);
    }
  }
  return huelle;
}

/** Erste Textzeile einer Werkzeugantwort, gekuerzt. */
function ersteZeile(antwort) {
  const roh = antwort?.content?.find?.((t) => t.type === 'text')?.text ?? '';
  const zeile = String(roh).split('\n')[0].trim();
  return zeile.length > ERGEBNIS_LAENGE ? `${zeile.slice(0, ERGEBNIS_LAENGE - 1)}…` : zeile;
}

/**
 * Haengt die Spur an einen Container.
 *
 * @param {object}      opt
 * @param {HTMLElement} opt.wurzel  leerer Container, z. B. <section id="spur">
 * @param {number}      [opt.zeilen] sichtbare Zeilen
 * @param {Function}    [opt.uhr]   liefert die Zeit, fuer Tests austauschbar
 */
export function mounteSpur({ wurzel, zeilen = ZEILEN_STANDARD, uhr = () => new Date() }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteSpur: 0 Container übergeben, erwartet 1 Element');
  }
  const dok = wurzel.ownerDocument;

  const titel = dok.createElement('h2');
  titel.id = 'spur-titel';
  titel.textContent = 'Der Agent arbeitet';

  const liste = dok.createElement('ol');
  liste.id = 'spur-liste';

  wurzel.setAttribute('aria-live', 'polite');
  wurzel.hidden = true;
  wurzel.replaceChildren(titel, liste);

  const eintraege = [];

  function zeichne() {
    titel.textContent = eintraege.length === 1
      ? 'Der Agent arbeitet — 1 Aufruf'
      : `Der Agent arbeitet — ${eintraege.length} Aufrufe`;

    liste.replaceChildren(...eintraege.slice(0, zeilen).map((e) => {
      const zeile = dok.createElement('li');
      zeile.className = e.fehler ? 'spur-zeile fehler' : 'spur-zeile';
      zeile.dataset.werkzeug = e.name;

      const zeit = dok.createElement('span');
      zeit.className = 'zeit';
      zeit.textContent = e.zeit;

      const name = dok.createElement('span');
      name.className = 'werkzeug';
      name.textContent = e.name;

      const ergebnis = dok.createElement('span');
      ergebnis.className = 'ergebnis';
      ergebnis.textContent = e.fehler ? `abgelehnt — ${e.text}` : e.text;

      zeile.append(zeit, name, ergebnis);
      return zeile;
    }));
    wurzel.hidden = eintraege.length === 0;
  }

  return {
    notiere({ name, dauerMs = 0, fehler = false, text = '' }) {
      const t = uhr();
      eintraege.unshift({
        name, dauerMs, fehler, text,
        zeit: `${String(t.getHours()).padStart(2, '0')}:`
          + `${String(t.getMinutes()).padStart(2, '0')}:`
          + `${String(t.getSeconds()).padStart(2, '0')}`
      });
      zeichne();
    },
    /** Fuer Tests und Diagnose. */
    stand() {
      return { gesamt: eintraege.length, sichtbar: Math.min(eintraege.length, zeilen) };
    },
    leeren() {
      eintraege.length = 0;
      zeichne();
    }
  };
}
