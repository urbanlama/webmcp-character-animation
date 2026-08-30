# Design: Agentengesteuerte Charakteranimation im Browser

Beitrag zur OpenAI WebMCP Challenge. Abgabe: 3. September 2026, 13:00 PT.

## Bewertungskriterien der Challenge

Vier Kriterien, gleich gewichtet (Quelle: `docs/challenge.md`):

1. **WebMCP Leverage** — echte, nicht triviale Nutzung von WebMCP
2. **Execution** — vollständiges, stimmiges Produkt, kein Proof of Concept
3. **Potential Impact** — echtes Problem, echte Zielgruppe
4. **Creativity & Ambition**

Für die Architektur heißt das vor allem: Der WebMCP-Anteil darf nicht dekorativ sein.
Messschicht, Löser und Retargeting wären in einem klassischen MCP-Server identisch. Was
nur WebMCP kann, ist die gemeinsame sichtbare Situation — Mensch, Agent, Modell und
Diagnose in derselben laufenden Seite. Die Mensch-Schleife ist deshalb kein Zusatz,
sondern das Kernstück.

## Was gebaut wird

Eine Webseite, in die man ein beliebiges geriggtes Humanoid-Modell lädt. Die Seite
vermisst das Skelett selbst und erzeugt daraus die Werkzeuge, die ein Agent für
genau dieses Modell braucht. Der Mensch schreibt im Chat, was animiert werden soll.
Der Agent baut die Animation, sieht nach jedem Schritt Messwerte statt nur Bilder,
und fragt den Menschen, wo Zahlen nicht weiterhelfen. Ergebnis ist ein abspielbarer
und exportierbarer Clip.

## Was vorher gemessen wurde

Zwei Vorabtests, beide durchgeführt. Ihre Ergebnisse bestimmen die Architektur.

### Test A — WebMCP-Grenzen (Chrome 151, gemessen)

| Frage | Ergebnis |
|---|---|
| Werkzeuge zur Laufzeit nachregistrieren | funktioniert, 5 → 45 Werkzeuge, alle aufrufbar |
| Antwortgröße | 512 KB in 5 ms, vollständig |
| 50 Aufrufe am Stück | 16 ms, fehlerfrei |
| Werkzeug wartet auf Klick des Menschen | funktioniert, Antwort kommt im selben Aufruf zurück |

API-Fakten: `document.modelContext.registerTool({name, description, inputSchema, execute})`.
`execute` liefert `{content:[{type:'text',text}]}`. Zusätzlich existieren `getTools()`
und `executeTool(tool, argsAlsJsonString)` — die Seite kann ihre eigenen Werkzeuge
aufrufen, was Regressionsläufe ohne Agent ermöglicht.

Ungeklärt: wie ein echter Browser-Agent mit 45 Werkzeugen umgeht und wie viele
Aufrufe er freiwillig macht. Kein ChatGPT-Browser verfügbar.

### Test B — Kann ein Agent mit Messfeedback animieren?

Aufbau: festes Mixamo-Rig, Keyframe-Werkzeuge auf Gelenkebene, vier Validatoren,
Bildausgabe. Agent: Fable 5 auf hoher Reasoning-Stufe, ohne Zugriff auf den Quellcode.
Auftrag: Rückwärtssalto aus dem Stand.

Ergebnis nach zwanzig Minuten: eine Drehung ohne Absprung. Ein Drittel der Timeline
bewegungslos, kaum Flughöhe, harte Übergänge, keine Vorbereitung, keine Landung.
Der Agent hat in dieser Zeit **kein einziges Bild** gerendert und rein nach Zahlen
gearbeitet.

Drei Schlüsse:

1. **Messfeedback ist notwendig, aber nicht hinreichend.** Ohne Messung geht nichts,
   mit Messung allein aber auch nicht.
2. **Gelenkwinkel sind die falsche Aktionsebene.** Der Agent muss Phasen bestellen,
   nicht Winkel setzen.
3. **Fehlerfreiheit ist kein Erfolg.** Eine Animation, in der nichts passiert, besteht
   jede Prüfung.

### Nebenbefund: Geratene Zahlen sind wertlos

Bei der Entwicklung der Messschicht wurden Kapselradien, Massenverteilung und
Fußkontaktpunkte zunächst geschätzt. Ergebnis: 269 Fehlalarme auf einem Mocap-Clip,
in dem eine Figur ruhig dasteht.

Nach Umstellung auf gemessene Werte — Radien aus Vertexabständen zur Knochenachse,
Massen aus Kapselvolumen, Sohlen aus der Bodennähe in Bind-Pose, erlaubte
Berührungsabstände aus Referenzbewegung — sank die Zahl auf **null** bei fünf von
sieben Clips. Die verbleibenden zwei laufen auf der Stelle und rutschen tatsächlich.

Ebenso falsch waren die Gelenkachsen: Links-Rechts-Spiegelung fehlte, Hüftbeugung
wirkte rückwärts, die Beckendrehung war wirkungslos. Alle drei wurden durch
automatisches Abtasten gefunden und korrigiert.

**Regel für den Plan: Keine Körpergröße wird gesetzt. Jede wird gemessen.**

## Architektur

### Schicht 1 — Rig-Verständnis

Eingabe: glTF/GLB mit Skin und Bind-Pose. Ausgabe: ein Rig-Profil.

Was gemessen wird:

- Symmetrieebene aus Bind-Pose-Positionen, daraus Links/Rechts-Paare
- Mittelkette (Becken, Wirbelsäule, Hals, Kopf) aus Knochen nahe der Symmetrieebene
- Gliedmaßen als längste abzweigende Ketten, sortiert nach Richtung gegen die Up-Achse
- Endeffektoren, Finger, Scharniergelenke aus der Bind-Pose-Geometrie
- Körperhöhe, Bodenebene, Maßstab — alle Toleranzen relativ zur Körperhöhe
- Kapselradien aus Vertexabständen zur Segmentachse
- Massenanteile aus Kapselvolumen bei konstanter Dichte
- Sohlenpunkte rein geometrisch: was in Bind-Pose nahe am Boden liegt
- Vorzeichen jedes Freiheitsgrades durch Abtasten: +20° anwenden, Wirkung messen,
  Vorzeichen drehen, wo Name und Wirkung nicht zusammenpassen

Jede Zuordnung trägt eine Konfidenz. Unsichere Zuordnungen werden nicht geraten,
sondern gemeldet.

### Schicht 2 — Weltvertrag

Ein Dokument, auf das sich jedes Werkzeug bezieht und das in jeder Antwort mitschwingt:
Oben, Boden, Blickrichtung, Links, Maßstab. Ausdrücklich getrennt: Bühnen-vorne und
Charakter-vorne. Jedes Werkzeug nennt in seiner Beschreibung, in welchem Bezugssystem
es arbeitet.

### Schicht 3 — Aktionsebenen

Der Agent wählt die Ebene selbst und geht tiefer, wenn das Ergebnis nicht passt oder
der Mensch es verlangt.

**Ebene 1, Phasen.** Ein Aufruf pro Bewegungsabschnitt: absenken, ausholen, abspringen,
drehen, strecken, landen, abfedern. Parameter sind Dauer, Stärke, Richtung. Das System
erzeugt daraus Posen und Zwischenwerte. Hier arbeitet der Agent normalerweise.

**Ebene 2, Ziele.** Endeffektor-Positionen, Schwerpunktbahn, Blickrichtung. Ein Löser
rechnet die Gelenke aus. Für Fälle, in denen Ebene 1 nicht genau genug trifft.

**Ebene 3, Gelenke.** Direkter Zugriff auf Winkel. Jederzeit erlaubt, Validatoren laufen
mit. Für Feinheiten, die keine Abstraktion vorhergesehen hat.

Test B hat gezeigt: Ebene 3 allein reicht nicht. Ebene 1 ist die Voraussetzung dafür,
dass überhaupt etwas Brauchbares entsteht.

### Schicht 4 — Garantien statt Prüfungen

Was das System erzwingt, muss nicht geprüft werden:

- Fußanker: ein Fuß, der über mehrere Frames Kontakt hat, bleibt an derselben Stelle
- Ballistik: in Flugphasen folgt der Schwerpunkt einer Parabel, der Drehimpuls bleibt
  konstant
- Gelenkgrenzen: Winkel werden beim Setzen in den erlaubten Bereich gebracht, mit
  Rückmeldung darüber
- Bodenkontakt: kein Körperteil sinkt unter y = 0

### Schicht 5 — Die drei Validierungsschichten

**Physik — gilt immer, kennt keine Bewegungsart.**
Bodendurchdringung, Selbstdurchdringung, Gelenkgrenzen, Fußrutschen bei Kontakt,
Balance bei Bodenkontakt, ballistische Bahn in der Flugphase. Alle phasenabhängig:
Balance wird im Flug nicht geprüft.

**Absicht — vom Agenten formuliert, vom Menschen bestätigt.**
Der Agent schreibt vor dem Bauen auf, woran die Bewegung zu erkennen ist. Aus einem
festen Satz messbarer Bausteine:

| Baustein | Einheit |
|---|---|
| Drehung um eine Achse über einen Frame-Bereich | Grad |
| Flugphase | Sekunden, Scheitelhöhe in Metern |
| Ortsveränderung | Meter, Richtung |
| Kontaktwechsel | welcher Fuß, welcher Frame |
| Abstand zweier Körperteile | Zentimeter, Mindestdauer |
| Höhe eines Körperteils | Meter |
| Tempo eines Körperteils | Meter pro Sekunde |

Beispiel Rückwärtssalto: Drehung ≥ 350° um die Querachse, Flugphase ≥ 0,4 s, Landung
auf beiden Füßen, Endposition höchstens 50 cm vom Start.

Der Validator kennt keine Bewegungsart. Er misst Winkel, Zeiten und Abstände.

**Stil — bewegungsunabhängige Qualität.**

- Bewegungsdichte: Anteil der Frames mit tatsächlicher Veränderung
- Antizipation: Gegenbewegung vor der Hauptbewegung vorhanden
- Ruckfreiheit: keine Sprünge in der Beschleunigung

Diese drei hätten jeden Fehler aus Test B gefunden, ohne zu wissen, was ein Salto ist.

### Schicht 6 — Der Mensch

Kein Notausgang, sondern Bestandteil des Ablaufs. Drei feste Momente:

1. **Nach dem Upload:** unsichere Rig-Zuordnungen bestätigen. Der fragliche Knochen
   leuchtet, Antwort ist ja oder nein.
2. **Vor dem Bauen:** die Absichtskriterien bestätigen. "Ich baue 360° Rückwärtsdrehung,
   0,5 s Flug, Landung auf beiden Füßen." Fünf Sekunden statt zwanzig Minuten.
3. **Bei Geschmacksfragen:** zwei Varianten nebeneinander, beide als Schleife, ein Klick.

Alle Fragen in Alltagssprache, alle als Klick oder Regler beantwortbar. Budget:
standardmäßig drei Fragen pro Auftrag, einstellbar.

Technisch bestätigt durch Test A: Ein Werkzeug kann hängen, bis geklickt wird.

### Schicht 7 — Sehen

Feste, benannte Ansichten im Charakter-Bezugssystem: vorn, hinten, links, rechts, oben,
dreiviertel. Mehrere Ansichten in einem Aufruf als ein Bild. Immer annotiert mit
Achsenkreuz, Bodengitter mit Maßstab, Schwerpunkt, Stützpolygon, Kontaktpunkten.

Aus Test B: Der Agent schaut von selbst nicht hin. Deshalb hängt an jedem
Validierungsergebnis automatisch ein Bildstreifen der kritischen Frames — er bekommt
das Bild, ohne danach zu fragen.

### Schicht 8 — Export

glTF mit Wurzelbewegung. Ohne Export ist das Ergebnis eine Vorführung, kein Werkzeug,
und das schlägt direkt auf die Kriterien Execution und Potential Impact.

## Werkzeugschnitt

Aus Test A ist bekannt, dass 45 Werkzeuge technisch registrierbar sind. Ob ein Agent
sie überblickt, ist ungeklärt. Deshalb: wenige, grob geschnittene Werkzeuge. Ein Aufruf
pro Bewegungsphase, nicht einer pro Knochen. Zielgröße unter zwanzig.

Werkzeugbeschreibungen sind ein eigenes Arbeitspaket, kein Beiwerk. Sie sind das gesamte
Handbuch, das der Agent zu sehen bekommt.

Fehlermeldungen ebenso: nicht "ungültige Eingabe", sondern "Frame 34 liegt außerhalb
der Timeline von 0 bis 60".

## Was nicht gebaut wird

- Vierbeiner, Fabelwesen, Modelle ohne erkennbare Zweibeinigkeit. Sie werden erkannt
  und ehrlich abgelehnt, statt falsch behandelt.
- Text-to-Motion-Modelle im Browser. Geprüft: kimodo.cpp liefert das passende Format,
  hat aber keinen WASM-Build und einen Llama-großen Textencoder. Die Timeline nimmt
  Rohbewegung von außen entgegen, damit das später andocken kann.
- Physik-Simulation mit Ragdoll. Die Ballistik wird gerechnet, nicht simuliert.
- Mehrere Figuren, Requisiten über einen Ball hinaus, Kleidung, Gesichtsanimation.

## Risiken

**Bewegung sieht korrekt aus, aber tot.** Das größte Risiko, in Test B bereits
eingetreten. Gegenmittel: Ebene 1 mit Phasen, die Antizipation und Nachschwingen
enthalten, plus die Stilprüfungen.

**Der Agent kommt mit den Phasen nicht zurecht.** Muss früh geprüft werden, sobald
Ebene 1 steht — mit demselben Auftrag wie in Test B, als direkter Vergleich.

**Rig-Erkennung scheitert an fremden Modellen.** Gegenmittel: Testkorpus aus mehreren
Quellen, plus der Härtetest — Knochennamen entfernen, Achsen und Maßstab ändern,
Twist-Knochen einbauen. Fällt die Erkennung dann um, war sie ein Namensparser.

**Zeit.** Zweieinhalb Tage. Rückfallposition: Wenn der Salto bis Tag drei nicht
überzeugt, wird eine einfachere Bewegung zur Demo — Sprung mit Landung, Fußballschuss —
und der Salto als offener Punkt benannt.

## Abnahmekriterien

| Teil | Nachweis |
|---|---|
| Rig-Profil | Massensumme 1,0; Radien plausibel; Vorzeichenprüfung meldet für jeden Freiheitsgrad die erwartete Richtung |
| Rig-Erkennung | Härtetest mit anonymisierten Knochennamen und geänderten Achsen besteht |
| Validatoren Physik | eingebaute Fehler werden mit korrektem Betrag gefunden; Referenz-Mocap erzeugt null Fehlalarme |
| Validatoren Absicht | ein bewegungsloser Clip besteht die Physikprüfung, fällt aber durch die Absichtsprüfung |
| Validatoren Stil | der Test-B-Clip mit 22 toten Frames wird beanstandet |
| Ebene 1 | derselbe Auftrag wie in Test B liefert ein sichtbar besseres Ergebnis |
| Mensch-Schleife | Werkzeug wartet auf Klick, Antwort kommt im selben Aufruf zurück |
| Export | exportierter Clip lässt sich wieder laden, Wurzelbewegung und Gelenkverläufe stimmen überein |
| Gesamt | Ein Mensch, der die Animation sieht, erkennt die bestellte Bewegung |

## Offene Punkte

- Verhalten eines echten Browser-Agenten bei zwanzig Werkzeugen und vielen Aufrufen
- Ob Fußrutschen in Clips ohne Wurzelbewegung ein Rest-Fehlalarm ist oder korrekt gemeldet wird
- Winkeldarstellung jenseits von ±170°, wo Drehungen über die Senkrechte kippen
