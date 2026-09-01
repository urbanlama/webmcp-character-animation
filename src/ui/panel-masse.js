// Verfahrensparameter der Frage-Panelbreite, zentral statt in zwei Dateien
// verteilt (frage-panel.js legt sie als Inline-Stil an, ein Test hier prüft
// das gegen denselben Wert). Befund 2 aus der Browser-Sichtprüfung: das Panel
// wuchs mit jeder Frage, die Figur wurde von 490 px auf 430 px Breite kleiner.
// Die 420 px Obergrenze ist die bereits in index.html verankerte
// `clamp(300px, 30vw, 420px)`-Grenze der Seitenleiste — hier wird sie
// ausschöpfend festgenagelt, statt neu erfunden.

/** Maximale Panelbreite in px. Entspricht der 420 px-Grenze aus index.html. */
export const PANEL_BREITE_MAX = 420;