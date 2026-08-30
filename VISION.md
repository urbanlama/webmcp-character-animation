# Vision

## Das Problem

Einen geriggten 3D-Charakter zu animieren ist für Agents heute nicht schwer, sondern
unmöglich. Nicht knapp daneben — grundsätzlich.

Wer einen Agenten über einen MCP-Server in Blender schickt, bekommt einen Ellbogen, der
im Gesicht steckt. Füße, die vom Boden abheben und schweben. Gliedmaßen, die durch den
eigenen Körper wachsen. Ein Agent, der nicht einmal weiß, wo bei der Figur vorne ist.
Ein Rückwärtssalto ist außer Reichweite, und zwar nicht schlecht, sondern gar nicht.

## Warum

Nicht wegen mangelnder Intelligenz. Weil sie blind arbeiten.

Blender ist für menschliche Augen gebaut, nicht für Werkzeugaufrufe. Am Ende jeder
Aktion steht ein gerendertes Bild, und darin ist nicht zu erkennen, dass der Arm den
Kopf durchdringt, dass der Schwerpunkt aus der Stützfläche kippt, dass der Fuß
18 Millimeter im Boden steckt oder dass ein Gelenk in eine Richtung gebogen wurde,
die es anatomisch nicht gibt.

Bild ist gut. Bild ist okay. Bild reicht nicht.

## Was wir bauen

Eine Web-Oberfläche, in der ein Agent einen Charakter animieren kann, ohne dabei blind
zu sein.

**Universell.** Jeder lädt sein geriggtes Modell hoch. Egal welche Konvention, egal wie
viele Knochen, egal welches Namensschema. Kein manuelles Mapping.

**Selbstvermessend.** Die Seite misst das Skelett, statt Annahmen zu treffen. Radien,
Massenverteilung, Fußsohlen, Gelenkachsen, Blickrichtung — alles aus dem Modell
abgeleitet, nichts gesetzt.

**Orientiert.** Der Agent weiß vom ersten Moment an, wo oben, vorne und links ist, wie
groß die Figur ist und was den Boden berührt. Diese Orientierung ist nicht erfragbar,
sie ist selbstverständlich.

**Abgestuft.** Der Agent arbeitet auf der Ebene von Bewegungsphasen, nicht auf einzelnen
Gelenkwinkeln. Braucht er es genauer, geht er eine Ebene tiefer. Ganz unten kann er
jedes Gelenk einzeln anfassen — aber er muss es nicht.

**Messend.** Nach jedem Schritt bekommt er Zahlen: Wo steckt was im Boden, in
Millimetern. Wo kippt der Schwerpunkt, in Zentimetern. Wo rutscht ein Fuß, in welchem
Frame. Dazu annotierte Bilder aus festen Blickwinkeln — beides, nicht eins davon.

**Gemeinsam.** Wo Zahlen nicht weiterhelfen, fragt der Agent den Menschen. In
Alltagssprache, beantwortbar mit einem Klick. Kein Motion Designer nötig. Das ist der
Punkt, den nur WebMCP kann: Mensch und Agent sitzen vor derselben laufenden Seite.

## Der Maßstab

Man tippt in den Chat, was passieren soll. Anlauf, Absprung, Rückwärtssalto, Landung,
Jubel. Man drückt Play und sieht eine Animation, die es vorher nicht gab und die
niemand aus einer Bibliothek geholt hat.

Der Anspruch ist nicht "brauchbar für einen Hackathon". Der Anspruch ist, dass ein
Animator nickt.

## Was wir gemessen haben, nicht geglaubt

Ein erster Versuch mit rohen Keyframe-Werkzeugen und Messfeedback ist gescheitert —
mit dem stärksten verfügbaren Modell. Heraus kam eine Drehung ohne Absprung, ohne
Vorbereitung, ohne Landung. Ein Drittel der Zeitachse bewegungslos.

Daraus die zwei Sätze, die diesem Projekt seine Form geben:

**Messfeedback ist notwendig, aber nicht hinreichend.**

**Fehlerfreiheit ist kein Erfolg.** Eine Animation, in der nichts passiert, besteht jede
Prüfung.

Und ein dritter, der beim Bauen der Messschicht herauskam: Geratene Zahlen sind
wertlos. Geschätzte Körpermaße erzeugten 269 Fehlalarme auf einem Clip, in dem eine
Figur ruhig dasteht. Gemessene erzeugten null.

**Keine Körpergröße wird gesetzt. Jede wird gemessen.**
