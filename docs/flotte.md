# Die Flotte — wer macht was

Gebaut wird von mehreren Agents parallel. Diese Datei sagt, welche Aufgabe an wen geht
und wie man sie beauftragt. Alle Aufrufe wurden getestet.

## Rollenverteilung

| Rolle | Wer | Wofür |
|---|---|---|
| Leitung | die Sitzung, in der du gerade arbeitest | zerlegt Aufgaben, verteilt, prüft Ergebnisse, führt zusammen |
| Kern | Opus-Subagent `kern` | Rig-Vermessung, Messschicht, Phasenlöser, Validatoren |
| Oberfläche | Opus-Subagent `oberflaeche` | 3D-Ansicht, Bedienfeld, Rückfragen, Werkzeugbeschreibungen, Fehlermeldungen |
| Festgefahren | Opus-Subagent `festgefahren` | alles, was zweimal fehlgeschlagen ist |
| Zuarbeit A | Qwen 3.8 Flash über Command Code | abgegrenzte Aufgaben mit klarer Vorgabe |
| Zuarbeit B | GLM 5.3 Flash über Ollama | dito, zweiter Strang für echte Parallelität |

**Grundsatz:** Opus baut alles, wo ein unbemerkter Fehler später die ganze Animation
falsch macht, und alles, was ein Mensch oder ein Agent zu sehen bekommt. Die beiden
externen Modelle sind keine Hilfskräfte für Kleinkram — sie sind stark und bekommen
echte Arbeitspakete. Sie brauchen nur eine scharf umrissene Aufgabe und einen
Abnahmetest.

## Opus-Subagents beauftragen

Über das Agent-Werkzeug, Agententyp `kern`, `oberflaeche` oder `festgefahren`.
Die Definitionen liegen in `.claude/agents/`.

## Qwen 3.8 Flash beauftragen

```bash
cmdc -p "<Auftrag>" -m "Qwen/Qwen3.8-Flash" --effort xhigh -t --max-turns 60
```

- `cmdc`, **nicht** `cmd` — `cmd` ist Windows' eigene Eingabeaufforderung
- `-t` überspringt die Rechtefrage im Projekt
- `--effort xhigh` ist für dieses Modell hinterlegt
- Kontingent: reichlich vorhanden

Ausgabe in eine Datei umleiten und danach lesen:

```bash
cmdc -p "$(cat auftrag.md)" -m "Qwen/Qwen3.8-Flash" --effort xhigh -t --max-turns 60 > ergebnis.txt 2>&1
```

## GLM 5.3 Flash beauftragen

```bash
/c/Users/maxbl/bin/glm53.cmd -p "<Auftrag>"
```

Das Skript setzt `OC_MODEL=ollama-cloud/glm-5.3-flash` und ruft das kimi-code-CLI auf.

- Kontingent knapp: 96,6 % der Wocheneinheit verbraucht, setzt sich stündlich zurück
- Deshalb sparsam einsetzen, keine langen Erkundungsläufe

## Was ein Auftrag an ein externes Modell enthalten muss

Die externen Modelle sehen deine Sitzung nicht. Ein Auftrag muss ohne Vorwissen
verständlich sein:

1. **Was gebaut wird** — eine Datei, eine Funktion, ein abgegrenztes Stück
2. **Eingabe und Ausgabe** — welches Datenformat rein, welches raus, mit Verweis auf
   das Schema im Design-Plan
3. **Was es nicht tun soll** — welche Dateien es nicht anfasst
4. **Der Abnahmetest** — der Positivfall *und* der Negativfall, der rot werden muss
5. **Der Hinweis auf `AGENTS.md`** — die drei Regeln gelten für alle

Ohne Punkt 4 wird der Auftrag nicht vergeben. Ein Ergebnis ohne Negativtest ist heute
in diesem Projekt schon zweimal falsch gewesen.

## Dateibesitz

Zwei Agents dürfen nie gleichzeitig dieselbe Datei bearbeiten. Wer ein Paket bekommt,
bekommt die Dateien dazu ausdrücklich zugewiesen. Gemeinsame Dateien — Schemata,
Werkzeugkatalog — gehören der Leitung und werden nur dort geändert.

## Getestet am 30. August 2026

| Weg | Ergebnis |
|---|---|
| `cmdc -m "Qwen/Qwen3.8-Flash"` | antwortet |
| `cmdc -m "zai-org/GLM-5.3"` | antwortet (Alternative, falls Ollama-Kontingent leer) |
| `glm53.cmd` über kimi-code | antwortet |
| Ollama-Cloud-API direkt | antwortet; Inhalt steht in `content`, die Gedankenkette getrennt in `reasoning` |
