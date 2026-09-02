// Bewegungsspur — der Verlauf einer Animation in EINEM Bild.
//
// Warum es das gibt: `look` und `validate` zeigen je einen Moment in voller
// Groesse. Der Verlauf fehlte damit ganz — der Agent haette ihn Frame fuer
// Frame zusammensuchen muessen, und was er vergisst, sieht er nie
// (docs/buehne-befunde-2026-09-02.md, Punkt 1).
//
// Der alte Bildstreifen loeste das mit Standbildern nebeneinander. Das
// funktioniert nicht: bei sechs Kacheln ist jede Figur fingernagelgross, und
// zwischen zwei Standbildern steht nicht, was dazwischen passiert.
//
// Die Spur legt stattdessen die BAHN der Endeffektoren ueber die ganze
// Timeline in ein Bild:
//
//   die Bahn        zeigt die FORM der Bewegung — Bogen, Zickzack, Rueckschlag
//   der Abstand     zeigt das TIMING — eng ist langsam, weit ist schnell,
//                   ein Knaeuel ist Stillstand
//   ein Knick       zeigt den Richtungswechsel, den man in Zahlen suchen muesste
//
// Ein Animator liest eine Bewegung genau so.
//
// Diese Datei ist reine Geometrie: keine three.js, kein Canvas. Sie liefert
// Weltpunkte je Bahn; die Projektion ins Panel macht strip.js, das die Kamera
// kennt.

/**
 * Die Punkte, an denen man eine Bewegung liest.
 *
 * Haende und Fuesse tragen die Form — sie beschreiben die weitesten Bogen und
 * zeigen als Erste, wenn eine Bewegung bricht. Das Becken traegt die
 * Verlagerung des ganzen Koerpers. Mehr Bahnen machen das Bild zum Knaeuel:
 * bei acht Spuren ueberdecken sich die Linien und keine ist mehr lesbar.
 */
export const SPUR_ROLLEN = ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'pelvis'];

/** Farbe je Bahn. Links und rechts unterscheidbar, das Becken abgesetzt. */
export const SPUR_FARBEN = {
  hand_l: '#38bdf8',   // links hell
  hand_r: '#a78bfa',   // rechts violett
  foot_l: '#34d399',   // links gruen
  foot_r: '#fbbf24',   // rechts gelb
  pelvis: '#f472b6',   // Koerpermitte
};

/**
 * Die Bahnen der verfolgten Punkte ueber alle Frames.
 *
 * @param {object[]} frames  geloeste Frames mit `positions` (Knochen-id -> [x,y,z])
 * @param {object}   rollen  Rollenname -> Knochen-id, aus dem RigProfile
 * @returns {{rolle: string, knochen: string, punkte: {frame: number, welt: number[]}[]}[]}
 */
export function spurPunkte(frames, rollen) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const bahnen = [];

  for (const rolle of SPUR_ROLLEN) {
    const knochen = rollen?.[rolle];
    if (!knochen) continue;          // das Modell fuehrt diesen Punkt nicht

    const punkte = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const p = f?.positions?.[knochen];
      // Ein fehlender Punkt ueberspringt SEINEN Frame, er reisst die Bahn
      // nicht ab: sonst faellt das ganze Bild aus, weil ein Knochen fehlt.
      // Die Frame-Zahlen bleiben die echten, damit eine Luecke sichtbar ist
      // statt weggerechnet.
      if (!Array.isArray(p) || p.length < 3 || !p.every(Number.isFinite)) continue;
      punkte.push({ frame: Number.isInteger(f.index) ? f.index : i, welt: [p[0], p[1], p[2]] });
    }
    if (punkte.length === 0) continue;
    bahnen.push({ rolle, knochen, punkte });
  }
  return bahnen;
}

/**
 * Welche Frames eine Zahl ans Bild bekommen.
 *
 * Nicht jeder: bei 60 Frames stuenden 60 Zahlen im Bild und keine waere
 * lesbar. Gewaehlt werden Anfang, Ende und gleichmaessig verteilte Stuetzen
 * dazwischen — genug, um die Zeitachse auf der Bahn wiederzufinden.
 */
export const SPUR_MARKEN_MAX = 6;

export function spurMarken(frameZahlen) {
  const n = frameZahlen.length;
  if (n === 0) return new Set();
  if (n <= SPUR_MARKEN_MAX) return new Set(frameZahlen);
  const marken = new Set();
  for (let i = 0; i < SPUR_MARKEN_MAX; i++) {
    marken.add(frameZahlen[Math.round((i * (n - 1)) / (SPUR_MARKEN_MAX - 1))]);
  }
  return marken;
}
