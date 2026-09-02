# Rig-Studio MCP — Reibungsbericht (Lauf 7)

Aufgabe: Anlauf (3 Schritte) → einbeiniger Absprung → Rückwärtssalto → Landung → Zirkusverbeugung.
Rig: Xbot.glb, Mixamo, 18 Gelenke, 1,81 m. Ergebnis: 175 Frames @ 30 fps, glTF exportiert.
Laufzeit: ~26 min. Bewertung durch den Auftraggeber: 80–90 % erreicht, überall fehlen 1–20 %.

---

## 1. Die teuersten Reibungspunkte (nach Zeitverlust sortiert)

### 1.1 Ballistik-Check steuerbar nur über die Wurzel — gemessen wird der Schwerpunkt

**Zeitanteil: ~40 % der Gesamtlaufzeit.**

`validate` prüft, ob der Schwerpunkt im Flug mit 9,81 m/s² fällt. Die einzige Steuergröße ist
`root.pos[1]` — das Becken. Bei einem Salto rotiert der Körper und faltet sich in den Tuck; der
Schwerpunkt wandert dabei relativ zum Becken auf einer Zykloide. Becken auf der Parabel ⇒
Schwerpunkt nicht auf der Parabel. Der Zielkonflikt ist strukturell nicht auflösbar, nur
näherbar.

Was ich tun musste: Posen setzen → `measure com` über 16 Frames → Offset je Frame ausrechnen →
Wurzelhöhen korrigieren → erneut setzen → wiederholen. Fünf Runden, ~20 Toolaufrufe.
Ergebnis: von 63 m/s² auf 25 m/s² gedrückt, nie auf 9,81.

Was fehlt: ein Modus, in dem man den **Schwerpunkt** auf die Wurfparabel setzt und der Löser die
Wurzel dazu rechnet. Genau umgekehrt zur jetzigen Logik.

### 1.2 ease "wurf" verschlechtert die Ballistik, statt sie zu lösen

Die Toolbeschreibung sagt: *"Nimm ihn für die Flugphase — dann genügen zwei Schlüsselbilder für
den ganzen Flug, und die Ballistikprüfung ist still."*

Gemessen:

| Interpolation | Ballistik-Spitze |
|---|---|
| smooth, 5 Flugkeys | 58 m/s² |
| **wurf**, 5 Flugkeys | **63 m/s²** |
| smooth, 7 Flugkeys mit gemessener SP-Korrektur | 25 m/s² |

Grund: `wurf` legt die **Wurzelhöhe** auf eine Parabel, nicht den Schwerpunkt — siehe 1.1. Für
eine gestreckte Flugpose stimmt das Versprechen; für jede Pose, die sich im Flug verändert
(also jeden Salto), ist es falsch. Die Beschreibung verspricht mehr, als der Modus kann, und
lenkt aktiv in die falsche Richtung.

### 1.3 Kanal-Vorzeichen sind pro Kanalname dokumentiert, nicht pro Gelenk

**Zeitanteil: 23 Reparatur-Aufrufe + eine komplett falsche erste Fassung des Anlaufs.**

`describe_rig` liefert:

```
swing: + schwingt den linken Arm nach vorn, - nach hinten
```

Die Zeile steht **einmal** für den Kanalnamen `swing`, der an `arm_l` *und* `arm_r` existiert.
Sie sagt nichts darüber, ob `arm_r` gespiegelt ist. Ich habe Spiegelung angenommen (bei
Mixamo-Rigs oft so) und den kompletten Anlauf mit parallel statt gegengleich schwingenden
Armen gebaut — sichtbar erst im Renderbild bei Frame 70.

Tatsächliche Konvention: **nicht gespiegelt.** `swing +` = vorn für beide Arme.
Nachgewiesen mit `measure abstand_vorne hand_l/pelvis` = +0,25 m bei `swing +35` und
`hand_r/pelvis` = −0,39 m bei `swing −35`.

Was fehlt: Vorzeichenangabe je **Gelenk**, nicht je Kanalname. Oder ein Feld
`gespiegelt: true/false` an den paarigen Gelenken.

### 1.4 Kanäle sind Euler-Achsen mit undokumentierter Reihenfolge

`arm_l` mit `lift −70, swing 45` ⇒ Arm steht waagerecht nach vorn.
`arm_l` mit `lift −80, swing 35` ⇒ Arm hängt und schwingt nach vorn.

10° Unterschied in `lift` kippen die Wirkung von `swing` komplett, weil `swing` um die
Welt-y-Achse dreht und `lift` um z. Bei fast senkrecht hängendem Arm wird `swing` zur
Schwungachse, bei angehobenem Arm zur Drehachse um die eigene Länge. Nirgends dokumentiert; nur
durch Probieren (`set_pose` + `look`) herauszufinden.

Was fehlt: die Rotationsreihenfolge in `describe_rig detail: true`, oder besser: Kanäle, die
unabhängig von der Nachbarstellung dasselbe tun.

### 1.5 hold_foot nagelt den ganzen Fuß — es gibt kein Abrollen

Der Anker hält `foot_*` an einer Position. Ein menschlicher Abdruck rollt aber über den
Ballen ab: Ferse hebt, Zehe bleibt.

Konkreter Konflikt: Absprungpose mit `ankle_l.point 50` (Zehenstand) + Anker bis Frame 78 ⇒
Meldung *"ankle_l.point 50° → −22,604°"*. Der Anker hat exakt den Winkel plattgebogen, der den
Absprung verkauft. Ich musste den Anker auf Frame 72 verkürzen und dafür 13 cm Fußrutschen in
Kauf nehmen — beides schlecht, keine dritte Option.

Was fehlt: `hold_toe` bzw. ein Rollkontakt (Ferse–Ballen–Zehe über eine Framespanne). Das Rig
hat `toes_l`/`toes_r` mit −40..60° — ohne Ankerunterstützung für Kontakte praktisch nutzlos.

### 1.6 set_intent rotation kann bei einem Salto per Konstruktion nicht bestehen

Kriterium: `rotation, part: mixamorigHips, axis: x, maxDeg: -300`.
Gemessen: **0,0°** — bei einer Animation, die nachweislich 360° rotiert (Renderbild Frame 85
zeigt die Figur kopfüber).

Grund: Der Check liest die Rotation des **Knochens** `mixamorigHips`. Der einzige Weg, einen
Salto zu bauen, ist `root.drehGrad.x` — die **Wurzeltransformation**, die der Check nicht sieht.
Der einzige Weg zum Salto ist damit zugleich der einzige Weg, den Salto-Check zu verfehlen.

Das ist der klarste Bug im Zusammenspiel zweier Werkzeuge.

### 1.6b set_joint auf einem posenlosen Frame reißt die Figur auf den Boden (Fund aus Lauf 8)

Der schwerste Einzelfund. `set_joint(frame, joint, channel, angle)` auf einem Frame, der **noch
keine Pose** hat, erzeugt dort einen vollwertigen Keyframe. Dessen Wurzel fällt dabei auf den
Standardwert zurück — Bodenhöhe.

In einer Flugphase ist das fatal. Gemessen in Lauf 8 nach zwei harmlos gemeinten
Ellbogenkorrekturen bei Frame 55 und 61 mitten im Salto:

| Frame | Becken (m) | erwartet |
|---|---|---|
| 54 | 1,407 | 1,404 |
| **55** | **0,046** | ~1,55 |
| 58 | 1,754 | 1,751 |
| **61** | **0,516** | ~1,95 |
| 62 | 2,068 | 2,065 |

Die Figur klappte zweimal pro Salto auf den Boden und sprang zurück. Ballistik-Befund:
**1721 m/s²**. Nach dem Löschen der beiden Overrides: **5 m/s²**.

Die Toolbeschreibung sagt: *"EBENE 1, Feinschliff — setzt EINEN Kanal EINES Gelenks in einem
Frame."* Von einem impliziten Wurzel-Reset steht dort nichts, und die Antwort meldet es auch
nicht — sie sagt nur "N Frames haben jetzt Overrides".

Regel bis zur Behebung: `set_joint` nur auf Frames anwenden, die bereits eine `set_pose` mit
`root` tragen. Für Zwischenkorrekturen im Flug eine vollständige `set_pose` mit expliziter
Wurzelhöhe setzen.

### 1.7 Renderaussetzer: Mesh fehlt bei stark gebeugten oder rotierten Posen

`look`/`trace` lieferten bei den Frames 56, 70, 85, 88, 100, 124, 143, 150, 151, 162 nur das
Skelett ohne Haut, bei den Frames 17, 24, 64 dagegen das volle Mesh — bei gleichen
Kameraparametern.

Folge: Genau die Frames, die am schwersten zu beurteilen sind (Tuck, Verbeugung), kamen als
Drahtgitter. Ich habe bei Frame 150 zuerst eine korrekte Pose für kaputt gehalten, weil ein
Skelett ohne Volumen nicht lesbar ist.

### 1.8 Kameraskalierung nicht stabil, obwohl zugesagt

`look` sagt zu: *"Bei gleicher weite ist der Massstab in jedem Bild derselbe und das Bodengitter
steht fest im Raum, die Bilder sind also untereinander vergleichbar."*

Die beiden Bilder aus einem `validate`-Aufruf (Richtung 30° und 120°, beide `weite: ganz`,
derselbe Frame 64) hatten sichtbar verschiedene Maßstäbe — im einen reicht die Höhenleiste bis
1,20 m, im anderen bis 2,00 m. Ich habe daraufhin eine korrekte Pose als "35 cm zu tief
abgesackt" fehlinterpretiert.

### 1.9 Rutschmeldung feuert für Füße, die gar nicht am Boden sind

Meldung beim Setzen: *"foot_l wandert 144 cm seit Frame 56, obwohl der Boden berührt wird"* —
für den Schwungfuß, der in dieser Spanne mitten in der Luft war. Der Test scheint zu prüfen, ob
**die Figur** Bodenkontakt hat, nicht **dieser Fuß**.

Kosten: mehrfach Zeit in die Suche nach schleifenden Füßen investiert, die nicht schliffen.

### 1.10 Kein Batch, kein Spiegeln, kein Kopieren von Posen

- `set_joint` = ein Kanal, ein Frame, ein Aufruf. Die Vorzeichenkorrektur an `arm_r.swing`
  kostete **23 Aufrufe** für denselben Kanal über 23 Frames.
- Ein Laufzyklus ist links/rechts gespiegelt. Es gibt kein `mirror_pose` — jede Schrittpose
  musste zweimal von Hand geschrieben werden, mit entsprechender Fehlerquote.
- `move_pose` verschiebt, aber es gibt kein `copy_pose`.

Was fehlt: `set_joints(frames: [...], joint, channel, angle)` und `copy_pose(von, nach, spiegeln)`.

### 1.11 validate ist teuer und nicht filterbar

Jeder Aufruf liefert ~60 Befunde als vollständiges JSON plus zwei Bilder. Sechs Läufe waren
nötig. Es gibt keinen Filter nach Art, Schwellwert oder Framebereich.

Was fehlt: `validate(nur: ["ballistik"], abBetrag: 0.1, von: 78, bis: 100)`.

---

## 2. Was gut funktioniert hat

- `describe_pose` als Zahlen-Gegenstück zu `look` — die Rückgabe der **gefahrenen** Winkel
  inklusive der vom Löser umgebogenen ist genau richtig.
- Die Wirkungsmeldung direkt in der `set_pose`-Antwort (Schwerpunkthöhe, Bodenabstand,
  Durchdringungswarnung) hat mehrere Iterationen gespart — Feedback am Ort der Aktion.
- `measure` mit `frames: [...]` — 16 Frames Schwerpunktverlauf in einem Aufruf. Ohne das wäre
  die Ballistik nicht beherrschbar gewesen.
- `probe_joint` mit Vorher/Nachher-Bild zur Vorzeichenklärung.
- Der automatische Bodenkontakt (`y: null`) nimmt die gesamte Standhöhenrechnung ab.

---

## 3. Laufzeitaufschlüsselung (~26 min)

| Block | Anteil | vermeidbar? |
|---|---|---|
| Ballistik-Iterationen (measure → rechnen → 7 Posen neu → validate) | ~40 % | nur teilweise — strukturelles Toolproblem (1.1) |
| Vorzeichen-Reparatur arm_r (23 Aufrufe) | ~15 % | **ja** — eigene Messung aus Frame 1 war schon vorhanden |
| Posen setzen (30 Keys, Hauptarbeit) | ~20 % | nein |
| 6× validate mit je ~60 Befunden | ~10 % | teilweise (1.11) |
| Bildabrufe und Fehlinterpretation von Renderaussetzern | ~10 % | teilweise (1.7, 1.8) |
| Fußanker-Nachjustierung | ~5 % | teilweise (1.5) |

**Kernbefund:** Rund die Hälfte der Zeit ging in physikalische Prüfkriterien, die der Zuschauer
nicht sieht. In derselben Zeit wären Nachschwingen, Zehenabrollen und Absprungtiming zu bauen
gewesen — also genau die fehlenden 10–20 %.

---

## 4. Was beim nächsten Mal anders läuft

1. **Zuerst eine Kalibrierpose** für alle paarigen Gelenke, mit `measure` verifiziert, bevor
   irgendeine Bewegung entsteht. Kosten: 3 Aufrufe. Ersparnis hier: 23.
2. **Nach spätestens 3 gesetzten Posen ein Bild.** Diesmal standen 11 Posen, bevor das erste
   Bild kam.
3. **Kontakte vor Posen.** Anker setzen, dann Posen um die Anker herum bauen — nicht umgekehrt.
   Sonst biegt der Löser die aussagekräftigsten Winkel platt.
4. **Ballistik einmal grob, dann stehen lassen.** 25 m/s² Spitze über 9 Frames sieht niemand.
   Zeitbudget stattdessen in Timing und Nachschwingen.
5. **Timing aus der Realität ansetzen**, nicht aus dem Gefühl: Absprungkontakt 0,12–0,20 s,
   Anlauftempo 2,5–4 m/s.
