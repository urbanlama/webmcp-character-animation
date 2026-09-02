# Design: Agentengesteuerte Charakteranimation im Browser

Beitrag zur OpenAI WebMCP Challenge. Abgabe: 3. September 2026, 13:00 PT.

Hier stehen die technischen Festlegungen: was gemessen wurde, welche Datenformate
gelten, wie die Teile zusammenspielen. Wie gearbeitet und geprüft wird, steht in
`AGENTS.md`.

---

## 1. Bewertungskriterien der Challenge

Vier Kriterien, gleich gewichtet (Quelle: `docs/challenge.md`):

1. **WebMCP Leverage** — echte, nicht triviale Nutzung von WebMCP
2. **Execution** — vollständiges, stimmiges Produkt, kein Proof of Concept
3. **Potential Impact** — echtes Problem, echte Zielgruppe
4. **Creativity & Ambition**

Für die Architektur folgt daraus: Messschicht, Löser und Retargeting wären in einem
klassischen MCP-Server identisch. Was **nur** WebMCP kann, ist die gemeinsame sichtbare
Situation — Mensch, Agent, Modell und Diagnose in derselben laufenden Seite. Die
Mensch-Schleife ist deshalb kein Zusatz, sondern das Kernstück.

---

## 2. Was gebaut wird

Eine Webseite, in die man ein geriggtes Humanoid-Modell lädt. Die Seite vermisst das
Skelett selbst und stellt einem Agenten Werkzeuge bereit, mit denen er Bewegung als
Abfolge von Phasen erzeugt. Nach jedem Schritt bekommt der Agent Messwerte **und** ein
Bild. Wo Zahlen nicht ausreichen, fragt er den Menschen — mit einem Klick beantwortbar.
Ergebnis ist ein abspielbarer und als glTF exportierbarer Clip.

---

## 3. Was gemessen wurde

### 3.1 WebMCP-Grenzen (Chrome 151)

| Frage | Ergebnis |
|---|---|
| Werkzeuge zur Laufzeit nachregistrieren | funktioniert, 5 → 45, alle aufrufbar |
| Antwortgröße | 512 KB in 5 ms, vollständig |
| 50 Aufrufe am Stück | 16 ms, fehlerfrei |
| Werkzeug wartet auf Klick des Menschen | funktioniert, Antwort im selben Aufruf |

`await document.modelContext.registerTool({name, description, inputSchema, execute})`,
`execute` liefert `{content:[{type:'text',text}]}`. Zusätzlich `getTools()` und
`executeTool(tool, argsAlsJsonString)` — die Seite kann ihre eigenen Werkzeuge aufrufen,
was Regressionsläufe ohne Agent ermöglicht.

**Diese Messung sagt nichts über Agentenverhalten.** Sie misst Transport im Browser,
nicht ob ein Agent 45 Werkzeuge überblickt, wie viele Aufrufe er freiwillig macht oder
wie viel Text sein Kontext verkraftet.

### 3.2 Rohe Keyframes plus Messfeedback reichen nicht

Aufbau: festes Mixamo-Rig, Keyframe-Werkzeuge auf Gelenkebene, vier Validatoren,
Bildausgabe auf Anforderung. Agent: Fable 5, hohe Reasoning-Stufe, kein Zugriff auf den
Quellcode. Auftrag: Rückwärtssalto aus dem Stand.

Ergebnis nach zwanzig Minuten: eine Drehung ohne Absprung. Ein Drittel der Zeitachse
bewegungslos, kaum Flughöhe, harte Übergänge, keine Vorbereitung, keine Landung. Der
Agent hat in dieser Zeit **kein einziges Bild** gerendert.

Drei Schlüsse:

1. Messfeedback ist notwendig, aber nicht hinreichend.
2. Gelenkwinkel sind die falsche Aktionsebene.
3. Fehlerfreiheit ist kein Erfolg — wo nichts passiert, ist auch nichts falsch.

### 3.3 Gemessene Geometrie schlägt geschätzte

Geschätzte Kapselradien, Massen und Fußkontaktpunkte erzeugten 269 Fehlalarme auf einem
Clip, in dem eine Figur ruhig dasteht.

Nach Umstellung auf Messung — Radien aus Vertexabständen zur Segmentachse, Massen aus
Kapselvolumen, Sohlen aus Bodennähe in Bind-Pose, Kontaktschwelle aus der Sohlenhöhe —
verschwanden **Bodendurchdringung und Balancefehler vollständig**, und zwar auch ohne
jede weitere Kalibrierung.

### 3.4 Kapseln taugen nicht für Selbstdurchdringung

Der Hold-out-Test:

| Prüfung | kalibriert auf alle 5 | nur auf walk+run | gar nicht kalibriert |
|---|---|---|---|
| idle | 0 | 150 | 150 |
| agree | 0 | 132 | 132 |
| headShake | 0 | 183 | 183 |

Alle verbleibenden Meldungen sind Selbstdurchdringungen. Zwei Erkenntnisse:

**Das Lernen aus Referenzbewegung überträgt nicht.** Spalte 2 und 3 sind identisch — was
aus `walk` gelernt wurde, hilft `idle` nicht.

**Zylinder um Knochen sind zu grob.** Eine stehende Figur hat die Hand am Oberschenkel
und den Arm am Rumpf. Das überlappt dauerhaft, unabhängig davon, wie gut die Radien
gemessen sind.

Konsequenz für die Architektur: Selbstdurchdringung wird nicht über gelernte
Paarabstände geprüft, sondern über **Bind-Pose-Ruheabstände** — wie nah sind sich zwei
Segmente, wenn die Figur entspannt steht? Das ist eine Messung am Modell und setzt keine
mitgelieferten Clips voraus.

### 3.5 Gelenkachsen lassen sich messen

Automatisches Abtasten (+20° anwenden, Wirkung am Kettenende messen) fand drei Fehler:
fehlende Links-Rechts-Spiegelung, rückwärts wirkende Hüftbeugung, wirkungslose
Beckendrehung. Alle drei wurden korrigiert, das Verfahren ist übertragbar.

**Grenze des Verfahrens:** Drehungen um die eigene Kettenachse (Twist) erzeugen keine
Bewegung am Kettenende und sind so nicht messbar. Für sie braucht es einen seitlich
versetzten Messpunkt.

---

## 4. Grundregeln

**Körpermaße werden gemessen, Verfahrensparameter werden benannt.**

Verfahrensparameter wie Perzentile und Toleranzen sind unvermeidlich. Sie dürfen nur
nicht unsichtbar sein.

Alle Verfahrensparameter stehen an einer Stelle im Code, mit Begründung, und
werden im Rig-Bericht ausgegeben. Wer einen davon ändert, muss die Abnahmetests erneut
bestehen.

| Parameter | Wert | Begründung |
|---|---|---|
| Radiusperzentil | 0,90 | 0,80 unterschätzt die Körperbreite, 1,00 fängt Ausreißer |
| Sohlentoleranz | 3,5 % Körperhöhe | muss Modelle erfassen, die auf dem Ballen stehen |
| Kontaktzuschlag | 1,5 cm | Spielraum über dem höchsten Sohlenpunkt |
| Abtastwinkel | 20° | groß genug für messbare Wirkung, klein genug ohne Überschlag |

**Alle Toleranzen sind relativ zur Körperhöhe.** Eine Landetoleranz von 50 cm bedeutet
für eine 60 cm große Figur etwas anderes als für eine 2,40 m große. Absolute
Zentimeterwerte in Schwellen sind ein Fehler.

**Werkzeugbeschreibungen und Fehlermeldungen sind Produktoberfläche.** Nicht „ungültige
Eingabe", sondern „Frame 34 liegt außerhalb der Timeline von 0 bis 60".

---

## 5. Datenverträge

Ohne diese Verträge kann niemand parallel arbeiten. Sie werden zuerst geschrieben, in
einer Datei, und danach nur mit Absprache geändert. Zu jedem Vertrag gehören Beispiel-
dateien: ein gültiger Fall und ein absichtlich kaputter.

### 5.1 RigProfile

```jsonc
{
  "schemaVersion": 1,
  "source": { "file": "charakter.glb", "boneCount": 67, "vertexCount": 12473 },
  "world": {
    "up": "y", "forward": "z", "left": "x",
    "groundY": 0.0,
    "height": 1.5968,              // Meter, Bind-Pose
    "unitsPerMeter": 1.0
  },
  "bones": [
    { "id": "mixamorigHips", "parent": null, "bindWorld": [0,1.04,0] }
  ],
  "roles": {
    // semantische Rolle -> Knochen, mit Konfidenz 0..1
    "pelvis":   { "bone": "mixamorigHips",     "confidence": 1.0 },
    "foot_l":   { "bone": "mixamorigLeftFoot", "confidence": 0.94 },
    "tail":     { "bone": "bone_058",          "confidence": 0.0, "note": "unbekannte Kette" }
  },
  "joints": {
    "hip_l": {
      "bone": "mixamorigLeftUpLeg",
      "dof": { "flex": { "axis": "x", "sign": -1, "limit": [-30, 130] } },
      "signSource": "gemessen",     // gemessen | nicht_messbar
      "limitSource": "anatomisch"   // anatomisch | gemessen
    }
  },
  "segments": [
    { "id": "thigh_l", "from": "...UpLeg", "to": "...Leg",
      "radius": 0.0858, "mass": 0.1372, "volume": 0.0121 }
  ],
  "soles": [
    { "id": "sole_l_front_out", "bone": "...LeftFoot", "local": [0.03,-0.05,0.11] }
  ],
  "restDistances": {
    // Bind-Pose-Ruheabstand je Segmentpaar, Grundlage der Durchdringungsprüfung
    "hand_l|thigh_l": 0.012
  },
  "params": { "radiusPercentile": 0.90, "soleTolerance": 0.035, "contactMargin": 0.015 },
  "warnings": ["kopf: Kette endet in 3 Verzweigungen, Zuordnung unsicher"]
}
```

Pflichtfelder: `world`, `roles.pelvis`, `roles.foot_l`, `roles.foot_r`, `joints`,
`segments`, `soles`. Fehlt eines davon, wird das Modell abgelehnt statt geraten.

**Konfidenz-Schwellen:** ab 0,9 gilt eine Zuordnung als sicher; zwischen 0,5 und 0,9
wird der Mensch gefragt; darunter gilt sie als unbekannt und die Kette bleibt ohne
semantische Rolle nutzbar.

### 5.2 Timeline

```jsonc
{
  "schemaVersion": 1,
  "fps": 30,
  "frameCount": 90,
  "rotationFormat": "quaternion",   // intern immer Quaternion
  "phases": [
    { "id": "p1", "verb": "crouch", "from": 0,  "to": 12, "params": { "depth": 0.35 } },
    { "id": "p2", "verb": "takeoff","from": 12, "to": 18, "params": { "vy": 4.2, "spinX": -360 } }
  ],
  "overrides": {
    // vom Agenten auf Ebene 2 oder 3 gesetzte Werte, überschreiben den Phasenlöser
    "24": { "joints": { "head": { "bend": 12 } } }
  },
  "solved": {
    // Ergebnis des Lösers, wird bei jeder Änderung neu berechnet
    "frames": [ { "root": {"pos":[0,0,0],"quat":[0,0,0,1]}, "joints": { "hip_l": [0,0,0,1] } } ]
  }
}
```

**Quelle der Wahrheit sind `phases` und `overrides`.** `solved` ist abgeleitet und darf
jederzeit verworfen werden. Damit ist eindeutig, was beim Neuberechnen überschrieben
wird.

**Rotationen intern immer als Quaternion.** Eingaben in Grad werden beim Eintritt
umgerechnet. Eine 360°-Drehung wird als Achse-plus-Winkel über die Phasendauer
interpoliert, nicht als Quaternion-Slerp — sonst wird aus einer vollen Umdrehung eine
Nullbewegung.

**Phasen dürfen sich zeitlich überlappen**, aber nur, wenn sie disjunkte Körperteile
betreffen. Überlappen sie auf demselben Körperteil, gewinnt die spätere und es wird
gewarnt.

**Jede Änderung ist atomar und rücknehmbar.** Vor jeder Änderung wird ein Schnappschuss
der `phases` und `overrides` abgelegt. `undo` stellt ihn wieder her. Ohne das kann ein
misslungener Werkzeugaufruf den Clip unrettbar beschädigen.

### 5.3 ValidationReport

```jsonc
{
  "frameCount": 90,
  "phases": [ { "state": "kontakt", "from": 0, "to": 18 }, { "state": "flug", "from": 19, "to": 44 } ],
  "physics":  { "passed": false, "issues": [
    { "kind":"boden","frame":34,"value":0.048,"unit":"m","part":"foot_r",
      "message":"foot_r steckt 4,8 cm im Boden","fix":"Wurzel anheben oder Bein strecken" } ] },
  "intent":   { "passed": true,  "checks": [
    { "name":"drehung","required":">=350","measured":358.2,"unit":"grad","passed":true } ] },
  "style":    { "passed": false, "issues": [
    { "kind":"bewegungsdichte","value":0.31,"threshold":0.60,
      "message":"nur 31 % der Frames enthalten Bewegung, erwartet mindestens 60 %" } ] },
  "images":   [ { "view":"side","frames":[0,12,24,36,48],"ref":"strip_side_0-12-24-36-48.png" } ]
}
```

Jeder Bericht enthält **immer** einen Bildverweis. Zahlen ohne Bild werden nicht
ausgeliefert.

### 5.4 Werkzeugkatalog

Feste Liste, sechzehn Werkzeuge. Kein Werkzeug pro Knochen.

| Werkzeug | Zweck |
|---|---|
| `describe_world` | Weltvertrag: oben, vorne, links, Boden, Maßstab, Figurgröße |
| `describe_rig` | Rollen, Gelenke, Freiheitsgrade, Grenzwerte, Unsicherheiten |
| `describe_body` | gemessenes Profil: Radien, Massen, Sohlen, Ruheabstände |
| `probe_joint` | ein Gelenk testweise beugen, Vorher/Nachher als Bild |
| `confirm_role` | unsichere Zuordnung bestätigen oder korrigieren |
| `set_intent` | Erfolgskriterien der Bewegung festlegen (siehe 7.2) |
| `set_duration` | Länge der Animation |
| `add_phase` | Bewegungsphase anlegen (siehe 6.3) |
| `edit_phase` | Phase ändern oder entfernen |
| `set_target` | Ebene 2: Endeffektor- oder Schwerpunktziel für einen Frame |
| `set_joint` | Ebene 3: einzelne Gelenkwinkel für einen Frame |
| `undo` | letzte Änderung zurücknehmen |
| `validate` | vollständiger Bericht plus Bildstreifen |
| `look` | Bildstreifen aus gewählten Frames und Ansichten |
| `ask_human` | Frage mit Antwortmöglichkeiten, wartet auf Klick |
| `export_clip` | glTF mit Wurzelbewegung |

Jede Werkzeugbeschreibung nennt das Bezugssystem, in dem sie arbeitet, und die
Einheiten ihrer Parameter.

### 5.5 Werkzeugbeschreibungen

Der vollständige Text jeder Werkzeugbeschreibung. Bezugssystem überall dasselbe und in
`describe_world` benannt: **oben = +Y, Charakter-vorne = +Z (gemessen, siehe AP2),
links = +X**. Positionen in Metern in Weltkoordinaten, Winkel in Grad, Dauern in
Sekunden, Frames ganzzahlig, Anteile relativ zur Körperhöhe siehe jeweilige Angabe.
Bühne-vorne und Charakter-vorne sind zwei verschiedene Richtungen; wo Werkzeuge eine
Richtung nehmen, ist es die Charakter-Richtung, es sei denn, der Parametername enthält
`stage`.

1. `describe_world` — „Liefert den Weltvertrag: oben, vorne, links, Bodenhöhe, Maßstab
   und Figurgröße“. Parameter: keine.
2. `describe_rig` — „Liefert Rollen, Gelenke, Freiheitsgrade mit Achsen, Vorzeichen und
   Grenzwerten sowie alle Zuordnungen mit Konfidenz unter 1 und ihre Vermessungsquelle“.
   Parameter: keine.
3. `describe_body` — „Liefert das gemessene Körperprofil: Segmente mit Radius und Masse
   in Metern und Kilogramm, Sohlenpunkte in Knochen-lokalen Metern, Ruheabstände in
   Metern und alle Verfahrensparameter mit Begründung“. Parameter: keine.
4. `probe_joint` — „Beugt ein Gelenk probeweise um einen Winkel in Grad und liefert
   Vorher/Nachher als Bild. Das Vorzeichen wirkt in dem in describe_rig genannten
   Bezugssystem des Gelenks“. Parameter: `{joint: string, angleDeg: number (-90..90)}`.
5. `confirm_role` — „Bestätigt oder korrigiert eine Zuordnung von Rolle zu Knochen;
   gilt nach Bestätigung als gemessen“. Parameter: `{role: string, bone: string}`.
6. `set_intent` — „Legt die Erfolgskriterien der Bewegung fest. Alle Längen in Anteilen
   der Körperhöhe, alle Winkel in Grad, alle Zeiten in Sekunden. Wird vor dem Bauen vom
   Menschen bestätigt“. Parameter: `{checks: [{kind, ...}, ...]}` je Baustein aus 7.2.
7. `set_duration` — „Setzt die Gesamtlänge der Animation in Frames bei der im Timeline-
   Vertrag genannten Framerate“. Parameter: `{frameCount: int (12..600)}`.
8. `add_phase` — „Legt eine Bewegungsphase an. Zeiten in Frames, Phase-Parameter in den
   Einheiten des Verbs (Tiefe in Anteilen der Körperhöhe, Geschwindigkeit in
   Körperhöhen pro Sekunde, Winkel in Grad). detail: siehe Verb-Tabelle 6.3“.
   Parameter: `{verb, from, to, params}`.
9. `edit_phase` — „Ändert oder entfernt eine bestehende Phase. dieselben Einheiten wie
   add_phase. Änderungen sind über undo rücknehmbar“. Parameter: `{id, from?, to?,
   params?, remove?}`.
10. `set_target` — „Setzt für einen einzelnen Frame ein Ziel für einen Endeffektor oder
    den Schwerpunkt, in Metern, Weltkoordinaten des Weltvertrags. Wird vom Löser
    angestrebt und kann ihm nicht gelingen; das steht dann im Bericht“. Parameter:
    `{frame: int, part: string, pos: [m,m,m]}`.
11. `set_joint` — „Setzt für einen einzelnen Frame einen Gelenkwinkel in Grad, Vorzeichen
    und Achse wie in describe_rig“. Parameter: `{frame: int, joint: string, angleDeg:
    number, channel: 'bend'|'twist'|'swing'}`.
12. `undo` — „Nimmt die letzte Änderung an Phasen oder Overrides zurück“. Parameter:
    keine.
13. `validate` — „Prüft die gesamte Timeline phasenabhängig und liefert den vollständigen
    Bericht mit einem Bildstreifen der kritischen Frames. alle Zahlen in den Einheiten
    des Weltvertrags (Meter, Grad, Sekunden)“. Parameter: keine.
14. `look` — „Erzeugt einen Bildstreifen aus gewählten Frames und benannten Ansichten im
    Charakter-Bezugssystem (front/side/quarter/top), immer annotiert. Frames ganzzahlig
    im Timeline-Bezug“. Parameter: `{frames: [int, ...], views: [string, ...]}`.
15. `ask_human` — „Stellt dem Menschen eine Frage mit Antwortmöglichkeiten und wartet auf
    einen Klick; die Antwort kommt im selben Aufruf zurück. Budget: siehe UI-Anzeige“.
    Parameter: `{question: string, options: [string, ...]}`.
16. `export_clip` — „Exportiert die Timeline als glTF mit Wurzelbewegung in Meter,
    Y-oben, Charakter-vorne +Z. Rotationen als Quaternionen“. Parameter: keine.

**Fehlermeldungen aller Werkzeuge** nennen Wert, erlaubten Bereich und nächsten Schritt,
z. B. „frame 640 liegt außerhalb der Timeline von 0 bis 599; setze frameCount zuerst
mit set_duration“.

### 5.6 A3-Attrappe

Für die Agentenlast-Prüfung (A3) genügt eine statische Seite, die nur den Katalog aus
5.5 über `document.modelContext.registerTool` registriert und jede Ausführung mit einer
token-echten Attrappen-Antwort beantwortet.

---

## 6. Architektur

### 6.1 Rig-Verständnis

Eingabe: glTF/GLB mit Skin und Bind-Pose. Ausgabe: RigProfile.

Was gemessen wird: Symmetrieebene, Mittelkette, Gliedmaßen, Endeffektoren, Finger,
Scharnierachsen, Körperhöhe, Bodenebene, Kapselradien, Massen, Sohlenpunkte,
Bind-Pose-Ruheabstände, Vorzeichen der Freiheitsgrade.

**Was nicht gemessen werden kann, wird ausdrücklich gekennzeichnet:**

- *Gelenkgrenzen.* **Teilweise messbar — seit dem 2. September 2026.** Aus der
  ruhenden Bind-Pose lässt sich keine Grenze ablesen; aus dem Modell, das man
  durchbiegt, schon. `measureJointLimits` dreht jeden Kanal aus der Bind-Pose heraus
  auf und sucht den ersten Schnitt zweier Hautdreiecke. Der letzte schnittfreie
  Winkel ist die Grenze (am Xbot: `knee.bend` 129° statt 150°, `arm.lift` 92° statt
  100°). Was keine Selbstberührung stoppt, findet das Verfahren nicht — die Schulter
  hält im echten Körper das Schulterblatt, `arm.swing` schwingt am Modell bis -150°
  frei. Dort bleibt der anatomische Standardwert stehen.

  Die Herkunft steht deshalb **pro Kanal und pro Richtung** in `dof.limitSource`
  (`{min, max}`), nicht pauschal je Gelenk: derselbe Kanal kann unten `anatomisch`
  und oben `gemessen` sein. Eine Herkunft je Gelenk verschwiege genau das, und der
  Agent wüsste nicht, welcher Grenze er trauen kann.
- *Twist-Vorzeichen.* Am Kettenende nicht messbar. Wird über einen seitlich versetzten
  Punkt am Knochen gemessen; gelingt auch das nicht, gilt `signSource: "nicht_messbar"`
  und das Vorzeichen bleibt 1.
- *Blickrichtung.* Drei geometrische Signale: Ferse-zu-Zeh, Kopfvorsprung gegenüber der
  Halsachse, Kniebeugerichtung. Stimmen sie nicht überein oder ist die Bind-Pose keine
  aufrechte Steh-Pose, **wird der Mensch gefragt**. Nicht geraten.

**Bind-Posen, die nicht aufrecht und symmetrisch sind** (A-Pose, sitzend, gedrehte
Wurzelknoten, negative Skalierung, mehrere Meshes) werden erkannt und führen zu einer
Rückfrage oder einer Ablehnung mit Begründung.

### 6.2 Weltvertrag

Ein Text, den `describe_world` liefert und auf den sich jede Werkzeugbeschreibung
bezieht: oben, Boden, Blickrichtung, links, Maßstab, Figurhöhe. Ausdrücklich getrennt:
Bühnen-vorne und Charakter-vorne.

### 6.3 Der Phasenlöser — das Herz

Wie aus Phasen tatsächlich Posen werden — die Stelle, an der ein Plan sonst „das System
erzeugt daraus Posen" sagt und aufhört:

**Phasen sind keine gespeicherten Posen. Phasen sind Parametersätze für einen
schwerpunktgetriebenen Löser.**

Eine Phase gibt an:

- Sollbahn des Schwerpunkts über die Phasendauer
- welche Kontaktpunkte bestehen und wo sie verankert sind
- Streckungsgrad der Stützkette
- Orientierung des Rumpfes
- gewünschter Drehimpuls, falls kontaktfrei

Der Löser erzeugt daraus Posen: inverse Kinematik für die verankerten Gliedmaßen,
Schwerpunktausgleich für den Rest, Gelenkgrenzen als harte Schranken.

Damit kommt das Können aus Physik und Geometrie, nicht aus einer Bewegungsbibliothek.
Ein Absprung ist nicht „diese zwölf Posen", sondern: Schwerpunkt sinkt um X, Füße
bleiben verankert, dann streckt sich die Beinkette, bis der Schwerpunkt die
Absprunggeschwindigkeit hat, dann löst der Kontakt.

**Das Phasenverb-Inventar ist eine feste, benannte Liste** — keine offene Sprache:

| Verb | Parameter |
|---|---|
| `stand` | Dauer, Gewichtsverteilung |
| `crouch` | Absenktiefe, Dauer |
| `swing_arms` | Richtung, Ausschlag, Dauer |
| `takeoff` | Absprunggeschwindigkeit, Drehimpuls um eine Achse |
| `airborne` | Einrollgrad über die Zeit |
| `land` | Aufsetzfuß oder beide, Abfedertiefe |
| `step` | Schrittweite, Richtung, welcher Fuß |
| `reach` | Körperteil, Zielpunkt, Dauer |
| `turn` | Winkel um die Hochachse, Dauer |
| `settle` | Nachschwingen, Dauer |

Zehn Verben. Damit lassen sich Salto, Sprung, Schritt, Schuss, Zeigen und Drehen
darstellen. Was sich damit nicht darstellen lässt, geht über Ebene 2 und 3 — und wird
als Lücke im Bericht benannt statt stillschweigend falsch gebaut.

**Was der Löser nicht liefert:** Ausdruck. Kopfhaltung, Blickführung, Charakter. Das
kommt vom Agenten über Ebene 2 und 3, oder über die Stilregeln aus 7.3.

### 6.4 Korrigieren, dann prüfen

Garantien und Validatoren nebeneinander wären ein Widerspruch: Was garantiert verhindert
wird, kann kein Validator je melden.

Auflösung: **Der Löser korrigiert. Der Validator prüft die Nachbedingung.** Ein Löser
kann scheitern — bei widersprüchlichen Bedingungen, bei unerreichbaren Zielen. Genau
dann meldet der Validator.

Klare Rangfolge bei Konflikten, von hart nach weich:

1. Gelenkgrenzen — werden nie verletzt
2. Bodenkontakt — kein Körperteil unter dem Boden
3. Fußanker — verankerte Füße bleiben stehen
4. Schwerpunktbahn — wird als Letztes geopfert

Wird eine weichere Bedingung zugunsten einer härteren aufgegeben, steht das im Bericht
mit Betrag: „Schwerpunktbahn um 6 cm verfehlt, weil sonst das Knie überstreckt würde."

**Bodenstand — die Wurzelhöhe hat einen Normalzustand, den Boden.** Belegt im Bühnenlauf
vom 2. September 2026: jede Beinpose verkürzte die Beinkette, die Wurzel blieb, die Figur
schwebte (Hocke 15,5 cm über dem Boden); der Agent riet die Höhe und steckte 11 cm im Boden;
für beides kam dieselbe Meldung, und weil „Flug" galt, fielen Balance und Rutschen still aus.

Seitdem: Ohne gesetzte Höhe stellt der Löser in jedem Frame den tiefsten Punkt der Figur
(Sohlen und Knochen mit Haut — am Xbot liegen die Zehenknochen unter den Sohlenpunkten) auf
die Bodenebene. `root.pos` mit einer Zahl in y hebt sie ausdrücklich an, `[x, null, z]`
bewegt sie am Boden. Zwischen einem Boden-Schlüsselbild und einer gesetzten Höhe läuft die
Höhenkurve (auch `wurf`: der Absprung braucht keine geratene Höhe), zwischen zwei
Boden-Schlüsselbildern wird je Frame abgesetzt. Rang 2 wird ZULETZT durchgesetzt: was nach
den Fußankern noch im Boden steckt, wird angehoben und als Konflikt mit Betrag gemeldet.

Ein Fußanker darf das Becken sinken lassen, wenn keine Höhe gesetzt ist (Schritt: 3,4 cm
am Xbot); verankert werden Fuß- und Zehenknochen, damit die Sohle flach bleibt. Das freie
Bein hält der Agent selbst über dem Boden — steckt es im Boden, geht Rang 2 vor Rang 3,
die Figur wird angehoben, und der Ankerkonflikt nennt genau diese Anhebung als Grund.
Versucht und verworfen: das freie Bein per IK vom Boden heben — ein gestrecktes Bein ist
eine Singularität, die Optimierung wich über `hip.spread` seitlich aus.

### 6.5 Drehimpuls

In der Flugphase folgt der Schwerpunkt einer Parabel. Die Drehung ist damit **nicht**
automatisch richtig: Zieht die Figur die Gliedmaßen an, sinkt das Trägheitsmoment und
sie dreht schneller. Der Löser rechnet das Trägheitsmoment pro Frame aus den
Segmentmassen und passt die Winkelgeschwindigkeit so an, dass der Drehimpuls konstant
bleibt.

Ohne diesen Schritt sieht ein Salto falsch aus, obwohl jede Einzelprüfung grün ist.

### 6.6 Die drei Prüfschichten

**Physik** — kennt keine Bewegungsart, gilt immer, phasenabhängig ausgewertet:
Bodendurchdringung, Selbstdurchdringung (über Bind-Pose-Ruheabstände), Gelenkgrenzen,
Fußrutschen bei Kontakt, Balance nur bei Bodenkontakt, ballistische Bahn nur im Flug.

**Absicht** — vom Agenten vor dem Bauen festgelegt, vom Menschen bestätigt. Bausteine:

| Baustein | Einheit |
|---|---|
| Drehung um eine Achse über einen Frame-Bereich | Grad |
| Flugphase | Sekunden, Scheitelhöhe relativ zur Körperhöhe |
| Ortsveränderung | Körperhöhen, Richtung |
| Kontaktwechsel | welcher Fuß, welcher Frame |
| Abstand zweier Körperteile | Anteil der Körperhöhe, Mindestdauer |
| Höhe eines Körperteils | Anteil der Körperhöhe |
| Tempo eines Körperteils | Körperhöhen pro Sekunde |

Alle Größen relativ zur Körperhöhe, damit sie für jedes Modell gelten.

**Stil** — bewegungsunabhängig:

- Bewegungsdichte: Anteil der Frames mit Veränderung über einer Schwelle
- Antizipation: Gegenbewegung vor der Hauptbewegung vorhanden
- Ruckfreiheit: keine Sprünge in der Beschleunigung

Ausnahmen sind erlaubt und müssen erklärt werden: Ein bewusster Halt oder ein Aufprall
darf die Ruckprüfung verletzen, wenn eine Phase ihn als solchen ausweist.

### 6.7 Der Mensch

Drei feste Momente, kein Notausgang:

1. **Nach dem Upload** — unsichere Rollen bestätigen. Der fragliche Knochen leuchtet,
   Antwort ist ja oder nein. Auch die Blickrichtung, wenn die Geometrie mehrdeutig ist.
2. **Vor dem Bauen** — die Absichtskriterien bestätigen. Fünf Sekunden statt zwanzig
   Minuten Fehlbau.
3. **Bei Geschmacksfragen** — zwei Varianten nebeneinander als Schleife, ein Klick.

Alle Fragen in Alltagssprache, alle mit Klick oder Regler beantwortbar. Budget: drei
Fragen pro Auftrag, einstellbar bis null.

### 6.8 Sehen

Zwei getrennte Blicke auf dieselbe Szene.

**Der Mensch** sieht die Figur von vorne, mittig, in ganzer Höhe, zugewandt. Kamerahöhe
und -abstand folgen der gemessenen Körpergröße, die Drehung der gemessenen
Vorwärtsachse. Eine Figur, die aus dem Bild ragt oder dem Betrachter den Rücken zukehrt,
ist ein Fehler, kein Geschmack.

**Der Agent** bekommt feste benannte Ansichten im Charakter-Bezugssystem, mehrere in
einem Bild, immer annotiert mit Achsenkreuz, Bodengitter mit Maßstab, Schwerpunkt,
Stützfläche und Kontaktpunkten. Diese dürfen technisch aussehen.

**An jedem Validierungsbericht hängt automatisch ein Bildstreifen der kritischen
Frames.** Der Agent bekommt das Bild, ohne danach zu fragen — die direkte Antwort auf
den gemessenen Befund, dass er von selbst nicht hinschaut.

Dass ein Agent Bilder in Werkzeugantworten überhaupt wahrnimmt, war die Annahme, auf der
diese Schicht steht. Sie ist geprüft: `spikes/test-a2-image/ERGEBNIS.md`.

### 6.9 Export

glTF mit Wurzelbewegung. Prüfung nicht mit dem eigenen Loader, sondern durch
unabhängiges Wiedereinlesen und Vergleich der Ereignisse und Gelenkverläufe.

---

## 7. Was nicht gebaut wird

- Vierbeiner und Fabelwesen. Sie werden erkannt und begründet abgelehnt.
- Text-to-Motion-Modelle im Browser. Geprüft: kimodo.cpp liefert das passende Format,
  hat aber keinen WASM-Build und einen Llama-großen Textencoder. Die Timeline kann
  Rohbewegung von außen aufnehmen, damit das später andockt.
- Ragdoll-Simulation. Ballistik wird gerechnet, nicht simuliert.
- Ebene 2 als eigene Agentenebene, solange kein Fall gezeigt ist, den Ebene 1 und 3
  nicht lösen. Inverse Kinematik bleibt zunächst Innenleben des Phasenlösers.
- Mehrere Figuren, Requisiten, Kleidung, Gesichtsanimation.
- Zwei Geschmacksvarianten zur Auswahl, bevor eine Variante zuverlässig funktioniert.

---

## 8. Risiken

**Der Phasenlöser erzeugt korrekte, aber leblose Bewegung.** Größtes verbleibendes
Risiko. Frühwarnung: AP5 mit Bildstreifen, nicht nur mit Zahlen. Gegenmittel:
Stilregeln, Antizipation als Pflichtparameter von `takeoff`, Nachschwingen in `settle`.

**Der Agent verliert bei sechzehn Werkzeugen die Übersicht.** Klärt A3.

**Die Rig-Erkennung fällt bei fremden Modellen um.** Klärt AP3 mit Hold-out-Modellen.

**Der Löser findet keine Lösung bei widersprüchlichen Bedingungen.** Auflösung über die
Rangfolge in 6.4, mit ausgewiesenem Betrag statt stillem Scheitern.

**Der Salto überzeugt am Ende nicht.** Rückfallposition: eine einfachere Bewegung wird
zur Demo — Sprung mit Landung, Schritt mit Richtungswechsel — und der Salto als offener
Punkt benannt.

---

## 9. Offene Punkte

- Verhalten eines echten Browser-Agenten bei sechzehn Werkzeugen (klärt A3)
- Ob Fußrutschen in Clips ohne Wurzelbewegung korrekt gemeldet wird oder ein Restfehler ist
- Beschaffung von mindestens drei Abnahmemodellen unter freier Lizenz
