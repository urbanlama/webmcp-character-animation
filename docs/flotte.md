# Die Flotte

Du bist der Hauptverantwortliche. Du zerlegst die Arbeit, verteilst sie, prüfst das
Ergebnis und führst es zusammen. Wer welches Paket bekommt, entscheidest du.

## Wer wofür

**Opus-Subagents** für das, was wehtut, wenn es schiefgeht: die Rechenlogik im Kern und
alles Sichtbare. Drei Typen liegen in `.claude/agents/`: `kern`, `oberflaeche`,
`festgefahren`.

**GLM 5.3 Flash über Ollama** für den Großteil der Bauarbeit. Zuerst ausschöpfen — das
Kontingent verfällt sonst. Höchstens drei gleichzeitig.

**Qwen 3.8 Flash über Command Code** für alles Weitere und wenn Ollama leer ist. Beliebig
viele parallel, das Kontingent ist reichlich.

Beide externen Modelle sind stark. Sie brauchen eine klare Aufgabe, keine Anleitung in
Einzelschritten.

## Aufrufe

```bash
# GLM 5.3 Flash über Ollama — erste Wahl, max. 3 gleichzeitig
/c/Users/maxbl/bin/glm53.cmd -p "<Auftrag>"

# Qwen 3.8 Flash über Command Code — beliebig viele
cmdc -p "<Auftrag>" -m "Qwen/Qwen3.8-Flash" --effort xhigh -t --max-turns 60
```

`cmdc`, nicht `cmd` — `cmd` ist Windows' eigene Eingabeaufforderung.

Für längere Aufträge den Text aus einer Datei einlesen und die Ausgabe umleiten:

```bash
/c/Users/maxbl/bin/glm53.cmd -p "$(cat auftrag.md)" > ergebnis.txt 2>&1
```

Falls das Ollama-Kontingent leerläuft, gibt es GLM 5.3 auch über Command Code:
`cmdc -m "zai-org/GLM-5.3"`.

## Was in einen Auftrag gehört

Die externen Modelle sehen deine Sitzung nicht. Sie brauchen: was gebaut wird, welche
Dateien sie besitzen, welche sie nicht anfassen, und woran man erkennt, dass es fertig
und richtig ist.

**Der Abnahmetest braucht einen Negativfall.** Das ist die einzige Vorgabe, die nicht
verhandelbar ist — in diesem Projekt waren heute bereits zwei gemeldete Ergebnisse
falsch, weil nur der Positivfall geprüft wurde.

Verweise auf `AGENTS.md`, dort stehen die drei Regeln.

## Dateibesitz

Zwei Agents dürfen nie gleichzeitig dieselbe Datei bearbeiten. Gemeinsame Dateien —
Schemata, Werkzeugkatalog — gehören dir und werden nur von dir geändert.

## Getestet am 30. August 2026

| Weg | Ergebnis |
|---|---|
| `glm53.cmd` über kimi-code | antwortet |
| `cmdc -m "Qwen/Qwen3.8-Flash"` | antwortet |
| `cmdc -m "zai-org/GLM-5.3"` | antwortet |
| Ollama-Cloud-API direkt | antwortet; Inhalt in `content`, Gedankenkette getrennt in `reasoning` |
