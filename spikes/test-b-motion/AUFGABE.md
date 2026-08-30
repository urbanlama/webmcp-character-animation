# Aufgabe: Baue eine Animation

Du steuerst eine 3D-Szene über die Kommandozeile. Darin steht eine menschliche
Figur auf einem ebenen Boden. Du sollst sie animieren.

**Wichtig: Lies keinen Quellcode dieses Ordners.** Weder `index.html` noch `rig.js`,
`validators.js` oder `calibrate.js`. Arbeite ausschließlich mit den Werkzeugen.
Es wird getestet, ob die Werkzeuge allein ausreichen — nicht, ob du dich in fremdem
Code zurechtfindest.

## Werkzeuge

Alle Aufrufe laufen aus diesem Ordner:

```
node tool.mjs help
```

Fang damit an. Danach empfehlen sich:

```
node tool.mjs describe_rig      # Gelenke, Freiheitsgrade, Grenzwerte, Weltkonventionen
node tool.mjs probe_joints      # zeigt, wohin +20 Grad an jedem Gelenk wirken
node tool.mjs body_profile      # Maße, Massenverteilung, Fußsohlen
```

## Wie du arbeitest

Setze Keyframes, prüfe, korrigiere:

```
node tool.mjs set_timeline 60
node tool.mjs set_key 0 '{"knee_l":{"bend":20}}' '{"y":-0.05}'
node tool.mjs validate
```

`validate` gibt dir jeden Verstoß mit Frame-Nummer, Messwert in Zentimetern und
einem Korrekturhinweis. Das ist deine wichtigste Rückmeldung — genauer als jedes Bild.

Bilder bekommst du zusätzlich:

```
node tool.mjs render 0,10,20,30,40,50 side
```

Das schreibt eine PNG-Datei nach `shots/`. Lies sie mit deinem Bildwerkzeug an.
Nutze mehrere Ansichten (`side`, `front`, `quarter`), um räumlich zu urteilen.

Für Sprünge hilft:

```
node tool.mjs flight 20 40 '{"vy":4.5,"vz":1.2}'
```

Das rechnet dir die ballistische Flugbahn der Wurzel aus — Scheitelhöhe, Dauer und
die y/z-Werte pro Frame. Es setzt nichts, du musst die Werte selbst als Keyframes
eintragen.

## Der Auftrag

Baue **einen Rückwärtssalto aus dem Stand**:

1. Die Figur steht ruhig.
2. Sie geht in die Hocke und holt mit den Armen aus.
3. Sie springt ab und dreht sich rückwärts um die eigene Querachse — eine volle
   Umdrehung, 360 Grad.
4. Sie landet auf den Füßen und fängt sich ab.

## Wann du fertig bist

Zwei Bedingungen, beide müssen erfüllt sein:

**Erstens, messbar:** `validate` meldet null Verstöße — oder du kannst für jeden
verbleibenden Verstoß begründen, warum er kein echter Fehler ist.

**Zweitens, sichtbar:** Die Bewegung sieht auf den gerenderten Bildern wie ein
Rückwärtssalto aus. Es gibt tatsächlich eine Flugphase, die Drehung findet statt,
und die Figur landet aufrecht.

## Was am Ende zu berichten ist

- Wie viele Werkzeugaufrufe hast du insgesamt gebraucht?
- Wie viele Runden aus Bauen, Prüfen und Korrigieren?
- Was hat dir gefehlt? Welche Rückmeldung hättest du gebraucht, die es nicht gab?
- Wo warst du unsicher, obwohl du Zahlen hattest?

Diese vier Antworten sind wichtiger als ein perfektes Ergebnis. Sei ehrlich,
auch wenn es nicht geklappt hat.
