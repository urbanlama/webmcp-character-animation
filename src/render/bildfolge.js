// Bildfolge — der Ablauf einer Bewegung als Folge GROSSER Einzelbilder.
//
// Zwei Wege dahin waren falsch (docs/journal/buehne-befunde-2026-09-02.md):
//
//   Der Bildstreifen klebte bis zu sechs Frames in EIN PNG. Jede Figur wurde
//   fingernagelgross; am Bild belegt, dass darauf nichts zu erkennen ist.
//
//   Die Bewegungsspur legte die Bahnen aller Endeffektoren in ein Bild. Sie
//   zeigte einen Standweitsprung brauchbar, verlangt aber Deutung: die
//   Zeitrichtung steht nur in den Frame-Zahlen, und bei einer Bewegung, die
//   denselben Weg mehrfach laeuft — drei Rueckwaertssaltos — ueberlagern sich
//   die Bahnen zu einem Knaeuel.
//
// Der dritte Weg ist der einfachste: mehrere Bilder in EINER Antwort, jedes in
// voller Groesse. Das MCP-Antwortformat traegt beliebig viele image-Bloecke;
// sie muessen nicht in ein PNG gezwungen werden. Ein Daumenkino aus klaren
// Bildern statt einer Zeichnung, die gedeutet werden will.

/**
 * Wie viele Bilder eine Antwort traegt.
 *
 * Gemessen am Xbot: ein Einzelbild in voller Groesse (640 x 800) liegt bei rund
 * 150 KB, als Base64 ein Drittel mehr — rund 200 KB. Das Antwortbudget sind
 * 512 KB (ANTWORT_MAX_BYTES), dazu kommt der Text. Drei Bilder passen, vier
 * nicht mehr zuverlaessig. Unter zwei Bildern waere es kein Ablauf.
 */
export const FOLGE_BILDER = 3;

/**
 * Wie gross die Bilder einer Folge sind, als Anteil der vollen Bildgroesse.
 *
 * Gemessen am Xbot: drei Bilder in voller Groesse ergeben 550 KB Antwort, das
 * Budget sind 512 KB (ANTWORT_MAX_BYTES). 0,85 senkt die Flaeche auf 72 % und
 * bringt die Antwort mit Reserve durch — 544 x 680 px je Bild, immer noch das
 * Vierfache der alten Rasterkachel (300 x 380), auf der nachweislich nichts zu
 * erkennen war.
 */
export const FOLGE_SKALA = 0.85;

/**
 * Welche Frames die Folge zeigt: gleichmaessig ueber den Bereich verteilt,
 * Anfang und Ende immer dabei.
 *
 * Warum gleichmaessig und nicht an den Schluesselbildern: der Agent will
 * sehen, wie die Bewegung LAEUFT, nicht wo er zuletzt etwas gesetzt hat. Die
 * gesetzten Haltungen stehen ohnehin in jeder set_pose-Antwort.
 *
 * @param {number} von  erster Frame des Bereichs
 * @param {number} bis  letzter Frame des Bereichs (einschliesslich)
 * @param {number} n    wie viele Bilder
 * @returns {number[]}  aufsteigend, ohne Wiederholung
 */
export function folgeFrames(von, bis, n) {
  const a = Math.min(von, bis);
  const b = Math.max(von, bis);
  const spanne = b - a;
  if (spanne <= 0) return [a];

  // Weniger Frames als Bilder: jeden einmal, keine Dubletten.
  if (spanne + 1 <= n) {
    return Array.from({ length: spanne + 1 }, (_, i) => a + i);
  }
  const raus = [];
  for (let i = 0; i < n; i++) {
    raus.push(a + Math.round((i * spanne) / (n - 1)));
  }
  return [...new Set(raus)].sort((x, y) => x - y);
}
