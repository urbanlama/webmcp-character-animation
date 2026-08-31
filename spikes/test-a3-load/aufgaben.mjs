// A3 — Agentenlast: Aufgabensammlung fuer den Beschreibungspruefstand.
//
// Sieben Aufgaben in Alltagssprache. Zu jeder das Werkzeug, das nach den
// Beschreibungen aus src/tools/catalog.js die richtige Antwort ist.
//
// Typ: 'standard'  — normale Nutzerformulierung, Abnahme verlangt 5 von 5 Treffern.
// Typ: 'aehnlich'  — absichtlich schwer: zwei Werkzeuge aehnlich klingen.
//                    Danebengreifen ist hier ein gueltiges Ergebnis und wird in
//                    ERGEBNIS.md aufgeschrieben, nicht wegdefiniert.

export const AUFGABEN = [
  {
    id: 'A1',
    typ: 'standard',
    frage: 'Wie groß ist die Figur eigentlich, und wo ist der Boden?',
    richtig: 'describe_world',
    begruendung: 'Figurgröße und Bodenhöhe stehen laut Beschreibung direkt im Weltvertrag.'
  },
  {
    id: 'A2',
    typ: 'standard',
    frage: 'Lass die Figur einen Schritt nach links machen — geh mal eben grob vor, Details überleg ich mir später.',
    richtig: 'add_phase',
    begruendung: 'Eine Bewegungsphase (Verb step) anlegen ist der Bauweg; set_target wäre ein Einzelziel für einen Frame, nicht ein Bewegungsabschnitt.'
  },
  {
    id: 'A3',
    typ: 'aehnlich',
    frage: 'Das Bein soll am Ende bei Frame 40 genau auf 0,35 m Höhe stehen.',
    richtig: 'set_target',
    griffig: 'set_joint',
    begruendung: 'Ein Positionsziel in Metern für einen Endeffektor bei einem Frame — set_joint setzt einen Winkel in Grad, nicht eine Weltposition.',
    konflikt: 'Beide wirken auf einen Koerperteil bei einem Frame; Meter gegen Grad ist der einzige nennbare Unterschied, und er steht nur in der Kopfzeile.'
  },
  {
    id: 'A4',
    typ: 'aehnlich',
    frage: 'Zeig mir, ob das insgesamt alles so in Ordnung aussieht.',
    richtig: 'validate',
    griffig: 'look',
    begruendung: 'Gesamtprüfung mit Bericht und Bildstreifen der kritischen Frames — look zeigt nur gewählte Frames, prüft aber nichts.',
    konflikt: 'validate liefert selbst einen Bildstreifen; „aussieht“ und „Bildstreifen“ schieben den Agenten Richtung look, obwohl nach einer Prüfung gefragt ist.'
  },
  {
    id: 'A5',
    typ: 'standard',
    frage: 'Das gefällt mir nicht, mach es rückgängig.',
    richtig: 'undo',
    begruendung: 'Beschreibung nennt „letzte Änderung zurücknehmen“ wörtlich.'
  },
  {
    id: 'A6',
    typ: 'standard',
    frage: 'Zeil mir von vorn und von der Seite, wie das gerade aussieht.',
    richtig: 'look',
    begruendung: 'Bildstreifen aus gewählten Frames und Ansichten — front und side sind die genannten Ansichten.'
  },
  {
    id: 'A7',
    typ: 'standard',
    frage: 'Bieg mal kurz das linke Hüftgelenk, dass ich sehe was da passiert.',
    richtig: 'probe_joint',
    begruendung: 'Probeweises Beugen eines Gelenks mit Vorher/Nachher-Bild, Winkelbereich -90 bis 90.'
  }
];

/** Auszählung fuer die Abnahme: 5 Standardaufgaben muessen treffen. */
export function standardAufgaben() {
  return AUFGABEN.filter(a => a.typ === 'standard');
}

export function aehnlicheAufgaben() {
  return AUFGABEN.filter(a => a.typ === 'aehnlich');
}