# Test A — Gemessene WebMCP-Grenzen

Chrome 151.0.7922.175, Start mit `--enable-experimental-web-platform-features`, Seite über `http://localhost:8777` (secure context).

## API-Fakten

| Frage | Antwort |
|---|---|
| Zugriffsweg | `document.modelContext` vorhanden; `navigator.modelContext` existiert ebenfalls noch |
| Methoden | `registerTool`, `getTools`, `executeTool`, `ontoolchange` |
| Registrierung | `await mc.registerTool({name, description, inputSchema, execute})` |
| Rückgabe von `execute` | `{ content: [{ type: "text", text: "…" }] }` |
| **`executeTool`-Signatur** | `executeTool(registeredTool, argsAlsJsonString)` — erstes Argument ist ein Objekt aus `getTools()`, **nicht** der Name; zweites ist ein **JSON-String**, kein Objekt |
| **Rückgabe von `executeTool`** | ein **String**, der das JSON enthält → `JSON.parse(raw).content[0].text` |
| Tool-Objekt-Felder | `name`, `description`, `inputSchema`, `title`, `origin`, `window` |

`executeTool` bedeutet: Die Seite kann ihre eigenen Werkzeuge aufrufen. Damit sind automatisierte Regressionsläufe ohne Agent möglich.

## Messwerte

| Was | Ergebnis |
|---|---|
| Dynamisches Nachregistrieren | funktioniert — 5 → 45 Werkzeuge zur Laufzeit, alle 40 neuen über `getTools()` sichtbar und aufrufbar |
| Antwortgröße 8 KB | vollständig, 1 ms |
| Antwortgröße 32 KB | vollständig, 1 ms |
| Antwortgröße 128 KB | vollständig, 3 ms |
| Antwortgröße 512 KB | vollständig, 5 ms |
| 50 Aufrufe am Stück | 16 ms gesamt, kein Fehler |
| Blockierende Rückfrage | funktioniert — Aufruf hängt, bis der Mensch klickt; Antwort kommt als Ergebnis desselben Aufrufs zurück (3,1 s Wartezeit gemessen) |

## Bedeutung für die Architektur

- Werkzeuge dürfen nach dem Modell-Upload erzeugt werden. Kein Umbau der Architektur nötig.
- Messreports müssen nicht knapp gehalten werden. Die Browser-Seite ist bei 512 KB nicht ansatzweise am Limit. Die begrenzende Größe ist das Kontextfenster des Agenten, nicht die API.
- Die Mensch-Schleife trägt. Ein Werkzeug kann auf einen Klick warten und die Antwort im selben Aufruf zurückgeben — genau das, was ein klassischer MCP-Server nicht kann.

## Offen — braucht einen echten Agenten

Alle Messungen oben wurden über `executeTool` per Debug-Schnittstelle erzeugt, nicht durch einen Agenten.

Ungeklärt bleibt:

- Behält ein Agent bei 45 Werkzeugen den Überblick, oder wählt er falsch?
- Bemerkt er nachregistrierte Werkzeuge ohne Hinweis?
- Wie viele Aufrufe macht er freiwillig hintereinander, bevor er aufgibt?
- Wie viel Antworttext verkraftet sein Kontext?

Dafür ist der ChatGPT-Browser nötig; auf dieser Maschine ist er nicht installiert.
