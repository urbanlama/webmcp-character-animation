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

In Entwicklung. Was bereits gemessen und belegt ist, steht in [`docs/plan.md`](docs/plan.md):

- Werkzeuge lassen sich nach dem Upload zur Laufzeit erzeugen
- Messberichte bis 512 KB kommen in 5 Millisekunden durch
- Ein Werkzeug kann auf den Klick eines Menschen warten und mit dessen Antwort
  weiterarbeiten
- Bilder funktionieren in Werkzeugantworten, zusammen mit Text
- Gemessene Körpergeometrie beseitigt Fehlalarme, die geschätzte erzeugt: 269 auf einem
  Clip, in dem eine Figur ruhig dasteht, gegenüber null

## Aufbau

| Datei | Inhalt |
|---|---|
| [`VISION.md`](VISION.md) | das Ziel in kurz |
| [`docs/plan.md`](docs/plan.md) | Design, Datenformate, Arbeitspakete, Abnahmetests |
| [`docs/challenge.md`](docs/challenge.md) | Bedingungen des Wettbewerbs |
| [`AGENTS.md`](AGENTS.md) | Arbeitsanweisungen für alle, die hier mitbauen |
| `spikes/` | Wegwerfcode aus Vorabtests, samt Messergebnissen |

## Lizenz

MIT, siehe [LICENSE](LICENSE).
