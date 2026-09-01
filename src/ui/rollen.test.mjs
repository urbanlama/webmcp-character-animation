// Mensch-Moment 1 aus docs/plan.md 6.7: unsichere Rollen nach dem Upload.
//
// Geprueft wird der Ablauf, nicht die Erkennung: die Fragen kommen als
// Attrappe im Format aus plan.md 5.1 herein, so wie detectRig() sie liefert.
// Positivfall: der Klick legt die Rolle ueber confirm_role fest.
// Negativfall: Abbruch legt nichts fest und raet nichts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolLayer } from '../tools/index.js';
import { frageRollenAb, ABLEHNUNG } from './rollen-bestaetigung.js';

/** Attrappe im Format von detectRig(): zwei unsichere Rollen. */
function profilMitZweiFragen() {
  return {
    schemaVersion: 1,
    roles: {
      pelvis: { bone: 'mixamorigHips', confidence: 1.0 },
      foot_l: { bone: 'mixamorigLeftFoot', confidence: 0.62 },
      foot_r: { bone: 'mixamorigRightFoot', confidence: 0.58 }
    },
    questions: [
      {
        art: 'rollenbestaetigung', rolle: 'foot_l',
        frage: 'Ist „mixamorigLeftFoot“ die Rolle foot_l? Vorschlag mit Konfidenz 0.62, sicher ab 0.9.',
        optionen: [
          { text: 'ja, „mixamorigLeftFoot“', bone: 'mixamorigLeftFoot', confidence: 0.62 },
          { text: 'nein, sondern „mixamorigRightFoot“', bone: 'mixamorigRightFoot', confidence: 0 }
        ]
      },
      {
        art: 'rollenbestaetigung', rolle: 'foot_r',
        frage: 'Ist „mixamorigRightFoot“ die Rolle foot_r? Vorschlag mit Konfidenz 0.58, sicher ab 0.9.',
        optionen: [
          { text: 'ja, „mixamorigRightFoot“', bone: 'mixamorigRightFoot', confidence: 0.58 },
          { text: 'nein, sondern „mixamorigLeftFoot“', bone: 'mixamorigLeftFoot', confidence: 0 }
        ]
      }
    ]
  };
}

/** Mitschrift statt Szene: was geleuchtet hat und was am Ende aus ist. */
function leuchtenAttrappe() {
  const verlauf = [];
  let aktiv = [];
  return {
    verlauf,
    get aktiv() { return aktiv; },
    zeige(eintraege) { aktiv = eintraege; verlauf.push(eintraege.map((e) => e.bone)); },
    aus() { aktiv = []; }
  };
}

/** Wartet, bis der Broker eine offene Frage hat — der Moment des Klicks. */
async function warteAufFrage(schicht) {
  for (let i = 0; i < 200; i += 1) {
    if (schicht.ask.stand().wartet) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('nach 200 ms wartet keine Frage');
}

test('Rollen, Positivfall: der Klick legt die unsichere Zuordnung über confirm_role fest', async () => {
  const schicht = await createToolLayer({});
  const leuchten = leuchtenAttrappe();
  const lauf = frageRollenAb({
    profil: profilMitZweiFragen(), ask: schicht.ask, rufe: schicht.rufe, leuchten
  });

  await warteAufFrage(schicht);
  assert.deepEqual(leuchten.aktiv.map((e) => e.bone),
    ['mixamorigLeftFoot', 'mixamorigRightFoot'],
    'während der Frage leuchten genau die Knochen, über die geredet wird');
  schicht.ask.antworte(0); // „ja, mixamorigLeftFoot“

  await warteAufFrage(schicht);
  schicht.ask.antworte(0); // „ja, mixamorigRightFoot“

  const ergebnis = await lauf;
  assert.equal(ergebnis.gefragt, 2, `2 unsichere Rollen, ${ergebnis.gefragt} gefragt`);
  assert.equal(ergebnis.bestaetigt, 2, `2 Zuordnungen erwartet, ${ergebnis.bestaetigt} festgelegt`);
  assert.equal(ergebnis.offen, 0, `0 offene Rollen erwartet, ${ergebnis.offen} offen`);
  assert.equal(ergebnis.abgebrochen, false);

  const bestaetigt = schicht.store.lies().roleConfirmations;
  assert.equal(bestaetigt.foot_l, 'mixamorigLeftFoot');
  assert.equal(bestaetigt.foot_r, 'mixamorigRightFoot');
  assert.match(ergebnis.meldung, /2 von 2/);
  assert.deepEqual(leuchten.aktiv, [], 'nach der letzten Frage leuchtet nichts mehr');
});

test('Rollen: die Gegenauswahl legt den anderen Knochen fest, nicht den Vorschlag', async () => {
  const schicht = await createToolLayer({});
  const lauf = frageRollenAb({
    profil: profilMitZweiFragen(), ask: schicht.ask, rufe: schicht.rufe
  });

  await warteAufFrage(schicht);
  schicht.ask.antworte(1); // „nein, sondern mixamorigRightFoot“
  await warteAufFrage(schicht);
  schicht.ask.antworte(1); // „nein, sondern mixamorigLeftFoot“
  await lauf;

  const bestaetigt = schicht.store.lies().roleConfirmations;
  assert.equal(bestaetigt.foot_l, 'mixamorigRightFoot',
    'geklickt wurde die Korrektur, nicht der Vorschlag');
  assert.equal(bestaetigt.foot_r, 'mixamorigLeftFoot');
});

test('Rollen, Negativfall: Abbruch legt nichts fest und rät nichts', async () => {
  const schicht = await createToolLayer({});
  const leuchten = leuchtenAttrappe();
  const lauf = frageRollenAb({
    profil: profilMitZweiFragen(), ask: schicht.ask, rufe: schicht.rufe, leuchten
  });

  await warteAufFrage(schicht);
  schicht.ask.antworte(0); // die erste wird beantwortet
  await warteAufFrage(schicht);
  schicht.ask.abbrechen('die Seite wurde neu geladen'); // die zweite nicht

  const ergebnis = await lauf;
  assert.equal(ergebnis.abgebrochen, true, 'der Abbruch muss gemeldet werden');
  assert.equal(ergebnis.bestaetigt, 1,
    `1 Zuordnung war geklickt, ${ergebnis.bestaetigt} festgelegt`);
  assert.equal(ergebnis.offen, 1, `1 Rolle bleibt offen, gemeldet: ${ergebnis.offen}`);

  const bestaetigt = schicht.store.lies().roleConfirmations;
  assert.equal(Object.keys(bestaetigt).length, 1,
    `genau 1 Zuordnung darf stehen, es sind ${Object.keys(bestaetigt).length}`);
  assert.equal(bestaetigt.foot_r, undefined,
    'die abgebrochene Rolle darf nicht geraten werden');
  assert.deepEqual(leuchten.aktiv, [], 'nach dem Abbruch leuchtet nichts weiter');
});

test('Rollen: ohne Alternative bekommt der Mensch eine Ablehnung statt einer Scheinwahl', async () => {
  const schicht = await createToolLayer({});
  const profil = {
    questions: [{
      art: 'rollenbestaetigung', rolle: 'head',
      frage: 'Ist „bone_041“ die Rolle head? Vorschlag mit Konfidenz 0.55, sicher ab 0.9.',
      optionen: [{ text: 'ja, „bone_041“', bone: 'bone_041', confidence: 0.55 }]
    }]
  };
  const lauf = frageRollenAb({ profil, ask: schicht.ask, rufe: schicht.rufe });

  await warteAufFrage(schicht);
  const gestellt = schicht.ask.stand();
  assert.equal(gestellt.wartet, true);
  schicht.ask.antworte(1); // die ergänzte Ablehnung

  const ergebnis = await lauf;
  assert.equal(ergebnis.bestaetigt, 0,
    `eine Ablehnung legt 0 Rollen fest, es waren ${ergebnis.bestaetigt}`);
  assert.equal(ergebnis.offen, 1);
  assert.equal(Object.keys(schicht.store.lies().roleConfirmations).length, 0,
    'nach einer Ablehnung steht keine Zuordnung im Zustand');
  assert.equal(ABLEHNUNG, 'Weiß ich nicht — offen lassen');
});

test('Rollen: die Seitenfrage legt beide Seiten auf einmal fest', async () => {
  const schicht = await createToolLayer({});
  const profil = {
    questions: [{
      art: 'seitenverwechslung', rollen: ['foot_l', 'foot_r'],
      frage: 'Die Blickrichtung ist nicht messbar: 0 von 3 Richtungssignalen über der Grenze. '
        + 'Welcher Fuß ist links — „boneA“ oder „boneB“?',
      optionen: [
        { text: '„boneA“ ist links', zuordnung: { foot_l: 'boneA', foot_r: 'boneB' } },
        { text: '„boneB“ ist links', zuordnung: { foot_l: 'boneB', foot_r: 'boneA' } }
      ]
    }]
  };
  const lauf = frageRollenAb({ profil, ask: schicht.ask, rufe: schicht.rufe });

  await warteAufFrage(schicht);
  schicht.ask.antworte(1); // boneB ist links
  const ergebnis = await lauf;

  assert.equal(ergebnis.bestaetigt, 2,
    `eine Seitenfrage legt 2 Rollen fest, es waren ${ergebnis.bestaetigt}`);
  const bestaetigt = schicht.store.lies().roleConfirmations;
  assert.equal(bestaetigt.foot_l, 'boneB');
  assert.equal(bestaetigt.foot_r, 'boneA');
});

test('Rollen: bei Budget 0 läuft die Bestätigung trotzdem (plan.md 6.7, kein Notausgang)', async () => {
  const schicht = await createToolLayer({ budget: 0 });
  const lauf = frageRollenAb({
    profil: profilMitZweiFragen(), ask: schicht.ask, rufe: schicht.rufe
  });

  await warteAufFrage(schicht);
  schicht.ask.antworte(0);
  await warteAufFrage(schicht);
  schicht.ask.antworte(0);
  const ergebnis = await lauf;

  assert.equal(ergebnis.gefragt, 2,
    `auch bei 0 Fragen Budget müssen 2 Pflichtfragen kommen, es waren ${ergebnis.gefragt}`);
  assert.equal(ergebnis.bestaetigt, 2);
  assert.equal(schicht.ask.stand().uebrig, 0,
    'Pflichtfragen verbrauchen kein Budget: 0 von 0 bleiben übrig');
});

test('Rollen: ein Profil ohne offene Fragen fragt nichts', async () => {
  const schicht = await createToolLayer({});
  const ergebnis = await frageRollenAb({
    profil: { roles: { pelvis: { bone: 'hips', confidence: 1 } }, questions: [] },
    ask: schicht.ask, rufe: schicht.rufe
  });

  assert.equal(ergebnis.gefragt, 0, `0 Fragen erwartet, ${ergebnis.gefragt} gestellt`);
  assert.equal(schicht.ask.stand().wartet, false, 'es darf keine Frage offen stehen');
  assert.equal(schicht.ask.stand().uebrig, 3, 'das Budget bleibt bei 3 von 3 Fragen');
});
