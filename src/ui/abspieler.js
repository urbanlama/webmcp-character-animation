// Der laufende Film unter der Bühne.
//
// Bis hierher ließ sich eine gelöste Bewegung nur als Bildstreifen ansehen —
// einzelne Panels, je Frame ein Standbild. Zum BEURTEILEN einer Animation
// braucht der Mensch sie laufend: hebt der Fuß sauber ab, ruckt die Schulter,
// steht die Landung? Diese Leiste spielt die gelöste Bewegung Frame für Frame
// auf das Modell in der Szene, in der Framerate der Timeline.
//
// Aufbau wie die übrigen UI-Module (kamerasteuerung.js als Vorlage): ein mount
// hängt an einen Container, arbeitet über übergaben Rückrufe und fasst die
// Szene nie direkt an. Die zwei Anschlüsse übergibt index.html:
//
//   holeBewegung()  -> { frames, fps, frameCount } — löst die aktuelle
//       Timeline über denselben Löser, den auch validate nutzt
//       (src/tools/ports.js, ports.solver.loese). Wirft, solange nichts
//       gelöst oder kein Modell geladen ist — die Leiste graut dann ein
//       und sagt mit einem Satz, was ihr fehlt.
//   stelleFrame(frame, index) — setzt eine gelöste Pose auf das Modell.
//       index.html benutzt dafür stellePose aus src/render/strip.js, das
//       genau dieses Verfahren bereits implementiert; hier wird nichts
//       nachgebaut.
//
// Zeitschritt: tick(dtSek) bekommt die verstrichenen Sekunden je Bild vom
// Renderlauf der Seite und schaltet Frames um, wenn genug Zeit angesammelt
// ist — in der Framerate der Timeline, nicht in der Bildrate des Browsers.
// Ein 90-Frames-Clip bei 30 fps und 1x dauert so 3 Sekunden, gleichgültig,
// ob die Leinwand mit 60 oder 144 Hz zeichnet.
//
// Solange die Leiste außer Betrieb ist, bleibt sie sichtbar: versteckte
// Steuerungen, die erst auftauchen, wenn etwas gelöst ist, erklären dem
// Menschen nicht, worauf er wartet. Der Grund steht als Satz daneben.

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE VERFAHRENSPARAMETER (keine Körpermaße — AGENTS.md, Regel 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Die drei Abspielgeschwindigkeiten des Auftrags. 1x heißt: Timeline-
 *  Framerate; 0.25x und 0.5x sind zum Zusehen in schnellen Phasen. */
export const GESCHWINDIGKEITEN = [0.25, 0.5, 1];

/** Größter Zeitschritt je tick()-Aufruf in Sekunden. Ein Hintergrund-Tab
 *  liefert nach der Rückkehr einen veralteten Zeitstempel; ohne Deckel
 *  springe der Clip dann schlagartig ans Ende. 1 s überspringt bei 30 fps
 *  30 Frames an einem Stück — genug für den Sprung nach vorn, zu klein,
 *  um einen Clip unbemerkt zu Ende zu spielen. */
export const TICK_MAX_SEK = 1;

function fehler(text) { throw new Error('Abspieler abgelehnt: ' + text); }

/**
 * Hängt die Abspielleiste an einen Container.
 *
 * @param {object} opt
 * @param {HTMLElement} opt.wurzel   Container unter der 3D-Ansicht, wird gefüllt
 * @param {() => {frames: object[], fps: number, frameCount: number}} opt.holeBewegung
 *        liefert die gelöste Bewegung; wirft, solange sie fehlt
 * @param {(frame: object, index: number) => void} opt.stelleFrame
 *        stellt einen gelösten Frame auf die Szene; wirft, wenn nichts da ist
 * @param {Document} [opt.dokument]  für Prüfungen in Node; Default: die Owner-
 *        Document des Containers
 * @returns {{tick: Function, pruefe: Function, umschalten: Function,
 *            anfahren: Function, setzeTempo: Function, aus: Function,
 *            stand: Function}}
 */
export function mounteAbspieler({ wurzel, holeBewegung, stelleFrame, dokument }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteAbspieler: 0 Container übergeben, erwartet 1 Element für die Leiste');
  }
  if (typeof holeBewegung !== 'function') {
    throw new Error('mounteAbspieler: 0 Bewegungslieferanten übergeben, erwartet 1 Funktion (holeBewegung)');
  }
  if (typeof stelleFrame !== 'function') {
    throw new Error('mounteAbspieler: 0 Frame-Steller übergeben, erwartet 1 Funktion (stelleFrame)');
  }
  const dok = dokument ?? wurzel.ownerDocument;

  // ── Bedienleiste ─────────────────────────────────────────────────────────
  const zeile = dok.createElement('div');
  zeile.className = 'abs-zeile';

  const knopf = dok.createElement('button');
  knopf.type = 'button';
  knopf.className = 'abs-knopf';
  knopf.textContent = 'Play';
  knopf.addEventListener('click', () => umschalten());

  const schieber = dok.createElement('input');
  schieber.type = 'range';
  schieber.className = 'abs-schieber';
  schieber.min = '0';
  schieber.max = '0';
  schieber.step = '1';
  schieber.value = '0';
  // 'input' feuert waehrend des Ziehens, nicht erst beim Loslassen: der Mensch
  // soll die Bewegung unter dem Finger sehen. Laeuft gerade das Abspielen,
  // wird es angehalten — sonst zieht der Mensch gegen die laufende Uhr.
  schieber.addEventListener('input', () => {
    if (laeuft) { laeuft = false; zeigeBereitschaft(); }
    anfahren(Number(schieber.value));
  });
  // Pfeiltasten und Bild-auf/ab bedient der Browser selbst ueber input; hier
  // nur der Griff selbst, damit ein Klick auf die Schiene auch trifft.
  schieber.addEventListener('change', () => anfahren(Number(schieber.value)));

  const anzeige = dok.createElement('span');
  anzeige.className = 'abs-frame messwert';

  const tempoGruppe = dok.createElement('span');
  tempoGruppe.className = 'abs-tempo';
  const tempoKnoepfe = [];
  for (const g of GESCHWINDIGKEITEN) {
    const b = dok.createElement('button');
    b.type = 'button';
    b.className = 'abs-tempo-knopf';
    b.textContent = `${g}x`;
    b.addEventListener('click', () => setzeTempo(g));
    tempoKnoepfe.push([g, b]);
    tempoGruppe.append(b);
  }

  // Der einzige Satz im Auszustand: was fehlt. Nicht versteckt, nicht laut.
  const grund = dok.createElement('p');
  grund.className = 'abs-grund';

  zeile.append(knopf, schieber, anzeige, tempoGruppe);
  wurzel.replaceChildren(zeile, grund);

  // ── Zustand ──────────────────────────────────────────────────────────────
  let bewegung = null;          // { frames, fps, frameCount }
  let bereit = false;
  let laeuft = false;
  let index = 0;                // 0-basiert, wie die gelösten Frames zählen
  let geschwindigkeit = 1;
  let akku = 0;                 // gesammelte Sekunden seit dem Frame-Wechsel
  let fehlgrund = '';

  function zeigeStand() {
    if (!bewegung) {
      anzeige.textContent = '';
      schieber.max = '0';
      schieber.value = '0';
      return;
    }
    // Das MAXIMUM muss mitwachsen. Es stand fest auf 0, seit die Leiste gebaut
    // wurde: der Griff klebte am linken Anschlag, liess sich nicht ziehen und
    // sprang bei jedem Versuch zurueck — waehrend die Anzeige daneben
    // "Frame 17 / 48" behauptete. Ein Regler ohne Spanne ist Zierde.
    const n = bewegung.frames.length;
    const max = Math.max(0, n - 1);
    if (schieber.max !== String(max)) schieber.max = String(max);
    if (index > max) index = max;
    anzeige.textContent = `Frame ${index + 1} / ${n}`;
    if (schieber.value !== String(index)) schieber.value = String(index);
  }

  function zeigeBereitschaft() {
    knopf.textContent = laeuft ? 'Pause' : 'Play';
    schieber.disabled = !bereit;
    knopf.disabled = !bereit;
    for (const [, b] of tempoKnoepfe) b.disabled = !bereit;
    wurzel.classList.toggle('abs-aus', !bereit);
    grund.hidden = bereit;
    grund.textContent = bereit ? '' : fehlgrund;
    for (const [g, b] of tempoKnoepfe) {
      b.classList.toggle('aktiv', bereit && g === geschwindigkeit);
    }
  }

  /**
   * Stellt den aktuellen Frame auf die Szene und stoppt bei Ablehnung —
   * die Leiste sagt dann mit dem Wortlaut der Ablehnung, warum nicht.
   * @returns {boolean} ob der Frame stand
   */
  function stelleAufSzene() {
    if (!bewegung) return false;
    try {
      stelleFrame(bewegung.frames[index], index);
      return true;
    } catch (err) {
      laeuft = false;
      bereit = false;
      fehlgrund = `Abspielen gestoppt bei Frame ${index}: ${err.message}`;
      zeigeStand();
      zeigeBereitschaft();
      return false;
    }
  }

  /**
   * Prüft neu, ob gespielt werden kann, und rüstet die Leiste dafür ein.
   * Fehlt die Bewegung, wird NICHT versteckt: die Leiste steht grau mit
   * einem Satz, was fehlt (Wortlaut der Ablehnung von holeBewegung).
   */
  function pruefe() {
    try {
      const b = holeBewegung();
      if (!b || typeof b !== 'object' || !Array.isArray(b.frames) || b.frames.length === 0) {
        fehler(`frames = ${b && Array.isArray(b.frames) ? 'leeres Array' : typeof (b && b.frames)}: `
          + `erwartet mindestens 1 gelöster Frame`);
      }
      if (!(Number.isFinite(b.fps) && b.fps > 0)) {
        fehler(`fps = ${JSON.stringify(b.fps)}: erwartet Framerate > 0, ohne sie ist `
          + `keine Abspielgeschwindigkeit rechenbar`);
      }
      bewegung = b;
      bereit = true;
      index = Math.min(index, b.frames.length - 1);
      akku = 0;
    } catch (err) {
      bewegung = null;
      bereit = false;
      fehlgrund = `Abspielen nicht möglich: ${err.message}`;
    }
    zeigeStand();
    zeigeBereitschaft();
    return bereit ? bewegung : null;
  }

  /**
   * Ein Zeitschritt des Renderlaufs. Schaltet Frames um, sobald genug Zeit
   * angesammelt hat, und stellt jeden geänderten Frame auf die Szene.
   * @param {number} dtSek  Sekunden seit dem letzten Bild
   * @returns {boolean} ob gespielt wird
   */
  function tick(dtSek) {
    if (!laeuft || !bewegung) return false;
    const dt = Number.isFinite(dtSek) ? Math.min(Math.max(dtSek, 0), TICK_MAX_SEK) : 0;
    akku += dt * geschwindigkeit;
    const frameDauer = 1 / bewegung.fps;
    let geaendert = false;
    while (akku >= frameDauer && index < bewegung.frameCount - 1) {
      akku -= frameDauer;
      index += 1;
      geaendert = true;
    }
    if (geaendert) stelleAufSzene();
    if (index >= bewegung.frameCount - 1) {
      laeuft = false;   // am Ende stehen bleiben, nicht in eine Schleife fallen
    }
    zeigeStand();
    zeigeBereitschaft();
    return laeuft;
  }

  /** Play/Pause: startet neu, wenn das Ende erreicht war. */
  function umschalten() {
    if (!bewegung || !bereit) return false;
    if (laeuft) {
      laeuft = false;
      zeigeBereitschaft();
      return false;
    }
    if (index >= bewegung.frameCount - 1) {
      index = 0;
      akku = 0;
    }
    laeuft = true;
    const stand = stelleAufSzene();
    zeigeBereitschaft();
    return stand;
  }

  /** Springt auf einen Frame. Pausiert — wer zieht, will vergleichen. */
  function anfahren(i) {
    if (!bewegung || !bereit) return false;
    if (!Number.isInteger(i) || i < 0 || i >= bewegung.frameCount) {
      fehler(`Frame ${JSON.stringify(i)} liegt außerhalb der Timeline von 0 bis `
        + `${bewegung.frameCount - 1}`);
    }
    laeuft = false;
    index = i;
    akku = 0;
    zeigeStand();
    zeigeBereitschaft();
    return stelleAufSzene();
  }

  /**
   * Abspielgeschwindigkeit setzen. 1x heißt Framerate der Timeline;
   * 0.25x und 0.5x sind zum Durchsehen schneller Phasen.
   * @returns {number} die gesetzte Geschwindigkeit
   */
  function setzeTempo(g) {
    if (!GESCHWINDIGKEITEN.includes(g)) {
      fehler(`geschwindigkeit = ${JSON.stringify(g)}: erlaubt sind nur die `
        + `${GESCHWINDIGKEITEN.length} Stufen ${GESCHWINDIGKEITEN.join('x, ')}x`);
    }
    geschwindigkeit = g;
    zeigeBereitschaft();
    return g;
  }

  /** Außer Betrieb — beim Entfernen des Modells. Die Leiste bleibt stehen. */
  function aus() {
    laeuft = false;
    bewegung = null;
    bereit = false;
    fehlgrund = '';
    index = 0;
    akku = 0;
    zeigeStand();
    zeigeBereitschaft();
  }

  // Beim Einhängen sofort den Wahrheitsstand zeigen — nicht erst, wenn
  // jemand auf Play drückt. Ohne Modell heißt das: grau mit Grund.
  pruefe();

  /** Für Tests und Diagnose. */
  function stand() {
    return {
      bereit,
      laeuft,
      index,
      frameCount: bewegung ? bewegung.frameCount : 0,
      fps: bewegung ? bewegung.fps : null,
      geschwindigkeit,
      grund: bereit ? '' : fehlgrund,
      frameText: anzeige.textContent,
    };
  }

  return { tick, pruefe, umschalten, anfahren, setzeTempo, aus, stand };
}