# A3 — Agentenlast: sind 16 Werkzeugbeschreibungen unterscheidbar?

Geprüft am 31.08.2026 gegen `src/tools/catalog.js` (Stand: 16 Einträge, Wortlaut
identisch mit `src/ui/WERKZEUGE.md`).

## Was gemessen wurde

Zwei Instrumente, beide durften nur `name` + `description` der 16 Katalogeinträge
sehen — keinen Code, keine Ausführung, kein plan.md:

1. **Auswahl**: sieben Aufgaben in Alltagssprache (fünf Standard, zwei absichtlich
   schwere Verwechslungsfälle). Je Aufgabe wurde aus den Beschreibungen allein ein
   Werkzeug gewählt und gegen die richtige Antwort geprüft.
2. **Wortabdeckung**: mechanisch gemessen, wie viele Kernwörter (Stämme ab vier
   Buchstaben, Umlaute normalisiert) aus der Frage in name+description des
   richtigen Werkzeugs wiederkehren. Dies ist der Schwäche-Finder, nicht das Urteil.

## Zahlen

**Auswahl: 7 von 7 richtig** — alle fünf Standardaufgaben und beide schweren Fälle
wurden richtig gewählt.

| Aufgabe | Frage (gekürzt) | Richtig | Gewählt | Ergebnis |
|---|---|---|---|---|
| A1 | Wie groß ist die Figur, wo ist der Boden? | describe_world | describe_world | Treffer |
| A2 | Lass die Figur einen Schritt nach links machen | add_phase | add_phase | Treffer |
| A3 (schwer) | Bein soll bei Frame 40 auf 0,35 m stehen | set_target | set_target | Treffer |
| A4 (schwer) | Zeig mir, ob das alles so in Ordnung ist | validate | validate | Treffer |
| A5 | Mach es rückgängig | undo | undo | Treffer |
| A6 | Zeig mir von vorn und von der Seite | look | look | Treffer |
| A7 | Bieg mal kurz das linke Hüftgelenk | probe_joint | probe_joint | Treffer |

Die zwei absichtlich schweren Fälle trafen:

- **set_target gegen set_joint**: richtig getrennt. Der ausschlaggebende
  Unterschied steht in der Beschreibung von set_target („Ziel für einen
  Endeffektor … in Metern, Weltkoordinaten“) gegen set_joint („Gelenkwinkel in
  Grad“). Meter gegen Grad ist die einzige scharfe Grenze, und sie ist genannt.
- **look gegen validate**: richtig getrennt, aber knapp. „Zeig mir“ allein wäre
  look; die Entscheidung fiel erst über das Prüfmotiv („ob das in Ordnung ist“),
  das zu validate („Prüft die gesamte Timeline“) passt. Der Bildstreifen allein
  unterscheidet die beiden nicht — **validate erwähnt ihn selbst**.

**Wortabdeckung** (Anteil der Frage-Kernwörter, die in der Beschreibung des
richtigen Werkzeugs auftauchen): A1 50 %, A3 43 %, A2/A4/A5/A6/A7 **0 %**.

Die 0-%-Werte zeigen, wo das Werkzeug in Alltagssprache nicht auffindbar ist,
obwohl die Aufgabe semantisch eindeutig ist:

| Werkzeug | Fehlende Alltagswörter | Bewertung |
|---|---|---|
| undo | „rückgängig“, „mach“, „gefällt mir nicht“ | Kritisch. Die Beschreibung sagt „zurück“, nie „rückgängig“. |
| look | „zeig“, „von vorn“, „von der Seite“, „aussieht“ | Kritisch. „Ansichten (front/side/quarter/top)“ nutzt englische Fachbegriffe ohne deutsche Brücke. |
| probe_joint | „bieg“, „Hüftgelenk“, „kurz“, „schauen was passiert“ | Mittel. „Beugt … probeweise“ hilft nur, wenn man das Wort „beugen“ benutzt. |
| add_phase | „Schritt“, „machen“, „grob“ | Mittel. „Legt eine Bewegungsphase an“ trifft den Bauvorgang, aber keine Bewegungsformen (Schritt, Sprung, Drehung). |
| validate | „in Ordnung“, „alles“, „insgesamt“ | Mittel. „Prüft“ ist genannt, aber Alltagswörter wie „stimmt das so?“ fehlen. |
| set_intent / set_duration / confirm_role / describe_body | nicht angetestet (keine Aufgabe) | — |

## Welche Formulierungen fehlen (Nachschärfvorschläge)

Diese Vorschläge richten sich an die Leitung — der Katalog gehört nicht mir. Jede
Erweiterung ist ein Satz, der die Alltagssprache des Nutzers aufnimmt:

1. **undo**: „… zurück“ erweitern um „nimmt den letzten Schritt zurück (macht ihn
   rückgängig), z. B. wenn eine Änderung dem Menschen nicht gefällt.“
2. **look**: „Ansichten (front/side/quarter/top)“ erweitern um „— front = von
   vorn, side = von der Seite. Zeigt, wie die Figur in den gewählten Frames
   aussieht, ohne etwas zu prüfen.“
3. **validate**: am Anfang ergänzen „Beantwortet die Frage, ob die gesamte
   Timeline in Ordnung ist“.
4. **probe_joint**: „Beugt“ ergänzen um „(biegt), um zu sehen, was passiert“.
5. **add_phase**: „Bewegungsphase anlegen“ ergänzen um ein Beispiel in
   Bewegungssprache, z. B. „z. B. ein Schrittes nach links als Phase `step`“.

## Grenzen des Messinstruments

Ehrlich benannt:

- Die Entscheidungen hat die ausführende Sitzung getroffen — dieselbe Sitzung, die
  den Katalogtext gelesen hat. Das ist ein Bias in Richtung der eigenen Wahl; ein
  fremder Agent könnte anders wählen. Das Instrument misst Trennschärfe des
  Wortlauts, nicht ein echtes Agentenkollektiv.
- Die Wortabdeckung ist grob (Stammbildung, keine Synonyme). Ihre 0-%-Werte sind
  ein Schwäche-Hinweis, kein Fehlerbeweis — die Auswahlentscheidung war trotzdem
  in allen sieben Fällen korrekt.
- Kein Test besteht automatisch: Der Strohmann wirft bei falscher Freigabe, die
  kaputte Bewertungsvariante (`WAHLEN_NEGATIV`) rotiert bewusst auf den
  zweitplatzierten Kandidaten und muss rot werden, und eine leere Frage liefert
  bewusst keine Entscheidung.

## Messwerte im Klartext

- 16 Werkzeuge im Katalog, alle einzigartig benannt.
- 7/7 richtig gewählt (5/5 Standard — Abnahmekriterium erfüllt).
- 2/2 schwere Verwechslungsfälle richtig getrennt.
- Wortabdeckung: 2 von 7 Aufgaben über 40 %, 5 von 7 bei 0 %.

## Nach der Nachschärfung

Nachgetragen am 31.08.2026. Der nachgeschärfte Katalogtext steht in
`src/tools/catalog.js`, wortgleich in `src/ui/WERKZEUGE.md`. Nur Beschreibungen
wurden geändert; Namen, Parameter, Schemata und Logik sind unangetastet.

**Auswahl bleibt 7 von 7 richtig**, beide schweren Fälle (set_target, validate)
erneut korrekt getrennt.

**Wortabdeckung vorher → nachher** (Anteil der Frage-Kernwörter in
name+description des richtigen Werkzeugs):

| Aufgabe | vorher | nachher | neu getroffene Wörter (Auszug) |
|---|---|---|---|
| A1 (describe_world) | 50 % | 50 % | unverändert |
| A2 (add_phase) | 0 % | 33 % | einen, schritt, nach, links |
| A3 (set_target) | 43 % | 71 % | bein, soll |
| A4 (validate) | 0 % | 40 % | zeig, ordnung |
| A5 (undo) | 0 % | 100 % | gefaellt, mach, rueckgaengig |
| A6 (look) | 0 % | 60 % | vorn, seite, aussieht |
| A7 (probe_joint) | 0 % | 57 % | bieg, kurz, sehe, passiert |

Summiert: vorher 93 %-Punkte (2 von 7 Aufgaben über 40 %, 5 bei 0 %), nachher
411 %-Punkte (alle 7 Aufgaben über 0 %, 5 von 7 über 40 %).

Weiter fehlen und warum (Instrument misst Stämme, keine Synonyme):

- A2: „lass“, „grob“ — Tonfall, nicht Bewegungssemantik; „machen“ trifft nicht,
  weil die Beschreibung „Legt … an“ statt „macht“ sagt.
- A3: „hoehe“ — Meter vs. Höhe ist Einheitensprache, die Aufgabe nennt „0,35 m“.
- A4: „insgesamt“, „alles“, „aussieht“ — validate sagt „gesamte Timeline“;
  „gesamte“ teilt keinen Stamm mit „insgesamt“/„alles“.
- A6: „zeil“ (Tippfehler in der Frage für „zeig“), „gerade“ — Füllwort.
- A7: „linke“, „hueftgelenk“ — seitenspezifisch; die Beschreibung nennt
  „Hüft- oder Kniegelenk“ als Bezeichnung mit Bindestrich, der Stamm „hueft“
  teilt sich mit „hueftgelenk“ nicht (Stammbildungsgrenze des Instruments).

`node --test "src/**/*.test.mjs"`: zum Zeitpunkt der Messung 59 von 59 grün, im
endgültigen Abnahmelauf am ruhenden Baum 251 von 251 grün (andere Arbeitspakete
liefen parallel und haben die Testzahl erhöht; alle grün). `npm test`: 263 + 13
grün, 0 Fehlschläge. Prüfstand `spikes/test-a3-load/pruefstand.test.mjs`:
8 von 8 grün. Alle 16 Werkzeuge weiterhin über `getTools()` sichtbar.

Hinweis zur Messsituation: Während der Nachschärfung liefen weitere
Arbeitspakete parallel im selben Repository (schreibend in `src/rig/`,
`src/validate/`, `src/tools/`). Der Abnahmeläufe wurden deshalb erst nach
Ende dieser Schreibzugriffe am ruhenden Baum wiederholt; die obigen Zahlen
stammen aus diesen Läufen. Drei npm-test-Zwischenläufe, die in die
Parallelarbeit hinein fielen, zeigten 1 bis 7 Fehlschläge — alle ausschließlich
in fremden Dateien (`rig/detect`, `rig/measure`, `validate/intent`,
`tools/ports`), keiner im geänderten Katalog.

## Dateien dieses Pakets

- `aufgaben.mjs` — die sieben Aufgaben mit richtiger Antwort und Konfliktangabe
- `auswahl.mjs` — aufgezeichnete Entscheidungen mit Begründung
- `abdeckung.mjs` — Wortabdeckung (Stammbildung, Umlaut-Normalform)
- `bewerte.mjs` — Bewertungsschicht + absichtlich kaputte Variante (`WAHLEN_NEGATIV`)
- `strohmann.mjs` — Werkzeug-Aufruf-Falle für falsche Freigaben
- `pruefstand.test.mjs` — der Test: 8 Tests, alle grün, alle Negativfälle rot-fähig
- `waehle.mjs`, `strohmann.mjs` — Reste der ersten, rein mechanischen Auswertung.
  `waehle.mjs` ist überholt (Schlagwort-Scoring, kein Agent), bleibt aber als
  Beispiel für den Fehlschlag „Werkzeugwahl per Schwellwort“ im Verzeichnis.