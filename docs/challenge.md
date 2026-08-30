# WebMCP Challenge — die harten Fakten

Quelle: <https://webmcp.devpost.com/rules> und <https://webmcp.devpost.com>
Abgerufen am 30. August 2026. Bei Widersprüchen gelten die offiziellen Regeln, nicht dieses Dokument.

## Fristen

| Was | Wann |
|---|---|
| Einreichung offen | 25. August 2026, 11:00 PT |
| **Einreichung schließt** | **3. September 2026, 13:00 PT** |
| Bewertung | 4. bis 21. September 2026 |
| Gewinner | etwa 23. September 2026 |

Nach Fristende dürfen Einreichung, Repo und Live-Seite nicht mehr verändert werden.
Weiterarbeiten nur in einem Fork.

## Was abgegeben werden muss

**Live erreichbare URL.** Muss im ChatGPT-Browser oder in Chrome mit WebMCP funktionieren.

**Textbeschreibung**, die vier Fragen beantwortet:
- Warum passt das zu WebMCP?
- Wie verbessert es die Nutzererfahrung?
- Was können Mensch und Agent jetzt gemeinsam, was vorher nicht ging?
- Wie ist es umgesetzt?

**Öffentliches Repository** auf GitHub, GitLab oder Bitbucket. Bedingungen:
- Open-Source-Lizenz, **sichtbar im About-Bereich** des Repos
- tatsächlicher Einsatz von `document.modelContext.registerTool({...})` im Code

**Demo-Video**
- unter 3 Minuten
- öffentlich auf YouTube
- **mit Ton**

## Bewertungskriterien

Vier Kriterien, **gleich gewichtet**:

1. **WebMCP Leverage** — echte, nicht triviale Nutzung von WebMCP
2. **Execution** — vollständiges, stimmiges Produkt, kein Proof of Concept
3. **Potential Impact** — echtes Problem, echte Zielgruppe
4. **Creativity & Ambition**

## Bestehende Projekte

Zulässig, aber alles, was vor dem 25. August entstanden ist, muss **während des
Einreichungszeitraums bedeutend um WebMCP erweitert** werden. Nachweis über
Commit-Historie mit Zeitstempeln.

## Technischer Zugang

- ChatGPT-Desktop-App, eingebauter Browser — WebMCP standardmäßig aktiv
- Chrome ab Version 149 mit `chrome://flags/#enable-webmcp-testing`

## Teilnahmeberechtigung

Wohnsitz in einem Land, das OpenAI-API unterstützt. Ausgeschlossen unter anderem:
Brasilien, China, Hongkong, Quebec, Russland, Kuba, Iran, Nordkorea, Syrien, Venezuela,
Krim, Donezk, Luhansk sowie OFAC-gelistete Gebiete. Ebenso Mitarbeitende und Angehörige
von Sponsoren und Jury.

Teams ohne Größenbegrenzung, ein Mitglied vertritt das Team bei der Einreichung.

## Preise

Die zehn besten Einreichungen erhalten jeweils:

- OpenAI: 3.000 USD, Erwähnung durch @OpenAIDevs, Codex Micro, Merch (bis 3 Personen),
  ein Jahr ChatGPT Pro (bis 3 Personen)
- Cloudflare: 10.000 USD Guthaben
- Vercel: 300 USD/Monat Guthaben
- Render: 300 USD Guthaben
- Netlify: 500 USD
- Shopify: 250 USD Ausrüstung
- Google Chrome: drei Monate Google AI Ultra je Teammitglied

Ein Preis pro Projekt.

## Gemessene technische Grenzen

Eigene Messung, Chrome 151, siehe `spikes/test-a-webmcp/ERGEBNIS.md`:

| Frage | Ergebnis |
|---|---|
| Zugriffsweg | `document.modelContext`, `navigator.modelContext` existiert noch |
| Methoden | `registerTool`, `getTools`, `executeTool`, `ontoolchange` |
| Werkzeuge zur Laufzeit nachregistrieren | funktioniert, 5 → 45 |
| Antwortgröße | 512 KB in 5 ms, vollständig |
| 50 Aufrufe am Stück | 16 ms, fehlerfrei |
| Werkzeug wartet auf Klick | funktioniert, Antwort im selben Aufruf |

Signatur: `await document.modelContext.registerTool({name, description, inputSchema, execute})`,
`execute` liefert `{content:[{type:'text',text}]}`.
Zum Selbstaufruf: `executeTool(toolObjekt, argumenteAlsJsonString)` — Rückgabe ist ein String.
