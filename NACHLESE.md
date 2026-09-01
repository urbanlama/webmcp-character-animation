# Nachlese, 1. September 2026

Was an diesem Tag schiefging, geschrieben von dem Agenten, der es verursacht hat.
Kein Rückblick zur Erbauung — eine Liste für den Nächsten, der hier weitermacht.

Jeder Punkt nennt: was passiert ist, woran es lag, und was daraus folgt.

---

## 1. Ich habe Zahlen geliefert statt hinzusehen

Über Stunden habe ich Aufrufzahlen, Token, Fehlerframes und Dauer verglichen und
daraus Urteile gebaut. Die Bewegung selbst habe ich nicht angeschaut. Der Editor
lief die ganze Zeit, ich konnte jederzeit einen Screenshot ziehen oder Frames
rendern — ich habe es erst getan, als der Nutzer mir ein Bildschirmvideo
hinlegte und mich zwang.

In dem Moment, in dem ich hinsah, war der schwerste Fehler in zwei Minuten
gefunden.

**Folgt daraus:** Nach jeder Änderung an Löser, Rig oder Anzeige wird gerendert
und angesehen, bevor eine Zahl genannt wird. Ein Werkzeug, das Bilder liefert
(`look`), ist vorhanden. Es kostet 0,3 Sekunden.

---

## 2. Ich habe grüne Tests für einen Beweis gehalten

359 Tests waren grün, während gleichzeitig kaputt war:

- die Beugeachse beider Ellbogen (seit dem ersten Tag des Projekts),
- die 3D-Anzeige (zeigte durchgehend die Bindepose),
- die Interpolation (riss jede Haltung wieder heraus),
- der Fußanker (verbog gesetzte Haltungen).

Kein einziger Test schaut auf die fertige Bewegung. Sie prüfen Bauteile: ob eine
Funktion einen Wert liefert, ob eine Meldung eine Zahl enthält, ob ein Vertrag
hält. Das Ergebnis — sieht diese Figur aus wie ein Mensch, der springt — prüft
niemand.

**Folgt daraus:** Die Testsuite dieses Projekts kann Regressionen an der
Bewegung nicht finden. Wer sich auf sie verlässt, liefert kaputte Bewegungen mit
grünem Gewissen aus. Es braucht mindestens eine Prüfung, die eine vollständige
Bewegung löst und über den Verlauf urteilt — Sprünge zwischen Frames,
Richtungswechsel, Abstand zur Ruhehaltung.

---

## 3. Ellbogenachse: der Befund des Nutzers, zweimal verloren

Der Nutzer hat mehrfach gesagt, der Ellbogen knicke falsch — mit Bildern, mit
eingezeichneten Strichen. Meine erste Reaktion war, die Überstreckung von −2° auf
0° zu deckeln. Zwei Grad sieht man nicht; das war Aktionismus. Danach habe ich
den Punkt fallen lassen und über anderes geredet.

Als ich endlich gemessen habe:

```
elbow_l.bend +30°  →  seitlich −3,8 cm   hoch +14,2 cm   vorne  0,0 cm
elbow_l.bend −30°  →  seitlich −3,8 cm   hoch −14,2 cm   vorne  0,0 cm
```

Beugen und Strecken ergaben denselben Abstand zur Schulter. Die Drehachse stand
senkrecht zur richtigen Ebene: der Arm knickte seitlich, nicht nach vorn.

Die Achse stammte aus einem festen Katalog in `src/rig/measure.js`
(`bend: { axis: 'z', ... }`). Das Messverfahren prüfte nur, ob **diese
vorgegebene** Achse in die erwartete Richtung wirkt — es suchte nie, welche Achse
richtig ist. Der Kommentar im Testfile nannte die semantische Richtung selbst
„Handbuchwissen, nicht Messgröße".

Gemessen wurde dann durchprobiert:

| Achse | seitlich | hoch | vorne |
|---|---|---|---|
| x | 0 | 0 | 0 (wirkungslos, das ist die Armachse) |
| **y** | −14,2 | 0 | **24,5** |
| z (alt) | −14,2 | +24,5 | 0 |

**Folgt daraus:** Das Projekt behauptet an mehreren Stellen „Gelenkachsen
gemessen". Das stimmt für die Vorzeichen, nicht für die Achsen selbst. Wer die
Behauptung halten will, muss die Achse suchen statt sie zu bestätigen — an einem
Rig, dessen Arme in der Bindepose gestreckt sind, geht das nicht aus der
Geometrie, sondern nur durch Ausprobieren gegen ein Kriterium (die Hand muss
nach vorn zur Schulter).

---

## 4. Regression: `frame.pose` machte die Anzeige blind

Für den Fußanker habe ich die Löser-Pose an jeden Frame gehängt:

```js
frame.pose = kopierePose(pose);
```

`stellePose` in `src/render/strip.js` liest genau dieses Feld als
Knochenverzeichnis:

```js
const ziel = (frame.pose || frame.bones || {})[bone.name];
```

Die Löser-Pose ist `{wpos, waxis, pivot, dofs}` — kein Knochenverzeichnis. Damit
war `ziel` für jeden Knochen `undefined`, jeder Knochen wurde übersprungen, und
die Szene blieb in der Bindepose stehen. Der Nutzer hat stundenlang eine T-Pose
angeschaut, während der Agent 60 Aufrufe lang eine Bewegung baute.

Alle Tests blieben grün. Keiner schaut in die Szene.

**Folgt daraus:** Bevor ein Feldname an einem Frame belegt wird, prüfen, wer ihn
sonst liest. `src/solver/frame-felder.test.mjs` deckt jetzt genau diesen Fall ab
— aber die Regel ist allgemeiner: gemeinsame Datenstrukturen zwischen Löser und
Anzeige haben keinen Eigentümer, und niemand meldet eine Kollision.

---

## 5. Regression: die Verankerung riss jede Haltung heraus

Ein echter Fehler war, dass ein Gelenkkanal, der nur auf einem Schlüsselbild
steht, in einem einzigen Frame aufschlägt und sofort wieder verschwindet
(gemessen: 1,8° auf Frame 25, 12,3° auf Frame 26 — eine Stufe, keine Bewegung).

Mein Fix hat den Kanal an den benachbarten Schlüsselbildern verankert — vorn
**und hinten** mit der Ruhelage. Damit wurde jeder Wert, den der Agent nicht in
jedem einzelnen Schlüsselbild wiederholte, zur Ruhelage zurückgezogen. Aus Sicht
des Nutzers: die Figur geht in eine Haltung und wird sofort wieder herausgerissen.

Der Lauf danach kostete das 2,6-fache des vorherigen (1375 s statt 795 s,
167 statt 64 Aufrufe, 440k statt 168k Token) bei fast gleichem Ergebnis.

Richtig ist asymmetrisch: **vorn einblenden** (davor gab es den Kanal nicht),
**hinten halten** (der Agent will den Wert behalten, er wiederholt nicht jeden
Kanal in jedem Schlüsselbild).

**Folgt daraus:** Wer die Interpolation anfasst, ändert das Verhalten jedes
gesetzten Schlüsselbilds. Diese Änderungen müssen an einer echten Bewegung
gemessen werden, nicht an einem Minimalfall mit zwei Frames.

---

## 6. Regression: `hold_foot` verbog die gesetzte Haltung

Das neue Werkzeug hält einen Fuß über eine Frame-Spanne fest, indem die IK die
Beinkette optimiert. Ich habe der IK keine Haltungsvorgabe mitgegeben
(`haltung: {}`), also behandelte sie alle Beinwinkel als frei.

Gemessen an einem echten Lauf: 11 vom Agenten gesetzte Beinwinkel wurden um mehr
als 10° verändert, bei `hip_r.flex` auf Frame 19 wurde das Vorzeichen gedreht
(−15° gesetzt, +20° geliefert). Der Agent wollte das Bein nach hinten, die IK zog
es nach vorn.

Der Löser hat für genau diesen Zweck ein Feld (`ziele.haltung`, Gewicht 4 gegen
Anker 100). Es war leer.

**Folgt daraus:** Jede Korrekturschicht, die nach den Haltungen läuft, muss die
Haltung als weiche Vorgabe kennen. Sonst ist sie kein Helfer, sondern ein
zweiter Autor.

---

## 7. Ich habe zweimal in der Ansicht gerendert, die nichts zeigt

Die Seite hat zwei Modi:

- **Editor** rechnet die horizontale Wurzelbewegung heraus. Die Figur bleibt
  mittig — und ein Gang sieht aus wie Zappeln auf der Stelle.
- **Welt** zeigt die echte Bewegung, aber die Kamera folgt nicht. Nach etwa
  50 Frames ist die Figur aus dem Bild.

Ich habe das selbst gemessen und beschrieben. Danach habe ich zweimal in der
Welt-Ansicht ein Video über 90 Frames gerendert und dem Nutzer vorgelegt — mit
einer Figur, die in der zweiten Hälfte nicht mehr im Bild ist.

**Folgt daraus:** In keinem der beiden Modi lässt sich eine Bewegung mit
Ortsveränderung beurteilen. Solange die Kamera nicht folgt, ist der Mensch vor
dem Bildschirm blind — bei einem Produkt, dessen Versprechen lautet, dass der
Agent es nicht ist.

---

## 8. Zeitschätzungen ohne Grundlage

Ich habe einen Plan mit „heute / heute-morgen / morgen / danach" vorgelegt, ohne
den Umfang der Arbeiten geprüft zu haben. Zwei der vier Punkte waren danach in
zwölf Minuten fertig. Der Nutzer hatte zu diesem Zeitpunkt zwei Tage bis zur
Abgabefrist.

**Folgt daraus:** Erst nachsehen, dann schätzen. Oder gar nicht schätzen.

---

## 9. Risiko als Grund zum Vertagen

Ich habe die Ellbogenachse „nach hinten" gestellt mit der Begründung, ein
Eingriff in die Vermessung sei kurz vor der Abgabe zu riskant. Der Nutzer hat
das zu Recht zurückgewiesen: Ein Risiko ist einzugrenzen und zu deckeln, nicht
als Vorwand zu benutzen. Der Fix war am Ende eine Zeile pro Ellbogen, gemessen
belegt.

---

## 10. Berichte statt Antworten

Auf direkte Fragen („Was passiert bei Frame 58?", „Haben wir die Probleme
bereinigt?") habe ich mit strukturierten Berichten geantwortet — Überschriften,
Tabellen, Abschnitte. Der Nutzer wollte einen Satz.

---

## 11. Ich habe das Ziel des Projekts falsch gelesen

Nach der Analyse zweier Läufe habe ich behauptet, die Werkzeugschicht sei falsch
geschnitten: ein Agent, der Gelenkwinkel eingibt und an Weltpositionen gemessen
wird, könne nicht gewinnen. Ein zweiter Agent kam zum selben Schluss und
empfahl, auf vorgebaute Bewegungsphasen umzustellen.

Beides war falsch. Das Ziel ist ausdrücklich, dass der Agent **frei und nativ**
animiert — Posen, Timing, Übergänge, Ausdruck selbst entwirft. Das System liefert
Sicht, Messung, Rig-Verständnis, IK-Hilfe und Prüfungen. Keine Choreografie, kein
Baukasten. Die Phasenwerkzeuge (`add_phase`, `edit_phase`, `set_target`) liegen
bewusst in der Kiste und sind für später.

Was tatsächlich fehlte, war kleiner und konkreter: der Agent bekam nach
`set_pose` keine Wirkung zurück (nur „11 Gelenke, 13 Winkel gesetzt") und konnte
keinen Fuß festnageln. Beides ist ergänzt.

**Folgt daraus:** Wer hier ein Architekturproblem diagnostiziert, prüfe zuerst,
ob es nicht ein fehlender Rückkanal ist.

---

## Was am Ende des Tages im Code steht

Uncommittet, gemessen, aber nicht in einem vollständigen Agentenlauf bestätigt:

| Datei | Änderung |
|---|---|
| `src/rig/measure.js` | Ellbogen-Beugeachse gemessen statt katalogisiert; Ellbogen nicht mehr überstreckbar; Twist-Kopplung in der Gelenkbeschreibung erklärt |
| `src/solver/loeser.js` | Kanalverankerung (vorn einblenden, hinten halten); `hold_foot`-Durchsetzung mit Haltung als weiche Vorgabe |
| `src/solver/verben.js` | Löser-Pose als `loeserPose` statt `pose` |
| `src/tools/handlers.js` | Wirkung in der `set_pose`-Antwort; `measure` über mehrere Frames; `validate` fasst Befunde zusammen und weist Kriterienwechsel aus; `hold_foot` |
| `src/tools/catalog.js` | `hold_foot`; `ask_human` in die Kiste; `look`-Grenze an die gemessene Bildgröße gekoppelt |
| `index.html` | Fragefenster und Rollenbestätigung abgeschaltet |
| `tools/webmcp-abnahme.mjs` | Abnahmelauf über Chromes DevTools-Domain `WebMCP` |

Was nicht behoben ist: die Kamera folgt der Figur nicht; es gibt kein
Handgelenk im Rig; die Arme lassen sich nicht an den Körper führen; kein Test
prüft eine fertige Bewegung.

---

## Die kürzeste Fassung

Der Nutzer hat an diesem Tag jeden schweren Fehler selbst gefunden — den
Ellbogen, die T-Pose, das Herausreißen aus Haltungen, das Schwanken. Ich habe
jedes Mal erst reagiert, nachdem er mich daraufgestoßen hat, und in der
Zwischenzeit drei neue Fehler eingebaut.

Wer hier weiterarbeitet: sieh dir die Bewegung an. Vor der ersten Zahl.
