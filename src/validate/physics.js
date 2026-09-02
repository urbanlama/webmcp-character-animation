// AP4 — Physikprüfungen. Prüft eine gelöste Animation (Timeline aus plan.md 5.2,
// Abschnitt "solved") gegen die Physik und meldet Verstöße MIT BETRAG im
// ValidationReport-Format aus plan.md 5.3 (Block "physics").
//
// Die fünf Prüfungen, alle phasenabhängig (plan.md 6.6):
//   1. Bodendurchdringung   — kein Körperteil unter der Bodenebene
//   2. Selbstdurchdringung  — Kapseloberflächen gegen Kapseloberflächen, mit
//                             der Bind-Pose als Untergrenze (plan.md 3.4)
//   3. Balance              — Schwerpunkt über der Stützfläche, nur bei Kontakt
//   4. Fußrutschen          — verankerte Füße bleiben stehen
//   5. Ballistik            — im Flug folgt der Schwerpunkt einer Parabel
//
// Grundregel (AGENTS.md, Regel 1): Körpermaße kommen aus dem RigProfile, nie aus
// dem Code. Die einzigen getippten Zahlen sind die BENANNTEN PARAMETER unten —
// Verfahrensparameter, an einer Stelle, mit Begründung.
//
// Alle Toleranzen sind relativ zur Körperhöhe (AGENTS.md): eine absolute
// Zentimeterzahl in einer Schwelle wäre ein Fehler.

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTEN PARAMETER (Verfahrensparameter, keine Körpermaße)
// Ändert einer, müssen die Abnahmetests erneut laufen.
// ─────────────────────────────────────────────────────────────────────────────

/** Anteil der Körperhöhe, um den ein Körperteil die Bodenebene unterschreiten
 *  darf, bevor gemeldet wird. 1 % figur niedrig: der Clip soll den Boden nicht
 *  durchstoßen, aber Rauschen in Include-Files nicht melden. */
export const BODEN_TOLERANZ_ANTEIL = 0.01;

/** Anteil der Körperhöhe, um den der Schwerpunkt die Stützfläche überstehen
 *  darf, bevor Balance gemeldet wird. 8 %: ein ruhiger Stand hält das Lot
 *  deutlich enger, 8 % fangen echte Kipp-Momente ohne Fehlalarm bei
 *  Vorwärtsneigung. */
export const BALANCE_TOLERANZ_ANTEIL = 0.08;

/** Anteil der Körperhöhe, um den sich ein verankerter Fuß zwischen zwei Frames
 *  verschieben darf. 1,5 %: Sampling-Rauschen in Referenzclips liegt darunter. */
export const RUTSCH_TOLERANZ_ANTEIL = 0.015;

/** Anteil der Körperhöhe, um den zwei Kapseln tiefer ineinander stecken
 *  dürfen, als das Kapselmodell selbst erlaubt (siehe
 *  KAPSEL_UEBERDECKUNG_ANTEIL), bevor Selbstdurchdringung gemeldet wird.
 *  0,5 % = 0,9 cm am Xbot: unter dem Rauschen der Kapselnäherung, weit unter
 *  jeder Durchdringung, die ein Mensch im Bild sieht. */
export const DURCHDRINGUNG_TOLERANZ_ANTEIL = 0.005;

/** Anteil der Radiensumme zweier Kapseln, um den sie sich überschneiden
 *  dürfen, ohne dass das eine Durchdringung wäre.
 *
 *  Warum es diesen Parameter braucht: die Kapselradien sind das 90. Perzentil
 *  der Hüllpunkte (plan.md Kap. 4). Sie decken den Körper großzügig ab, und
 *  zwei Kapseln schneiden sich bereits, wenn sich die echten Oberflächen nur
 *  berühren. Am Xbot gemessen: der hängend am Körper liegende Arm ergibt für
 *  hand_l|thigh_l eine Kapselüberschneidung von 7,3 cm bei 15,8 cm
 *  Radiensumme (47 %) — dort steckt keine Hand im Bein.
 *
 *  Gemessen über die vier Entwicklungsclips (idle, walk, agree, sad_pose,
 *  AGENTS.md Regel 3): 47 % ist der größte Wert, den die Kapselgeometrie ohne
 *  echte Durchdringung erzeugt (agree, Frame 17). Eine Hand, die wirklich im
 *  ehemaligen Gesamt-Rumpf steckt, lag bei 74 % (17,0 cm bei 22,9 cm
 *  Radiensumme). 60 % liegt dazwischen, mit 13 Prozentpunkten Abstand nach
 *  beiden Seiten. Nach Rumpfteilung und der Prüfung aller Gelenkpaare: 0
 *  Meldungen in je 91 Stichproben von idle, walk, agree und sad_pose. Der Wert
 *  wird deshalb nicht angehoben; die Referenzclips bleiben Kalibrierung, nicht
 *  Testkorpus. */
export const KAPSEL_UEBERDECKUNG_ANTEIL = 0.60;

/** Anteil der Erdbeschleunigung, um den die gemessene Senkrechtbeschleunigung
 *  des Schwerpunkts im Flug von -g abweichen darf, bevor Ballistik gemeldet
 *  wird. Anders als die übrigen Toleranzen als Anteil von g statt der
 *  Körperhöhe, weil die Fallbeschleunigung absolut ist und nicht mit der
 *  Figur skaliert. 0,25 g: freier Fall und Frame-Sampling-Rauschen liegen
 *  darunter, Schweben (0 g) und jede sanftere Bahn liegen weit darüber. */
export const BALLISTIK_TOLERANZ_ANTEIL = 0.25;

/** Erdbeschleunigung in m/s². Keine Körpermaß, keine Schätzung: fest. */
export const G = 9.81;

/** Kontaktschwelle: ein Kontaktpunkt (Sohle) gilt als am Boden, wenn er näher
 *  als dieser Anteil der Körperhöhe an der Bodenebene liegt. plan.md Kap. 4:
 *  3,5 % — muss Modelle erfassen, die auf dem Ballen stehen. Wird aus dem
 *  RigProfile gelesen (params.soleTolerance), hier nur der Fallback. */
export const KONTAKT_SCHWELLE_ANTEIL = 0.035;

/** Auflageschwelle: ein Fuss TRAEGT, wenn eine seiner Sohlen naeher als dieser
 *  Anteil der Koerperhoehe am Boden liegt. 1 % = 1,8 cm am Xbot.
 *
 *  Getrennt von KONTAKT_SCHWELLE_ANTEIL, und das ist der Punkt: die 3,5 %
 *  dort beantworten die Frage „beruehrt die Figur ueberhaupt den Boden?" und
 *  duerfen grosszuegig sein, damit auch ein Modell erfasst wird, das auf dem
 *  Ballen steht. Fuer die Frage „steht dieser Fuss fest genug, dass Rutschen
 *  ein Fehler waere?" sind sie viel zu weit: ein Schwungfuss geht beim
 *  Durchschwingen 2 bis 5 cm ueber den Boden und liegt damit unter 6,3 cm —
 *  er galt als aufliegend, und seine Vorwaertsbewegung wurde als Rutschen
 *  gemeldet.
 *
 *  Gemessen am Agentenlauf vom 1. September 2026: 19 bis 33 cm „Rutschen" in
 *  den Frames 4–34, also im gesamten Anlauf, bei einem Gang, der nicht
 *  rutschte. Der Agent schrieb selbst „der Pruefer wertet sie als Kontakt"
 *  und beugte daraufhin die Knie von 40 auf 56 Grad, um die Fuesse hoeher zu
 *  bekommen — aus einem Gang wurde ein Storchengang. */
export const AUFLAGE_SCHWELLE_ANTEIL = 0.01;

/** Numerische Schwelle des Geschlossenheits-Verfahrens (segSegDist): ab
 *  dieser Degenerierheit gilt ein Streckensegment als Punkt. 1e-12 liegt an
 *  der Maschinengenauigkeit der Quadratsummen (Werte > 1 m² im Rig), macht
 *  die Entweder-oder-Verzweigung deterministisch und ist keine Toleranz:
 *  ein echter körpernaher Abstand liegt viele Größenordnungen darüber. */
export const EPS_DEGENERIERT_QUAD = 1e-12;

// ─────────────────────────────────────────────────────────────────────────────
// Eingabevertrag
// ─────────────────────────────────────────────────────────────────────────────
//
// pruefePhysik(profile, frames) erwartet:
//
// profile: RigProfile gemäß docs/plan.md 5.1. Benutzt werden:
//   world.height           — Körperhöhe in Metern (Referenz aller Toleranzen)
//   world.groundY          — Höhe der Bodenebene in Metern
//   world.up               — erwartet 'y'; anderes wird abgelehnt, nicht geraten
//   roles.pelvis.bone      — Knochen des Beckens (Balance-Negativfall nennt ihn)
//   roles.foot_l.bone, roles.foot_r.bone — Fußknochen (Rutschen, Boden)
//   segments[].id/from/to  — Segment-Endpunkte (Knochen-ids) für Ruheabstände
//   segments[].radius      — Kapselradius in Metern (Durchdringung)
//   restDistances["a|b"]   — Bind-Pose-OBERFLÄCHENABSTAND je Segmentpaar in
//                            Metern; negativ, wenn sich die Kapseln schon in
//                            der Bind-Pose überschneiden (Rumpf/Oberschenkel
//                            am Xbot: -0,16 m)
//   soles[]                — Sohlenpunkte {id, bone, local} als Kontaktpunkte
//   params.soleTolerance   — Anteil, optional; Fallback KONTAKT_SCHWELLE_ANTEIL
//
// fps (optional, drittes Argument): Framerate in Hz, für die Ballistik.
// Fehlt sie, während drei aufeinanderfolgende Frames im Flug liegen, wird
// nicht geraten: Die Ballistikprüfung bleibt aus und steht im Rückgabeobjekt
// unter ausgelassen (AGENTS.md: kein stilles Raten).
//
// frames: Array mit einem Eintrag je Frame, fortlaufend:
//   {
//     positions: { <Knochen-id>: [x, y, z] in Metern, Weltkoordinaten },
//     solePositions: { <Sohlen-id>: [x, y, z] } — Weltpositionen der
//                    Sohlenpunkte, vom Löser mitgeschrieben. Sie sind die
//                    echten Kontaktpunkte: am Xbot liegt der Fußknochen
//                    7,2 cm über der tiefsten Sohle. Boden, Phase und Balance
//                    rechnen damit, wenn das Feld da ist; fehlt es (ältere
//                    Frames), fallen alle drei auf den Fußknochen zurück.
//     com: [x, y, z] — Schwerpunkt in Metern (aus dem Löser oder aus Segmenten),
//     contact: 'kontakt' | 'flug',  — Phase (plan.md 5.3); optional:
//     anchored: ['sole_l_front_out', ...] — verankerte Sohlen-ids in diesem Frame
//   }
// Fehlt contact, wird die Phase aus den Sohlenhöhen gemessen (Kontaktschwelle).
//
// Rückgabe: { passed, issues, ausgelassen } gemäß plan.md 5.3 — jede Meldung
// mit kind, frame, value, unit, part, message (deutscher Satz MIT ZAHL), fix;
// ausgelassen nennt Prüfungen, die mangels Eingaben (z. B. Framerate)
// übersprungen wurden.

const issue = (kind, frame, value, unit, part, message, fix) =>
  ({ kind, frame, value, unit, part, message, fix });

function fehler(text) { throw new Error('Physikprüfung abgelehnt: ' + text); }

function pruefeEingaben(profile, frames) {
  if (!profile || typeof profile !== 'object') fehler('RigProfile fehlt (null übergeben)');
  if (!profile.world || !Number.isFinite(profile.world.height) || profile.world.height <= 0) {
    fehler(`world.height = ${profile?.world?.height}: erwartet Zahl > 0, alle Toleranzen sind relativ zur Körperhöhe`);
  }
  if (profile.world.up !== 'y') {
    fehler(`world.up = ${JSON.stringify(profile.world.up)}: erwartet 'y' — andere Ausrichtungen werden nicht geraten (plan.md 5.1)`);
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    fehler(`frames = ${Array.isArray(frames) ? 'leeres Array' : typeof frames}: erwartet nicht-leeres Array, ein Eintrag je Frame`);
  }
  frames.forEach((f, i) => {
    if (!f || typeof f !== 'object') fehler(`frames[${i}] = ${JSON.stringify(f)}: erwartet Objekt`);
    if (!f.positions || typeof f.positions !== 'object') {
      fehler(`frames[${i}].positions fehlt: erwartet { Knochen-id: [x,y,z] } in Metern`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometrie-Helfer (plattformfrei, keine Vektorklasse nötig)
// ─────────────────────────────────────────────────────────────────────────────

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Kürzester Abstand der beiden Strecken a1-a2 und b1-b2. Skalarprodukt-Verfahren. */
function segSegDist(a1, a2, b1, b2) {
  const d1 = [a2[0] - a1[0], a2[1] - a1[1], a2[2] - a1[2]];
  const d2 = [b2[0] - b1[0], b2[1] - b1[1], b2[2] - b1[2]];
  const r = [a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]];
  const a = d1[0]*d1[0] + d1[1]*d1[1] + d1[2]*d1[2];
  const e = d2[0]*d2[0] + d2[1]*d2[1] + d2[2]*d2[2];
  const f = d2[0]*r[0] + d2[1]*r[1] + d2[2]*r[2];
  let s, t;
  if (a <= EPS_DEGENERIERT_QUAD && e <= EPS_DEGENERIERT_QUAD) return Math.hypot(r[0], r[1], r[2]);
  if (a <= EPS_DEGENERIERT_QUAD) {
    s = 0;
    const tRaw = (d2[0]*r[0] + d2[1]*r[1] + d2[2]*r[2]) / e;
    t = Math.min(1, Math.max(0, tRaw));
  } else {
    const c = d1[0]*r[0] + d1[1]*r[1] + d1[2]*r[2];
    if (e <= EPS_DEGENERIERT_QUAD) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1[0]*d2[0] + d1[1]*d2[1] + d1[2]*d2[2];
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      const tRaw = (b * s + f) / e;
      if (tRaw < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (tRaw > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      else t = tRaw;
    }
  }
  const p1 = [a1[0] + d1[0]*s, a1[1] + d1[1]*s, a1[2] + d1[2]*s];
  const p2 = [b1[0] + d2[0]*t, b1[1] + d2[1]*t, b1[2] + d2[2]*t];
  return dist3(p1, p2);
}

/** Gemeinsamer Endpunkt zweier Segmente, sonst null. */
function gemeinsamesGelenk(A, B) {
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      if (A[a] === B[b]) return { a, b };
    }
  }
  return null;
}

/** Rückt den Kapselende um seinen GEMESSENEN Radius vom gemeinsamen Gelenk ab.
 *
 * Zwei Segmentkapseln müssen das Gelenk selbst überdecken. Ohne diesen
 * Ausschnitt läge ihre Achsdistanz an jedem Knie bei 0 und schon eine normale
 * Beugung wäre eine 100%-Durchdringung. Maximal die halbe Segmentlänge wird
 * abgerückt: sehr kurze Hand- oder Fußsegmente bleiben eine messbare Achse. */
function kuerzeAmGelenk(p0, p1, ende, radius) {
  const out = [p0, p1].map((p) => [...p]);
  const joint = out[ende];
  const other = out[1 - ende];
  const laenge = dist3(joint, other);
  if (!(laenge > 0) || !(radius > 0)) return out;
  const weg = Math.min(radius, laenge / 2) / laenge;
  out[ende] = joint.map((x, i) => x + (other[i] - x) * weg);
  return out;
}

/** Kapselachsen eines Paares; an einem gemeinsamen Gelenk ohne Gelenkregion. */
function pruefachsen(a1, a2, b1, b2, A, B, rA, rB) {
  const geteilt = gemeinsamesGelenk(A, B);
  if (!geteilt) return [a1, a2, b1, b2];
  const a = kuerzeAmGelenk(a1, a2, geteilt.a, rA);
  const b = kuerzeAmGelenk(b1, b2, geteilt.b, rB);
  return [...a, ...b];
}

// ─────────────────────────────────────────────────────────────────────────────
// Prüfungen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pruefePhysik(profile, frames, fps) -> { passed: false|true, issues, ausgelassen }
 * issues: [] falls alles in Ordnung. Fehlerfrei ist kein Erfolg — eine
 * bewegungslose Animation besteht alle fünf Prüfungen (plan.md 3.2); die
 * Absichts- und Stilprüfungen aus AP6 fangen das.
 */
export function pruefePhysik(profile, frames, fps) {
  pruefeEingaben(profile, frames);

  const height = profile.world.height;
  const groundY = profile.world.groundY ?? 0;
  const issues = [];

  const soleTolerance = profile.params?.soleTolerance ?? KONTAKT_SCHWELLE_ANTEIL;
  const kontaktSchwelle = height * soleTolerance;
  const bodenTol = height * BODEN_TOLERANZ_ANTEIL;
  const balanceTol = height * BALANCE_TOLERANZ_ANTEIL;
  const rutschTol = height * RUTSCH_TOLERANZ_ANTEIL;
  const durchdringTol = height * DURCHDRINGUNG_TOLERANZ_ANTEIL;

  const bonesOf = (f) => f.positions;
  const roleBone = (role) => profile.roles?.[role]?.bone;

  // Segmente für Ruheabstände: id -> [endpunktA_id, endpunktB_id]
  const segById = new Map((profile.segments ?? []).map((s) => [s.id, [s.from, s.to]]));
  // Kapselradien, gemessen (plan.md Kap. 4). Fehlt einer, zählt er als 0 —
  // dann ist die Kapsel eine Strecke, und die Prüfung wird strenger, nicht
  // großzügiger.
  const radiusById = new Map((profile.segments ?? [])
    .map((s) => [s.id, Number.isFinite(s.radius) ? s.radius : 0]));
  const restPairs = [];
  for (const [key, dist] of Object.entries(profile.restDistances ?? {})) {
    const [a, b] = key.split('|');
    if (!segById.has(a) || !segById.has(b)) continue;   // fremdes Paar: nicht unsere Prüfung
    restPairs.push({ a, b, dist, key });
  }

  // ── Sohlen: die echten Kontaktpunkte ──────────────────────────────────────
  //
  // Ein Fuß berührt den Boden mit der Sohle, nicht mit dem Fußknochen. Am Xbot
  // liegt der Knochen 7,2 cm über der tiefsten Sohle. Wer mit ihm rechnet,
  // misst am falschen Punkt: eine um 10 cm abgesenkte Wurzel steckt mit allen
  // ACHT Sohlen im Boden, gemeldet wurden vorher nur die beiden Zehenknochen —
  // und ein Rig ohne Zehenknochen hätte gar nichts gemeldet.
  //
  // Der Löser schreibt solePositions an jeden Frame (src/solver/loeser.js,
  // sohlenVerzeichnis). Fehlt das Feld (ältere Frames, fremde Erzeuger),
  // fallen Boden, Phase und Balance auf den Fußknochen zurück — wie bisher.
  const solesByBone = new Map();
  for (const s of profile.soles ?? []) {
    if (!solesByBone.has(s.bone)) solesByBone.set(s.bone, []);
    solesByBone.get(s.bone).push(s.id);
  }
  const auflageSchwelle = height * AUFLAGE_SCHWELLE_ANTEIL;

  /** Sohlenpunkte eines Frames als [{id, bone, p, hoehe}], hoehe über der
   *  Bodenebene. Leeres Array, wenn der Frame kein Sohlenverzeichnis hat. */
  const sohlenAus = (f) => {
    const pts = f.solePositions;
    if (!pts || typeof pts !== 'object') return [];
    const out = [];
    for (const s of profile.soles ?? []) {
      const q = pts[s.id];
      if (!Array.isArray(q) || !Number.isFinite(q[1])) continue;
      out.push({ id: s.id, bone: s.bone, p: q, hoehe: q[1] - groundY });
    }
    return out;
  };

  /** Sohlen, die in diesem Frame TRAGEN: höchstens auflageSchwelle über dem
   *  Boden. Eine Antwort für Balance und Rutschen — ein angehobener Fuß trägt
   *  nicht, und was er tut, ist kein Rutschen. */
  const tragendeSohlen = (f) => sohlenAus(f).filter((x) => x.hoehe < auflageSchwelle);

  // ── Phase je Frame: 'kontakt' oder 'flug' (phasenabhängige Prüfungen) ──────
  // Vorgabe aus dem Auftrag: contact-Feld, wenn gesetzt; sonst gemessen über
  // die Sohlenpunkte (Kontaktschwelle, plan.md Kap. 4: 3,5 % Körperhöhe).
  function phaseOf(f) {
    if (f.contact === 'kontakt' || f.contact === 'flug') return f.contact;
    const sohlen = sohlenAus(f);
    if (sohlen.length > 0) {
      return sohlen.some((x) => x.hoehe < kontaktSchwelle) ? 'kontakt' : 'flug';
    }
    const pts = (profile.soles ?? [])
      .map((s) => bonesOf(f)[s.bone])
      .filter(Boolean);
    const amBoden = pts.some((p) => (p[1] - groundY) < kontaktSchwelle);
    return amBoden ? 'kontakt' : 'flug';
  }
  const phasen = frames.map(phaseOf);

  // ── 1. Bodendurchdringung ──────────────────────────────────────────────────
  // Körperteile = Segment-Endpunkte (Knochen-Weltpositionen). Ein unter dem
  // Boden liegender Knochen wird gemeldet mit der Tiefe als Betrag.
  //
  // NUR Knochen, an denen Haut hängt (profile.skinnedBones, gemessen in
  // measure.js). Mixamo führt Hilfsknochen ohne jede Geometrie — beide
  // Toe_End, HeadTop_End, die Augen, alle zehn Fingerspitzen. Am Xbot sind
  // das 15 von 67 Knochen.
  //
  // Warum das nicht kosmetisch ist: Toe_End liegt konstruktiv TIEFER als der
  // tiefste Sohlenpunkt — in der Ruhehaltung 1,53 cm, bei 30 Grad
  // gestrecktem Fuß 1,85 cm. Die Bodentoleranz sind 1,8 cm. Sobald die Sohle
  // sauber aufliegt und der Fuß auch nur leicht abrollt, meldet die Prüfung
  // einen Fehler, den die Bewegung nicht hat und den kein Agent beheben kann:
  // Null ist unerreichbar, solange die Sohle den Boden berührt.
  //
  // Gemessen am Agentenlauf vom 1. September 2026: der Agent kämpfte über
  // rund 40 Aufrufe von 12,6 cm auf 3,5 cm herunter, kam nie auf null und
  // baute dabei den Anlauf zum Storchengang um (knee.bend 40 -> 56 Grad).
  //
  // Fehlt das Feld (älteres Profil), wird wie bisher alles geprüft.
  const hatHaut = Array.isArray(profile.skinnedBones) && profile.skinnedBones.length > 0
    ? new Set(profile.skinnedBones)
    : null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    // Erst die Sohlen: sie sind die tiefsten Punkte des Fußes und der einzige
    // Ort, an dem der Betrag stimmt. Ohne sie meldete die Prüfung am Xbot bei
    // einem um 25 Grad gekippten Fuß 3,7 cm (Zehenknochen), während die Sohle
    // 6,0 cm im Boden steckte.
    for (const x of sohlenAus(f)) {
      const tiefe = -x.hoehe;
      if (tiefe > bodenTol) {
        issues.push(issue(
          'boden', i, +tiefe.toFixed(4), 'm', x.id,
          `Sohlenpunkt ${x.id} steckt ${(tiefe * 100).toFixed(1).replace('.', ',')} cm im Boden`,
          'Wurzel anheben, Fuß weniger kippen oder Bein strecken'
        ));
      }
    }
    for (const [bone, p] of Object.entries(f.positions)) {
      if (hatHaut && !hatHaut.has(bone)) continue;
      const tiefe = groundY - p[1];
      if (tiefe > bodenTol) {
        issues.push(issue(
          'boden', i, +tiefe.toFixed(4), 'm', bone,
          `${bone} steckt ${(tiefe * 100).toFixed(1).replace('.', ',')} cm im Boden`,
          'Wurzel anheben oder Bein strecken'
        ));
      }
    }
  }

  // ── 2. Selbstdurchdringung: Kapseloberfläche gegen Kapseloberfläche ────────
  //
  // Gemessen wird die ÜBERSCHNEIDUNG der beiden Kapseln:
  //     Überschneidung = rA + rB - Achsabstand der beiden Segmente
  // Positiv heißt: die Kapseln stecken ineinander.
  //
  // Vorher stand hier „enger als in der Bind-Pose", mit zwei Fehlern. Der eine
  // war ein Einheitenbruch: measure.js speichert den OBERFLÄCHENabstand,
  // verglichen wurde er mit dem ACHSabstand der Pose — die Prüfung war um
  // rA + rB zu großzügig (am Xbot 22,9 cm bei Rumpf und Hand).
  //
  // Der andere ist grundsätzlich: der Ruheabstand taugt nicht als Referenz.
  // In der Bind-Pose (T-Pose) hängt die Hand 62,8 cm neben dem Oberschenkel;
  // lässt der Agent den Arm einfach hängen, sind es 0 cm — eine „Verengung"
  // von 62,8 cm, die niemand als Durchdringung bezeichnen würde. Umgekehrt
  // stecken Rumpf und Oberschenkel schon in der Bind-Pose 16,0 cm ineinander,
  // weil die Radien das 90. Perzentil der Hüllpunkte sind; „enger als Bind"
  // hätte dort nie angeschlagen, „Kapseln schneiden sich" jeden Frame.
  //
  // Richtig ist deshalb: erlaubt ist so viel Überschneidung, wie das
  // Kapselmodell ohnehin erzeugt — der GRÖSSERE der beiden Werte aus
  //   (a) der Überschneidung in der Bind-Pose (restDistances, negativ) und
  //   (b) KAPSEL_UEBERDECKUNG_ANTEIL der Radiensumme.
  // Was darüber hinaus geht, um mehr als die Toleranz, ist eine Meldung.
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    for (const { a, b, dist } of restPairs) {
      const pa = bonesOf(f), A = segById.get(a), B = segById.get(b);
      const a1 = pa[A[0]], a2 = pa[A[1]], b1 = pa[B[0]], b2 = pa[B[1]];
      if (!a1 || !a2 || !b1 || !b2) continue;   // Knochen fehlt: Intention, kein physikalischer Befund
      const rA = radiusById.get(a) ?? 0;
      const rB = radiusById.get(b) ?? 0;
      const rSumme = rA + rB;
      // Auch Nachbarsegmente werden geprüft. Ihre Kapseln werden nur am
      // gemeinsamen Gelenk um den jeweils gemessenen Radius gekürzt: normales
      // Beugen bleibt frei, ein in den Oberschenkel zurückgefaltetes Schienbein
      // nicht (Bühnenbefund D).
      const [aa1, aa2, bb1, bb2] = pruefachsen(a1, a2, b1, b2, A, B, rA, rB);
      const ueberschneidung = rSumme - segSegDist(aa1, aa2, bb1, bb2);
      const inBind = Math.max(0, -dist);
      const erlaubt = Math.max(inBind, KAPSEL_UEBERDECKUNG_ANTEIL * rSumme);
      if (ueberschneidung - erlaubt > durchdringTol) {
        issues.push(issue(
          'durchdringung', i, +ueberschneidung.toFixed(4), 'm', `${a}|${b}`,
          `${a} und ${b} stecken ${(ueberschneidung * 100).toFixed(1).replace('.', ',')} cm ineinander, `
          + `zulässig sind ${(erlaubt * 100).toFixed(1).replace('.', ',')} cm bei ${(rSumme * 100).toFixed(1).replace('.', ',')} cm Radiensumme`,
          'Gliedmaßen auseinander bewegen'
        ));
      }
    }
  }

  // ── 3. Balance, nur bei Kontakt ────────────────────────────────────────────
  // Schwerpunkt über der Stützfläche, gemessen in der Horizontalebene. Toleranz
  // relativ zur Körperhöhe. Gemeldet wird der Überstand als Betrag.
  for (let i = 0; i < frames.length; i++) {
    if (phasen[i] !== 'kontakt') continue;
    const f = frames[i];
    const com = f.com;
    if (!com || !Number.isFinite(com[0])) continue;   // ohne Schwerpunkt keine Balance-Aussage
    // Stützfläche = konvexe Hülle der TRAGENDEN Sohlenpunkte, von oben (x/z).
    //
    // Tragend heißt: höchstens auflageSchwelle über dem Boden (1 % Körperhöhe
    // = 1,8 cm am Xbot). Vorher war die Stützfläche die Strecke zwischen den
    // beiden FUSSKNOCHEN, gleichgültig ob ein Fuß überhaupt am Boden stand.
    // Gemessen am Xbot: linkes Bein angehoben (Fuß auf 42 cm), Wurzel und
    // Schwerpunkt auf x = 0,25 über den angehobenen Fuß geschoben — null
    // Balancefehler, obwohl die Figur auf einem Bein steht und das Lot 25 cm
    // neben dem Standfuß liegt.
    let punkte;
    const sohlen = sohlenAus(f);
    if (sohlen.length > 0) {
      // Sohlenverzeichnis vorhanden: nur was trägt, zählt. Steht die Figur
      // laut Phase in Kontakt, ohne dass eine Sohle die Auflageschwelle
      // erreicht (Zehenstand, kurz vor dem Aufsetzen), sind die Sohlen
      // innerhalb der Kontaktschwelle die einzigen Kandidaten.
      const tragend = tragendeSohlen(f);
      const naeher = tragend.length > 0
        ? tragend
        : sohlen.filter((x) => x.hoehe < kontaktSchwelle);
      if (naeher.length === 0) continue;   // nichts trägt: keine Balanceaussage
      punkte = naeher.map((x) => [x.p[0], x.p[2]]);
    } else {
      // Ältere Frames ohne Sohlenverzeichnis: wie bisher über die Fußknochen.
      const pts = (profile.soles ?? [])
        .map((s) => bonesOf(f)[s.bone])
        .filter(Boolean);
      if (pts.length === 0) continue;
      punkte = pts.map((q) => [q[0], q[2]]);
    }
    const huelle = konvexeHuelle(punkte);
    const d = abstandZuPolygon([com[0], com[2]], huelle);
    if (d > balanceTol) {
      const pelvis = profile.roles?.pelvis?.bone ?? 'Becken';
      issues.push(issue(
        'balance', i, +d.toFixed(4), 'm', pelvis,
        `Schwerpunkt liegt ${(d * 100).toFixed(1).replace('.', ',')} cm außerhalb der Stützfläche`,
        'Hüfte über die Füße bringen oder Fuß versetzen'
      ));
    }
  }
  function konvexeHuelle(pkte) {
    if (pkte.length < 3) return pkte.slice();
    const sorted = pkte.slice().sort((m, n) => m[0] - n[0] || m[1] - n[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    return lower.concat(upper);
  }
  function abstandZuPolygon(p, poly) {
    if (poly.length === 0) return Infinity;
    if (poly.length === 1) return Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]);
    if (poly.length === 2) {
      return punktStrecke(p, poly[0], poly[1]);
    }
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      // Strahl nach +x
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      best = Math.min(best, punktStrecke(p, a, b));
    }
    return inside ? -best : best;
  }
  function punktStrecke(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
    return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
  }

  // ── 4. Fußrutschen, nur bei Kontakt und nur für verankerte Füße ───────────
  // Verankert ist ein Fuß, wenn mindestens eine seiner Sohlen im anchored-Feld
  // des Frames steht. Fehlt das Feld ganz, genügt der Kontakt (phasenabhängig
  // bereits geprüft); steht das Feld und nennt die Sohle nicht, darf der Fuß
  // sich bewegen.
  const fussVerankert = (f, bone) => {
    if (!Array.isArray(f.anchored)) return true;
    return (solesByBone.get(bone) ?? []).some((id) => f.anchored.includes(id));
  };

  // Liegt DIESER Fuss auf? Nicht: beruehrt die Figur irgendwo den Boden.
  //
  // Vorher entschied die figurweite Phase, und geprueft wurden dann BEIDE
  // Fuesse. Beim Gehen steht immer einer — damit galt der Schwungfuss als
  // aufliegend und seine Vorwaertsbewegung als Rutschen. Der Anlauf war
  // durchgehend rot, ohne dass etwas rutschte.
  // Dieselbe Antwort wie bei der Balance: tragendeSohlen(f), nach Fuss
  // gefiltert. Was traegt, darf nicht rutschen; was in der Luft haengt, geht.
  const liegtAuf = (f, bone) => {
    if (sohlenAus(f).length > 0) {
      return tragendeSohlen(f).some((x) => x.bone === bone);
    }
    // Kein Sohlenverzeichnis im Frame: auf den Fussknochen zurueckfallen. Er
    // liegt hoeher als die Sohle, deshalb die Sohlentoleranz obendrauf.
    const p = bonesOf(f)[bone];
    return !!p && (p[1] - groundY) < auflageSchwelle + kontaktSchwelle;
  };

  for (let i = 1; i < frames.length; i++) {
    // Phasengrenze bleibt tabu (AGENTS.md: jede Pruefung ist phasenabhaengig).
    // Die Figur muss in BEIDEN Frames Kontakt haben — und zusaetzlich muss
    // DIESER Fuss aufliegen.
    if (phasen[i] !== 'kontakt' || phasen[i - 1] !== 'kontakt') continue;
    const prev = frames[i - 1], f = frames[i];
    for (const role of ['foot_l', 'foot_r']) {
      const bone = profile.roles?.[role]?.bone;
      if (!bone) continue;
      if (!liegtAuf(prev, bone) || !liegtAuf(f, bone)) continue;
      if (!fussVerankert(prev, bone) || !fussVerankert(f, bone)) continue;
      const a = prev.positions?.[bone], b = bonesOf(f)[bone];
      if (!a || !b) continue;
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d > rutschTol) {
        issues.push(issue(
          'rutschen', i, +d.toFixed(4), 'm', bone,
          `${bone} hat Bodenkontakt, rutscht aber ${(d * 100).toFixed(1).replace('.', ',')} cm`,
          'Fuß in beiden Frames an dieselbe Stelle setzen'
        ));
      }
    }
  }

  // ── 5. Ballistik, nur im Flug ──────────────────────────────────────────────
  // Drei aufeinanderfolgende Flugframes: die zweite Differenz der Schwerpunkt-
  // höhe ist die Senkrechtbeschleunigung, im freien Fall muss sie -g sein.
  // Die Framerate kommt als drittes Argument; ohne sie wird nicht geraten,
  // sondern die Prüfung unter ausgelassen benannt.
  const flugTripel = [];
  for (let i = 1; i + 1 < frames.length; i++) {
    if (phasen[i] === 'flug' && phasen[i - 1] === 'flug' && phasen[i + 1] === 'flug') {
      flugTripel.push(i);
    }
  }
  const ausgelassen = [];
  if (flugTripel.length > 0) {
    if (fps === undefined) {
      ausgelassen.push('ballistik');
    } else {
      if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
        fehler(`fps = ${fps}: erwartet Framerate > 0 in Hz für die Ballistikprüfung`);
      }
      const dt = 1 / fps;
      for (const i of flugTripel) {
        const a = frames[i - 1].com, b = frames[i].com, c = frames[i + 1].com;
        if (!a || !b || !c || ![a, b, c].every((p) => Number.isFinite(p[1]))) {
          continue;   // ohne Schwerpunkthöhe keine Ballistik-Aussage
        }
        const accY = (a[1] - 2 * b[1] + c[1]) / (dt * dt);
        const abweich = Math.abs(accY + G);
        if (abweich > BALLISTIK_TOLERANZ_ANTEIL * G) {
          issues.push(issue(
            'ballistik', i, +abweich.toFixed(2), 'm/s²', 'schwerpunkt',
            `Schwerpunkt beschleunigt im Flug mit ${Math.abs(accY).toFixed(2).replace('.', ',')} m/s² nach unten statt mit 9,81 m/s²`,
            'Flugphase als freien Fall mit g = 9,81 m/s² lösen'
          ));
        }
      }
    }
  }
  return { passed: issues.length === 0, issues, ausgelassen };
}
