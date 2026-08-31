// Sichtbare Haelfte der Rueckfrage, docs/plan.md 6.7.
//
// src/ui/ask-human.js kennt kein DOM: der Broker haelt den Werkzeugaufruf offen
// und wartet auf antworte(index). Diese Datei ist das Gegenstueck in der Seite —
// sie abonniert den Broker, zeigt die offene Frage mit ihren Antwortmoeglichkeiten
// und meldet den Klick zurueck. Dazwischen liegt nichts: kein Zwischenspeicher,
// keine zweite Wahrheit. Wartet keine Frage, ist das Panel weg.
//
// Zwei Darstellungen, eine Mechanik:
//   - zwei Antwortmoeglichkeiten  -> zwei Varianten nebeneinander (6.7, Punkt 3,
//     "Geschmacksfrage"): gleiche Hoehe, nebeneinander, ein Klick waehlt eine
//   - drei bis sechs             -> Liste untereinander
// Gewaehlt wird nur durch einen Klick. Ohne Klick bleibt der Werkzeugaufruf
// offen; nichts wird stillschweigend fuer den Menschen entschieden.
//
// Abbruch und Neuladen enden gleich: ask.abbrechen() beendet den wartenden
// Aufruf mit einem Fehler. Geaendert wurde dann nichts — dafuer sorgt
// store.aendere(), das bei einer Ausnahme nichts uebernimmt.
//
// Die Klassennamen (frage-karte, varianten, liste) haben ihr Aussehen im
// <style> von index.html; hier steht nur der Aufbau.

/**
 * Haengt das Panel an einen vorhandenen Container.
 *
 * @param {object}      opt
 * @param {object}      opt.ask     Broker aus createAskBroker()
 * @param {HTMLElement} opt.wurzel  leerer Container, z. B. <section id="frage">
 * @param {Window}      [opt.fenster] fuer den Neuladen-Abbruch; Standard window
 * @returns {{ abmelden: () => void }}
 */
export function mounteFragePanel({ ask, wurzel, fenster = globalThis }) {
  if (!ask || typeof ask.abonniere !== 'function') {
    throw new Error('mounteFragePanel: 0 Broker uebergeben, erwartet 1 ask aus createAskBroker()');
  }
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteFragePanel: 0 Container uebergeben, erwartet 1 Element');
  }

  const dok = wurzel.ownerDocument;

  const text = dok.createElement('p');
  text.id = 'frage-text';

  const optionen = dok.createElement('div');
  optionen.id = 'frage-optionen';

  const hinweis = dok.createElement('p');
  hinweis.id = 'frage-hinweis';
  hinweis.hidden = true;

  const abbruch = dok.createElement('button');
  abbruch.id = 'frage-abbruch';
  abbruch.type = 'button';
  abbruch.textContent = 'Abbrechen';

  const budget = dok.createElement('span');
  budget.id = 'frage-budget';

  const fuss = dok.createElement('div');
  fuss.id = 'frage-fuss';
  fuss.append(abbruch, budget);

  wurzel.setAttribute('role', 'dialog');
  wurzel.setAttribute('aria-live', 'polite');
  wurzel.hidden = true;
  wurzel.replaceChildren(text, optionen, hinweis, fuss);

  /** Eine Antwortmoeglichkeit als Knopf. Bei zwei Stueck ist sie eine Variante. */
  function baueKnopf(beschriftung, index, alsVariante) {
    const knopf = dok.createElement('button');
    knopf.type = 'button';
    knopf.className = alsVariante ? 'frage-karte variante' : 'frage-karte';
    knopf.dataset.index = String(index);

    if (alsVariante) {
      // Nur die Nummer, nicht das Wort "Variante": dieselben Karten tragen auch
      // die Rollenfrage aus 6.7 Moment 1 ("ja, mixamorigLeftFoot" / "nein,
      // sondern ..."). Die Nummer verweist zugleich auf den Marker, der im
      // Modell leuchtet — src/ui/knochen-leuchten.js beschriftet ihn genauso.
      const marke = dok.createElement('span');
      marke.className = 'marke';
      marke.textContent = String(index + 1);
      const titel = dok.createElement('span');
      titel.className = 'titel';
      titel.textContent = beschriftung;
      knopf.append(marke, titel);
    } else {
      knopf.textContent = beschriftung;
    }

    knopf.addEventListener('click', () => {
      hinweis.hidden = true;
      try {
        ask.antworte(index);
      } catch (err) {
        // Der Klick kam zu spaet: die Frage wurde zwischendurch abgebrochen.
        hinweis.textContent = err.message;
        hinweis.hidden = false;
      }
    });
    return knopf;
  }

  function zeichne(frage, stand) {
    if (!frage) {
      wurzel.hidden = true;
      text.textContent = '';
      optionen.replaceChildren();
      return;
    }

    // Zwei Moeglichkeiten sind eine Geschmacksfrage: nebeneinander, nicht als Liste.
    const alsVarianten = frage.options.length === 2;
    text.textContent = frage.question;
    optionen.className = alsVarianten ? 'varianten' : 'liste';
    optionen.replaceChildren(
      ...frage.options.map((o, i) => baueKnopf(o, i, alsVarianten))
    );
    budget.textContent = `Noch ${stand.uebrig} von ${stand.budget} Fragen frei.`;
    hinweis.hidden = true;
    wurzel.hidden = false;
    optionen.firstElementChild?.focus();
  }

  abbruch.addEventListener('click', () => {
    ask.abbrechen('der Mensch hat die Frage abgebrochen');
  });

  // Neuladen und Schliessen: der wartende Aufruf stirbt mit der Seite. Er endet
  // hier ausdruecklich mit einem Fehler, statt still zu verschwinden.
  const beimVerlassen = () => { ask.abbrechen('die Seite wurde neu geladen'); };
  fenster.addEventListener?.('beforeunload', beimVerlassen);

  const abbestellen = ask.abonniere(zeichne);

  return {
    abmelden() {
      abbestellen();
      fenster.removeEventListener?.('beforeunload', beimVerlassen);
      wurzel.hidden = true;
      wurzel.replaceChildren();
    }
  };
}
