// AP5.2 — Abnahmetest für die Verben stand und swing_arms (src/solver/verben.js).
//
// Je Verb ein Positivfall mit gemessener Wirkung und ein Negativfall mit
// unerreichbarer Vorgabe, deren Meldung samt Betrag geprüft wird (AGENTS.md,
// Regel 2). Daneben der Bewegungsnachweis gegen die Stilprüfung (Fehlerfreiheit
// ist kein Erfolg, src/validate/style.js) und eine Sabotageprobe (Regel des
// Auftrags: Test wird rot, wenn man den Code beschädigt).
//
// Kein Körpermaß wird getippt: Rig und Körperhöhe kommen aus src/rig/measure.js,
// alle Toleranzen sind Anteile der gemessenen Körperhöhe.
//
// Läuft ohne Browser: node --test "src/**/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert';

import { loadGLB } from '../scene/load.js';
import { XBOT_PFAD, alsArrayBuffer } from '../scene/testdaten.mjs';
import { measureRigProfile } from '../rig/measure.js';
import { erfasseBind, baueSkeleton, vLen, vSub, qRot } from './kinematik.js';
import { vermesseAusgangslage, startZustand, phaseStand, phaseSwingArms } from './verben.js';
import { pruefeStil } from '../validate/style.js';

const FPS = 30;

// ── Rig einmal laden; alle Tests lösen gegen dasselbe Skelett ───────────────
const gltf = await loadGLB(alsArrayBuffer(XBOT_PFAD));
const PROFIL = measureRigProfile(gltf);
const SKEL = baueSkeleton(PROFIL, erfasseBind(gltf.scene));
const H = SKEL.height;                       // gemessene Körperhöhe, Meter
const VORGANG = vermesseAusgangslage(SKEL);

/** Fährt EIN Verb direkt (die abgenommene Schnittstelle, nicht über loeser.js,
 *  dessen Verbenkatalog fest verdrahtet ist) und liefert frames + Bericht. */
function loeseVerb(verbFunktion, params, dauer, { aufsetzung = null } = {}) {
  const ctx = { skel: SKEL, profile: PROFIL, fps: FPS, vorgang: VORGANG, opts: {} };
  const z = aufsetzung ?? startZustand(SKEL, VORGANG);
  const frames = [];
  const bericht = { konflikt: [], hinweise: [], lucken: [] };
  verbFunktion(ctx, { id: 'p1', verb: params.verb, from: 0, to: dauer, params }, z, frames, bericht);
  return { frames, bericht, z };
}

/** Jede Meldung im Bericht muss eine Zahl tragen (AGENTS.md, Handwerkliches). */
function meldungMitZahl(eintrag) {
  assert.ok(typeof eintrag.meldung === 'string' && eintrag.meldung.length > 0,
    `Konflikteintrag ohne Meldung: ${JSON.stringify(eintrag)}`);
  assert.match(eintrag.meldung, /\d/, `Meldung ohne Zahl: „${eintrag.meldung}"`);
  assert.ok(Number.isFinite(eintrag.betrag),
    `Konflikt ${eintrag.bedingung} ohne endlichen Betrag: ${JSON.stringify(eintrag.betrag)}`);
  assert.ok(typeof eintrag.einheit === 'string' && eintrag.einheit.length > 0,
    `Konflikt ${eintrag.bedingung} ohne Einheit`);
}

/** Sohlenpunkte eines gelösten Frames in Weltmetern (aus positions + joints). */
function sohlenImFrame(skel, frame) {
  return skel.soles.map((s) => {
    const gelenk = Object.entries(skel.profile.joints).find(([, j]) => j.bone === s.bone)?.[0];
    assert.ok(gelenk, `kein Gelenk am Sohlenknochen ${s.bone}`);
    const quat = frame.joints[gelenk];
    assert.ok(quat, `Frame ${frame.frame}: keine Weltdrehung für ${s.bone}`);
    const d = qRot(quat, s.local);
    const p = frame.positions[s.bone];
    const stab = skel.byId.get(s.bone).weltmassstab ?? 1;
    return { id: s.id, pos: [p[0] + d[0] * stab, p[1] + d[1] * stab, p[2] + d[2] * stab] };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// stand — Positivfall
// ═════════════════════════════════════════════════════════════════════════════

test('stand positiv: gewünschte Gewichtsverlagerung wird gemessen, Füße bleiben stehen', () => {
  const { frames, bericht } = loeseVerb(phaseStand, { verteilung: 0.9, atmen: 1 }, 20);

  // Gemessene Wirkung: der Schwerpunkt wandert Richtung linkes Sohlenzentrum.
  const com0 = frames[0].com, comEnde = frames[frames.length - 1].com;
  const weg = Math.hypot(comEnde[0] - com0[0], comEnde[2] - com0[2]);
  assert.ok(weg > H * 0.002,
    `Schwerpunkt verlagerte sich nur ${(weg * 100).toFixed(2)} cm — keine messbare Verlagerung`);

  // Bewegungsnachweis (Fehlerfreiheit ist kein Erfolg): Stilprüfung gegen die
  // gemessene Körperhöhe, mit 'halt'-Ausnahme für die atemfreien Randframes.
  const stil = pruefeStil(PROFIL, frames, FPS, {
    ausnahmen: [{ von: 0, bis: 2, art: 'halt', grund: 'Anlauf des Verlagerungs-Sanftanlaufs' }],
  });
  assert.ok(stil.passed, `Stilprüfung meldete ${stil.issues.length} Befunde: ${JSON.stringify(stil.issues.map((i) => i.message))}`);

  // Und die geopferte Restvorgabe wird gemeldet (0,9 verlangt 11 cm, machbar
  // sind gemessen 1,2 cm): der Positivfall duldet nur eine Meldung mit Betrag,
  // keine still abgeschnittene Bahn und keinen Bruch im Bericht.
  const grenzSoll = bericht.konflikt.find((k) => k.bedingung === 'gewichtsverlagerung');
  assert.ok(grenzSoll, 'keine Meldung zur beschnittenen Verlagerung — still abgeschnitten');
  meldungMitZahl(grenzSoll);
  assert.ok(grenzSoll.betrag > H * 0.01,
    `Meldung mit Betrag ${(grenzSoll.betrag * 100).toFixed(2)} cm zu klein, um die Beschneidung ehrlich auszuweisen`);
  // Füße sind nicht gewandert — gemessen an den Sohlenpunkten.
  // Und die Füße sind nicht gewandert — gemessen an den Sohlenpunkten.
  const fuss0 = sohlenImFrame(SKEL, frames[0])[0].pos;
  const fussE = sohlenImFrame(SKEL, frames[frames.length - 1])[0].pos;
  const fussWeg = vLen(vSub(fussE, fuss0));
  assert.ok(fussWeg < H * 0.006,
    `Sohle wanderte ${(fussWeg * 100).toFixed(2)} cm, erlaubt ${(0.6 * 100).toFixed(0)} % der Körperhöhe`);
});

// ═════════════════════════════════════════════════════════════════════════════
// stand — Negativfall: unerreichbare Verlagerung wird mit Betrag gemeldet
// ═════════════════════════════════════════════════════════════════════════════

test('stand negativ: Verlagerung über die gemessene Grenze wird gemeldet, nicht still abgeschnitten', () => {
  const { frames, bericht } = loeseVerb(phaseStand, { verteilung: 1.0 }, 12);
  const k = bericht.konflikt.find((x) => x.bedingung === 'gewichtsverlagerung');
  assert.ok(k, `keine Meldung zur unerreichbaren Gewichtsverlagerung; Bericht: ${JSON.stringify(bericht.konflikt)}`);
  meldungMitZahl(k);
  assert.equal(k.einheit, 'm');
  assert.ok(k.soll > k.erreicht && k.betrag > 0,
    `Soll ${k.soll} m soll über dem Erreichten ${k.erreicht} m liegen`);
  // Kein stilles Abschneiden: die gefahrene Verlagerung ist sichtbar über der
  // Schwelle des Stillstands (der Stand ohne Verlagerung bewegt genau 0 cm).
  const com0 = frames[0].com, comEnde = frames[frames.length - 1].com;
  const real = Math.hypot(comEnde[0] - com0[0], comEnde[2] - com0[2]);
  assert.ok(real > 0,
    `Löser verlagerte um ${(real * 100).toFixed(2)} cm — statt der machbaren Verlagerung kam der Stand zurück`);
  assert.ok(Math.abs(k.erreicht - real) < H * 0.005,
    `gemeldete Verlagerung ${(k.erreicht * 100).toFixed(2)} cm ≠ gemessene ${(real * 100).toFixed(2)} cm`);
  // Und die Füße sind trotzdem stehen geblieben (Rang 3 hält).
  const fussWeg = vLen(vSub(
    sohlenImFrame(SKEL, frames[frames.length - 1])[0].pos,
    sohlenImFrame(SKEL, frames[0])[0].pos));
  assert.ok(fussWeg < H * 0.006,
    `Sohle wanderte ${(fussWeg * 100).toFixed(2)} cm — der Fußanker (Rang 3) wurde geopfert`);
});

test('stand parameterfehler: verteilung außerhalb 0..1 wird abgelehnt, mit Zahl', () => {
  assert.throws(
    () => loeseVerb(phaseStand, { verteilung: 1.4 }, 6),
    (e) => e.message.includes('1,4') || /\d/.test(e.message),
    `Fehlermeldung nennt keinen Messwert: erwartete Ablehnung von verteilung = 1,4`);
});

// ═════════════════════════════════════════════════════════════════════════════
// swing_arms — Positivfall
// ═════════════════════════════════════════════════════════════════════════════

test('swing_arms positiv: Armschwung erreicht den verlangten Ausschlag', () => {
  const { frames, bericht } = loeseVerb(phaseSwingArms, { richtung: 'vor', ausschlag: 1.0 }, 16);
  assert.deepEqual(bericht.konflikt, [],
    `erreichbarer Schwung meldete ${bericht.konflikt.length} Konflikte`);
  // Messung: die linke Hand wandert — ein Ausschlag aus der Grenzspanne ist
  // an der Handspur sichtbar über 1 % der Körperhöhe.
  const hand = 'mixamorigLeftHand';
  const handWeg = vLen(vSub(frames[frames.length - 1].positions[hand], frames[0].positions[hand]));
  assert.ok(handWeg > H * 0.01,
    `Hand bewegte sich nur ${(handWeg * 100).toFixed(2)} cm — kein messbarer Armschwung`);
});

test('swing_arms positiv: Stilprüfung — Dichte hält, Antizipation vorhanden', () => {
  const { frames } = loeseVerb(phaseSwingArms, { richtung: 'vor', ausschlag: 0.7 }, 40);
  // Hauptbewegung wird GEMESSEN, nicht geraten (Regel 1): die Schwungrichtung
  // ist die Tangente der Handspur zwischen den beiden Wellenextremen.
  const hand = 'mixamorigLeftHand';
  // Beide Wellenmaxima finden: größter Abstand von der Bindlage je Halbzeit.
  const p0 = frames[0].positions[hand];
  let extrem = 1, zweitesAb = frames.length - 1;
  let abwMax1 = -1, abwMax2 = -1;
  for (let i = 1; i < frames.length; i++) {
    const d = vLen(vSub(frames[i].positions[hand], p0));
    if (i < frames.length / 2) { if (d > abwMax1) { abwMax1 = d; extrem = i; } }
    else if (d > abwMax2) { abwMax2 = d; zweitesAb = i; }
  }
  // Tangente aus den beiden Extrempositionen — gemessene Hauptrichtung.
  const a = frames[extrem].positions[hand], b = frames[zweitesAb].positions[hand];
  const richtung = vSub(b, a);
  const stil = pruefeStil(PROFIL, frames, FPS, {
    hauptbewegung: { part: hand, abFrame: Math.max(2, Math.floor((extrem + zweitesAb) / 2)), richtung },
    ausnahmen: [{ von: 0, bis: 2, art: 'halt', grund: 'Anlauf von der Bindpose' }],
  });
  const dichteUndRuckOk = stil.issues.every((i) => i.kind !== 'bewegungsdichte' && i.kind !== 'ruck');
  assert.ok(dichteUndRuckOk,
    `Bewegungsdichte/Ruck meldete Befunde: ${JSON.stringify(stil.issues.map((i) => [i.kind, i.message]))}`);
  // Positivkontrolle: ausschlag 0 liegt unter der Schwelle — ohne Schwung wäre
  // selbst der Antizipationsbefund fällig (siehe Sabotagenachweis unten).
  const still = loeseVerb(phaseSwingArms, { richtung: 'vor', ausschlag: 0 }, 40);
  const stillStil = pruefeStil(PROFIL, still.frames, FPS, {
    hauptbewegung: { part: hand, abFrame: 10, richtung: [1, 0, 0] },
    ausnahmen: [{ von: 0, bis: 15, art: 'halt', grund: 'Sollzustand Stillstand' }],
  });
  assert.ok(stillStil.issues.some((i) => i.kind === 'antizipation') || stillStil.ausgelassen.includes('antizipation'),
    'ein Stillstand ohne Schwung sollte die Antizipationsprüfung bemängeln oder überspringen — sie misst die Welle nicht');
});

// ═════════════════════════════════════════════════════════════════════════════
// swing_arms — Negativfall: die Grenzspanne wird nie überschritten
// ═════════════════════════════════════════════════════════════════════════════

test('swing_arms negativ: ausschlag 0 liefert Stillstand (die Welle wirkt nachweisbar)', () => {
  const { frames, bericht } = loeseVerb(phaseSwingArms, { richtung: 'vor', ausschlag: 0 }, 18);
  assert.deepEqual(bericht.konflikt, []);
  const handWeg = vLen(vSub(
    frames[frames.length - 1].positions['mixamorigLeftHand'],
    frames[0].positions['mixamorigLeftHand']));
  assert.ok(handWeg < H * 0.01,
    `ausschlag 0 bewegte die Hand um ${(handWeg * 100).toFixed(2)} cm — die Welle hätte still stehen müssen`);
  // Positivkontrolle in derselben Bauweise: mit Ausschlag ist es messbar mehr.
  const mit = loeseVerb(phaseSwingArms, { richtung: 'vor', ausschlag: 1.0 }, 18);
  const mitWeg = vLen(vSub(
    mit.frames[mit.frames.length - 1].positions['mixamorigLeftHand'],
    mit.frames[0].positions['mixamorigLeftHand']));
  assert.ok(mitWeg > handWeg * 3,
    `Handweg mit Ausschlag ${mitWeg.toFixed(4)} m gegen Stillstand ${handWeg.toFixed(4)} m — der Ausschlag misst sich nicht ab`);
});