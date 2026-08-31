# Demo-Video — Drehbuch

Vorgaben aus der Einreichung (`docs/challenge.md`): unter 3 Minuten, öffentlich auf
YouTube, **mit Ton**. Aufbau: zwei Fenster nebeneinander — links die ChatGPT-Desktop-App
(der Chat), rechts der eingebaute Browser mit unserer Seite (die Werkstatt).

Alle Zahlen im Sprechtext sind belegt; Herkunft steht in der Liste am Ende.

## Drehbuch

| Zeit | Was zu sehen ist | Was gesagt wird |
|---|---|---|
| 0:00–0:36 | Die Two-Window-Anordnung steht schon: links ChatGPT, rechts unsere Seite im eingebaute Browser. Rechts läuft oder zeigt eine kaputte Motion aus dem Vortest (Ellbogen im Gesicht, Füße schweben). Titel-Einblendung unten, Name des Projekts. | "Ask an AI agent to animate a rigged 3D character and you get elbows inside faces, feet floating above the floor. Not because the model is dumb — because it is blind. Its feedback is one rendered image, where a foot eighteen millimetres inside the floor is invisible. In our pre-test, twenty minutes of agent work produced a rotation with no takeoff, a third of the timeline motionless — and not a single rendered image." |
| 0:36–1:12 | Cursor zieht `Xbot.glb` in die Seite. Der Messbericht läuft ein und die Zahlen werden sichtbar: 18 Gelenke, 14 Segmente, 8 Sohlenpunkte, 0 Warnungen. Kurz die Werkzeugliste (`getTools()`) einblenden, um zu zeigen, dass die Werkzeuge erst nach dem Upload registriert wurden. | "Here is the workshop. I drag in any rigged humanoid — no setup, no bone mapping. The page measures the body itself from the model: eighteen joints, fourteen segments, eight sole points, zero warnings. Then it registers its tools live through WebMCP, and hands the agent what it never had: measurement numbers and rendered image strips, together in one response. Estimated body data produced 269 false alarms on a clip where the figure just stands still. Measured data: none." |
| 1:12–1:50 | Links wird der Auftrag in ChatGPT getippt und abgeschickt. Rechts arbeitet die Seite: Phasen lösen, Bericht mit Bildstreifen erscheint. Dann spielt die Animation: Hocke, Absprung, Drehung, Landung. Die drei Zahlen (25,9 cm / 3,23 m / 360,0°) als Overlay einblenden, während sie im Sprechtext fallen. | "Now the real order, typed in ChatGPT: backflip from a standing start. The agent first states its goal in measurable numbers, then orders motion phases — crouch, takeoff, tuck, land. The solver turns those into poses from the measured masses, axes and sole points. The reports come back annotated: crouch depth twenty-five point nine centimetres, three point two three metres of centre-of-mass travel, a full 360-degree rotation. The agent checks the image strips, and the figure on the right plays the result." |
| 1:50–2:26 | Der Kernmoment: Die Seite zeigt zwei Landungsvarianten nebeneinander, als Werkzeugkarte, die auf eine Antwort wartet. Der Cursor fährt heran, **klickt auf der Seite** eine Variante an. Kurz zoomen auf die Karte und den Klick. Die Chat-Antwort erscheint und der Agent baut weiter. Endkarte: Projektname, Repository-Link. | "And this is the part only WebMCP can do. Mid-build, the agent stops. Two landing variants, side by side, right here on the page. A question appears — 'Which one?' — and the agent waits, inside the very same tool call. I don't write a prompt. I click. The answer goes straight back, and the agent keeps building. That's the whole difference: a server process has no surface anyone can click. Blind agents animate. This one sees — and asks. That's our submission." |
| 2:26–3:00 | Ende, keine Stimme. Reserve, falls eine Szene nachgedreht werden muss. | — |

## Gewichtung

Der Vorschlag von vier Abschnitten wurde übernommen. Abweichend vom Vorschlag kriegt der
Abschnitt 4 (die Rückfrage) zusammen mit dem Problem den größten Anteil: Der Klick auf
der Seite ist der eigentliche Beitrag — ein klassischer MCP-Server hat keine Oberfläche,
vor der jemand sitzt, und genau das muss im Video zu sehen sein, nicht nur behauptet.
Die Vermessung ist dagegen in einer Zahl unterzubringen und kriegt deshalb entsprechend
wenig Sprechzeit.

## Aufnahmehinweise

- Sprechtext separat aufnehmen (Voice-over), 1080p, Cursor bleibt sichtbar — der Klick
  in Abschnitt 4 ist das wichtigste Bild des Videos und muss deutlich erkennbar sein.
- Ton muss enthalten sein (Wettbewerbsbedingung); Sprache genügt, Musik optional.
- Nach Fristende (3. September 2026, 13:00 PT) darf das Video nicht mehr ersetzt
  werden — früh genug öffentlich auf YouTube hochladen.

## Belegte Zahlen im Sprechtext und woher sie kommen

| Zahl im Video | Quelle |
|---|---|
| 269 Fehlalarme auf stehendem Clip (geschätzte Maße) | `README.md`, `docs/abgabe.md` Abschnitt 4 |
| Vortest: 20 Minuten, Drehung ohne Absprung, ein Drittel bewegungslos, kein gerendertes Bild | `docs/abgabe.md` Abschnitt 2 |
| 18 Gelenke, 14 Segmente, 8 Sohlenpunkte, 0 Warnungen | Vorgabeliste im Auftrag (`docs/video.md` Auftrag); vor Aufnahme gegen den Rig-Bericht des Testmodells prüfen |
| Hocke 25,9 cm, Sprung 3,23 m Schwerpunktweg, 360,0° Drehung | Vorgabeliste im Auftrag; vor Aufnahme gegen den Löser-Bericht prüfen |

## Sprechdauer

Gesprochener Text: gezählt **319 Wörter** (75 + 79 + 82 + 83). Bei etwa 150 Wörtern pro
Minute ergibt das rund **2:08 Sprachdauer** — die Abschnitte sind mit 2:26 Sprechzeit
verplant, das Video bleibt unter drei Minuten. Grenze aus der Abnahme war 450 Wörter:
eingehalten.