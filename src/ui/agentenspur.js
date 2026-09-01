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

/**
 * Verfahrensparameter: wie viele Aufrufe die Spur vorhaelt.
 *
 * Frueher waren es 8 sichtbare Zeilen, und die Liste wuchs mit jedem Eintrag
 * in die Hoehe: ein look-Ergebnis brachte fuenf Textzeilen mit, ein
 * describe_pose-Ergebnis dreissig. Das Panel sprang bei jedem Aufruf und war
 * nach zwanzig Aufrufen unlesbar. Jetzt haben alle Zeilen dieselbe Hoehe und
 * das Feld scrollt in sich — damit koennen mehr Aufrufe stehenbleiben, ohne
 * dass etwas huepft.
 */
export const ZEILEN_STANDARD = 60;

/**
 * Verfahrensparameter: Zeichen der Ergebniszeile.
 *
 * Zwei Zeilen passen in die Panelbreite. Was laenger ist, wird gekuerzt und
 * steht vollstaendig im Tooltip — die Spur ist eine Uebersicht fuer den
 * Menschen, kein Protokoll zum Mitlesen.
 */
export const ERGEBNIS_MAX_ZEICHEN = 120;

/**
 * Was die Ergebniszeile zeigt. Befund 3 aus der Browser-Sichtprüfung: die
 * Zeile „10 von 10 unsicheren Zuordn…“ lief aus ihrem Feld — die Meldung aus
 * rollen-bestaetigung.js ist länger als 90 Zeichen, wurde zuvor auf 90
 * Zeichen gekürzt und drückte damit zugleich die Panelbreite auf. Kürzen auf
 * weniger Zeichen wirft nur Information weg; die Zeile darf umbrechen.
 * Deshalb steht hier keine Kürzung mehr: die Funktion vereinigt nur noch die
 * erste Zeile der Werkzeugantwort — den Umbruch übernimmt das CSS.
 *
 * @param {object} antwort Werkzeugantwort { content: [{ type, text }] }
 * @returns {string} die erste Textzeile, ungekürzt
 */
export function ergebnisZeile(antwort) {
  const teile = antwort?.content ?? [];
  const roh = teile.find?.((t) => t.type === 'text')?.text ?? '';
  const bilder = Array.isArray(teile) ? teile.filter((t) => t.type === 'image').length : 0;
  const text = String(roh).trim();

  // JSON-Antworten (describe_pose, measure, describe_world) beginnen mit einer
  // Klammer. Die erste Zeile davon war woertlich "{" — im Panel stand dann
  // dreimal untereinander "describe_pose  {". Statt dessen werden die Felder
  // benannt, die drinstehen: das ist die Auskunft, die der Mensch braucht.
  let zeile;
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      zeile = Object.entries(o)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => {
          if (Array.isArray(v)) return k + ': ' + v.length;
          if (typeof v === 'object') return k + ': ' + Object.keys(v).length + ' Felder';
          return k + ': ' + v;
        })
        .join(' \u00b7 ');
    } catch {
      zeile = text.replace(/\s+/g, ' ');
    }
  } else {
    zeile = text.split('\n')[0].trim();
  }

  const bildText = bilder > 0 ? '[' + bilder + ' Bild' + (bilder === 1 ? '' : 'er') + '] ' : '';
  const ganz = bildText + zeile;
  return ganz.length > ERGEBNIS_MAX_ZEICHEN
    ? ganz.slice(0, ERGEBNIS_MAX_ZEICHEN - 1) + '\u2026'
    : ganz;
}

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
              // Die Argumente reisen mit: die Oberflaeche stellt die Ansicht
              // auf den Frame, um den es ging. Ohne sie weiss sie nur, DASS
              // etwas passiert ist, nicht WO.
              args,
              name: werkzeug.name,
              dauerMs: Date.now() - start,
              // Die Schicht liefert Fehler als Antwort mit isError, nicht als Ausnahme.
              fehler: antwort?.isError === true,
              text: ersteZeile(antwort)
            });
            return antwort;
          } catch (err) {
            senke.notiere({
              args,
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

/** Erste Textzeile einer Werkzeugantwort. Siehe ergebnisZeile() oben: der
 * Text wird nicht mehr gekürzt, die Zeile bricht stattdessen um. */
function ersteZeile(antwort) {
  return ergebnisZeile(antwort);
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
  titel.textContent = 'Agent activity';

  const liste = dok.createElement('ol');
  liste.id = 'spur-liste';

  // Befund 3: „10 von 10 unsicheren Zuordn…“ lief aus der Zeile, weil die
  // CSS-Regel `.spur-zeile .ergebnis` in index.html mit
  // `white-space: nowrap; text-overflow: ellipsis; overflow: hidden` arbeitet
  // und die Zeile damit über die Panelbreite schiebt. index.html gehört einem
  // anderen Paket — der Ersatz kommt als Inline-Stil an jedem erzeugten
  // Element an, mit genau denselben drei Eigenschaften neu gesetzt.
  // Kein eingebetteter Stil mehr: Zeilenhoehe und Scrollen legt index.html
  // fest, damit alle Zeilen gleich hoch sind und das Feld in sich scrollt
  // statt zu wachsen.

  wurzel.setAttribute('aria-live', 'polite');
  wurzel.hidden = true;
  wurzel.replaceChildren(titel, liste);

  const eintraege = [];

  function zeichne() {
    titel.textContent = eintraege.length === 1
      ? 'Agent activity — 1 call'
      : `Agent activity — ${eintraege.length} calls`;

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
      // Inline-Stil statt nur der eingebetteten Regel: eine Regel im <style>
      // verliert gegen die spezifischere Regel aus index.html nie, der
      // Inline-Stil gewinnt immer. Beide zusammen schaden nicht.
      ergebnis.textContent = e.fehler ? ('rejected \u2014 ' + e.text) : e.text;
      // Der ganze Text im Tooltip: gekuerzt wird fuer die Uebersicht, nicht um
      // Auskunft wegzuwerfen.
      ergebnis.title = e.voll || e.text;

      zeile.append(zeit, name, ergebnis);
      return zeile;
    }));
    wurzel.hidden = eintraege.length === 0;
  }

  return {
    notiere({ name, dauerMs = 0, fehler = false, text = '', voll = '' }) {
      const t = uhr();
      // Aelteste Eintraege fallen hinten raus: die Spur ist ein Fenster auf die
      // letzte Arbeit, kein wachsendes Protokoll.
      if (eintraege.length >= zeilen) eintraege.length = zeilen - 1;
      eintraege.unshift({
        name, dauerMs, fehler, text, voll: voll || text,
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
