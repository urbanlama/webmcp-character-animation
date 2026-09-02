# Live-Abnahme — 2. September 2026

## Belegt

- Isoliertes Chrome `152.0.7977.65`, lokaler Server `http://localhost:18000/`.
- Chrome meldete 18 Werkzeuge direkt über `document.modelContext`; der Abnahmelauf über die DevTools-WebMCP-Domain bestand **29 von 29** Prüfungen. Kein `window.__tools`-Fallback.
- Ein eigener Agentenlauf setzte einen 78-Frame-Salto ausschliesslich über die nativen Werkzeuge (`set_duration`, `set_intent`, `set_pose`, `look`, `validate`). Kritische Bilder wurden an den Frames 0, 12, 24, 33, 42, 54 und 77 geprüft.

## Befunde vor der Videoaufnahme

1. **P0 — Wurzeldrehung erfüllt `rotation` nicht.** Der Bildstreifen meldet 360 Grad Wurzeldrehung; `validate` misst für das dokumentierte Kriterium `rotation(part: mixamorigHips, axis: x, minDeg: 300)` trotzdem 0,0 Grad. Ein Salto kann damit optisch rotieren und zugleich seine eigene Dreh-Absicht verfehlen. Reproduziert im nativen WebMCP-Weg.

2. **P1 — Der erste freie Agentenversuch ist sichtbar und technisch schlecht, wird aber korrekt abgefangen.** Der Validator fasste 174 Einzelbefunde zu 23 zusammen: bis zu 10,5 cm Bodendurchdringung, falsche Flugbeschleunigungen von 2,94 bis 46,20 statt 9,81 m/s² und einen Ruck von 38,0 cm (21,0-faches Umfeld). Physik, Absicht und Stil waren alle `passed: false`.

3. **P1 — Bildbefund desselben Laufs:** Hocke kippt seitlich, Flug ist nicht sauber getuckt, die Landung erreicht zunächst keinen stabilen Kontakt. Der Bildstreifen und die einzeln kontrollierten Schlüsselbilder stimmen mit den Zahlen überein. Das ist gut für die Fehlererkennung, aber nicht vorzeigbar.

4. **P2 — Testzustand bleibt erhalten.** `set_duration` änderte die Länge, löschte aber bereits gesetzte Haltungen und einen Fußanker nicht. Im frischen Agentenlauf ist das nicht zwingend falsch; für Wiederholungs- und Demoabläufe muss der Startzustand jedoch explizit sauber sein.

## Nächste Abnahme, nicht neue Funktion

Den bereits erfolgreichen 78-Frame-Agentenlauf im aktuellen Stand nativ wiederholen, nach jedem `look` die Schlüsselbilder ansehen und erst dann aufnehmen. Der P0-Befund muss vorher geklärt sein; ein grüner Validator mit 0 Grad Drehung wäre kein Abgabebeleg.
