# Charakteranimation für Agenten

Eine Web-Oberfläche, in der ein KI-Agent einen geriggten 3D-Charakter animiert — und
dabei zum ersten Mal sieht, was er tut.

Beitrag zur [OpenAI WebMCP Challenge](https://webmcp.devpost.com).

## Das Problem

Wer schon einmal versucht hat, einen KI-Agenten in Blender animieren zu lassen, kennt
das Ergebnis: Der Ellbogen steckt im Gesicht. Die Füße lösen sich vom Boden und
schweben. Arme wachsen durch den Brustkorb. Ein einfacher Einwurf beim Fußball wird zur
Körperverrenkung, ein Rückwärtssalto ist gar nicht erst möglich.

Das liegt nicht an mangelnder Intelligenz der Modelle. Es liegt daran, dass sie blind
arbeiten. 3D-Software ist für menschliche Augen gebaut. Am Ende jeder Aktion steht ein
gerendertes Bild — und darauf ist nicht zu erkennen, dass der Körperschwerpunkt aus der
Standfläche kippt, dass ein Fuß 18 Millimeter im Boden steckt oder dass ein Kniegelenk
in eine Richtung gebogen wurde, die es anatomisch nicht gibt.

## Die Idee

Eine Seite, die den Agenten sehend macht.

**Sie vermisst das Modell selbst.** Lade ein beliebiges geriggtes Humanoid hoch — egal
welche Rig-Konvention, egal wie viele Knochen, egal welches Namensschema. Die Seite
misst Körperhöhe, Massenverteilung, Fußsohlen, Gelenkachsen und Blickrichtung aus dem
Modell. Kein manuelles Zuordnen von Knochen.

**Sie gibt Zahlen statt Vermutungen.** Nach jedem Schritt bekommt der Agent einen
Messbericht: wo etwas den Boden durchdringt, in Zentimetern. Wo der Schwerpunkt kippt.
Welcher Fuß in welchem Frame rutscht. Dazu einen Bildstreifen aus mehreren
Blickwinkeln — beides, nie nur eins.

**Sie lässt ihn in Bewegungen denken, nicht in Winkeln.** Der Agent bestellt Abschnitte:
absenken, ausholen, abspringen, drehen, landen, abfedern. Die Seite rechnet daraus die
Körperhaltung aus — über Schwerpunkt und Fußkontakte, sodass Bodendurchdringung und
verdrehte Gelenke gar nicht erst entstehen können.

**Sie fragt nach, wenn es um Geschmack geht.** Zwei Varianten nebeneinander, ein Klick.
Kein Fachwissen nötig. Das ist der Teil, den nur WebMCP ermöglicht: Mensch und Agent
sitzen vor derselben laufenden Seite.

## Warum WebMCP

Messwerte und Löser könnte auch ein herkömmlicher MCP-Server liefern. Was nur WebMCP
kann, ist die gemeinsame Situation: Der Agent hält mitten in der Arbeit an, zeigt dir
zwei Landungen, wartet auf deinen Klick und baut mit deiner Antwort weiter. Ein
Server-Prozess kann das nicht — er hat keine Oberfläche, vor der du sitzt.

## Stand

Stand vom 31. August 2026. Getestet mit `node --test "src/**/*.test.mjs"` und den
Browser-Tests über Playwright: 186 Tests, davon 185 grün (173 Node-Tests: 172 grün,
1 rot; 13 Browser-Tests, alle grün). Der rote Test liegt in `src/rig/detect.test.mjs`
(Schulter-/Arm-Rollen um je ein Glied verschoben) und wird an anderer Baustelle
bearbeitet.

Gemessen und belegt:

- **Vermessung am Xbot** (67 Knochen, 28 374 Vertices): 18 Gelenke, 14 Segmente,
  8 Sohlenpunkte, 0 Warnungen, Körperhöhe 1,8093 m. Mit denselben Zahlen besteht das
  Profil `validateRigProfile`.
- **Phasenlöser**: eine haltbare Hocke erreicht 25,9 cm Tiefe — 14,3 % der
  Körperhöhe; darüber hinaus meldet der Löser den nicht haltbaren Rest mit Betrag.
  Ein Sprung liefert 3,23 m Schwerpunktweg und 360,0° Wurzeldrehung.
- **Werkzeugkatalog**: 16 Werkzeuge. Ein Agent (Qwen 3.8 Flash), der nur Namen und
  Beschreibungen sieht, wählt bei zehn Alltagsanfragen 10 von 10 Mal das richtige
  Werkzeug (`spikes/test-a3-load/AGENTENTEST.md`).
- **glTF-Export**: wird unabhängig wieder eingelesen und geprüft; eine Ortsveränderung
  von 2 m überlebt den Export (`src/export/gltf.test.mjs`).
- **WebMCP-Transport** (Chrome 151): Werkzeuge lassen sich nach dem Upload zur Laufzeit
  erzeugen (gemessen 5 → 45, alle aufrufbar); Antworten bis 512 KB kommen in
  5 Millisekunden vollständig durch; ein Werkzeug kann auf den Klick des Menschen
  warten und die Antwort im selben Aufruf liefern (gemessen 3,1 s); Bilder funktionieren
  neben Text in derselben Antwort.
- **Gemessene Körpergeometrie schlägt geschätzte**: geschätzte Radien, Massen und
  Kontaktpunkte erzeugten 269 Fehlalarme auf einem Clip, in dem die Figur ruhig steht;
  nach der Umstellung auf Vermessung verschwanden Bodendurchdringung und Balancefehler
  vollständig.

Nicht fertig ist: das Verhalten eines echten Browser-Agenten am laufenden Produkt, die
Demonstrationsbewegung als abspielbarer Clip für den Wettbewerb, und der Abschluss des
Workflows „Upload → Vermessung → Phasen auftragen → Export“ in der Oberfläche. Details
dazu stehen in [`docs/abgabe.md`](docs/abgabe.md), Abschnitt „Not finished“.

## Aufbau

| Datei | Inhalt |
|---|---|
| [`VISION.md`](VISION.md) | das Ziel in kurz |
| [`docs/plan.md`](docs/plan.md) | Design, Datenformate, Architektur |
| [`docs/umsetzung.md`](docs/umsetzung.md) | Arbeitspakete und ihre Abnahmetests |
| [`docs/challenge.md`](docs/challenge.md) | Bedingungen des Wettbewerbs |
| [`AGENTS.md`](AGENTS.md) | Arbeitsanweisungen für alle, die hier mitbauen |
| `spikes/` | Wegwerfcode aus Vorabtests, samt Messergebnissen |

## Lizenz

MIT, siehe [LICENSE](LICENSE).
