# Bühnenlauf 2. September 2026

Erhebung, kein Fix. Sichtbarer Browser, Xbot, Posen über die WebMCP-Werkzeuge
gesetzt; jede Beurteilung stammt von Max am Bild, jede Zahl aus `measure`,
`describe_pose` oder dem Quelltext.

## Was funktioniert

Keyframes, Interpolation zwischen zwei Posen, alle vier `ease`-Arten (auch
`wurf`, physikalisch exakt), Wurzelbahn und Wurzeldrehung, `measure`,
`describe_pose`, die Bildsprache des Streifens, die Klemmung an Gelenkgrenzen,
und die beiden Fixes vom selben Tag (hip.twist-Spiegelung, Durchdringungs-
meldung in `set_pose`). Ein Standweitsprung war als Sprung erkennbar.

## Die Befunde, nach Gewicht

| # | Befund | Kapitel |
|---|---|---|
| A | **Die Figur wird nie auf den Boden gestellt.** Jede Beinpose lässt sie schweben; `hold_foot` friert sie in der Luft ein; „Bodenkontakt" heißt schweben, stehen und im Boden stecken gleichermaßen; und weil „Flugphase" gilt, fallen Balance und Fußrutschen still aus | Posen 1,2,8,9,10,12,14 · 2.2 |
| B | **`look` klatscht mehrere Bilder in eins und lässt keine Kamera zu** — kein Zoom, kein Ausschnitt, vier feste Ansichten; bei Platznot schrumpft alles bis zu 4 px Schrift | 1.1–1.5 |
| C | **Ein gesetzter Wert hält genau ein Schlüsselbild weit**, dann springt er in einem Frame auf die Ruhelage — 120° in 1/30 s, ohne Meldung | 3.1, 3.2, 3.6 |
| D | **Überbeugung ist strukturell unsichtbar** — benachbarte Segmente (Knie, Ellbogen, Hals) werden nie auf Durchdringung geprüft; der Rumpf ist eine einzige Kapsel von der Hüfte bis zum Hals | Pose 15 · Korrektur zu 15 |
| E | ~~**Gelenkgrenzen kommen aus einem Handbuchkatalog**~~ — behoben am 2. September, siehe Nachtrag zu D und E. , nicht vom Modell: Schulter -130°, Arm 100°, Knie 150° erzeugen Stellungen, die kein Mensch kann | Pose 7, 15 |
| F | **Zwei Vokabulare** — 10 von 18 Gelenken sind unter ihrem Setz-Namen nicht messbar; die Sohle fehlt ganz | 2.1, 2.2 |
| G | **`pelvis.tilt` dreht die ganze Figur** statt des Beckens gegen die Beine | Pose 2 |
| H | Kleinkram mit klarer Ursache: kein Zurücksetzen des Zustands · Anzeige zählt ab Frame 1, Werkzeuge ab 0 · zwei Etiketten auf derselben Panelzeile · `hold_foot` nimmt kein „beide" · falsche Ursachenzuschreibung bei geklemmten Winkeln · Handstellung als unbemerkter Nebeneffekt | 1.3, 3.7, Pose 11, 15, 3.5 |

## Was NICHT zu beanstanden war

Ruckeln (3.9) — nicht reproduzierbar. Und ein zurückgezogener Befund zu
`arm_l.lift` (3.4), der ein Artefakt eines verschmutzten Sitzungszustands war.

---

# Bühnenlauf 2. September 2026 — was der Agent gesetzt hat und was herauskam

Sichtbarer Browser, Xbot, Posen über `set_pose` gesetzt, Max beurteilt das Bild.
Gesammelt, nicht gefixt.

| Nr | Gesetzt | Erwartet | Gesehen | Meldung des Werkzeugs |
|---|---|---|---|---|
| 1 | `spine.bend 35`, `pelvis.tilt 40`, `neck.bend -20` | Vorbeugen im Stand, Füße am Boden | Figur kippt komplett nach hinten weg, schwebt schräg in der Luft, Füße ohne Bodenkontakt | „kein Bodenkontakt (Flugphase)" — keine Durchdringung, kein Fehler |
| 2 | `pelvis.tilt 40` | Becken kippt nach vorn, Oberkörper neigt sich, Füße am Boden | Die GANZE Figur liegt starr schräg im Raum wie ein Brett — keinerlei Beugung im Rumpf, Beine kippen mit, Füße in der Luft | „kein Bodenkontakt (Flugphase)" |
| 3 | `spine.bend 35` | Oberkörper beugt sich vor, Beine senkrecht, Füße am Boden | passt — von Max bestätigt | — |
| 4 | `hip_l.twist 40`, `hip_r.twist 40` | beide Fußspitzen symmetrisch nach außen | passt — von Max bestätigt. Kontrolle des Fixes vom selben Tag (vorher drehte ein Fuß nach innen) | — |
| 5 | `arm_l.lift -75`, `arm_r.lift -75` | Arme hängen locker am Körper, nichts im Rumpf | passt — von Max bestätigt | — |
| 6 | `arm_l.swing 90`, `elbow_l.bend 150` | Hand steckt im Brustkorb, Werkzeug meldet es | passt — Hand sichtbar in der Brust, Meldung „torso und hand_l 22,2 cm" trifft zu. Kontrolle des Durchdringungs-Fixes vom selben Tag | „2 Körperteilpaare stecken ineinander: torso und hand_l 22,2 cm; torso und forearm_l 20,7 cm" |
| 7 | `arm_l.swing -130` (erlaubter Höchstwert) | unmögliche Schulterstellung | „ziemlich unnatürlich und kaputt" — Arm steht steil nach hinten oben, Schulter überstreckt | **schweigt vollständig**. Gelenkgrenzen kommen aus einem festen anatomischen Katalog (`limitSource: 'anatomisch'`), nicht aus dem Modell; -130° für die Schulter ist etwa das Doppelte des Möglichen |
| 8 | `hip_l.spread -30`, `hip_r.spread -30` | Beine kreuzen, Durchdringung wird gemeldet | passt — Beine gekreuzt und ineinander. ABER: Figur schwebt zusätzlich über dem Boden | „thigh_l und thigh_r 19,6 cm" korrekt — und „kein Bodenkontakt (Flugphase)" als beiläufige Notiz, nicht als Fehler |
| 9 | `knee_l/r.bend 60`, `hip_l/r.flex 50` — eine normale Hocke | Figur geht in die Knie, Füße am Boden | Beine sauber angezogen, aber die Figur hängt komplett in der Luft. **Die häufigste Startpose überhaupt schwebt.** | „kein Bodenkontakt (Flugphase)" — als beiläufige Notiz zwischen Schwerpunkt und Rücknahmehinweis |
| 10 | Hocke + `root.pos [0, 0.79, 0]` (Höhe von Hand geschätzt) | Sohlen liegen auf dem Boden | Beine sind zu tief, stecken im Boden | **„Bodenkontakt"** — dieselbe Meldung wie bei einer korrekt stehenden Figur. Für „schwebt", „steckt im Boden" und „steht richtig" gibt es keine unterscheidbare Rückmeldung; eine Zahl (Abstand Sohle zu Boden) fehlt |

## Muster, das sich abzeichnet

1. **Die Figur wird nie auf den Boden gestellt.** Jede Beinpose verändert die
   Beinlänge, die Wurzel bleibt aber stehen. Der Agent muss die Absenkung
   selbst ausrechnen — und bekommt für „zu hoch" und „zu tief" dieselbe
   Antwort.
2. **Die Rückmeldung nennt keine Zahl, wo eine Zahl nötig wäre.** „Bodenkontakt"
   statt „Sohlen 4,2 cm über dem Boden" bzw. „11,0 cm im Boden".
3. **Gelenkgrenzen sind Katalogwissen, nicht am Modell gemessen.** Der Agent
   darf Winkel setzen, die kein Mensch kann, ohne Hinweis.
4. **Der Rumpf ist eine einzige Kapsel** (Hüfte bis Hals) — Brustkorb im Becken
   ist prinzipiell nicht meldbar.
| 11 | `hold_foot` mit `foot: "beide"` | wird angenommen — der Katalogtext sagt „auch fuer beide Fuesse gleichzeitig" | abgelehnt: „erwartet foot_l oder foot_r" | Beschreibungstext und Schema widersprechen sich |
| 12 | Hocke + `hold_foot foot_l/foot_r 0-11` | Füße kommen auf den Boden — dafür ist das Werkzeug da | Füße bleiben in der Luft, unverändert. `hold_foot` verankert den Fuß an seiner AKTUELLEN Position, auch wenn die 30 cm über dem Boden liegt | „kein Bodenkontakt (Flugphase)". Das Werkzeug sagt selbst: „die Wurzel bleibt, wo du sie gesetzt hast" — es kann das Problem also gar nicht lösen |
| 13 | `root.drehGrad.x -180`, `root.pos [0,1.2,0]`, Knie 30 | Figur steht kopfüber, Beine angezogen | passt — Figur sauber um 180° überschlagen. (Knie 30° war als Anziehen zu wenig, das ist meine Vorgabe, nicht das Werkzeug) | — |
| 14 | 12 Gelenke / 14 Winkel, realistische Landepose | natürliche Landehaltung | Haltung an sich „relativ natürlich". Aber: Figur schwebt, und der Schwerpunkt liegt zu weit hinten — „ich würde nach hinten auf den Arsch fallen" | „kein Bodenkontakt (Flugphase)" |

### Folgefehler zu 14 — der teuerste Punkt

Die Physikprüfung **hat** eine Gleichgewichtsprüfung (`BALANCE_TOLERANZ_ANTEIL`,
8 % der Körperhöhe). Sie schlug nicht an, weil der Frame als `flug` gilt — im
Flug werden Balance und Fußrutschen bewusst übersprungen.

Das falsche Schweben schaltet also die Standprüfungen still ab. Der Agent
verliert genau die Prüfungen, die ihm sagen würden, dass seine Pose umkippt —
und zwar ohne jede Meldung.
| 15 | `arm_l.lift 180`, `elbow_r.bend -90`, `knee_l.bend 150` (weit über den Grenzen) | Klemmung auf die Grenzen, mit Hinweis | Klemmung greift korrekt und wird genannt. ABER die Ursache wird falsch zugeschrieben: „der Fußanker biegt die Beinkette … verkürze die Ankerspanne" — bei zwei ARMgelenken. Ursache war die Gelenkgrenze, wie die Zeile darüber selbst sagt | widersprüchliche Doppelmeldung; der genannte Lösungsweg führt ins Leere |

### Nebenbefund

Die `hold_foot`-Anker aus einer früheren Pose bleiben aktiv und wirken in alle
späteren Posen hinein. Ein Werkzeug zum Zurücksetzen des Sitzungszustands gibt
es nicht (`set_duration` löscht Haltungen und Anker ebenfalls nicht).

### Korrektur zu 15 — meine Erwartung war falsch

Max am Bild: der Oberarm steckt bei `arm.lift 100` im Kopf, die Schulter ist
überstreckt (real endet das bei ca. 80°, der Rest käme aus dem Schulterblatt,
das dieses Rig nicht hat). Beim Knie bei `bend 150` verschwindet der
Unterschenkel im Oberschenkel. Beide Grenzwerte sind zu großzügig.

Gemeldet wird keiner der beiden Fälle, aus zwei verschiedenen Gründen:

1. **Benachbarte Segmente werden nie geprüft** — 82 von 91 möglichen Paaren
   sind in `restDistances`, die fehlenden 9 sind genau die Gelenke:
   `thigh|shin`, `upperarm|forearm`, `forearm|hand`, `shin|foot`, `torso|head`.
   Gemeint ist, dass sich benachbarte Kapseln am Gelenk immer berühren; die
   Folge ist, dass ein Unterschenkel vollständig im Oberschenkel verschwinden
   kann, ohne dass etwas anschlägt. Überbeugung ist damit strukturell
   unsichtbar.
2. **`head|upperarm_l` wird geprüft**, aber die erlaubte Überschneidung liegt
   bei 10,0 cm (60 % der Radiensumme von 16,6 cm). Der Oberarm im Kopf bleibt
   darunter.

## Nachtrag zu D und E — was das Kollisionsmodell über den Xbot wissen muss

Erhoben am 2. September 2026 beim Bau der Grenzmessung (`measureJointLimits`,
`src/rig/measure.js`). Drei Messungen, die jeder braucht, der Selbstberührung
am Mesh prüft — also auch Auftrag D.

**1. Der Xbot bringt zwei Meshes mit, die konstruktiv ineinanderstecken.**

In der Bind-Pose, ohne jede Pose, schneiden sich:

```
upperarm_l | torso     157 Dreieckspaare
forearm_l  | upperarm_l 140
shin_l     | thigh_l    113
```

Ausnahmslos `Beta_Joints × Beta_Surface`. Das Modell hat ein zweites Mesh mit
Gelenkkappen, das in der Außenhaut sitzt. Alle Schnitte liegen auf einem Ring
in konstantem Abstand vom Gelenk (Streuung unter 1 mm) — die Kappe steckt im
Arm, wie gebaut.

**Folgt daraus:** Kollision zählt nur INNERHALB desselben Meshes. Wer
meshübergreifend rechnet, meldet die Ruhepose als Durchdringung. Der
Kapselprüfung in `src/validate/physics.js` fällt das heute nicht auf, weil sie
gar nicht bis auf Dreiecksebene geht.

**2. Skinning-Faltung sieht aus wie Kollision.**

Beim Beugen schiebt sich die Haut in der Beuge zusammen und schneidet sich
selbst. Ohne Gegenmaßnahme liefert die Messung `knee.bend` 40° und
`elbow.bend` 35° — die Figur wäre unbeweglich. Die Schnitte sitzen alle dicht
am Gelenk (4 bis 9 cm), echte Kollisionen weit darüber (`arm.lift` bei 100°:
88 Schnitte bis 37,7 cm).

**Folgt daraus:** Schnitte näher am Gelenk als die Summe der beiden gemessenen
Kapselradien sind Hautfaltung, keine Kollision. Am Xbot: Knie 15,2 cm,
Ellbogen 10,2 cm, Schulter 22,2 cm.

**3. Die gespiegelte Kette ist keine Gelenkgrenze.**

`hip.spread` klemmte bei 5°, weil beim isolierten Messen der linke Fuß den
rechten Unterschenkel trifft (`foot_l|shin_r`). Beim Gehen steht das andere
Bein woanders — `walk` fährt 10,9°. Zwei Glieder, die in einer konkreten
Haltung ineinanderstecken, meldet die Physikprüfung; eine Grenze des Gelenks
ist das nicht.

**4. Belegzahl zur Segmentzuordnung.** Ein Dreieck zählt zu einem Segment, wenn
alle drei Ecken ausschließlich von Knochen dieses Segments gewichtet werden.
Am Xbot fallen dadurch 157 von 49 112 Dreiecken weg — 0,3 %. Am Ellbogen
bleiben 2 206 Dreiecke im Unterarm stehen; es geht nichts Nennenswertes
verloren.

**5. Was die Messung ergab** (Katalog → gemessen, Xbot, 2,2 s für alle Kanäle):

| Kanal | Katalog | neu | Herkunft |
|---|---|---|---|
| `knee.bend` oben | 150 | **129** / 128 | gemessen (`shin\|thigh`) |
| `elbow.bend` oben | 150 | **127** | gemessen (`forearm\|upperarm`) |
| `arm.lift` oben | 100 | **92** | gemessen (`forearm\|head` — der Arm im Kopf) |
| `arm.lift` unten | −95 | **−81** | gemessen (`hand\|thigh` — der Arm liegt an) |
| `arm.swing` unten | −130 | −130 | anatomisch — keine Selbstberührung bis −150° |

8 von 74 Richtungen kommen aus der Messung, 66 bleiben anatomisch. Wenig — aber
nur dort, wo wirklich Haut auf Haut trifft. `arm.lift` unten trifft die
Entwicklungsclips fast auf den Grad: gemessene Grenze −81°, `idle` fährt −78,7°.

**6. Nebenbefund: zwei Katalogwerte sind enger als das Modell selbst fährt.**
`head.bend` fährt in den Entwicklungsclips 35,2° gegen einen Katalogwert von
30, `shoulder_l.fwd` 26,4° gegen 25. Der anatomische Katalog klemmt dort
Bewegung ab, die ausgeliefert mitkommt. Nicht angefasst.

---

## Noch nicht geprüft — offene Bereiche

1. **Sieht der Agent dasselbe wie der Mensch?** `look` rendert über den
   Bildstreifen, die 3D-Ansicht über einen anderen Pfad. Die Nachlese vom
   1. September kennt einen Fall, in dem die Anzeige die Bindepose zeigte,
   während der Löser etwas anderes rechnete. — IN ARBEIT
2. **Misst der Agent richtig, was er gebaut hat?** `measure` und
   `describe_pose` sind seine einzigen Zahlen und bisher ungeprüft. Liest
   `describe_pose` eine Haltung anders zurück, als sie gesetzt wurde,
   korrigiert der Agent gegen ein Phantom. — OFFEN
3. **Was zwischen zwei Posen passiert.** Alle Tests dieses Laufs standen auf
   zwei identischen Frames. Eine Animation besteht aus dem, was dazwischen
   interpoliert wird — genau dort listet die Nachlese vom 1. September zwei
   Regressionen (Haltungen wurden herausgerissen, Kanäle sprangen in einem
   einzelnen Frame auf). Der animationsrelevanteste Teil ist ungeprüft. — OFFEN

---

# Punkt 1 — Was der Agent sieht (`look` / Bildstreifen)

Erhebung am 2. September 2026, ohne Änderung am Code. Quellen: `src/render/strip.js`,
`src/tools/catalog.js`, Belegbilder `tmp-look-*.png` (Pose 15: Arm im Kopf, Knie überbogen).

## Was gut ist

Die Machart der Bilder trägt: Höhenleiste in Metern, Bodengitter, Schwerpunktkreuz,
Kontaktpunkte gefüllt/hohl, Stützflächenpolygon, Achsenkreuz mit „x links / y hoch /
z vorn", Maßstabskasten. Max am Bild: „extrem geil, wie wir da die Beschriftungen
reinklatschen". Der Defekt (Oberarm im Kopf) **ist** auf dem Bild erkennbar —
meine gegenteilige Einschätzung war falsch.

Auch bestätigt: `look` zeigt dieselbe Haltung wie die 3D-Ansicht. Der Bindepose-Fall
aus der Nachlese vom 1. September ist behoben.

## 1.1 Mehrere Bilder werden in EIN Bild geklatscht

`look` liefert nie ein Einzelbild, sondern immer ein zusammengesetztes Raster:
Spalten = Frames, Zeilen = Ansichten.

    KACHELN_MAX     = 12     Frames × Ansichten (catalog.js:76)
    PANELS_ZEIT_MAX = 24     Panels je Streifen (strip.js:122)
    PANEL_BREITE_PX = 300    strip.js:50
    PANEL_HOEHE_PX  = 380    strip.js:51

Bei 6 Frames × 2 Ansichten sind das 12 Panels in einem PNG; die Figur steht
fingernagelgroß darin. Ein Fehler fällt darin nicht mehr auf.

## 1.2 Bei Platznot schrumpft alles — bis zur Unlesbarkeit

    SKALA_STUFEN = [1, 0.72, 0.5]    strip.js:104

Passt der Streifen nicht in 512 KB, wird der GESAMTE Streifen neu gerendert,
zweimal kleiner. Auf Stufe 0,5 misst ein Panel 150 × 190 px. Die Schrift skaliert
mit (`schriftFaktor = panelBreite / PANEL_BREITE_PX`, strip.js:1130) — mit einer
Untergrenze von **4 Pixeln** (strip.js:1136). Vier Pixel Schrifthöhe ist nicht
lesbar.

Der Agent bekommt das ohne Wahl: er fragt nach Bildern und kriegt sie klein.

## 1.3 Zwei Etiketten stehen auf exakt derselben Zeile

Die Beschriftungen der rechten unteren Ecke werden von mehreren Zeichnern auf
feste Y-Positionen gesetzt:

    strip.js:876   pan.y + pan.hoehe - 6     Maßstabskasten
    strip.js:903   pan.y + pan.hoehe - 6     Stützfläche      <-- gleiche Zeile
    strip.js:928   pan.y + pan.hoehe - 28    Kontaktpunkte
    strip.js:933   pan.y + pan.hoehe - 39    verankert
    strip.js:866   pan.y + pan.hoehe - 17    Schwerpunkt

Zwei davon liegen aufeinander, unabhängig von der Skala. Die übrigen stehen
11 px auseinander bei 9 px Schrift — auf kleinen Skalen laufen sie ineinander.
Genau das sieht man in `tmp-look-1frame_2ansichten.png` unten rechts:
drei bis vier Zeilen übereinandergedruckt.

## 1.4 Der Agent hat keinerlei Kamerasteuerung

Vier feste Ansichten: `front`, `side`, `quarter`, `top` (catalog.js:31).
Kein eigener Winkel, kein Zoom, kein Bildausschnitt, kein Anfahren eines
Körperteils. Er kann nicht sagen „zeig mir die linke Schulter groß".

Die Rahmung bestimmt er auch nicht:

    SICHT_HOEHE_FAKTOR = 1.25          strip.js:59

Eine Kamera je Ansicht, gemeinsam für alle Frames der Zeile, gerahmt über den
**gesamten Bewegungsbereich plus den Bind-Anker** (strip.js:1035–1046). Läuft die
Figur drei Meter weit, muss die Kamera drei Meter zeigen — die Figur wird in
jedem einzelnen Panel entsprechend klein. Der Anker muss zusätzlich immer im
Bild bleiben.

Das ist bewusst so gebaut (Frames sollen untereinander vergleichbar sein), kostet
aber genau die Auflösung, die man zum Beurteilen einer Pose braucht.

## 1.5 Das Skelett-Overlay liegt über dem Körper

Weiße Knochenlinien werden über das Mesh gezeichnet — quer über Rumpf, Schulter
und Hüfte. Also dort, wo man auf Durchdringung schauen müsste.

## Zusammengefasst

`look` ist kein Blick, sondern ein Kontaktbogen: ein festes Raster mit fest
verdrahteten Ansichten, dessen Auflösung sinkt, je mehr der Agent sehen will.
Die Bildsprache selbst ist gut und soll bleiben. Was fehlt, ist ein Bild pro
Aufruf in voller Größe und eine Kamera, die der Agent selbst richtet.

---

# Punkt 2 — Misst der Agent, was er gebaut hat? (`measure`, `describe_pose`)

Erhebung am 2. September 2026, ohne Änderung am Code.

## Was gut ist

`describe_pose` liefert mehr, als sein Katalogtext verspricht: neben
Weltpositionen, Schwerpunkt und Kontakt auch `winkel_grad` (gefahren) und
`gesetzteWinkel_grad` (gesetzt) — der Agent kann seine Haltung also in seiner
eigenen Sprache zurücklesen. Die Beschreibung erwähnt das nicht.

`measure` rechnet korrekt. Kontrollprobe: `knee_l.bend 90` gesetzt, gemessener
Winkel bei `shin_l` zwischen `thigh_l` und `foot_l` = 85,8°. Die Differenz von
4,2° kommt aus der Knochenachse (der Fußknochen liegt nicht exakt in der
Unterschenkelachse), nicht aus einem Rechenfehler. Spannweite 1,4267 m bei
1,81 m Körperhöhe, Rumpfneigung 5,9° — alle plausibel.

## 2.1 Zwei verschiedene Vokabulare für denselben Körper

`set_pose` nimmt Gelenknamen, `measure` nimmt Körperpunkte. Sie überschneiden
sich nur teilweise:

    set_pose (18):  pelvis spine neck head shoulder_l/r arm_l/r elbow_l/r
                    hip_l/r knee_l/r ankle_l/r toes_l/r

    measure (22):   com pelvis spine neck head chest shoulder_l/r arm_l/r
                    forearm_l/r hand_l/r thigh_l/r shin_l/r foot_l/r toe_l/r

    gemeinsam (8):  pelvis spine neck head shoulder_l/r arm_l/r

    NICHT messbar unter ihrem Setz-Namen (10 von 18):
                    elbow_l/r hip_l/r knee_l/r ankle_l/r toes_l/r

Der Agent setzt `hip_l.flex` und bekommt beim Messen:

    Körperteil "hip_l" ist an diesem Modell nicht zugeordnet: 22 stehen zur
    Verfügung (com, pelvis, foot_l, thigh_l, ...)

Die Fehlermeldung listet die Alternativen, nennt aber nicht die Zuordnung. Der
Agent muss selbst erraten, dass sein `knee_l` beim Messen `shin_l` heißt,
`hip_l` zu `thigh_l` wird und `ankle_l` zu `foot_l`. Jedes Mal ein Fehlaufruf.

## 2.2 Die Sohle ist nicht messbar — der Agent kann Bodenhaftung nicht prüfen

In derselben Messung, Figur steht mit dem rechten Fuß auf dem Boden:

    Fuss_rechts_hoch:  hoehe foot_r = 0,0876 m über dem Boden

Der Fußknochen sitzt am Xbot rund 8,8 cm über der Sohle — das ist im Code an
anderer Stelle ausdrücklich vermerkt (`handlers.js`, Kommentar in `wirkung()`:
„eine Figur, die sauber steht, meldete damit 8,8 cm über dem Boden").

In der Messliste gibt es **keinen Sohlenpunkt**. `foot_l/r` ist der Knochen,
`toe_l/r` die Zehenspitze. Der Agent hat damit kein Mittel, die Frage „stehe ich
auf dem Boden" in Zahlen zu beantworten — er misst 8,8 cm und weiß nicht, ob das
Schweben ist oder korrektes Stehen.

Das ist die Messseite des Hauptbefunds aus dem Posenlauf (die Figur wird nie auf
den Boden gestellt): weder die Rückmeldung noch die Messung geben ihm die Zahl,
die er bräuchte.

---

# Punkt 3 — Was zwischen zwei Posen passiert (Interpolation)

Erhebung am 2. September 2026, ohne Änderung am Code.

## 3.1 Die letzte gesetzte Haltung hält nicht — sie fällt in EINEM Frame zusammen

Aufbau: Timeline 24 Frames, zwei Schlüsselbilder — Frame 0 leer, Frame 12
`arm_l.lift 80`. Danach nichts mehr gesetzt. Gemessen mit `measure`, Höhe der
linken Hand über dem Boden:

    Frame  0:  1,4410 m     Ruhelage
    Frame  3:  1,6331 m     steigt
    Frame  6:  1,8021 m
    Frame  9:  1,9275 m
    Frame 11:  1,9791 m
    Frame 12:  1,9942 m     der gesetzte Schlüsselframe
    Frame 13:  1,4410 m     <-- 55 cm Sturz in 1/30 Sekunde
    Frame 14:  1,4410 m
    Frame 23:  1,4410 m

Der Anstieg bis Frame 12 ist sauber und weich. Danach bricht der Kanal
schlagartig zusammen. `describe_pose` auf Frame 14 liefert
`winkel_grad: {}` — der Kanal existiert dort gar nicht mehr.

## 3.2 Ursache, im Code

`src/solver/loeser.js:375-384`, Funktion `verankereKurven`:

    const letzterEigener = liste[liste.length - 1];
    const danach = anker.find((a) => a.frame > letzterEigener.frame);
    if (danach) {
      liste.push({ frame: danach.frame, grad: letzterEigener.grad, ease: ... });
    }

Das „hinten halten" hängt eine Stützstelle nur an, **wenn es ein späteres
Schlüsselbild gibt**. Ist der gesetzte Frame der letzte der Timeline, ist
`danach` undefined, es wird nichts angehängt, und die Kurve endet dort.

Der Kommentar darüber benennt die Annahme ausdrücklich: „Die Kurve laeuft flach
weiter bis zum naechsten Schluesselbild und endet dort — was danach kommt,
gehoert weiter den Phasen (Regel aus kurvenWert)."

Bei einer reinen Schlüsselbild-Timeline — dem erklärten Hauptweg des Projekts,
`set_pose` heißt im Katalog „EBENE 1, DER HAUPTWEG" — gibt es keine Phasen. Der
Rückfall geht damit auf die Ruhelage.

## 3.3 Was das für den Agenten heißt

Er baut eine Bewegung über 24 Frames, setzt seinen letzten Schlüsselframe auf
12 und geht davon aus, dass die Haltung bis zum Ende steht. Tatsächlich steht
die Figur ab Frame 13 in der Bindepose. Gemeldet wird nichts — weder von
`set_pose`, noch von `validate`, noch im Bildstreifen (dort sähe er es nur,
wenn er zufällig einen Frame nach 12 rendert).

Der Fix vom 1. September („vorn einblenden, hinten halten", NACHLESE.md Punkt 5)
deckt den Fall zwischen zwei Schlüsselbildern ab. Der Fall NACH dem letzten
Schlüsselbild ist offen.

## 3.4 ZURÜCKGEZOGEN — `arm_l.lift` interpoliert korrekt

Ursprünglich als Fehler notiert: bei zwei symmetrischen Schlüsselbildern standen
die Arme auf halbem Weg unterschiedlich (Max am Bild, Frame 12: linker Arm
waagerecht, rechter schräg nach oben), und `describe_pose` zeigte auf Frame 9
für `arm_l.lift` 42,5° statt der rechnerischen -7,4°.

**Das war ein Artefakt des Messaufbaus, kein Fehler im Löser.**

Auf Frame 12 stand noch ein Schlüsselbild aus einem früheren Test dieses Laufs
(`arm_l.lift: 80`). Gesetzt wurden nur Frame 0 und 23 — der alte Keyframe
dazwischen blieb bestehen und wurde mitinterpoliert:

    Lauf 0 -> 90:    Frame 12 alt = 80   ->  9/12 x 80 = 60,0    = Messwert
    Lauf -70 -> 90:  Frame 12 alt = 80   ->  -70 + 9/12 x 150 = 42,5  = Messwert

Beide Messwerte erklären sich exakt aus dem Altbestand. `arm_l.lift`
interpoliert richtig.

### Was daraus als echter Befund bleibt

1. **Es gibt kein Zurücksetzen.** `set_duration` löscht gesetzte Haltungen
   nicht, ein Reset-Werkzeug existiert nicht. Wer eine neue Bewegung beginnt,
   erbt alle Schlüsselbilder der vorigen — auch auf Frames, die er nie anfasst.
   (Steht schon als Nebenbefund zu Pose 15; hier bestätigt er sich als
   Fehlerquelle, die einen erfahrenen Prüfer in die Irre geführt hat.)

2. **Die Warnung war da und wurde überlesen.** Jede `set_pose`-Antwort endet mit
   „Die Timeline hat jetzt 3 gesetzte Frames (0, 12, 23)". Die Information über
   den fremden Keyframe stand also im Text — am Ende eines langen Fließsatzes,
   in derselben Tonlage wie alles andere. Ein Agent überliest das aus demselben
   Grund, aus dem ich es überlesen habe: nichts daran sieht aus wie eine
   Abweichung von dem, was er gerade wollte.

3. **Fremde Schlüsselbilder tauchen unkommentiert in `describe_pose` auf.**
   Auf Frame 12 erschien `arm_l: {lift: 80}` in `winkel_grad`, ohne Hinweis,
   dass dieser Wert aus einem Schlüsselbild stammt, das der Agent in diesem
   Zusammenhang nie gesetzt hat.


## 3.5 Die Handstellung ist ein unbemerkter Nebeneffekt

Test 1 (Hocke -> Stand, Arme von -70 auf +90 gehoben), Max am Bild: „Die
Handflächen zeigen in der Endposition nach außen, in der Startposition zum
Körper." Gesetzt war nur `lift`, `twist` blieb unberührt auf 0.

Die Handflächenorientierung ergibt sich damit aus der Bindepose (T-Pose,
Handflächen nach unten) und dreht beim Heben oder Senken einfach mit. Der
Agent wählt sie nicht — er bekommt sie.

Der Katalogtext warnt davor, aber nur für eine Richtung:

    "WICHTIG beim Senken: in der T-Pose zeigt die Handflaeche nach unten.
     Senkst du den Arm nur mit lift, zeigt sie danach nach vorn und die Hand
     steht unnatuerlich ab. Faustregel am haengenden Arm: links twist +75,
     rechts twist -75."

Für das Heben steht dort nichts. Und auf dem Bildstreifen ist die Handstellung
in der gelieferten Größe kaum zu erkennen (siehe Punkt 1) — der Agent hat also
weder Hinweis noch Sicht.

## 3.6 Ein Kanal hält genau EIN Schlüsselbild weit — dann springt er

Sauberer Aufbau (Zustand vorher geleert, bestätigt „4 gesetzte Frames (0, 8, 16, 23)"):
`elbow_l.bend 120` NUR auf Frame 8. Knie auf 0 / 16 / 23.

    Frame  4:   75°     blendet aus der Ruhelage ein
    Frame  8:  120°     gesetzt
    Frame 12:  120°     gehalten
    Frame 15:  120°     gehalten
    Frame 16:  120°     gehalten (letztes Schlüsselbild der Haltespanne)
    Frame 17:    0°     <<< 120 Grad Sprung in einem Frame
    Frame 23:    0°

Max am Bild: „Der Arm springt auf einmal zurück." Meine eigene Erwartung war
eine Rückbewegung — es ist ein harter Schnitt.

Das ist dasselbe Verhalten wie in 3.1/3.2, hier zwischen zwei Schlüsselbildern
statt am Ende der Timeline: `verankereKurven` hängt eine Haltestützstelle nur
bis zum NÄCHSTEN Schlüsselbild an (`loeser.js:376`). Danach endet die Kurve, und
der Kanal fällt ohne Übergang auf die Ruhelage.

Für den Agenten heißt das: ein Wert, den er einmal setzt, gilt genau bis zum
nächsten Schlüsselbild — egal, welches, auch wenn dieses den Kanal gar nicht
betrifft. Danach ist er weg, ohne Meldung und ohne Übergang.

## 3.7 Anzeige zählt ab 1, Werkzeuge zählen ab 0

Aufgefallen beim Prüfen von 3.6: Max sah den Sprung des Ellbogens zwischen
Frame 17 und 18, die Messung lag zwischen 16 und 17.

Gegenprobe über beide Agentenwege, dieselbe Timeline:

    look-Bildstreifen:  Frame 15 gebeugt | 16 gebeugt | 17 gestreckt | 18 gestreckt
    describe_pose:            120°       |   120°     |    weg       |    weg

`look` und `describe_pose` stimmen überein — der Sprung liegt zwischen 16 und
17. Der Zeitregler der Oberfläche beginnt jedoch bei „Frame 1", die Werkzeuge
bei Frame 0.

Folge: Mensch und Agent reden dauerhaft über verschiedene Frames. Bei jeder
gemeinsamen Fehlersuche — Nutzer beschreibt, Agent misst nach — liegt der
Fehlgriff um genau einen Frame daneben.

## 3.8 Wurzelbewegung und `wurf` arbeiten korrekt

Sprung über 24 Frames, Wurzel von 0,8 m auf 1,5 m und 1,5 m vorwärts, Flugphase
mit `ease: wurf`. Gemessene Beckenhöhe:

    Frame  0:  0,803 m   (gesetzt 0,8)
    Frame  8:  1,503 m   (gesetzt 1,5)
    Frame 12:  1,590 m   <-- Bogen zwischen zwei gleich hohen Schlüsselbildern
    Frame 16:  1,503 m   (gesetzt 1,5)
    Frame 23:  0,803 m   (gesetzt 0,8)

Alle Schlüsselbilder exakt getroffen. Der Bogen von +8,7 cm zwischen Frame 8 und
16 entspricht exakt dem freien Fall über 0,133 s (0,5 x 9,81 x 0,133² = 8,7 cm) —
`wurf` rechnet physikalisch richtig.

### Fehlalarm dazu, und was daraus bleibt

Max am Bild: „das ist komplett daneben, die Hocke hat überhaupt nicht
funktioniert". Nachgemessen war der Rumpf über alle Frames konstant bei 5,9° von
der Senkrechten (dem Bindepose-Wert) — er kippt nicht, die Schräglage war
Perspektive.

Der eigentliche Fehler lag beim Autor der Pose: eine „Hocke" nur aus
`knee.bend 60` ohne `hip.flex` klappt lediglich die Unterschenkel nach hinten
(gemessen: Fuß 41 cm HINTER dem Becken). Das ist keine Hocke.

Bleibt als Befund: **niemand sagt es.** Weder `set_pose`, noch `measure`, noch
`validate` melden, dass die gebaute Haltung nicht das ist, was sie sein soll.
Der Agent baut denselben Fehler und bekommt dieselbe Stille.

### Test 4, saubere Wiederholung mit richtiger Hocke

Standweitsprung über 24 Frames, 4 Schlüsselbilder (Ausholen / Absprung / Flug /
Landung), Hüfte, Knie, Rumpf, Arme und Fußspitzen gesetzt, Wurzel mit
`ease: wurf`.

Max am Bild: „schaut jetzt deutlich besser aus wie ein Sprung … der Sprung und
die Hände, das passt alles. Die Füße stimmen nicht, die sind unter dem Boden."

Damit sauber getrennt: **die Steuerung trägt** — Keyframes, Interpolation,
Wurzelbahn und Armschwung ergeben eine erkennbare Bewegung. Was fehlt, ist
ausschließlich die Bodenhaftung, und zwar erneut, weil die Wurzelhöhe von Hand
geschätzt werden muss (0,72 m und 0,75 m, beide daneben).

## 3.9 Ruckeln — kein Befund

Schrittbewegung des linken Beins über 18 Frames, sieben Schlüsselbilder alle
drei Frames (Hüfte -20 -> 60 -> -20, Knie mit). Gemessene Fußhöhe je Frame:
kleinster Schritt 2,2 mm, größter 78,2 mm, fünf Richtungswechsel.

Der Faktor 36 zwischen kleinstem und größtem Schritt sieht nach Ruckeln aus, ist
aber keins: die Bewegung wechselt zweimal die Richtung, und an einem Umkehrpunkt
ist die Geschwindigkeit naturgemäß nahe null. Die Zahl misst die Bewegung, die
gesetzt wurde.

Max am abgespielten Clip: „ein starkes Ruckeln kann ich nicht bestätigen. Zu
1000 % flüssig kann ich aber auch nicht bestätigen."

Ergebnis: kein belastbarer Befund. Die in NACHLESE.md (1. September) genannten
Schwankungen um Faktor 42 mit vier Richtungswechseln in zwölf Frames sind in
diesem Aufbau nicht reproduzierbar.

---

# Nachtrag 2. September 2026 — was aus Punkt 1 gebaut wurde

## `validate`: ein Moment, zwei Blicke

Statt sechs Frames in zwei Ansichten (zwölf Kacheln) zeigt der Bericht jetzt
EINEN Frame aus zwei um 90 Grad versetzten Richtungen, jedes Bild 461 × 576 px.
Gewählt wird der Frame mit den MEISTEN Beanstandungen, bei Gleichstand der
früheste; ohne Beanstandung die Mitte der Bewegung.

Zwei Blicke, weil aus einem einzelnen ein 3D-Raum nicht eindeutig ist — ein Arm
VOR dem Körper und ein Arm NEBEN dem Körper sehen von vorn gleich aus.

Im Bild geblieben ist, was Zahlen nicht können: Höhenleiste, Bodengitter,
Schwerpunktkreuz mit Lot, Sohlenpunkte, Kompass. Rausgeflogen sind die vier
Textzeilen des Fußblocks, die acht Sohlennamen, der Ansichtsname und die
Körperhöhe — alles davon steht im Berichtstext und verdeckte im Bild genau die
Stellen, auf die man schauen muss.

## `trace`: der Ablauf als Folge grosser Einzelbilder

Neues Werkzeug. Es liefert DREI grosse Bilder in EINER Antwort, gleichmaessig
ueber die Timeline verteilt, in derselben Kamera — wie ein Daumenkino zu lesen.
Mit `von` und `bis` ruecken die drei Bilder enger zusammen.

### Zwei verworfene Wege davor

**Der Bildstreifen** klebte bis zu sechs Frames in EIN PNG. Jede Figur wurde
fingernagelgross; am Bild belegt, dass darauf nichts zu erkennen ist.

**Die Bewegungsspur** legte die Bahnen von Haenden, Fuessen und Becken ueber die
ganze Timeline in ein Bild. Sie zeigte einen Standweitsprung brauchbar — der
Sprungbogen war lesbar — scheiterte aber an zwei Punkten, und beide wiegen
schwer:

1. Sie verlangt Deutung statt Anschauung. Die Zeitrichtung steht nur in den
   Frame-Zahlen; ohne sie ist eine Bahn eine Linie, keine Bewegung.
2. Bei einer Bewegung, die denselben Weg mehrfach laeuft — drei
   Rueckwaertssaltos — ueberlagern sich die Bahnen zu einem Knaeuel, aus dem
   sich nichts mehr lesen laesst.

Eine MCP-Antwort traegt beliebig viele image-Bloecke. Der Zwang, alles in EIN
Bild zu pressen, war nie noetig.

### Gemessen

    3 Bilder, je 544 x 680 px (Skala 0,85)   397 KB von 512 KB Antwortbudget

Volle Groesse waeren 550 KB gewesen und damit abgewiesen. 544 x 680 ist immer
noch das Vierfache der alten Rasterkachel (300 x 380).

Die Kamera FOLGT der Figur, sie steht nicht still. Beides wurde ausprobiert: bei
fester Kamera lief die Figur eines Standweitsprungs (1,45 m weit) aus dem 2,26 m
breiten Bildfeld, die Pose war halb abgeschnitten. Fuer die Frage „flieszt die
Bewegung" zaehlt die Haltung; die Ortsveraenderung steht in `describe_pose` und
zeigt sich am weltfesten Bodengitter.

Dateien: `src/render/bildfolge.js`, Werkzeug in `catalog.js` und `handlers.js`.
