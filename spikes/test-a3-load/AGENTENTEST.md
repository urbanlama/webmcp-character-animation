# Echter Agententest — 10 Alltagsanfragen an ein fremdes Modell

Ergänzung der Leitung zum Prüfstand in diesem Verzeichnis.

## Warum

Der Prüfstand hier misst mit einem selbstgebauten Scoring über handgepflegte
Schlüsselbegriffe. Das ist ehrlich dokumentiert und die Wortabdeckungsmessung ist
brauchbar — aber es ist kein Agent. Die Frage des Pakets lautet: wählt ein *Agent* aus
16 Werkzeugen das richtige? Ein Wortscoring kann das nicht beantworten.

## Aufbau

Ein fremdes Modell (Qwen 3.8 Flash) bekommt ausschließlich Namen und Beschreibungen der
16 Werkzeuge, sonst nichts — kein Code, kein `plan.md`, kein Projektwissen. Dazu zehn
Anfragen in Alltagssprache. Es nennt je Anfrage genau ein Werkzeug.

Vorlage: `agententest-vorlage.md`, Platzhalter `WERKZEUGE_HIER` durch Name und
Beschreibung der 16 Werkzeuge ersetzen.

## Messung vom 31.08.2026, Katalog vor der Nachschärfung

**9 von 10 richtig.**

Richtig: look, undo, describe_world, set_duration, probe_joint, validate, set_target,
set_joint, export_clip.

**Falsch, und zwar an der teuersten Stelle:**

| Anfrage | Gewählt | Richtig |
|---|---|---|
| „Lass die Figur einen Schritt nach links machen." | `describe_world` | `add_phase` |

Das ist die zentrale Handlung des ganzen Produkts — eine Bewegung anlegen. Der Agent
fragt stattdessen die Weltbeschreibung ab. Wer eine Bewegung bestellen will und beim
Nachschlagen landet, kommt nie zum Bauen.

Das Scoring im Prüfstand hatte an dieser Stelle 7 von 7 gemeldet. Der Fehler wurde erst
sichtbar, als ein echtes Modell wählen musste.

## Was daraus folgt

`add_phase` ist die Beschreibung, die am dringendsten nachgeschärft werden muss. Sie
braucht die Alltagswörter, mit denen ein Mensch eine Bewegung bestellt: gehen, Schritt,
springen, drehen, hocken, sich bewegen.

Nach jeder Änderung am Katalog wird diese Messung wiederholt und das Ergebnis hier
nachgetragen. Alt bleibt stehen.

---

## Messung nach der Nachschärfung, 31.08.2026

**Wieder 9 von 10 — aber an anderer Stelle.**

| Anfrage | Vorher | Nachher |
|---|---|---|
| „Lass die Figur einen Schritt nach links machen." | `describe_world` ❌ | `add_phase` ✓ |
| „Die Animation soll insgesamt drei Sekunden dauern." | `set_duration` ✓ | `set_intent` ❌ |

Der kritische Fehler ist behoben: `add_phase` nennt jetzt „einen Schritt nach links" und
wird gefunden. Auch `undo` („rückgängig") und `look` („von vorn, von der Seite") tragen.

Dafür ist ein neuer entstanden. Ursache, nachgelesen:

    set_duration: „Setzt die Gesamtlänge der Animation in Frames …"
    set_intent:   „… alle Zeiten in Sekunden."

Die Anfrage sagt „drei Sekunden". Das Wort steht nur bei `set_intent`. `set_duration`
wurde nicht nachgeschärft, weil es nicht in der Mängelliste stand — und verliert dadurch
gegen ein Werkzeug, das den Begriff zufällig führt.

**Daraus gelernt:** Eine Nachschärfung, die nur die gemeldeten Werkzeuge anfasst,
verschiebt das Problem. Beschreibungen konkurrieren miteinander; wer eines schärft,
ändert das Kräfteverhältnis zu allen anderen. Nach jeder Änderung am Katalog wird die
ganze Messung wiederholt, nicht nur der geänderte Teil.

---

## Messung nach der zweiten Nachschärfung, 31.08.2026

**10 von 10 richtig.** Beide vorherigen Fehler behoben, kein neuer eingeführt.

| Anfrage | 1. Messung | 2. Messung | 3. Messung |
|---|---|---|---|
| „einen Schritt nach links machen" | `describe_world` ❌ | `add_phase` ✓ | `add_phase` ✓ |
| „soll drei Sekunden dauern" | `set_duration` ✓ | `set_intent` ❌ | `set_duration` ✓ |
| die übrigen acht | ✓ | ✓ | ✓ |

Was den Ausschlag gab: `set_duration` nennt jetzt Sekunden und Frames samt ihrer
Beziehung, statt nur Frames. Der zweite Durchgang hat außerdem alle zehn Anfragen gegen
alle sechzehn Beschreibungen geprüft, nicht nur die geänderten — die Lehre aus dem
Rückschlag der ersten Nachschärfung.

Damit ist die Frage von A3 beantwortet: Ein Agent, der nur Namen und Beschreibungen
sieht, wählt bei zehn Alltagsanfragen zehnmal das richtige Werkzeug.

Wer den Katalog ändert, wiederholt diese Messung. Sie kostet einen Modellaufruf.
