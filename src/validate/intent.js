// AP6 — Absichtsprüfung. Prüft eine gelöste Animation (Solved-Timeline aus
// plan.md 5.2, Abschnitt "solved") gegen die VOR DEM BAUEN festgelegten
// Erfolgskriterien des Agenten, im ValidationReport-Format aus plan.md 5.3
// (Block "intent": { passed, checks: [{ name, required, measured, unit, passed }] }).
//
// Die Physikprüfung (src/validate/physics.js) sagt, ob eine Bewegung erlaubt
// ist; sie sagt nicht, ob überhaupt etwas passiert. Eine bewegungslose Timeline
// besteht jede Physikprüfung (plan.md 3.2, "Fehlerfreiheit ist kein Erfolg").
// Genau diese Lücke schließt diese Datei.
//
// Grundregel (AGENTS.md, Regel 1): Kein Körpermaß im Code. Die Prüfgrundlage ist
// das RIGPROFILE; die sieben Bausteine aus plan.md 6.6 arbeiten in Anteilen der
// gemessenen Körperhöhe profile.world.height.
// Die einzigen getippten Zahlen sind die BENANNTEN PARAMETER unten —
// Verfahrensparameter, an EINER Stelle, mit Begründung.

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Mindestdauer einer Bewegungsänderung in Sekunden, ab der sie als
 *  eigenständige Bewegung zählt. 1/6 s == 5 Frames bei 30 fps: 4 Frames
 *  Rauschen dulden die Referenzclips (ausgemessen), eine echte Bewegung
 *  dauert deutlich länger. */
export const MIN_BEWEGUNG_SEK = 1 / 6;

/** Winkelgenauigkeit in Grad, ab der eine geforderte Drehung als erreicht
 *  gilt. Ein Salto auf 350 Grad verlangt ist auf 10 Grad getroffen — Sicht-
 *  grenze am Bildstreifen, keine Bewegungsmessung. */
export const WINKEL_TOLERANZ_GRAD = 10;

/** Kontaktschwelle der Kontaktwechsel-Messung, falls das RigProfile keine
 *  eigene Schwelle (params.soleTolerance) mitbringt. Derselbe dokumentierte
 *  Wert wie in physics.js (KONTAKT_SCHWELLE_ANTEIL, plan.md Kap. 4: 3,5 %
 *  Körperhöhe, muss Modelle auf dem Ballen erfassen); hier wiederholt, weil
 *  diese Datei physics.js nicht importiert und der Prüfstand den Fallback
 *  sonst als verstecktes Literal zeigt. */
export const KONTAKT_SCHWELLE_FALLBACK_ANTEIL = 0.035;

// ─────────────────────────────────────────────────────────────────────────────
// Die sieben Bausteine (plan.md 6.6, "Absicht")
//
// Die Bezeichner sind die des WERKZEUGKATALOGS (INTENT_ARTEN in
// src/tools/catalog.js) — der Agent sieht genau diese Namen und kein zweites
// Vokabular darf entstehen. plan.md 6.6 nennt die Bausteine sachlich auf
// Deutsch; das ist Beschreibung, keine Namensvorgabe. Meldungen bleiben deutsch.
//
//   rotation        Drehung um eine Achse über einen Frame-Bereich     (Grad)
//   airtime         Flugphase                                (Sekunden, Scheitelhöhe Anteil Körperhöhe)
//   travel          Ortsveränderung                          (Körperhöhen, Richtung)
//   contact_change  Kontaktwechsel                           (welcher Fuß, welcher Frame)
//   clearance       Abstand zweier Körperteile               (Anteil Körperhöhe, Mindestdauer s)
//   part_height     Höhe eines Körperteils                   (Anteil Körperhöhe)
//   part_speed      Tempo eines Körperteils                  (Körperhöhen pro Sekunde)
//
// Jedes Kriterium wird beim Agenten folgendermaßen angegeben (set_intent,
// plan.md 5.5, Nummer 6):
//
//   { kind: 'rotation',       part, axis, from, to, minDeg, maxDeg? }
//   { kind: 'airtime',        minSek, maxSek?, minScheitel, maxScheitel? }
//       minScheitel/maxScheitel: Anteile der Körperhöhe
//   { kind: 'travel',         part, minHoehe, maxHoehe?, richtung: [x,y,z] }
//       minHoehe/maxHoehe in Körperhöhen, richtung: Einheitsvektor
//   { kind: 'contact_change', foot: 'foot_l'|'foot_r', von, bis }
//       erwartet: von und bis sind kontaktfrei, davor/danach Kontakt
//   { kind: 'clearance',      partA, partB, minAnteil, maxAnteil?, minDauerSek? }
//       Anteil der Körperhöhe, minDauerSek in Sekunden
//   { kind: 'part_height',    part, minAnteil, maxAnteil? }
//       Anteil an der Körperhöhe (gemessen über der Sohle/des Bodens)
//   { kind: 'part_speed',     part, minHoeheProSek, maxHoeheProSek?, from?, to? }
//       Körperhöhen pro Sekunde, ggf. in einem Frame-Bereich
//
// part ist eine KNOCHEN-ID aus dem gelösten Timeline-Objekt
// (frame.positions, dasselbe Feld wie in src/validate/physics.js),
// nicht eine Rolle: die Absicht sagt "die rechte Hand", der Knochenname steht
// im geladenen Profil. Für clearance/part_height/part_speed ist part auch
// 'com' (Schwerpunkt).
//
// Die deutschen Namen der ersten Bauversion gibt es nicht mehr. Ein Kriterium,
// das einen von ihnen trägt, wird abgelehnt und nicht still zurückübersetzt:
// zwei Namen für dieselbe Sache sind genau die Nahtstelle, die diesen Durchlauf
// blockiert hat. Die Ablehnung nennt alle sieben Namen des Katalogs.
// ─────────────────────────────────────────────────────────────────────────────

/** Die sieben Bausteine in Katalogreihenfolge (INTENT_ARTEN, src/tools/catalog.js). */
export const BAUSTEINE = ['rotation', 'airtime', 'travel', 'contact_change',
  'clearance', 'part_height', 'part_speed'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function betrag(v) { return Math.hypot(v[0], v[1], v[2]); }

function fehler(text) { throw new Error('Absichtsprüfung abgelehnt: ' + text); }

/** Ein Punkt eines Tracks in einem Frame: part='com' → frame.com,
 *  sonst frame.positions[part]. null, wenn der Punkt nicht existiert. */
function punktVon(frame, part) {
  if (part === 'com') return frame.com ?? null;
  return frame.positions?.[part] ?? null;
}

/** Mindestwert eines Kriteriums erfüllt? */
function genuegt(ist, min, max) {
  if (min !== undefined && !(ist >= min)) return false;
  if (max !== undefined && !(ist <= max)) return false;
  return true;
}

/** Format eines Checks für den ValidationReport (plan.md 5.3, Block "intent"). */
function check(name, required, gemessen, unit, passed, message) {
  const out = { name, required, measured: gemessen, unit, passed };
  if (message) out.message = message;
  return out;
}

function zahl(x, nach = 2) {
  return Number(x.toFixed(nach));
}

/** Zahl in der deutschen Form, für Meldungen: 12,3 statt 12.3. Verändert nur
 *  den Dezimaltrenner, nicht die Ziffernfolge (soll.replace(/[<>=.]/g, '')
 *  bei "0.2..1.5" würde "02" erzeugen — deshalb hier ausgeschrieben). */
function deutsch(x, nach = 2) {
  return x.toFixed(nach).replace('.', ',');
}

function sollText(min, max, einheit) {
  if (min !== undefined && max !== undefined) return `${min}..${max} ${einheit}`;
  if (min !== undefined) return `>=${min} ${einheit}`;
  return `<=${max} ${einheit}`;
}

// ── Eingabeprüfung ───────────────────────────────────────────────────────────

function pruefeEingaben(profile, timeline, intent) {
  if (!profile || typeof profile !== 'object') fehler('RigProfile fehlt (null übergeben)');
  const h = profile.world?.height;
  if (!Number.isFinite(h) || h <= 0) {
    fehler(`world.height = ${JSON.stringify(h)}: erwartet Zahl > 0, alle Absichtsgrößen sind Anteile der Körperhöhe`);
  }
  if (!timeline || typeof timeline !== 'object') {
    fehler('Timeline fehlt (null übergeben)');
  }
  const frames = timeline.solved?.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    const n = Number.isFinite(timeline.frameCount) ? timeline.frameCount : 'keine Angabe';
    fehler(`timeline.solved.frames = ${Array.isArray(frames) ? frames.length : typeof frames}: erwartet Array mit ${n} gelösten Frames — die Absichtsprüfung wertet Bewegung aus, keine Phasenliste`);
  }
  if (!Array.isArray(intent) || intent.length === 0) {
    fehler(`intent = ${Array.isArray(intent) ? 'leeres Array' : typeof intent}: erwartet nicht-leeres Array von Kriterien — die Absichtsprüfung sagt ohne Kriterien nichts aus`);
  }
  // Frame-Form: ein gelöster Frame trägt seine Knochendaten in `positions`
  // (BRETT.md, Eintrag AP5; src/validate/physics.js liest dasselbe Feld).
  const ohne = frames.findIndex((f) => !f || typeof f !== 'object'
    || !f.positions || typeof f.positions !== 'object');
  if (ohne >= 0) {
    fehler(`timeline.solved.frames[${ohne}].positions fehlt: erwartet { Knochen-id: [x,y,z] } in Metern — ${frames.length} Frames, der erste ohne Knochendaten ist Frame ${ohne}`);
  }
}

// ── Die sieben Messungen ─────────────────────────────────────────────────────
// Jede liefert { gemessen, unit, passed, message } oder wirft bei
// fehlenden Eingaben (unbekannter Knochen, Frame außerhalb der Timeline)
// mit Zahl und Grund.

// 1. rotation — gemessen an einem Part als kumulierte Winkeländerung von Frame
//    zu Frame über den Frame-Bereich (Achse aus axis: 'x'|'y'|'z'), in Grad.
//    parts: 'com' (Ausrichtung als Gesamtrotation ist nicht definiert) ist hier
//    nicht zulässig — die Drehung braucht eine konkrete Knochenrichtung. Das
//    Verfahren: das Part dreht sich, wenn seine Position relativ zum
//    Referenzpunkt (Becken) um die Achse rotiert; gemessen wird die Änderung
//    des Azimut-Winkels in der zur Achse senkrechten Ebene, summiert.
function messeDrehung(alle, frames, part, axis, from, to) {
  const pelvisBone = alle.pelvisBone;
  const punkt = (i) => frames[i].positions?.[part];
  const bezug = (i) => frames[i].positions?.[pelvisBone] ?? [0, 0, 0];
  // Relative Position zur Bezugsachse: 2D-Koordinaten in der zur Achse
  // senkrechten Ebene. Achse 'y' → x/z-Ebene, 'x' → y/z-Ebene, 'z' → x/y-Ebene.
  const ebene = axis === 'y' ? [0, 2] : axis === 'x' ? [1, 2] : [0, 1];

  // Der Bezugsknochen selbst dreht sich nicht um sich selbst — jedenfalls
  // nicht messbar an seiner Position. Genau ihn nennt aber, wer „der Körper
  // dreht sich" prüfen will: `part: mixamorigHips`. Dann ist der Punkt mit dem
  // Bezugspunkt identisch, jeder Frame fällt unten durch die Radiusprüfung,
  // und heraus kamen bisher stillschweigend 0,0 Grad.
  //
  // Gemessen in Lauf 7 (2. September 2026): Kriterium `rotation, part:
  // mixamorigHips, axis: x, maxDeg: -300` meldete 0,0 Grad, während die Figur
  // im Bild nachweislich einen ganzen Salto drehte. Der Agent schloss daraus,
  // seine Animation habe keine Drehung — der einzige Weg, einen Salto zu
  // bauen (root.drehGrad.x), war zugleich der einzige Weg, den Salto-Check zu
  // verfehlen.
  //
  // Beim Bezugsknochen wird deshalb die GANZKÖRPERDREHUNG gemessen: die
  // Wurzelausrichtung frame.root.quat, angelegt an einen Referenzvektor
  // senkrecht zur gefragten Achse. Dasselbe Summierverfahren wie unten, nur
  // mit dem gedrehten Vektor statt einem Ortsvektor.
  const istBezug = part === pelvisBone;
  if (istBezug && !frames[from]?.root?.quat) {
    fehler(`part ${JSON.stringify(part)} ist der Bezugsknochen: seine Drehung steckt in der `
      + `Wurzelausrichtung, aber Frame ${from} hat kein root.quat — nenne ein Part, das sich um `
      + `das Becken bewegt (Kopf, Brust, Fuß), oder löse die Timeline neu`);
  }
  if (!istBezug && !punkt(from)) {
    fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${from} der gelösten Timeline`);
  }

  /** v um das Einheitsquaternion q gedreht (v' = q·v·q*), ohne Fremdmodul. */
  const drehe = (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx),
    ];
  };
  // Referenzvektor senkrecht zur Drehachse: für x die y-Achse, sonst die
  // x-Achse. Er liegt damit in der Messebene und trägt den vollen Winkel.
  const referenz = axis === 'x' ? [0, 1, 0] : [1, 0, 0];

  let summe = 0;
  let letzter = null;
  let gemessene = 0;
  for (let i = from; i <= to; i++) {
    let dx, dy;
    if (istBezug) {
      const q = frames[i]?.root?.quat;
      if (!Array.isArray(q) || q.length !== 4) {
        fehler(`Frame ${i} hat keine Wurzelausrichtung (root.quat) — die Ganzkörperdrehung `
          + `ist dort nicht messbar`);
      }
      const v = drehe(q, referenz);
      dx = v[ebene[0]]; dy = v[ebene[1]];
    } else {
      const p = punkt(i);
      if (!p) fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${i} der gelösten Timeline`);
      const b = bezug(i);
      dx = p[ebene[0]] - b[ebene[0]]; dy = p[ebene[1]] - b[ebene[1]];
    }
    const r = Math.hypot(dx, dy);
    if (r < 1e-9) continue;   // Punkt liegt auf der Achse: keine Winkelaussage
    gemessene += 1;
    const winkel = Math.atan2(dy, dx);
    if (letzter !== null) {
      let d = winkel - letzter;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      summe += d;
    }
    letzter = winkel;
  }
  // Kein einziger auswertbarer Frame heißt NICHT „null Grad Drehung". Ohne
  // diese Unterscheidung liest der Agent eine Falschmessung als Befund.
  if (gemessene < 2) {
    fehler(`Drehung von ${JSON.stringify(part)} um die ${axis}-Achse ist nicht messbar: `
      + `${gemessene} von ${to - from + 1} Frames liefern einen Abstand zur Achse. `
      + `Das Part liegt auf der Drehachse — nimm ein Part, das sich um sie bewegt `
      + `(Kopf oder Fuß statt Becken)`);
  }
  return summe * 180 / Math.PI;
}

// 2. airtime (Flugphase) — längster zusammenhängender Zeitraum im Frame-Bereich der
//    Timeline, in dem die Kontaktphase (frame.contact) 'flug' ist.
function messeFlugphase(frames, from, to) {
  let laengste = 0, jetzige = 1;
  const a = Math.max(0, from ?? 0);
  const e = Math.min(frames.length - 1, to ?? frames.length - 1);
  let imFlug = false;
  for (let i = a; i <= e; i++) {
    if (frames[i].contact === 'flug') {
      jetzige = imFlug ? jetzige + 1 : 1;
      imFlug = true;
      laengste = Math.max(laengste, jetzige);
    } else {
      imFlug = false;
    }
  }
  return laengste;
}

// 3. ortsveraenderung — Bewegung eines Parts zwischen zwei Frames entlang der
//    angegebenen Richtung. Gemessen wird die größte Projektion eines Frames
//    auf die Richtung (relativ zum Startpunkt), in Körperhöhen — eine Hin- und
//    Herbewegung zählt trotzdem.
function messeOrtsveraenderung(alle, frames, part, richtung, from, to) {
  const p0 = punktVon(frames[from], part);
  if (!p0) fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${from} der gelösten Timeline`);
  const n = Math.hypot(richtung[0], richtung[1], richtung[2]);
  if (!(n > 0)) fehler(`richtung = [${richtung}]: erwartet Vektor ungleich (0,0,0), Länge ${n}`);
  if (from >= to) {
    fehler(`travel: from = ${from}, to = ${to} — für eine Ortsveränderung braucht es einen Bereich`);
  }
  // Vorzeichen: die Richtung zeigt die gesuchte Seite (projektion positiv).
  let best = -Infinity;
  for (let i = from; i <= to; i++) {
    const p = punktVon(frames[i], part);
    if (!p) fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${i} der gelösten Timeline`);
    const q = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
    const proj = (q[0] * richtung[0] + q[1] * richtung[1] + q[2] * richtung[2]) / n;
    best = Math.max(best, proj);
  }
  return best / (n * alle.height);
}

// 4. kontaktwechsel — Frame, an dem ein Fuß den Kontakt verliert. Gemessen an
//    den Sohlenpunkten mit der Kontaktschwelle (params.soleTolerance).
//    Erwartet: von = letzter Kontakt-Frame, bis = erster Flug-Frame danach.
function messeKontaktwechsel(alle, profile, frames, boneName, von, bis) {
  const schwelle = alle.kontaktSchwelle;
  const footY = (i) => {
    const p = frames[i].positions?.[boneName];
    if (!p) fehler(`Knochen ${JSON.stringify(boneName)} fehlt in Frame ${i} der gelösten Timeline`);
    return p[1] - (profile.world?.groundY ?? 0);
  };
  // Kontakt vor `von`: Fuß muss bis dahin unten gewesen sein.
  const letzterKontakt = footY(von) < schwelle;
  const flugAb = footY(bis) >= schwelle;
  // Gemeldet wird der erste Frame im Bereich [von, bis], an dem der Fuß in der
  // Luft ist:
  let erster = -1;
  for (let i = von; i <= bis; i++) {
    if (footY(i) >= schwelle) { erster = i; break; }
  }
  return { letzterKontakt, flugAb, erster };
}

// 5. abstand — kleinster und größter Abstand zweier Parts über den Frame-
//    Bereich, in Körperhöhen; Mindestdauer, die der Abstand gehalten wurde,
//    in Sekunden.
function messeAbstand(alle, frames, partA, partB) {
  const dists = [];
  for (let i = 0; i < frames.length; i++) {
    const a = punktVon(frames[i], partA), b = punktVon(frames[i], partB);
    if (!a) fehler(`Knochen ${JSON.stringify(partA)} fehlt in Frame ${i} der gelösten Timeline`);
    if (!b) fehler(`Knochen ${JSON.stringify(partB)} fehlt in Frame ${i} der gelösten Timeline`);
    dists.push(dist3(a, b));
  }
  const min = Math.min(...dists);
  const max = Math.max(...dists);
  return { min, max, minAnteil: min / alle.hoehe, maxAnteil: max / alle.hoehe };
}

// 6. hoehe — maximale und minimale Höhe eines Parts über der Bodenebene, in
//    Anteilen der Körperhöhe.
function messeHoehe(alle, profile, frames, part) {
  const groundY = profile.world?.groundY ?? 0;
  const hoehen = [];
  for (let i = 0; i < frames.length; i++) {
    const p = punktVon(frames[i], part);
    if (!p) fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${i} der gelösten Timeline`);
    hoehen.push(p[1] - groundY);
  }
  return {
    maxAnteil: Math.max(...hoehen) / alle.hoehe,
    minAnteil: Math.min(...hoehen) / alle.hoehe,
  };
}

// 7. tempo — maximale und minimale Geschwindigkeit eines Parts zwischen Frames,
//    in Körperhöhen pro Sekunde (fps aus der Timeline).
function messeTempo(alle, timeline, frames, part, from, to) {
  const fps = timeline.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    fehler(`timeline.fps = ${JSON.stringify(fps)}: erwartet Zahl > 0, ohne Framerate ist keine Geschwindigkeit messbar`);
  }
  const a = Math.max(1, from ?? 1);
  const e = Math.min(frames.length - 1, to ?? frames.length - 1);
  let max = 0, min = Infinity;
  for (let i = a; i <= e; i++) {
    const p = punktVon(frames[i], part), q = punktVon(frames[i - 1], part);
    if (!p || !q) fehler(`Knochen ${JSON.stringify(part)} fehlt in Frame ${i} oder ${i - 1} der gelösten Timeline`);
    const v = dist3(p, q) * fps / alle.hoehe;
    max = Math.max(max, v);
    min = Math.min(min, v);
  }
  return { max, min };
}

// ── Kriterien-Katalog ────────────────────────────────────────────────────────
// Ein Kriterium wird ausgewertet zu einem Check für den Report. Je Baustein
// gilt: es gibt mindestens einen erfüllten und einen verletzten Fall; die
// Meldung bei Verletzung nennt Soll und Ist mit Zahl.

function werteKriterium(profile, timeline, k, kontext) {
  const frames = timeline.solved.frames;
  const frameCount = frames.length;
  const von = k.from ?? 0;
  const bis = k.to ?? frameCount - 1;
  if (!Number.isInteger(von) || von < 0 || von >= frameCount) {
    fehler(`from = ${JSON.stringify(k.from)}: erwartet ganzzahliger Frame im Bereich 0 bis ${frameCount - 1}`);
  }
  if (!Number.isInteger(bis) || bis < von || bis >= frameCount) {
    fehler(`to = ${JSON.stringify(k.to)}: erwartet ganzzahliger Frame im Bereich ${von} bis ${frameCount - 1}`);
  }

  // Gewertet wird in den Bezeichnern des Werkzeugkatalogs (INTENT_ARTEN) —
  // derselbe Name, den der Agent in set_intent schreibt, kein zweiter.
  const art = k.kind;
  switch (art) {
    case 'rotation': {
      if (!k.part || typeof k.part !== 'string') fehler(`part = ${JSON.stringify(k.part)}: erwartet Knochen-name für die Drehung`);
      if (!['x', 'y', 'z'].includes(k.axis)) {
        fehler(`axis = ${JSON.stringify(k.axis)}: erwartet 'x', 'y' oder 'z'`);
      }
      if (!Number.isFinite(k.minDeg) && !Number.isFinite(k.maxDeg)) {
        fehler(`${art}: erwartet minDeg oder maxDeg in Grad`);
      }
      const gemessen = messeDrehung(kontext, frames, k.part, k.axis, von, bis);
      // Eine Drehung ist eine Größe: 360 Grad in eine Richtung erfüllen
      // mindestens 300 Grad, gleichgültig in welche Richtung sie läuft.
      const ok = k.minDeg !== undefined ? Math.abs(gemessen) >= k.minDeg
        : k.maxDeg !== undefined ? Math.abs(gemessen) <= k.maxDeg
        : genuegt(Math.abs(gemessen), k.minDeg, k.maxDeg);
      const soll = k.minDeg !== undefined && k.maxDeg !== undefined
        ? `${k.minDeg}..${k.maxDeg}` : (k.minDeg !== undefined ? `>=${k.minDeg}` : `<=${k.maxDeg}`);
      return check(art, soll, +gemessen.toFixed(1), 'grad', ok,
        ok ? undefined : `Drehung von ${k.part} um die ${k.axis}-Achse beträgt ${deutsch(Math.abs(gemessen), 1)} Grad, erwartet war ${sollText(k.minDeg, k.maxDeg, 'Grad')}`);
    }
    case 'airtime': {
      if (!Number.isFinite(k.minSek) && !Number.isFinite(k.maxSek)) {
        fehler(`${art}: erwartet minSek oder maxSek in Sekunden`);
      }
      const fps = timeline.fps;
      if (!Number.isFinite(fps) || fps <= 0) {
        fehler(`timeline.fps = ${JSON.stringify(fps)}: erwartet Zahl > 0, ohne Framerate ist keine Flugdauer messbar`);
      }
      const laengeFrames = messeFlugphase(frames, von, bis);
      const gemessen = laengeFrames / fps;
      const ok = genuegt(gemessen, k.minSek, k.maxSek);
      const soll = k.minSek !== undefined && k.maxSek !== undefined
        ? `${k.minSek}..${k.maxSek}` : (k.minSek !== undefined ? `>=${k.minSek}` : `<=${k.maxSek}`);
      // Scheitelhöhe: höchster Schwerpunkt-Punkt während des Flugs, relativ
      // zur Körperhöhe.
      let scheitel = null;
      if (Number.isFinite(k.minScheitel) || Number.isFinite(k.maxScheitel)) {
        const flugHoehen = [];
        for (let i = von; i <= bis; i++) {
          if (frames[i].contact === 'flug') {
            const c = frames[i].com;
            if (!c || !Number.isFinite(c[1])) {
              fehler(`Frame ${i} ist als 'flug' markiert, hat aber keinen Schwerpunkt (com) — Scheitelhöhe nicht messbar`);
            }
            flugHoehen.push((c[1] - (profile.world?.groundY ?? 0)) / kontext.hoehe);
          }
        }
        if (flugHoehen.length === 0) {
          fehler(`${art}: es gibt 0 Flug-Frames im Frame-Bereich ${von} bis ${bis}, Scheitelhöhe nicht messbar`);
        }
        scheitel = Math.max(...flugHoehen);
        const scheitelOk =
          (k.minScheitel === undefined || scheitel >= k.minScheitel) &&
          (k.maxScheitel === undefined || scheitel <= k.maxScheitel);
        if (!scheitelOk) {
          return check(`${art}.apex`, `${k.minScheitel ?? '-∞'}..${k.maxScheitel ?? '∞'}`,
            +scheitel.toFixed(3), 'koerperhoehen', false,
            `Scheitelhöhe im Flug erreicht ${deutsch(scheitel, 2)} Körperhöhen, erwartet war ${k.minScheitel ?? '-∞'} bis ${k.maxScheitel ?? '∞'} Körperhöhen`);
        }
      }
      return check(art, soll, +gemessen.toFixed(3), 'sek', ok,
        ok ? undefined : `Flugphase dauert ${deutsch(gemessen, 2)} Sekunden, erwartet war ${sollText(k.minSek, k.maxSek, 'Sekunden')}`);
    }
    case 'travel': {
      if (!Array.isArray(k.richtung) || k.richtung.length !== 3 || !k.richtung.every(Number.isFinite)) {
        fehler(`richtung = ${JSON.stringify(k.richtung)}: erwartet [x, y, z]`);
      }
      if (!Number.isFinite(k.minHoehe) && !Number.isFinite(k.maxHoehe)) {
        fehler(`${art}: erwartet minHoehe oder maxHoehe in Körperhöhen`);
      }
      const gemessen = messeOrtsveraenderung(kontext, frames, k.part, k.richtung, von, bis);
      const ok = genuegt(gemessen, k.minHoehe, k.maxHoehe);
      const soll = k.minHoehe !== undefined && k.maxHoehe !== undefined
        ? `${k.minHoehe}..${k.maxHoehe}` : (k.minHoehe !== undefined ? `>=${k.minHoehe}` : `<=${k.maxHoehe}`);
      return check(art, soll, +gemessen.toFixed(3), 'koerperhoehen', ok,
        ok ? undefined : `${k.part} bewegt sich um ${deutsch(gemessen, 2)} Körperhöhen entlang [${k.richtung}], erwartet war ${sollText(k.minHoehe, k.maxHoehe, 'Körperhöhen')}`);
    }
    case 'contact_change': {
      if (k.foot !== 'foot_l' && k.foot !== 'foot_r') {
        fehler(`foot = ${JSON.stringify(k.foot)}: erwartet 'foot_l' oder 'foot_r'`);
      }
      const boneName = profile.roles?.[k.foot]?.bone;
      if (!boneName) {
        fehler(`Rolle ${k.foot} fehlt im RigProfile — Kontaktwechsel ohne Fuß nicht messbar`);
      }
      if (!Number.isInteger(k.von) || !Number.isInteger(k.bis)) {
        fehler(`${art}: erwartet von und bis als ganzzahlige Frames, bekommen ${JSON.stringify(k.von)} und ${JSON.stringify(k.bis)}`);
      }
      const m = messeKontaktwechsel(kontext, profile, frames, boneName, k.von, k.bis);
      const ersterSollFrame = k.bis;
      const ok = m.letzterKontakt && m.flugAb && m.erster >= 0 && m.erster === ersterSollFrame;
      const gemessen = m.erster >= 0 ? m.erster : 'nicht gelöst';
      return check(art, `frame ${ersterSollFrame}`, gemessen, 'frame', ok,
        ok ? undefined : `Kontaktwechsel von ${k.foot}: erwartet Abheben exakt bei Frame ${ersterSollFrame}, gemessen wurde ${typeof gemessen === 'number' ? 'Frame ' + gemessen : 'kein Abheben'}`);
    }
    case 'clearance': {
      if (!k.partA || !k.partB) fehler(`${art}: erwartet partA und partB, bekommen ${JSON.stringify(k.partA)} und ${JSON.stringify(k.partB)}`);
      if (!Number.isFinite(k.minAnteil) && !Number.isFinite(k.maxAnteil)) {
        fehler(`${art}: erwartet minAnteil oder maxAnteil in Anteilen der Körperhöhe`);
      }
      const m = messeAbstand(kontext, frames, k.partA, k.partB);
      // Der relevante Wert ist der ungünstigste: bei minAnteil der kleinste,
      // bei maxAnteil der größte gemessene Abstand.
      const relevanterWert = k.minAnteil !== undefined ? m.minAnteil : m.maxAnteil;
      const ok = genuegt(relevanterWert, k.minAnteil, k.maxAnteil);
      // Mindestdauer: der Abstand muss mindestens minDauerSek lang IM
      // SOLLBEREICH bleiben; die Messung braucht daher minAnteil/maxAnteil.
      if (k.minDauerSek !== undefined) {
        if (!Number.isFinite(k.minAnteil) && !Number.isFinite(k.maxAnteil)) {
          fehler(`${art} mit minDauerSek: erwartet minAnteil oder maxAnteil — ohne Bereich ist keine Haltezeit messbar`);
        }
        const fps = timeline.fps;
        if (!Number.isFinite(fps) || fps <= 0) {
          fehler(`timeline.fps = ${JSON.stringify(fps)}: erwartet Zahl > 0, Mindestdauer ohne Framerate nicht messbar`);
        }
        const minFrames = Math.max(1, Math.ceil(k.minDauerSek * fps));
        const drinnen = distsInBereich(frames, k.partA, k.partB, k.minAnteil, k.maxAnteil, kontext.hoehe);
        let beste = 0, jetzt = 0;
        for (const d of drinnen) {
          jetzt = d ? jetzt + 1 : 0;
          beste = Math.max(beste, jetzt);
        }
        const dauerOk = beste >= minFrames;
        const sollDauer = `>=${k.minDauerSek} Sekunden = ${minFrames} Frames`;
        const sollAnteil = k.minAnteil !== undefined && k.maxAnteil !== undefined
          ? `${k.minAnteil}..${k.maxAnteil}` : (k.minAnteil !== undefined ? `>=${k.minAnteil}` : `<=${k.maxAnteil}`);
        if (!dauerOk) {
          return check(art, sollAnteil, beste, 'frames', false,
            `${k.partA} und ${k.partB} halten den Abstand nur ${beste} Frames am Stück, gefordert ${sollDauer}`);
        }
      }
      const soll = k.minAnteil !== undefined && k.maxAnteil !== undefined
        ? `${k.minAnteil}..${k.maxAnteil}` : (k.minAnteil !== undefined ? `>=${k.minAnteil}` : `<=${k.maxAnteil}`);
      return check(art, soll, +relevanterWert.toFixed(3), 'koerperhoehen', ok,
        ok ? undefined : `${k.partA} und ${k.partB} messen ${deutsch(relevanterWert, 2)} Körperhöhen Abstand, erwartet war ${sollText(k.minAnteil, k.maxAnteil, 'Körperhöhen')}`);
    }
    case 'part_height': {
      if (!k.part) fehler(`${art}: erwartet part, bekommen ${JSON.stringify(k.part)}`);
      if (!Number.isFinite(k.minAnteil) && !Number.isFinite(k.maxAnteil)) {
        fehler(`${art}: erwartet minAnteil oder maxAnteil in Anteilen der Körperhöhe`);
      }
      const m = messeHoehe(kontext, profile, frames, k.part);
      const relevanterWert = k.minAnteil !== undefined ? m.maxAnteil : m.minAnteil;
      const ok = genuegt(relevanterWert, k.minAnteil, k.maxAnteil);
      const soll = k.minAnteil !== undefined && k.maxAnteil !== undefined
        ? `${k.minAnteil}..${k.maxAnteil}` : (k.minAnteil !== undefined ? `>=${k.minAnteil}` : `<=${k.maxAnteil}`);
      return check(art, soll, +relevanterWert.toFixed(3), 'koerperhoehen', ok,
        ok ? undefined : `${k.part} erreicht ${deutsch(relevanterWert, 2)} Körperhöhen Höhe, erwartet war ${sollText(k.minAnteil, k.maxAnteil, 'Körperhöhen')}`);
    }
    case 'part_speed': {
      if (!k.part) fehler(`${art}: erwartet part, bekommen ${JSON.stringify(k.part)}`);
      if (!Number.isFinite(k.minHoeheProSek) && !Number.isFinite(k.maxHoeheProSek)) {
        fehler(`${art}: erwartet minHoeheProSek oder maxHoeheProSek in Körperhöhen pro Sekunde`);
      }
      const m = messeTempo(kontext, timeline, frames, k.part, k.from, k.to);
      const relevanterWert = k.minHoeheProSek !== undefined ? m.max : m.min;
      const ok = genuegt(relevanterWert, k.minHoeheProSek, k.maxHoeheProSek);
      const soll = k.minHoeheProSek !== undefined && k.maxHoeheProSek !== undefined
        ? `${k.minHoeheProSek}..${k.maxHoeheProSek}` : (k.minHoeheProSek !== undefined ? `>=${k.minHoeheProSek}` : `<=${k.maxHoeheProSek}`);
      return check(art, soll, +relevanterWert.toFixed(3), 'koerperhoehen/sek', ok,
        ok ? undefined : `${k.part} bewegt sich mit ${deutsch(relevanterWert, 2)} Körperhöhen pro Sekunde, erwartet war ${sollText(k.minHoeheProSek, k.maxHoeheProSek, 'Körperhöhen pro Sekunde')}`);
    }
    default:
      fehler(`kind = ${JSON.stringify(k.kind)}: erwartet einen der ${BAUSTEINE.length} Bausteine des Werkzeugkatalogs (plan.md 6.6) — ${BAUSTEINE.join(', ')} — bekommen wurde ${JSON.stringify(k.kind)}`);
  }
  return null;
}

function distsInBereich(frames, partA, partB, minAnteil, maxAnteil, hoehe) {
  // Hilfsfunktion für die Mindestdauer von clearance: pro Frame, ob der Abstand
  // im Sollbereich liegt.
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const a = punktVon(frames[i], partA), b = punktVon(frames[i], partB);
    if (!a || !b) continue;
    const anteil = dist3(a, b) / hoehe;
    out.push((minAnteil === undefined || anteil >= minAnteil) &&
             (maxAnteil === undefined || anteil <= maxAnteil));
  }
  return out;
}

// ── Pflichtfelder vor dem Speichern ──────────────────────────────────────────
// Dieselben Pflichtfelder, die werteKriterium oben beim Messen an jedem
// Kriterium verlangt — hier abgelegt, damit ein unvollständiges Kriterium
// SCHON BEIM SETZEN abgelehnt wird und nicht erst als Wurf aus der laufenden
// Prüfung hochfällt. Die Tabelle wiederholt nichts: was hier steht, steht so
// in den cases von werteKriterium; ändert dort ein Feld, muss es hier hin.

const PFLICHTFELDER = {
  rotation:       { einzel: ['part', 'axis'], einsVon: ['minDeg', 'maxDeg'] },
  airtime:        { einzel: [],               einsVon: ['minSek', 'maxSek'] },
  travel:         { einzel: ['part', 'richtung'], einsVon: ['minHoehe', 'maxHoehe'] },
  contact_change: { einzel: ['foot', 'von', 'bis'], einsVon: null },
  clearance:      { einzel: ['partA', 'partB'], einsVon: ['minAnteil', 'maxAnteil'] },
  part_height:    { einzel: ['part'],         einsVon: ['minAnteil', 'maxAnteil'] },
  part_speed:     { einzel: ['part'],         einsVon: ['minHoeheProSek', 'maxHoeheProSek'] },
};

/**
 * pruefeKriterien(checks) -> { ok, fehler }
 *
 * Prüft eine Liste von Erfolgskriterien VOR dem Speichern (set_intent) auf
 * Vollständigkeit — sie wirft nicht, sie sammelt. Je fehlendem Feld steht in
 * `fehler` ein Eintrag { index, kind, feld, meldung }: index ist die Position
 * in der Liste, kind die Art des Kriteriums, feld das fehlende Feld und
 * meldung nennt zusätzlich alle Felder, die diese Art braucht.
 *
 * Ein unbekannter `kind` ist ebenfalls unvollständig (feld: 'kind'); die
 * Meldung listet die sieben Bausteine des Werkzeugkatalogs. Reicht ein Feld
 * Paar (minDeg oder maxDeg), steht in `feld` das Paar durch '|' getrennt,
 * wenn KEINES der beiden da ist.
 *
 * checks: Array von Kriterien, je ein Objekt mit kind + Parametern (siehe
 *         Bausteine-Katalog oben)
 */
export function pruefeKriterien(checks) {
  if (!Array.isArray(checks)) {
    fehler(`checks = ${typeof checks}: erwartet Array von Kriterien, bekommen ${typeof checks}`);
  }

  const fehlerListe = [];
  checks.forEach((k, index) => {
    const art = k?.kind;
    const pflicht = PFLICHTFELDER[art];
    if (!pflicht) {
      fehlerListe.push({
        index, kind: art ?? null, feld: 'kind',
        meldung: `Kriterium ${index} von ${checks.length}: kind = ${JSON.stringify(art ?? null)} ist keiner der ${BAUSTEINE.length} Bausteine — erwartet wird einer von ${BAUSTEINE.join(', ')}`,
      });
      return;
    }
    const braucht = pflicht.einsVon
      ? [...pflicht.einzel, `${pflicht.einsVon[0]} oder ${pflicht.einsVon[1]}`]
      : [...pflicht.einzel];
    for (const feld of pflicht.einzel) {
      if (k[feld] === undefined || k[feld] === null) {
        fehlerListe.push({
          index, kind: art, feld,
          meldung: `Kriterium ${index} von ${checks.length} (${art}): Feld '${feld}' fehlt — ${art} braucht ${braucht.join(', ')}`,
        });
      }
    }
    if (pflicht.einsVon
      && pflicht.einsVon.every((feld) => k[feld] === undefined || k[feld] === null)) {
      fehlerListe.push({
        index, kind: art, feld: pflicht.einsVon.join('|'),
        meldung: `Kriterium ${index} von ${checks.length} (${art}): Weder '${pflicht.einsVon[0]}' noch '${pflicht.einsVon[1]}' gesetzt — ${art} braucht ${braucht.join(', ')}`,
      });
    }
  });

  return { ok: fehlerListe.length === 0, fehler: fehlerListe };
}

// ── Öffentliche Funktion ─────────────────────────────────────────────────────

/**
 * pruefeAbsicht(profile, timeline, intent) -> { passed, checks }
 *
 * profile:  RigProfile gemäß plan.md 5.1 (world.height wird benutzt)
 * timeline: Timeline gemäß plan.md 5.2, mit gelöstem 'solved'-Abschnitt
 *           (frames: [{ positions: { Knochen-id: [x,y,z] }, com?, contact? }])
 * intent:   Array von Kriterien, je ein Objekt mit kind + Parametern
 *           (siehe Bausteine-Katalog oben)
 *
 * Rückgabe: { passed, checks } im ValidationReport-Format plan.md 5.3,
 * Block "intent".
 */
export function pruefeAbsicht(profile, timeline, intent) {
  pruefeEingaben(profile, timeline, intent);

  const height = profile.world.height;
  const soleTolerance = profile.params?.soleTolerance ?? KONTAKT_SCHWELLE_FALLBACK_ANTEIL;
  const frames = timeline.solved.frames;
  const pelvisBone = profile.roles?.pelvis?.bone ?? null;

  const kontext = {
    hoehe: height,
    height,
    kontaktSchwelle: height * soleTolerance,
    pelvisBone,
    length: frames.length,
  };

  const checks = [];
  for (const k of intent) {
    checks.push(werteKriterium(profile, timeline, k, kontext));
  }
  return { passed: checks.every((c) => c.passed), checks };
}

export default pruefeAbsicht;