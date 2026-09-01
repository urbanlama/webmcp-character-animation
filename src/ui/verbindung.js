// Der Zustand der WebMCP-Verbindung, als Anzeige statt als Absatz.
//
// Befund aus dem Live-Abzug: Die Seite meldete den fehlenden Kontext als
// vierzeiligen Fließtext über die volle Fensterbreite — das lauteste Element
// im Bild war eine Fehlermeldung, und die eine Zahl, um die es bei einem
// WebMCP-Wettbewerb geht (16 Werkzeuge), stand darin versteckt.
//
// Hier steht sie vorn: Zähler, Zustand, und erst danach, leise, der Weg zum
// Kontext. Die Zahlen kommen aus dem Katalog und aus der Werkzeugschicht,
// nicht aus dem Text.

/**
 * Hängt die Verbindungsanzeige an einen Container.
 *
 * @param {object}      opt
 * @param {HTMLElement} opt.wurzel  Container, z. B. <section id="hinweis">
 * @returns {{setze: Function}}
 */
export function mounteVerbindung({ wurzel }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteVerbindung: 0 Container übergeben, erwartet 1 Element');
  }
  const dok = wurzel.ownerDocument;

  const kopf = dok.createElement('div');
  kopf.className = 'verb-kopf';

  const punkt = dok.createElement('span');
  punkt.className = 'verb-punkt';

  const marke = dok.createElement('span');
  marke.className = 'verb-marke';
  marke.textContent = 'WebMCP';

  const zustand = dok.createElement('span');
  zustand.className = 'verb-zustand';

  kopf.append(punkt, marke, zustand);

  const zaehler = dok.createElement('p');
  zaehler.className = 'verb-zaehler';

  const weg = dok.createElement('p');
  weg.className = 'verb-weg';

  wurzel.setAttribute('role', 'status');
  wurzel.replaceChildren(kopf, zaehler, weg);
  wurzel.hidden = false;

  /**
   * Setzt den Zustand.
   *
   * @param {object}  arg
   * @param {boolean} arg.verbunden      liegt document.modelContext vor
   * @param {number}  arg.registriert    tatsächlich registrierte Werkzeuge
   * @param {number}  arg.katalog        Werkzeuge im Katalog
   * @param {string}  [arg.wegText]      wie der Kontext zustande kommt
   */
  function setze({ verbunden, registriert, katalog, wegText = '' }) {
    wurzel.classList.toggle('verbunden', verbunden);
    zustand.textContent = verbunden ? 'connected' : 'no agent connected';
    zaehler.replaceChildren();

    const zahl = dok.createElement('span');
    zahl.className = 'verb-zahl';
    zahl.textContent = `${registriert} / ${katalog}`;
    const wort = dok.createElement('span');
    wort.className = 'verb-wort';
    wort.textContent = registriert === 1 ? 'tool registered' : 'tools registered';
    zaehler.append(zahl, wort);

    weg.textContent = wegText;
    weg.hidden = wegText === '';
  }

  return { setze };
}
