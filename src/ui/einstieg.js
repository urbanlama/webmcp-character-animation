// Erstsicht für den Juror (docs/plan.md 6.1, Erstsicht).
//
// Befund aus dem Live-Abzug: Die Seite zeigt nur eine Datei-Auswahl, den Text
// „Kein Modell geladen" und eine leere dunkle Leinwand. Der Juror weiß nicht,
// was die Seite ist, dass er eine GLB hineinladen soll, woher er eine nimmt —
// und „Execution" ist ein Viertel der Bewertung. Diese drei Lücken schließt
// das Modul:
//
//   1. Ein Satz über der Leinwand, was das ist und wozu. Grundlage: README.md
//      und VISION.md — kein Marketing.
//   2. Ein Beispiel-Knopf „Load example robot". Er geht über denselben Weg wie
//      die Datei-Auswahl: er liest die Datei per fetch() als ArrayBuffer und
//      ruft genau den einen Ladepfad der Seite auf (loadFile). Kein zweiter
//      Ladeweg — zwei Wege bedeuten zwei Stellen, an denen sie auseinander-
//      laufen können.
//   3. Die rechte Spalte, die sonst leer steht, zeigt die drei Schritte, die
//      der Juror gehen soll. Ruhig, kein Zierrat.
//
// Kein Framework, kein Build-Schritt: die Seite bleibt eine statische Datei.

/**
 * Baut die Erstsicht in die Seite ein.
 *
 * @param {object}     opt
 * @param {HTMLElement}    opt.wurzel   Container über der Bühne, wird gefüllt
 * @param {HTMLElement}    opt.spalte   Container der rechten Leerspalte
 * @param {() => Promise<File>} opt.dateiLaden  liefert die Beispiel-Datei als
 *      File-Objekt; die übergibt index.html an denselben Ladepfad wie die
 *      Datei-Auswahl. Fehlschlag wirft — die Seite zeigt ihn im Fehlerfeld.
 * @param {string}     [opt.basisUrl]  Basis für den relativen Modellpfad;
 *      Default: document.baseURI (unter …/webmcp/ gilt das Beispielverzeichnis
 *      relativ zur Seite, nicht ab Wurzel)
 * @returns {{setzeGemessen: Function}} setzeGemessen(text) ergänzt unten eine
 *      Zeile mit dem Messergebnis; sie wird nach dem Vermessen aufgerufen
 */
export function mounteEinstieg({ wurzel, spalte, dateiLaden, basisUrl }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteEinstieg: 0 Container übergeben, erwartet 1 Element für die Erstsicht');
  }
  const dok = wurzel.ownerDocument;
  if (!spalte || !spalte.ownerDocument) {
    throw new Error('mounteEinstieg: 0 Spalten-Container übergeben, erwartet 1 Element');
  }
  if (typeof dateiLaden !== 'function') {
    throw new Error('mounteEinstieg: 0 Dateilieferant übergeben, erwartet 1 Funktion');
  }

  // --- der Satz über der Leinwand -------------------------------------------
  const kopf = dok.createElement('h1');
  kopf.id = 'einstieg-titel';
  // Die These der Seite, nicht ihr Funktionsumfang: der Titel steht groß über
  // der leeren Bühne und hat genau einen Satz Zeit, den Grund zu nennen.
  kopf.textContent = 'Your agent animates blind. This page gives it eyes.';
  const unterzeile = dok.createElement('p');
  unterzeile.id = 'einstieg-satz';
  unterzeile.textContent =
    'Load any rigged character. The page measures it — body height, ground contact, '
    + 'joint axes — and hands an AI agent those numbers plus a rendered frame after '
    + 'every step, so it can see what it just did instead of guessing.';

  const knopf = dok.createElement('button');
  knopf.id = 'einstieg-beispiel';
  knopf.type = 'button';
  knopf.textContent = 'Load example robot';

  const messZeile = dok.createElement('p');
  messZeile.id = 'einstieg-messung';
  messZeile.hidden = true;

  wurzel.replaceChildren(kopf, unterzeile, knopf, messZeile);

  // --- die drei Schritte in der rechten Leerspalte --------------------------
  // Was hier steht, muss stimmen.
  //
  // Schritt 1 lautete "Load a character — press the button". Das Modell laedt
  // inzwischen von selbst, es gibt nichts zu druecken, und der Satz schickte
  // den Menschen zu einem Knopf, der nichts mehr tut. Uebrig bleiben die zwei
  // Dinge, die wirklich anstehen: den Agenten verbinden und ihm sagen, was er
  // bauen soll.
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

  function setzeGemessen(text) {
    messZeile.textContent = text;
    messZeile.hidden = false;
  }

  // Fehler des Beispiel-Ladens dürfen nicht als unbehandelte Zurückweisung
  // versanden: index.html zeigt sie im Fehlerfeld, wenn sie dort ankommen.
  // In Node (und überall sonst) werden sie über window.onerror sichtbar.
  function meldeKlickFehler(err) {
    const meldung = `Beispielmodell konnte nicht geladen werden: ${err.message}`;
    const ereignis = new Error(meldung);
    if (typeof window?.dispatchEvent === 'function') {
      window.dispatchEvent(new window.ErrorEvent('error', { error: ereignis, message: meldung }));
    }
  }

  async function klick() {
    // fetch() des Beispielmodells — der Pfad ist relativ zum Dokument, der
    // Server liefert den Content-Type model/gltf-binary.
    try {
      const datei = await dateiLaden();
      // loadFile() nimmt dieselbe Datei auf die gleiche Art an wie das
      // <input type="file">: als File-Objekt mit .name und .arrayBuffer().
      await window.__ladeDatei(datei);
    } catch (err) {
      meldeKlickFehler(err);
    }
  }
  knopf.addEventListener('click', klick);

  return { setzeGemessen };
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