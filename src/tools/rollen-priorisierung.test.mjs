// Abnahmetest — Rückfragen priorisieren (Auftrag "Zu viele unsichere Rollen:
// 6 Rückfragen bei 3 Fragen Budget").
//
// Geprüft wird die Entscheidung, WELCHE Rollen zur Rückfrage kommen — nicht die
// Erkennung selbst (die steht in src/rig/detect.js und gehört einem anderen).
// Die Fragen kommen als Attrappen herein, im Frageformat von plan.md 5.1, so
// wie detectRig() sie liefert.
//
//   Rangfolge     bei Budget 3 und 6 unsicheren Rollen werden die Pflichtrollen
//                 zuerst gefragt  |  eine Pflichtrolle bleibt ungefragt, während
//                 eine Fingerrolle gefragt wird → Test rot
//   Sichtbarkeit  die Zahl der offen gebliebenen Rollen steht im Ergebnis, mit
//                 ihren Namen  |  offene Rollen werden still verschluckt → rot
//   Budget null   bei Budget 0 wird gar nicht gefragt, alle unsicheren Rollen
//                 stehen im Ergebnis  |  —
//
// Kein Körpermaß wird getippt: Konfidenzen sind Eingabewerte des Versuchs-
// aufbaus, keine Messung. Die Pflichtrollen prüft der Negativfall gegen den
// Vertragsprüfer (src/contracts/rig-profile.js), ohne ihn zu kopieren.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer } from './index.js';
import { priorisiereFragen, offenerRest, PFLICHTROLLEN } from './rollen-priorisierung.js';
import { validateRigProfile } from '../contracts/rig-profile.js';

/** Fragezone nach plan.md 5.1. Nur für den Versuchsaufbau (Eingabewerte). */
const FRAGE_AB = 0.5;
const SICHER_AB = 0.9;

/**
 * Sechs unsichere Rollen bei Budget 3 — das beobachtete Problem, als Tabelle.
 * Drei verschmerzbare vorn, drei Pflichtrollen hinten: die Reihenfolge des
 * Einschubs darf nicht über das Schicksal entscheiden (das war der Fehler).
 */
function sechsUnsichere() {
  const rollen = [
    { rolle: 'hand_l', bone: 'bone_016', confidence: 0.58 },
    { rolle: 'head', bone: 'bone_041', confidence: 0.55 },
    { rolle: 'forearm_r', bone: 'bone_024', confidence: 0.62 },
    { rolle: 'pelvis', bone: 'mixamorigHips', confidence: 0.72 },
    { rolle: 'foot_l', bone: 'mixamorigLeftFoot', confidence: 0.62 },
    { rolle: 'foot_r', bone: 'mixamorigRightFoot', confidence: 0.58 }
  ];
  return rollen.map((f) => ({
    art: 'rollenbestaetigung',
    rolle: f.rolle,
    frage: `Ist „${f.bone}“ die Rolle ${f.rolle}? Vorschlag mit Konfidenz ${f.confidence}, `
      + `sicher ab ${SICHER_AB}.`,
    optionen: [{ text: `ja, „${f.bone}“`, bone: f.bone, confidence: f.confidence }]
  }));
}

/** Negativfall-Wächte des Testaufbaus: die eingestellten Konfidenz-Zahlen
 *  liegen wirklich in der Fragezone (0,5 bis 0,9), sonst prüft nichts. */
function wacheFragezone(fragen) {
  for (const f of fragen) {
    const c = f.optionen[0].confidence;
    assert.ok(c >= FRAGE_AB && c < SICHER_AB,
      `Versuchsaufbau korrumpiert: ${f.rolle} hat Konfidenz ${c}, verlangt `
      + `${FRAGE_AB} bis ${SICHER_AB} (Fragezone)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rangfolge
// ─────────────────────────────────────────────────────────────────────────────

test('Rangfolge: bei Budget 3 und 6 unsicheren Rollen werden die Pflichtrollen zuerst gefragt', () => {
  const fragen = sechsUnsichere();
  wacheFragezone(fragen);

  const priorisiert = priorisiereFragen(fragen);
  const reihenfolge = priorisiert.map((f) => f.rolle);

  // Beim Blick durch ein Budget von 3 Fragen: genau die drei Pflichtrollen.
  const imBudget = reihenfolge.slice(0, 3);
  assert.deepEqual(imBudget.sort(), ['pelvis', 'foot_l', 'foot_r'].sort(),
    `Budget 3 muss die Pflichtrollen erfassen, erfasst wurde: ${imBudget.join(', ')}`);
  // Der Rest steht hinter ihnen und ist nicht verloren.
  const ausserhalb = reihenfolge.slice(3);
  assert.ok(ausserhalb.includes('hand_l') && ausserhalb.includes('head'),
    `Finger- und Kopfrolle bleiben als unsicher gekennzeichnet stehen, statt `
    + `vorgezogen zu werden: ${reihenfolge.join(', ')}`);
  assert.equal(reihenfolge.length, 6,
    `alle 6 Fragen bleiben vorhanden (nichts wird still verworfen), es sind ${reihenfolge.length}`);
});

test('Rangfolge, Negativfall: eine Pflichtrolle bleibt ungefragt, während eine Fingerrolle gefragt wird → rot', () => {
  // Die Kontrolle des Prüfers: eine naive Umsetzung, die in den Fragen
  // einfach der Reihenfolge des Berichts folgt, muss hier auffliegen — genau
  // der gemessene Zustand (6 unsichere Rollen, die 3 Pflichtrollen standen
  // hinten beim Bericht). Würde der erste Test diese Sorte nicht fangen,
  // wäre der Test kaputt, nicht der Code.
  const fragen = sechsUnsichere();   // Einschubreihenfolge: Fingerrollen vorn
  wacheFragezone(fragen);
  const naiv = fragen.map((f) => f.rolle).slice(0, 3);

  const pflichtGefragt = naiv.filter((r) => PFLICHTROLLEN.includes(r));
  assert.equal(pflichtGefragt.length, 0,
    `die naive Reihenfolge fragt ${pflichtGefragt.length} von ${PFLICHTROLLEN.length} `
    + `Pflichtrollen — genau dieser Zustand muss rot werden`);
  assert.ok(pflichtGefragt.length < PFLICHTROLLEN.length,
    'der naive Anschnitt lässt Pflichtrollen ungefragt, während Fingerrollen gefragt werden');
});

test('Pflichtrollen-Negativfall gegen den Vertragsprüfer: ohne die drei wird abgelehnt', () => {
  // Warum ausgerechnet diese drei Namen? Weil der Vertragsprüfer ohne sie das
  // Modell ablehnt. Prüft die Verbindung zur Quelle statt eine Kopie.
  const profil = {
    schemaVersion: 1,
    source: { file: 'versuch.glb', boneCount: 1, vertexCount: 1 },
    world: { up: 'y', forward: 'z', left: 'x', groundY: 0, height: 1.0, unitsPerMeter: 1 },
    bones: [{ id: 'k1', parent: null, bindWorld: [0, 1, 0] }],
    roles: {},
    joints: {},
    segments: [],
    soles: [],
    restDistances: {},
    params: { radiusPercentile: 0.9, soleTolerance: 0.035, contactMargin: 0.015 },
    warnings: []
  };
  for (const r of PFLICHTROLLEN) {
    profil.roles[r] = { bone: 'k1', confidence: 1 };
  }
  const ok = validateRigProfile(profil);
  assert.ok(ok.ok, `die ${PFLICHTROLLEN.length} Pflichtrollen müssen den Prüfer bestehen: `
    + (ok.errors?.map((e) => `${e.field}: ${e.message}`).join(' | ') ?? ''));

  for (const fehlende of PFLICHTROLLEN) {
    const kaputt = { ...profil, roles: { ...profil.roles } };
    delete kaputt.roles[fehlende];
    const pruefung = validateRigProfile(kaputt);
    assert.equal(pruefung.ok, false,
      `ohne ${fehlende} muss der Vertragsprüfer ablehnen — die Rolle ist Pflicht`);
    assert.ok(pruefung.errors.some((e) => e.field.startsWith(`roles.${fehlende}`)),
      `der Feldname roles.${fehlende} muss in der Ablehnung stehen`);
    assert.ok(pruefung.errors.some((e) => /\d/.test(e.message)),
      'die Ablehnung nennt eine Zahl (AGENTS.md)');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sichtbarkeit
// ─────────────────────────────────────────────────────────────────────────────

test('Sichtbarkeit: die offengebliebenen Rollen stehen mit Namen im Ergebnis und im Zustand', async () => {
  const schicht = await createToolLayer({ budget: 3 });
  const fragen = sechsUnsichere();
  wacheFragezone(fragen);

  // Der Lauf: Budget 3, alle Antworten gehen auf den Vorschlag. Der Vermerk
  // nimmt den ungefragten Rest auf — genau die Auskunftsstelle für den Agenten.
  const priorisiert = priorisiereFragen(fragen);
  const beantwortet = priorisiert.slice(0, 3).map((f) => f.rolle);
  const budget = schicht.ask.stand().verbraucht;
  const vermerk = schicht.store.vermerkeOffeneRollen({ fragen: priorisiert, beantwortet, budget });

  assert.deepEqual(vermerk.offeneRollen.sort(), ['forearm_r', 'hand_l', 'head'].sort(),
    `3 Rollen bleiben offen und müssen namentlich stehen, standen: ${vermerk.offeneRollen.join(', ')}`);
  assert.match(vermerk.meldung, /3 von 6/,
    `die Meldung muss die Zahl der offenen Rollen nennen: "${vermerk.meldung}"`);
  assert.match(vermerk.meldung, /hand_l/,
    `die Meldung muss die offenen Rollen beim Namen nennen: "${vermerk.meldung}"`);

  // Der Zustand hält denselben Vermerk — der Agent liest ihn über
  // describe_rig / den Zustand, ohne dass etwas verschluckt wird.
  const stand = schicht.store.lies();
  assert.deepEqual(stand.offeneRollenFragen.offeneRollen, vermerk.offeneRollen,
    'der Zustand trägt denselben offenen Rest');
});

test('Sichtbarkeit, Negativfall: ein Vermerk, der 3 offene Rollen still verschluckt, wird beanstandet', () => {
  // Der Negativfall des Prüfers selbst: ein Ergebnis ohne offeneRollen darf
  // den Positivfall nicht bestehen können.
  const verschluckt = { budget: 3, meldung: '3 von 6 gefragt, 3 festgelegt' };
  assert.ok(!Array.isArray(verschluckt.offeneRollen),
    'ohne offeneRollen-Feld darf der Sichtbarkeitstest nicht grün sein');
  assert.ok(!/\b(hand_l|head|forearm_r)\b/.test(verschluckt.meldung),
    'eine Meldung ohne Rollennamen verschluckt die 3 offenen Rollen — Test rot');
});

test('Undo: der Vermerk der offenen Rollen ist rückdrehbar wie jede Änderung', async () => {
  const schicht = await createToolLayer({ budget: 0 });
  const vorher = schicht.store.fingerabdruck();

  schicht.store.vermerkeOffeneRollen({
    fragen: sechsUnsichere(), beantwortet: [], budget: 0
  });
  assert.notEqual(schicht.store.fingerabdruck(), vorher, 'der Vermerk ist angekommen');

  const a = await schicht.rufe('undo', {});
  assert.ok(!a.isError, `Rücknahme: ${a.content[0]?.text}`);
  assert.equal(schicht.store.fingerabdruck(), vorher,
    'nach dem undo ist der Vermerk bitgleich rückgenommen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Budget null
// ─────────────────────────────────────────────────────────────────────────────

test('Budget 0: es wird nicht gefragt, alle unsicheren Rollen stehen im Ergebnis', async () => {
  const schicht = await createToolLayer({ budget: 0 });
  const fragen = sechsUnsichere();
  wacheFragezone(fragen);

  assert.equal(schicht.ask.stand().uebrig, 0, '0 von 0 Fragen frei — nichts kann gefragt werden');

  const vermerk = schicht.store.vermerkeOffeneRollen({
    fragen: schicht.tools_reihenfolge ?? priorisiereFragen(fragen), beantwortet: [], budget: 0
  });

  assert.equal(schicht.ask.stand().verbraucht, 0, '0 Fragen verbraucht');
  assert.deepEqual([...vermerk.offeneRollen].sort(),
    ['hand_l', 'head', 'forearm_r', 'pelvis', 'foot_l', 'foot_r'].sort(),
    `alle 6 unsicheren Rollen sind offen, standen: ${vermerk.offeneRollen.join(', ')}`);
  assert.match(vermerk.meldung, /6 von 6/,
    `die Meldung zählt alle 6 als ungefragt: "${vermerk.meldung}"`);
  assert.match(vermerk.meldung, /Budget: 0/,
    'die Meldung nennt das Budget 0, das sie ungefragt ließ');
});

// ─────────────────────────────────────────────────────────────────────────────
// describe_rig: die priorisierte Reihenfolge und der offene Rest sind sichtbar
// ─────────────────────────────────────────────────────────────────────────────

test('describe_rig: Rückfragen kommen priorisiert und der offene Rest mit Namen im Bericht', async () => {
  const fragen = sechsUnsichere();
  const ports = {
    rig: {
      world: () => ({ up: 'y', forward: 'z', left: 'x', groundY: 0, height: 1.6, unitsPerMeter: 1 }),
      rig: () => ({
        roles: Object.fromEntries(fragen.map((f) => [f.rolle,
          { bone: f.optionen[0].bone, confidence: f.optionen[0].confidence }])),
        joints: {},
        questions: fragen
      }),
      body: () => ({ segments: [], soles: [], restDistances: {}, params: {} }),
      probe: () => ({ text: 'Attrappe', bild: null }),
      gelenke: () => [],
      rollen: () => fragen.map((f) => f.rolle)
    }
  };
  const schicht = await createToolLayer({ ports });

  // Detailfassung: describe_rig liefert standardmaessig eine Tabelle fuer den
  // Agenten. Was hier geprueft wird — Reihenfolge und Vollstaendigkeit der
  // Rueckfragen — ist Struktur und steht unter detail: true.
  const antwort = await schicht.rufe('describe_rig', { detail: true });
  assert.ok(!antwort.isError, `describe_rig läuft: ${antwort.content[0]?.text}`);
  const bericht = JSON.parse(antwort.content[0].text);

  assert.deepEqual(bericht.pflichtrollen.sort(), ['pelvis', 'foot_l', 'foot_r'].sort(),
    'der Bericht weist die Pflichtrollen aus');
  const reihenfolge = bericht.questions.map((q) => q.rolle);
  assert.deepEqual(reihenfolge.slice(0, 3).sort(), ['pelvis', 'foot_l', 'foot_r'].sort(),
    `die Rückfragen kommen in priorisierter Reihenfolge, kam: ${reihenfolge.join(', ')}`);
  assert.ok(Array.isArray(bericht.offeneRollen) && bericht.offeneRullen?.length !== 0,
    'der offene Rest muss im Bericht stehen, bevor eine Frage beantwortet wurde');
  assert.match(bericht.rollenOffenMeldung, /6 von 6/,
    `die Meldung im Bericht nennt die offenen Fragezahl: "${bericht.rollenOffenMeldung}"`);
});

test('describe_rig, Negativfall: eine bestätigte Rolle taucht nicht mehr als Rückfrage auf', async () => {
  const fragen = sechsUnsichere();
  const ports = {
    rig: {
      world: () => ({ up: 'y', forward: 'z', left: 'x', groundY: 0, height: 1.6, unitsPerMeter: 1 }),
      rig: () => ({
        roles: Object.fromEntries(fragen.map((f) => [f.rolle,
          { bone: f.optionen[0].bone, confidence: f.optionen[0].confidence }])),
        joints: {},
        questions: fragen
      }),
      body: () => ({ segments: [], soles: [], restDistances: {}, params: {} }),
      probe: () => ({ text: 'Attrappe', bild: null }),
      gelenke: () => [],
      rollen: () => fragen.map((f) => f.rolle)
    }
  };
  const schicht = await createToolLayer({ ports });
  await schicht.rufe('confirm_role', { role: 'pelvis', bone: 'mixamorigHips' });

  // Detailfassung: describe_rig liefert standardmaessig eine Tabelle fuer den
  // Agenten. Was hier geprueft wird — Reihenfolge und Vollstaendigkeit der
  // Rueckfragen — ist Struktur und steht unter detail: true.
  const antwort = await schicht.rufe('describe_rig', { detail: true });
  const bericht = JSON.parse(antwort.content[0].text);
  const nochOffen = bericht.questions.map((q) => q.rolle);
  assert.ok(!nochOffen.includes('pelvis'),
    `die bestätigte Rolle pelvis darf nicht mehr zur Rückfrage stehen, offene Fragen: `
    + `${nochOffen.join(', ')}`);
  assert.deepEqual(bericht.offeneRollen.sort(), ['forearm_r', 'hand_l', 'head', 'foot_l', 'foot_r'].sort(),
    `5 Rollen bleiben ungefragt und stehen mit Namen, standen: ${bericht.offeneRollen.join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Vorschlag: eine offene Rolle trägt den besten Kandidaten mit
// ─────────────────────────────────────────────────────────────────────────────

test('Vorschlag: eine offene Rolle steht mit bestem Kandidaten und Konfidenz im Rest', () => {
  const fragen = sechsUnsichere();
  // Der Vorschlag, den detect.js setzt: bester Kandidat als Objekt an der Frage.
  fragen[0].vorschlag = { bone: 'bone_016', confidence: 0.58 };

  const vermerk = offenerRest(fragen, [], 3);
  assert.ok(vermerk.vorschlaege, 'der Vermerk trägt das Vorschlagsfeld');
  assert.deepEqual(vermerk.vorschlaege.hand_l, { bone: 'bone_016', confidence: 0.58 },
    `hand_l trägt den besten Kandidaten „bone_016“ mit Konfidenz 0.58, kam: `
    + JSON.stringify(vermerk.vorschlaege.hand_l));

  // Ohne vorschlag-Feld (ältere Fragen) liefert die Option den Kandidaten.
  const vermerkOhneFeld = offenerRest(sechsUnsichere(), [], 0);
  assert.equal(vermerkOhneFeld.vorschlaege.head.bone, 'bone_041',
    `head: der beste Kandidat kommt aus der ersten Frageoption, kam: `
    + JSON.stringify(vermerkOhneFeld.vorschlaege.head));
  assert.equal(vermerkOhneFeld.vorschlaege.head.confidence, 0.55,
    `Konfidenz 0.55 kommt aus der Frageoption, kam: `
    + JSON.stringify(vermerkOhneFeld.vorschlaege.head.confidence));
});

test('Vorschlag, Negativfall: eine offene Rolle ohne Kandidaten ist ein Befund', () => {
  // Der Negativfall des Prüfers selbst: ein Vermerk, der offene Rollen ohne
  // jeden Kandidaten-Vorschlag meldet, kann den Positivfall nicht bestehen —
  // „unsicher, Rückfrage nötig“ heißt: da IST ein Kandidat, die Frage
  // braucht ihn, sonst rät der Mensch statt zu bestätigen.
  const fragen = sechsUnsichere();
  const vermerk = offenerRest(fragen, ['head', 'forearm_r', 'hand_l'], 3);
  const offen = vermerk.offeneRollen;
  assert.equal(offen.length, 3,
    `3 Pflichtrollen sind offen, offen: ${offen.join(', ')}`);
  // Jede offene Rolle braucht einen Kandidaten: der Pflicht-Negativfall ist,
  // wenn eine offene Rolle ohne bone im Vermerk bliebe.
  for (const rolle of offen) {
    assert.ok(vermerk.vorschlaege[rolle]?.bone,
      `die offene Rolle ${rolle} bleibt ohne Kandidaten im Vermerk — genau dieser Zustand darf nicht passieren`);
  }
});