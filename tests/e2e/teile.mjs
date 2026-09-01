// AP8 — Vertikalschnitt: das Teile-Fenster.
//
// Aufgabe dieser Datei ist nur EINE Frage: Ist das Bauteil dieses Schritts da,
// und wenn ja, unter welchem Namen? Sie beantwortet sie durch Hinüberschauen,
// nie durch Bauen. Kein hier erzeugtes Objekt rechnet Phasen zu Posen, keins
// erfindet Körpermaße.
//
// Warum das ausgelagert ist: src/solver/, src/render/strip.js,
// src/validate/report.js und src/export/gltf.js entstehen parallel. Findet
// dieses Fenster ein Bauteil nicht, meldet es Grund und Zahl — der Schnitt läuft
// dann bis hierher und endet sauber. Wächst das Bauteil nach, rückt der Schnitt
// von selbst weiter, ohne dass jemand ihn umbaut.
//
// Die drei Kategorien, die hier streng getrennt werden:
//   fehlt      Datei nicht da            -> "noch nicht verfügbar"
//   kaputt     Datei da, lädt nicht      -> Abbruch mit Datei und Fundstelle
//   da         Datei lädt, Export fehlt  -> "noch nicht verfügbar", mit der
//                                           tatsächlichen Exportliste
//
// These Plattformfreiheit: diese Datei importiert kein node:*. Sie läuft in Node
// und im Browser. Woher eine Datei kommt und ob sie da ist, gibt die Umgebung
// als Funktionen hinein (moduleUrl, existiert).

/** Eintrittsnamen, unter denen der Phasenlöser zu finden ist. */
export const LOESER_NAMEN = [
  'loeseBewegung',
  'loese', 'loeseTimeline', 'loesePhasen', 'loeseVorgang', 'loeseAlle', 'loeser',
];

/** Ein Ladeversuch, der alles meldet, aber nichts wirft. */
async function versuche(moduleUrl, datei, existiert) {
  const url = moduleUrl(datei);
  try {
    const modul = await import(url);
    return { geladen: true, modul, exporte: Object.keys(modul) };
  } catch (err) {
    const name = err && err.name ? String(err.name) : 'Fehler';
    const text = err && err.message ? String(err.message) : String(err);
    // Fundstelle: die erste Stackzeile, die auf diese Datei zeigt, mit Zeilenzahl.
    const stapel = String((err && err.stack) || '');
    const basis = datei.split('/').pop();
    const zeile = stapel.split('\n').find((z) => z.includes(basis)) || '';
    const ort = zeile.match(new RegExp(`${basis.replace(/\./g, '\\.')}:(\\d+)`));
    const stelle = ort ? `${basis}:${ort[1]}` : null;
    let da = false;
    try { da = await existiert(datei); } catch { da = false; }
    return {
      geladen: false,
      vorhanden: da,
      grund: da
        ? `Datei ist da, lässt sich aber nicht laden: ${name}: ${text}`
          + (stelle ? ` (Fundstelle ${stelle})` : '')
        : `Datei fehlt: ${datei} (0 von 1 erwarteten Dateien gefunden)`,
      meldung: text,
    };
  }
}

/**
 * Prüft ein Bauteil auf Da-sein und die Anwesenheit seiner Eintrittspunkte.
 *
 * @param {object} opt
 * @param {(datei:string)=>string} opt.moduleUrl  Datei -> importierbare URL
 * @param {(datei:string)=>Promise<boolean>} opt.existiert  ist die Datei da?
 * @param {string} opt.datei  Pfad im Repository, z. B. 'src/rig/measure.js'
 * @param {string[]} [opt.exporte]  erwartete Exporte (Funktionen)
 * @param {string} [opt.paket]  Paketname für Meldungen, z. B. 'AP2'
 */
export async function bauteilPruefen({ datei, exporte = [], paket = '', moduleUrl, existiert }) {
  const versuch = await versuche(moduleUrl, datei, existiert);
  const kenner = paket ? `${paket} — ${datei}` : datei;
  if (!versuch.geladen) {
    return {
      datei, paket, verfuegbar: false, vorhanden: versuch.vorhanden,
      laedt: false, exporte: [],
      grund: versuch.grund,
      meldung: `noch nicht verfügbar: ${kenner}, ${versuch.grund}`,
    };
  }
  const fehlen = exporte.filter((n) => typeof versuch.modul[n] !== 'function');
  if (fehlen.length > 0) {
    return {
      datei, paket, verfuegbar: false, vorhanden: true, laedt: true,
      modul: versuch.modul, exporte: versuch.exporte, fehlen,
      grund: `${fehlen.length} von ${exporte.length} benötigten Eintrittspunkten fehlen `
        + `(${fehlen.join(', ')}); die Datei liefert ${versuch.exporte.length} Exporte `
        + `[${versuch.exporte.join(', ')}]`,
      meldung: `noch nicht verfügbar: ${kenner}, ${fehlen.length} von ${exporte.length} `
        + `benötigten Funktionen fehlen (${fehlen.join(', ')})`,
    };
  }
  return {
    datei, paket, verfuegbar: true, vorhanden: true, laedt: true,
    modul: versuch.modul, exporte: versuch.exporte,
    grund: null, meldung: null,
  };
}

/**
 * Sucht den Phasenlöser: die eine Funktion, die eine Timeline mit `phases` in
 * `solved.frames` überführt. Diese Funktion ist das Herz von plan.md 6.3 und
 * entsteht parallel — deshalb wird sie gesucht, nicht vorausgesetzt.
 *
 * Die Suche ist absichtlich breit: jede Datei unter src/solver/ wird geladen
 * und gegen LOESER_NAMEN geprüft. So rückt der Schnitt weiter, sobald AP5 den
 * Eintrittspunkt unter einem der Namen exportiert, ohne dass hier jemand
 * umbauen muss.
 *
 * @param {object} opt
 * @param {string[]} opt.dateien  vorhandene src/solver/*.js (von der Umgebung
 *                                aufgezählt, damit Node und Browser dasselbe sehen)
 */
export async function loeserSuchen({ dateien, moduleUrl, existiert }) {
  const probe = [];
  let exportGesamt = 0;
  let ladeFehler = 0;
  let treffer = null;

  for (const datei of dateien) {
    const versuch = await versuche(moduleUrl, datei, existiert);
    if (!versuch.geladen) {
      ladeFehler += 1;
      probe.push({ datei, status: 'lädt nicht', grund: versuch.grund });
      continue;
    }
    const namen = versuch.exporte.filter((n) => typeof versuch.modul[n] === 'function');
    exportGesamt += versuch.exporte.length;
    const gefundenen = LOESER_NAMEN.filter((n) => namen.includes(n));
    probe.push({
      datei, status: gefundenen.length > 0 ? 'Treffer' : 'kein Eintrittspunkt',
      funktionen: namen.length, exporte: versuch.exporte.length,
      treffer: gefundenen,
    });
    if (gefundenen.length > 0 && !treffer) {
      treffer = { datei, name: gefundenen[0], modul: versuch.modul };
    }
  }

  if (treffer) {
    return {
      verfuegbar: true, dateien: dateien.length, exportGesamt, probe,
      ...treffer, grund: null, meldung: null,
    };
  }
  const da = dateien.length - ladeFehler;
  return {
    verfuegbar: false, dateien: dateien.length, ladbar: da, exportGesamt, probe,
    grund: `kein Eintrittspunkt, der Phasen zu Frames macht — ${LOESER_NAMEN.length} Namen `
      + `(${LOESER_NAMEN.join(', ')}) gegen ${exportGesamt} Exporte aus ${dateien.length} `
      + `Dateien unter src/solver/ geprüft (${da} davon laden; Phasenverben gibt es bereits, `
      + `aber keine Zusammenführung in einer Timeline)`,
    meldung: `noch nicht verfügbar: Phasenlöser (src/solver/), kein Eintrittspunkt von `
      + `${LOESER_NAMEN.length} gesuchten Namen in ${exportGesamt} Exporten aus `
      + `${dateien.length} Dateien`,
  };
}
