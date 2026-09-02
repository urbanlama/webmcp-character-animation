// Abnahmetest — "Kein Text schickt den Agenten zu einem Werkzeug, das er nicht hat".
//
// Fünf Werkzeuge liegen in der Kiste und werden nicht registriert: confirm_role,
// add_phase, edit_phase, set_target, ask_human. Ein Ratschlag, der eines davon
// nennt, kostet den Agenten einen Aufruf und liefert ihm "Tool not found" —
// Reibung ohne Gegenwert.
//
// Gefunden am 1. September 2026 in registry.js: nach einem Absturz riet die
// Meldung "frage den Menschen mit ask_human", nachdem ask_human aus dem
// sichtbaren Katalog genommen worden war.
//
// Der Test in seiner ersten Fassung prüfte nur Werkzeugbeschreibungen und eine
// Handvoll Fehlerpfade. Er fand fünf weitere Stellen NICHT, alle in
// handlers.js: die Stillstandsmeldung ("Phasen mit add_phase"), die
// Arbeitsebenen in describe_world (set_target, add_phase), den Rollenhinweis
// in describe_rig (confirm_role) und die Längenmeldung von set_duration
// ("kürze die Phasen zuerst mit edit_phase"). Deshalb prüft er jetzt drei
// Wege:
//
//   1. die sichtbaren Werkzeugbeschreibungen (wie bisher),
//   2. die Texte, die die Handler zur Laufzeit erzeugen — Fehlerpfade,
//      describe_world und die Stillstandsmeldung,
//   3. den Quelltext der Handler SICHTBARER Werkzeuge: jedes Stringliteral
//      darin, ohne Kommentare. Das findet auch Zweige, die kein Testfall
//      erreicht — der set_duration-Zweig braucht angelegte Phasen, und
//      Phasen legt nur ein Kistenwerkzeug an.
//
// Negativfall: ein absichtlich eingeschleuster Verweis muss auf jedem der drei
// Wege auffallen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createToolLayer, KATALOG_SICHTBAR, KISTE } from './index.js';
import { ebenenText, standMeldung, rigTabelle } from './handlers.js';

const HANDLERS_JS = fileURLToPath(new URL('./handlers.js', import.meta.url));

/** Nennt der Text eines der Kistenwerkzeuge? */
function verweise(text) {
  return KISTE.filter((name) => new RegExp(`\\b${name}\\b`).test(String(text ?? '')));
}

// ─────────────────────────────────────────────────────────────────────────────
// Quelltext: Stringliterale je Handler, Kommentare ausgenommen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alle Stringliterale einer JS-Datei mit ihrer Position, OHNE Kommentare.
 * Ein Zeichen-für-Zeichen-Lauf statt eines Regex: ein `//` in einem Literal
 * ("http://…") würde sonst den Rest der Zeile verschlucken, und ein
 * Anführungszeichen in einem Kommentar ("bestätige sie mit confirm_role")
 * würde als Text gezählt, obwohl es keiner ist.
 */
function literale(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = i;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === c) { i++; break; }
        i++;
      }
      out.push({ text: src.slice(start + 1, i - 1), at: start });
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Zerlegt handlers.js in die Blöcke der einzelnen Werkzeuge. Ein Handler
 * beginnt mit `async name(` — mit oder ohne Argument, describe_world und undo
 * nehmen keins; sein Block reicht bis zum nächsten.
 * Alles vor dem ersten Handler sind gemeinsame Helfer — die prüft Weg 2
 * zur Laufzeit, weil sie (ebenenText) den sichtbaren Katalog selbst
 * auswerten und statisch zwangsläufig Kistennamen enthalten.
 */
function handlerBloecke(src) {
  const treffer = [...src.matchAll(/^\s{4}async\s+([a-z_]+)\s*\(/gm)]
    .map((m) => ({ name: m[1], at: m.index }));
  return treffer.map((t, k) => ({
    name: t.name,
    von: t.at,
    bis: k + 1 < treffer.length ? treffer[k + 1].at : src.length,
  }));
}

/** Verweise auf Kistenwerkzeuge in den Handlern der sichtbaren Werkzeuge. */
function verweiseImQuelltext(src) {
  const sichtbar = new Set(KATALOG_SICHTBAR.map((t) => t.name));
  const bloecke = handlerBloecke(src).filter((b) => sichtbar.has(b.name));
  const lits = literale(src);
  const treffer = [];
  for (const b of bloecke) {
    for (const l of lits) {
      if (l.at < b.von || l.at >= b.bis) continue;
      // Der blosse Werkzeugname ist eine Id (tool: 'add_phase'), kein Rat.
      if (KISTE.includes(l.text.trim())) continue;
      for (const ziel of verweise(l.text)) {
        treffer.push(`${b.name} → ${ziel}: „${l.text.slice(0, 60)}"`);
      }
    }
  }
  return treffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weg 1: Beschreibungen
// ─────────────────────────────────────────────────────────────────────────────

test('Verweise: keine sichtbare Werkzeugbeschreibung nennt ein Kistenwerkzeug', () => {
  const treffer = [];
  for (const t of KATALOG_SICHTBAR) {
    const text = `${t.description} ${JSON.stringify(t.inputSchema ?? {})}`;
    for (const name of verweise(text)) treffer.push(`${t.name} → ${name}`);
  }
  assert.deepEqual(treffer, [],
    `${treffer.length} Beschreibungen schicken den Agenten ins Leere: ${treffer.join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Weg 2: Texte zur Laufzeit
// ─────────────────────────────────────────────────────────────────────────────

test('Verweise: keine Fehlermeldung schickt den Agenten in die Kiste', async () => {
  const schicht = await createToolLayer({});

  // Eine Auswahl echter Fehlerpfade, jeder mit falschen Argumenten ausgeloest.
  const faelle = [
    ['set_duration', { frameCount: -5 }],
    ['describe_pose', { frame: 99999 }],
    ['set_pose', { frame: 0 }],
    ['set_intent', { checks: [{ kind: 'travel', part: 'com' }] }],
    ['measure', { frames: [0], fragen: [{ art: 'gibt_es_nicht', a: 'com' }] }],
    ['look', { frames: [0], views: ['schraeg'] }],
    ['probe_joint', { joint: 'gibt_es_nicht', angleDeg: 10 }],
    ['probe_joint', { joint: 'hip_l', angleDeg: 10, channel: 'gibt_es_nicht' }],
    ['move_pose', { von: 0, nach: 0 }],
    ['delete_pose', { frame: 99999 }],
    ['hold_foot', { foot: 'gibt_es_nicht', von: 0, bis: 5 }],
  ];

  const treffer = [];
  for (const [name, args] of faelle) {
    const antwort = await schicht.rufe(name, args);
    const text = (antwort.content ?? []).map((c) => c.text ?? '').join(' ');
    for (const ziel of verweise(text)) treffer.push(`${name} → ${ziel}`);
  }
  assert.deepEqual(treffer, [],
    `${treffer.length} Fehlermeldungen raten zu einem Kistenwerkzeug: ${treffer.join(', ')}`);
});

test('Verweise: describe_world empfiehlt nur Werkzeuge, die auch registriert sind', async () => {
  const schicht = await createToolLayer({});
  const antwort = await schicht.rufe('describe_world', {});
  const text = (antwort.content ?? []).map((c) => c.text ?? '').join(' ');

  const treffer = verweise(text);
  assert.deepEqual(treffer, [],
    `describe_world nennt ${treffer.length} Kistenwerkzeuge: ${treffer.join(', ')} — `
    + 'die Anleitung ist das Erste, was der Agent liest');

  // Die Arbeitsebenen kommen aus dem sichtbaren Katalog, nicht aus einer
  // festen Liste: alles, was drinsteht, muss registriert sein.
  const ebenen = Object.values(ebenenText()).join(' ');
  assert.deepEqual(verweise(ebenen), [],
    `die Ebenenliste nennt ein Kistenwerkzeug: ${ebenen}`);
  assert.ok(Object.keys(ebenenText()).length >= 1,
    'mindestens die erste Ebene (set_pose / set_joint) muss übrig bleiben');
});

test('Verweise: die Stillstandsmeldung rät nur zu sichtbaren Werkzeugen', () => {
  // Genau der Fall, in dem sie erscheint: eine Timeline, in der sich nichts
  // bewegt. Hier stand „Setze Posen mit set_pose oder Phasen mit add_phase".
  const text = standMeldung(
    { phases: [], overrides: {}, frameCount: 10 },
    {
      bewegung: { schwerpunktWeg_m: 0, wurzelDrehungWeg_grad: 0, toteFrames: 10, frames: 10 },
      lucken: [],
    });
  assert.match(text, /steht still/, 'der Testfall muss die Stillstandsmeldung wirklich auslösen');
  assert.deepEqual(verweise(text), [],
    `die Stillstandsmeldung nennt ein Kistenwerkzeug: ${text}`);
});

test('Verweise: der Rollenhinweis in describe_rig nennt kein Kistenwerkzeug', () => {
  // Am Xbot hat jede Pflichtrolle Konfidenz 1, der Zweig läuft dort nie. Hier
  // steht deshalb ein Rig-Bericht mit einer unsicheren Rolle — genau der Fall,
  // für den der Satz gedacht ist. Er hieß „korrigiere sie mit confirm_role",
  // und confirm_role liegt in der Kiste.
  const text = rigTabelle({
    joints: { hip_l: { bone: 'LeftUpLeg', dof: { flex: { axis: 'x', sign: 1, limit: [-30, 130] } } } },
    roles: {
      pelvis: { bone: 'Hips', confidence: 1 },
      foot_l: { bone: 'LeftFoot', confidence: 0.62 },
      foot_r: { bone: 'RightFoot', confidence: 1 },
    },
  });
  assert.match(text, /weniger als voller Sicherheit/,
    'der Testfall muss den Rollenhinweis wirklich auslösen');
  assert.match(text, /foot_l = LeftFoot \(0\.62\)/,
    'der Hinweis muss Rolle, Knochen und Konfidenz nennen');
  assert.deepEqual(verweise(text), [],
    `der Rollenhinweis nennt ein Kistenwerkzeug: ${text}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Weg 3: Quelltext der sichtbaren Handler
// ─────────────────────────────────────────────────────────────────────────────

test('Verweise: kein Handler eines sichtbaren Werkzeugs nennt ein Kistenwerkzeug', () => {
  const src = readFileSync(HANDLERS_JS, 'utf8');
  const treffer = verweiseImQuelltext(src);
  assert.deepEqual(treffer, [],
    `${treffer.length} Stellen in handlers.js raten zu einem Kistenwerkzeug:\n  `
    + treffer.join('\n  '));
});

test('Verweise: der Quelltextlauf sieht alle sichtbaren Handler', () => {
  const src = readFileSync(HANDLERS_JS, 'utf8');
  const namen = new Set(handlerBloecke(src).map((b) => b.name));
  const fehlend = KATALOG_SICHTBAR.map((t) => t.name).filter((n) => !namen.has(n));
  assert.deepEqual(fehlend, [],
    `${fehlend.length} sichtbare Werkzeuge haben keinen erkannten Handlerblock: ${fehlend.join(', ')} — `
    + 'dann prüft der Quelltextlauf sie nicht, und der Positivfall ist wertlos');
});

// ─────────────────────────────────────────────────────────────────────────────
// Negativfälle
// ─────────────────────────────────────────────────────────────────────────────

test('Verweise, Negativfall: ein gesetzter Verweis wird gefunden', () => {
  assert.deepEqual(verweise('frage den Menschen mit ask_human'), ['ask_human'],
    'der alte Rat aus registry.js muss auffallen');
  assert.deepEqual(verweise('nimm add_phase statt set_pose'), ['add_phase']);
  assert.deepEqual(verweise('bestätige sie mit confirm_role'), ['confirm_role'],
    'confirm_role liegt seit dem Abschalten der Rollen-Rückfrage in der Kiste');
  assert.deepEqual(verweise('rufe getTools() auf und versuche es erneut'), [],
    'ein Rat auf ein sichtbares Werkzeug faellt nicht auf');
});

test('Verweise, Negativfall: ein eingeschleuster Verweis im Quelltext wird rot', () => {
  const src = readFileSync(HANDLERS_JS, 'utf8');
  // Denselben Satz einschleusen, der in set_duration stand, in den Handler
  // eines sichtbaren Werkzeugs.
  const marke = 'async set_duration(args) {';
  assert.ok(src.includes(marke), `Ankerstelle „${marke}" nicht gefunden`);
  const verseucht = src.replace(marke,
    marke + "\n      const rat = 'kürze die Phasen zuerst mit edit_phase';\n      void rat;");

  const treffer = verweiseImQuelltext(verseucht);
  assert.equal(treffer.length, 1,
    `der eingeschleuste Verweis muss gefunden werden, gefunden wurden ${treffer.length}`);
  assert.match(treffer[0], /set_duration → edit_phase/);

  // Und ein Kommentar mit demselben Wortlaut darf NICHT anschlagen: sonst
  // müsste jede Begründung im Code umschrieben werden.
  const nurKommentar = src.replace(marke,
    marke + "\n      // frueher stand hier: kuerze die Phasen zuerst mit edit_phase");
  assert.deepEqual(verweiseImQuelltext(nurKommentar), [],
    'ein Kommentar ist kein Rat an den Agenten');
});
