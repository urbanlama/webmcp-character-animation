// Zwei Anzeigen, die in Node prüfbar sind:
//   - das Leuchten des fraglichen Knochens (plan.md 6.7, Moment 1)
//   - die Hülle um document.modelContext, die die Agentenspur speist
// Die DOM-Hälfte beider prüft tools/browser-test.mjs an der echten Seite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createKnochenLeuchten, MARKER_ANTEIL } from './knochen-leuchten.js';
import { spurKontext } from './agentenspur.js';

/** Ein Skelett aus zwei Knochen in bekannter Höhe — keine Datei nötig. */
function modellMitKnochen() {
  const wurzel = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.set(0, 1.0, 0);
  const fussL = new THREE.Bone(); fussL.name = 'mixamorigLeftFoot'; fussL.position.set(0.1, -0.9, 0);
  hips.add(fussL);
  wurzel.add(hips);
  // Ein Mesh gibt der Bounding Box eine messbare Höhe: 0 bis 1,8 m.
  const haut = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3));
  haut.position.set(0, 0.9, 0);
  wurzel.add(haut);
  wurzel.updateMatrixWorld(true);
  return wurzel;
}

test('Leuchten, Positivfall: der fragliche Knochen bekommt einen Marker an seiner Weltposition', () => {
  const scene = new THREE.Scene();
  const model = modellMitKnochen();
  scene.add(model);
  const leuchten = createKnochenLeuchten({ scene, model });

  const befund = leuchten.zeige([
    { bone: 'mixamorigLeftFoot', marke: '1' },
    { bone: 'mixamorigHips', marke: '2' }
  ]);

  assert.equal(befund.gezeigt, 2, `2 Marker erwartet, ${befund.gezeigt} gesetzt`);
  assert.deepEqual(befund.fehlend, [], `0 fehlende Knochen erwartet: ${befund.fehlend.join(', ')}`);
  assert.deepEqual(leuchten.stand(), ['mixamorigLeftFoot', 'mixamorigHips']);

  const gruppe = scene.getObjectByName('knochen-leuchten');
  const marker = gruppe.children.find((k) => k.userData.bone === 'mixamorigLeftFoot');
  const erwartet = new THREE.Vector3();
  model.getObjectByName('mixamorigLeftFoot').getWorldPosition(erwartet);
  assert.ok(marker.position.distanceTo(erwartet) < 1e-6,
    `der Marker muss auf dem Knochen sitzen, Abstand ${marker.position.distanceTo(erwartet)} m`);

  // Größe relativ zur Körperhöhe, nicht in getippten Metern (AGENTS.md, Regel 1).
  const radius = marker.geometry.parameters.radius;
  assert.ok(Math.abs(radius - 1.8 * MARKER_ANTEIL) < 1e-6,
    `Radius muss ${MARKER_ANTEIL} der 1,80 m Modellhöhe sein, war ${radius} m`);
});

test('Leuchten, Negativfall: ein unbekannter Knochenname wird gemeldet, nicht stillschweigend übergangen', () => {
  const scene = new THREE.Scene();
  const model = modellMitKnochen();
  scene.add(model);
  const leuchten = createKnochenLeuchten({ scene, model });

  const befund = leuchten.zeige([
    { bone: 'mixamorigLeftFoot', marke: '1' },
    { bone: 'gibtEsNicht', marke: '2' }
  ]);

  assert.equal(befund.gezeigt, 1, `1 Marker erwartet, ${befund.gezeigt} gesetzt`);
  assert.deepEqual(befund.fehlend, ['gibtEsNicht'],
    'der fehlende Knochen muss beim Namen genannt werden');
});

test('Leuchten: aus() räumt restlos ab, das Modell bleibt unberührt', () => {
  const scene = new THREE.Scene();
  const model = modellMitKnochen();
  scene.add(model);
  const kinderVorher = model.children.length;
  const leuchten = createKnochenLeuchten({ scene, model });

  leuchten.zeige([{ bone: 'mixamorigHips', marke: '1' }]);
  assert.equal(leuchten.stand().length, 1);

  leuchten.aus();
  assert.equal(leuchten.stand().length, 0, 'nach aus() leuchtet 0 Knochen');
  assert.equal(scene.getObjectByName('knochen-leuchten').children.length, 0,
    'die Gruppe muss leer sein, nicht nur unsichtbar');
  assert.equal(model.children.length, kinderVorher,
    `das Modell muss seine ${kinderVorher} Kinder behalten`);

  leuchten.abmelden();
  assert.equal(scene.getObjectByName('knochen-leuchten'), undefined,
    'abmelden() hängt die Gruppe aus der Szene');
});

test('Leuchten: der Indexzusatz aus detect.js („name#0“) findet denselben Knochen', () => {
  const scene = new THREE.Scene();
  const model = modellMitKnochen();
  scene.add(model);
  const leuchten = createKnochenLeuchten({ scene, model });

  const befund = leuchten.zeige([{ bone: 'mixamorigHips#0', marke: '1' }]);
  assert.equal(befund.gezeigt, 1,
    `der Indexzusatz darf nicht zu 0 Markern führen, fehlend: ${befund.fehlend.join(', ')}`);
});

/** Attrappe von document.modelContext, Methoden am Prototyp wie bei einer
 * echten Umsetzung — ein {...kontext} wäre dort leer. */
class KontextAttrappe {
  constructor() { this.registriert = []; }
  async registerTool(w) { this.registriert.push(w); }
  getTools() { return this.registriert.slice(); }
}

test('Spur, Positivfall: jeder Werkzeugaufruf wird mit Name und Ergebnis gemeldet', async () => {
  const echt = new KontextAttrappe();
  const gemeldet = [];
  const huelle = spurKontext(echt, { notiere: (e) => gemeldet.push(e) });

  await huelle.registerTool({
    name: 'set_duration',
    description: 'Setzt die Gesamtlänge.',
    inputSchema: { type: 'object', properties: {} },
    async execute() { return { content: [{ type: 'text', text: '90 Frames bei 30 fps\nZweite Zeile' }] }; }
  });

  assert.equal(echt.registriert.length, 1, 'die Hülle muss genau 1 Werkzeug durchreichen');
  assert.equal(echt.registriert[0].name, 'set_duration', 'der Name bleibt unverändert');
  assert.equal(echt.registriert[0].description, 'Setzt die Gesamtlänge.',
    'die Beschreibung bleibt unverändert — sie ist das Handbuch des Agenten');

  const antwort = await echt.registriert[0].execute({ frameCount: 90 });
  assert.equal(antwort.content[0].text.split('\n')[0], '90 Frames bei 30 fps',
    'die Antwort an den Agenten bleibt unverändert');

  assert.equal(gemeldet.length, 1, `1 Meldung erwartet, ${gemeldet.length} bekommen`);
  assert.equal(gemeldet[0].name, 'set_duration');
  assert.equal(gemeldet[0].fehler, false);
  assert.equal(gemeldet[0].text, '90 Frames bei 30 fps',
    'die Spur zeigt eine Zeile, nicht die ganze Antwort');
  assert.ok(gemeldet[0].dauerMs >= 0, `die Dauer muss eine Zahl sein, war ${gemeldet[0].dauerMs}`);
});

test('Spur, Negativfall: eine abgelehnte Antwort wird als Fehler geführt, ohne den Aufruf zu verändern', async () => {
  const echt = new KontextAttrappe();
  const gemeldet = [];
  const huelle = spurKontext(echt, { notiere: (e) => gemeldet.push(e) });

  await huelle.registerTool({
    name: 'add_phase',
    description: 'Fügt eine Phase ein.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return { isError: true, content: [{ type: 'text', text: 'Frame 97 liegt außerhalb von 0 bis 90' }] };
    }
  });

  const antwort = await echt.registriert[0].execute({});
  assert.equal(antwort.isError, true, 'der Fehler muss unverändert beim Agenten ankommen');
  assert.equal(gemeldet.length, 1);
  assert.equal(gemeldet[0].fehler, true, 'die Spur muss den Fehlschlag als solchen führen');
  assert.match(gemeldet[0].text, /\d/, 'die gezeigte Zeile nennt eine Zahl (AGENTS.md)');
});

test('Spur: eine geworfene Ausnahme wird gemeldet und trotzdem weitergereicht', async () => {
  const echt = new KontextAttrappe();
  const gemeldet = [];
  const huelle = spurKontext(echt, { notiere: (e) => gemeldet.push(e) });

  await huelle.registerTool({
    name: 'export_clip', description: 'Exportiert.', inputSchema: {},
    async execute() { throw new Error('0 Exporter angeschlossen'); }
  });

  await assert.rejects(() => echt.registriert[0].execute({}), /0 Exporter/,
    'die Hülle darf keine Ausnahme schlucken');
  assert.equal(gemeldet.length, 1);
  assert.equal(gemeldet[0].fehler, true);
});

test('Spur: Methoden am Prototyp überleben die Hülle', () => {
  const echt = new KontextAttrappe();
  const huelle = spurKontext(echt, { notiere: () => {} });
  assert.equal(typeof huelle.getTools, 'function',
    'getTools liegt am Prototyp und muss trotzdem durchgereicht werden');
  assert.deepEqual(huelle.getTools(), []);
  assert.throws(() => spurKontext(null, { notiere: () => {} }), /0 brauchbare modelContext/);
});
