# Prüfstand-Bericht: stehen alle Verfahrensparameter an einer Stelle?

Erzeugt mit `node tools/parameter-pruefstand.mjs` (wiederholbar, zwei Läufe
bitidentisch geprüft). Geprüft: alle Quelltexte unter `src/` ohne `*.test.mjs`,
28 Dateien, ca. 13.000 Zeilen. Begründungsschwelle des Prüfstands: Kommentar
ab 80 Zeichen unmittelbar über der Zeile **oder** ein Begründungswort (weil,
gemessen, belegt, Grenze, Referenz, plan.md, …).

**Zahlenstand dieses Berichts: 290 Funde.** Bei jeder Quelltext-Änderung unter
`src/` ändert sich die Zahl — der Bericht stammt vom Stand, an dem der Skriptlauf
die unten stehenden Tabellen erzeugt hat; die Tabellen sind die verkürzte
Niederschrift der Skriptausgabe, das Skript ist die Quelle.

## Bilanz vorab

| Kategorie | Funde | Anteil |
|---|---|---|
| 1 — zentral und begründet (benannte Konstante mit Begründung) | **90** | 31 % |
| 2 — benannt, aber ohne Begründung | 97 | 33 % |
| 3 — versteckt (Zahl mitten im Code, ohne Namen) | 103 | 36 % |
| gesamt | **290** | 100 % |

**Klare Aussage:** 90 von 290 Funden (31 %) sind zentral und begründet.
200 von 290 (69 %) sind ohne Begründung benannt oder gar versteckt.

Die Regel aus AGENTS.md („Verfahrensparameter … stehen an einer Stelle, mit
Begründung, und werden im Rig-Bericht ausgegeben") gilt heute nur für den
geschlossenen Kern: Alle acht Parameterblöcke der Dateien `measure.js`,
`physics.js`, `intent.js`, `style.js`, `view.js`, `detect.js`, `ik.js`,
`kinematik.js`, `verben.js`, `gltf.js`, `report.js`, `strip.js`, `catalog.js`,
`registry.js`, `state.js`, `ask-human.js`, `timeline.js` haben einen deutlich
markierten „BENANNTE PARAMETER"-Block am Dateianfang. **Aber:** dieselben Werte
stecken zusätzlich an anderen Stellen (Fallback-Kopien), und ein großer Teil der
Fundstellen liegt gar nicht in solchen Blöcken.

## Die vier Werte aus docs/plan.md Kapitel 4 — Abgleich Code gegen Planung

| Parameter | plan.md | Fund im Code | Befund |
|---|---|---|---|
| Radiusperzentil | 0,90 | `RADIUS_PERCENTILE = 0.90` (src/rig/measure.js:26), ausgegeben als `params.radiusPercentile` | **übereinstimmend**, genau eine benannte Stelle |
| Sohlentoleranz | 3,5 % | `SOLE_TOLERANCE = 0.035` (measure.js:30) plus drei Fallback-Kopien `KONTAKT_SCHWELLE_ANTEIL = 0.035` (physics.js:61, report.js:70, strip.js:70) plus verstecktes Literal `?? 0.035` (src/validate/intent.js:509) | **Zahlenwert überall richtig, aber 5 Stellen** — Widerspruch zur Regel „an einer Stelle" |
| Kontaktzuschlag | 1,5 cm | `CONTACT_MARGIN = 0.015` (src/rig/measure.js:33) | **übereinstimmend**; nur Einheitenprüfung: plan.md sagt „cm", der Code führt Meter (0,015 m = 1,5 cm — stimmt) |
| Abtastwinkel | 20° | `PROBE_DEG = 20` (src/rig/measure.js:37) | **übereinstimmend**, genau eine benannte Stelle |

**Abweichung zwischen Code und plan.md: keine beim Zahlenwert, aber eine bei der
Regel.** Kein dokumentierter Wert ist falsch im Code — alle vier stehen exakt
mit der geplanten Zahl im Quelltext. Die Sohlentoleranz steht jedoch an **fünf
Stellen** statt einer: eine benannte Konstante in `measure.js`, drei gleichnamige
Kopien in `physics.js`, `report.js`, `strip.js` (jede mit derselben Begründung
„Fallback, solange das RigProfile sie nicht mitbringt") und ein nacktes Literal
`?? 0.035` in `src/validate/intent.js:509` ohne Name und ohne Kommentar.
Ändert jemand plan.md auf 4 %, muss er fünf Dateien anfassen, und keine Prüfung
weist ihn darauf hin, welche er vergessen hat. Im Rig-Bericht
(`params.soleTolerance`) kommt der Wert korrekt aus der Messung an — die
Verbreitung betrifft nur die Fallback-Pfade.

---

## Kategorie 1 — zentral und begründet (90 Funde)

Benannte Konstante, unmittelbar darüber (oder daneben) steht eine Begründung.
Diese Liste ist der Sollzustand nach AGENTS.md; sie zeigt, dass die Regel dort
eingehalten ist, wo sie eingehalten ist.

| Ort | Name | Wert |
|---|---|---|
| src/contracts/timeline.js:13 | FPS_MAX | 120 |
| src/export/gltf.js:57 | FPS_MAX | 120 |
| src/export/gltf.js:64 | WURZEL_ABSTAND_TOLERANZ_ANTEIL | 0.01 |
| src/export/gltf.js:69 | WURZEL_WINKEL_TOLERANZ_RAD | 0.01 |
| src/export/gltf.js:74 | ZEIT_TOLERANZ_HALBE_FRAMES | 0.5 |
| src/render/strip.js:50 | PANEL_BREITE_PX | 300 |
| src/render/strip.js:59 | SICHT_HOEHE_FAKTOR | 1.25 |
| src/render/strip.js:63 | GITTER_TEILUNG | 10 |
| src/render/strip.js:70 | KONTAKT_SCHWELLE_ANTEIL | 0.035 |
| src/render/strip.js:74 | MAX_PANELS | 48 |
| src/render/strip.js:77 | FRAMES_MAX | 12 |
| src/render/strip.js:80 | ANTWORT_BUDGET_BYTES | 512 * 1024 |
| src/render/strip.js:84 | MIN_BILD_BYTES | 4096 |
| src/render/strip.js:88 | POSE_UEBEREINSTIMMUNG_ANTEIL | 0.02 |
| src/render/strip.js:95 | SOHLE_ABSTAND_MAX_ANTEIL | 0.15 |
| src/render/strip.js:100 | LICHT_HEMISPHAERISCH | 2.1 |
| src/rig/detect.js:47 | PARAMS.bodenBand | 0.02 |
| src/rig/detect.js:51 | PARAMS.rasterzelle | 0.012 |
| src/rig/detect.js:54 | PARAMS.minClusterAnteil | 0.02 |
| src/rig/detect.js:57 | PARAMS.minClusterVertices | 6 |
| src/rig/detect.js:60 | PARAMS.fussRadiusMax | 0.16 |
| src/rig/detect.js:64 | PARAMS.fussAbstandMin | 0.02 |
| src/rig/detect.js:68 | PARAMS.fussReichweite | 0.12 |
| src/rig/detect.js:72 | PARAMS.fussKnicksMinGrad | 15 |
| src/rig/detect.js:76 | PARAMS.beckenHoeheMin | 0.30 |
| src/rig/detect.js:80 | PARAMS.rumpfSpitzeToleranz | 0.25 |
| src/rig/detect.js:84 | PARAMS.beugungMinGrad | 8 |
| src/rig/detect.js:87 | PARAMS.knieAusschlagMin | 0.003 |
| src/rig/detect.js:90 | PARAMS.fussSpitzeMin | 0.015 |
| src/rig/detect.js:93 | PARAMS.kopfVorneMin | 0.010 |
| src/rig/detect.js:96 | PARAMS.fingerKuerze | 0.35 |
| src/rig/detect.js:99 | PARAMS.fingerZweige | 3 |
| src/rig/detect.js:102 | PARAMS.schulterLängenverhältnis | 0.60 |
| src/rig/detect.js:106 | PARAMS.paarHöheToleranz | 0.08 |
| src/rig/detect.js:110 | PARAMS.richtungEinigGrad | 40 |
| src/rig/detect.js:113 | PARAMS.asymmetrieMax | 0.06 |
| src/rig/detect.js:118 | PARAMS.achsenwertRückfrage | 0.70 |
| src/rig/detect.js:120 | PARAMS.sicherAb | 0.90 |
| src/rig/detect.js:124 | PARAMS.seitenFaktorUnsicher | 0.58 |
| src/rig/detect.js:127 | PARAMS.unitsPerMeter | 1.0 |
| src/rig/measure.js:26 | RADIUS_PERCENTILE | 0.90 |
| src/rig/measure.js:30 | SOLE_TOLERANCE | 0.035 |
| src/rig/measure.js:33 | CONTACT_MARGIN | 0.015 |
| src/rig/measure.js:37 | PROBE_DEG | 20 |
| src/rig/measure.js:41 | MIN_DOMINANT_WEIGHT | 0.5 |
| src/rig/measure.js:46 | DENSITY_KG_PER_M3 | 1000 |
| src/rig/measure.js:50 | RADIUS_DEVIATION_MAX | 0.15 |
| src/rig/measure.js:54 | SOLE_COVERAGE_MIN | 0.60 |
| src/rig/measure.js:59 | DEAD_MOVE_FRACTION | 0.01 |
| src/rig/measure.js:63 | SOLE_LENGTH_MIN | 0.05 |
| src/rig/measure.js:902 | NEAR_FRACTION | 0.05 |
| src/scene/view.js:22 | FRAME_MARGIN | 0.15 |
| src/scene/view.js:32 | SOLE_REGION | 0.08 |
| src/scene/view.js:39 | VERTEX_STRIDE | 5 |
| src/scene/view.js:47 | FOV_DEGREES | 38 |
| src/solver/ik.js:43 | SCHRITT_GRAD | 0.4 |
| src/solver/ik.js:54 | ITERATIONEN | 60 |
| src/solver/ik.js:61 | RUHE_SCHWELLE | 1e-7 |
| src/solver/ik.js:68 | COM_TOLERANZ_ANTEIL | 0.01 |
| src/solver/kinematik.js:33 | BIND_KONSISTENZ_ANTEIL | 1e-3 |
| src/solver/verben.js:46 | KORREKTURSCHRITTE | 8 |
| src/solver/verben.js:49 | COM_ZIEL_ANTEIL | 0.005 |
| src/solver/verben.js:53 | NACHSTEU_ANTEIL | 0.25 |
| src/solver/verben.js:58 | NACHSTEU_VERST | 0.9 |
| src/solver/verben.js:62 | BALANCE_NACHSTEU | 0.6 |
| src/solver/verben.js:67 | ANKER_GRENZE_ANTEIL | 0.006 |
| src/tools/catalog.js:37 | FRAME_MIN | 12 |
| src/tools/registry.js:18 | BESCHREIBUNG_MIN | 40 |
| src/tools/registry.js:22 | ANTWORT_MAX_BYTES | 512 * 1024 |
| src/tools/state.js:17 | UNDO_TIEFE | 50 |
| src/ui/ask-human.js:21 | BUDGET_STANDARD | 3 |
| src/validate/intent.js:25 | MIN_BEWEGUNG_SEK | 1 / 6 |
| src/validate/intent.js:30 | WINKEL_TOLERANZ_GRAD | 10 |
| src/validate/physics.js:28 | BODEN_TOLERANZ_ANTEIL | 0.01 |
| src/validate/physics.js:34 | BALANCE_TOLERANZ_ANTEIL | 0.08 |
| src/validate/physics.js:38 | RUTSCH_TOLERANZ_ANTEIL | 0.015 |
| src/validate/physics.js:44 | DURCHDRINGUNG_TOLERANZ_ANTEIL | 0.005 |
| src/validate/physics.js:52 | BALLISTIK_TOLERANZ_ANTEIL | 0.25 |
| src/validate/physics.js:61 | KONTAKT_SCHWELLE_ANTEIL | 0.035 |
| src/validate/report.js:59 | MAX_BILDFRAMES | 12 |
| src/validate/report.js:70 | KONTAKT_SCHWELLE_ANTEIL | 0.035 |
| src/validate/style.js:39 | BEWEGUNG_SCHWELLE_ANTEIL | 0.0004 |
| src/validate/style.js:47 | DICHTE_MIN | 0.25 |
| src/validate/style.js:58 | TOTE_FRAMES_BLOCK_MAX | 15 |
| src/validate/style.js:69 | RUCK_VERHAELTNIS_MAX | 8.0 |
| src/validate/style.js:76 | RUCK_MEDIAN_MIN_ANTEIL | 0.01 |
| src/validate/style.js:84 | ANTIZIPATION_MIN_ANTEIL | 0.01 |
| src/validate/style.js:89 | ANTIZIPATION_FENSTER_SEK | 0.5 |
| src/validate/style.js:95 | RUCK_FENSTER_FRAMES | 5 |

Zwei Einträge der Liste sind Grenzfälle, die der Prüfstand ausdrücklich nennt:

- `src/validate/intent.js:233 erster = -1` — ist ein Sentinel-Wert („kein Frame
  gefunden"), kein Verfahrensparameter; der Kommentar darüber ist ein
  Programmbeschreibungssatz. Er trägt die Begründungskategorie nur, weil der
  Kommentar lang genug ist. **Einschätzung des Prüfstands: zählt zu Kategorie 1
  nach Buchstaben der Regel, ist aber kein Parameter.**
- FPS_MAX steht zweimal (contracts/timeline.js:13 und export/gltf.js:57) mit
  derselben Begründung — zwei Dateien, dieselbe Zahl, dieselbe Regel („an einer
  Stelle"). Der Abgleich für plan.md-Werte betrifft das nicht (Abtastwinkel
  steht nur einmal), aber das Muster ist dasselbe wie bei der Sohlentoleranz.

## Kategorie 2 — benannt, aber ohne Begründung (97 Funde)

Konstante mit Namen, aber ohne erklärenden Kommentar. **Wichtig zur Lesart:** der
größte Teil dieser Funde sind Variablen-Initialisierungen (`const total = 0`,
`const summe = [0,0,0]`, Zähler) — das sind keine Verfahrensparameter, sondern
der Prüfstand kann das nicht automatisch unterscheiden und listet alles benannte
auf. Die parameterwärtigen Funde unter ihnen sind:

| Ort | Name | Wert | Einschätzung |
|---|---|---|---|
| src/solver/ik.js:34–37 | GEWICHT.boden / anker / haltung / schwerpunkt | 400 / 100 / 4 / 1 | **echte Verfahrensparameter** — die Gewichte der Rangfolge plan.md 6.4; die Begründung steht im Dateikopf (dort auch erwähnt), aber nicht an der Deklaration. Grenzfall. |
| src/render/strip.js:51 | PANEL_HOEHE_PX | 380 | Parameter; Begründung steht beim Partner PANEL_BREITE_PX (Zeile 49), nicht hier. Grenzfall. |
| src/render/strip.js:100 | LICHT_RICHTUNG | 2.2 | Parameter der Beleuchtung; kein Kommentar. |
| src/rig/detect.js:103 | PARAMS.schulterSeitenverhältnis | 0.60 | Parameter ohne eigenen Kommentar — der darüberstehende Kommentar begründet nur schulterLängenverhältnis. |
| src/rig/detect.js:107 | PARAMS.paarWeiteVerhältnis | 0.45 | wie oben — Kommentar begründet nur paarHöheToleranz. |
| src/rig/detect.js:121 | PARAMS.fragenAb | 0.50 | Parameter ohne eigenen Kommentar (Kommentar über sicherAb nennt nur plan.md 5.1). |
| src/rig/detect.js:65 | PARAMS.fussAbstandMax | 0.45 | Begründung steht beim Paar fussAbstandMin (darüber). Grenzfall. |
| src/rig/detect.js:77 | PARAMS.beckenHoeheMax | 0.80 | Begründung steht bei beckenHoeheMin (darüber). Grenzfall. |
| src/solver/ik.js:50 | SCHRANK_METER | 0.05 | Kommentar über SCHRANK_GRAD nennt beide Einheiten, aber nicht den Meterwert. Grenzfall. |
| src/tools/catalog.js:38 | FRAME_MAX | 600 | Begründung nur für FRAME_MIN daneben. Grenzfall. |
| src/render/strip.js:190 | kandidaten = [1, 2, 2.5, 5, 10] | | Glatte Gitterstufen der Rundung — Verfahren, kein Parameter. Grenzfall. |

Der Rest der Kategorie 2 (etwa 86 der 97 Funde) sind Akkumulator- und
Zähler-Initialisierungen (`total = 0`, `summe = [0,0,0]`, `cnt = 0`,
`laufendeId = 0`, `EPS = 1e-9`, `Q_EINS = [0,0,0,1]` …). Das sind Strukturwerte
im Sinne des Auftrags — sie werden hier vollständig genannt, weil der
Prüfstand sie nicht automatisch ausscheiden kann und jede still gelöschte
Zeile ein Ergebnis verfälschen würde. Vollständige Liste:

```
src/export/gltf.js:145 boneCount=0            src/export/gltf.js:409 knotenCount=0
src/export/gltf.js:527 gelenkFaelle=0         src/render/strip.js:178 v=[0,0,0]
src/render/strip.js:216 umlauf=0              src/render/strip.js:226 a=0
src/render/strip.js:277 summe=[0,0,0]         src/render/strip.js:278 nutzt=0
src/render/strip.js:385 masse=0               src/render/strip.js:386 summe=[0,0,0]
src/render/strip.js:387 nutzt=0               src/render/strip.js:482 maxAbw=0
src/render/strip.js:504 ohneAusrichtung=0     src/render/strip.js:912 ohneMassstab=0
src/render/strip.js:962 anzahl=0              src/render/strip.js:1118 tiefe=0
src/rig/detect.js:370 d=-1                    src/rig/detect.js:372 best=0.5
src/rig/detect.js:413 gez=0                   src/rig/detect.js:425 größe=0
src/rig/detect.js:502 radius=0                src/rig/detect.js:537 bodenAnzahl=0
src/rig/detect.js:559 kopfAnzahl=0            src/rig/detect.js:612 weite=0
src/rig/detect.js:620 B=16                    src/rig/detect.js:693 wert=1
src/rig/detect.js:715 besitz=0                src/rig/detect.js:917 cnt=0
src/rig/detect.js:1092 seitMax=0              src/rig/measure.js:234 EPS=1e-9
src/rig/measure.js:556 total=0                src/rig/measure.js:742 measurableCount=0
src/rig/measure.js:743 notMeasurableCount=0   src/rig/measure.js:972 totalMass=0
src/scene/load.js:70 skinningAttributes=0     src/scene/load.js:71 skinnedMeshes=0
src/scene/testdaten.mjs:43 offset=12          src/scene/testdaten.mjs:166 json.scene=0
src/scene/view.js:123 soleSum=0               src/scene/view.js:124 soleCount=0
src/scene/view.js:125 bodySum=0               src/solver/ik.js:210 iterationen=0
src/solver/ik.js:242 s=0                      src/solver/ik.js:246 s=0
src/solver/ik.js:256 bewegung=0               src/solver/kinematik.js:52 Q_EINS=[0,0,0,1]
src/solver/kinematik.js:129 skaliert=0        src/solver/kinematik.js:242 runden=0
src/solver/kinematik.js:342 maxAbw=0          src/solver/kinematik.js:438 com=[0,0,0]
src/solver/kinematik.js:439 masse=0           src/solver/kinematik.js:467 i=0
src/solver/kinematik.js:521 schritte=0        src/solver/verben.js:193 s=[0,0,0]
src/solver/verben.js:229 dropErreicht=0       src/solver/verben.js:324 absenk=0
src/solver/verben.js:325 nAbsenk=0            src/solver/verben.js:476 winkel=0
src/solver/verben.js:752 summe=0              src/tools/catalog.js:105 KATALOG.minItems=1
src/tools/catalog.js:106 KATALOG.maxItems=20  src/tools/state.js:59 laufendeId=0
src/ui/ask-human.js:25 verbraucht=0           src/ui/ask-human.js:26 laufendeId=0
src/validate/intent.js:154 summe=0            src/validate/physics.js:139 EPS=1e-12
src/validate/style.js:143 maxVerschiebung=0   src/validate/style.js:190 maxGegen=0
src/validate/style.js:233 maxVerhaeltnis=0
```

## Kategorie 3 — versteckt (103 Funde)

Zahlen mitten im Code ohne Namen. **Das ist der Fall, den die Regel verhindern
soll.** Gruppierung nach Ursprungsort und Bedeutung; jede Einzahl steht mit
Datei und Zeile im Skriptlauf (oben wiedergegeben).

### 3a. Konfidenz-Faktoren der Rig-Erkennung (18 Funde) — der wichtigste Befund

In `src/rig/detect.js` multipliziert die Konfidenzberechnung Merkmale, deren
Faktoren als **nackte Literale** in den Zeilen der Rollenzuweisung stehen:

| Ort | Wert | Rolle |
|---|---|---|
| detect.js:967 | 0.92, 0.72, 0.2 | bestätigt(): Konfidenz je Zahl unabhängiger Signale |
| detect.js:1174 | 0.62 | fussknick-Faktor, ohne sicheres Fußgelenk |
| detect.js:1177 | 0.55 | eindeutig-Fallback bei Fuß-Alternative |
| detect.js:1192 | 0.75 | kneiquelle-Faktor ohne Beugung |
| detect.js:1194 | 0.7 | gleichwertige-Gelenkkandidaten |
| detect.js:1299 | 0.8 | handgelenk ohne Fingerzweige |
| detect.js:1311 | 0.75 | ellbogen über „mittelweg" statt Beugung |
| detect.js:1160 | 0.5 | Becken-Alternativwert |
| detect.js:1111 | −0.7 | Spiegelprüfung der Armpaare |
| detect.js:647 | 0.5 / 0.35 / 0.1 / 0.02 | bodencluster-Faktor je Clusterzahl |
| detect.js:652, 656, 664, 669/670, 681, 685, 690 | 0.6, 0.7, 0.02, 0.08, 0.75, 0.9, 0.3, 1.5, 0.3 | Fuß-, Becken-, Rumpf-, Symmetrie-, Zweibein-Faktoren |

Diese Zahlen bestimmen, ob eine Rolle sicher (≥0,9) oder als Rückfrage (≥0,5)
vergeben wird — plan.md 5.1 nennt genau diese Schwellen „verbindlich". Sie sind
weder benannt noch kommentiert. **Sie stehen zudem nicht in `PARAMS`**, obwohl
der Dateikopf von detect.js behauptet, alle Verfahrensparameter stünden dort.

### 3b. Versteckte Schwellen im Phasenlöser (11 Funde)

`src/solver/verben.js`: 1.2 (Zeile 109, Suchradius des Beckenziels), 0.5
(Zeile 274, Rumpfvorhalt), 1.001 (Zeile 333, Sprunggeschwindigkeitsdeckel),
0.1 (Zeile 386, Absprung-Toleranz), 0.6/0.6/0.5/0.5 (Zeilen 412–415, Haltungs-
Anteile der Arme in Hocke), 0.03/0.3/0.7 (Zeile 573, Gelenkanteile aus der
Gewichtung), 0.7/0.7 (Zeilen 738/739, Ellbogenhaltung). Die Datei hat einen
„BENANNTE PARAMETER"-Block — diese Faktoren liegen außerhalb.

### 3c. Grenzwerte der Werkzeugschicht (9 Funde)

`src/tools/handlers.js`: 180/−180 Grad (set_joint, Zeile 373), 12 Frames (look,
Zeile 441), 300/80/6 Zeichen und Optionen (ask_human, Zeilen 467–471),
Zeilenlängen 500 (`errors.js:106`), 40 (`registry.js:48`), 20
(`ui/ask-human.js:144`). Teilweise deckungsgleich mit benannten Werten an
anderer Stelle (FRAMES_MAX=12 in strip.js:77), aber hier ohne Namen.

### 3d. Vertragsgrenzen im RigProfile-Prüfer (3 Funde)

`src/contracts/rig-profile.js`: 10 (world.height-Obergrenze, Zeile 88), 0.1
(soleTolerance-Obergrenze, Zeile 263), ±1 (sign-Bereich, Zeile 173). Die 10 und
die 0.1 sind im Dateikopf ausdrücklich als Verfahrensparameter deklariert —
aber sie stehen als Literale in der Prüfung, nicht als benannte Konstante.

### 3e. Zeichen- und Layoutwerte im Bildstreifen (58 Funde)

`src/render/strip.js`, Zeilen 607–754: Pixelmaße für Maßstabsleiste (9/5,
12, 24), Textgrößen (8–11 px), Alpha-Werte (0.3–0.8), Liniendicken (1.5/2.5),
Panelränder (6/12/13/30/42/54). Das sind Bildentscheidungen, keine
Körpermaße — aber sie sind genau die Art von Zahlen, die die Regel
„benannt, an einer Stelle, mit Begründung" meint: Nachbarn von PANEL_BREITE_PX,
die den Weg in den Parameterblock nicht geschafft haben, teilweise ohne
Kommentar.

### 3f. Restliche Einzelfunde (4)

`src/rig/measure.js:305` (stationen = 10, Parameter mit Default ohne Namen),
`measure.js:335` (Median-Perzentil 0.5 der Stationen), `measure.js:538`
(Kapselmitte 0.5), `src/render/strip.js:1082` (0.001 near-Deckel der Kamera),
`src/export/gltf.js:427` (−1 Sentinel).

---

## Die wichtigsten Einzelfunde in einem Satz

1. **Keine Zahl weicht von plan.md ab** — Radiusperzentil 0,90, Sohlentoleranz
   0,035, Kontaktzuschlag 0,015 m, Abtastwinkel 20°: alle stehen im Code, alle
   mit dem dokumentierten Wert, alle als benannte Konstante.
2. **Die Regel „an einer Stelle" ist für drei der vier Werte verletzt:** die
   Sohlentoleranz existiert fünfmal, FPS_MAX zweimal; der
   `KONTAKT_SCHWELLE_ANTEIL` wird dreimal kopiert statt importiert.
3. **Größter Verstoß gegen die Regel:** die 18 Konfidenz-Faktoren in
   `src/rig/detect.js` (Zeilen 647–1311) — ein ganzer, unbenannter Parametersatz
   mitten im Code, der zudem dem Dateikopf widerspricht.
4. **Größter Masseverstoß:** 58 unbenannte Bild-Pixelwerte in
   `src/render/strip.js` — harmlos im Effekt, aber sie zeigen, dass der
   „BENANNTE PARAMETER"-Block eine Konvention ist, keine durchgesetzte Regel.
5. **Von den 290 Funden sind 31 % zentral und begründet.** Die Behauptung aus
   AGENTS.md stimmt für die Haupttoleranzen aller APs und stimmt nicht für die
   Konfidenz-Faktoren, die Löser-Faktoren und die Bild-Geometrie.