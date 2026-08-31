# Werkzeugkatalog — vollständige Beschreibungen (plan.md 5.5)

Quelle: `docs/plan.md` Abschnitt 5.5, Stand 2026-08-30. Von der Leitung gepflegt.

Diese Datei ist die Kopiervorlage für AP7 (Registrierung) und die A3-Attrappe. Der
Beschreibungstext ist so formuliert, wie er dem Agenten angezeigt wird. Änderungen nur
über die Leitung, vorher in `BRETT.md` gemeldet — nie divergent zu `docs/plan.md` 5.5.

## Bezugssätze

- Oben = +Y, Charakter-vorne = +Z, links = +X. Bühne-vorne ist eine andere Richtung;
  Parameter mit `stage` im Namen beziehen sich auf die Bühne.
- Längen in Metern in Weltkoordinaten, wenn nichts anderes steht.
- Winkel in Grad, Dauern in Sekunden, Frames ganzzahlig, Framerate laut Timeline-Vertrag.
- Größen relativ zur Körperhöhe stehen ausdrücklich als Anteil (0.35 = 35 % der
  Körperhöhe); die Körperhöhe steht in `describe_world`.
- Vorzeichen wirken in der Achse und mit dem Vorzeichen, wie `describe_rig` es pro
  Gelenk meldet.

## Die sechzehn Beschreibungen

1. `describe_world` — „Liefert den Weltvertrag: oben, vorne, links, Bodenhöhe, Maßstab und Figurgröße.“
2. `describe_rig` — „Liefert Rollen, Gelenke, Freiheitsgrade mit Achsen, Vorzeichen und Grenzwerten sowie alle Zuordnungen mit Konfidenz unter 1 und ihre Vermessungsquelle.“
3. `describe_body` — „Liefert das gemessene Körperprofil: Segmente mit Radius und Masse in Metern und Kilogramm, Sohlenpunkte in Knochen-lokalen Metern, Ruheabstände in Metern und alle Verfahrensparameter mit Begründung.“
4. `probe_joint` — „Beugt ein Gelenk probeweise (biegt es testweise, um zu sehen/zu schauen, was passiert), um z. B. ein Hüft- oder Kniegelenk kurz auszutesten, und liefert Vorher/Nachher als Bild. Der Winkel ist in Grad, das Vorzeichen wirkt in dem in describe_rig genannten Bezugssystem des Gelenks.“ Parameter: `{joint: string, angleDeg: number (-90..90)}`.
5. `confirm_role` — „Bestätigt oder korrigiert eine Zuordnung von Rolle zu Knochen; gilt nach Bestätigung als gemessen.“ Parameter: `{role: string, bone: string}`.
6. `set_intent` — „Legt die Erfolgskriterien der Bewegung fest — was am Ende erreicht sein muss (Drehung, Sprungweite, Bodenkontakt, Abstände), nicht wie lang die Animation insgesamt dauert; dafür dient set_duration. Alle Längen in Anteilen der Körperhöhe, alle Winkel in Grad, alle Zeiten in Sekunden. Wird vor dem Bauen vom Menschen bestätigt.“ Parameter: `{checks: [{kind, ...}]}` je Baustein aus plan.md 7.2 (Absicht).
7. `set_duration` — „Setzt, wie lang die Animation insgesamt dauert — die Gesamtlänge in Sekunden ausgedrückt, angegeben als framerate-abhängige Frame-Anzahl: bei der im Timeline-Vertrag genannten Framerate entspricht eine Sekunde der Framerate an Frames. Legt den Zeitrahmen fest; die inhaltlichen Erfolgskriterien setzt set_intent.“ Parameter: `{frameCount: int (12..600)}`.
8. `add_phase` — „Legt eine Bewegungsphase an, z. B. einen Schritt nach links (Verb step), einen Sprung (takeoff/airborne/land) oder eine Drehung (turn) — baut also einen gesamten Bewegungsabschnitt statt eines Einzelziels. Zeiten in Frames, Phase-Parameter in den Einheiten des Verbs (Tiefe in Anteilen der Körperhöhe, Geschwindigkeit in Körperhöhen pro Sekunde, Winkel in Grad). Verben und Parameter: plan.md 6.3.“ Parameter: `{verb, from, to, params}`.
9. `edit_phase` — „Ändert oder entfernt eine bestehende Phase. Dieselben Einheiten wie add_phase. Änderungen sind über undo rückgängig zu machen.“ Parameter: `{id, from?, to?, params?, remove?}`.
10. `set_target` — „Setzt für einen einzelnen Frame ein Ziel für einen Endeffektor oder den Schwerpunkt, in Metern, Weltkoordinaten des Weltvertrags — also eine Wunschposition wie „das Bein soll bei Frame 40 auf 0,35 m stehen“, nicht einen Gelenkwinkel; Winkel in Grad setzt set_joint. Wird vom Löser angestrebt und kann ihm nicht gelingen; das steht dann im Bericht.“ Parameter: `{frame: int, part: string, pos: [m, m, m]}`.
11. `set_joint` — „Setzt für einen einzelnen Frame einen Gelenkwinkel in Grad, Vorzeichen und Achse wie in describe_rig.“ Parameter: `{frame: int, joint: string, angleDeg: number, channel: 'bend'|'twist'|'swing'}`.
12. `undo` — „Nimmt die letzte Änderung zurück, macht sie also rückgängig: den letzten Schritt an Phasen oder Overrides, z. B. wenn das Ergebnis dem Menschen nicht gefällt.“ Parameter: keine.
13. `validate` — „Prüft, ob die gesamte Timeline in Ordnung ist — phasenabhängig, mit vollständigem Bericht und einem Bildstreifen der kritischen Frames. Anders als look zeigt es nicht nur, sondern prüft und beanstandet. Alle Zahlen in den Einheiten des Weltvertrags (Meter, Grad, Sekunden).“ Parameter: keine.
14. `look` — „Zeigt, wie die Figurenbewegung aussieht: erzeugt einen Bildstreifen aus gewählten Frames und Ansichten — front = von vorn, side = von der Seite, quarter = aus dem Viertel, top = von oben — im Charakter-Bezugssystem, immer annotiert. Ansinnen wie „zeig mir von vorne/von der Seite, wie das aussieht“ gehört hierher. Prüft nichts und beanstandet nichts; zum Prüfen dient validate. Frames ganzzahlig im Timeline-Bezug.“ Parameter: `{frames: [int], views: [string]}`.
15. `ask_human` — „Stellt dem Menschen eine Frage mit Antwortmöglichkeiten und wartet auf einen Klick; die Antwort kommt im selben Aufruf zurück. Budget: siehe UI-Anzeige.“ Parameter: `{question: string, options: [string]}`.
16. `export_clip` — „Exportiert die Timeline als glTF mit Wurzelbewegung in Meter, Y-oben, Charakter-vorne +Z. Rotationen als Quaternionen.“ Parameter: keine.

## Fehlermeldungen

Alle Werkzeuge nennen Wert, erlaubten Bereich und nächsten Schritt, z. B.:
„frame 640 liegt außerhalb der Timeline von 0 bis 599; setze frameCount zuerst mit set_duration“.