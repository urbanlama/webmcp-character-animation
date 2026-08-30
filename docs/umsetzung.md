# Bereitschaftskarte

Was jedes Paket braucht, welche Dateien es besitzt, woran man es abnimmt.

Keine Wellen, keine feste Reihenfolge. Ein Paket ist startklar, sobald sein „braucht"
erfüllt ist — dann geht es raus, egal was sonst gerade läuft. Wer verteilt, liest
zusätzlich `LEITUNG.md`; wer baut, `AGENTS.md`.

Die Dateizuteilung ist bindend. Zwei Pakete besitzen nie dieselbe Datei.

---

## Testmaterial

**Referenzclips** sind die sieben Animationen in `spikes/test-b-motion/assets/Xbot.glb`:
`agree`, `headShake`, `idle`, `run`, `sad_pose`, `sneak_pose`, `walk`. Sie sind das
einzige Bewegungsmaterial, das im Repo liegt.

Die Aufteilung in Entwicklung und Abnahme legt die Leitung einmal fest und schreibt sie
ins Brett. Wer mit Abnahmeclips entwickelt, macht seinen eigenen Test wertlos — im
Vortest kostete genau das 150, 132 und 183 Fehlalarme.

**Fremde Modelle für AP3** liegen noch nicht vor. Mindestens drei unter freier Lizenz,
aus verschiedenen Quellen. Beschaffung blockiert niemanden und wird vorgezogen, sobald
gerade wenig läuft.

**three.js und der GLTFLoader** liegen bereits im Repo: `spikes/test-b-motion/assets/`.

---

## AP0 — Gerüst

**braucht:** nichts
**besitzt:** `index.html`, `package.json`, `src/scene/`, `vendor/`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Testkommando | ein Kommando führt alle Tests aus und meldet Erfolg | ein absichtlich fehlschlagender Test lässt das Kommando mit Fehlercode enden |
| Laden | `Xbot.glb` wird per Datei-Auswahl geladen, Figur steht sichtbar in der Szene | eine Datei ohne Skelett wird mit benanntem Grund abgelehnt |

Legt fest, wie in diesem Projekt getestet wird, und stellt die Szene bereit, in der
alles andere sichtbar wird. Solange das offen ist, kann kein Paket abgenommen werden.

Mit zu entscheiden und im Brett zu vermerken: Läuft ein Test in Node oder im Browser?
Löser und Prüfungen brauchen three.js und ein geladenes Skelett — eine Antwort für alle,
sonst schreibt jedes Paket seine Tests gegen eine andere Umgebung.
Geht als erstes raus und blockiert am meisten — deshalb an eine Claude-Unterinstanz,
nicht an ein externes Modell.

AP1 wartet nicht darauf: Schemata und Beispiele lassen sich parallel schreiben,
abgenommen werden sie, sobald das Testkommando steht.

---

## AP1 — Datenverträge

**braucht:** AP0 (Testkommando)
**besitzt:** `src/contracts/`, `samples/contracts/`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Schema | gültiges Beispiel wird angenommen | kaputtes wird mit benanntem Feld abgelehnt |

Die drei Schemata aus `docs/plan.md` Abschnitt 5, je ein gültiges und ein absichtlich
kaputtes Beispiel. Blockiert alles Weitere: ohne Verträge bauen parallele Agents
unvereinbare Systeme.

---

## AP2 — Rig-Vermessung

**braucht:** AP1
**besitzt:** `src/rig/measure.js`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Massen | Schwerpunkt der Bind-Pose liegt innerhalb der Standfläche | künstlich verdreifachte Handmasse verschiebt ihn messbar heraus |
| Radien | Abweichung zur Mesh-Hülle unter 15 % je Segment | ein halbierter Radius wird von der Hüllenprüfung gemeldet |
| Sohlen | erkannte Sohlenfläche deckt mindestens 60 % der Fußlänge ab | ein Modell mit angehobener Ferse wird als solches erkannt, nicht stillschweigend falsch vermessen |
| Vorzeichen | jeder messbare Freiheitsgrad bewegt das Kettenende in die benannte Richtung | ein absichtlich invertiertes Vorzeichen wird gemeldet |
| Twist | wird als `nicht_messbar` gekennzeichnet | wird **nicht** stillschweigend auf 1 gesetzt und als gemessen ausgegeben |

---

## AP3 — Rig-Erkennung auf fremden Modellen

**braucht:** AP1
**besitzt:** `src/rig/detect.js`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Robustheit | Knochennamen durch `bone_000` ersetzt, Achsen gedreht, Maßstab geändert, Twist-Knochen eingefügt — Rollen werden trotzdem korrekt zugeordnet | ein Modell ohne zwei Beine wird abgelehnt, nicht als Mensch behandelt |
| Fremde Rigs | mindestens drei Modelle aus verschiedenen Quellen, keines zur Entwicklung benutzt | bei einem absichtlich mehrdeutigen Rig wird der Mensch gefragt statt geraten |

Der Testkorpus wird vorher benannt und in Entwicklung und Abnahme getrennt. Wer mit
Abnahmemodellen entwickelt, macht den Test wertlos.

---

## AP4 — Physikprüfungen

**braucht:** AP1
**besitzt:** `src/validate/physics.js`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Boden | Referenzclip ohne Beanstandung | Figur um 5 cm abgesenkt → genau 5 cm werden gemeldet |
| Durchdringung | Referenzclip ohne Beanstandung | Arm in den Kopf gedreht → Meldung mit Betrag |
| Balance | ruhig stehende Figur ist im Lot | Hüfte 30 cm zur Seite → Meldung mit Betrag |
| Rutschen | verankerter Fuß meldet nichts | Fuß um 10 cm versetzt bei Kontakt → 10 cm werden gemeldet |
| Ballistik | freier Fall wird akzeptiert | Schwerpunkt schwebt konstant → Meldung |

Die Abnahmeclips sind nicht dieselben, an denen entwickelt wurde. Ohne diese Trennung
kamen im Vortest 150, 132 und 183 Fehlalarme heraus, wo vorher null standen.

Kann gegen ein festes Rig gebaut werden, bevor AP2 fertig ist.

---

## AP5 — Phasenlöser

**braucht:** AP1
**besitzt:** `src/solver/`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| `crouch` | Schwerpunkt sinkt um die verlangte Tiefe, Füße bleiben stehen | verlangte Tiefe unerreichbar → Meldung mit erreichter Tiefe, kein stilles Abschneiden |
| `takeoff` | Schwerpunkt erreicht die verlangte Geschwindigkeit, Kontakt löst sich | verlangte Geschwindigkeit übersteigt die Streckung → Meldung |
| `airborne` | Flugbahn ist eine Parabel, Drehung erreicht den Sollwinkel | Einrollen ändert die Drehgeschwindigkeit — bei abgeschalteter Drehimpulskorrektur weicht der Endwinkel messbar ab |
| `land` | Aufsetzfuß berührt den Boden, Schwerpunkt kommt ins Lot | Landung außerhalb der Streckreichweite → Meldung |
| Konflikt | widersprüchliche Bedingungen werden nach Rangfolge aufgelöst | die geopferte Bedingung steht mit Betrag im Bericht |

Das Herz. Wird auf einem Rig gebaut, das sich nicht ändert.

---

## AP6 — Absichts- und Stilprüfungen

**braucht:** AP1, erste Bewegung aus AP5
**besitzt:** `src/validate/intent.js`, `src/validate/style.js`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Absicht | ein echter Salto erfüllt alle Kriterien | eine bewegungslose Timeline besteht die Physikprüfung und fällt durch die Absichtsprüfung |
| je Baustein | jeder der sieben Bausteine hat einen erfüllten Fall | und einen verletzten, der gemeldet wird |
| Bewegungsdichte | Referenzclips lösen nichts aus | der Test-B-Clip mit 22 toten Frames wird beanstandet |
| Antizipation | Referenzsprung besteht | ein Sprung ohne Absenken wird beanstandet |
| Ruck | Referenzclips bestehen | ein eingefügter Positionssprung wird beanstandet |

Alle sieben Referenzclips müssen die Stilprüfung ohne Beanstandung bestehen. Sonst
wiederholt sich das Fehlalarm-Problem auf einer neuen Ebene.

---

## AP7 — Werkzeug- und Mensch-Schicht

**braucht:** AP1, Werkzeugkatalog aus `docs/plan.md` 5.4
**besitzt:** `src/tools/`, `src/ui/`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Registrierung | 16 Werkzeuge sind über `getTools()` sichtbar | ein Werkzeug ohne Beschreibung wird abgelehnt |
| Rückfrage | Werkzeug wartet, Klick liefert die Antwort im selben Aufruf | Abbruch oder Neuladen während der Wartezeit beschädigt die Timeline nicht |
| Undo | Rücknahme stellt den vorigen Zustand her | nach fünf Änderungen und fünf Rücknahmen ist der Zustand bitgleich zum Ausgangszustand |
| Fehlermeldungen | jede nennt Wert, erlaubten Bereich und nächsten Schritt | eine Stichprobe von zehn Fehlerfällen enthält keine Meldung ohne Zahl |

Kann gegen Attrappen gebaut werden, bevor Löser und Prüfungen stehen.

---

## AP9 — Bildstreifen

**braucht:** AP0, AP2
**besitzt:** `src/render/strip.js`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Ansichten | ein Streifen zeigt die benannten Ansichten mit Achsenkreuz, Bodengitter mit Maßstab, Schwerpunkt, Stützfläche und Kontaktpunkten | ein Streifen ohne Annotationen wird nicht ausgeliefert |
| Aussagekraft | zwei deutlich verschiedene Posen ergeben deutlich verschiedene Streifen | eine um 2 mm verschobene Pose ergibt keinen sichtbar anderen Streifen — sonst ist der Maßstab falsch gewählt |
| Anhang | jeder Validierungsbericht trägt seinen Streifen, ohne dass jemand danach fragt | ein Bericht ohne Streifen gilt als unvollständig |

Ohne dieses Paket ist der teuerste Fehler — korrekte Zahlen bei toter Bewegung — nicht
zu sehen, und AP5 nicht abzunehmen. Details in `docs/plan.md` 6.8.

---

## AP8 — Ende zu Ende

**braucht:** alles
**besitzt:** `tests/e2e/`
**fertig wenn:**

| Test | Positivfall | Negativfall |
|---|---|---|
| Vertikalschnitt | echter Browser-Agent: Modell laden, Rolle bestätigen, Absicht setzen, Salto bauen, Rückfrage beantworten, exportieren | derselbe Auftrag mit abgeschalteter Absichtsprüfung liefert ein schlechteres Ergebnis — messbar, nicht behauptet |
| Test-B-Vergleich | derselbe Auftrag wie in Test B besteht Absichts- und Stilprüfung | der alte Test-B-Clip besteht sie nicht |
| Export | Wiedereinlesen mit einem fremden Betrachter zeigt dieselbe Bewegung | ein absichtlich beschädigter Export wird beim Wiedereinlesen bemerkt |

---

## A3 — Agentenlast

**braucht:** AP7 oder eine Attrappe mit 16 Werkzeugbeschreibungen
**besitzt:** `spikes/test-a3-load/`
**fertig wenn:** ein Agent wählt aus 16 Werkzeugen bei fünf Aufgaben jeweils das
richtige. Greift er bei zwei absichtlich ähnlich beschriebenen Werkzeugen daneben, sind
die Beschreibungen zu schwach.

A2 — ob ein Agent Bilder in Werkzeugantworten überhaupt wahrnimmt — ist beantwortet:
`spikes/test-a2-image/ERGEBNIS.md`, beide Wörter korrekt gelesen, Negativfall bestanden.

---

## Der Punkt zum Draufschauen

Der erste Bildstreifen einer vom Löser erzeugten Bewegung — AP5 durch AP9 gesehen. Nicht
die Zahlen, der Streifen.

Deshalb muss AP9 stehen, bevor AP5 abgenommen wird. Ein Löser, der nur Zahlen liefert,
gilt als nicht abgenommen, auch wenn alles grün ist.

Sieht die Bewegung darauf tot aus, während die Prüfungen grün melden, ist die
Architektur an der teuersten Stelle falsch, und zwar bevor AP6 und AP7 darauf aufbauen.
Das ist der eine Moment, an dem die Leitung selbst hinsieht, statt abzunehmen.

---

## Notbremse

Liefert der Löser korrekte, aber leblose Bewegung, wird nicht nachgebessert, sondern
umgestellt: Referenzbewegung wird als Rohmaterial in die Timeline geladen und der Löser
verformt sie, statt sie zu erzeugen. Die Timeline nimmt Rohbewegung von außen bereits
auf — der Weg ist offen, aber ungebaut.

Auslöser: AP6 meldet auf einer vom Löser erzeugten Bewegung wiederholt zu geringe
Bewegungsdichte, und der Bildstreifen bestätigt es.
