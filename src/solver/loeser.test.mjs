// AP5 — Abnahmetest für den Phasenlöser (src/solver/).
//
// Fünf Abnahmereihen aus docs/umsetzung.md AP5, je mit Positiv- UND Negativfall
// (AGENTS.md Regel 2): crouch, takeoff, airborne, land, Konflikt.
//
// Geprüft wird gegen das GELADENE Modell, nicht gegen getippte Maße: Rig und
// Körperhöhe kommen aus src/rig/measure.js, alle Toleranzen stehen als Anteil
// der gemessenen Körperhöhe. Kein Referenzclip wird benutzt — AP5 erzeugt
// Bewegung, es lernt keine; die Hold-out-Trennung aus BRETT.md ist damit nicht
// berührt.
//
// Die Sprungzeiten sind nicht geraten, sondern aus der Ballistik gerechnet:
// zu einer Absprunggeschwindigkeit v gehört die Flugzeit 2·v/g. Wer die
// Flugphase länger macht, lässt die Figur tiefer fallen, als sie gesprungen
// ist — dann meldet `land` zu Recht einen Abfederkonflikt.
//
// Läuft ohne Browser: node --test "src/**/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert';

import { erfasseBind, baueSkeleton, sohlenWelt, qRot, vLen, vSub } from './kinematik.js';
import { bindPose, poseZuFk } from './ik.js';
import { loeseBewegung } from './loeser.js';
import { ladeXbot, xbotProfil } from '../rig/xbot-profil.mjs';
import {
  vermesseAusgangslage, pruefeReichweite, sohlenAnker,
  ANKER_GRENZE_ANTEIL, COM_ZIEL_ANTEIL,
} from './verben.js';

const FPS = 30;
const G = 9.81;

// ── Rig einmal laden; alle Tests lösen gegen dasselbe Skelett ───────────────
// Profil aus dem geteilten Cache (src/rig/xbot-profil.mjs): das unveraenderte
// Xbot-Profil wird einmal gemessen, nicht in jeder Testdatei neu.
const gltf = await ladeXbot();
const PROFIL = await xbotProfil();
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));
const H = SKEL.height;                       // gemessene Körperhöhe, Meter
const VORGANG = vermesseAusgangslage(SKEL);  // u. a. die haltbare Hocktiefe
const MAX_HOCKE = VORGANG.maxAbsenkung;      // Meter, gemessen

/** Löst eine Phasenliste; frameCount folgt der letzten Phase. */
function loese(phases, opts = {}) {
  const frameCount = Math.max(...phases.map((p) => p.to));
  return loeseBewegung(PROFIL, SKEL, { fps: FPS, frameCount, phases }, opts);
}

const comY = (f) => f.com[1];
const frameDer = (frames, id) => frames.filter((f) => f.phase === id);
/** Weg, den ein Knochen zwischen zwei Frames zurückgelegt hat (Meter). */
const knochenWeg = (a, b, id) => vLen(vSub(b.positions[id], a.positions[id]));
const FUSS_L = SKEL.rollenKnochen.foot_l;
const FUSS_R = SKEL.rollenKnochen.foot_r;

/** Jede Meldung im Bericht muss eine Zahl tragen (AGENTS.md, Handwerkliches). */
function meldungMitZahl(eintrag) {
  assert.ok(typeof eintrag.meldung === 'string' && eintrag.meldung.length > 0,
    `Konflikteintrag ohne Meldung: ${JSON.stringify(eintrag)}`);
  assert.match(eintrag.meldung, /\d/,
    `Meldung ohne Zahl: „${eintrag.meldung}"`);
  assert.ok(Number.isFinite(eintrag.betrag),
    `Konflikt „${eintrag.bedingung}" ohne endlichen Betrag: ${JSON.stringify(eintrag.betrag)}`);
  assert.ok(typeof eintrag.einheit === 'string' && eintrag.einheit.length > 0,
    `Konflikt „${eintrag.bedingung}" ohne Einheit`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 — crouch: Schwerpunkt sinkt um die verlangte Tiefe, Füße bleiben stehen
// ═══════════════════════════════════════════════════════════════════════════

test('crouch positiv: Schwerpunkt sinkt um die verlangte Tiefe, Füße bleiben stehen', () => {
  // Die Vorgabe liegt bewusst unter der gemessenen Hocktiefe — sie ist
  // erreichbar, also darf nichts geopfert werden.
  const tiefeAnteil = (MAX_HOCKE * 0.5) / H;
  const { frames, bericht } = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 12, params: { tiefe: tiefeAnteil } },
  ]);

  assert.equal(frames.length, 12);
  const gesunken = comY(frames[0]) - comY(frames[11]);
  const verlangt = tiefeAnteil * H;
  assert.ok(Math.abs(gesunken - verlangt) < H * COM_ZIEL_ANTEIL * 2,
    `Absenkung ${(gesunken * 100).toFixed(1)} cm statt verlangter ${(verlangt * 100).toFixed(1)} cm`);

  // Füße bleiben stehen: beide Fußknochen unter der Ankergrenze.
  for (const fuss of [FUSS_L, FUSS_R]) {
    const weg = knochenWeg(frames[0], frames[11], fuss);
    assert.ok(weg < H * ANKER_GRENZE_ANTEIL,
      `Fuß ${fuss} wanderte ${(weg * 100).toFixed(2)} cm, erlaubt ${(H * ANKER_GRENZE_ANTEIL * 100).toFixed(2)} cm`);
  }

  // Erreichbare Vorgabe ⇒ keine geopferte Bedingung.
  assert.deepEqual(bericht.konflikt, [],
    `erreichbare Hocke meldete ${bericht.konflikt.length} Konflikte`);
  // Und es ist wirklich Bewegung entstanden (Fehlerfreiheit ist kein Erfolg).
  assert.ok(bericht.bewegung.schwerpunktWeg_m > verlangt * 0.9,
    `Schwerpunktweg ${bericht.bewegung.schwerpunktWeg_m} m zu klein für ${(verlangt * 100).toFixed(1)} cm Absenkung`);
});

test('crouch negativ: unerreichbare Tiefe wird mit erreichter Tiefe gemeldet, nicht still abgeschnitten', () => {
  // Doppelt so tief wie die gemessene Hocke — unerreichbar.
  const tiefeAnteil = (MAX_HOCKE * 2) / H;
  const { frames, bericht } = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 12, params: { tiefe: tiefeAnteil } },
  ]);

  const k = bericht.konflikt.find((x) => x.bedingung === 'schwerpunktbahn');
  assert.ok(k, `keine Meldung zur verfehlten Schwerpunktbahn; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);

  const gesunken = comY(frames[0]) - comY(frames[frames.length - 1]);
  // Kein stilles Abschneiden: die gemeldete erreichte Tiefe ist die
  // tatsächlich gefahrene, und sie ist größer als null.
  assert.ok(gesunken > H * COM_ZIEL_ANTEIL,
    `Löser senkte nur ${(gesunken * 100).toFixed(1)} cm — statt der tiefsten haltbaren Pose kam der Stand zurück`);
  assert.ok(Math.abs(k.erreicht - gesunken) < H * COM_ZIEL_ANTEIL * 2,
    `gemeldete Tiefe ${(k.erreicht * 100).toFixed(1)} cm ≠ gemessene ${(gesunken * 100).toFixed(1)} cm`);
  assert.ok(k.betrag > 0 && Math.abs(k.betrag - (k.soll - k.erreicht)) < 1e-6,
    `Betrag ${k.betrag} passt nicht zu Soll ${k.soll} minus Erreicht ${k.erreicht}`);

  // Rangfolge plan.md 6.4: geopfert wird die Bahn (Rang 4), nicht der Anker.
  for (const fuss of [FUSS_L, FUSS_R]) {
    const weg = knochenWeg(frames[0], frames[frames.length - 1], fuss);
    assert.ok(weg < H * ANKER_GRENZE_ANTEIL,
      `Fuß ${fuss} wanderte ${(weg * 100).toFixed(2)} cm — der Anker (Rang 3) wurde vor der Bahn (Rang 4) geopfert`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — takeoff: Schwerpunkt erreicht die verlangte Geschwindigkeit, Kontakt löst
// ═══════════════════════════════════════════════════════════════════════════

/** Absprung mit anschließender Flugphase in ballistisch passender Länge. */
function sprungPhasen(vyAnteil, { spinX = 0, flugFrames = null, tuck = 0 } = {}) {
  const v = vyAnteil * H;
  const flug = flugFrames ?? Math.round((2 * v / G) * FPS);
  return {
    v,
    flug,
    phasen: [
      { id: 'p1', verb: 'crouch', from: 0, to: 10, params: { tiefe: (MAX_HOCKE * 0.6) / H } },
      { id: 'p2', verb: 'takeoff', from: 10, to: 16, params: { vy: vyAnteil, spinX } },
      { id: 'p3', verb: 'airborne', from: 16, to: 16 + flug, params: { tuck } },
    ],
  };
}

test('takeoff positiv: Schwerpunkt erreicht die verlangte Geschwindigkeit, Kontakt löst sich', () => {
  const { v, phasen } = sprungPhasen(0.8);
  const { frames, bericht } = loese(phasen);

  assert.deepEqual(bericht.konflikt, [],
    `erreichbarer Absprung meldete: ${JSON.stringify(bericht.konflikt.map((k) => k.meldung))}`);

  // Geschwindigkeit am Kontaktende: gemessen aus der Schwerpunktfolge der
  // ersten beiden Flugframes (die Ballistik startet mit genau dieser).
  const flug = frameDer(frames, 'p3');
  const vGemessen = (comY(flug[0]) - comY(frames[15])) * FPS + G / (2 * FPS);
  assert.ok(Math.abs(vGemessen - v) < v * 0.15,
    `Absprunggeschwindigkeit ${vGemessen.toFixed(2)} m/s statt verlangter ${v.toFixed(2)} m/s`);

  // Kontakt löst sich: bis Frame 15 Kontakt, danach Flug, und die Sohlen
  // sind nicht mehr verankert.
  assert.equal(frames[15].contact, 'kontakt');
  assert.equal(flug[0].contact, 'flug');
  assert.deepEqual(flug[0].anchored, []);
  assert.equal(bericht.bewegung.kontaktwechsel, 1);
});

test('takeoff negativ: Geschwindigkeit über der Streckung wird mit Betrag gemeldet', () => {
  // Verlangt wird das Fünffache dessen, was Streckung und Gegenbewegung in
  // der Phasendauer hergeben.
  const { phasen } = sprungPhasen(4.0, { flugFrames: 20 });
  const { bericht } = loese(phasen);

  const k = bericht.konflikt.find((x) => x.bedingung === 'schwerpunktbahn-geschwindigkeit');
  assert.ok(k, `keine Meldung zur unerreichbaren Absprunggeschwindigkeit; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);
  assert.equal(k.einheit, 'm/s');
  assert.ok(k.soll > k.erreicht && k.betrag > 0,
    `Soll ${k.soll} m/s soll über Erreicht ${k.erreicht} m/s liegen`);
  assert.ok(k.erreicht > 0,
    'gemeldete Höchstgeschwindigkeit ist null — der Löser hat gar nicht gestreckt');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — airborne: Flugbahn ist eine Parabel, Drehung erreicht den Sollwinkel
// ═══════════════════════════════════════════════════════════════════════════

test('airborne positiv: Flugbahn ist eine Parabel, Drehung erreicht den Sollwinkel', () => {
  const SPIN = -360;
  const { phasen } = sprungPhasen(1.2, { spinX: SPIN, tuck: [0, 1, 1, 0] });
  const { frames, bericht } = loese(phasen);
  const flug = frameDer(frames, 'p3');
  assert.ok(flug.length >= 6, `nur ${flug.length} Flugframes`);

  // Parabel: die zweite Differenz der Höhe ist konstant −g·dt².
  const erwartet = -G / (FPS * FPS);
  for (let i = 1; i + 1 < flug.length; i++) {
    const zweite = comY(flug[i + 1]) - 2 * comY(flug[i]) + comY(flug[i - 1]);
    assert.ok(Math.abs(zweite - erwartet) < Math.abs(erwartet) * 0.02,
      `Frame ${flug[i].frame}: zweite Höhendifferenz ${zweite.toExponential(3)} statt ${erwartet.toExponential(3)} — keine Parabel`);
  }

  // Drehung erreicht den Sollwinkel.
  const end = flug[flug.length - 1].winkelGrad;
  assert.ok(Math.abs(end - SPIN) < 1,
    `Endwinkel ${end}° statt ${SPIN}°`);
  // Und das Trägheitsmoment hat sich durch das Einrollen wirklich geändert —
  // sonst prüft der Negativfall unten nichts.
  const traegheiten = flug.map((f) => f.traegheit);
  const spanne = Math.max(...traegheiten) / Math.min(...traegheiten);
  assert.ok(spanne > 1.1,
    `Trägheitsmoment änderte sich nur um Faktor ${spanne.toFixed(3)} — das Einrollen wirkt nicht`);
  assert.deepEqual(bericht.konflikt, []);
});

test('airborne negativ: ohne Drehimpulskorrektur weicht der Endwinkel messbar ab', () => {
  const SPIN = -360;
  const { phasen } = sprungPhasen(1.2, { spinX: SPIN, tuck: [0, 1, 1, 0] });
  const { frames, bericht } = loese(phasen, { drehimpulsKorrektur: false });
  const flug = frameDer(frames, 'p3');

  const end = flug[flug.length - 1].winkelGrad;
  const abw = Math.abs(end - SPIN);
  assert.ok(abw > 1,
    `Endwinkel ${end}° weicht nur um ${abw.toFixed(2)}° ab — der abgeschaltete Ausgleich ist nicht messbar`);

  const k = bericht.konflikt.find((x) => x.bedingung === 'drehung');
  assert.ok(k, `keine Meldung zur Winkelabweichung; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);
  assert.equal(k.einheit, 'grad');
  assert.ok(Math.abs(k.betrag - abw) < 0.1,
    `gemeldeter Betrag ${k.betrag}° ≠ gemessene Abweichung ${abw.toFixed(2)}°`);

  // Die Winkelgeschwindigkeit ist eingefroren statt dem Trägheitsmoment zu
  // folgen — genau der abgeschaltete Schritt aus plan.md 6.5.
  const omegas = new Set(flug.map((f) => f.omegaGradProS.toFixed(6)));
  assert.equal(omegas.size, 1,
    `ohne Korrektur müsste ω konstant sein, gemessen ${omegas.size} verschiedene Werte`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — land: Aufsetzfuß berührt den Boden, Schwerpunkt kommt ins Lot
// ═══════════════════════════════════════════════════════════════════════════

test('land positiv: Aufsetzfuß berührt den Boden, Schwerpunkt kommt ins Lot', () => {
  const vyAnteil = 0.6;
  const v = vyAnteil * H;
  const flug = Math.max(2, Math.round((2 * v / G) * FPS) - 6);   // Rest fängt land ab
  const { frames, bericht } = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 10, params: { tiefe: (MAX_HOCKE * 0.6) / H } },
    { id: 'p2', verb: 'takeoff', from: 10, to: 16, params: { vy: vyAnteil } },
    { id: 'p3', verb: 'airborne', from: 16, to: 16 + flug, params: { tuck: 0 } },
    { id: 'p4', verb: 'land', from: 16 + flug, to: 16 + flug + 10, params: { tiefe: 0.05 } },
  ]);

  const landeFrames = frameDer(frames, 'p4');
  const letzter = landeFrames[landeFrames.length - 1];
  assert.equal(letzter.contact, 'kontakt', 'die Landung endet nicht im Bodenkontakt');
  assert.ok(letzter.anchored.length > 0, 'kein verankerter Sohlenpunkt im letzten Frame');

  // Aufsetzfuß berührt den Boden: tiefste Sohle innerhalb des Kontaktzuschlags
  // aus dem Profil (gemessen, plan.md 4).
  const zuschlag = PROFIL.params?.contactMargin ?? 0.015;
  const sohlen = sohlenImFrame(letzter);
  const tiefste = Math.min(...sohlen.map((s) => s.pos[1]));
  assert.ok(Math.abs(tiefste - SKEL.groundY) <= zuschlag * 2,
    `tiefste Sohle ${(tiefste * 100).toFixed(1)} cm, Boden bei ${(SKEL.groundY * 100).toFixed(1)} cm — Abstand über dem Kontaktzuschlag`);

  // Schwerpunkt kommt ins Lot: seine xz-Lage liegt in der Stützfläche der
  // verankerten Sohlen.
  const xs = sohlen.map((s) => s.pos[0]);
  const zs = sohlen.map((s) => s.pos[2]);
  const rand = H * 0.02;
  assert.ok(letzter.com[0] > Math.min(...xs) - rand && letzter.com[0] < Math.max(...xs) + rand,
    `Schwerpunkt x = ${letzter.com[0].toFixed(3)} außerhalb der Stützfläche [${Math.min(...xs).toFixed(3)}, ${Math.max(...xs).toFixed(3)}]`);
  assert.ok(letzter.com[2] > Math.min(...zs) - rand && letzter.com[2] < Math.max(...zs) + rand,
    `Schwerpunkt z = ${letzter.com[2].toFixed(3)} außerhalb der Stützfläche [${Math.min(...zs).toFixed(3)}, ${Math.max(...zs).toFixed(3)}]`);

  assert.equal(bericht.bewegung.kontaktwechsel, 2,
    'erwartet zwei Kontaktwechsel: Absprung und Aufsetzen');
});

test('land negativ: Aufsetzpunkt außerhalb der Streckreichweite wird gemeldet', () => {
  // Direkt an der Nachbedingung geprüft: ein Sohlenanker, der weiter vom
  // Becken entfernt liegt, als die gemessenen Beingliedmaßen zusammen reichen.
  const kn = poseZuFk(SKEL, bindPose(SKEL));
  const sohlen = sohlenWelt(SKEL, kn);
  const nah = sohlenAnker(SKEL, sohlen);
  const ok = pruefeReichweite(SKEL, bindPose(SKEL), nah);
  assert.ok(ok.ok, `Bind-Stand gilt als unerreichbar: ${ok.meldung}`);

  const weit = sohlenAnker(SKEL, sohlen, [H, 0, 0]);   // eine Körperhöhe zur Seite
  const zu = pruefeReichweite(SKEL, bindPose(SKEL), weit);
  assert.equal(zu.ok, false, 'ein um eine Körperhöhe versetzter Aufsetzpunkt gilt als erreichbar');
  assert.match(zu.meldung, /\d/, `Reichweitenmeldung ohne Zahl: „${zu.meldung}"`);
  assert.ok(zu.notig > zu.erreichbar,
    `benötigte Strecke ${zu.notig} soll über der erreichbaren ${zu.erreichbar} liegen`);

  // Und im Löserlauf: eine Landephase, die zum Aufsetzen zu kurz ist, meldet
  // die Reststrecke statt still zu enden.
  const { bericht } = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 10, params: { tiefe: (MAX_HOCKE * 0.6) / H } },
    { id: 'p2', verb: 'takeoff', from: 10, to: 16, params: { vy: 1.2 } },
    { id: 'p3', verb: 'airborne', from: 16, to: 20, params: { tuck: 0 } },
    { id: 'p4', verb: 'land', from: 20, to: 24, params: { tiefe: 0.05 } },
  ]);
  const k = bericht.konflikt.find((x) => x.bedingung === 'aufsetzen');
  assert.ok(k, `keine Meldung zur zu kurzen Landephase; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — Konflikt: Rangfolge plan.md 6.4, geopferte Bedingung mit Betrag
// ═══════════════════════════════════════════════════════════════════════════

test('Konflikt positiv: widersprüchliche Bedingungen werden nach Rangfolge aufgelöst', () => {
  // Gelenkgrenze (Rang 1) gegen Override-Wunsch: die Grenze gewinnt immer.
  const gelenk = 'knee_l';
  const grenze = SKEL.dofs['knee_l.bend'].grenze;
  const uebertrieben = grenze[1] + 90;
  const { frames, bericht } = loeseBewegung(PROFIL, SKEL, {
    fps: FPS, frameCount: 12,
    phases: [{ id: 'p1', verb: 'crouch', from: 0, to: 12, params: { tiefe: (MAX_HOCKE * 0.5) / H } }],
    overrides: { 6: { joints: { [gelenk]: { bend: uebertrieben } } } },
  });

  const k = bericht.konflikt.find((x) => x.bedingung === 'gelenkwinkel');
  assert.ok(k, `keine Meldung zum geklemmten Gelenkwinkel; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);
  assert.equal(k.erreicht, grenze[1], `geklemmt auf ${k.erreicht}° statt auf die Grenze ${grenze[1]}°`);
  assert.equal(k.betrag, uebertrieben - grenze[1]);
  assert.ok(frames[6].override, 'der Override wurde nicht in den Frame geschrieben');

  // Und die Rangfolge in der Kontaktphase: Bahn (Rang 4) wird geopfert,
  // Fußanker (Rang 3) und Boden (Rang 2) halten.
  const tief = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 12, params: { tiefe: (MAX_HOCKE * 2) / H } },
  ]);
  const bodenTol = H * 0.01;
  for (const f of tief.frames) {
    let tiefster = Infinity;
    for (const pos of Object.values(f.positions)) tiefster = Math.min(tiefster, pos[1]);
    assert.ok(tiefster >= SKEL.groundY - bodenTol,
      `Frame ${f.frame}: ein Knochen steht ${((SKEL.groundY - tiefster) * 100).toFixed(1)} cm unter dem Boden — Rang 2 verletzt`);
  }
  assert.ok(tief.bericht.konflikt.some((x) => x.bedingung === 'schwerpunktbahn'),
    'die Bahn wurde verfehlt, ohne dass es im Bericht steht');
});

test('Konflikt negativ: jede geopferte Bedingung steht mit Betrag im Bericht', () => {
  // Ein Lauf, in dem gleich zwei Bedingungen unerfüllbar sind: zu tiefe Hocke
  // und ein Absprung mit 6 Körperhöhen/s — mehr, als Streckung und
  // Gegenbewegung in den sechs Frames der Phase hergeben. Beide müssen einzeln mit Betrag auftauchen —
  // ein Löser, der still abschneidet, liefert hier eine leere Liste.
  const { frames, bericht } = loese([
    { id: 'p1', verb: 'crouch', from: 0, to: 12, params: { tiefe: (MAX_HOCKE * 3) / H } },
    { id: 'p2', verb: 'takeoff', from: 12, to: 18, params: { vy: 6.0 } },
    { id: 'p3', verb: 'airborne', from: 18, to: 40, params: { tuck: 0 } },
  ]);

  const arten = bericht.konflikt.map((k) => k.bedingung);
  assert.ok(arten.includes('schwerpunktbahn'),
    `Hocke verfehlt, aber nicht gemeldet; gemeldet wurde: ${JSON.stringify(arten)}`);
  assert.ok(arten.includes('schwerpunktbahn-geschwindigkeit'),
    `Absprung verfehlt, aber nicht gemeldet; gemeldet wurde: ${JSON.stringify(arten)}`);
  for (const k of bericht.konflikt) meldungMitZahl(k);

  // Der gemeldete Betrag ist der gemessene: die Hocke wird nachgemessen.
  const hocke = bericht.konflikt.find((k) => k.bedingung === 'schwerpunktbahn');
  const gesunken = comY(frames[0]) - Math.min(...frames.slice(0, 12).map(comY));
  assert.ok(Math.abs(hocke.erreicht - gesunken) < H * COM_ZIEL_ANTEIL * 2,
    `gemeldete ${(hocke.erreicht * 100).toFixed(1)} cm ≠ gemessene ${(gesunken * 100).toFixed(1)} cm`);

  // Nichts wird verschwiegen: unverbaute Verben stehen als Lücke im Bericht.
  const mitLuecke = loese([
    { id: 'p1', verb: 'turn', from: 0, to: 10, params: { winkel: 90 } },
  ]);
  assert.equal(mitLuecke.bericht.lucken.length, 1,
    'ein nicht gebautes Verb wurde stillschweigend übergangen');
  assert.match(mitLuecke.bericht.lucken[0].meldung, /\d/);
});

// ── Hilfen ─────────────────────────────────────────────────────────────────

/**
 * Sohlenpunkte eines gelösten Frames in Weltmetern — dieselbe Rechnung wie
 * sohlenWelt in ./kinematik.js, nur aus den Frame-Feldern: Knochenposition
 * plus der mit der Weltdrehung des Fußes gedrehte lokale Sohlenpunkt.
 */
function sohlenImFrame(frame) {
  return SKEL.soles.map((s) => {
    const gelenk = gelenkAmKnochen(s.bone);
    const quat = frame.joints[gelenk];
    assert.ok(quat, `Frame ${frame.frame}: keine Weltdrehung für Sohlenknochen „${s.bone}"`);
    const stab = SKEL.byId.get(s.bone).weltmassstab ?? 1;
    const d = qRot(quat, s.local);
    const p = frame.positions[s.bone];
    return { id: s.id, pos: [p[0] + d[0] * stab, p[1] + d[1] * stab, p[2] + d[2] * stab] };
  });
}

/** Gelenkname, dessen Knochen dieser ist — liefert die Frame-Quaternion. */
function gelenkAmKnochen(boneId) {
  for (const [name, j] of Object.entries(SKEL.profile.joints)) {
    if (j.bone === boneId) return name;
  }
  throw new Error(`Kein Gelenk am Knochen „${boneId}" unter ${Object.keys(SKEL.profile.joints).length} Profilgelenken — Sohlenlage im Frame nicht rekonstruierbar`);
}
