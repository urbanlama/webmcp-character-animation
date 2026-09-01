# BEFUND — Rollenerkennung auf den zehn fremden Modellen

Auftrag: Rollen mit Konfidenz in der Rückfragezone (0,5–0,9) dürfen nicht mehr
zur Ablehnung führen — sie sind als „unsicher, Rückfrage nötig" zu markieren,
mit dem besten Kandidaten als Vorschlag. Unter 0,5 bleibt es bei der Ablehnung.

Messung: `node spikes/fremdmodelle/messung.mjs` (Kette laden → Rollen →
vermessen → Vertrag → lösen) und `node spikes/fremdmodelle/befund-erhebung.mjs`
(Konfidenzen je Pflichtrolle). Alle Zahlen von einem Lauf über alle elf GLBs in
`models/fremde/` (zehn Auftragsmodelle + RobotExpressive).

## 1. Ausgangslage: wo die Ablehnung wirklich saß

Die Voraussetzung des Auftrags („Pflichtrollen werden erst ab Konfidenz 0,9
akzeptiert, sieben Modelle werden deshalb abgelehnt") traf auf den
Arbeitsstand der Erkennung **nicht mehr** zu: `detectRig()` lässt alle neun
Humanoiden durch — die Fragezone war auf der Ebene der Rollen bereits offene
Rückfrage (`questions`), die Pflichtrollen-Prüfung zählt jede Zuordnung ab
0,5. Was die sieben Modelle stoppte, war Folgendes:

- **Kenney-Familie** (5 Modelle): Rollen alle erkannt (Füße 0,70–0,72,
  sicher-ungefragt-Markierung fehlte) — Scheitern **hinter** der Rollen-
  erkennung in der Vermessung: `0 von 14 Segmenten messbar bei 6 Knochen und
  14 erkannten Rollen`. Ursache: `thigh_l` und `foot_l` zeigen auf denselben
  Knochen (`leg-left`) — ein Ein-Knochen-Bein hat keine messbare Segmentachse.
- **BrainStem**: Rollen alle in der Fragezone (Pelvis/Foot 0,84) — Scheitern
  im **Vertrag**: `bones.N.id = ""` (leere Knochen-ids im Modell).
- **Michelle**: Rollen mit foot 0,58 in der Fragezone — Vermessung OK,
  Scheitern beim **Löser**: Bind-Matrix nicht einheitlich skaliert.

## 2. Befundtabelle — Pflichtrollen und ihre Konfidenz

Gemessen mit `befund-erhebung.mjs`. Zone: `sicher` ≥ 0,9 · `unsicher`
0,5–0,9 (Rückfragezone) · unter 0,5 keine Rolle.

| Modell | Pflichtrolle | Konfidenz | Zone | Bester Kandidat |
|---|---|---|---|---|
| BrainStem.glb | pelvis | 0,84 | unsicher | bone#0 |
| BrainStem.glb | foot_l | 0,84 | unsicher | bone#16 |
| BrainStem.glb | foot_r | 0,84 | unsicher | bone#12 |
| Michelle.glb | pelvis | 1,00 | sicher | mixamorigHips |
| Michelle.glb | foot_l | 0,58 | unsicher | mixamorigLeftFoot |
| Michelle.glb | foot_r | 0,58 | unsicher | mixamorigRightFoot |
| Kenney_Ooli.glb | pelvis | 0,98 | sicher | root |
| Kenney_Ooli.glb | foot_l | 0,72 | unsicher | leg-left |
| Kenney_Ooli.glb | foot_r | 0,72 | unsicher | leg-right |
| character-oobi.glb | pelvis | 0,97 | sicher | root |
| character-oobi.glb | foot_l | 0,71 | unsicher | leg-left |
| character-oobi.glb | foot_r | 0,71 | unsicher | leg-right |
| character-oodi.glb | pelvis | 0,96 | sicher | root |
| character-oodi.glb | foot_l | 0,71 | unsicher | leg-left |
| character-oodi.glb | foot_r | 0,71 | unsicher | leg-right |
| character-oopi.glb | pelvis | 0,96 | sicher | root |
| character-oopi.glb | foot_l | 0,71 | unsicher | leg-left |
| character-oopi.glb | foot_r | 0,71 | unsicher | leg-right |
| character-oozi.glb | pelvis | 0,96 | sicher | root |
| character-oozi.glb | foot_l | 0,70 | unsicher | leg-left |
| character-oozi.glb | foot_r | 0,70 | unsicher | leg-right |
| CesiumMan.glb | pelvis / foot_l / foot_r | 1,00 | sicher | Skeleton_torso_joint_1 / leg_joint_L_3 / leg_joint_R_3 |
| RiggedFigure.glb | pelvis / foot_l / foot_r | 1,00 | sicher | torso_joint_1 / leg_joint_L_3 / leg_joint_R_3 |
| Soldier.glb | pelvis / foot_l / foot_r | 1,00 | sicher | mixamorigHips / mixamorigLeftFoot / mixamorigRightFoot |

Keine Pflichtrolle irgendeines Modells liegt unter 0,5. Unter 0,5 liegen nur
Nebenrollen, u. a. Michelle: shin_l/shin_r 0,31, toe_l/toe_r 0,42,
shoulder/forearm 0,31–0,42; BrainStem: shin_l/shin_r 0,45, hand_l/hand_r 0,48.
Diese stehen seit der Änderung als `abgelehnteZuordnungen` mit bestem
Kandidaten und Konfidenz im Bericht, statt in einer Warnung zu verschwinden.

## 3. Was geändert wurde

**`src/rig/detect.js`** — die Konfidenzordnung plan.md 5.1 trägt jetzt auf der
Rolle selbst sichtbar:

- Konfidenz 0,5–0,9 (Rückfragezone): die Rolle bleibt gesetzt und trägt
  `confirm: true` und `vorschlag` — „unsicher, Rückfrage nötig: bester
  Kandidat ‚…‘ mit Konfidenz …“. Die Frage in `questions` führt denselben
  Vorschlag als Feld mit. Keine dieser Zuordnungen führt zur Ablehnung; die
  Pflichtrollen-Prüfung akzeptiert sie als vergeben.
- Konfidenz unter 0,5: weiterhin **keine Rolle** (geraten wird nie). Der beste
  Kandidat steht mit Konfidenz, Grenze und Grund im neuen Feld
  `abgelehnteZuordnungen` — der Befund bleibt mit Zahl sichtbar, statt nur in
  einer Warnung zu stehen.

**`src/tools/rollen-priorisierung.js`** — `offenerRest()` gibt den offenen
Rollen jetzt den besten Kandidaten mit: neues Feld `vorschlaege`
(`{ rolle: { bone, confidence } }`) neben `offeneRollen` und `meldung`. Die
Vorschläge kommen aus dem `vorschlag`-Feld der Frage, rückwärtskompatibel aus
der ersten Frageoption.

**Tests:** `src/rig/detect.test.mjs` (+3 Tests: Fragezone markiert statt
abgelehnt; Negativfall unter 0,5; abgelehnte Zuordnung mit bestem Kandidaten)
und `src/tools/rollen-priorisierung.test.mjs` (+2 Tests: Vorschlag im
offenen Rest; Negativfall offene Rolle ohne Kandidaten). Jeder neue Test hat
seinen Negativfall.

## 4. Wie viele der zehn Modelle laufen danach durch

Nachzählen mit `node spikes/fremdmodelle/messung.mjs`:

**9 von 10 Modellen durchlaufen die Rollenerkennung (`detectRig`)** — dieselbe
Nine wie vor der Änderung, aber mit dem Unterschied, dass die Fragezone statt
stiller Übergabe jetzt ausdrücklich als „unsicher, Rückfrage nötig" markiert
ist und mit Vorschlag in die Rückfragen kommt:

| Modell | Rollen | Fragezonen-Markierung |
|---|---|---|
| CesiumMan.glb | ja | hand_l/hand_r 0,58, toe/neck/spine 0,72 |
| Michelle.glb | ja | foot_l/**foot_r 0,56–0,58**, thigh/arm 0,53, neck/spine 0,72 |
| RiggedFigure.glb | ja | hand_l/hand_r 0,58, toe/neck/spine 0,72 |
| Soldier.glb | ja | shin_l 0,54, hand 0,58, toe/neck/spine 0,72 |
| BrainStem.glb | ja | **alle drei Pflichtrollen 0,84** |
| Kenney_Ooli.glb | ja | **foot_l/foot_r 0,72**, thigh/head/chest/arm 0,90 |
| character-oobi/oodi/oopi/oozi.glb | ja | **foot_l/foot_r 0,70–0,71**, Rest 0,88–0,89 |

**RobotExpressive.glb** läuft nicht und soll nicht: keine aufrechte
zweibeinige Haltung messbar (bester Achsenwert 0, Grenze 0,45) — die Ablehnung
ist geometrisch, nicht konfidenzbedingt.

**Nicht durch die Rollenerkennung, sondern später** (dieselbe Zahl wie vor der
Änderung, hier nur der Vollständigkeit halber): Michelle stoppt im Löser,
BrainStem am Vertragsprüfer, die Kenney-Familie in der Vermessung —
jeweils mit Zahl in der Stopp-Spalte der Messungstabelle. Beides sind andere
Baustellen (`src/rig/measure.js`, `src/contracts/rig-profile.js`,
`src/solver/kinematik.js`) und nicht Teil dieses Auftrags.

**Werkzeugkette (describe_rig):** die Fragen kommen priorisiert — Pflichtrollen
foot_l/foot_r zuerst, dann die übrigen nach aufsteigender Konfidenz — und jede
offene Rolle trägt den besten Kandidaten samt Konfidenz im `vorschlaege`-Feld.
Der Mensch sieht jeden Vorschlag und kann ihn über `confirm_role` festlegen
oder mit der Ablehnungsoption offen lassen.

## 5. Teststand

- `node --test "src/**/*.test.mjs"`: **293 von 293 grün** (vorher 280, nach
  Hinzufügen der fünf neuen Prüfungen inkl. Negativfällen).
- Messlauf `spikes/fremdmodelle/messung.mjs`: unverändert 9 von 10 Modelle
  mit vollständigen Rollen; die Rückfragezonen stehen je Zeile in der
  Spalte `s/u/u` (sicher/unsicher/unbekannt).