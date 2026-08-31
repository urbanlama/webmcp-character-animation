// A3 — Agentenlast: recorded Agenten-Entscheidungen.
//
// Das ist das eigentliche Messinstrument. Die Entscheidungen wurden von der
// ausfuehrenden Sitzung (diesem Agenten) getroffen, NUR aus name + description
// der 16 Eintraege in src/tools/catalog.js — ohne handlers.js, ohne UI, ohne
// plan.md. Sie sind hier festgehalten, damit der Test sie gegen die richtige
// Antwort pruefen kann.
//
// Wichtig und ehrlich gesagt: Die entscheidende Sitzung hat den Katalog auch
// gebaut bzw. gelesen (Bias). Das steht mit in ERGEBNIS.md.

/** Entscheidung je Aufgaben-Id: gewaehltes Werkzeug und der Wortlaut, der
 *  die Entscheidung getragen hat — zitiert aus der Beschreibung. */
export const ENTSCHEIDUNGEN = {
  A1: {
    wahl: 'describe_world',
    grund: 'Beschreibung nennt wörtlich „Figurgröße“ und „Bodenhöhe“ — genau die zwei Fragen.'
  },
  A2: {
    wahl: 'add_phase',
    grund: '„Bewegungsphase anlegen“ passt zum Bewegungswunsch; „grob vor“ heißt: erst anlegen, später edit_phase.'
  },
  A3: {
    wahl: 'set_target',
    grund: 'Ein Weltpunkt in Metern für ein Körperende bei einem festen Frame — „Ziel … Endeffektor … in Metern“ nennt set_target; set_joint verlangt einen Winkel in Grad, und 0,35 m ist kein Winkel.'
  },
  A4: {
    wahl: 'validate',
    grund: '„ob das alles in Ordnung ist“ ist eine Prüfaufgabe; validate „prüft die gesamte Timeline“ und liefert selbst den Bildstreifen. Das „zeig mir“ allein wäre look, aber das Prüfmotiv wiegt schwerer.'
  },
  A5: {
    wahl: 'undo',
    grund: '„Nimmt die letzte Änderung … zurück“ — die Beschreibung sagt „zurück“, die Frage sagt „rückgängig“; semantisch eindeutig.'
  },
  A6: {
    wahl: 'look',
    grund: 'Bildstreifen aus gewählten Frames und Ansichten; „von vorn und von der Seite“ entspricht front/side.'
  },
  A7: {
    wahl: 'probe_joint',
    grund: '„Beugt ein Gelenk probeweise … und liefert Vorher/Nachher als Bild“ — probeweises Bewegen mit Bild ist genau die Frage.'
  }
};

/** Liest die Entscheidung fuer eine Aufgabe; wirft mit Zahl, wenn sie fehlt. */
export function entscheidung(aufgabe) {
  const e = ENTSCHEIDUNGEN[aufgabe.id];
  if (!e) {
    throw new Error(`Aufgabe ${aufgabe.id} hat keine aufgezeichnete Entscheidung; ${Object.keys(ENTSCHEIDUNGEN).length} Entscheidungen sind vorhanden`);
  }
  return e;
}