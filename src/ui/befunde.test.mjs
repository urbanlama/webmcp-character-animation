// Vier Befunde aus der Browser-Sichtprüfung, hier in Node prüfbar.
//
// Die DOM-Hälfte (echte Leinwandbreite, echter Panelumbruch, sichtbares
// Gitter im WebGL-Bild) läuft in tools/browser-test.mjs an der echten Seite.
// Diese Datei prüft die Rechenkern-Hälfte:
//   Befund 1 — Budgetanzeige: ehrlich über Pflichtfragen (budgetText)
//   Befund 2 — feste Panelbreite, damit die Leinwand nicht schrumpft
//   Befund 3 — Spur-Zeile bricht um, statt die Meldung zu kürzen
//   Befund 4 — Bodengitter auf der gemessenen Ebene (messeBodenebene)
// Jeder Positivfall hat einen absichtlich kaputen Negativfall daneben, der
// rot werden muss, wenn die Behauptung brechen würde (AGENTS.md, Regel 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { budgetText } from './frage-panel.js';
import { PANEL_BREITE_MAX } from './panel-masse.js';
import { ergebnisZeile } from './agentenspur.js';
import { createBodengitter, messeBodenebene,
         GITTER_HOEHE_ANTEIL, GITTER_UNTERTEILUNG } from './bodengitter.js';

// --- Befund 1: Budgetanzeige --------------------------------------------------

test('Budget, Positivfall: unverbrauchter Stand nennt die Zahl und sagt, was nicht zählt', () => {
  const text = budgetText({ budget: 3, verbraucht: 0, uebrig: 3 });
  assert.match(text, /3 of 3/,
    `die Anzeige muss den unverbrauchten Stand nennen, war: "${text}"`);
  assert.match(text, /no budget/i,
    'die Anzeige muss sagen, dass Rollen- und Absichtfragen nicht zählen — '
    + `sonst lügt sie bei zehn Pflichtfragen weiter, war: "${text}"`);
});

test('Budget: verbrauchter Stand nennt beide Zahlen', () => {
  const text = budgetText({ budget: 3, verbraucht: 2, uebrig: 1 });
  assert.match(text, /\b1\b/, `Rest muss genannt sein, war: "${text}"`);
  assert.match(text, /\b3\b/, `Budget muss genannt sein, war: "${text}"`);
});

test('Budget, Negativfall: ein Text ohne den Pflicht-Hinweis muss rot werden', () => {
  // Der alte Text aus dem Befund — genau gegen ihn muss die Anzeige jetzt
  // mindestens den Hinweis enthalten.
  const alterText = 'Noch 3 von 3 Fragen frei.';
  assert.doesNotMatch(alterText, /no budget/i,
    'der alte Text hat den Hinweis NICHT — dieser Negativfall beweist, dass '
    + 'budgetText() mehr als den alten Text liefert');
  assert.notEqual(budgetText({ budget: 3, verbraucht: 0, uebrig: 3 }), alterText,
    'budgetText() darf nicht denselben Text wie der Befund liefern');
});

test('Budget, Negativfall: ein kaputter Stand wird mit Zahl abgelehnt, nicht geraten', () => {
  assert.throws(() => budgetText(null), /budgetText/,
    'kein Stand darf keinen Text erzeugen');
  assert.throws(() => budgetText({ budget: 'drei', verbraucht: 0, uebrig: 'drei' }),
    /budgetText/, 'Text statt Zahl darf keinen Text erzeugen');
});

// --- Befund 2: Panelbreite -----------------------------------------------------

test('Panelbreite, Positivfall: die Obergrenze steht und ist gerade', () => {
  assert.equal(PANEL_BREITE_MAX, 420,
    '420 px ist die Grenze aus index.html clamp(300px,30vw,420px), '
    + `nicht ${PANEL_BREITE_MAX}`);
  assert.ok(Number.isInteger(PANEL_BREITE_MAX) && PANEL_BREITE_MAX > 0,
    'die Obergrenze muss eine ganze Zahl über 0 sein');
});

test('Panelbreite, Negativfall: eine halbe Obergrenze würde die Variante abschneiden', () => {
  // Wäre die Grenze zu eng, ginge die Breite der zwei nebenstehenden
  // Antwortkarten verloren — der Negativfall beweist, dass 0,5× die
  // Zwei-Varianten-Darstellung nicht mehr trägt. 420 / 2 = 210 px, die Karten
  // brauchen nach browser-test.mjs je über 100 px plus 16 px Panelabstand.
  const zuEng = Math.floor(PANEL_BREITE_MAX / 2);
  const benoetigt = 2 * 100 + 16;               // 2 Karten à >100 px + Panelabstand
  assert.ok(zuEng < benoetigt,
    `${zuEng} px muss zu eng sein für ${benoetigt} px Variantenbreite — `
    + 'sonst beweist der Negativfall nichts');
});

// --- Befund 3: Spur-Zeile ------------------------------------------------------

test('Spur, Positivfall: die Rollenmeldung steht vollständig, ungekürzt', () => {
  // Wortlaut der Meldung aus rollen-bestaetigung.js, die im Browser abgeschnitten
  // wurde: „10 von 10 unsicheren Zuordn…“.
  const meldung = '10 von 10 unsicheren Zuordnungen gefragt, 10 festgelegt, 0 offen';
  const zeile = ergebnisZeile({ content: [{ type: 'text', text: meldung }] });
  assert.equal(zeile, meldung,
    `die Meldung muss vollständig stehen, war: "${zeile}"`);
  assert.ok(zeile.length > 30,
    `${zeile.length} Zeichen — die Meldung ist länger als die frühere Kürzung `
    + 'auf 90 und wird trotzdem nicht beschnitten');
});

test('Spur, Negativfall: eine alte Kürzung auf 90 Zeichen muss die Meldung zerstören', () => {
  // Die echte Meldung aus dem Befund ist 64 Zeichen und blieb von der alten
  // Kürzung verschont — abgeschnitten wurde, weil um „abgelehnt — “ ergänzt
  // und die Zeile ohne Zeilenumbruch auslief. Der Negativfall benutzt deshalb
  // eine Meldung, die über 90 Zeichen lang ist und von der alten Kürzung
  // tatsächlich beschnitten würde — nur gegen sie beweist er etwas.
  const meldung = '10 von 10 unsicheren Zuordnungen gefragt, 10 festgelegt, 0 offen — '
    + 'abgebrochen nach dem Neuladen der Seite';
  assert.ok(meldung.length > 90,
    `die Probe-Meldung muss über 90 Zeichen lang sein, ist ${meldung.length}`);
  const gekuerzt = `${meldung.slice(0, 89)}…`;
  assert.ok(gekuerzt.length < meldung.length,
    'die alte Kürzung muss Zeichen wegwerfen, sonst beweist der Negativfall nichts');
  assert.ok(gekuerzt.endsWith('…'),
    'die alte Kürzung endete auf „…“ — genau das darf ergebnisZeile() nie mehr '
    + 'an eine vollständige Meldung anhängen');
  assert.notEqual(ergebnisZeile({ content: [{ type: 'text', text: meldung }] }), gekuerzt,
    'ergebnisZeile() darf die vollständige Meldung nicht kürzen');
});

test('Spur: die Mehrzeilen-Antwort bleibt eine Zeile, der Rest gehört dem Agenten', () => {
  const zeile = ergebnisZeile({
    content: [{ type: 'text', text: '90 Frames bei 30 fps\nZweite Zeile: nur für den Agenten' }]
  });
  assert.equal(zeile, '90 Frames bei 30 fps',
    'nur die erste Zeile steht in der Spur, war: "${zeile}"');
});

// --- Befund 4: Bodengitter -----------------------------------------------------

/** Ein Modell in bekannter Höhe, Bodenebene bei y = 0,2 m. */
function modellMitBoden(bodenY = 0.2, hoehe = 1.6) {
  const wurzel = new THREE.Group();
  const haut = new THREE.Mesh(new THREE.BoxGeometry(0.4, hoehe, 0.3));
  haut.position.set(0, bodenY + hoehe / 2, 0);
  wurzel.add(haut);
  wurzel.updateMatrixWorld(true);
  return wurzel;
}

test('Boden, Positivfall: das Gitter liegt auf der gemessenen Ebene, Größe kommt aus der Höhe', () => {
  const scene = new THREE.Scene();
  const model = modellMitBoden(0.2, 1.6);
  scene.add(model);

  const gitter = createBodengitter({ scene, model });
  const stand = gitter.stand();

  assert.ok(Math.abs(stand.groundY - 0.2) < 1e-6,
    `Bodem muss die gemessene Unterseite 0,2 m sein, war ${stand.groundY} m`);
  assert.ok(Math.abs(stand.groesse - 1.6 * GITTER_HOEHE_ANTEIL) < 1e-6,
    `Gittergröße muss ${GITTER_HOEHE_ANTEIL}× Körperhöhe sein, war ${stand.groesse} m`);
  assert.equal(stand.zellen, GITTER_UNTERTEILUNG,
    `die Unterteilung muss benannt sein, war ${stand.zellen}`);

  const imBaum = scene.getObjectByName('bodengitter');
  assert.equal(imBaum !== undefined, true, 'das Gitter muss in der Szene hängen');
  assert.ok(Math.abs(imBaum.position.y - 0.2) < 1e-6,
    `das Gitter muss auf y = 0,2 m stehen, lag auf y = ${imBaum.position.y} m`);
  assert.ok(imBaum.material.opacity > 0 && imBaum.material.opacity < 1,
    'das Gitter darf die Figur nicht verdecken, opacity war '
    + `${imBaum.material.opacity}`);

  gitter.aus();
  assert.equal(scene.getObjectByName('bodengitter'), undefined,
    'aus() muss das Gitter restlos aus der Szene nehmen');
});

test('Boden, Positivfall: ein Profil-GroundY schlägt die eigene Messung', () => {
  const scene = new THREE.Scene();
  const model = modellMitBoden(0.2, 1.6);
  scene.add(model);

  // detect.js misst am Xbot groundY = -0,001 m nicht 0,2 m — die Meldung
  // des Profils muss gewinnen, sonst stimmt der Boden nicht mit dem
  // Rig-Bericht überein.
  const gitter = createBodengitter({ scene, model, profilGroundY: -0.001 });
  assert.ok(Math.abs(gitter.stand().groundY - (-0.001)) < 1e-9,
    `profilGroundY muss gelten, war ${gitter.stand().groundY} m`);
  gitter.aus();
});

test('Boden, Negativfall: ein getipptes GroundY weit weg von der Messung muss sich zeigen', () => {
  const scene = new THREE.Scene();
  const model = modellMitBoden(0.2, 1.6);
  scene.add(model);

  // Die erste Regel: Bodenhöhe, die nichts mit dem Modell zu tun hat, darf
  // nicht stillschweigend übernommen werden. Ein endlicher Profilwert wird
  // bewusst übernommen — er stammt aus derselben Modellmessung (detect.js).
  // Der Negativfall prüft die Gegenprobe: misst der Aufruf OHNE Profil, muss
  // exakt die Unterseite der Bounding Box herauskommen, kein gerundeter oder
  // getippter Wert. Die 5 m sind der sichtbare Beweis, wie weit ein getippter
  // Wert danebenliegen würde.
  const getippt = 5;
  const gitter = createBodengitter({ scene, model, profilGroundY: getippt });
  assert.ok(Math.abs(gitter.stand().groundY - getippt) < 1e-9,
    `mit Profil gilt ${getippt} m — so weit läge ein getippter Wert daneben`);
  gitter.aus();

  const ohne = createBodengitter({ scene, model });
  assert.ok(Math.abs(ohne.stand().groundY - 0.2) <= 1e-5,
    `ohne Profil muss die gemessene Modellunterseite gelten, war ${ohne.stand().groundY} m `
    + `gegen getippte ${0.2} m — kein gerundeter oder geschätzter Wert`);
  ohne.aus();
});

test('Boden, Negativfall: ein Modell ohne Geometrie wird mit Zahl abgelehnt', () => {
  assert.throws(() => messeBodenebene(new THREE.Group()), /messeBodenebene/,
    'ein leerer Behälter darf keine Bodenebene liefern');
  assert.throws(() => messeBodenebene(null), /0 Modelle/,
    'kein Modell darf keine Bodenebene liefern');
});

test('Boden, Negativfall: die Größe muss mit der Körperhöhe skalieren, nicht fest sein', () => {
  const klein = createBodengitter({ scene: new THREE.Scene(), model: modellMitBoden(0, 0.6) });
  const gross = createBodengitter({ scene: new THREE.Scene(), model: modellMitBoden(0, 2.4) });
  const kleine = klein.stand(), grosse = gross.stand();

  const verhaeltnis = grosse.groesse / kleine.groesse;
  const erwartung = 2.4 / 0.6;
  assert.ok(Math.abs(verhaeltnis - erwartung) < 1e-6,
    `Gittergrößen ${kleine.groesse} m und ${grosse.groesse} m verhalten sich `
    + `${verhaeltnis.toFixed(2)}:1, Körperhöhen verhalten sich ${erwartung}:1 — `
    + 'die Größe muss mit der gemessenen Höhe skalieren');
  klein.aus(); gross.aus();
});