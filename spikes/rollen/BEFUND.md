# Befund: Bestätigte Rollen ändern die Vermessung nicht

Auftrag: Nachweisen (oder widerlegen), dass `confirm_role` kosmetisch bleibt —
gespeichert und angezeigt, aber ohne Wirkung auf das gemessene Rig-Profil
(Segmente, Massen, Sohlen, Gelenkachsen).

Erhebung: `node spikes/rollen/befund-erhebung.mjs` am Xbot
(`befund.json`, Rohzahlen). Gemessen am 31.08.2026.

## Ergebnis: Der Befund stimmt — und zwar nur auf dem Weg der Werkzeuge

Zwei Wege führen zur menschlichen Korrektur, und sie fallen auseinander:

1. **`measureRigProfile(gltf, { roles })` misst neu.** Mit der korrigierten
   Zuordnung aufgerufen, baut `rollenAufloesen()` die Rollentabelle neu auf und
   die gesamte Vermessung läuft darüber. Segmente, Massen, Sohlen und Gelenke
   folgen der Korrektur (Pfad A unten).
2. **Der Weg der Seite und des Agenten läuft NICHT durch diesen Mechanismus.**
   `confirm_role` (handlers.js) schreibt nur in `store.roleConfirmations`;
   `describe_rig` fügt die Bestätigung der ANZEIGE hinzu; `describe_body`
   serviert aber das einmal bei `setzeModell` gemessene Profil, ohne die
   Bestätigung je zu sehen. Pfad B unten zeigt es mit Zahlen.

## Path A — Vermessung mit korrigierter Rolle (funktioniert)

Korrektur `pelvis: mixamorigSpine` (unmögliches Becken, demonstrativ falsch):

| Größe | vorher | nachher |
|---|---|---|
| `roles.pelvis.bone` | mixamorigHips | mixamorigSpine |
| Segment `torso` Radius (m) | 0,1690 | 0,1626 |
| Segment `torso` Masse (kg) | 61,742 | 48,046 |
| Gesamtmasse (kg) | 151,881 | 138,184 |

Korrektur `foot_l → mixamorigLeftToeBase` (der erkannte Zeh als Fuß):

| Größe | vorher | nachher |
|---|---|---|
| `roles.foot_l.bone` | mixamorigLeftFoot | mixamorigLeftToeBase |
| Sohle `sole_l_front_out` am Knochen | mixamorigLeftFoot | mixamorigLeftToeBase |
| Sohle `sole_l_front_out` lokal (m) | [4,28, -6,91, 17,16] | [4,28, 1,81, 6,45] |
| Gelenk `ankle_l` Knochen | mixamorigLeftFoot | mixamorigLeftToeBase |
| Gesamtmasse (kg) | 151,881 | 175,835 |

Segmente, Massen, Sohlen und Gelenke sind also AUS der neuen Zuordnung neu
gemessen — kein Schätzwert dabei, dieselben Messverfahren wie beim ersten Mal.
Der Mechanismus existiert und ist über `opts.roles` erreichbar; die
Vermessungsschicht ist NICHT das Problem.

Negativfall (AGENTS.md Regel 2): `roles: { foot_l: 'gibt-es-nicht' }` wird mit
Zahl abgelehnt — „Knochen „gibt-es-nicht“ gibt es in diesem Skelett mit
67 Knochen nicht“.

## Pfad B — confirm_role + describe_body (der Weg der Seite, defekt)

Identische Korrektur im Werkzeug (`createToolLayer` + echte Ports am Xbot):

| Größe | nach erstem describe_body | nach confirm_role + describe_body |
|---|---|---|
| Segment `torso` Radius (m) | 0,1690 | 0,1690 |
| `torso.from` (Bezugsrolle) | mixamorigHips | mixamorigHips |
| Gesamtmasse (kg) | 151,8805 | 151,8805 |
| `roleConfirmations` im Store | {} | pelvis → mixamorigSpine, foot_l → mixamorigLeftToeBase |
| Sohle `sole_l_front_out` am Knochen | mixamorigLeftFoot | mixamorigLeftFoot |
| JSON.stringify(body) vor/nach | — | bitidentisch (`identisch: true`) |

Die Bestätigung liegt im Zustand, wird in `describe_rig` angezeigt („Rolle
pelvis = mixamorigSpine … vom Menschen bestätigt“) — und erreicht den
Vermessungsweg nie:

- `ports.setzeModell()` misst `measureRigProfile(gltf, { fileName })` ohne
  `roles` (ports.js, Zeile 578);
- `describe_body` serviert `s.profil.segments/.soles/.restDistances` aus diesem
  einen einmal gemessenen Objekt;
- kein Aufrufer liest `store.roleConfirmations` zurück in eine Messung; auch
  `bestaetigeUnsichereRollen` in index.html ruft nach dem Rollendialog nichts
  mehr auf, was neu vermessen würde.

## Folge für den Löser und die Validation

`describe_pose`, `measure` und `validate` lesen ihre Körperpunkte über
`ports.rig.rig().roles` bzw. `rollenTabelle()` — auch dort steht weiterhin die
ursprüngliche Erkennung, nicht die bestätigte Zuordnung. Der Agent, der beim
Menschen eine Seitenverwechslung korrigieren ließ, misst danach an denselben,
möglicherweise falschen Knochen wie vorher.

## Wo der Draht fehlt

Die Verdrahtung liegt in `src/tools/ports.js` (`setzeModell` →
`measureRigProfile` ohne `roles`, `rig()`/`body()` → einmaliges `s.profil`) und
`src/tools/handlers.js` (`confirm_role` schreibt nur in `store.aendere`,
`describe_body` übernimmt die Bestätigungen nicht in die Messung) — Dateien, die
diesem Auftrag explizit NICHT gehören. Fixableit steht unten; der Auftrag
beschränkt die Änderung auf `src/rig/` und `spikes/rollen/`.

## Was dem Auftrag folgend behoben wurde (src/rig/, dieses Paket)

1. **Neuer Bestätigungskanal in der Vermessung:** `rollenAufloesen()` akzeptiert
   neben `opts.roles` jetzt `opts.bestaetigteRollen` — dieselbe Form
   `{ rolle: knochenName }`, wie sie der Tool-Store unter `roleConfirmations`
   hält. Beide Kanäle setzen die Rolle mit Konfidenz 1, Quelle „bestaetigt“;
   ein bestätigter Nicht-Knochen wird mit Zahl abgelehnt (Negativfall).
2. **Abweichende Bestätigung zwingt zur Neumessung:** der neue Helfer
   `contextMitKorrekturen()` (measure.js) stellt die Bestätigungen gegen die
   erkannten Rollen des Erkennungsberichts. Weicht mindestens eine Zuordnung
   ab, baut er den Kontext NEU auf — und `measureRigProfile` sowie alle
   Einzelmessungen (`measureMasses`, `measureSoles`, `measureJoints`,
   `measureRestDistances`) messen dann vollständig mit der korrigierten
   Rollentabelle: Segmentradien, Massen, Sohlen, Gelenkproben, Ruheabstände,
   derselbe Messweg wie beim ersten Mal, kein Schätzwert.
3. **Keine Zufallszweitmessung:** bestätigt der Mensch die bereits erkannte
   Zuordnung, weicht nichts ab und es gibt keinen zweiten Messlauf — der
   Kontrollfall Test verlangt, dass dieses Bestätigen bitidentische Segmente
   und Sohlen liefert.

Tests: `src/rig/measure.test.mjs`, Reihe „Bestätigungen messen neu“ — 4 Tests,
alle grün; gegen den Stand ohne Fix schlagen 3 davon rot (Gegenprobe gemessen).

**Grenze dieses Auftrags, mit Zahl belegt:** `describe_body` zeigt die neuen
Werte erst, wenn die Werkzeugschicht die Bestätigungen übergeben hat. Genau
eine Stelle fehlt: `src/tools/ports.js`, `setzeModell()` ruft
`measureRigProfile(gltf, { fileName })` ohne Bestätigungen auf, und
`confirm_role` (handlers.js) schreibt nur in den Store. Der Eintrag auf der
Pinnwand nennt die Zeile — es ist eine Übergabe, kein zweiter Umbau.