// Priors der Rückfrage — Reihenfolge und Sichtbarkeit der ausstehenden Rollen.
//
// Der Auftrag: "Bei knappem Budget werden zuerst die Rollen gefragt, ohne die
// nicht weitergearbeitet werden kann." Sechs unsichere Rollen und drei Fragen
// Budget (plan.md 6.7) bedeuten ohne Rangfolge, dass eine Pflichtrolle
// ungeklärt bleibt, während eine Fingerrolle gefragt wird — bei einem
// Standard-Mixamo-Rig gemessen: 6 in der Rückfragezone, Budget 3, 3 offen.
//
// Regel 1 (AGENTS.md): die Pflichtrollen werden nicht hier getippt. Sie sind
// kein Körpermaß, sondern Vertragsinhalt; die verbindliche Quelle ist
// src/contracts/rig-profile.js, das sie als Pflichtprüfung fährt. Diese Datei
// nimmt dieselben drei Namen an — und das Abnahmetest-Negativfall-Paar
// prueft, dass der Vertragsprüfer ohne genau diese drei ablehnt.
//
// Diese Datei ist reine Logik ohne DOM und ohne Broker; der Test läuft in Node.

/** Rollen, ohne die das Modell abgelehnt wird (plan.md 5.1, Vertragspflicht
 *  in src/contracts/rig-profile.js). Sie werden bei knappem Budget zuerst
 *  gefragt — die Abnahmetabelle nennt sie "Pflichtrollen". */
export const PFLICHTROLLEN = ['pelvis', 'foot_l', 'foot_r'];

/**
 * Sortiert die offenen Rollenfragen nach Dringlichkeit: Pflichtrollen zuerst,
 * danach die übrigen nach aufsteigender Konfidenz (die unsicherste Zuordnung
 * zuerst). Aus der Rückfragezone heraus, d. h. alle Eingaben sind offen.
 *
 * @param {object[]} fragen  Fragen im Format von detect.js (plan.md 5.1),
 *        je { art: 'rollenbestaetigung', rolle, frage, optionen }
 * @returns {object[]} dieselben Fragen, in der Reihenfolge, in der sie beim
 *        Menschen landen sollen; Pflichtrollen zuerst, dann die übrigen.
 */
export function priorisiereFragen(fragen) {
  const liste = Array.isArray(fragen) ? fragen : [];
  const pflicht = [];
  const rest = [];
  for (const f of liste) {
    const rolle = f && f.rolle;
    if (PFLICHTROLLEN.includes(rolle)) pflicht.push(f);
    else rest.push(f);
  }
  /** Unsicherere Zuordnung zuerst — mehr Fragen nütze sie dem Menschen mehr. */
  const konfidenzAufsteigend = (a, b) => {
    const ka = a?.optionen?.[0]?.confidence ?? 0;
    const kb = b?.optionen?.[0]?.confidence ?? 0;
    return ka - kb;
  };
  pflicht.sort(konfidenzAufsteigend);
  rest.sort(konfidenzAufsteigend);
  return [...pflicht, ...rest];
}

/**
 * Der offene Rest: Rollen, die nach dem Abfragen noch ungeklärt sind. Wird
 * als Datumsfeld UND als Meldungstext ausgegeben — "kein stilles
 * Verschlucken" (Auftrag). Jede offene Rolle trägt den Vorschlag der
 * Erkennung (besten Kandidaten samt Konfidenz) mit — eine offene Rolle ist
 * „unsicher, Rückfrage nötig“, nicht ohne Kandidaten.
 *
 * @param {object[]} fragen    die offenen Fragen vor dem Abfragen, im Format
 *        von detect.js, je mit rolle
 * @param {string[]} beantwortet Rollen, die beantwortet/festgelegt wurden
 * @param {number}   budget    das Fragebudget, das zur Verfügung stand
 * @returns {{offeneRollen: string[], meldung: string}}
 */
export function offenerRest(fragen, beantwortet, budget) {
  const liste = fragen ?? [];
  const alle = liste
    .map((f) => f?.rolle)
    .filter((r) => typeof r === 'string' && r.length > 0);
  const offene = alle.filter((r) => !beantwortet.includes(r));
  const vorschlaege = {};
  for (const f of liste) {
    if (typeof f?.rolle !== 'string' || beantwortet.includes(f.rolle)) continue;
    const v = f?.vorschlag ?? f?.optionen?.[0];
    if (v?.bone !== undefined) {
      vorschlaege[f.rolle] = { bone: v.bone, confidence: v.confidence ?? 0 };
    }
  }
  const meldung = `${offene.length} von ${alle.length} unsicheren Rollen blieben ungefragt`
    + ` (Budget: ${budget} Frage${budget === 1 ? '' : 'n'}): `
    + `${offene.join(', ') || 'keine'}`;
  return { offeneRollen: offene, vorschlaege, meldung };
}