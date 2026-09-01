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
//
// import weiter unten: PANEL_BREITE_MAX für Befund 2 unten.

/**
 * Text der Budgetanzeige, docs/plan.md 6.7: drei Rueckfragen je Auftrag,
 * einstellbar bis 0. Rollen- und Absichtbestätigungen sind Pflichtfragen
 * ("kein Notausgang") und verbrauchen das Budget bewusst nicht — der Broker
 * zählt sie nicht (src/ui/ask-human.js, `pflicht`), und die Anzeige darf nicht
 * so tun, als wären sie verbraucht. Befund aus der Browser-Sichtprüfung:
 * zehn Rollenfragen zeigen unverändert „Noch 3 von 3 Fragen frei." — der
 * verbrauchte Stand ist korrekt, aber die Anzeige verschweigt den Grund.
 * Deshalb nennt sie ihn immer.
 *
 * @param {{budget: number, verbraucht: number, uebrig: number}} stand
 *        aus Broker.abonniere() / Broker.stand()
 * @returns {string}
 */
export function budgetText(stand) {
  if (!stand || !Number.isInteger(stand.budget) || !Number.isInteger(stand.uebrig)) {
    throw new Error(`budgetText: 1 brauchbarer Stand mit budget und uebrig erwartet, `
      + `bekam ${JSON.stringify(stand)} — Rollen- und Absichtfragen zählen nicht, `
      + 'budget/uebrig müssen ganze Zahlen sein');
  }
  const hinweis = 'Role and intent confirmations cost no budget.';
  return stand.uebrig > 0
    ? `${stand.uebrig} of ${stand.budget} questions left — ${hinweis}`
    : `${stand.budget - stand.uebrig} of ${stand.budget} questions used, `
      + `none left — ${hinweis}`;
}

/**
 * Haengt das Panel an einen vorhandenen Container.
 *
 * @param {object}      opt
 * @param {object}      opt.ask     Broker aus createAskBroker()
 * @param {HTMLElement} opt.wurzel  leerer Container, z. B. <section id="frage">
 * @param {Window}      [opt.fenster] fuer den Neuladen-Abbruch; Standard window
 * @returns {{ abmelden: () => void }}
 */
// src/ui/frage-panel.js kennt kein Layout und kein CSS — es baut nur den
// Aufbau. Drei Messfehler aus der Browser-Sichtprüfung wurden deshalb hier am
// Panel selbst mit Inline-Stilen behoben, weil index.html einem anderen Paket
// gehört und die Panelbreite die Leinwandgröße steuert:
//
//   Befund 2: Das Panel wächst mit jeder Frage, die Figur wurde von 490 px auf
//   430 px Breite kleiner. Grund: #seite hat `flex: 0 0 clamp(300px,30vw,420px)`
//   in index.html — mit `box-sizing: content-box` sind die 420 px Grenze aber
//   nur der *Inhalt*, und der Rahmen (2 × 1 px) plus Abstand (2 × 16 px) kommen
//   oben drauf. Wächst der Inhalt, wächst die Spalte über 420 px hinaus und
//   presst `#stage` über `flex: 1 1 auto` zusammen. Mit border-box ist 420 px
//   die Obergrenze inklusive Rahmen und Abstand, die Leinwand behält 960 px.
//   Die feste Breite sitzt auf dem Container (#seite) und nicht am #frage-
//   Panel, weil #spur dieselbe Spalte teilt und mitwachsen würde.
//
//   Befund 3: Der Spur-Text „10 von 10 unsicheren Zuordn…" lief aus seinem
//   Feld. Grund: `.spur-zeile .ergebnis` hat in index.html
//   `white-space: nowrap; text-overflow: ellipsis` im Zweispalten-Grid —
//   einnowrapener Text erzwingt die Zeile auf volle Textlänge, drückt damit
//   die Panelbreite (Befund 2) und wird trotzdem bei `overflow: hidden`
//   abgeschnitten. Der Text bricht jetzt um (siehe agentenspur.js).
//
// Beides passiert ohne die Kamera: frameCamera rahmt aus der Bounding Box und
// folgt der Leinwandgröße von selbst, src/scene/view.js bleibt unberührt.

import { PANEL_BREITE_MAX } from './panel-masse.js';

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
  abbruch.textContent = 'Cancel';

  const budget = dok.createElement('span');
  budget.id = 'frage-budget';

  const fuss = dok.createElement('div');
  fuss.id = 'frage-fuss';
  fuss.append(abbruch, budget);

  wurzel.setAttribute('role', 'dialog');
  wurzel.setAttribute('aria-live', 'polite');
  wurzel.hidden = true;

  // Befund 2: feste Spaltenbreite, siehe Kommentarblock oben. box-sizing und
  // die Höhe sitzen an der Spalte (wurzel.parentElement = #seite), weil Spur
  // und Frage sich dieselbe Spalte teilen und beide mitwachsen würden.
  const spalte = wurzel.parentElement;
  if (spalte) {
    spalte.style.boxSizing = 'border-box';
    spalte.style.maxWidth = `${PANEL_BREITE_MAX}px`;
    spalte.style.overflowY = 'auto';
    spalte.style.maxHeight = 'calc(100vh - 120px)';
  }
  // Auch das Panel selbst: Rahmen + Abstand dürfen die 420 px nicht sprengen.
  wurzel.style.boxSizing = 'border-box';

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
    // Befund aus der Sichtprüfung (Browser): zehn Fragen hintereinander zeigten
    // unverändert „Noch 3 von 3 Fragen frei." — zeichne() lief hier bei jeder
    // Frage ohne Ausnahme, der Text war einfach immer derselbe, weil Pflicht-
    // fragen (Rollen, Absicht) das Budget bewusst nicht verbrauchen. Der
    // verbrauchte Stand ist also richtig — die Anzeige musste nur ehrlich
    // dazusagen, dass diese Fragen nicht zählen. budgetText() nennt beides.
    budget.textContent = budgetText(stand);
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
