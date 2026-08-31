# tests/_wip/

Zeigt, dass der Runner selbst nachweisbar rotmarkiert — ohne dass eine dauerhaft
kaputte Test-Datei im Discovery-Pfad liegen muss.

**Warum hier nichts liegt:** Der Nachweis, dass `npm test` bei einem
fehlschlagenden Test mit Fehlercode endet, wird vom **Selbsttest des Runners**
erbracht: `tests/run.mjs` nimmt eine absichtlich fehlschlagende In-Memory-
Prüfung, führt sie durch denselben Mechanismus wie jede echte Test-Datei und
bricht ab, falls sie wider Erwarten **nicht** fehlschlägt. Der Selbsttest
erscheint in der Ergebnis-Übersicht als eigener Test mit Namen.

Eine Datei `tests/attempt.test.mjs` lag dem Auftrag zufolge evtl. vor; sie lag
zum Zeitpunkt der Erstellung dieses Verzeichnisses **nicht** im Repo. Sie wird
bewusst nicht angelegt — eine dauerhaft rote Datei im Discovery-Pfad würde jede
spätere Ausführung von `npm test` scheitern lassen, auch wenn alle echten Tests
grün sind. Der Runner-Selbsttest deckt dieselbe Aussage ab, ohne den
Discovery-Pfad zu versauen. Sollte eine solche Datei später auftauchen, gehört
sie hierher (außerhalb des Discovery-Pfads), nicht nach `tests/`.