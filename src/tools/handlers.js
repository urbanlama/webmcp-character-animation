// Was die sechzehn Werkzeuge tun. Katalog und Beschreibungen: catalog.js.
//
// Zwei Regeln gelten in dieser Datei durchgehend:
//
//   1. Jede Aenderung an der Timeline laeuft durch store.aendere(). Damit ist
//      sie atomar und rueckdrehbar. Wirft die Pruefung mittendrin, bleibt der
//      Zustand unangetastet und der Undo-Stapel waechst nicht.
//   2. Jede Fehlermeldung kommt aus errors.js und nennt Wert, erlaubten
//      Bereich und naechsten Schritt (plan.md 5.5).

import {
  WerkzeugFehler, WerkzeugMeldung, wert, zahl,
  pruefeGanzzahl, pruefeZahl, pruefeText, pruefeAuswahl, pruefeListe,
  pruefeFrame, pruefeObjekt
} from './errors.js';
import {
  KATALOG, KATALOG_SICHTBAR, VERBEN, INTENT_ARTEN, KANAELE, FRAME_MIN, FRAME_MAX, MESS_FRAMES_MAX,
  EASE_ARTEN, EASE_STANDARD, WEITEN
} from './catalog.js';
import { JOINT_CATALOG } from '../rig/measure.js';
import { nichtAngeschlossen } from './ports.js';
import { alsTimeline } from './state.js';
import { PFLICHTROLLEN, priorisiereFragen, offenerRest } from './rollen-priorisierung.js';
import { ANTWORT_MAX_BYTES, AUFRUF_MAX_MS } from './registry.js';
import { pruefeKriterien } from '../validate/intent.js';
import { folgeFrames, FOLGE_BILDER, FOLGE_SKALA } from '../render/bildfolge.js';
import { pruefePhysik, fussLiegtAuf, BODEN_TOLERANZ_ANTEIL } from '../validate/physics.js';

/**
 * Verfahrensparameter: welcher Koerperbereich von welchem Verb betroffen ist.
 * Grundlage der Ueberlappungsregel aus plan.md 5.2 — Phasen duerfen sich
 * zeitlich ueberlappen, aber nur auf disjunkten Koerperteilen. Zugeordnet nach
 * der Verb-Tabelle 6.3: was das Verb ansteuert, nicht was sich mitbewegt.
 */
export const VERB_BEREICH = {
  stand: 'stuetze',
  crouch: 'stuetze',
  takeoff: 'stuetze',
  land: 'stuetze',
  step: 'stuetze',
  swing_arms: 'arme',
  reach: 'arme',
  airborne: 'ganzkoerper',
  turn: 'ganzkoerper',
  settle: 'ganzkoerper'
};

/** Zwei Bereiche kollidieren, wenn sie gleich sind oder einer alles umfasst. */
function bereicheKollidieren(a, b) {
  return a === b || a === 'ganzkoerper' || b === 'ganzkoerper';
}

/** Nur die Vertragsfelder der Timeline, ohne den AP7-eigenen Sitzungskram. */
// alsTimeline liegt in state.js, damit auch ports.js (Live-Anzeige) denselben
// Loeser-Eingang baut. Hier nur weitergereicht, die Aufrufer bleiben.
export { alsTimeline };

/** Text-Antwort im WebMCP-Format. */
function text(t) {
  return { content: [{ type: 'text', text: t }] };
}

/** Text plus Bilder in einer Antwort — gemessen moeglich, AGENTS.md. */
function textMitBildern(t, bilder) {
  const content = [{ type: 'text', text: t }];
  for (const b of bilder) {
    if (b && b.data) content.push({ type: 'image', data: b.data, mimeType: b.mimeType });
  }
  return { content };
}

/** JSON als Text, wie der Agent es liest. */
function json(obj) {
  return text(JSON.stringify(obj, null, 2));
}

/**
 * Was der Bildstreifen zeigt, in Zahlen — angehaengt an jede look-Antwort.
 *
 * Grund ist Schluss 3 aus plan.md 3.2: "Fehlerfreiheit ist kein Erfolg — wo
 * nichts passiert, ist auch nichts falsch." Im Vorabtest lief ein Agent
 * zwanzig Minuten gegen eine Timeline, deren erstes Drittel unbewegt war,
 * ohne es zu bemerken. Ein Bildstreifen aus drei gleich aussehenden Frames
 * sieht aus wie ein Fehler des Renderers; die Zahlen hier sagen, ob die
 * Timeline ueberhaupt Bewegung enthaelt und woran es sonst liegt.
 *
 * @param {object}      z        Sitzungszustand (phases, overrides)
 * @param {object|null} bericht  Loeserbericht, falls geloest wurde
 * @returns {string} Zeilen zum Anhaengen, leer wenn nichts zu sagen ist
 */
/**
 * Die Arbeitsebenen fuer describe_world — nur die, deren Werkzeuge der Agent
 * auch registriert bekommt (KATALOG_SICHTBAR). Eine Empfehlung auf ein
 * Kistenwerkzeug ist eine Sackgasse: der Aufruf endet mit "Tool not found".
 */
export function ebenenText() {
  const sichtbar = new Set(KATALOG_SICHTBAR.map((t) => t.name));
  const alle = [
    { werkzeuge: ['set_pose', 'set_joint'],
      text: 'set_pose / set_joint — du stellst die Gelenke selbst. Der normale Weg.' },
    { werkzeuge: ['set_target'],
      text: 'set_target — du sagst, wo ein Körperteil sein soll. Eingeschränkt, '
        + 'siehe Werkzeugbeschreibung.' },
    { werkzeuge: ['add_phase'],
      text: 'add_phase — fertige Bewegungen. Nur, wenn eine davon genau passt.' },
  ];
  const out = {};
  let stufe = 0;
  for (const e of alle) {
    if (!e.werkzeuge.every((n) => sichtbar.has(n))) continue;
    out[++stufe] = e.text;
  }
  return out;
}

export function standMeldung(z, bericht) {
  const phasen = z.phases.length;
  const keys = Object.keys(z.overrides ?? {}).length;
  const zeilen = [`Stand: ${phasen} Phasen, ${keys} Frames mit gesetzten Posen, `
    + `${z.frameCount} Frames Laenge.`];

  const b = bericht && bericht.bewegung;
  if (b && typeof b.schwerpunktWeg_m === 'number') {
    zeilen.push(`Bewegung: Schwerpunkt ${b.schwerpunktWeg_m} m Weg, `
      + `Wurzeldrehung ${b.wurzelDrehungWeg_grad}°, `
      + `${b.toteFrames} von ${b.frames} Frames ohne Aenderung.`);
    if (b.schwerpunktWeg_m === 0 && b.wurzelDrehungWeg_grad === 0) {
      zeilen.push('Die Timeline steht still — alle Frames zeigen dieselbe Pose. '
        + 'Setze Haltungen auf einzelne Frames mit set_pose; zwischen zwei gesetzten '
        + 'Haltungen wird ueberblendet.');
    }
  }

  const lucken = (bericht && Array.isArray(bericht.lucken)) ? bericht.lucken : [];
  if (lucken.length > 0) {
    zeilen.push(`${lucken.length} unverbaute Stellen: `
      + lucken.slice(0, 3).map((l) => l.meldung).join(' | ')
      + (lucken.length > 3 ? ` | (${lucken.length - 3} weitere)` : ''));
  }
  return `\n${zeilen.join('\n')}`;
}

/**
 * Prueft Gelenk und Kanal gegen das VERMESSENE Profil, nicht gegen eine feste
 * Liste — und gibt die gemessene Freiheitsgrad-Beschreibung zurueck.
 *
 * Befund aus dem Browserlauf am Xbot: der Katalog kannte drei feste Kanaele
 * (bend, twist, swing), die Vermessung vergibt aber je Gelenk eigene Namen —
 * shoulder_l hat shrug/fwd, arm_l hat lift/swing/twist, hip_l hat
 * flex/spread/twist, ankle_l hat point/tilt. Damit war ueber set_joint nur
 * erreichbar, wo zufaellig "bend" passte (Ellbogen, Knie, Zehen); Schultern,
 * Arme, Hueften und Knoechel waren fuer den Agenten unerreichbar. Ein
 * angenommenes shoulder_l.bend fiel erst im Loeser auf ("nicht im Profil,
 * 40 Freiheitsgrade durchsucht") — also nach dem Bauen statt beim Setzen.
 *
 * @param {string} tool     Werkzeugname fuer die Fehlermeldung
 * @param {object} ports    Anschluesse; ports.rig liefert das Profil
 * @param {string} joint    Gelenkname, z. B. arm_l
 * @param {string} channel  Kanalname, z. B. lift
 * @returns {object} Freiheitsgrad aus dem Profil: { axis, sign, limit, ... }
 */
/**
 * BENANNTER VERFAHRENSPARAMETER: welcher Nachbarframe in der look-Antwort als
 * naechster Blick vorgeschlagen wird.
 *
 * 6 Frames sind bei 30 fps eine Fuenftelsekunde — weit genug, dass sich die
 * Haltung sichtbar geaendert hat, nah genug, dass der Agent den Zusammenhang
 * noch sieht. Der Vorschlag ersetzt den alten Bildstreifen: er sagt dem Agenten,
 * dass ein Verlauf aus mehreren Aufrufen entsteht.
 */
const NACHBAR_ABSTAND = 6;

/**
 * Freiwillige Gradangabe der look-Kamera. Fehlt sie, entscheidet die
 * Voreinstellung im Renderer — der Agent soll ein Bild bekommen, ohne vier
 * Zahlen nennen zu muessen.
 */
function pruefeGradOptional(tool, param, v, min, max) {
  if (v === undefined || v === null) return undefined;
  return pruefeZahl(tool, param, v, min, max, 'Grad',
    `nenne den Winkel in Grad zwischen ${min} und ${max}, oder lass ihn weg`);
}

function pruefeGelenkKanal(tool, ports, joint, channel) {
  // Ohne gemessene Freiheitsgrade — kein Modell geladen, oder eine Attrappe —
  // gibt es keine echten Kanalnamen. Dann gilt weiter die allgemeine Liste aus
  // dem Katalog: falsch geschriebene Kanaele werden abgelehnt, aber es wird
  // nichts gegen Messwerte geprueft, die es nicht gibt.
  const allgemein = () => {
    pruefeAuswahl(tool, 'channel', channel, KANAELE,
      'bend beugt, twist dreht um die Knochenachse, swing schwenkt seitlich; '
      + 'ist ein Modell geladen, gelten stattdessen die gemessenen Kanaele je Gelenk');
    return {};
  };
  if (!ports.rig) return allgemein();
  const gelenke = ports.rig.rig().joints || {};
  const namen = Object.keys(gelenke);
  const gemessen = namen.some((n) => Object.keys(gelenke[n].dof || {}).length > 0);
  if (!gemessen) return allgemein();
  if (!Object.prototype.hasOwnProperty.call(gelenke, joint)) {
    throw new WerkzeugMeldung({
      tool, param: 'joint', value: joint,
      range: `einer von ${namen.length} gemessenen Gelenknamen: ${namen.join(', ')}`,
      next: 'die vollstaendige Liste mit Achsen und Grenzwerten liefert describe_rig',
      message: `Gelenk "${joint}" ist an diesem Modell nicht vermessen: `
        + `${namen.length} Gelenke stehen zur Verfuegung (${namen.join(', ')})`
    });
  }
  const dof = gelenke[joint].dof || {};
  const kanaele = Object.keys(dof);
  if (!Object.prototype.hasOwnProperty.call(dof, channel)) {
    throw new WerkzeugMeldung({
      tool, param: 'channel', value: channel,
      range: `einer von ${kanaele.length} Kanaelen des Gelenks ${joint}: ${kanaele.join(', ')}`,
      next: `die Kanaele sind je Gelenk verschieden und kommen aus der Vermessung; `
        + `describe_rig nennt sie fuer alle ${namen.length} Gelenke`,
      message: `Kanal "${channel}" gibt es am Gelenk ${joint} nicht: `
        + `gemessen wurden ${kanaele.length} (${kanaele.join(', ')})`
    });
  }
  return dof[channel];
}

/**
 * Macht aus der flachen Freiheitsgrad-Tabelle des Loesers ("arm_l.lift": 70)
 * die Form, in der der Agent Haltungen SETZT ({ arm_l: { lift: 70 } }).
 *
 * Damit ist, was describe_pose liefert, unmittelbar wieder in set_pose
 * einsetzbar: eine Haltung ansehen, kopieren, auf einem anderen Frame leicht
 * veraendert setzen. Ohne diese Symmetrie muesste der Agent umrechnen.
 */
function gelenkeAusDofs(dofs) {
  const aus = {};
  for (const [schluessel, grad] of Object.entries(dofs ?? {})) {
    if (typeof grad !== 'number' || Math.abs(grad) < 0.05) continue;
    const punkt = schluessel.lastIndexOf('.');
    if (punkt < 1) continue;
    const gelenk = schluessel.slice(0, punkt);
    const kanal = schluessel.slice(punkt + 1);
    (aus[gelenk] || (aus[gelenk] = {}))[kanal] = +grad.toFixed(1);
  }
  return aus;
}

/**
 * Die Gelenkliste als Tabelle statt als JSON-Baum.
 *
 * Drei Befunde aus dem Agentenlauf, alle an derselben Antwort:
 *
 *   1. Vollstaendig sind es 52 599 Bytes. Der Agent schrieb sie in eine Datei
 *      und durchsuchte sie mit vier Shell-Aufrufen — ein Agent im Browser hat
 *      keine Shell und waere hier steckengeblieben.
 *   2. Als JSON-Baum mit Prosa je Kanal blieben 12 430 Bytes. Darin standen
 *      alle 18 Gelenke, aber links und rechts trugen nach der
 *      Vorzeichen-Normierung WORTGLEICHE Texte. Gleiche Zeilen werden
 *      unterwegs zusammengefasst; beim Agenten fehlten arm_r, elbow_r, hip_r,
 *      knee_r und ankle_r, und er brauchte drei Aufrufe, um zu merken, dass es
 *      sie doch gibt.
 *   3. Der Zaehler fehlte. Ohne ihn kann der Agent nicht pruefen, ob seine
 *      Liste vollstaendig angekommen ist.
 *
 * Deshalb: eine Zeile je Gelenk, feste Spalten, die Richtungs-Legende EINMAL
 * am Ende statt an jedem Kanal — und die Zahl der Gelenke oben. Wiederholt
 * sich nichts mehr, faellt auch nichts mehr weg.
 */
export function rigTabelle(bericht) {
  const gelenke = bericht.joints || {};
  const namen = Object.keys(gelenke);

  const zeilen = [];
  const legende = new Map();
  let breite = 0;
  for (const n of namen) breite = Math.max(breite, n.length);

  for (const name of namen) {
    const dof = gelenke[name].dof || {};
    const kanaele = Object.keys(dof);
    if (kanaele.length === 0) {
      zeilen.push(`${name.padEnd(breite)}  (keine messbaren Kanäle)`);
      continue;
    }
    const spalten = kanaele.map((k) => {
      const d = dof[k];
      const grenze = Array.isArray(d.limit) ? `${d.limit[0]}..${d.limit[1]}` : '?..?';
      // Je Kanalname ALLE verschiedenen Richtungstexte sammeln, mit den
      // Gelenken, für die sie gelten. Vorher stand hier `!legende.has(k)`:
      // von `swing` überlebte der Text des ERSTEN Gelenks, das den Kanal hat.
      // Der Agent las „+ schwingt den linken Arm nach vorn" und hatte über
      // arm_r kein Wort — er nahm Spiegelung an (bei Mixamo-Rigs oft so),
      // baute den ganzen Anlauf mit parallel schwingenden Armen und brauchte
      // 23 Aufrufe, um es zu reparieren (Reibungsbericht Lauf 7, 1.3).
      // Tatsächlich steht die Antwort in der Vermessung: arm_l.swing hat
      // Vorzeichen −1, arm_r.swing +1 — die Achsen sind gespiegelt, DAMIT
      // dasselbe Vorzeichen an beiden Seiten dasselbe tut.
      if (d.richtung) {
        if (!legende.has(k)) legende.set(k, new Map());
        const je = legende.get(k);
        if (!je.has(d.richtung)) je.set(d.richtung, []);
        je.get(d.richtung).push(name);
      }
      return `${k} ${grenze}`;
    });
    zeilen.push(`${name.padEnd(breite)}  ${spalten.join('   ')}`);
  }

  // Die Richtungstexte aus der Vermessung beginnen mit ihrem eigenen
  // Kanalnamen ("swing: + schwingt ..."). In der Legende steht er schon davor;
  // zweimal gelesen wird daraus "swing: swing: + ...".
  const ohnePraefix = (k, text) => (text.startsWith(`${k}: `) ? text.slice(k.length + 2) : text);
  const legendeZeilen = [];
  for (const [k, je] of legende) {
    if (je.size === 1) {
      legendeZeilen.push(`  ${k}: ${ohnePraefix(k, [...je.keys()][0])}`);
      continue;
    }
    // Mehrere Fassungen: jede mit ihren Gelenken, damit keine Seite geraten
    // werden muss.
    legendeZeilen.push(`  ${k}:`);
    for (const [text, gelenkNamen] of je) {
      legendeZeilen.push(`    ${gelenkNamen.join(', ')}: ${ohnePraefix(k, text)}`);
    }
  }

  const rollen = [];
  const unsicher = [];
  for (const [rolle, e] of Object.entries(bericht.roles || {})) {
    if (!e || !e.bone) continue;
    rollen.push(`${rolle} = ${e.bone}`);
    if (typeof e.confidence === 'number' && e.confidence < 1) {
      // MIT Knochennamen: sonst muss der Agent quer zur Rollenliste lesen, um
      // ueberhaupt zu wissen, was er bestaetigen wuerde.
      unsicher.push(`${rolle} = ${e.bone} (${e.confidence.toFixed(2)})`);
    }
  }

  const teile = [
    `${namen.length} Gelenke, Winkel in Grad als min..max:`,
    '',
    ...zeilen,
    '',
    'Was ein positiver Wert bewirkt:',
    ...legendeZeilen,
    '',
    `${rollen.length} Rollen (Rollenname = Knochen, für measure und describe_pose):`,
    `  ${rollen.join(', ')}`,
  ];
  if (unsicher.length > 0) {
    // Ausdruecklich als OPTIONAL benannt — und ohne Werkzeugnamen.
    //
    // Befund aus dem Agentenlauf: Hier stand "bestätige sie mit confirm_role".
    // Der Agent las das als Pflicht, schloss daraus, unbestaetigte Rollen
    // wuerden "die Beinkette blockieren", und machte sich daran, achtzehn
    // Zuordnungen zu bestaetigen — statt die Bewegung zu bauen. Nachgemessen:
    // set_pose, describe_pose und look funktionieren mit unbestaetigten Rollen
    // vollstaendig. Blockiert wird nichts.
    //
    // confirm_role liegt seit dem Abschalten der Rollen-Rueckfrage in der
    // Kiste (catalog.js) und ist dem Agenten nicht registriert. Am Xbot hat
    // ohnehin jede Pflichtrolle Konfidenz 1; kaeme ein Modell mit unsicherer
    // Rolle, gehoerte das Werkzeug wieder in den sichtbaren Katalog — dann
    // nennt der Satz es auch wieder. Solange es unsichtbar ist, waere sein
    // Name hier eine Sackgasse.
    const nennung = KATALOG_SICHTBAR.some((t) => t.name === 'confirm_role')
      ? ' Ist eine Zuordnung erkennbar falsch, korrigiere sie mit confirm_role.'
      : '';
    teile.push('', `${unsicher.length} Rollen sind mit weniger als voller Sicherheit `
      + 'zugeordnet. Das blockiert nichts — alle Werkzeuge arbeiten damit.'
      + `${nennung} Betroffen: ${unsicher.join(', ')}`);
  }
  if (Array.isArray(bericht.warnings) && bericht.warnings.length > 0) {
    teile.push('', `${bericht.warnings.length} Warnungen: ${bericht.warnings.join(' | ')}`);
  }
  // Die offenen Rueckfragen sind Sache der Oberflaeche, nicht des Agenten: der
  // Mensch beantwortet sie mit einem Klick. Sie standen hier als Liste und
  // sahen aus wie eine Aufgabe, die noch zu erledigen ist.
  if (Array.isArray(bericht.questions) && bericht.questions.length > 0) {
    teile.push('', `${bericht.questions.length} dieser Zuordnungen liegen dem Menschen `
      + 'am Bildschirm als Rückfrage vor. Du musst darauf nicht warten.');
  }
  teile.push('', 'Achsen, Vorzeichenquellen und Messbelege: describe_rig mit detail: true.');
  return teile.join('\n');
}

/** Die Frames mit gesetzter Haltung, aufsteigend — die Schluesselbilder. */
export function gesetzteFrames(z) {
  return Object.keys(z.overrides ?? {})
    .filter((k) => z.overrides[k] && z.overrides[k].joints
      && Object.keys(z.overrides[k].joints).length > 0)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Fehler, wenn eine Timeline-Laenge noch fehlt. */
function brauchtLaenge(tool, frameCount) {
  if (frameCount < FRAME_MIN) {
    throw new WerkzeugMeldung({
      tool, param: 'frameCount', value: frameCount,
      range: `${FRAME_MIN} bis ${FRAME_MAX} Frames`,
      next: `setze die Länge zuerst mit set_duration`,
      message: `Die Timeline hat ${frameCount} Frames, gebraucht werden mindestens ${FRAME_MIN}; `
        + `setze die Länge zuerst mit set_duration (${FRAME_MIN} bis ${FRAME_MAX})`
    });
  }
}

/**
 * Baut die sechzehn Werkzeuge: Katalogeintrag plus Rumpf.
 *
 * @param {object} umgebung
 * @param {object} umgebung.store  aus state.js
 * @param {object} umgebung.ask    aus ../ui/ask-human.js
 * @param {object} umgebung.ports  aus ports.js
 */
export function baueWerkzeuge({ store, ask, ports }) {
  const rumpf = {

    // --- 1..3  Auskunft ueber Welt, Rig, Koerper ---------------------------

    async describe_world() {
      if (!ports.rig) throw nichtAngeschlossen('describe_world', 'AP2 (Rig-Vermessung)', 'Der Weltvertrag');
      // Die Anleitung reist mit dem ersten Aufruf mit.
      //
      // Ein MCP-Server kann beim Verbinden eine Anleitung mitgeben; WebMCP
      // kann das nicht — dort sieht der Agent nur Name, Beschreibung und
      // Felder. Im ersten Agentenlauf hat sich das gerächt: Der Agent las
      // sieben Mal den Quellcode des Projekts nach, weil die Werkzeuge nicht
      // sagten, wie sie zusammenspielen. Ein Agent im Browser hat keine
      // Shell und wäre an derselben Stelle stehengeblieben.
      //
      // describe_world ist der einzige Ort, der dafür taugt: es ist das
      // Werkzeug, das jeder Agent zuerst aufruft, und es hat keine Parameter.
      return json({
        ...ports.rig.world(),
        anleitung: {
          zweck: 'Du baust eine Animation für eine geriggte Figur. Du siehst sie nicht '
            + 'direkt — du misst sie mit Werkzeugen und lässt dir Bilder rendern.',
          reihenfolge: [
            '1. describe_rig — welche Gelenke es gibt und wie ihre Kanäle heissen. '
              + 'Ohne das rätst du.',
            '2. set_duration — wie lang die Bewegung wird, in Frames.',
            '2b. describe_pose(0) — die Ausgangshaltung. Dort steht, wo das Becken '
              + 'im Stand sitzt; von dieser Höhe aus rechnest du Hocke und Sprung. '
              + 'Du musst sie nicht selbst auskalibrieren.',
            '3. set_pose — Haltungen auf einzelne Frames setzen. Das ist die Hauptarbeit.',
            '4. look — ansehen, was du gebaut hast. Nach jeder Änderung.',
            '5. describe_pose — nachmessen, wo Körperteile stehen.',
          ],
          // Die Ebenen werden aus dem SICHTBAREN Katalog abgeleitet, nicht
          // aufgeschrieben. Vorher standen hier Ebene 2 (set_target) und
          // Ebene 3 (add_phase) — beide liegen in der Kiste und sind beim
          // Agenten nie angekommen: er las eine Empfehlung, rief das Werkzeug
          // auf und bekam "Tool not found". Wandert eines zurueck in den
          // sichtbaren Katalog, steht es hier von selbst wieder.
          ebenen: ebenenText(),
          einheiten: 'Längen in Metern, Winkel in Grad, Zeit in Frames. '
            + 'Kriterien in set_intent nutzen Anteile der Körperhöhe.',
          wichtig: [
            'Die Kanalnamen sind je Gelenk verschieden und stehen in describe_rig. '
              + 'Es gibt keine allgemeingültige Liste.',
            'Zwischen zwei gesetzten Haltungen wird überblendet. Du brauchst also '
              + 'nicht jeden Frame zu setzen, nur die Eckpunkte.',
            'Eine fehlerfreie Bewegung ist nicht automatisch eine gute. Sieh sie dir an.',
            'Gelenkwinkel allein heben die Figur nicht vom Boden. Wo sie im Raum steht '
              + 'und wie sie gedreht ist, sagst du mit root in set_pose.',
            'Du setzt nur die Eckpunkte, nicht jeden Frame. Zwischen zwei Haltungen wird '
              + 'überblendet — bei einem Flug mit ease "wurf" sogar exakt auf der Wurfparabel, '
              + 'mit konstant 9,81 m/s². Zwei Schlüsselbilder genügen dann für den ganzen Flug.',
            'Unsicher zugeordnete Rollen blockieren nichts. Alle Werkzeuge arbeiten '
              + 'damit; du musst nichts bestätigen, bevor du anfängst.',
          ],
        },
      });
    },

    async describe_rig(args) {
      const a = args || {};
      if (!ports.rig) throw nichtAngeschlossen('describe_rig', 'AP2 (Rig-Vermessung)', 'Die Gelenkliste');
      const roh = ports.rig.rig();
      const bestaetigt = store.roh().roleConfirmations;
      // Vom Menschen bestaetigte Rollen gelten als gemessen (plan.md 5.5, Nr. 5).
      const roles = { ...(roh.roles || {}) };
      for (const [role, bone] of Object.entries(bestaetigt)) {
        roles[role] = { bone, confidence: 1.0, source: 'vom Menschen bestätigt' };
      }
      const bericht = { ...roh, roles };

      // Rueckfragen priorisieren und den ungefragten Rest sichtbar machen
      // (Auftrag "Zu viele unsichere Rollen"): Pflichtrollen zuerst — ohne sie
      // wird das Modell abgelehnt —, dann die übrigen nach aufsteigender
      // Konfidenz. Was über dem Budget offen blieb, steht mit Namen im Bericht;
      // es wird nicht still verschluckt. Kein Zweit-Schwellwert: fraglich ist
      // eine Rolle über die Rückfragen, die die Erkennungsschicht beistellt —
      // die Konfidenz-Schwellen stehen nur in detect.js (plan.md 5.1).
      if (Array.isArray(roh.questions)) {
        const fraglich = roh.questions
          .filter((f) => f && typeof f.rolle === 'string' && !(f.rolle in bestaetigt));
        const priorisiert = priorisiereFragen(fraglich);
        bericht.questions = priorisiert;
        bericht.pflichtrollen = PFLICHTROLLEN.slice();
        const beantwortet = Object.keys(bestaetigt);
        const { offeneRollen, meldung } = offenerRest(priorisiert, beantwortet, 0);
        bericht.offeneRollen = offeneRollen;
        bericht.rollenOffenMeldung = meldung;
      }

      // Kompakt, ausser der Agent will das Ganze.
      //
      // Gemessen am Xbot: der vollstaendige Bericht ist 52 599 Bytes. Im
      // Agentenlauf flog er dem Agenten um die Ohren — er schrieb die Antwort
      // in eine Datei und durchsuchte sie mit vier Shell-Aufrufen, nur um an
      // die Kanalnamen zu kommen. Ein Agent im Browser hat keine Shell und
      // waere hier steckengeblieben.
      //
      // Was er zum Posen braucht, sind zwei Dinge: welche Gelenke es gibt mit
      // ihren Kanaelen und Grenzen, und welcher Knochen welche Rolle traegt.
      // Beides passt in wenige Zeilen. Achsen, Vorzeichenquellen, Belege und
      // Konfidenzen holt er mit detail: true nach, wenn er sie braucht.
      if (a && a.detail === true) return json(bericht);
      return text(rigTabelle(bericht));
    },

    async describe_body() {
      if (!ports.rig) throw nichtAngeschlossen('describe_body', 'AP2 (Rig-Vermessung)', 'Das Körperprofil');
      return json(ports.rig.body());
    },

    // --- 4..5  Rig anfassen -------------------------------------------------

    async probe_joint(args) {
      const a = pruefeObjekt('probe_joint', 'Argumente', args, 'übergib {joint, angleDeg}');
      const gelenke = ports.rig ? ports.rig.gelenke() : [];
      pruefeText('probe_joint', 'joint', a.joint,
        `nimm einen der ${gelenke.length} Gelenknamen aus describe_rig`);
      if (gelenke.length > 0 && !gelenke.includes(a.joint)) {
        throw new WerkzeugMeldung({
          tool: 'probe_joint', param: 'joint', value: a.joint,
          range: `einer von ${gelenke.length} Gelenken`,
          next: 'rufe describe_rig auf',
          message: `Gelenk ${wert(a.joint)} gibt es nicht; das Rig hat ${gelenke.length} Gelenke: `
            + `${gelenke.join(', ')} — rufe describe_rig auf`
        });
      }
      pruefeZahl('probe_joint', 'angleDeg', a.angleDeg, -90, 90, 'Grad',
        'kleinere Winkel sind sicher; Grenzwerte je Gelenk stehen in describe_rig');
      // channel ist optional. Ist es gesetzt, muss es ein Kanal DIESES Gelenks
      // sein; die Namen sind je Gelenk verschieden (hip_l: flex, spread,
      // twist — arm_l: lift, swing, twist). Geprueft wird gegen das gemessene
      // Profil, nicht gegen eine feste Liste; die Meldung nennt Zahl und Namen.
      if (a.channel !== undefined) {
        pruefeText('probe_joint', 'channel', a.channel,
          'Kanalnamen dieses Gelenks liefert describe_rig');
      }

      const ergebnis = ports.rig.probe(a.joint, a.angleDeg, a.channel);
      return textMitBildern(
        ergebnis.text || `${a.joint} um ${zahl(a.angleDeg)} Grad gebeugt, Vorher/Nachher als Bild.`,
        ergebnis.bild ? [ergebnis.bild] : []
      );
    },

    async confirm_role(args) {
      const a = pruefeObjekt('confirm_role', 'Argumente', args, 'übergib {role, bone}');
      pruefeText('confirm_role', 'role', a.role, 'Rollennamen liefert describe_rig');
      pruefeText('confirm_role', 'bone', a.bone, 'Knochennamen liefert describe_rig');

      const anzahl = store.aendere((z) => {
        z.roleConfirmations[a.role] = a.bone;
        return Object.keys(z.roleConfirmations).length;
      });
      // Die Bestaetigung muss WIRKEN, nicht nur dastehen: alles, was aus den
      // Rollen abgeleitet ist, wird neu gemessen. Ohne diesen Schritt blieb
      // describe_body nach einer Korrektur bitidentisch
      // (spikes/rollen/BEFUND.md).
      let messText = '';
      if (ports.vermesseMitRollen) {
        try {
          const r = ports.vermesseMitRollen(store.roh().roleConfirmations);
          const d = r.nachher.masse - r.vorher.masse;
          messText = ` Neu vermessen: ${r.nachher.segmente} Segmente, `
            + `${r.nachher.sohlen} Sohlen, ${r.nachher.masse.toFixed(2)} kg`
            + (Math.abs(d) > 0.005 ? ` (${d > 0 ? '+' : ''}${d.toFixed(2)} kg)` : ' (unverändert)')
            + `, ${r.warnungen} Warnungen.`;
        } catch (e) {
          messText = ` Neuvermessung nicht möglich: ${e.message}`;
        }
      }

      return text(`Rolle "${a.role}" auf Knochen "${a.bone}" festgelegt, Konfidenz 1.0; `
        + `${anzahl} Zuordnung${anzahl === 1 ? '' : 'en'} bestätigt.${messText} `
        + 'Rücknehmbar mit undo.');
    },

    // --- 6..7  Absicht und Laenge ------------------------------------------

    async set_intent(args) {
      const a = pruefeObjekt('set_intent', 'Argumente', args, 'übergib {checks: [...]}');
      const checks = pruefeListe('set_intent', 'checks', a.checks, 1, 20,
        `jedes Kriterium ist eines der ${INTENT_ARTEN.length} Arten: ${INTENT_ARTEN.join(', ')}`);

      checks.forEach((c, i) => {
        pruefeObjekt('set_intent', `checks[${i}]`, c, 'jedes Kriterium ist ein Objekt mit kind');
        pruefeAuswahl('set_intent', `checks[${i}].kind`, c.kind, INTENT_ARTEN,
          'die Bausteine stehen in plan.md 6.6');
      });

      // Vollstaendigkeit VOR dem Speichern (src/validate/intent.js).
      // Befund aus dem Browserlauf: {kind:'part_height'} ohne Pflichtfelder
      // wurde angenommen und als "vom Menschen bestaetigt" quittiert; erst
      // validate stuerzte daran ab ("erwartet part, bekommen undefined") —
      // also nach dem Bauen statt beim Setzen, und mit einer Meldung, die
      // nicht sagte, welches Kriterium gemeint war.
      const vollstaendig = pruefeKriterien(checks);
      if (!vollstaendig.ok) {
        const f = vollstaendig.fehler;
        throw new WerkzeugMeldung({
          tool: 'set_intent', param: 'checks', value: `${f.length} unvollständige Felder`,
          range: `${checks.length} Kriterien, jedes mit allen Pflichtfeldern seiner Art`,
          next: 'ergänze die genannten Felder und rufe set_intent erneut auf',
          message: `${f.length} von ${checks.length} Kriterien sind unvollständig, `
            + `nichts wurde gesetzt:\n${f.map((e) => `- ${e.meldung}`).join('\n')}`
        });
      }

      // KEINE Rueckfrage mehr. Sie stand hier als "fester Mensch-Moment 2"
      // (plan.md 6.7) und ist ersatzlos gestrichen.
      //
      // Grund: sie war eine Zumutung. Der Text, den der Mensch zu sehen bekam,
      // lautete woertlich
      //
      //     Soll die Bewegung an diesen 2 Kriterien gemessen werden?
      //     - airtime: {"kind":"airtime","minSek":0.3}
      //
      // — rohes JSON mit englischen Bezeichnern, zu einer Frage, die niemand
      // ohne Kenntnis der Werkzeugschicht beantworten kann. Dazu kam sie bei
      // JEDEM Aufruf: im Agentenlauf vom 1. September 2026 fuenfmal, jedes Mal
      // mit 15 Sekunden Wartezeit, in denen die Arbeit stand.
      //
      // Ein Rueckfrage-Werkzeug gibt es weiterhin, und es ist das richtige:
      // ask_human. Damit fragt der AGENT, wenn er etwas nicht messen kann —
      // "ist das der linke Fuss?" zum leuchtenden Knochen. Das ist der Zweck,
      // fuer den die Mensch-Momente gedacht waren. Eine Zustimmung zu einer
      // Liste von Schwellwerten ist es nicht.
      //
      // Der Mensch behaelt die Kontrolle ueber die Kriterien: sie stehen in
      // jeder validate-Antwort, samt jedem Wechsel (siehe fassungen unten).

      // Jede Fassung wird mitgeschrieben. Grund, gemessen am Agentenlauf vom
      // 1. September 2026: set_intent lief fuenfmal, jedes Mal direkt nachdem
      // validate durchgefallen war. Beim fuenften Mal war das Kriterium
      // contact_change verschwunden — genau das, an dem es viermal scheiterte.
      // Danach meldete validate "passed: true", ohne dass der Massstab noch
      // derselbe war. Wer seinen eigenen Massstab beliebig neu setzen darf,
      // besteht immer; sichtbar bleibt es nur, wenn es jemand mitzaehlt.
      const vorher = store.roh().intent;
      const fassungen = [...(vorher?.fassungen ?? []),
        { arten: checks.map((c) => c.kind), anzahl: checks.length }];
      store.aendere((z) => { z.intent = { checks, fassungen }; });

      const entfallen = vorher
        ? [...new Set(vorher.checks.map((c) => c.kind))]
          .filter((k) => !checks.some((c) => c.kind === k))
        : [];

      return text(`${checks.length} Erfolgskriterien festgelegt: `
        + `${checks.map((c) => c.kind).join(', ')}.`
        + (fassungen.length > 1
          ? ` Fassung ${fassungen.length} dieser Absicht.`
            + (entfallen.length
              ? ` ${entfallen.length} Kriterienart fällt weg: ${entfallen.join(', ')} — `
                + 'validate weist das aus.'
              : '')
          : '')
        + ' Sie stehen in jeder validate-Antwort; ändern kannst du sie mit einem '
        + 'erneuten set_intent.');
    },

    async set_duration(args) {
      const a = pruefeObjekt('set_duration', 'Argumente', args, 'übergib {frameCount}');
      pruefeGanzzahl('set_duration', 'frameCount', a.frameCount, FRAME_MIN, FRAME_MAX,
        `bei ${store.roh().fps} fps sind das ${zahl(FRAME_MIN / store.roh().fps)} bis `
        + `${zahl(FRAME_MAX / store.roh().fps)} Sekunden`);

      const neu = a.frameCount;
      const z0 = store.roh();
      const zuLang = z0.phases.filter((p) => p.to > neu);
      if (zuLang.length > 0) {
        throw new WerkzeugMeldung({
          tool: 'set_duration', param: 'frameCount', value: neu,
          range: `mindestens ${Math.max(...z0.phases.map((p) => p.to))} Frames`,
          // Kein Verweis auf edit_phase: das Werkzeug liegt in der Kiste und
          // ist dem Agenten nicht registriert (catalog.js). Hier stand
          // „kürze die Phasen zuerst mit edit_phase" — ein Rat, der mit
          // „Tool not found" endet.
          next: `wähle mindestens ${Math.max(...z0.phases.map((p) => p.to))} Frames`,
          message: `${zuLang.length} Phase${zuLang.length === 1 ? '' : 'n'} `
            + `${zuLang.length === 1 ? 'reicht' : 'reichen'} über Frame ${neu} `
            + `hinaus (${zuLang.map((p) => `${p.id} bis ${p.to}`).join(', ')}); `
            + `verlangt sind mindestens ${Math.max(...z0.phases.map((p) => p.to))} Frames`
        });
      }
      const zuSpaet = Object.keys(z0.overrides).map(Number).filter((f) => f >= neu);
      if (zuSpaet.length > 0) {
        throw new WerkzeugMeldung({
          tool: 'set_duration', param: 'frameCount', value: neu,
          range: `mindestens ${Math.max(...zuSpaet) + 1} Frames`,
          next: 'entferne die Overrides zuerst oder wähle eine größere Länge',
          message: `${zuSpaet.length} Override${zuSpaet.length === 1 ? '' : 's'} liegt jenseits von `
            + `Frame ${neu - 1} (Frames ${zuSpaet.join(', ')}); verlangt sind mindestens `
            + `${Math.max(...zuSpaet) + 1} Frames`
        });
      }

      const vorher = z0.frameCount;
      store.aendere((z) => { z.frameCount = neu; });
      return text(`Länge auf ${neu} Frames gesetzt (vorher ${vorher}), bei ${z0.fps} fps sind das `
        + `${zahl(neu / z0.fps)} Sekunden.`);
    },

    // --- 7b  Bewegung leeren --------------------------------------------------

    /**
     * Leert die Bewegung: Haltungen, Phasen, Fußanker, Absicht. Die
     * Bühnenerhebung vom 2. September 2026 (Nebenbefund zu Pose 15, Befund
     * 3.4): es gab keinen Weg, den Sitzungszustand zu leeren — wer eine neue
     * Bewegung begann, erbte alle Schlüsselbilder der vorigen, auch auf
     * Frames, die er nie anfasste. Das hat dreimal zu Fehldiagnosen geführt.
     *
     * Bewusst NICHT geleert: roleConfirmations und offeneRollenFragen. Die
     * Bestätigungen sind Aussagen über das Modell („dieser Knochen ist das
     * Becken"), nicht über die Bewegung — das Modell bleibt geladen und
     * vermessen (state.js: „gehoert nicht zum Timeline-Vertrag"). Sie
     * wiederherzustellen wäre über die sichtbaren Werkzeuge unmöglich:
     * confirm_role liegt in der Kiste und ist dem Agenten unsichtbar.
     * frameCount bleibt ebenfalls: die Länge war eine bewusste Entscheidung,
     * und ein Reset auf 0 würde sofort wieder set_duration erzwingen.
     *
     * Rücknehmbar wie jede Änderung über store.aendere.
     */
    async clear_motion() {
      const z0 = store.roh();
      const poses = Object.keys(z0.overrides ?? {}).map(Number).sort((a, b) => a - b);
      const phasen = (z0.phases ?? []).map((p) => p.id);
      const anker = (z0.anchors ?? []).map((x) => `${x.foot} ${x.von}-${x.bis}`);
      const hatteIntent = z0.intent != null;

      store.aendere((z) => {
        z.overrides = {};
        z.phases = [];
        z.anchors = [];
        z.intent = null;
      });

      const z1 = store.roh();
      return text(
        `Bewegung geleert: ${poses.length} gesetzte Haltung${poses.length === 1 ? '' : 'en'}`
          + (poses.length ? ` (Frame${poses.length === 1 ? '' : 's'} ${poses.join(', ')})` : '')
          + `, ${phasen.length} Phase${phasen.length === 1 ? '' : 'n'}`
          + (phasen.length ? ` (${phasen.join(', ')})` : '')
          + `, ${anker.length} Fußanker`
          + (anker.length ? ` (${anker.join(', ')})` : '')
          + `, ${hatteIntent ? 1 : 0} gesetzte Absicht entfernt. `
          + `Übrig: ${z1.frameCount} Frames Länge bei ${z1.fps} fps, `
          + `0 Haltungen, 0 Phasen, 0 Anker, keine Absicht. `
          + `Modell, Vermessung und Rollenbestätigungen bleiben — die Timeline ist ab jetzt leer, `
          + `setze deine Haltungen neu. Rücknehmbar mit undo.`
      );
    },

    // --- 8..9  Phasen -------------------------------------------------------

    async add_phase(args) {
      const a = pruefeObjekt('add_phase', 'Argumente', args, 'übergib {verb, from, to, params}');
      const z0 = store.roh();
      brauchtLaenge('add_phase', z0.frameCount);

      pruefeAuswahl('add_phase', 'verb', a.verb, VERBEN,
        'die Verbtabelle mit den Parametern steht in plan.md 6.3');
      pruefeFrame('add_phase', 'from', a.from, z0.frameCount);
      pruefeGanzzahl('add_phase', 'to', a.to, 1, z0.frameCount,
        `to ist der Endframe und liegt hinter from = ${wert(a.from)}`);
      if (a.to <= a.from) {
        throw new WerkzeugMeldung({
          tool: 'add_phase', param: 'to', value: a.to,
          range: `ganze Zahl von ${a.from + 1} bis ${z0.frameCount}`,
          next: 'eine Phase dauert mindestens 1 Frame',
          message: `to ${wert(a.to)} liegt nicht hinter from ${wert(a.from)}; erlaubt ist `
            + `${a.from + 1} bis ${z0.frameCount} — eine Phase dauert mindestens 1 Frame`
        });
      }
      pruefeObjekt('add_phase', 'params', a.params,
        `die Parameter von ${a.verb} stehen in plan.md 6.3; leer ist {} `);

      // Ueberlappung auf demselben Koerperbereich: erlaubt, aber gemeldet.
      const bereich = VERB_BEREICH[a.verb];
      const kollisionen = z0.phases.filter((p) =>
        p.from < a.to && a.from < p.to && bereicheKollidieren(VERB_BEREICH[p.verb], bereich));

      const id = store.aendere((z) => {
        const neueId = store.neueId();
        z.phases.push({ id: neueId, verb: a.verb, from: a.from, to: a.to, params: { ...a.params } });
        return neueId;
      });

      const dauer = zahl((a.to - a.from) / z0.fps);
      let t = `Phase ${id} angelegt: ${a.verb} von Frame ${a.from} bis ${a.to} (${dauer} s). `
        + `Die Timeline hat jetzt ${store.roh().phases.length} Phasen.`;
      if (kollisionen.length > 0) {
        t += `\nWarnung: ${kollisionen.length} Phase${kollisionen.length === 1 ? '' : 'n'} `
          + `überlappt zeitlich auf demselben Körperbereich "${bereich}" `
          + `(${kollisionen.map((p) => `${p.id} ${p.verb} ${p.from}-${p.to}`).join(', ')}); `
          + `die spätere gewinnt — das ist ${id}.`;
      }
      return text(t);
    },

    async edit_phase(args) {
      const a = pruefeObjekt('edit_phase', 'Argumente', args, 'übergib {id, ...}');
      const z0 = store.roh();
      pruefeText('edit_phase', 'id', a.id, 'die Ids der Phasen liefert validate oder add_phase');

      const idx = z0.phases.findIndex((p) => p.id === a.id);
      if (idx < 0) {
        const ids = z0.phases.map((p) => p.id);
        throw new WerkzeugMeldung({
          tool: 'edit_phase', param: 'id', value: a.id,
          range: `eine von ${ids.length} Phasen-Ids`,
          next: 'lege sie mit add_phase an',
          message: `Phase ${wert(a.id)} gibt es nicht; die Timeline hat ${ids.length} Phasen`
            + (ids.length > 0 ? `: ${ids.join(', ')}` : ' — lege sie mit add_phase an')
        });
      }

      if (a.remove === true) {
        store.aendere((z) => { z.phases.splice(idx, 1); });
        return text(`Phase ${a.id} entfernt; ${store.roh().phases.length} Phasen übrig. `
          + 'Rücknehmbar mit undo.');
      }

      const alt = z0.phases[idx];
      const neuVon = a.from === undefined ? alt.from : a.from;
      const neuBis = a.to === undefined ? alt.to : a.to;

      if (a.from !== undefined) pruefeFrame('edit_phase', 'from', a.from, z0.frameCount);
      if (a.to !== undefined) {
        pruefeGanzzahl('edit_phase', 'to', a.to, 1, z0.frameCount,
          `to ist der Endframe der Timeline von 0 bis ${z0.frameCount}`);
      }
      if (neuBis <= neuVon) {
        throw new WerkzeugMeldung({
          tool: 'edit_phase', param: 'to', value: neuBis,
          range: `ganze Zahl von ${neuVon + 1} bis ${z0.frameCount}`,
          next: 'eine Phase dauert mindestens 1 Frame',
          message: `to ${wert(neuBis)} liegt nicht hinter from ${wert(neuVon)}; erlaubt ist `
            + `${neuVon + 1} bis ${z0.frameCount}`
        });
      }
      if (a.params !== undefined) {
        pruefeObjekt('edit_phase', 'params', a.params, `Parameter von ${alt.verb}: plan.md 6.3`);
      }

      store.aendere((z) => {
        const p = z.phases[idx];
        p.from = neuVon;
        p.to = neuBis;
        if (a.params !== undefined) p.params = { ...a.params };
      });
      return text(`Phase ${a.id} (${alt.verb}) geändert: Frames ${alt.from}-${alt.to} → `
        + `${neuVon}-${neuBis}, Dauer ${zahl((neuBis - neuVon) / z0.fps)} s. Rücknehmbar mit undo.`);
    },

    // --- 10..11  Ebene 2 und 3 ---------------------------------------------

    async set_target(args) {
      const a = pruefeObjekt('set_target', 'Argumente', args, 'übergib {frame, part, pos}');
      const z0 = store.roh();
      brauchtLaenge('set_target', z0.frameCount);
      pruefeFrame('set_target', 'frame', a.frame, z0.frameCount);
      pruefeText('set_target', 'part', a.part,
        'Endeffektor-Rollen liefert describe_rig; "com" ist der Schwerpunkt');
      pruefeListe('set_target', 'pos', a.pos, 3, 3, 'Zielpunkt [x, y, z] in Metern');
      a.pos.forEach((v, i) => pruefeZahl('set_target', `pos[${i}]`, v, -100, 100, 'Meter',
        'Weltkoordinaten nach dem Weltvertrag aus describe_world'));

      const anzahl = store.aendere((z) => {
        const o = z.overrides[String(a.frame)] || (z.overrides[String(a.frame)] = {});
        const targets = o.targets || (o.targets = {});
        targets[a.part] = a.pos.slice();
        return Object.keys(targets).length;
      });
      return text(`Ziel für "${a.part}" in Frame ${a.frame} auf `
        + `[${a.pos.map(zahl).join(', ')}] m gesetzt; ${anzahl} Ziel${anzahl === 1 ? '' : 'e'} in `
        + 'diesem Frame. Der Löser strebt es an — ob es gelingt, steht in validate.');
    },

    async set_joint(args) {
      const a = pruefeObjekt('set_joint', 'Argumente', args,
        'übergib {frame, joint, angleDeg, channel}');
      const z0 = store.roh();
      brauchtLaenge('set_joint', z0.frameCount);
      pruefeFrame('set_joint', 'frame', a.frame, z0.frameCount);
      pruefeText('set_joint', 'joint', a.joint, 'Gelenknamen liefert describe_rig');
      pruefeZahl('set_joint', 'angleDeg', a.angleDeg, -180, 180, 'Grad',
        'die Grenzwerte je Gelenk stehen in describe_rig');
      pruefeText('set_joint', 'channel', a.channel, 'Kanalnamen liefert describe_rig je Gelenk');
      const dof = pruefeGelenkKanal('set_joint', ports, a.joint, a.channel);

      store.aendere((z) => {
        const o = z.overrides[String(a.frame)] || (z.overrides[String(a.frame)] = {});
        const joints = o.joints || (o.joints = {});
        const g = joints[a.joint] || (joints[a.joint] = {});
        g[a.channel] = a.angleDeg;
      });
      // Der Loeser klemmt harte Gelenkgrenzen (plan.md 6.4, Rang 1) und meldet
      // den Betrag. Damit der Agent das nicht erst nach dem Bauen erfaehrt,
      // steht die Grenze schon hier — mit dem Wert, der tatsaechlich ankommt.
      const grenze = Array.isArray(dof.limit) ? dof.limit : null;
      const geklemmt = grenze
        ? Math.min(grenze[1], Math.max(grenze[0], a.angleDeg))
        : a.angleDeg;
      const hinweis = grenze && geklemmt !== a.angleDeg
        ? ` Die gemessene Grenze laesst ${grenze[0]}…${grenze[1]}° zu — beim Loesen `
          + `wird auf ${zahl(geklemmt)}° geklemmt.`
        : (grenze ? ` Gemessene Grenze: ${grenze[0]}…${grenze[1]}°.` : '');

      return text(`${a.joint}.${a.channel} in Frame ${a.frame} auf ${zahl(a.angleDeg)} Grad gesetzt; `
        + `${Object.keys(store.roh().overrides).length} Frames haben jetzt Overrides.`
        + hinweis
        + ' Rücknehmbar mit undo.');
    },

    /**
     * Eine ganze Koerperhaltung auf einen Frame — der Schluesselbild-Weg.
     *
     * set_joint schreibt einen Kanal je Aufruf. Eine vollstaendige Haltung am
     * Xbot sind 18 Gelenke mit zusammen 40 Freiheitsgraden; als Einzelaufrufe
     * ist das keine Arbeitsweise, mit der ein Agent eine Bewegung baut. Hier
     * geht die Haltung in einem Aufruf rein.
     *
     * Die angegebenen Gelenke ERSETZEN die Haltung des Frames, sie werden
     * nicht dazugemischt: ein Schluesselbild ist die Haltung, nicht ein
     * Nachtrag zur vorigen. Wer einzelne Winkel nachbessern will, nimmt
     * danach set_joint.
     */
    async set_pose(args) {
      const a = pruefeObjekt('set_pose', 'Argumente', args, 'übergib {frame, joints}');
      const z0 = store.roh();
      brauchtLaenge('set_pose', z0.frameCount);
      pruefeFrame('set_pose', 'frame', a.frame, z0.frameCount);
      pruefeObjekt('set_pose', 'joints', a.joints,
        'Gelenkname auf Kanal auf Grad, z. B. {"elbow_l": {"bend": 80}}');

      const ease = a.ease === undefined ? EASE_STANDARD : a.ease;
      pruefeAuswahl('set_pose', 'ease', ease, EASE_ARTEN,
        'smooth blendet weich, linear gleichfoermig, hold haelt und springt');

      // Die Wurzel: wo die Figur steht und wohin sie schaut.
      //
      // Ohne sie setzt der Agent zwar Gelenkwinkel, aber die Figur klebt am
      // Boden. Im Agentenlauf endete das mit "die Figur hebt nie ab — alle
      // Frames melden Kontakt": ein Sprung ist mit Gelenkwinkeln allein nicht
      // baubar, egal wie gut die Haltungen sind.
      let wurzel = null;
      if (a.root !== undefined && a.root !== null) {
        const r = pruefeObjekt('set_pose', 'root', a.root,
          'übergib {pos: [x, y, z]} in Metern und/oder {turnGrad: Zahl}');
        wurzel = {};
        if (r.pos !== undefined) {
          const pos = pruefeListe('set_pose', 'root.pos', r.pos, 3, 3,
            'Position des Beckens [x, y, z] in Metern, Weltsystem aus describe_world; y darf null sein (auf dem Boden)');
          // Die Höhe darf null sein: dann stellt der Löser die Figur auf den
          // Boden (Bühnenlauf 2. September 2026, Befund A — jede geratene Höhe
          // war entweder zu hoch oder im Boden). x und z gelten trotzdem.
          pos.forEach((v, i) => {
            if (i === 1 && v === null) return;
            pruefeZahl('set_pose', `root.pos[${i}]`, v, -1000, 1000, 'Meter',
              'die Bodenhöhe und der Maßstab stehen in describe_world; y = null stellt die Figur auf den Boden');
          });
          wurzel.pos = pos.map((v, i) => (i === 1 && v === null ? null : Number(v)));
        }
        // Drehung: drehGrad je Achse, turnGrad als Kurzform fuer die Hochachse.
        //
        // Vorher gab es nur turnGrad. Damit war ein Salto nicht ausdrueckbar:
        // die Hochachse dreht die Figur im Stand, fuer einen Ueberschlag
        // braucht es die Querachse. Das Becken selbst ist auf +-40 Grad
        // begrenzt (src/rig/measure.js), also kann auch kein Gelenk das
        // ersetzen — die Drehung gehoert an die Wurzel.
        const dreh = {};
        if (r.turnGrad !== undefined) {
          pruefeZahl('set_pose', 'root.turnGrad', r.turnGrad, -3600, 3600, 'Grad',
            'Drehung der ganzen Figur um die Hochachse');
          dreh.y = Number(r.turnGrad);
        }
        if (r.drehGrad !== undefined && r.drehGrad !== null) {
          const d = pruefeObjekt('set_pose', 'root.drehGrad', r.drehGrad,
            'Grad je Achse, z. B. {x: -360} fuer einen Rueckwaertssalto');
          for (const achse of ['x', 'y', 'z']) {
            if (d[achse] === undefined) continue;
            pruefeZahl('set_pose', `root.drehGrad.${achse}`, d[achse], -3600, 3600, 'Grad',
              'x nickt (Salto), y giert (Drehung im Stand), z rollt (seitlich)');
            dreh[achse] = Number(d[achse]);
          }
        }
        if (Object.keys(dreh).length > 0) wurzel.drehGrad = dreh;
        if (Object.keys(wurzel).length === 0) {
          throw new WerkzeugMeldung({
            tool: 'set_pose', param: 'root', value: 0,
            range: 'pos, turnGrad oder beides',
            next: 'lass root weg, wenn die Figur stehen bleiben soll',
            message: '0 Angaben in root: erwartet pos, turnGrad oder beides'
          });
        }
      }

      const namen = Object.keys(a.joints);
      if (namen.length === 0) {
        throw new WerkzeugMeldung({
          tool: 'set_pose', param: 'joints', value: 0,
          range: 'mindestens 1 Gelenk',
          next: 'die Gelenknamen und ihre Kanäle liefert describe_rig',
          message: '0 Gelenke übergeben: eine Haltung ohne Gelenk ändert nichts'
        });
      }

      // Erst vollstaendig pruefen, dann schreiben. Sonst stuende nach einem
      // Tippfehler im zwoelften Gelenk eine halbe Haltung im Frame.
      const geprueft = [];
      const geklemmt = [];
      for (const gelenk of namen) {
        const kanaele = pruefeObjekt('set_pose', `joints["${gelenk}"]`, a.joints[gelenk],
          'Kanal auf Grad, z. B. {"bend": 80}');
        for (const [kanal, grad] of Object.entries(kanaele)) {
          pruefeZahl('set_pose', `joints["${gelenk}"].${kanal}`, grad, -180, 180, 'Grad',
            'die Grenzwerte je Gelenk stehen in describe_rig');
          const dof = pruefeGelenkKanal('set_pose', ports, gelenk, kanal);
          const grenze = Array.isArray(dof.limit) ? dof.limit : null;
          if (grenze) {
            const g = Math.min(grenze[1], Math.max(grenze[0], grad));
            if (g !== grad) geklemmt.push(`${gelenk}.${kanal} ${zahl(grad)}° → ${zahl(g)}° `
              + `(Grenze ${grenze[0]}…${grenze[1]}°)`);
          }
          geprueft.push({ gelenk, kanal, grad });
        }
      }

      store.aendere((z) => {
        const o = z.overrides[String(a.frame)] || (z.overrides[String(a.frame)] = {});
        o.joints = {};
        o.ease = ease;
        // Marke: dieses Schlüsselbild ist die ganze Haltung — nicht genannte
        // Kanäle stehen hier in der Ruhelage (verankereKurven, loeser.js).
        o.haltung = true;
        if (wurzel) o.root = wurzel; else delete o.root;
        for (const { gelenk, kanal, grad } of geprueft) {
          const g = o.joints[gelenk] || (o.joints[gelenk] = {});
          g[kanal] = grad;
        }
      });

      const schluessel = gesetzteFrames(store.roh());
      // Eine Wurzelposition zwischen einem wurf-Schlüssel und dem nächsten
      // Höhenschlüssel teilt die Wurfbahn in zwei Bögen. Agentenlauf 9 vom
      // 2. September 2026: Tuck bei Frame 44 mit y = 1,8 zwischen Absprung 34
      // (wurf) und Landung 55 — in allen acht validate-Aufrufen ein
      // Ballistik-Knick bei 44, und kein Werkzeug sagte, woher er kam.
      let flugText = '';
      if (wurzel && wurzel.pos) {
        const mitPos = Object.entries(store.roh().overrides || {})
          .map(([k, o]) => ({ frame: Number(k), o }))
          .filter((x) => Number.isInteger(x.frame) && x.frame !== a.frame && x.o && x.o.root && x.o.root.pos)
          .sort((p, q) => p.frame - q.frame);
        let davor = null, danach = null;
        for (const x of mitPos) {
          if (x.frame < a.frame) davor = x;
          if (x.frame > a.frame && !danach) danach = x;
        }
        if (davor && danach && davor.o.ease === 'wurf') {
          flugText = `\nACHTUNG: Frame ${a.frame} liegt im Flug zwischen ${davor.frame} (ease "wurf") und `
            + `${danach.frame}. Eine Wurzelposition hier - feste Höhe oder y = null - teilt die Wurfbahn in `
            + `zwei Bögen, die bei Frame ${a.frame} nicht zusammenpassen; validate meldet dort einen `
            + `Ballistik-Knick. Setze Flugposen OHNE root.pos (drehGrad darf bleiben): dann trägt die `
            + `Bahn von ${davor.frame} nach ${danach.frame} die Haltung, und x/z werden überblendet.`;
        }
      }
      const wurzelTeile = [];
      if (wurzel && wurzel.pos) {
        wurzelTeile.push(`Position [${wurzel.pos.map((v) => (v === null ? 'Boden' : v)).join(', ')}] m`
          + (wurzel.pos[1] === null ? ' (Höhe vom Löser: auf dem Boden)' : ' (feste Höhe — die Figur steht nur auf dem Boden, wenn y dazu passt)'));
      }
      if (wurzel && wurzel.drehGrad) {
        wurzelTeile.push('Drehung ' + Object.entries(wurzel.drehGrad)
          .map(([a, g]) => `${a} ${zahl(g)}°`).join(', '));
      }
      const wurzelText = wurzelTeile.length > 0
        ? ` Wurzel: ${wurzelTeile.join(', ')}.`
        : ' Wurzel nicht gesetzt: die Figur bleibt an ihrem Ort und wird auf den Boden gestellt.';

      return text(`Haltung auf Frame ${a.frame} gesetzt: ${namen.length} Gelenke, `
        + `${geprueft.length} Winkel, Übergang "${ease}".${wurzelText} `
        + `Die Timeline hat jetzt ${schluessel.length} gesetzte Frames `
        + `(${schluessel.join(', ')}) auf ${z0.frameCount} Frames Länge.`
        + (geklemmt.length
          ? `\n${geklemmt.length} Winkel liegen außerhalb der gemessenen Gelenkgrenzen und `
            + `werden beim Lösen geklemmt: ${geklemmt.join('; ')}`
          : '')
        + flugText
        + wirkung(store.roh(), a.frame, ports)
        + '\nRücknehmbar mit undo.');
    },

    /**
     * Wie die Figur in einem Frame tatsaechlich steht — in Zahlen.
     *
     * Bis hierher konnte der Agent den Zustand nur als Bild sehen (look) oder
     * als Fehlerliste (validate). Wo eine Hand im Raum ist, ob der Schwerpunkt
     * ueber der Stuetzflaeche sitzt, wie weit ein Knie gebeugt ist — das stand
     * nirgends abrufbar. Ein Animator sieht das im Viewport; ein Agent braucht
     * es als Zahl, sonst keyframt er blind (plan.md 3.2, Schluss 1).
     *
     * Die Weltpositionen kommen aus derselben geloesten Bewegung, die auch der
     * Bildstreifen zeigt — Bild und Zahlen beschreiben denselben Frame.
     */
    /**
     * Das Messgeraet, das der Agent selbst ausrichtet.
     *
     * Der naheliegende Weg waere gewesen, fertige Urteile zu liefern: eine
     * Funktion "ist die Hocke sauber?" mit eingebauter Antwort. Das geht aus
     * zwei Gruenden nicht. Erstens ist jede Bewegung anders — ein Schritt
     * braucht andere Fragen als ein Sprung, und fuer jede Bewegung ein
     * Werkzeug zu bauen endet nie. Zweitens lernte der Agent dabei nichts
     * ueber die Figur; er bekaeme ein Urteil, das jemand anders gefaellt hat.
     *
     * Hier bekommt er stattdessen sieben geometrische Grundmessungen und
     * richtet sie selbst aus. "Steht das Knie vor dem Zeh" ist dann kein
     * Werkzeug, sondern eine Frage, die er stellt — und fuer den naechsten
     * Auftrag stellt er eine andere.
     *
     * Gemessen wird an der GELOESTEN Bewegung, also an dem, was tatsaechlich
     * herauskommt, nicht an dem, was gesetzt wurde.
     */
    async measure(args) {
      const a = pruefeObjekt('measure', 'Argumente', args, 'übergib {frames, fragen}');
      const z0 = store.roh();
      brauchtLaenge('measure', z0.frameCount);

      // Ein Frame oder mehrere. Beides geht: `frame` ist die Kurzform.
      //
      // Warum mehrere: im Agentenlauf vom 1. September 2026 brauchte der
      // Agent den Hoehenverlauf des Schwerpunkts ueber die Flugphase und
      // musste dafuer vier Aufrufe machen — Frame 36, 40, 44, 48, jeder mit
      // vollem Kopf und jeder mit einem eigenen Loeserlauf. Vier Aufrufe fuer
      // vier Zahlen. Der Loeser laeuft jetzt einmal fuer alle Frames.
      const zielFrames = Array.isArray(a.frames)
        ? pruefeListe('measure', 'frames', a.frames, 1, MESS_FRAMES_MAX,
          `Frames, 1 bis ${MESS_FRAMES_MAX} Stück`)
        : [a.frame];
      if (zielFrames.length === 1 && !Array.isArray(a.frames)) {
        pruefeFrame('measure', 'frame', a.frame, z0.frameCount);
      } else {
        zielFrames.forEach((n, i) => pruefeFrame('measure', `frames[${i}]`, n, z0.frameCount));
      }

      const fragen = pruefeListe('measure', 'fragen', a.fragen, 1, 20,
        'jede Frage ist ein Objekt mit art und den Körperteilen, die die Art braucht');
      if (!ports.solver) {
        throw nichtAngeschlossen('measure', 'AP5 (Löser)', 'Die gelöste Bewegung');
      }

      const { frames } = ports.solver.loese(alsTimeline(z0));
      const holeFrame = (n) => (frames || []).find((x) => x.frame === n);
      for (const n of zielFrames) {
        if (!holeFrame(n)) {
          throw new WerkzeugMeldung({
            tool: 'measure', param: 'frame', value: n,
            range: `ein gelöster Frame von 0 bis ${(frames || []).length - 1}`,
            next: 'setze die Länge mit set_duration und Haltungen mit set_pose',
            message: `Frame ${n} wurde nicht gelöst: der Löser lieferte `
              + `${(frames || []).length} Frames`
          });
        }
      }

      // Rollenname -> Weltposition. "com" ist der Schwerpunkt.
      const rollen = (ports.rig && ports.rig.rig().roles) || {};
      const welt = ports.rig ? ports.rig.world() : {};
      const boden = welt.groundY ?? 0;
      const vorne = Array.isArray(welt.forwardVektor) ? welt.forwardVektor : [0, 0, 1];
      const seite = Array.isArray(welt.leftVektor) ? welt.leftVektor : [1, 0, 0];

      // sole_l / sole_r: der tiefste Sohlenpunkt des Fusses. Ohne ihn kann der
      // Agent „stehe ich auf dem Boden?" nicht in Zahlen beantworten — der
      // Fussknochen sitzt am Xbot 8,8 cm ueber der Sohle (Befund 2.2 vom
      // 2. September 2026).
      const punkt = (frame, teil) => {
        if (teil === 'com') return frame.com ?? null;
        const sohle = /^sole_([lr])$/.exec(teil);
        if (sohle) return tiefsteSohle(frame, sohle[1]);
        const eintrag = rollen[teil];
        const knochen = eintrag && eintrag.bone;
        if (!knochen) return null;
        return (frame.positions && frame.positions[knochen]) ?? null;
      };
      const bekannt = ['com', 'sole_l', 'sole_r', ...Object.keys(rollen).filter((r) => rollen[r] && rollen[r].bone)];
      // Setz-Name -> Messname: 10 von 18 Gelenken, die der Agent mit set_pose
      // setzt, heissen beim Messen anders (Befund 2.1, Buehnenlauf 2. September
      // 2026): der Agent setzt hip_l.flex und misst thigh_l. Ohne den
      // Ersatznamen in der Fehlermeldung war jedes Mal ein Fehlaufruf. Die
      // Zuordnung kommt aus dem Gelenkkatalog (bone = Messrolle), nicht aus
      // einem zweiten Vokabular — und nur, wenn die Messrolle hier wirklich
      // existiert, denn Fremdmodelle koennen Rollen nicht haben.
      const messName = (teil) => {
        const def = JOINT_CATALOG.find((d) => d.joint === teil);
        return def && rollen[def.bone] && rollen[def.bone].bone ? def.bone : null;
      };
      const brauchePunkt = (frame, teil, feld, i) => {
        const p = punkt(frame, teil);
        if (!p) {
          const ersatz = messName(teil);
          throw new WerkzeugMeldung({
            tool: 'measure', param: `fragen[${i}].${feld}`, value: teil,
            range: `einer von ${bekannt.length} Körperteilen: ${bekannt.join(', ')}`,
            next: ersatz
              ? `messe "${ersatz}" statt "${teil}"`
              : 'die Rollennamen und ihre Knochen liefert describe_rig',
            message: `Körperteil "${teil}" ist an diesem Modell nicht zugeordnet`
              + (ersatz ? ` — beim Messen heißt es "${ersatz}"`
                : `: ${bekannt.length} stehen zur Verfügung (${bekannt.join(', ')})`)
              + (ersatz ? `; ${bekannt.length} stehen zur Verfügung (${bekannt.join(', ')})` : '')
          });
        }
        return p;
      };

      const laenge = (v) => Math.hypot(v[0], v[1], v[2]);
      const minus = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
      const skalar = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const rund = (x) => +x.toFixed(4);

      const messeFrame = (f, frameNr) => fragen.map((frage, i) => {
        pruefeObjekt('measure', `fragen[${i}]`, frage, 'jede Frage ist ein Objekt mit art');
        const art = frage.art;
        const name = frage.name || `${art}(${[frage.a, frage.b, frage.c].filter(Boolean).join(', ')})`;
        const pa = brauchePunkt(f, frage.a, 'a', i);

        switch (art) {
          case 'hoehe':
            return { name, art, wert_m: rund(pa[1] - boden),
              bedeutet: `${frage.a} steht ${rund(pa[1] - boden)} m über dem Boden` };
          case 'abstand': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const d = rund(laenge(minus(pa, pb)));
            return { name, art, wert_m: d, bedeutet: `${frage.a} und ${frage.b} sind ${d} m auseinander` };
          }
          case 'abstand_vorne': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const d = rund(skalar(minus(pa, pb), vorne));
            return { name, art, wert_m: d,
              bedeutet: d >= 0
                ? `${frage.a} liegt ${d} m VOR ${frage.b}`
                : `${frage.a} liegt ${Math.abs(d)} m HINTER ${frage.b}` };
          }
          case 'abstand_seite': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const d = rund(skalar(minus(pa, pb), seite));
            return { name, art, wert_m: d, bedeutet: `${frage.a} liegt ${d} m seitlich von ${frage.b}` };
          }
          case 'abstand_hoch': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const d = rund(pa[1] - pb[1]);
            return { name, art, wert_m: d,
              bedeutet: d >= 0
                ? `${frage.a} liegt ${d} m ÜBER ${frage.b}`
                : `${frage.a} liegt ${Math.abs(d)} m UNTER ${frage.b}` };
          }
          case 'winkel': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const pc = brauchePunkt(f, frage.c, 'c', i);
            const u = minus(pa, pb); const v = minus(pc, pb);
            const n = laenge(u) * laenge(v);
            if (n < 1e-9) {
              return { name, art, wert_grad: null,
                bedeutet: `Winkel nicht messbar: ${frage.a} oder ${frage.c} fällt mit ${frage.b} zusammen` };
            }
            const g = +(Math.acos(Math.min(1, Math.max(-1, skalar(u, v) / n))) * 180 / Math.PI).toFixed(1);
            return { name, art, wert_grad: g,
              bedeutet: `Der Winkel bei ${frage.b} zwischen ${frage.a} und ${frage.c} beträgt ${g}°` };
          }
          case 'neigung': {
            const pb = brauchePunkt(f, frage.b, 'b', i);
            const u = minus(pb, pa);
            const l = laenge(u);
            if (l < 1e-9) {
              return { name, art, wert_grad: null,
                bedeutet: `Neigung nicht messbar: ${frage.a} und ${frage.b} fallen zusammen` };
            }
            const g = +(Math.acos(Math.min(1, Math.max(-1, Math.abs(u[1]) / l))) * 180 / Math.PI).toFixed(1);
            const richtung = skalar(u, vorne) >= 0 ? 'nach vorne' : 'nach hinten';
            return { name, art, wert_grad: g,
              bedeutet: `Die Strecke ${frage.a} nach ${frage.b} weicht ${g}° von der Senkrechten ab, ${richtung}` };
          }
          case 'tempo': {
            pruefeFrame('measure', `fragen[${i}].bisFrame`, frage.bisFrame, z0.frameCount);
            const f2 = holeFrame(frage.bisFrame);
            const pa2 = brauchePunkt(f2, frage.a, 'a', i);
            const dt = Math.abs(frage.bisFrame - frameNr) / (z0.fps || 30);
            if (dt <= 0) {
              return { name, art, wert_m_pro_s: null,
                bedeutet: 'Tempo nicht messbar: bisFrame ist derselbe Frame' };
            }
            const weg = laenge(minus(pa2, pa));
            const v = +(weg / dt).toFixed(3);
            return { name, art, wert_m_pro_s: v, weg_m: rund(weg), dauer_s: +dt.toFixed(3),
              bedeutet: `${frage.a} legt zwischen Frame ${frameNr} und ${frage.bisFrame} `
                + `${rund(weg)} m zurück, das sind ${v} m/s` };
          }
          default:
            throw new WerkzeugMeldung({
              tool: 'measure', param: `fragen[${i}].art`, value: art,
              range: 'hoehe, abstand, abstand_vorne, abstand_seite, abstand_hoch, winkel, neigung, tempo',
              next: 'die Bedeutung jeder Art steht in der Werkzeugbeschreibung',
              message: `Messart "${art}" gibt es nicht: 8 Arten stehen zur Verfügung`
            });
        }
      });

      // Der Kopf steht einmal, nicht je Frame: Bodenhöhe und Blickrichtung
      // ändern sich über die Timeline nicht.
      const kopf = {
        quelle: 'gemessen an der gelösten Bewegung',
        bodenhoehe_m: +boden.toFixed(5),
        blickrichtung: vorne,
      };
      if (zielFrames.length === 1) {
        return json({ ...kopf, frame: zielFrames[0],
          messungen: messeFrame(holeFrame(zielFrames[0]), zielFrames[0]) });
      }
      return json({ ...kopf,
        frames: zielFrames,
        messungen: zielFrames.map((n) => ({ frame: n, werte: messeFrame(holeFrame(n), n) })) });
    },

    /** Der Ueberblick ueber die eigenen Schluesselbilder. */
    async list_poses() {
      const z0 = store.roh();
      const frames = gesetzteFrames(z0);
      if (frames.length === 0) {
        return text(`0 Haltungen gesetzt auf ${z0.frameCount} Frames Länge. `
          + 'Setze die erste mit set_pose.');
      }
      const zeilen = frames.map((f) => {
        const o = z0.overrides[String(f)] || {};
        const gelenke = Object.keys(o.joints || {});
        const winkel = gelenke.reduce((n, g) => n + Object.keys(o.joints[g] || {}).length, 0);
        const teile = [`Frame ${String(f).padStart(3)}`,
          `${gelenke.length} Gelenke`, `${winkel} Winkel`, `Übergang ${o.ease || 'smooth'}`];
        if (o.root && o.root.pos) teile.push(`Wurzel [${o.root.pos.join(', ')}] m`);
        if (o.root && o.root.drehGrad) {
          teile.push('Drehung ' + Object.entries(o.root.drehGrad)
            .map(([a, g]) => `${a} ${g}°`).join(' '));
        }
        return `  ${teile.join(' · ')}`;
      });
      return text(`${frames.length} Haltungen auf ${z0.frameCount} Frames `
        + `(${z0.fps} fps, ${(z0.frameCount / z0.fps).toFixed(2)} s):\n${zeilen.join('\n')}`);
    },

    /**
     * Eine Haltung zeitlich verschieben.
     *
     * Der Ablauf, den ein Animator erwartet, ist zweistufig: erst die
     * Haltungen bauen, dann den zeitlichen Verlauf zurechtruecken. Bisher war
     * beides derselbe Schritt — der Frame musste beim Setzen feststehen, und
     * es gab keinen Weg zurueck ausser undo von hinten.
     */
    async move_pose(args) {
      const a = pruefeObjekt('move_pose', 'Argumente', args, 'übergib {von, nach}');
      const z0 = store.roh();
      brauchtLaenge('move_pose', z0.frameCount);
      pruefeFrame('move_pose', 'von', a.von, z0.frameCount);
      pruefeFrame('move_pose', 'nach', a.nach, z0.frameCount);

      const gesetzt = gesetzteFrames(z0);
      if (!gesetzt.includes(a.von)) {
        throw new WerkzeugMeldung({
          tool: 'move_pose', param: 'von', value: a.von,
          range: gesetzt.length > 0
            ? `einer von ${gesetzt.length} gesetzten Frames: ${gesetzt.join(', ')}`
            : '0 gesetzte Frames vorhanden',
          next: 'welche Haltungen es gibt, sagt list_poses',
          message: `Auf Frame ${a.von} liegt keine Haltung: `
            + `gesetzt sind ${gesetzt.length} (${gesetzt.join(', ') || 'keine'})`
        });
      }
      if (a.nach !== a.von && gesetzt.includes(a.nach)) {
        throw new WerkzeugMeldung({
          tool: 'move_pose', param: 'nach', value: a.nach,
          range: `ein Frame ohne Haltung; belegt sind ${gesetzt.join(', ')}`,
          next: 'lösche die dortige Haltung mit delete_pose oder wähle einen anderen Frame',
          message: `Auf Frame ${a.nach} liegt bereits eine Haltung: `
            + 'sie würde überschrieben, das passiert nicht stillschweigend'
        });
      }

      store.aendere((z) => {
        z.overrides[String(a.nach)] = z.overrides[String(a.von)];
        delete z.overrides[String(a.von)];
      });
      const jetzt = gesetzteFrames(store.roh());
      return text(`Haltung von Frame ${a.von} auf Frame ${a.nach} verschoben. `
        + `${jetzt.length} Haltungen: ${jetzt.join(', ')}. Rücknehmbar mit undo.`);
    },

    /** Eine Haltung entfernen. Danach blendet der Löser darüber hinweg. */
    async delete_pose(args) {
      const a = pruefeObjekt('delete_pose', 'Argumente', args, 'übergib {frame}');
      const z0 = store.roh();
      brauchtLaenge('delete_pose', z0.frameCount);
      pruefeFrame('delete_pose', 'frame', a.frame, z0.frameCount);

      const gesetzt = gesetzteFrames(z0);
      if (!gesetzt.includes(a.frame)) {
        throw new WerkzeugMeldung({
          tool: 'delete_pose', param: 'frame', value: a.frame,
          range: gesetzt.length > 0
            ? `einer von ${gesetzt.length} gesetzten Frames: ${gesetzt.join(', ')}`
            : '0 gesetzte Frames vorhanden',
          next: 'welche Haltungen es gibt, sagt list_poses',
          message: `Auf Frame ${a.frame} liegt keine Haltung: `
            + `gesetzt sind ${gesetzt.length} (${gesetzt.join(', ') || 'keine'})`
        });
      }

      store.aendere((z) => { delete z.overrides[String(a.frame)]; });
      const jetzt = gesetzteFrames(store.roh());
      return text(`Haltung auf Frame ${a.frame} gelöscht; `
        + `${jetzt.length} Haltungen übrig${jetzt.length > 0 ? `: ${jetzt.join(', ')}` : ''}. `
        + 'Dazwischen wird jetzt über diese Stelle hinweg überblendet. Rücknehmbar mit undo.');
    },

    async describe_pose(args) {
      const a = pruefeObjekt('describe_pose', 'Argumente', args, 'übergib {frame}');
      const z0 = store.roh();
      brauchtLaenge('describe_pose', z0.frameCount);
      pruefeFrame('describe_pose', 'frame', a.frame, z0.frameCount);
      if (!ports.solver) {
        throw nichtAngeschlossen('describe_pose', 'AP5 (Löser)', 'Die gelöste Haltung');
      }

      const { frames } = ports.solver.loese(alsTimeline(z0));
      const f = (frames || []).find((x) => x.frame === a.frame);
      if (!f) {
        throw new WerkzeugMeldung({
          tool: 'describe_pose', param: 'frame', value: a.frame,
          range: `ein gelöster Frame von 0 bis ${(frames || []).length - 1}`,
          next: 'setze die Länge mit set_duration und Haltungen mit set_pose',
          message: `Frame ${a.frame} wurde nicht gelöst: der Löser lieferte `
            + `${(frames || []).length} Frames`
        });
      }

      // Weltpositionen nach Rollen statt nach Knochennamen: der Agent kennt
      // "hand_l", nicht "mixamorigLeftHand". Rollen ohne erkannten Knochen
      // werden weggelassen, nicht geraten.
      const rollen = (ports.rig && ports.rig.rig().roles) || {};
      const teile = {};
      for (const [rolle, eintrag] of Object.entries(rollen)) {
        const knochen = eintrag && eintrag.bone;
        const p = knochen && f.positions ? f.positions[knochen] : null;
        if (p) teile[rolle] = p.map((v) => +v.toFixed(4));
      }

      const schluessel = gesetzteFrames(z0);
      const gesetzt = schluessel.includes(a.frame);
      const vorher = schluessel.filter((k) => k < a.frame).pop();
      const nachher = schluessel.find((k) => k > a.frame);
      const boden = ports.rig ? (ports.rig.world().groundY ?? 0) : 0;

      return json({
        quelle: 'gelöst',
        frame: a.frame,
        von: z0.frameCount,
        fps: z0.fps,
        herkunft: gesetzt
          ? 'gesetzte Haltung (set_pose oder set_joint)'
          : (vorher !== undefined && nachher !== undefined
            ? `überblendet zwischen Frame ${vorher} und ${nachher}`
            : 'aus Phasen oder Ausgangshaltung, kein gesetzter Frame in der Nähe'),
        naechsteSchluesselFrames: { davor: vorher ?? null, danach: nachher ?? null },
        kontakt: f.contact ?? null,
        // Der tiefste Punkt der Figur (Sohlen und Knochen) ueber dem Boden;
        // negativ heisst im Boden. Vorher hatte der Agent nur „kontakt" und
        // die Hoehe des Fussknochens — 8,8 cm ueber der Sohle, unbrauchbar.
        bodenabstand_m: f.bodenabstand_m ?? null,
        wurzelhoehe: f.hoehe ?? null,
        sohlen_m: sohlenHoehen(f, boden, ports.rig ? ports.rig.world().height : null),
        schwerpunkt_m: f.com ? f.com.map((v) => +v.toFixed(4)) : null,
        schwerpunktHoeheUeberBoden_m: f.com ? +(f.com[1] - boden).toFixed(4) : null,
        wurzel: f.root
          ? { pos_m: f.root.pos.map((v) => +v.toFixed(4)), quat: f.root.quat.map((v) => +v.toFixed(5)) }
          : null,
        koerperteile_m: teile,
        // Die tatsaechlich gefahrenen Winkel — nach Gelenk und Kanal, in Grad.
        // Das ist, was ein Animator im Viewport ablesen wuerde. Vorher stand
        // hier nur, was der Agent selbst gesetzt hatte; bei ueberblendeten
        // Frames war das leer, und er konnte seine eigene Haltung nicht sehen.
        winkel_grad: gelenkeAusDofs(f.dofs),
        gesetzteWinkel_grad: (z0.overrides[String(a.frame)] || {}).joints ?? {},
        hinweis: 'Positionen in Metern im Weltsystem, y ist oben. '
          + `Bodenebene bei ${+boden.toFixed(5)} m. bodenabstand_m ist der tiefste Punkt der Figur `
          + 'ueber dem Boden (0 = steht, negativ = im Boden); wurzelhoehe sagt, ob der Boden '
          + '(boden), dein root.pos (gesetzt) oder eine Anhebung (angehoben) die Hoehe bestimmt hat. '
          + 'Das Bild dazu liefert look.'
      });
    },

    // --- 12  Undo -----------------------------------------------------------

    async undo() {
      const vorher = store.tiefe();
      if (!store.undo()) {
        throw new WerkzeugMeldung({
          tool: 'undo', param: 'Undo-Stapel', value: 0,
          range: 'mindestens 1 rücknehmbarer Schritt',
          next: 'es gibt nichts zurückzunehmen',
          message: '0 rücknehmbare Schritte vorhanden: seit dem Start wurde nichts geändert'
        });
      }
      const z = store.roh();
      return text(`Letzte Änderung zurückgenommen; ${store.tiefe()} von zuvor ${vorher} Schritten `
        + `bleiben rücknehmbar. Stand: ${z.phases.length} Phasen, `
        + `${Object.keys(z.overrides).length} Frames mit Overrides, ${z.frameCount} Frames Länge.`);
    },

    // --- 13..14  Sehen ------------------------------------------------------

    async validate() {
      const z0 = store.roh();
      brauchtLaenge('validate', z0.frameCount);
      if (!ports.validator) {
        throw nichtAngeschlossen('validate', 'AP4/AP6 (Prüfungen)', 'Der Validierungsbericht');
      }

      // Befund aus dem echten Browserlauf: ohne gesetzte Absicht wirft der
      // Bericht tief unten ein nacktes Error, das registry.js als "Absturz"
      // verpackt — mit einem widersprüchlichen Parametervergleich und einem
      // Rat, fehlende Felder mitzuschicken, den es nicht gibt (validate hat
      // laut Schema 0 Parameter). Die Prüfung sitzt deshalb HIER, vor jedem
      // anderen Aufruf, und wirft eine Werkzeugmeldung: sie kommt als
      // isError-Antwort an, nicht als Absturz, und rät auf set_intent.
      // Ohne gesetzte Kriterien prueft validate trotzdem: Physik und Stil
      // brauchen keine Absicht. Vorher wurde hier abgewiesen und auf
      // set_intent verwiesen — im Agentenlauf war das eine Sackgasse, denn
      // set_intent wartet auf einen Menschen. Die Absichtsschicht entfaellt
      // dann, und der Bericht sagt genau das.
      const kriterien = z0.intent && Array.isArray(z0.intent.checks)
        ? z0.intent.checks
        : [];

      const timeline = alsTimeline(z0);
      if (ports.solver) timeline.solved = ports.solver.loese(timeline);

      // Die Absichtsschicht darf den ganzen Bericht nicht mitreissen.
      //
      // Gemessen im Agentenlauf: ein Kriterium mit richtung: "hoch" statt
      // [x, y, z] kam durch pruefeKriterien (die prueft, ob Felder DA sind,
      // nicht ob sie stimmen) und liess validate abstuerzen. Der Agent
      // verlor damit auch die Physikpruefung, die voellig in Ordnung war.
      // Jetzt faellt nur die Absichtsschicht aus, mit Grund im Bericht.
      let bericht;
      try {
        bericht = ports.validator.pruefe(timeline, { intent: z0.intent });
      } catch (e) {
        if (kriterien.length === 0) throw e;
        bericht = ports.validator.pruefe(timeline, { intent: [] });
        bericht.absichtAusgefallen = `${kriterien.length} Absichtskriterien konnten nicht `
          + `geprueft werden: ${String(e && e.message || e)}. Physik und Stil stehen `
          + 'unveraendert; setze die Kriterien mit set_intent korrigiert neu.';
      }

      // plan.md 5.3: "Jeder Bericht enthaelt immer einen Bildverweis. Zahlen
      // ohne Bild werden nicht ausgeliefert." Fehlt der Streifen, wird er hier
      // beschafft — nicht weggelassen.
      // Bilddaten, die der Pruefer beim Bauen des Berichts schon gerendert hat
      // (src/tools/ports.js). Sie gehen in die Antwort, der Bericht selbst
      // traegt weiter nur die Verweise — sonst stuende das Bild zweimal drin.
      let bilder = Array.isArray(bericht.bilddaten) ? bericht.bilddaten : [];
      delete bericht.bilddaten;

      // Befund 2, gemessen an Xbot (Auftrag "Zwei Befunde am Werkzeug validate"):
      // 12 Frames × 2 Ansichten gaben eine Antwort von 527 KB jenseits der
      // 512-KB-Grenze — der Aufruf wurde abgewiesen, NACHDEM gerechnet war.
      // Der Streifen startet deshalb mit höchstens VALIDATE_FRAMES_MAX Frames.
      // Ist die kritische Auswahl länger, bleiben die ERSTEN n Frames — bei
      // sortierter Auswahl decken sie Stütz, Druck und Flug ab, die Landung
      // kommt mit dem letzten Frame mit.
      if (bericht.images && bericht.images.length > 0
          && bilder[0] && Array.isArray(bilder[0].frames)
          && bilder[0].frames.length > VALIDATE_FRAMES_MAX) {
        const behalten = bilder[0].frames.slice(0, VALIDATE_FRAMES_MAX);
        bilder = ports.renderer
          ? ports.renderer.streifen({ frames: behalten, views: ['side', 'front'] })
          : [];
        bericht.images = bilder.map(({ view, frames: f, ref }) => ({ view, frames: f, ref }));
      }

      if ((!bericht.images || bericht.images.length === 0) && ports.renderer) {
        const frames = kritischeFrames(bericht, z0.frameCount)
          .slice(0, VALIDATE_FRAMES_MAX);
        bilder = ports.renderer.streifen({ frames, views: ['side', 'front'] });
        bericht.images = bilder.map(({ view, frames: f, ref }) => ({ view, frames: f, ref }));
      }
      if (!bericht.images || bericht.images.length === 0) {
        throw nichtAngeschlossen('validate', 'AP9 (Bildstreifen)',
          'Ein Bericht ohne Bildstreifen wird nicht ausgeliefert (plan.md 5.3)');
      }

      // Zeitgrenze (Auftrag "Der Bildstreifen frisst den Rechner"): kürzt der
      // Streifen Frames weg, um unter der gemessenen Zeitgrenze zu bleiben,
      // steht das mit Zahlen im Antworttext — der Agent erfährt, welche Frames
      // er nicht sieht und kann sie mit look je Frame nachfragen.
      const warnung = bilder
        .map((b) => (b && Array.isArray(b.warnungen)) ? b.warnungen.join(' | ') : '')
        .filter((w) => w.includes('Zeitgrenze'))
        .join(' | ');
      // Fehlt die Absicht, wird trotzdem geprueft — und gesagt, welche
      // Schicht dabei ausgelassen wurde. Nicht verweigern: set_intent wartet
      // auf einen Menschen, und ohne Menschen kaeme der Agent nie zu einer
      // Pruefung seiner Physik.
      const ohneAbsicht = kriterien.length === 0
        ? '\n0 Absichtskriterien gesetzt: geprueft wurden Physik und Stil. '
          + 'Woran die Bewegung inhaltlich gemessen wird, legt set_intent fest '
          + `(1 bis 20 Kriterien aus den ${INTENT_ARTEN.length} Arten: `
          + `${INTENT_ARTEN.join(', ')}).`
        : '';
      // Wie oft der Massstab gewechselt hat. Ohne diese Zeile ist "bestanden"
      // wertlos: im Agentenlauf vom 1. September 2026 lief set_intent fuenfmal,
      // und beim letzten Mal fehlte genau das Kriterium, an dem die vier Laeufe
      // davor gescheitert waren. Der Bericht sah danach sauber aus.
      const fassungen = z0.intent?.fassungen ?? [];
      const gewechselt = fassungen.length > 1
        ? `\nAchtung: die Kriterien wurden ${fassungen.length - 1} mal neu gesetzt. `
          + `Fassung 1 hatte ${fassungen[0].anzahl} Kriterien `
          + `(${[...new Set(fassungen[0].arten)].join(', ')}), `
          + `Fassung ${fassungen.length} hat ${fassungen[fassungen.length - 1].anzahl} `
          + `(${[...new Set(fassungen[fassungen.length - 1].arten)].join(', ')}). `
          + `${[...new Set(fassungen[0].arten)]
            .filter((k) => !fassungen[fassungen.length - 1].arten.includes(k)).length} `
          + 'Kriterienart aus Fassung 1 wird nicht mehr geprueft. '
          + 'Ein Ergebnis gilt gegen den Massstab, mit dem es gemessen wurde.'
        : '';

      // Erst zusammenfassen, dann in Text gießen: die Kappungsstufen weiter
      // unten sollen an einer Liste arbeiten, die schon keine Wiederholungen
      // mehr enthält — sonst wirft sie echte Befunde weg, um Dubletten zu
      // behalten.
      const { bericht: gefasst, vorher: befundeVorher, nachher: befundeNachher }
        = fasseIssuesZusammen(bericht);

      // Flug schaltet Balance und Rutschen ab — phasenabhaengig, so gewollt
      // (AGENTS.md). Nur muss der Agent es erfahren: im Buehnenlauf vom
      // 2. September 2026 schwebte eine Landepose unbemerkt, und die
      // Balancepruefung, die „kippt nach hinten" gemeldet haette, lief nie.
      const flug = (gefasst.phases ?? []).filter((p) => p.state === 'flug');
      const flugFrames = flug.reduce((n, p) => n + (p.to - p.from), 0);
      const flugText = flug.length > 0
        ? `\nFlugphase in ${flug.map((p) => `Frames ${p.from}–${p.to - 1}`).join(', ')} `
          + `(${flugFrames} von ${gefasst.frameCount} Frames): dort werden Balance und Fussrutschen `
          + 'nicht geprueft. Soll die Figur dort stehen, lass root.pos y weg (oder null) — '
          + 'der Loeser stellt sie auf den Boden.'
        : '';

      const text = berichtTextKompakt(gefasst, bilder)
        + (warnung ? `\n(${warnung})` : '')
        + flugText
        + ohneAbsicht
        + (befundeVorher > befundeNachher
          ? `\n${befundeVorher} Einzelbefunde zu ${befundeNachher} zusammengefasst `
            + '(gleiche Art am selben Körperteil über aufeinanderfolgende Frames). '
            + 'von/bis nennen die Spanne, frame den größten Betrag.'
          : '')
        + gewechselt;

      return textMitBildern(text, bilder);
    },

    async look(args) {
      const a = pruefeObjekt('look', 'Argumente', args,
        'übergib {frame} — richtung_grad, hoehe_grad, ziel und weite sind freiwillig');
      const z0 = store.roh();
      brauchtLaenge('look', z0.frameCount);
      pruefeFrame('look', 'frame', a.frame, z0.frameCount);

      // Ein Aufruf, ein Bild in voller Größe (Befund 1.1 vom 2.9.2026): das
      // Raster aus Frames × Ansichten hat dem Agenten die Auflösung genommen,
      // die er zum Beurteilen einer Pose braucht. Die Kamera prüft strip.js
      // selbst — hier werden nur die Zahlen abgefangen, die schon am Schema
      // scheitern müssten.
      const kamera = {
        richtung_grad: pruefeGradOptional('look', 'richtung_grad', a.richtung_grad, 0, 359),
        hoehe_grad: pruefeGradOptional('look', 'hoehe_grad', a.hoehe_grad, -89, 90),
        ziel: a.ziel === undefined ? undefined
          : pruefeText('look', 'ziel', a.ziel, 'ein Körperteil aus describe_rig oder "figur"', 60),
        weite: a.weite === undefined ? undefined
          : pruefeAuswahl('look', 'weite', a.weite, WEITEN,
            'ganz zeigt die Figur, halb ein Körperteil, nah ein Gelenk'),
      };

      if (!ports.renderer) {
        throw nichtAngeschlossen('look', 'AP9 (Bildstreifen)', 'Das Bild');
      }

      // Befund aus dem Browserlauf am Xbot: look lehnte mit "0 geloeste Frames"
      // ab und riet auf validate — validate wiederum verlangte zuerst
      // set_intent, und set_intent wartete auf einen Klick. Drei Werkzeuge
      // zwischen dem Agenten und dem ersten Bild, bei einem Werkzeug, das nur
      // hinschauen soll. look loest deshalb selbst: der Bildstreifen zeigt
      // immer den aktuellen Stand von phases und overrides, ohne Vorbedingung.
      let loeserBericht = null;
      if (ports.solver) {
        loeserBericht = ports.solver.loese(alsTimeline(z0)).bericht ?? null;
      }

      const bild = ports.renderer.bild({ frame: a.frame, ...kamera });
      const k = bild.kamera || {};
      const naechste = [a.frame - NACHBAR_ABSTAND, a.frame + NACHBAR_ABSTAND]
        .filter((f) => f >= 0 && f < z0.frameCount);

      return textMitBildern(
        `Frame ${a.frame} von ${z0.frameCount}, ein Bild in voller Größe. `
        + `Kamera: ${k.sag} — richtung ${k.richtungGrad}°, hoehe ${k.hoeheGrad}°, `
        + `ziel ${k.ziel}, weite ${k.weite}`
        + (bild.massstab ? ` (${zahl(bild.massstab.sichtHoeheMeter, 2)} m Bildhöhe, `
          + `${zahl(bild.massstab.pxProMeter, 0)} px/m)` : '')
        + '. Annotiert mit Achsenkreuz, Bodengitter, Höhenleiste, Schwerpunkt, '
        + 'Stützfläche und Kontaktpunkten.'
        // Der Verlauf ist der Teil, den der Streifen früher erledigte. Ohne
        // diesen Satz weiß der Agent nicht, dass er ihn weiterhin sehen kann —
        // eine Möglichkeit, von der nirgends etwas steht, hat er nicht.
        + (naechste.length
          ? `\nDen VERLAUF siehst du, indem du dieselbe Kamera auf die Nachbarframes `
            + `richtest, z. B. look frame ${naechste.join(' und ')}. Maßstab und `
            + `Bodengitter bleiben gleich, die Bilder sind vergleichbar.`
          : '')
        + (bild.warnung ? `\n${bild.warnung}` : '')
        + standMeldung(z0, loeserBericht),
        [bild]
      );
    },

    /**
     * trace — der Ablauf als Folge GROSSER Einzelbilder.
     *
     * Zwei Wege dahin waren falsch (docs/buehne-befunde-2026-09-02.md): der
     * alte Bildstreifen klebte sechs Frames in ein PNG und machte jede Figur
     * fingernagelgross; die Bewegungsspur legte alle Bahnen in ein Bild und
     * verlangte Deutung — bei drei Rueckwaertssaltos ueberlagern sich die
     * Bahnen zu einem Knaeuel. Eine MCP-Antwort traegt beliebig viele Bilder;
     * sie muessen nicht in eines gezwungen werden.
     */
    async trace(args) {
      const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
      const z0 = store.roh();
      brauchtLaenge('trace', z0.frameCount);

      let von = 0;
      let bis = z0.frameCount - 1;
      if (a.von !== undefined) { pruefeFrame('trace', 'von', a.von, z0.frameCount); von = Number(a.von); }
      if (a.bis !== undefined) { pruefeFrame('trace', 'bis', a.bis, z0.frameCount); bis = Number(a.bis); }
      if (von > bis) {
        throw new WerkzeugMeldung({
          tool: 'trace', param: 'von', value: von,
          range: `kleiner oder gleich bis (${bis})`,
          next: 'vertausche von und bis',
          message: `von ${von} liegt hinter bis ${bis}: der Bereich ist 0 Frames lang`
        });
      }

      const kamera = {
        richtung_grad: pruefeGradOptional('trace', 'richtung_grad', a.richtung_grad, 0, 359),
        hoehe_grad: pruefeGradOptional('trace', 'hoehe_grad', a.hoehe_grad, -89, 90),
        ziel: a.ziel === undefined ? undefined
          : pruefeText('trace', 'ziel', a.ziel, 'ein Körperteil aus describe_rig oder "figur"', 60),
        weite: a.weite === undefined ? undefined
          : pruefeAuswahl('trace', 'weite', a.weite, WEITEN,
            'ganz zeigt die Figur, halb ein Körperteil, nah ein Gelenk'),
      };
      if (!ports.renderer) {
        throw nichtAngeschlossen('trace', 'AP9 (Bildstreifen)', 'Die Bildfolge');
      }
      let loeserBericht = null;
      if (ports.solver) loeserBericht = ports.solver.loese(alsTimeline(z0)).bericht ?? null;

      const frames = folgeFrames(von, bis, FOLGE_BILDER);

      // Die Kamera FOLGT der Figur, sie steht nicht still. Beides wurde
      // gemessen: bei fester Kamera lief die Figur eines Standweitsprungs
      // (1,45 m weit) aus dem 2,26 m breiten Bildfeld — die Pose war dann
      // halb abgeschnitten. Fuer die Frage 'flieszt die Bewegung' zaehlt die
      // Haltung; die Ortsveraenderung steht in describe_pose und validate, und
      // das Bodengitter steht weltfest, zeigt sie also mit.
      const bilder = frames.map((f) => ports.renderer.bild({
        frame: f, skala: FOLGE_SKALA, sparsam: true, ...kamera,
      }));
      const k = bilder[0]?.kamera || {};

      // Wie es weitergeht: ohne diesen Satz sieht der Agent drei Bilder und
      // weiss nicht, dass zwischen ihnen noch Bewegung liegt.
      const luecke = frames.length > 1 ? frames[1] - frames[0] : 0;
      const weiter = luecke > 1
        ? ` Zwischen den gezeigten Frames liegen je ${luecke - 1} weitere. Willst du einen `
          + `Abschnitt genauer sehen, ruf trace mit von und bis auf, z. B. von ${frames[0]} `
          + `bis ${frames[1]}.`
        : '';

      return textMitBildern(
        `${bilder.length} Bilder in voller Größe, Frames ${frames.join(', ')} `
        + `von ${z0.frameCount} — in dieser Reihenfolge zu lesen wie ein Daumenkino. `
        + `Kamera in allen Bildern gleich: richtung ${k.richtungGrad}°, hoehe ${k.hoeheGrad}°, `
        + `ziel ${k.ziel}, weite ${k.weite} — der Maßstab ist in allen Bildern derselbe. Die `
        + 'Kamera folgt der Figur; wie weit sie sich bewegt hat, siehst du am weltfesten '
        + 'Bodengitter und in den Zahlen von describe_pose.'
        + weiter
        + standMeldung(z0, loeserBericht),
        bilder
      );
    },

    // --- 15  Der Mensch -----------------------------------------------------

    async ask_human(args) {
      const a = pruefeObjekt('ask_human', 'Argumente', args, 'übergib {question, options}');
      pruefeText('ask_human', 'question', a.question,
        'frage in Alltagssprache, beantwortbar mit einem Klick', 300);
      pruefeListe('ask_human', 'options', a.options, 2, 6,
        'weniger als 2 ist keine Wahl, mehr als 6 überfordert den Klick');
      a.options.forEach((o, i) => pruefeText('ask_human', `options[${i}]`, o,
        'jede Antwortmöglichkeit ist ein kurzer Satz', 80));

      const antwort = await ask.frage({ question: a.question, options: a.options });
      const stand = ask.stand();
      return text(`Antwort: "${antwort.answer}" (Möglichkeit ${antwort.index + 1} von `
        + `${a.options.length}). Noch ${stand.uebrig} von ${stand.budget} Fragen frei.`);
    },

    // --- 16  Export ---------------------------------------------------------

    /** Nagelt einen Fuss fest. Der Loeser haelt ihn (halteAnker in loeser.js). */
    async hold_foot(args) {
      const a = pruefeObjekt('hold_foot', 'Argumente', args, 'uebergib {foot, von, bis}');
      const z0 = store.roh();
      brauchtLaenge('hold_foot', z0.frameCount);
      pruefeFrame('hold_foot', 'von', a.von, z0.frameCount);
      pruefeFrame('hold_foot', 'bis', a.bis, z0.frameCount);

      const rollen = (ports.rig && ports.rig.rig().roles) || {};
      const fuesse = Object.keys(rollen).filter((r) => /^foot_[lr]$/.test(r));
      const wahl = fuesse.length ? fuesse : ['foot_l', 'foot_r'];
      // „beide" ist erlaubt — der Katalogtext versprach es, das Schema lehnte
      // es ab (Buehnenlauf 2. September 2026, Pose 11).
      pruefeAuswahl('hold_foot', 'foot', a.foot, [...wahl, 'beide'],
        'die Fussrollen stehen in describe_rig; beide nagelt beide Fuesse fest');
      const gewaehlt = a.foot === 'beide' ? wahl : [a.foot];

      if (a.bis <= a.von) {
        throw new WerkzeugMeldung({
          tool: 'hold_foot', param: 'bis', value: a.bis,
          range: `groesser als von (${a.von}) und hoechstens ${z0.frameCount - 1}`,
          next: 'setze bis auf einen spaeteren Frame als von',
          message: `bis ${a.bis} liegt nicht nach von ${a.von}: ein Anker braucht mindestens 2 Frames`
        });
      }

      if (a.remove === true) {
        const vorher = (z0.anchors || []).length;
        store.aendere((z) => {
          z.anchors = (z.anchors || []).filter((x) =>
            !(gewaehlt.includes(x.foot) && x.von >= a.von && x.bis <= a.bis));
        });
        const nachher = (store.roh().anchors || []).length;
        // Entfernt wird nur, was GANZ in der genannten Spanne liegt. Ein Anker,
        // der darueber hinausragt, bleibt stehen — und der Agent bekam dafuer
        // dieselbe Antwort wie fuer "es gab nichts zu entfernen": „0 Anker
        // entfernt". Er hat dann geraten. Ragt einer hinaus, sagt die Antwort
        // es jetzt mit seiner Spanne und nennt den Weg dahin.
        const ragtRaus = (store.roh().anchors || []).filter((x) =>
          gewaehlt.includes(x.foot) && x.von <= a.bis && x.bis >= a.von);
        const hinweis = ragtRaus.length
          ? ` ${ragtRaus.length} Anker beruehren deine Spanne, ragen aber darueber hinaus und bleiben `
            + `deshalb stehen (${ragtRaus.map((x) => `${x.foot} ${x.von}-${x.bis}`).join(', ')}): `
            + 'remove greift nur, wenn die genannte Spanne den Anker ganz umschliesst. '
            + 'Willst du einen davon aendern, ruf hold_foot ohne remove mit der neuen Spanne — '
            + 'sie ersetzt ihn, und der Fuss bleibt an seinem Ort.'
          : '';
        return text(`${vorher - nachher} Anker fuer ${gewaehlt.join(' und ')} in Frames ${a.von}-${a.bis} entfernt; `
          + `${nachher} bleiben.${hinweis}`);
      }

      // Eine Spanne aendern war frueher zwei Aufrufe: remove, dann neu setzen.
      // Im Lauf vom 2. September 2026 waren 14 von 32 hold_foot-Aufrufen
      // solche Entfernungen. Ueberschneidet sich die neue Spanne mit einer
      // bestehenden DESSELBEN Fusses, ersetzt sie diese jetzt.
      //
      // Der Ort wandert dabei NICHT mit: der Loeser nimmt den Sollort aus dem
      // ersten Frame der Spanne, und aus 40-78 mach 50-72 hiesse sonst, den
      // Fuss auf die Stelle zu nageln, an der er in Frame 50 gerade steht —
      // 11 cm weiter, gemessen am Xbot bei 22 cm Wurzelfahrt. Der Ersatz erbt
      // deshalb `ortFrame` (src/solver/loeser.js, halteAnker).
      const ueberlappt = (x, foot) =>
        x.foot === foot && x.von <= a.bis && x.bis >= a.von;
      const ersetzt = (z0.anchors || []).filter((x) => gewaehlt.some((f) => ueberlappt(x, f)));
      // Bei mehreren ueberlappenden Ankern zaehlt der frueheste: sein Ort ist
      // der aelteste, den der Agent gemeint hat.
      const ortJeFuss = new Map();
      for (const x of [...ersetzt].sort((p, q) => p.von - q.von)) {
        if (!ortJeFuss.has(x.foot)) ortJeFuss.set(x.foot, x.ortFrame ?? x.von);
      }

      store.aendere((z) => {
        const bleiben = (z.anchors || []).filter((x) => !gewaehlt.some((f) => ueberlappt(x, f)));
        z.anchors = [...bleiben, ...gewaehlt.map((foot) => {
          const ort = ortJeFuss.get(foot);
          return ort === undefined || ort === a.von
            ? { foot, von: a.von, bis: a.bis }
            : { foot, von: a.von, bis: a.bis, ortFrame: ort };
        })];
      });

      const alle = store.roh().anchors;
      const orte = [...new Set([...ortJeFuss.values()])];
      const ersatzsatz = ersetzt.length
        ? `Das ersetzt ${ersetzt.length} fruehere${ersetzt.length === 1 ? 'n' : ''} Anker `
          + `(${ersetzt.map((x) => `${x.foot} ${x.von}-${x.bis}`).join(', ')}) — der Ort bleibt der alte, `
          + 'nur die Spanne ist neu. '
        : '';
      return text(`${gewaehlt.join(' und ')} ${gewaehlt.length > 1 ? 'stehen' : 'steht'} ab jetzt in den Frames ${a.von} bis ${a.bis} fest `
        + `(${a.bis - a.von + 1} Frames), dort, wo ${gewaehlt.length > 1 ? 'sie' : 'er'} auf Frame ${orte.length === 1 ? orte[0] : a.von} ${gewaehlt.length > 1 ? 'stehen' : 'steht'}. `
        + ersatzsatz
        + 'Der Loeser rechnet die Beinkette dafuer. Ohne gesetzte Hoehe (root.pos y) darf das Becken '
        + 'dafuer sinken; hast du eine Hoehe gesetzt, bleibt sie. Das freie Bein haeltst du selbst '
        + 'ueber dem Boden — steckt es im Boden, wird die Figur angehoben und der Anker verfehlt, '
        + 'die Wirkung sagt es dir. '
        + `${alle.length} Anker insgesamt: ${alle.map((x) => `${x.foot} ${x.von}-${x.bis}`).join(', ')}.`
        + '\nRuecknehmbar mit undo.'
        + wirkung(store.roh(), a.von, ports));
    },

    async export_clip() {
      const z0 = store.roh();
      brauchtLaenge('export_clip', z0.frameCount);
      if (!ports.exporter) {
        throw nichtAngeschlossen('export_clip', 'den Export (plan.md 6.9)', 'Die glTF-Datei');
      }
      const timeline = alsTimeline(z0);
      if (ports.solver) timeline.solved = ports.solver.loese(timeline);
      // await, weil der echte Export (src/export/gltf.js) die Datei asynchron
      // schreibt. Die Attrappe liefert ein einfaches Objekt — await laesst das
      // unveraendert durch.
      const e = await ports.exporter.gltf(timeline);
      return text(`Export: ${e.bytes} Bytes glTF, ${z0.frameCount} Frames bei ${z0.fps} fps, `
        + `${z0.phases.length} Phasen, Meter, Y-oben, Charakter-vorne +Z, Rotationen als `
        + `Quaternionen.${e.warnung ? `\n${e.warnung}` : ''}`);
    }
  };

  // Katalog und Ruempfe zusammenfuehren. Fehlt ein Rumpf, faellt es hier auf
  // und nicht erst beim ersten Aufruf des Agenten.
  return KATALOG.map((eintrag) => {
    const fn = rumpf[eintrag.name];
    if (typeof fn !== 'function') {
      throw new Error(`Werkzeug "${eintrag.name}" steht im Katalog, hat aber keinen Rumpf `
        + `(${KATALOG.length} Einträge, ${Object.keys(rumpf).length} Rümpfe)`);
    }
    return { ...eintrag, execute: fn };
  });
}

/** Frames, die im Bericht auffallen; sonst gleichmaessig verteilte Stichprobe. */
function kritischeFrames(bericht, frameCount) {
  const aus = new Set();
  for (const bereich of ['physics', 'style']) {
    const issues = (bericht[bereich] && bericht[bereich].issues) || [];
    for (const i of issues) if (Number.isInteger(i.frame)) aus.add(i.frame);
  }
  if (aus.size === 0) {
    const n = Math.min(5, frameCount);
    for (let i = 0; i < n; i += 1) aus.add(Math.round((i * (frameCount - 1)) / Math.max(1, n - 1)));
  }
  return [...aus].sort((a, b) => a - b).slice(0, 12);
}

/**
 * BENANNTER VERFAHRENSPARAMETER: hoechste Panelzahl eines validate-Streifens.
 * Gemessen an Xbot, 60 Frames, 4 Phasen (Befund 2 aus dem Auftrag): 12 Frames
 * × 2 Ansichten = 24 Panels ergeben ein PNG von 328 KB (2696 × 572 px); mit
 * Base64 (~438 KB) und Berichttext (80 KB, pretty JSON) ist die Antwort 527 KB
 * und überschreitet die gemessene 512-KB-Grenze — der Aufruf wurde als Fehler
 * abgewiesen, obwohl er gerechnet hatte. Zwei spätere Messungen lehrten die
 * feineren Zahlen: Base64 macht aus 447 KB PNG 596 KB Übertragung (Faktor 4/3),
 * und der Berichttext ist kompakt 55 KB. Damit landet 6 Frames × 2 Ansichten
 * (1856 × 784 px, PNG 447 KB) bei 651 KB — immer noch darüber. 4 Frames ×
 * 2 Ansichten: ein Frame je Phase bei 4 Phasen, Bild ~1,0 MPix ≈ 333 KB
 * Base64, gesamt mit Bericht ≈ 390 KB — messbar unter der Grenze. Wird der
 * Wert angepasst, erneut gegen Xbot messen (Messskript:
 * spikes/tmp-validate-messung.mjs) und die Zahl hier fortschreiben.
 */
export const VALIDATE_FRAMES_MAX = 4;

/** BENANNTER VERFAHRENSPARAMETER (Auftrag "Der Bildstreifen frisst den Rechner",
 *  Schritt 2): das Tool validate selbst sagt dem Streifen, wie viele Panels er
 *  bringen darf — gemessen an Xbot, SwiftShader, dauerte der Vorher-Zustand
 *  12 Frames × 2 Ansichten 1133 ms (24 Panels), und die Streifengrenze
 *  PANELS_ZEIT_MAX in src/render/strip.js (24 Panels) kürzt jeden größeren
 *  Aufruf. VALIDATE frägt maximal VALIDATE_FRAMES_MAX Frames × 2 Ansichten an,
 *  also 8 Panels — die Grenze im Streifen bleibt nonetheless als hartes Netz
 *  stehen (gemessen im Test "Zeitgrenze, Negativfall"). */

/** Verfahrensparameter: Issues je Liste, die in der (seltenen) Kürzungsfassung
 *  stehen bleiben. 200 ist mehr als jede bisher gemessene issue-Liste eines
 *  Xbot-Laufs (höchste Zahl war 26 auf physics bei 90 Frames); die Kappung
 *  greift also nur bei modellbedingten Ausreißern, nie im Normalfall. */
export const ISSUES_KAPPUNG = 200;

/** Bytelaenge eines Texts — UTF-8, gemessen, nicht geschaetzt. */
function textBytes(t) {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(t).length
    : t.length;
}

/** Antwortgroesse in Bytes, mit den Bilddaten, die mitgehen. `data` ist die
 *  Base64-Fassung — ihre Bytanzahl IST die Übertragungsgröße, sie wird nicht
 *  nochmal umgerechnet. Der Fehler, hier PNG-Bytes weiterzureichen, verfälschte
 *  die Schätzung um genau den 4/3-Faktor: gerechnet 527 KB, über die Leitung
 *  658 KB (gemessen an Xbot, siehe VALIDATE_FRAMES_MAX). */
function antwortBytes(bilder) {
  let summe = 0;
  for (const b of bilder) {
    if (typeof b?.data === 'string') summe += b.data.length;
  }
  return summe;
}

/**
 * Was diese Haltung tatsächlich bewirkt hat — die Antwort auf „und jetzt?".
 *
 * Gemessen an zwei Agentenläufen am 1. September 2026: set_pose quittierte nur
 * („11 Gelenke, 13 Winkel gesetzt"). Der Agent sah die Wirkung erst beim
 * nächsten validate — nach zwölf gesetzten Haltungen. Dann warf er alle zwölf
 * weg und baute neu. Frame 8, 19 und 26 wurden je viermal gesetzt, 21 von 25
 * Frames mehrfach. Ein Block kostete ihn 213 Sekunden Rechnen im Kopf, weil er
 * aus Gelenkwinkeln auf Weltpositionen schließen musste — die Rechnung, die der
 * Löser ohnehin macht.
 *
 * Hier steht deshalb nach jeder Haltung, was der Löser daraus gemacht hat:
 * wo die Füße stehen, ob sie den Boden berühren, und ob der Standfuß gegenüber
 * dem vorigen Schlüsselbild wandert. Drei Zeilen statt drei Minuten Kopfrechnen.
 *
 * Fällt der Löser aus, bleibt die Zeile leer: eine Haltung zu setzen darf nicht
 * daran scheitern, dass die Wirkung nicht gemessen werden kann.
 */
function wirkung(z, frame, ports) {
  if (!ports.solver || !ports.rig) return '';
  try {
    const { frames } = ports.solver.loese(alsTimeline(z));
    const hier = (frames || []).find((f) => f.frame === frame);
    if (!hier) return '';

    const rollen = (ports.rig.rig().roles) || {};
    const boden = (ports.rig.world().groundY) ?? 0;
    const punkt = (f, rolle) => {
      const bone = rollen[rolle] && rollen[rolle].bone;
      return bone ? (f.positions && f.positions[bone]) ?? null : null;
    };

    const zeilen = [];

    // Ob die Figur den Boden beruehrt, sagt der Loeser selbst (frame.contact,
    // gemessen an den Sohlenpunkten). Die Hoehe des FUSSKNOCHENS taugt dafuer
    // nicht: er sitzt am Xbot 8,8 cm ueber der Sohle, und eine Figur, die
    // sauber steht, meldete damit "8,8 cm ueber dem Boden".
    //
    // Und die Antwort ist eine ZAHL. Im Buehnenlauf vom 2. September 2026
    // hiess es fuer „schwebt 15 cm", „steckt 11 cm im Boden" und „steht"
    // gleichermassen „Bodenkontakt" — der Agent konnte nicht korrigieren.
    zeilen.push(...bodenzeile(hier));

    // Wandert ein Fuss gegenueber dem vorigen Schluesselbild, obwohl DIESER
    // FUSS in beiden Frames aufliegt? Genau das meldet validate spaeter als
    // "rutschen" — nur eben erst nach zwoelf gesetzten Haltungen.
    //
    // Gefragt wird nach dem einzelnen Fuss, nicht nach der Kontaktphase der
    // Figur. Vorher stand hier `davor.contact !== 'flug' && hier.contact !==
    // 'flug'` und danach wurden BEIDE Fuesse geprueft. Beim Gehen steht immer
    // einer — der Schwungfuss galt damit als aufliegend, und sein Schritt als
    // Rutschen. In Lauf 7 hiess das „foot_l wandert 144 cm, obwohl der Boden
    // berührt wird" fuer einen Fuss, der die ganze Spanne in der Luft war; der
    // Agent hat mehrfach nach schleifenden Fuessen gesucht, die nicht
    // schliffen. fussLiegtAuf ist dieselbe Antwort, die die Rutschpruefung in
    // physics.js benutzt.
    const vorher = gesetzteFrames(z).filter((f) => f < frame).pop();
    if (vorher !== undefined) {
      const davor = (frames || []).find((f) => f.frame === vorher);
      const profil = ports.rig.profil();
      if (davor && profil) {
        for (const fuss of ['foot_l', 'foot_r']) {
          const bone = rollen[fuss] && rollen[fuss].bone;
          if (!bone) continue;
          if (!fussLiegtAuf(profil, davor, bone) || !fussLiegtAuf(profil, hier, bone)) continue;
          const a = punkt(davor, fuss);
          const b = punkt(hier, fuss);
          if (!a || !b) continue;
          const weg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          if (weg > 0.03) {
            zeilen.push(`${fuss} liegt in Frame ${vorher} und ${frame} auf, wandert dabei aber `
              + `${zahl(weg * 100)} cm — das meldet validate als Rutschen`);
          }
        }
      }
    }

    // Steht ein Fuss auf dem Boden, aber nicht FLACH?
    //
    // Lauf 13 vom 3. September 2026: der Agent setzte auf Frame 86 (Landung)
    // einen Anker fuer beide Fuesse ueber 46 Frames. Auf Frame 86 landet die
    // Figur auf dem Ballen — richtig fuer eine Landung. Der Anker haelt aber
    // Fuss- UND Zehenknochen fest, und zwei Punkte legen auch die NEIGUNG
    // fest: die Figur richtete sich auf und stand am Ende auf Zehenspitzen,
    // Ferse 12,25 cm in der Luft. Kein Wert sagte es ihm; bodenabstand und
    // die tiefste Sohle meldeten beide 0.
    //
    // Der Befund gehoert hierher, nicht nur in describe_pose: in diesem Lauf
    // rief der Agent hold_foot 31-mal auf und describe_pose ein einziges Mal.
    for (const [fuss, seite] of [['foot_l', 'l'], ['foot_r', 'r']]) {
      const st = fussStand(hier, seite, boden, ports.rig ? ports.rig.world().height : null);
      if (!st || st.stand === 'flach' || st.stand === 'frei') continue;
      zeilen.push(`${fuss} steht im ${st.stand.toUpperCase()} — Ferse ${zahl(st.ferse)} m, `
        + `Spitze ${zahl(st.spitze)} m ueber dem Boden. Ein hold_foot auf diesem Frame haelt `
        + `genau diese Stellung ueber die ganze Spanne fest, auch wenn die Figur sich aufrichtet`);
    }

    const com = hier.com;
    if (com) zeilen.push(`Schwerpunkt ${zahl(com[1] - boden)} m über dem Boden`);

    // Gesetzt ist nicht gleich geloest: Fussanker (hold_foot) und Gelenkgrenzen
    // biegen gesetzte Winkel um. Der Agent muss den Betrag sehen — sonst baut
    // er auf einer Haltung auf, die es so nie gab. Gemessen im Lauf vom
    // 1. September 2026 (Session 5c6a601a, Frame 134): gesetzt hip_l.flex −26°
    // bei pelvis.tilt 24°, der Anker bog das Bein auf die Senkrechte zurueck;
    // measure zeigte dem Agenten 11° Beinneigung, die Rohhaltung hatte 58°.
    zeilen.push(...verbogeneWinkel(z, frame, hier));

    // Steckt ein Koerperteil im anderen? Bis zum 2. September 2026 erfuhr der
    // Agent das erst in validate — also nach einem Dutzend weiterer Haltungen.
    zeilen.push(...steckendeGliedmassen(ports.rig.profil?.() ?? null, hier));

    return zeilen.length ? `\nWirkung: ${zeilen.join('. ')}.` : '';
  } catch {
    // Der Löser kam nicht durch. Die Haltung steht trotzdem.
    return '';
  }
}

/**
 * Die Bodenzeile der Wirkung — mit Zahl, je nachdem, wer die Hoehe bestimmt hat.
 *
 * Buehnenlauf 2. September 2026, Befund A: fuer „schwebt 15 cm", „steckt
 * 11 cm im Boden" und „steht" kam dieselbe Meldung „Bodenkontakt"; der Agent
 * musste die Wurzelhoehe raten und bekam fuer zu hoch und zu tief dieselbe
 * Antwort. Seit dem Bodenstand im Loeser (src/solver/loeser.js) traegt jeder
 * Frame frame.hoehe (Quelle und Betrag) und frame.bodenabstand_m — hier
 * werden sie zu Saetzen.
 *
 * @param {object} frame geloester Frame
 * @returns {string[]} 1 bis 2 Saetze
 */
export function bodenzeile(frame) {
  const cm = (m) => (Math.abs(m) * 100).toFixed(1).replace(".", ",");   // wie im Loeserbericht
  const h = frame.hoehe ?? null;
  const abstand = typeof frame.bodenabstand_m === 'number' ? frame.bodenabstand_m : null;
  const zeilen = [];
  if (h?.quelle === 'boden') {
    const ab = h.absenkung_m ?? 0;
    zeilen.push('steht auf dem Boden'
      + (Math.abs(ab) >= 0.005
        ? ` (die Wurzel wurde dafuer um ${cm(ab)} cm ${ab > 0 ? 'abgesenkt' : 'angehoben'})`
        : ''));
    if (h.angehoben_m > 0) {
      zeilen.push(`${h.teil} stuende dabei ${cm(h.angehoben_m)} cm im Boden, deshalb wurde die ganze `
        + 'Figur angehoben — halte das freie Bein ueber dem Boden, sonst haelt kein Fussanker');
    }
  } else if (h?.quelle === 'angehoben') {
    zeilen.push(`Wurzel um ${cm(h.angehoben_m)} cm angehoben: bei root.pos y = ${zahl(h.gesetzt_m)} m `
      + `stuende ${h.teil} im Boden — fuer einen Stand lass y weg (null), der Loeser stellt die Figur ab`);
  } else if (h?.quelle === 'gesetzt' && abstand !== null) {
    if (abstand > 0.005) {
      zeilen.push(`schwebt ${cm(abstand)} cm ueber dem Boden, weil root.pos y = ${zahl(h.gesetzt_m)} m `
        + 'gesetzt ist — fuer einen Stand lass y weg (null), dann stellt der Loeser die Figur ab');
    } else {
      zeilen.push(`steht auf dem Boden (tiefster Punkt ${cm(abstand)} cm, deine Hoehe y = ${zahl(h.gesetzt_m)} m)`);
    }
  } else if (abstand !== null) {
    zeilen.push(frame.contact === 'flug'
      ? `kein Bodenkontakt: tiefster Punkt ${cm(abstand)} cm ueber dem Boden (Flugphase)`
      : `Bodenkontakt (tiefster Punkt ${cm(abstand)} cm ${abstand < 0 ? 'im' : 'ueber dem'} Boden)`);
  } else {
    zeilen.push(frame.contact === 'flug' ? 'kein Bodenkontakt (Flugphase)' : 'Bodenkontakt');
  }
  if (frame.contact === 'flug') {
    zeilen.push('im Flug prueft validate weder Balance noch Fussrutschen');
  }
  return zeilen;
}

/** Tiefster Sohlenpunkt eines Fusses ('l' | 'r') als Weltpunkt, oder null. */
function tiefsteSohle(frame, seite) {
  let best = null;
  for (const [id, p] of Object.entries(frame.solePositions ?? {})) {
    if (!id.startsWith(`sole_${seite}_`)) continue;
    if (!best || p[1] < best[1]) best = p;
  }
  return best;
}

/** Tiefster Punkt der HINTEREN (back) oder VORDEREN (front) Sohlenpunkte
 *  eines Fusses ueber dem Boden, in Metern — oder null. */
function sohlenTeil(frame, seite, teil, boden) {
  let best = null;
  for (const [id, p] of Object.entries(frame.solePositions ?? {})) {
    if (!id.startsWith(`sole_${seite}_${teil}`)) continue;
    if (best === null || p[1] < best) best = p[1];
  }
  return best === null ? null : +(best - boden).toFixed(4);
}

/** Fersen-, Spitzenhoehe und Stand EINES Fusses ('l' | 'r'), oder null. */
function fussStand(frame, seite, boden, koerperhoehe) {
  const p = tiefsteSohle(frame, seite);
  if (!p) return null;
  const ferse = sohlenTeil(frame, seite, 'back', boden);
  const spitze = sohlenTeil(frame, seite, 'front', boden);
  if (ferse === null || spitze === null) return null;
  const tol = (typeof koerperhoehe === 'number' && koerperhoehe > 0)
    ? koerperhoehe * BODEN_TOLERANZ_ANTEIL : 0.018;
  const tiefste = +(p[1] - boden).toFixed(4);
  let stand;
  if (tiefste > tol) stand = 'frei';
  else if (Math.abs(ferse - spitze) <= tol) stand = 'flach';
  else stand = ferse > spitze ? 'zehenstand' : 'fersenstand';
  return { tiefste, ferse, spitze, stand };
}

/**
 * Hoehe des tiefsten Sohlenpunkts je Fuss ueber dem Boden, in Metern —
 * und getrennt davon FERSE und SPITZE.
 *
 * Warum getrennt: der tiefste Punkt allein sagt nur, DASS der Fuss den Boden
 * beruehrt, nicht WIE. Lauf 12 vom 3. September 2026, letzter Frame der
 * Landung: `sohlen_m foot_l 0.0001` — der Agent las "steht sauber". Die Ferse
 * hing dabei 12,1 cm in der Luft, die Figur stand auf den Zehenspitzen und
 * kippte nach hinten. Keine Zahl der Antwort nannte es; im Bild war es
 * sofort zu sehen.
 *
 * Der Xbot hat vier Sohlenpunkte je Fuss (back_in, back_out, front_in,
 * front_out) — sie sind vermessen und liegen im Frame. Gemeldet wurde bisher
 * nur ihr Minimum.
 *
 * `stand` fasst es in ein Wort, gemessen an derselben Schwelle, ab der ein
 * Fuss als tragend gilt (AUFLAGE_SCHWELLE_ANTEIL, 1 % Koerperhoehe = 1,8 cm
 * am Xbot): flach, zehenstand, fersenstand oder frei.
 */
function sohlenHoehen(frame, boden, koerperhoehe) {
  const out = {};
  for (const seite of ['l', 'r']) {
    const st = fussStand(frame, seite, boden, koerperhoehe);
    if (st) { out[`foot_${seite}`] = st; continue; }
    const p = tiefsteSohle(frame, seite);
    if (p) out[`foot_${seite}`] = +(p[1] - boden).toFixed(4);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Welche Koerperteile in diesem Frame ineinander stecken, als ein Satz.
 *
 * Die Selbstdurchdringung ist in src/validate/physics.js gemessen und an vier
 * Referenzclips kalibriert — sie lief aber nur in `validate`. Der Agent setzte
 * also eine Haltung mit der Hand im Rumpf, bekam "2 Gelenke, 2 Winkel,
 * Bodenkontakt" zurueck und baute ein Dutzend Haltungen darauf. Am Xbot
 * gemessen (2. September 2026): arm_l.swing 90 mit elbow_l.bend 150 ergibt
 * torso|hand_l 22,2 cm Ueberschneidung bei 13,7 cm erlaubt — vom Werkzeug
 * unbemerkt.
 *
 * Genau wie beim Fussrutschen weiter oben wird der Befund an die Stelle
 * gezogen, an der der Agent noch handelt.
 *
 * @param {object} profile  RigProfile mit segments und restDistances
 * @param {object} frame    geloester Frame mit `positions`
 * @returns {string[]}      0 oder 1 Satz
 */
export function steckendeGliedmassen(profile, frame) {
  if (!profile || !frame || !frame.positions) return [];
  let befunde;
  try {
    befunde = pruefePhysik(profile, [frame], 30).issues
      .filter((b) => b.kind === 'durchdringung');
  } catch {
    return [];   // ohne Segmente oder Ruheabstaende ist das keine Aussage
  }
  if (befunde.length === 0) return [];

  // Der tiefste Befund zuerst: er beschreibt, was ein Mensch im Bild sieht.
  befunde.sort((a, b) => b.value - a.value);
  const cm = (m) => (m * 100).toFixed(1).replace('.', ',');
  const teile = befunde.map((b) => `${b.part.replace('|', ' und ')} ${cm(b.value)} cm`);
  return [`${befunde.length} Körperteilpaar${befunde.length === 1 ? '' : 'e'} stecken ineinander: `
    + `${teile.join('; ')} — das meldet validate später als Durchdringung`];
}

/**
 * Ab wie viel Grad Abweichung zwischen gesetztem und geloestem Winkel die
 * Rueckmeldung den Kanal nennt. Unter 2° liegt die Klemmung an Gelenkgrenzen
 * bei glatten Zahlen (describe_rig rundet auf ganze Grad); alles darueber hat
 * eine Ursache, die der Agent kennen muss.
 */
export const WINKEL_ABWEICHUNG_MELDEN_GRAD = 2;

/**
 * Welche gesetzten Winkel eines Frames der Loeser anders gefahren hat, mit
 * Betrag und Ursache. Leer, wenn alles so steht, wie es gesetzt wurde.
 *
 * Zwei Ursachen, je Abweichung getrennt benannt (Befund G8, Bühnenlauf
 * 2. September 2026, Fall 15): der Fußanker kann nur Beingelenke der
 * verankerten Seite umbiegen — halteAnker optimiert die Kette Fuß → Becken.
 * Ein Armgelenk steht nicht in dieser Kette; weicht dort ein Winkel ab, haben
 * die Gelenkgrenzen geklemmt. Vorher wurde bei aktivem Anker JEDE Abweichung
 * dem Fußanker zugeschrieben — bei `arm_l.lift 180` hieß der Lösungsweg
 * „verkürze die Ankerspanne" und führte ins Leere. Mischen sich beide
 * Ursachen in einem Frame, stehen zwei Sätze.
 *
 * @param {object} z      Sitzungszustand (overrides, anchors)
 * @param {number} frame  gesetzter Frame
 * @param {object} hier   geloester Frame mit `dofs` (gefahrene Winkel je Kanal)
 * @returns {string[]}    0 bis 2 Sätze
 */
export function verbogeneWinkel(z, frame, hier) {
  const gesetzt = z.overrides?.[String(frame)]?.joints;
  const dofs = hier?.dofs;
  if (!gesetzt || !dofs) return [];
  const anker = (z.anchors || []).filter((a) => a.von <= frame && frame <= a.bis);
  // Beinkette aus dem Gelenkkatalog: alle Gelenke, deren Kette am Fuß endet
  // (end: ende_fuss_*). Nur sie kann ein Fußanker biegen — dieselbe Quelle,
  // aus der describe_rig die Gelenknamen liefert.
  const beinGelenke = new Set(JOINT_CATALOG
    .filter((j) => j.end === 'ende_fuss_l' || j.end === 'ende_fuss_r')
    .map((j) => j.joint));
  const abweichungen = [];
  for (const [gelenk, kanaele] of Object.entries(gesetzt)) {
    for (const [kanal, soll] of Object.entries(kanaele || {})) {
      const ist = dofs[`${gelenk}.${kanal}`];
      if (!Number.isFinite(ist) || !Number.isFinite(soll)) continue;
      const diff = Math.abs(ist - soll);
      if (diff >= WINKEL_ABWEICHUNG_MELDEN_GRAD) {
        const fuss = beinGelenke.has(gelenk)
          ? (gelenk.endsWith('_l') ? 'foot_l' : 'foot_r')
          : null;
        abweichungen.push({ kanal: `${gelenk}.${kanal}`, soll, ist, diff, fuss });
      }
    }
  }
  if (abweichungen.length === 0) return [];
  abweichungen.sort((a, b) => b.diff - a.diff);

  const satz = (liste, ursache) => {
    const top = liste.slice(0, 6)
      .map((a) => `${a.kanal} ${zahl(a.soll)}° → ${zahl(a.ist)}°`).join(', ');
    const rest = liste.length > 6 ? ` und ${liste.length - 6} weitere` : '';
    return `${liste.length} gesetzte Winkel wurden anders gelöst: ${top}${rest}${ursache}`;
  };

  // Fußanker-Ursache nur für Beingelenke der verankerten Seite. Alles andere
  // — Armgelenke, Wirbelsäule, oder ein Bein ohne Anker auf dieser Seite —
  // klemmen die Gelenkgrenzen oder eine andere Korrektur.
  const vomAnker = abweichungen.filter((a) =>
    a.fuss !== null && anker.some((k) => k.foot === a.fuss));
  const saetze = [];
  if (vomAnker.length > 0) {
    const beteiligt = anker.filter((k) => vomAnker.some((a) => a.fuss === k.foot));
    saetze.push(satz(vomAnker, ` — der Fußanker (hold_foot ${beteiligt.map((k) => `${k.foot} ${k.von}–${k.bis}`).join(', ')}) `
      + 'biegt die Beinkette, damit der Fuß stehen bleibt; willst du deine Winkel, verkürze die Ankerspanne '
      + 'oder stelle die Wurzel so, dass der Fuß mit deinen Winkeln erreichbar ist'));
  }
  const vonGrenzen = abweichungen.filter((a) => !vomAnker.includes(a));
  if (vonGrenzen.length > 0) {
    saetze.push(satz(vonGrenzen, ' — Gelenkgrenzen aus describe_rig haben geklemmt'));
  }
  return saetze;
}

/**
 * Fasst gleichartige Befunde über zusammenhängende Frames zu einem zusammen.
 *
 * Gemessen am Agentenlauf vom 1. September 2026: die Bodenprüfung meldete
 *
 *     Frame 52: RightToeBase steckt 2,3 cm im Boden
 *     Frame 53: RightToeBase steckt 2,8 cm im Boden
 *     Frame 54: RightToeBase steckt 3,1 cm im Boden
 *     Frame 55: RightToeBase steckt 3,0 cm im Boden
 *
 * Das ist EIN Befund über vier Frames, nicht vier Befunde. Über den ganzen
 * Bericht ergaben sich so 43 Bodenmeldungen bei 37 betroffenen Frames — eine
 * Antwort von 33 bis 49 KB, fünfmal gerufen.
 *
 * Zusammengefasst wird nur, was dieselbe Art am selben Körperteil in
 * lückenlos aufeinanderfolgenden Frames meldet. Der größte Betrag bleibt
 * stehen, mit dem Frame, in dem er auftrat: die Zahl, nach der gehandelt wird,
 * geht nicht verloren.
 *
 * @param {object} bericht  Prüfbericht mit physics/style
 * @returns {{bericht: object, vorher: number, nachher: number}}
 */
export function fasseIssuesZusammen(bericht) {
  const aus = structuredClone(bericht);
  let vorher = 0;
  let nachher = 0;

  for (const bereich of ['physics', 'style']) {
    const liste = aus[bereich] && aus[bereich].issues;
    if (!Array.isArray(liste) || liste.length === 0) continue;
    vorher += liste.length;

    // Nach Art und Körperteil trennen, dann nach Frame sortieren.
    const gruppen = new Map();
    const einzeln = [];
    for (const i of liste) {
      if (!Number.isInteger(i.frame)) { einzeln.push(i); continue; }
      const k = `${i.kind} ${i.part ?? ''}`;
      if (!gruppen.has(k)) gruppen.set(k, []);
      gruppen.get(k).push(i);
    }

    const neu = [...einzeln];
    for (const eintraege of gruppen.values()) {
      eintraege.sort((a, b) => a.frame - b.frame);
      let lauf = [eintraege[0]];
      const schliesse = () => {
        if (lauf.length === 1) { neu.push(lauf[0]); return; }
        const groesster = lauf.reduce((m, x) =>
          (Math.abs(x.value ?? 0) > Math.abs(m.value ?? 0) ? x : m), lauf[0]);
        const von = lauf[0].frame;
        const bis = lauf[lauf.length - 1].frame;
        neu.push({
          ...groesster,
          frame: groesster.frame,
          von,
          bis,
          frames: lauf.length,
          message: `${groesster.message} — durchgehend in Frames ${von} bis ${bis} `
            + `(${lauf.length} Frames), größter Betrag bei Frame ${groesster.frame}`,
        });
      };
      for (let n = 1; n < eintraege.length; n += 1) {
        if (eintraege[n].frame === lauf[lauf.length - 1].frame + 1) lauf.push(eintraege[n]);
        else { schliesse(); lauf = [eintraege[n]]; }
      }
      schliesse();
    }

    neu.sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
    aus[bereich].issues = neu;
    nachher += neu.length;
  }

  if (vorher > nachher) {
    aus.issuesZusammengefasst = `${vorher} Einzelbefunde zu ${nachher} zusammengefasst: `
      + 'gleiche Art am selben Körperteil über aufeinanderfolgende Frames ist ein Befund.';
  }
  return { bericht: aus, vorher, nachher };
}

/** Kürzt die issue-Listen von physics und style auf `max` Einträge je Liste
 *  und zählt, wie viele dabei verworfen wurden. `text` ist die kompakte
 *  JSON-Fassung des gekappten Berichts — er wird nur einmal gebaut, damit
 *  Stufe 2 (weiter unten in berichtTextKompakt) dieselbe Zahl nutzen kann,
 *  die Stufe 3 bei einem erneut zu großen Ergebnis hätte. */
function kuerzeIssues(bericht, max) {
  const gekappt = structuredClone(bericht);
  let verworfen = 0;
  for (const bereich of ['physics', 'style']) {
    const liste = gekappt[bereich] && gekappt[bereich].issues;
    if (Array.isArray(liste) && liste.length > max) {
      verworfen += liste.length - max;
      gekappt[bereich].issues = liste.slice(0, max);
    }
  }
  gekappt.issuesVerworfen = verworfen;
  return { bericht: gekappt, text: JSON.stringify(gekappt), verworfen };
}

/** Meldung über die Kappung — die Zahl der verworfenen Issues steht in ihr,
 *  nichts verschwindet still (plan.md 5.5). */
function hinweisKuezer(kuerzung, bilderBytes) {
  const { text, verworfen } = kuerzung;
  if (verworfen === 0) {
    return `\n(Bericht ohne Einrückung: ${textBytes(text)} Byte kompakt-JSON `
      + `+ ${bilderBytes} Byte Bilder überschreiten die ${ANTWORT_MAX_BYTES}-Byte-Grenze `
      + 'der Antwort, geliefert wird kompakt — kein Inhalt fehlt)';
  }
  return `${text}\n(${verworfen} von ${verworfen + ISSUES_KAPPUNG} Issues in physics und `
    + `style verworfen: ${textBytes(text)} Byte kompakt-JSON + ${bilderBytes} Byte Bilder `
    + `überschreiten die ${ANTWORT_MAX_BYTES}-Byte-Grenze der Antwort — die ersten `
    + `${ISSUES_KAPPUNG} je Liste stehen, Frames der verworfenen stehen in den Bildern)`;
}

/**
 * Kürzt den Berichttext, wenn Text und Bilder zusammen das Antwortbudget
 * sprengen (gemessen an Xbot, siehe VALIDATE_FRAMES_MAX): zuerst ohne
 * Einrückung und mit gekappten issue-Listen, dann issue-Listen ganz ohne. Die
 * Zahl der verworfenen Meldungen steht im Bericht — nichts verschwindet still.
 */
function berichtTextKompakt(bericht, bilder) {
  const voll = JSON.stringify(bericht, null, 2);
  const bilderBytes = antwortBytes(bilder);
  if (textBytes(voll) + bilderBytes <= ANTWORT_MAX_BYTES) return voll;

  const kompakt = JSON.stringify(bericht);
  // Stufe 2 gilt nur dort, wo sie wirklich kürzt: bei einer langen issue-Liste
  // ist kompakt MIT den Issues selbst schon zu groß (gemessen: 200 Issues in
  // Stufe 1 ergeben kompakt 16 581 Byte, mit einem 517 120-Byte-Bild 533 701
  // Byte jenseits der 524 288-Grenze), und die bloße Entfernung der Einrückung
  // rettet das nie. Dann darf Stufe 2 nicht ablehnen, sondern die Kappung
  // greift — sonst verschwänden alle Issues, wo das Kürzen auf 200 gereicht
  // hätte. Gemessen, nicht geschätzt, siehe den Test "Kürzung, Positivfall".
  const gekappt = kuerzeIssues(bericht, ISSUES_KAPPUNG);
  if (textBytes(gekappt.text) + bilderBytes <= ANTWORT_MAX_BYTES) {
    return `${gekappt.text}${hinweisKuezer(gekappt, bilderBytes)}`;
  }
  if (textBytes(kompakt) + bilderBytes <= ANTWORT_MAX_BYTES) {
    return `${kompakt}\n(Bericht ohne Einrückung: ${textBytes(voll)} Byte pretty-JSON `
      + `+ ${bilderBytes} Byte Bilder überschreiten die ${ANTWORT_MAX_BYTES}-Byte-Grenze `
      + 'der Antwort, geliefert wird kompakt — kein Inhalt fehlt)';
  }

  // Auch die gekappte Fassung ist zu groß: die issue-Listen ganz weg. Die Zahl
  // der verworfenen Meldungen steht im Bericht — nichts verschwindet still.
  let verworfen = gekappt.verworfen;
  const text = gekappt.text;
  const hinweisKappung = hinweisKuezer(gekappt, bilderBytes);
  if (textBytes(text + hinweisKappung) + bilderBytes > ANTWORT_MAX_BYTES) {
    // Extremfall: auch die gekappte Fassung passt nicht. Das Bild bleibt — die
    // Regel "kein Bericht ohne Bild" (plan.md 5.3) wiegt schwerer als die
    // issue-Listen, die der Agent über look je Frame nachfragen kann.
    // gekappt.bericht ist der gekappte Bericht; gekappt selbst ist der Bote
    // { bericht, text, verworfen } — der wurde hier verschachtelt serialisiert,
    // sodass die issue-Listen drinblieben und der Text 36 412 statt 324 Byte
    // maß (gemessen, Test "Kürzung, Positivfall").
    const gekappt2 = structuredClone(gekappt);
    let ganzWeg = verworfen;
    for (const bereich of ['physics', 'style']) {
      const liste = gekappt2[bereich] && gekappt2[bereich].issues;
      if (Array.isArray(liste) && liste.length > 0) {
        ganzWeg += liste.length;
        gekappt2[bereich].issues = [];
      }
    }
    gekappt2.issuesVerworfen = ganzWeg;
    const ohne = JSON.stringify(gekappt2);
    const hinweisOhne = `\n(${ganzWeg} Issues komplett verworfen: `
      + `${textBytes(voll)} Byte pretty-JSON + ${bilderBytes} Byte Bilder überschreiten `
      + `die ${ANTWORT_MAX_BYTES}-Byte-Grenze der Antwort — rufe look mit den Frames `
      + 'der kritischen Stellen auf, um je Frame nachzufragen';
    if (textBytes(ohne + hinweisOhne) + bilderBytes > ANTWORT_MAX_BYTES) {
      throw new WerkzeugMeldung({
        tool: 'validate', param: 'Antwortgröße', value: textBytes(ohne + hinweisOhne) + bilderBytes,
        range: `höchstens ${ANTWORT_MAX_BYTES} Byte`,
        next: 'kürze die Timeline vorher mit set_duration',
        message: `Antwort von validate ist ${textBytes(ohne + hinweisOhne) + bilderBytes} Byte `
          + `groß, erlaubt sind ${ANTWORT_MAX_BYTES}; selbst ohne issue-Listen — `
          + 'kürze die Timeline vorher mit set_duration'
      });
    }
    return `${ohne}${hinweisOhne})`;
  }
  return `${text}${hinweisKappung}`;
}

/** Testanschluss: dieselbe Funktion, exportiert unter Testnamen. Verhält sich
 *  exakt wie der interne Aufruf in validate. */
export function berichtTextKompaktFuerTest(bericht, bilder) {
  return berichtTextKompakt(bericht, bilder);
}
