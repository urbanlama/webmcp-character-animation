// Fester Mensch-Moment 1 aus docs/plan.md 6.7: nach dem Upload unsichere
// Rollen bestaetigen.
//
// Die Schwellen stehen nicht hier. src/rig/detect.js vergibt Rollen mit
// Konfidenz und legt fertige Fragen in `questions` ab — sicher ab 0,90, gefragt
// ab 0,50, darunter bleibt der Knochen ohne Rolle (plan.md 5.1). Wer diese
// Zahlen hier noch einmal aufschreibt, hat sie zweimal und irgendwann
// verschieden. Diese Datei nimmt die Fragen entgegen, laesst den fraglichen
// Knochen leuchten, fragt den Menschen und schreibt seine Antwort ueber das
// Werkzeug confirm_role fest.
//
// Kein DOM: das Leuchten und das Fragen kommen als Anschluesse herein, damit
// der Ablauf in Node pruefbar ist.
//
// Frageformat aus detect.js (plan.md 5.1):
//   { art: 'rollenbestaetigung', rolle, frage, optionen: [{text, bone, confidence}] }
//   { art: 'seitenverwechslung', rollen, frage, optionen: [{text, zuordnung}] }

/** Pflichtfragen kosten kein Budget — die drei Momente aus 6.7 sind
 * ausdruecklich "kein Notausgang", auch bei einem Budget von 0 Fragen. */
const PFLICHT = true;

/** Eine Frage mit nur einer Antwortmoeglichkeit ist keine Frage. Findet
 * detect.js keine Alternative, kommt diese Ablehnung dazu: der Mensch muss
 * einen Vorschlag ablehnen koennen, ohne ihn zu ersetzen. */
export const ABLEHNUNG = 'Nein, Rolle offen lassen';

/**
 * Fragt alle offenen Rollen der Reihe nach ab.
 *
 * @param {object}   opt
 * @param {object}   opt.profil     Bericht aus detectRig(), plan.md 5.1
 * @param {object}   opt.ask        Broker aus createAskBroker()
 * @param {Function} opt.rufe       schicht.rufe(name, args) der Werkzeugschicht
 * @param {object}   [opt.leuchten] { zeige(eintraege), aus() } fuer die Szene
 * @returns {Promise<{gefragt: number, bestaetigt: number, offen: number,
 *                    abgebrochen: boolean, zuordnungen: object, meldung: string}>}
 */
export async function frageRollenAb({ profil, ask, rufe, leuchten = null }) {
  const fragen = Array.isArray(profil?.questions) ? profil.questions : [];
  const zuordnungen = {};
  let gefragt = 0;
  let offen = 0;
  let abgebrochen = false;

  try {
    for (const f of fragen) {
      const optionen = mitAblehnung(f.optionen);
      leuchten?.zeige(kandidaten(f, optionen));
      gefragt += 1;

      let antwort;
      try {
        antwort = await ask.frage({
          pflicht: PFLICHT,
          question: f.frage,
          options: optionen.map((o) => o.text)
        });
      } catch (err) {
        // Abbruch oder Neuladen. Was vorher geklickt wurde, steht schon fest;
        // der Rest bleibt offen. Nichts wird an seiner Stelle geraten.
        abgebrochen = true;
        offen += fragen.length - gefragt + 1;
        break;
      }

      const gewaehlt = optionen[antwort.index];
      const neu = festlegungen(f, gewaehlt);
      if (Object.keys(neu).length === 0) {
        offen += 1;
        continue;
      }
      for (const [rolle, bone] of Object.entries(neu)) {
        await rufe('confirm_role', { role: rolle, bone });
        zuordnungen[rolle] = bone;
      }
    }
  } finally {
    leuchten?.aus();
  }

  const bestaetigt = Object.keys(zuordnungen).length;
  return {
    gefragt, bestaetigt, offen, abgebrochen, zuordnungen,
    meldung: `${gefragt} von ${fragen.length} unsicheren Zuordnungen gefragt, `
      + `${bestaetigt} festgelegt, ${offen} offen`
      + (abgebrochen ? ' — abgebrochen' : '')
  };
}

/** Was der Mensch waehlen kann. Eine einzelne Moeglichkeit ist keine Wahl. */
function mitAblehnung(optionen) {
  const liste = Array.isArray(optionen) ? optionen.slice() : [];
  if (liste.length >= 2) return liste;
  return [...liste, { text: ABLEHNUNG }];
}

/** Welche Knochen zu dieser Frage leuchten sollen, in der Reihenfolge der Karten. */
function kandidaten(frage, optionen) {
  const aus = [];
  optionen.forEach((o, i) => {
    if (o.bone) aus.push({ bone: o.bone, marke: String(i + 1) });
    else if (o.zuordnung) {
      for (const bone of Object.values(o.zuordnung)) {
        if (!aus.some((k) => k.bone === bone)) aus.push({ bone, marke: String(i + 1) });
      }
    }
  });
  return aus;
}

/** Was die geklickte Antwort festlegt: Rolle -> Knochen. Leer heisst offen. */
function festlegungen(frage, gewaehlt) {
  if (!gewaehlt) return {};
  if (gewaehlt.zuordnung) return { ...gewaehlt.zuordnung };
  if (gewaehlt.bone && frage.rolle) return { [frage.rolle]: gewaehlt.bone };
  return {};
}
