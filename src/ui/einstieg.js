// Die Anleitungsspalte (rechts, unter der Agentenspur).
//
// Geschichte: Dieses Modul baute früher eine Erstsicht — Titel, Satz und
// Beispiel-Knopf über der leeren Bühne. Seit das Beispielmodell beim Start
// von selbst lädt, ist dieser Screen nur noch ein kurzes Flackern vor der
// Figur; er ist entfernt. Die Seite startet direkt in die Werkstatt, und
// hier bleibt nur die Anleitung für den Menschen: wie er einen Agenten
// verbindet und ihm einen Auftrag gibt.
//
// Kein Framework, kein Build-Schritt: die Seite bleibt eine statische Datei.

/**
 * Baut die Anleitungsspalte in die Seite ein.
 *
 * @param {object}     opt
 * @param {HTMLElement} opt.spalte  Container der rechten Spalte
 * @returns {void}
 */
export function mounteAnleitung({ spalte }) {
  if (!spalte || !spalte.ownerDocument) {
    throw new Error('mounteAnleitung: 0 Spalten-Container übergeben, erwartet 1 Element');
  }
  const dok = spalte.ownerDocument;

  // Was hier steht, muss stimmen.
  //
  // Das Modell lädt von selbst, es gibt nichts zu drücken. Uebrig bleiben die
  // zwei Dinge, die wirklich anstehen: den Agenten verbinden und ihm sagen,
  // was er bauen soll.
  const schritte = [
    ['1', 'Connect an agent',
      'Open this page in the ChatGPT desktop app, or in Chrome 149+ started with '
      + '--enable-features=WebMCP. The panel above says "connected" when it worked.'],
    ['2', 'Ask for a move',
      'Jump, walk, turn. The agent measures the body, sets poses frame by frame, '
      + 'renders what it built, and corrects what it sees.'],
    ['3', 'Watch and take the clip',
      'The figure follows along while the agent works. Drag the slider to check any '
      + 'frame. When the agent exports, the clip lands in your downloads.'],
  ];
  const liste = dok.createElement('ol');
  liste.id = 'einstieg-schritte';
  const titel = dok.createElement('h2');
  titel.id = 'einstieg-schritte-titel';
  titel.textContent = 'Getting started';
  for (const [nr, was, wie] of schritte) {
    const punkt = dok.createElement('li');
    punkt.className = 'einstieg-punkt';
    const marke = dok.createElement('span');
    marke.className = 'einstieg-nr';
    marke.textContent = nr;
    const wasEl = dok.createElement('strong');
    wasEl.textContent = was;
    const wieEl = dok.createElement('span');
    wieEl.className = 'einstieg-wie';
    wieEl.textContent = wie;
    punkt.append(marke, wasEl, wieEl);
    liste.appendChild(punkt);
  }
  spalte.replaceChildren(titel, liste);
}

/**
 * Liefert die Beispiel-Datei als File-Objekt — Fetch aus dem
 * Beispielverzeichnis, relativ zum Dokument (auch unter …/webmcp/).
 *
 * @param {object}   opt
 * @param {string}   [opt.basisUrl]  default: document.baseURI
 * @param {string}   [opt.pfad]      default: 'beispiel/Xbot.glb'
 * @returns {Promise<File>}
 */
export async function ladeBeispielDatei({ basisUrl, pfad = 'beispiel/Xbot.glb' } = {}) {
  const basis = basisUrl ?? (typeof document !== 'undefined' ? document.baseURI : undefined);
  const adresse = new URL(pfad, basis).href;
  let antwort;
  try {
    antwort = await fetch(adresse);
  } catch (err) {
    throw new Error(`Failed to fetch example model at ${adresse}: ${err.message}`);
  }
  if (!antwort.ok) {
    throw new Error(`Failed to load example model at ${adresse}: HTTP status ${antwort.status}`);
  }
  const puffer = await antwort.arrayBuffer();
  const name = adresse.slice(adresse.lastIndexOf('/') + 1);
  return new File([puffer], name, { type: 'model/gltf-binary' });
}