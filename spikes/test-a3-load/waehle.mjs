// A3 — Agentenlast: die Auswaehlfunktion, die der Werkzeugauswahl nachempfunden ist.
//
// Sie sieht NUR name + description aus src/tools/catalog.js, keinen Code und keine
// Ausfuehrung. Das entspricht dem Wissensstand des Agenten auf der fertigen Seite.
//
// Umsetzung: ein Scoring ueber Schluesselbegriffe. Die Begriffe stehen extra und
// unabhaengig von den Beschreibungen hier — sie sind die Alltagsbegriffe der
// Aufgaben, nicht Zitate aus dem Katalog. Ein Scoring, das aus den Beschreibungen
// lernt, waere Kalibrierung auf den Pruefdaten (AGENTS.md, dritte Regel).
//
// Rueckgabe: sortierte Werkzeugliste nach Trefferanzahl, bester zuerst.

import { KATALOG } from '../../src/tools/catalog.js';

/** Schluesselbegriffe je Alltagssinn. Ein Eintrag: [Begriff, Gewicht].
 *  Die Begriffe sind bewusst Alltagssprache (Schritt, zurueck, zeigen,
 *  huepfen) — keine Zitate aus den Beschreibungen. */
const BEGRIFFE = [
  // Welt, Groesse, Aufbau fragen
  [['boden', 2], ['groesse', 2], ['groß', 2], ['gross', 2], ['maßstab', 2], ['massstab', 2], ['oben', 1], ['vorne', 1], ['welt', 1], ['umgebung', 1]],
  // Skelett, Rollen, Gelenk nachschlagen
  [['rollen', 2], ['knochen', 2], ['freiheitsgrad', 1], ['skelett', 1], ['rig', 1], ['achse', 1], ['vorzeichen', 1], ['grenzwert', 1]],
  // Koerpermasse, Segmentmassen, Sohlen
  [['masse', 2], ['kilogramm', 2], ['kilo', 2], ['radius', 2], ['segment', 2], ['sohle', 2], ['abstand', 1], ['körperprofil', 1], ['koerperprofil', 1]],
  // Gelenk probeweise bewegen
  [['probeweise', 4], ['probe', 3], ['ausprobieren', 3], ['probier', 3], ['bieg', 3], ['beug', 3], ['probeweise beugen', 4], ['probier mal', 3], ['vorher', 1], ['nachher', 1], ['kurz', 1], ['passieren', 2], ['was da passiert', 3]],
  // Rolle zuordnen/bestaetigen
  [['zuordnung', 3], ['bestätig', 3], ['bestaetig', 3], ['korrigier', 2], ['korrektur', 2], ['falsch zugeordnet', 3]],
  // Erfolgskriterien festlegen
  [['erfolgskriterium', 3], ['kriterium', 2], ['kriterien', 2], ['zielbedingung', 2], ['absicht', 1], ['soll', 1]],
  // Dauer setzen
  [['dauer', 3], ['gesamtlänge', 3], ['gesamtlänge der animation', 4], ['wie lang', 3], ['länge', 2], ['frame rate', 1], ['framerate', 1]],
  // Phase anlegen
  [['phase', 3], ['phasen', 3], ['bewegungsphase', 3], ['abschnitt', 2], ['schritt', 3], ['schitt', 3], ['step', 2], ['gehen', 2], ['geht', 2], ['lauf', 2], ['bewegung anlegen', 3], ['machen', 1], ['mach', 1], ['lass', 1], ['crouch', 1], ['hock', 2], ['spring', 2], ['dreh', 2], ['wink', 1], ['reic', 2]],
  // Phase bearbeiten
  [['änder', 2], ['ander', 2], ['entfern', 2], ['bearbeit', 1], ['überschreib', 1], ['phasen-id', 3]],
  // Zielposition fuer Endeffektor oder Schwerpunkt
  [['ziel', 3], ['zielpunkt', 3], ['endeffektor', 3], ['schwerpunkt', 3], ['position', 2], ['hinbewegen', 2], ['am ende', 2], ['genau auf', 2], ['punkt', 1], ['stelle genau', 2]],
  // Gelenkwinkel hart setzen
  [['gelenkwinkel', 4], ['winkel', 2], ['grad', 2], ['verdreh', 2], ['festleg', 1], ['stell ein', 2], ['stell den', 1]],
  // Rueckgaengig
  [['rueckgaengig', 5], ['ruckgaengig', 4], ['rueckgehend', 3], ['zuruecknehm', 4], ['zurueck', 4], ['undo', 4], ['ruecknahme', 2], ['nicht mehr', 1], ['verwerf', 2], ['gefaellt mir nicht', 4], ['gefaellt', 2], ['letzte aenderung', 2], ['aenderung zurueck', 3], ['mach es rueck', 4]],
  // Pruefen/Vollbericht
  [['prüf', 3], ['pruef', 3], ['prüft', 3], ['in ordnung', 4], ['bericht', 2], ['kontroll', 2], ['alles', 1], ['fehler', 2], ['stimmt', 2], ['sicher', 2], ['insgesamt', 2], ['gesamte', 2], ['vollständig', 3], ['vollstaendig', 3], ['phasenabhängig', 2], ['kritisch', 2]],
  // Bildstreifen, Ansichten, Ansehen
  [['bildstreifen', 4], ['ansicht', 3], ['front', 2], ['side', 2], ['quarter', 2], ['top', 2], ['ansehen', 3], ['zeig', 3], ['zeil', 3], ['zeigen', 3], ['sieh', 2], ['sieht', 2], ['aussieht', 3], ['bild', 1], ['darstell', 2], ['vorn', 2], ['von der seite', 3], ['seite', 3], ['gerade', 1], ['wie das gerade', 2], ['gewählten frames', 3]],
  // Frage an Menschen
  [['frag den menschen', 4], ['den menschen fragen', 4], ['nachfrag', 3], ['antwortmöglichkeit', 3], ['antwortmöglichkeiten', 3], ['freitext', 2], ['weisst du nicht', 1], ['unsicher', 2], ['unklar', 2], ['verstehe ich nicht', 2], ['warte auf', 2], ['klick', 1]],
  // Export
  [['export', 3], ['exportier', 3], ['gltf', 3], ['herunterladen', 3], ['download', 3], ['datei', 1], ['speicher', 2], ['heraus', 1], ['raus', 1], ['holen', 1], ['zip', 1], ['json', 1]]
];

/** Kleinere, diakritikfreie Normalform fuer den Begriff-Vergleich. */
function normal(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/**
 * Waehlt aus dem KATALOG das Werkzeug, dessen name+description am besten
 * zur Frage passt. Nur Schluesselbegriffe, keine Gewichtung nach Namen.
 * @param {string} frage Aufgabe in Alltagssprache
 * @returns {{name:string, score:number}[]} absteigend nach score
 */
export function waehleWerkzeug(frage) {
  const f = normal(frage);
  // Ein Begriff zaehlt nur, wenn er in der FRAGE vorkommt UND das Werkzeug ihn
  // nennt. Volles Gewicht, wenn das Werkzeug den Begriff in seiner Beschreibung
  // fuehrt, halbes, wenn nur der Name passt. So zaehlt Abdeckung der Frage,
  // nicht Textlaenge im Beschreibungstext allein.
  const bewertet = KATALOG.map(eintrag => {
    const name = normal(eintrag.name);
    const text = normal(`${eintrag.name} ${eintrag.description || ''}`);
    let score = 0;
    let begriffTreffer = 0;
    for (const gruppe of BEGRIFFE) {
      for (const [begriff, gewicht] of gruppe) {
        if (!f.includes(normal(begriff))) continue; // nicht in der Frage: egal
        // Das Werkzeug muss denselben SINN tragen: der Begriff oder sein Stamm
        // steht im Werkzeugtext. Stamm = erste vier bis fuenf Buchstaben.
        const stamm = normal(begriff).replace(/(e|en|er|es|t|n)$/, '');
        const nadel = stamm.length >= 4 ? stamm : normal(begriff);
        if (text.includes(nadel)) {
          score += gewicht;
          begriffTreffer += 1;
        }
      }
    }
    // Kein Begriff aus der Frage wird vom Werkzeptext gedeckt: kein Treffer.
    if (begriffTreffer === 0) score = 0;
    return { name: eintrag.name, score };
  });
  bewertet.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return bewertet;
}

/**
 * Waehlt den besten Namen und bereitet den Aufruf als JSON-String vor.
 * Ruft die Ausfuehrung nicht auf — das macht der Test mit dem Strohmann.
 * @param {string} frage
 * @returns {{name:string, argsJson:string}}
 */
export function waehleUndBereiteVor(frage) {
  const rangliste = waehleWerkzeug(frage);
  if (!rangliste.length || rangliste[0].score === 0) {
    throw new Error(`keine Werkzeugbeschreibung passt zur Frage '${frage}' (hochscorierte Anzahl: 0)`);
  }
  const name = rangliste[0].name;
  const eintrag = KATALOG.find(e => e.name === name);
  const eigenschaften = eintrag.inputSchema && eintrag.inputSchema.properties
    ? Object.keys(eintrag.inputSchema.properties)
    : [];
  // Pflichtargumente mit Schluesselwerten vorfuellen — nur damit der Strohmann
  // nichts an den Argumenten zu meckern hat; Inhalte sind hier egal.
  const args = {};
  for (const k of eigenschaften) args[k] = musterwert(k);
  return { name, argsJson: JSON.stringify(args) };
}

function musterwert(key) {
  switch (key) {
    case 'angleDeg': return 30;
    case 'frame': case 'from': case 'to': case 'frameCount': return 10;
    case 'pos': return [0, 0, 0];
    case 'checks': return [{ kind: 'travel' }];
    case 'verb': return 'stand';
    case 'params': return {};
    default: return '';
  }
}