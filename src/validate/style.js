// AP6 — Stilprüfung. Prüft eine gelöste Animation (Timeline aus plan.md 5.2,
// Abschnitt "solved") gegen drei STILREGELN, unabhängig von der Bewegungsart
// (plan.md 6.6, "Stil"), und meldet Beanstandungen im ValidationReport-Format
// aus plan.md 5.3 (Block "style").
//
//   1. Bewegungsdichte — Anteil der Frames mit Veränderung über einer Schwelle
//   2. Antizipation    — Gegenbewegung vor der Hauptbewegung vorhanden
//   3. Ruckfreiheit    — keine Sprünge in der Beschleunigung
//
// Gelesen wird frame.positions — dasselbe Feld wie in src/validate/physics.js
// (Auftrag "Drei Nahtstellen", Punkt 2: ein gelöster Frame trägt seine
// Knochendaten unter einem Namen, nicht unter zwei).
//
// JEDER Befund nennt einen Ort, an dem der Mensch hinsehen kann: `frame` (die
// Frame-Zahl, in der er gilt) und `part` (worüber er spricht; für Befunde über
// den ganzen Körper das Wort KOERPER unten). Wo zusätzlich eine Strecke gemeint
// ist, stehen `frames` bzw. `von`/`bis` daneben. Die Zahl im Meldungstext ist
// Prosa, das Datenfeld ist die Wahrheit.
//
// Grundregel (AGENTS.md, Regel 1): kein Körpermaß im Code. Alle Schwellen sind
// Verfahrensparameter als BENANNTE PARAMETER unten, an EINER Stelle, mit
// Begründung und in Anteilen der Körperhöhe profile.world.height. Die
// Schwellen sind auf den VIER ENTWICKLUNGSCLIPS ausgemessen (idle, walk,
// agree, sad_pose) — nicht auf den Abnahmeclips run, headShake, sneak_pose
// (Auftrag AP6, kritisch).
//
// Ausnahmen sind erlaubt und müssen erklärt werden (plan.md 6.6): eine Phase,
// die sich als 'halt' (bewusster Stillstand, verb 'stand'/'settle') oder
// 'impact' (Aufprall) zu erkennen gibt, darf die Ruckprüfung verletzen, ohne
// beanstandet zu werden. Jede Ausnahme muss einen Grund nennen.

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// Schwelle je Parameter gemessen an den vier ENTWICKLUNGSCLIPS idle, walk,
// agree, sad_pose — NICHT an den Abnahmeclips (Auftrag AP6, kritisch).
// Zahlen ohne Bild sind unvollständig: die Begründungen nennen die gemessenen
// Werte je Entwicklungsclip (Sampling über THREE.AnimationMixer, 90 Stütz-
// stellen bzw. die native Framerate).
// ─────────────────────────────────────────────────────────────────────────────

/** Bewegungsschwelle als Anteil der Körperhöhe: ein Frame zählt als "in
 *  Bewegung", wenn sich mindestens ein Knochen zwischen diesem und dem
 *  vorigen Frame um mehr als dieser Anteil bewegt hat. Ausgemessen am
 *  Entwicklungsset (größte Einzelverschiebung je Frame, Anteil der
 *  Körperhöhe): idle bis 0,10 %, agree bis 0,91 %, walk bis 5,1 %,
 *  sad_pose bis 1,12 %. Der Wert 0,04 % (0,0004) liegt unter allen
 *  messbaren Bewegungen der Referenzclips und über dem Mikrozittern
 *  numerischen Rauschens (bis 0,006 % in idle). */
export const BEWEGUNG_SCHWELLE_ANTEIL = 0.0004;

/** Minimaler Anteil der Frames, die "in Bewegung" sein müssen. Gemessen am
 *  Entwicklungsset bei der Bewegungsschwelle oben: walk 100 %, agree 100 %,
 *  sad_pose 100 %, idle 81 %. Der Wert 0,25 (25 %) liegt weit unter dem
 *  Referenzminimum und fängt dennoch jede Timeline, in der kaum etwas
 *  passiert — genau die Lücke, die die Physikprüfung offen lässt
 *  (plan.md 3.2: "Fehlerfreiheit ist kein Erfolg"). */
export const DICHTE_MIN = 0.25;

/** Längster erlaubter zusammenhängender toter Block in Frames. Die Anzahl
 *  toter Frames allein trennt nicht: idle hat 22 verstreute tote Frames von
 *  75 (die Figur atmet in Blöcken, längster Block 3 Frames), der Negativfall
 *  aus der Abnahmetabelle hat 22 tote Frames als EINEN Block — dort steht
 *  die Figur über ein Drittel der Timeline vollständig still. Ausgemessen
 *  am Entwicklungsset, native Framerate: idle längster Block 3, die übrigen
 *  drei Clips 0. Der Wert 15 (0,5 s bei 30 fps) hat zum Referenzmaximum den
 *  Faktor 5 Abstand und lässt einen bewussten Kurz-Halt zu; ein lange
 *  bewegungslose Folge wird über die Ausnahme 'halt' erklärt oder meldet. */
export const TOTE_FRAMES_BLOCK_MAX = 15;

/** Ruckgrenze als Verhältnis der Verschiebung eines Knochens in einem Frame
 *  zu seinem lokalen Median derselben Verschiebung im Fenster ±5 Frames.
 *  Der Median macht die Prüfung unabhängig von Tempo, Framerate und
 *  Bewegungsgröße; ein echter Positions-Sprung ist ein Vielfaches seiner
 *  Nachbarn. Ausgemessen am Entwicklungsset (größtes Verhältnis je Clip,
 *  native Framerate): idle 0,2, agree 1,0, sad_pose 1,0, walk 2,6
 *  (Fersenauftritt am Clip-Ende). Der Wert 8,0 hat zum schlimmsten
 *  Referenzwert den Faktor 3 Abstand und liegt weit unter einem echten
 *  Sprung (Faktor 100 und mehr). */
export const RUCK_VERHAELTNIS_MAX = 8.0;

/** Untergrenze des lokalen Medians als Anteil der Körperhöhe: in einem
 *  ruhigen Stand ist die Nachbar-Verschiebung fast null, das Verhältnis
 *  würde jede Mikrobewegung zur Explosion bringen. Der Median wird auf
 *  diesen Anteil angehoben. 1 % der Körperhöhe: Bewegungen darunter sind
 *  unter der Sichtbarkeitsgrenze, sie begründen keinen Sprung-Befund. */
export const RUCK_MEDIAN_MIN_ANTEIL = 0.01;

/** Antizipationsschwelle: ein Anteil der Körperhöhe, um den sich ein
 *  Körperteil vor der Hauptbewegung GEGEN deren Richtung bewegt haben muss,
 *  damit eine Antizipation als vorhanden gilt. Ausgemessen an walk und
 *  agree: die Vorbewegung liegt in der Größenordnung einiger Prozent der
 *  Körperhöhe. Der Wert 1 % trennt echte Gegenbewegung von Rauschen
 *  (Mikrozittern bis 0,1 %, siehe BEWEGUNG_SCHWELLE_ANTEIL). */
export const ANTIZIPATION_MIN_ANTEIL = 0.01;

/** Zeitfenster vor dem Beginn der Hauptbewegung, in dem die Antizipation
 *  liegen muss, in Sekunden. 0,5 s: bei 30 fps 15 Frames, genug für eine
 *  erkennbare Gegenbewegung und eng genug, um zur Hauptbewegung zu gehören. */
export const ANTIZIPATION_FENSTER_SEK = 0.5;

/** Fenster der Ruckprüfung in Frames je Seite: der lokale Median der
 *  Verschiebung wird über diese Nachbarframes gebildet. ±5 Frames: weit
 *  genug, um den Normalwert einer Bewegung zu treffen, eng genug, um
 *  langsame Drift nicht als neue Basis zu übernehmen. */
export const RUCK_FENSTER_FRAMES = 5;

/** Höchste Anzahl toter Frames, die eine einzelne Meldung der
 *  Bewegungsdichte-Prüfung im `frames`-Feld auflistet. 20 Frames reichen,
 *  dass der Agent das Muster erkennt (Anfang der Timeline); die vollständige
 *  Liste steht in der Zählung der Meldung (Anzahl, längster Block). */
export const BEANSTANDETE_FRAMES_MAX = 20;

/** Der Geltungsbereich "ganzer Körper" für Befunde, die keinem einzelnen
 *  Knochen gehören: Bewegungsdichte und Antizipation sagen etwas über die
 *  Timeline als Ganzes. Der Bezeichner ist ein Wort, kein gemessener Punkt —
 *  er beschreibt, worüber der Befund spricht, und steht überall gleich, damit
 *  sich nicht jede Prüfschicht einen eigenen Sammelbegriff ausdenkt.
 *  (Festlegung aus dem Auftrag "Drei Nahtstellen", Punkt 3.) */
export const KOERPER = 'koerper';

// ─────────────────────────────────────────────────────────────────────────────
// Eingabevertrag
// ─────────────────────────────────────────────────────────────────────────────

function fehler(text) { throw new Error('Stilprüfung abgelehnt: ' + text); }

function punktVon(frame, part) {
  if (part === 'com') return frame.com ?? null;
  return frame.positions?.[part] ?? null;
}

function pruefeEingaben(profile, frames, fps) {
  const h = profile?.world?.height;
  if (!Number.isFinite(h) || h <= 0) {
    fehler(`world.height = ${JSON.stringify(h)}: erwartet Zahl > 0, alle Stilschwellen sind Anteile der Körperhöhe`);
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    fehler(`frames = ${Array.isArray(frames) ? 'leeres Array' : typeof frames}: erwartet nicht-leeres Array mit einem Eintrag je Frame`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    fehler(`fps = ${JSON.stringify(fps)}: erwartet Zahl > 0, Ruck- und Antizipationsmessung brauchen die Framerate`);
  }
  frames.forEach((f, i) => {
    if (!f || typeof f !== 'object') fehler(`frames[${i}] = ${JSON.stringify(f)}: erwartet Objekt`);
    if (!f.positions || typeof f.positions !== 'object') {
      fehler(`frames[${i}].positions fehlt: erwartet { Knochen-id: [x,y,z] } in Metern — dasselbe Feld wie in src/validate/physics.js (BRETT.md, Eintrag AP5)`);
    }
  });
}

function median(arr) {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── 1. Bewegungsdichte ───────────────────────────────────────────────────────

/**
 * Bewegt sich zwischen zwei Frames mindestens ein Knochen mehr als die
 * Schwelle?  Rückgabe: { toteFrames (Array der Frame-Indizes), dichte }.
 */
function messeBewegungsdichte(frames, schwelleM) {
  const toteFrames = [];
  for (let i = 1; i < frames.length; i++) {
    let maxVerschiebung = 0;
    const prev = frames[i - 1].positions, curr = frames[i].positions;
    for (const boneName in curr) {
      const a = prev[boneName], b = curr[boneName];
      if (!a) continue;
      const d = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
      if (d > maxVerschiebung) maxVerschiebung = d;
    }
    if (maxVerschiebung <= schwelleM) toteFrames.push(i);
  }
  const verglichene = frames.length - 1;
  const dichte = verglichene ? (verglichene - toteFrames.length) / verglichene : 0;
  return { dichte, toteFrames };
}

// ── 2. Antizipation ──────────────────────────────────────────────────────────

/**
 * Antizipation: hat sich das benannte Körperteil im Zeitfenster VOR der
 * Hauptbewegung ENTMEGEN der angegebenen Richtung bewegt?
 * hauptbewegung: { part, abFrame, richtung: [x,y,z] }.
 * Rückgabe: { gefunden, betragAnteil, von, bis } — größte Gegenbewegung im
 * Fenster in Anteilen der Körperhöhe, dazu der durchsuchte Frame-Bereich
 * (Antizipation hat keinen einzelnen Frame, aber einen Bereich).
 */
function messeAntizipation(frames, hauptbewegung, fps, hoehe, minAnteil, fensterSek) {
  const part = hauptbewegung.part;
  const ab = hauptbewegung.abFrame;
  if (!part || typeof part !== 'string') {
    fehler(`hauptbewegung.part = ${JSON.stringify(part)}: erwartet Knochen-Id für die Antizipationsprüfung`);
  }
  if (!Number.isInteger(ab) || ab < 1 || ab >= frames.length) {
    fehler(`hauptbewegung.abFrame = ${JSON.stringify(ab)}: erwartet ganzzahliger Frame im Bereich 1 bis ${frames.length - 1}`);
  }
  if (!Array.isArray(hauptbewegung.richtung) || hauptbewegung.richtung.length !== 3
      || !hauptbewegung.richtung.every(Number.isFinite)) {
    fehler(`hauptbewegung.richtung = ${JSON.stringify(hauptbewegung.richtung)}: erwartet [x, y, z]`);
  }
  const r = hauptbewegung.richtung;
  const n = Math.hypot(r[0], r[1], r[2]);
  if (!(n > 0)) {
    fehler(`hauptbewegung.richtung = [${r}]: erwartet Vektor ungleich (0,0,0), Länge ${n}`);
  }
  const rN = [r[0] / n, r[1] / n, r[2] / n];

  const fensterFrames = Math.max(1, Math.round(fensterSek * fps));
  const von = Math.max(1, ab - fensterFrames);
  // Der Bereich, in dem die Gegenbewegung liegen musste: vom Fensteranfang bis
  // zum Beginn der Hauptbewegung. Die Verschiebungen selbst werden von Frame
  // (von-1) nach Frame (ab-1) gerechnet, von >= 1 hält den Anfang bei >= 0.
  const bereich = { von: von - 1, bis: ab };

  let maxGegen = 0;   // größte Gegenbewegung im Fenster, in Metern
  for (let i = von; i < ab; i++) {
    const p0 = punktVon(frames[i - 1], part), p1 = punktVon(frames[i], part);
    if (!p0 || !p1) {
      fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${i} oder ${i - 1} der Timeline`);
    }
    // Projektion der Frame-Verschiebung auf die Hauptrichtung; negativ heißt
    // Gegenbewegung.
    const proj = (p1[0]-p0[0]) * rN[0] + (p1[1]-p0[1]) * rN[1] + (p1[2]-p0[2]) * rN[2];
    if (-proj > maxGegen) maxGegen = -proj;
  }
  return {
    gefunden: maxGegen / hoehe >= minAnteil,
    betragAnteil: maxGegen / hoehe,
    ...bereich,
  };
}

// ── 3. Ruckfreiheit ──────────────────────────────────────────────────────────

/**
 * Ruckprüfung: Verschiebung jedes Knochens in einem Frame gegen den lokalen
 * Median derselben Verschiebung im Fenster ±RUCK_FENSTER_FRAMES. Ein
 * Positionssprung ist ein Vielfaches seiner Nachbarschaft — das Verhältnis
 * zeigt ihn ohne jede Kalibrierung auf das Tempo an.
 *
 * Ausnahmen (plan.md 6.6): Frames in einer als 'halt' oder 'impact' erklärten
 * Phase (Array von { von, bis, art }) werden nicht geprüft.
 *
 * Rückgabe: { maxVerhaeltnis, verletzungen: [{ frame, bone, wert }] }.
 */
function messeRuck(frames, hoehe, grenze, medianMin, fenster, ausnahmen) {
  // Verschiebung je Knochen und Frame (Index t entspricht Frame t+1).
  const disp = [];
  for (let t = 1; t < frames.length; t++) {
    const m = new Map();
    for (const boneName in frames[t].positions) {
      const a = frames[t-1].positions[boneName], b = frames[t].positions[boneName];
      if (!a || !b) continue;
      m.set(boneName, Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]));
    }
    disp.push({ t, m });
  }
  const istAusnahme = (t) => (ausnahmen ?? []).some((a) =>
    (a.art === 'halt' || a.art === 'impact') && t >= a.von && t <= a.bis);

  const verletzungen = [];
  let maxVerhaeltnis = 0;
  for (let idx = 0; idx < disp.length; idx++) {
    const { t, m } = disp[idx];
    if (istAusnahme(t)) continue;
    for (const [boneName, d] of m) {
      const nachbar = [];
      for (let u = Math.max(0, idx - fenster); u <= Math.min(disp.length - 1, idx + fenster); u++) {
        const x = disp[u].m.get(boneName);
        if (x !== undefined) nachbar.push(x);
      }
      const med = Math.max(median(nachbar), medianMin * hoehe);
      const verhaeltnis = d / med;
      if (verhaeltnis > maxVerhaeltnis) maxVerhaeltnis = verhaeltnis;
      if (verhaeltnis > grenze) {
        verletzungen.push({ frame: t, bone: boneName, wert: verhaeltnis,
          verschiebungM: d, medianM: med });
      }
    }
  }
  return { maxVerhaeltnis, verletzungen };
}

// ── Öffentliche Funktion ─────────────────────────────────────────────────────

/**
 * pruefeStil(profile, frames, fps, options) -> { passed, issues, ausgelassen }
 *
 * profile: RigProfile gemäß plan.md 5.1 (world.height Referenz aller Schwellen)
 * frames:  gelöste Frames aus plan.md 5.2 —
 *          [{ positions: { Knochen-id: [x,y,z] in Metern, Weltkoordinaten } }]
 *          Dasselbe Feld wie in src/validate/physics.js: ein gelöster Frame
 *          trägt seine Knochendaten in `positions` (BRETT.md, Eintrag AP5).
 * fps:     Framerate der Timeline in Hz (timeline.fps)
 * options: {
 *   hauptbewegung: { part, abFrame, richtung }  — für die Antizipationsprüfung;
 *       fehlt sie, wird die Antizipationsprüfung übersprungen (steht dann in
 *       'ausgelassen'): Antizipation braucht die benannte Hauptbewegung.
 *   ausnahmen: [{ von, bis, art: 'halt'|'impact', grund: string }]
 *       Frames, die als bewusster Halt oder Aufprall gelten. Jede Ausnahme
 *       MUSS einen Grund nennen (plan.md 6.6: Ausnahmen sind erlaubt und
 *       müssen erklärt werden), sonst wird sie abgelehnt.
 * }
 */
export function pruefeStil(profile, frames, fps, options = {}) {
  // Ausnahmen zuerst: jede braucht einen Grund.
  for (const a of options.ausnahmen ?? []) {
    if (!a || typeof a !== 'object' || typeof a.grund !== 'string' || a.grund.trim() === '') {
      fehler(`Stil-Ausnahme ${JSON.stringify(a)} ohne grund — Ausnahmen müssen erklärt werden (plan.md 6.6)`);
    }
    if (a.art !== 'halt' && a.art !== 'impact') {
      fehler(`Stil-Ausnahme mit art = ${JSON.stringify(a.art)}: erwartet 'halt' oder 'impact'`);
    }
    if (!Number.isInteger(a.von) || !Number.isInteger(a.bis) || a.von > a.bis) {
      fehler(`Stil-Ausnahme mit von = ${JSON.stringify(a.von)}, bis = ${JSON.stringify(a.bis)}: erwartet ganzzahliger Frame-Bereich von <= bis`);
    }
  }

  pruefeEingaben(profile, frames, fps);

  const height = profile.world.height;
  const issues = [];
  const ausgelassen = [];

  // ── 1. Bewegungsdichte ────────────────────────────────────────────────────
  const schwelleM = BEWEGUNG_SCHWELLE_ANTEIL * height;
  const { dichte, toteFrames } = messeBewegungsdichte(frames, schwelleM);

  // Frames in einer erklärten 'halt'-Phase zählen nicht als tote Frames.
  const haltFrames = new Set();
  for (const a of options.ausnahmen ?? []) {
    if (a.art === 'halt') {
      for (let i = a.von; i <= a.bis; i++) haltFrames.add(i);
    }
  }
  const toteOhneHalt = toteFrames.filter((f) => !haltFrames.has(f));
  const toteOhneHaltSet = new Set(toteOhneHalt);
  const verglichene = frames.length - 1;
  const dichteBereinigt = verglichene ? (verglichene - toteOhneHalt.length) / verglichene : 0;

  // Längster zusammengehöriger toter Block (ohne Halt-Ausnahmen) — samt seinem
  // Anfang. Der Anfang ist der Ort, an den ein Mensch scrollt: der erste Frame,
  // in dem nichts mehr passiert.
  let laengsterBlock = 0, jetzigerBlock = 0;
  let blockAnfang = 0, laengsterBlockAnfang = 0;
  for (let i = 1; i < frames.length; i++) {
    if (toteOhneHaltSet.has(i)) {
      if (jetzigerBlock === 0) blockAnfang = i;
      jetzigerBlock++;
      if (jetzigerBlock > laengsterBlock) {
        laengsterBlock = jetzigerBlock;
        laengsterBlockAnfang = blockAnfang;
      }
    } else {
      jetzigerBlock = 0;
    }
  }
  // Befundort: der erste Frame des längsten bewegungslosen Blocks. Es gibt
  // genau einen Fall ohne jeden toten Block: eine Timeline aus 1 Frame hat 0
  // Vergleiche, die Dichte ist per Definition 0. Dann ist der längste
  // bewegungslose Block die Timeline selbst — Frame 0, gemessen, nicht geraten.
  const dichteFrame = laengsterBlock > 0 ? laengsterBlockAnfang : 0;

  if (dichteBereinigt < DICHTE_MIN || laengsterBlock > TOTE_FRAMES_BLOCK_MAX) {
    issues.push({
      kind: 'bewegungsdichte',
      frame: dichteFrame,
      part: KOERPER,
      value: +dichteBereinigt.toFixed(3),
      threshold: DICHTE_MIN,
      unit: 'anteil',
      message: `nur ${deutsch(dichteBereinigt * 100, 0)} % der Frames zwischen Frame 0 und ${frames.length - 1} enthalten Bewegung über der Schwelle von ${deutsch(BEWEGUNG_SCHWELLE_ANTEIL * 100, 1)} % der Körperhöhe, erwartet mindestens ${deutsch(DICHTE_MIN * 100, 0)} % und ein toter Block von höchstens ${TOTE_FRAMES_BLOCK_MAX} Frames (gemessen: ${toteOhneHalt.length} tote Frames, längster Block ${laengsterBlock} Frames ab Frame ${dichteFrame}, ${haltFrames.size} davon als Halt ausgenommen)`,
      // Ort: der einzelne Frame zum Hinsehen (frame) plus die toten Frames
      // selbst und der Bereich, in dem sie gemessen wurden.
      frames: toteOhneHalt.slice(0, BEANSTANDETE_FRAMES_MAX),
      von: 0,
      bis: frames.length - 1,
    });
  }

  // ── 2. Antizipation ───────────────────────────────────────────────────────
  if (options.hauptbewegung) {
    const ant = messeAntizipation(frames, options.hauptbewegung, fps, height,
      ANTIZIPATION_MIN_ANTEIL, ANTIZIPATION_FENSTER_SEK);
    if (!ant.gefunden) {
      issues.push({
        kind: 'antizipation',
        // Befundort: der Frame der HAUPTBEWEGUNG, vor dem die Gegenbewegung
        // fehlt. Die Prüfung kennt ihn — ohne ihn könnte sie das Fenster davor
        // nicht untersuchen. Der Geltungsbereich ist der ganze Körper, nicht
        // der geprüfte Knochen; der steht im Meldungstext.
        frame: options.hauptbewegung.abFrame,
        part: KOERPER,
        value: +ant.betragAnteil.toFixed(3),
        threshold: ANTIZIPATION_MIN_ANTEIL,
        unit: 'koerperhoehen',
        message: `keine Gegenbewegung von ${options.hauptbewegung.part} vor Frame ${options.hauptbewegung.abFrame}: die größte Gegenbewegung im ${ANTIZIPATION_FENSTER_SEK} Sekunden Fenster (Frame ${ant.von} bis ${ant.bis}) beträgt ${deutsch(ant.betragAnteil * 100, 1)} % der Körperhöhe, erwartet mindestens ${deutsch(ANTIZIPATION_MIN_ANTEIL * 100, 0)} %`,
        // Zusätzlich der gemessene Bereich: das Fenster, in dem die
        // Gegenbewegung liegen musste, bis zum Frame der Hauptbewegung.
        von: ant.von,
        bis: ant.bis,
      });
    }
  } else {
    ausgelassen.push('antizipation');
  }

  // ── 3. Ruckfreiheit ───────────────────────────────────────────────────────
  const ruck = messeRuck(frames, height, RUCK_VERHAELTNIS_MAX,
    RUCK_MEDIAN_MIN_ANTEIL, RUCK_FENSTER_FRAMES, options.ausnahmen);
  // Meldung: nur der stärkste Sprung je Frame, mit Betrag und Ort.
  const schlimmsteProFrame = new Map();
  for (const v of ruck.verletzungen) {
    const alt = schlimmsteProFrame.get(v.frame);
    if (!alt || v.wert > alt.wert) schlimmsteProFrame.set(v.frame, v);
  }
  for (const v of [...schlimmsteProFrame.values()].sort((x, y) => x.frame - y.frame)) {
    issues.push({
      kind: 'ruck',
      // Punktbefund: Der Sprung geschieht in EINEM Frame an EINEM Knochen. Die
      // Frame-Zahl stand früher nur im Meldungstext und gehört ins Datenfeld —
      // der Vertrag aus src/contracts/validation-report.js verlangt sie dort.
      frame: v.frame,
      value: +v.wert.toFixed(1),
      threshold: RUCK_VERHAELTNIS_MAX,
      unit: 'verhaeltnis',
      part: v.bone,
      message: `${v.bone} verschiebt sich bei Frame ${v.frame} um ${deutsch(v.verschiebungM * 100, 1)} cm, das ${deutsch(v.wert, 1)}-fache seines Umfeldes (Median ${deutsch(v.medianM * 100, 2)} cm) — ein Sprung ohne erklärten Halt oder Aufprall`,
    });
  }

  return { passed: issues.length === 0, issues, ausgelassen };
}

function deutsch(x, nach = 2) {
  return x.toFixed(nach).replace('.', ',');
}

export default pruefeStil;