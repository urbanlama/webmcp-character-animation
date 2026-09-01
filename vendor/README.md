# vendor/

Drittanbieter-Bibliotheken, fest eingecheckt. Der Produkt-Code lädt sie direkt
von hier — im Browser über die Import Map in `index.html`, in Node über `three`
aus `node_modules` (identische Builds, siehe Tabelle). Keine Version per npm
im Browser-Pfad; die hier liegenden Dateien sind die, gegen die entwickelt und
geprüft wird.

**Ordnerstruktur.** `vendor/` spiegelt die Addon-Struktur von three
(`examples/jsm/`). Die Import Map zeigt `'three/addons/'` auf `'/vendor/'`,
ein Import `'three/addons/loaders/GLTFLoader.js'` löst also auf
`/vendor/loaders/GLTFLoader.js` auf. Genau diese Übereinstimmung war am
2026-08-30 die Wurzel eines Browser-Fehlers: die Dateien lagen flach unter
`vendor/`, die Auflösung erwartete `vendor/loaders/` — der Abruf endete mit
404, das Seitenmodul lief nie an, und die Datei-Auswahl tat sichtbar nichts.
Wer hier eine Datei ablegt, legt sie unter dem Pfad ab, den der Import erwartet.

| Datei | Quelle | Version | Zweck |
|---|---|---|---|
| `three.module.min.js` | three.js, https://github.com/mrdoob/three.js — MIT-Lizenz, Copyright © 2010-2025 Three.js Authors | r180 (laut `REVISION` nach Import) | Die three-Bibliothek. Importiert selbst aus `./three.core.min.js` |
| `three.core.min.js` | three.js, derselbe Build wie oben — MIT-Lizenz | r180 | Kern von three (Mathematik, Geometrie, Objekthierarchie), ohne Renderer-Teile |
| `loaders/GLTFLoader.js` | three.js, `examples/jsm/loaders/GLTFLoader.js` — MIT-Lizenz | r180 | Lädt glTF/GLB. Importiert `'three'` (Browser: Import Map) und `../utils/BufferGeometryUtils.js` |
| `exporters/GLTFExporter.js` | three.js, `examples/jsm/exporters/GLTFExporter.js` — MIT-Lizenz, Copyright © 2010-2025 Three.js Authors | r180 | Schreibt glTF/GLB mit Animationen (AP-Export). Importiert nur `'three'`; serialisiert über Blob/FileReader, deshalb läuft er in Node nur mit der FileReader-Decke aus `src/export/gltf.js` |
| `controls/OrbitControls.js` | three.js, `examples/jsm/controls/OrbitControls.js` — MIT-Lizenz, Copyright © 2010-2025 Three.js Authors | r180 | Kamerasteuerung mit der Maus: Ziehen dreht, Rad faehrt heran, rechte Taste verschiebt. Importiert nur `'three'`; `src/ui/kamerasteuerung.js` haengt sie an die Leinwand |
| `utils/BufferGeometryUtils.js` | three.js, `examples/jsm/utils/BufferGeometryUtils.js` — MIT-Lizenz | r180 | Liefert `toTrianglesDrawMode`, den `loaders/GLTFLoader.js` über den relativen Pfad `../utils/BufferGeometryUtils.js` importiert |

Identität der Kopien mit `node_modules/three` 0.180.0, gemessen an der
SHA-256 (Stand 2026-08-30):

- `loaders/GLTFLoader.js` = `examples/jsm/loaders/GLTFLoader.js`
  = `67ac5551fdfa6e349bd80c8f8e5e39c136d6b2fb1ad647db9abb21dc86f9e4a`
- `utils/BufferGeometryUtils.js` = `examples/jsm/utils/BufferGeometryUtils.js`
  = `fda7e946b8e0b5ab39b779206589e7a1079a22eb24efb89d7223e03fdfb1f751`
- `exporters/GLTFExporter.js` = `examples/jsm/exporters/GLTFExporter.js`
  = `e7c29444454eb321b39e4c8b3062944f4fd5299a0e7483e9cb8c0594cdec829f`
  (Stand 2026-08-31, ergänzt für AP-Export)
- `controls/OrbitControls.js` = `examples/jsm/controls/OrbitControls.js`
  = `b97879c748170baadeb3fb84cea1ffdf4674e283dc06042f34e2acb95a76042c`
  (Stand 2026-08-31, ergänzt für die Kamerasteuerung. Node-Tests importieren
  `three/addons/controls/OrbitControls.js` aus `node_modules`, der Browser
  dieselbe Datei aus `vendor/controls/` — beide Seiten prüfen denselben Code.)

Damit ist die Node-Seite jedes Tests (Loader aus `node_modules`) und die
Browser-Seite (Loader aus `vendor/`) derselbe Code — Knochenzahlen und
Bounding Boxen stammen aus ein und derselben Quelle.

Herkunft der Kopien: `spikes/test-b-motion/assets/` bzw. `spikes/test-b-motion/utils/`.
Dort wurden sie für den Vorabtest benutzt; der Produkt-Code bezieht sie ab jetzt
nur noch von hier. Der relative Import in `GLTFLoader.js` ist unverändert.
