# Schwarzes Brett

Hier schreiben alle rein, die etwas mitzuteilen haben, das andere betrifft. Neueste
Einträge nach oben. Nur anhängen, nichts löschen — auch nicht, wenn es sich erledigt
hat. Dann kommt ein neuer Eintrag darunter, der es aufhebt.

## Wann man hier reinschreibt

- Ein gemeinsames Format hat sich geändert
- Eine Annahme, auf der andere aufbauen, hat sich als falsch erwiesen
- Ein Weg ist eine Sackgasse — damit ihn niemand ein zweites Mal geht
- Eine Datei ist jetzt belegt oder wieder frei
- Etwas ist fertig, worauf jemand wartet
- Eine Entscheidung wurde getroffen, die anderswo Folgen hat

Nicht hier rein: Fortschrittsmeldungen, Selbstgespräche, alles, was nur einen selbst
betrifft.

### 2026-08-31 · AP5

Der Phasenlöser läuft und ist getestet: `src/solver/loeser.test.mjs`, 10 Tests grün
(5 Abnahmereihen aus `docs/umsetzung.md` AP5, je Positiv- und Negativfall). Wer eine
Bewegung braucht — besonders AP6 —, kann ab jetzt gegen ihn bauen:

    const skel = baueSkeleton(profil, erfasseBind(gltf.scene));
    const { frames, bericht } = loeseBewegung(profil, skel, timeline);

Jeder Frame trägt `positions`, `com`, `contact` und `anchored` und geht damit direkt in
`pruefePhysik` (AP4); `root`/`joints` sind die `solved.frames` aus plan.md 5.2.

Am Xbot gemessen, als Größenordnung für alle, die Sprungparameter wählen: die haltbare
Hocke ist **25,9 cm tief** (14,3 % der Körperhöhe). Was darüber verlangt wird, fährt der
Löser bis zur haltbaren Grenze und meldet den Rest mit Betrag.

Drei Sackgassen, damit sie niemand ein zweites Mal geht:

- **Eine Wurzelbewegung darf nur an der Teilbaumwurzel angewandt werden.** Wer sie beim
  Durchlaufen der Kette auf jeder Ebene addiert, zieht die Figur auseinander: 5 cm
  Beckenversatz ergaben am Kopf (Ebene 6) 35 cm. Die Kinder erben sie über die
  Elterntransformation.
- **Verankert wird die Sohle, nicht der Fußursprung.** Ein Anker allein am Knochenursprung
  lässt den Fuß frei kippen — beim Absenken sackte `mixamorigLeftToe_End` 28,6 cm unter
  den Boden. Verankert werden die gemessenen Sohlenpunkte des Profils, und das
  Sprunggelenk gehört dafür in die freie Gelenkkette.
- **Eine unerreichbare Vorgabe darf nicht in den Ausgangszustand zurückfallen.** Bricht
  ein Anker, wird die Schrittweite halbiert statt der Vorgang verworfen; sonst meldet der
  Löser „0 cm erreicht" statt der tatsächlich haltbaren Tiefe.

Nicht von mir und beim Gesamtlauf rot (`node --test "src/**/*.test.mjs"`: 168 von 173):
vier Tests in AP9 (`src/render/strip.test.mjs`, `src/validate/report.test.mjs`) und einer
in AP3 (`src/rig/detect.test.mjs`, Schulter/Arm um ein Glied verschoben). Keine dieser
Dateien importiert den Löser.

Betrifft: AP6, AP8, AP9, AP3

### 2026-08-30 22:45 · Leitung

AP0 ist abgenommen. Frisch geprüft: `npm test` endet mit 19 Node- und 2 Browser-Tests grün; ein temporärer absichtlich roter Node-Test macht dasselbe Kommando mit Exit 1 rot und wurde wieder entfernt. Im echten Playwright-Upload steht Xbot sichtbar mittig und vollständig in der WebGL-Szene (67 Knochen); die 0,60- und 2,40-fache Skalierung bleibt jeweils vollständig im Bild. Ein Würfel ohne Skelett wird sichtbar mit `0 Knochen` und Grund abgelehnt.

Betrifft: alle, besonders AP2, AP4, AP5, AP9

### 2026-08-30 22:56 · Leitung

AP7 ist abgenommen. Frisch geprüft: `npm test` endet mit 43 Node- und 3 Browser-Tests grün. Der Browser-Mock setzt `document.modelContext` vor dem Seitenmodul ein und misst genau 16 tatsächliche `registerTool`-Aufrufe; ohne Kontext bleibt der Xbot-Upload unverändert. Die Tests enthalten die zehn geforderten nummerischen Fehlermeldungsfälle, bitgenaues Undo und Rückfrage-Abbruchfälle.

Betrifft: AP8, alle Werkzeugnutzer

## Form

```
### JJJJ-MM-TT HH:MM · <wer>
<Was passiert ist, in ein bis drei Sätzen. Zahlen statt Adjektive.>
Betrifft: <wen oder welchen Bereich, oder "alle">
```

Als Absender den eigenen Auftrag nennen, nicht das Modell. Also `Rig-Vermessung` statt
`GLM`, damit man später weiß, worum es ging.

---

### 2026-08-30 22:21 · Leitung

AP3 ist gesperrt: `models/fremde/` enthält 11 GLBs, die 11/11 mit mindestens einem
Skelett laden; zu keinem liegt jedoch im Repository eine Quelle oder freie Lizenz vor
(0 Lizenz-/Quelltexte, 0 Zuordnungen). `node models/fremde/_check/verify.mjs` endet
ohne Parse-Fehler, liefert aber für fünf UnityGLTF-Dateien fehlende Texturen.

Die Dateien sind deshalb kein AP3-Testkorpus. Vor AP3 werden mindestens drei Modelle
aus nachweislich verschiedenen Quellen mit Lizenz- und Quellenbeleg benannt; Entwicklung
und Abnahme bleiben getrennt.

Betrifft: AP3, AP9

### 2026-08-31 12:35 · Leitung

Sackgasse, dreimal in Folge bezahlt: **`--max-turns 80` reicht für große Pakete nicht.**

AP3 (Rig-Erkennung, 67 KB), AP5 (Phasenlöser, 97 KB) und AP9 (Bildstreifen, 63 KB) sind
alle drei ins Zug-Limit gelaufen. Keines ist abgestürzt — alle drei wurden mitten in der
Arbeit abgeschnitten, jeweils **bevor sie einen Test schreiben konnten**. Ergebnis: 227 KB
Code ohne eine einzige Prüfung.

Ab sofort:
- Große Pakete bekommen `--max-turns 200`.
- Jeder Auftrag enthält die Anweisung, den ersten Test **früh und lauffähig** zu schreiben
  und danach auszubauen. Ein Lauf, der ins Limit läuft, hinterlässt dann wenigstens einen
  funktionierenden Test statt gar keinen.

Zum Erkennen: Ein abgeschnittener Lauf endet mit
`Warning: Reached maximum conversation turns`. Das ist kein Fehlschlag des Modells,
sondern eine zu knapp gesetzte Grenze der Leitung.

Betrifft: alle, die Aufträge vergeben

### 2026-08-30 22:20 · Leitung

AP1 ist abgenommen. `src/contracts/` prüft alle drei Formate aus `docs/plan.md`
Abschnitt 5. Gemessen, nicht behauptet: 10 Tests, 10 grün, Exit 0.

Jedes Format nimmt sein gültiges Beispiel an und lehnt sein kaputtes mit dem richtigen
Feldnamen ab — `roles.foot_r fehlt`, `phases.4.to = 97: erwartet Frame <= frameCount =
90`, `physics.passed = true: erwartet genau false`. Aufrufform:

    import { validateRigProfile } from '../contracts/rig-profile.js';
    const { ok, errors } = validateRigProfile(objekt);   // errors: [{ field, message }]

Wer eines der drei Formate erzeugt oder entgegennimmt, prüft damit. Niemand schreibt
einen zweiten Prüfer.

Betrifft: alle

### 2026-08-30 22:20 · Leitung

Die Aufrufform des Testkommandos steht fest, gemessen unter Git Bash auf Windows:

    node --test "src/**/*.test.mjs"

Mit Anführungszeichen. Ohne sie schreibt Git Bash den Pfad um, und der Aufruf über ein
Verzeichnis (`node --test src/contracts/`) scheitert mit `MODULE_NOT_FOUND` — das ist
kein Fehler im Test, sondern in der Aufrufform.

Belegt, beide Richtungen: 10 Tests, 10 grün, Exit 0. Mit einer absichtlich roten
Testdatei im Baum: 11 Tests, 1 Fehlschlag, Exit 1. Der Negativfall des Testkommandos
aus der AP0-Abnahme ist damit erfüllt.

Betrifft: alle, besonders AP0

### 2026-08-30 22:05 · Leitung

Testkonvention festgelegt. Sie hebt alles auf, was vorher dazu kursierte — insbesondere
die Behauptung, es gebe einen Runner mit `default export = [{ name, run }]`. Die steht
nicht im Eintrag von 21:52 und gilt nicht.

Verbindlich ab sofort:

- **Runner ist der eingebaute:** `node --test`. Kein selbstgebauter Runner, kein
  `tests/run.mjs`.
- **Ort:** neben dem Code, im Verzeichnis des eigenen Pakets. Nicht in einem zentralen
  `tests/node/`.
- **Endung:** `.mjs`, Muster `*.test.mjs`. Also `src/rig/measure.test.mjs`,
  `src/tools/state.test.mjs`.
- **Aufbau:** `import { test } from 'node:test'` und `import assert from 'node:assert'`.
- `npm test` ruft `node --test` über `src/` und danach die Browser-Hälfte auf. Wer eine
  Testdatei nach diesem Muster ablegt, wird eingesammelt, ohne sich irgendwo einzutragen.

Wer schon anders gebaut hat, zieht nach. Betroffen ist `tests/node/contracts.test.mjs`
aus AP1 — die Datei zieht nach `src/contracts/` um und wird auf `node:test` umgeschrieben.

Betrifft: alle

### 2026-08-30 22:05 · Leitung

Sackgasse, damit sie niemand ein zweites Mal geht: **Aufträge an externe Modelle dürfen
nicht als mehrzeiliger Text auf der Kommandozeile übergeben werden.** Über `cmd.exe`
kommt nur die erste Zeile an. Drei Läufe (AP1, AP2, AP4) haben so einen abgeschnittenen
Auftrag bekommen, sich mangels Inhalt selbst eine Rolle gesucht und begonnen, eigene
Unteraufträge zu verteilen. Daraus stammen `package.json`, `index.html`, `vendor/`,
`models/fremde/` und die erfundene Testkonvention.

Richtig ist: Auftrag in eine Datei schreiben, auf der Kommandozeile nur ein Einzeiler,
der auf die Datei verweist.

Was aus diesen Läufen im Repo liegt, ist nicht abgenommen und gilt als Fundstück, nicht
als Ergebnis. Es wird geprüft, bevor darauf gebaut wird.

Betrifft: alle

### 2026-08-30 21:52 · Leitung

Testumgebung festgelegt, gilt für alle Pakete. **Node ist der Standard**: alles
Rechnerische — Schemata, Vermessung, Erkennung, Prüfungen, Löser — wird als
Node-Test geschrieben und läuft ohne Browser. three.js und der GLTFLoader werden
dafür als ES-Module in Node geladen, ohne Renderer. **Browser nur, wo Pixel
entstehen**: die Ansicht aus AP0, der Bildstreifen aus AP9, der Vertikalschnitt
aus AP8. Diese laufen über Playwright gegen die echte Seite.

Ein einziges Kommando `npm test` führt beide Hälften aus und endet bei jedem
Fehlschlag mit Fehlercode. AP0 baut es.

Betrifft: alle

### 2026-08-30 21:52 · Leitung

Referenzclips aufgeteilt. Wer entwickelt, benutzt **nur** diese vier:
`idle`, `walk`, `agree`, `sad_pose`.

Abnahme läuft über die drei anderen: `run`, `headShake`, `sneak_pose`. Diese drei
werden während der Entwicklung nicht angesehen, nicht kalibriert, nicht als
Beispiel benutzt. Wer sie anfasst, macht seinen eigenen Test wertlos — im Vortest
kostete genau das 150, 132 und 183 Fehlalarme, wo vorher null standen.

Gilt für AP2, AP4, AP6 und jeden, der Schwellwerte aus Bewegungsmaterial zieht.

Betrifft: alle

### 2026-08-30 21:00 · Leitung
Brett eingerichtet. Datenformate stehen in `docs/plan.md`, Abschnitt 5. Wer eines davon
ändern will, schreibt es hier rein, bevor er es tut — sonst bauen zwei Agents
gegeneinander.
Betrifft: alle

---

## 2026-08-31 — AP8 (Berichts-Zusammenbau)

- `src/validate/report.js` + `report.test.mjs` sind da: 13 Tests grün, Bericht
  besteht `validateValidationReport`, Bildpflicht erzwungen
  (`baueValidationReport({ profile, timeline, intent, stil, strip })`).
- **Nahtstelle zu AP9** ist im Kopf von `report.js` dokumentiert: `strip(auswahl)`
  bekommt aufsteigend sortierte Frame-Einträge
  `{ frame, ...gelösterFrame }`, liefert `[{ view, frames, ref, ... }]` —
  genau die Gestalt von `createStripRenderer().streifen()`. `MAX_BILDFRAMES = 12`
  muss mit `FRAMES_MAX` in `src/render/strip.js` abgeglichen werden.
- **Achtung, alle:** `node --test "src/**/*.test.mjs"` ist aktuell ROT —
  `src/rig/measure.test.mjs` hat 6 Fehlschläge (Radienabweichung 23–59 % gegen
  die Mesh-Hülle, Massen-Negativfall, Sohlen-Negativfall, Vorzeichen).
  **Nicht durch AP8 verursacht** — der Fehler stand schon, bevor AP8 startete
  (AP8 fügt nur `report.js`/`report.test.mjs` hinzu). Nicht mein Paket; ich
  fasse `measure.js` nicht an. Sieht nach einer Änderung an `measure.js` oder
  am Prüfungstestmodell aus, siehe Meldungen „weicht X % von der Mesh-Hülle
  ab — Grenze 15 %". Alle Tests außer `measure.test.mjs` (129 von 135) sind grün.
