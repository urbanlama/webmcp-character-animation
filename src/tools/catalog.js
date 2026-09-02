// Der Werkzeugkatalog: sechzehn Werkzeuge, docs/plan.md 5.4 und 5.5.
//
// Der Beschreibungstext ist die Kopiervorlage aus src/ui/WERKZEUGE.md, Wort
// fuer Wort. Er ist das Handbuch fuer den Agenten, der die fertige Seite
// bedient — jede Beschreibung nennt das Bezugssystem und die Einheiten ihrer
// Parameter (AGENTS.md, Handwerkliches).
//
// Diese Datei enthaelt keine Logik, nur Namen, Beschreibungen und Schemata.
// Die Ausfuehrung steht in handlers.js. Wer den Katalog aendert, meldet es
// vorher im BRETT.md — er gehoert der Leitung.

/** Die zehn Phasenverben, plan.md 6.3. Feste Liste, keine offene Sprache. */
export const VERBEN = [
  'stand', 'crouch', 'swing_arms', 'takeoff', 'airborne',
  'land', 'step', 'reach', 'turn', 'settle'
];

/** Die sieben Absichts-Bausteine, plan.md 6.6. Bezeichner von AP7 vergeben,
 *  gemeldet im BRETT.md — AP6 prueft gegen dieselben Namen. */
export const INTENT_ARTEN = [
  'rotation',        // Drehung um eine Achse ueber einen Frame-Bereich, Grad
  'airtime',         // Flugphase: Sekunden, Scheitelhoehe in Koerperhoehen
  'travel',          // Ortsveraenderung: Koerperhoehen, Richtung
  'contact_change',  // Kontaktwechsel: welcher Fuss, welcher Frame
  'clearance',       // Abstand zweier Koerperteile: Anteil Koerperhoehe, Mindestdauer
  'part_height',     // Hoehe eines Koerperteils: Anteil der Koerperhoehe
  'part_speed'       // Tempo eines Koerperteils: Koerperhoehen pro Sekunde
];

/** Ansichten des Bildstreifens, plan.md 5.5 Werkzeug 14 und AP9. Der Streifen
 *  bleibt fuer `validate`; `look` richtet seine Kamera ueber Gradzahlen. */
export const ANSICHTEN = ['front', 'side', 'quarter', 'top'];

/**
 * Kameraangaben des Werkzeugs `look`. Dieselben Werte stehen in
 * src/render/strip.js (WEITE_ANTEILE, RICHTUNG_STANDARD_GRAD,
 * HOEHE_STANDARD_GRAD) — dort mit ihrer Begruendung; hier stehen sie, weil der
 * Katalog keine Renderer-Abhaengigkeit hat (so wie ANSICHTEN oben).
 *
 * Die Weiten sind Anteile der GEMESSENEN Koerperhoehe, keine Zoomzahlen: der
 * Agent soll waehlen, nicht rechnen.
 */
export const WEITEN = ['ganz', 'halb', 'nah'];
export const RICHTUNG_STANDARD_GRAD = 30;
export const HOEHE_STANDARD_GRAD = 10;

/**
 * Kanaele eines Gelenkwinkels — allgemeine Liste, plan.md 5.5 Werkzeug 11.
 *
 * Gilt nur, solange kein Modell vermessen ist. Sobald eines geladen ist,
 * kommen die Kanalnamen je Gelenk aus der Vermessung (describe_rig): am Xbot
 * etwa shrug/fwd an der Schulter, lift/swing/twist am Arm, flex/spread/twist
 * an der Huefte. Siehe pruefeGelenkKanal in handlers.js.
 */
export const KANAELE = ['bend', 'twist', 'swing'];

/**
 * Uebergangsform von einem gesetzten Frame zum naechsten (set_pose).
 *
 * `smooth` ist der Standard, weil rein lineare Uebergaenge zwischen zwei
 * Haltungen nach Maschine aussehen: die Bewegung startet und stoppt abrupt.
 * `linear` bleibt waehlbar, wo genau das gewollt ist — gleichfoermige
 * Drehungen, technische Bewegungen. `hold` haelt die Haltung bis zum
 * naechsten gesetzten Frame und springt dann, fuer harte Schnitte.
 */
export const EASE_ARTEN = ['smooth', 'linear', 'hold', 'wurf'];
export const EASE_STANDARD = 'smooth';

/** Grenzen der Timeline-Laenge, plan.md 5.5 Werkzeug 7. */
export const FRAME_MIN = 12;
export const FRAME_MAX = 600;

/**
 * BENANNTER VERFAHRENSPARAMETER: wie viele Kacheln ein Bildstreifen hoechstens
 * traegt — Frames MAL Ansichten, nicht Frames allein.
 *
 * Galt bis zum 2.9.2026 fuer `look`. Seit dem Umbau auf das Einzelbild liefert
 * `look` genau EIN Bild je Aufruf und braucht diese Schranke nicht mehr; sie
 * gilt weiter fuer den Streifen, den `validate` seinem Bericht anhaengt.
 *
 * Gemessen an den Antworten des Agentenlaufs vom 1. September 2026:
 *
 *     6 Frames × 1 Ansicht  = 6 Kacheln  → 164 KB
 *     2 Frames × 2 Ansichten = 4 Kacheln → 183 KB
 *     10 Frames × 2 Ansichten = 20 Kacheln → 654 KB, abgewiesen
 *
 * Rund 33 KB je Kachel im dichtesten Fall. 12 Kacheln sind damit rund 400 KB
 * und liegen mit dem Antworttext unter der 512-KB-Grenze. Das alte Schema
 * erlaubte 12 Frames × 4 Ansichten = 48 Kacheln — ein Versprechen, das die
 * Antwortgrenze nie einhalten konnte.
 *
 * Wird der Wert angepasst, erneut an einem echten Lauf messen.
 */
export const KACHELN_MAX = 12;

/**
 * BENANNTER VERFAHRENSPARAMETER: wie viele Frames ein measure-Aufruf auf
 * einmal misst.
 *
 * Der Loeser laeuft je Aufruf genau einmal, egal wie viele Frames gefragt
 * sind — die Kosten steigen also nur mit der Auswertung, nicht mit dem Loesen.
 * 20 deckt einen Bewegungsabschnitt Frame fuer Frame ab und haelt die Antwort
 * unter der 512-KB-Grenze, auch bei 20 Fragen je Frame.
 */
export const MESS_FRAMES_MAX = 20;

/** Gemessene Groesse einer Kachel, fuer die Fehlermeldung. */
export const KACHEL_KB = 33;

const leer = { type: 'object', properties: {}, required: [] };

/**
 * Die sechzehn Katalogeintraege in der Reihenfolge aus plan.md 5.4.
 * Der Aufruf-Rumpf kommt in handlers.js dazu.
 */
export const KATALOG = [
  {
    name: 'describe_world',
    description: 'SCHRITT 1 - hier anfangen. Sagt, wie die Welt liegt: welche Achse oben ist, wo vorne ist, '
      + 'auf welcher Hoehe der Boden liegt, wie gross die Figur ist. Enthaelt ausserdem eine '
      + 'Kurzanleitung, wie in dieser Seite gearbeitet wird. Braucht ein geladenes Modell.',
    inputSchema: leer
  },
  {
    name: 'describe_rig',
    description: 'SCHRITT 2 - die Gelenkliste. Nennt jedes vermessene Gelenk mit seinen Kanaelen, deren '
      + 'Grenzwerten in Grad und der Richtung, in die ein positiver Wert wirkt. DIE KANALNAMEN SIND '
      + 'JE GELENK VERSCHIEDEN und kommen aus der Vermessung: die Schulter hat andere als das Knie. '
      + 'Ohne diesen Aufruf sind set_pose und set_joint Raten. Nennt ausserdem die Rollen (foot_l, '
      + 'hand_r, ...) mit ihrem Knochen und der Konfidenz.',
    inputSchema: {
      type: 'object',
      properties: {
        detail: {
          type: 'boolean',
          description: 'true liefert zusaetzlich Achsen, Vorzeichenquellen und Messbelege; '
            + 'die Antwort wird dann sehr gross. Ohne Angabe die Kompaktfassung.'
        }
      }
    }
  },
  {
    name: 'describe_body',
    description: 'Das gemessene Koerperprofil: Segmente mit Radius in Metern und Masse in Kilogramm, '
      + 'Fusssohlenpunkte, Ruheabstaende zwischen Koerperteilen. Fuer Reichweiten und '
      + 'Standflaechen. Zum blossen Setzen von Haltungen nicht noetig.',
    inputSchema: leer
  },
  {
    name: 'probe_joint',
    description: 'Probiert einen einzelnen Gelenkkanal aus: beugt ihn um den angegebenen Winkel und liefert '
      + 'Vorher und Nachher als Bild. Zum Nachsehen, in welche Richtung ein Kanal wirkt, wenn die '
      + 'Angabe aus describe_rig nicht reicht. Ohne channel wird der erste gemessene Kanal des '
      + 'Gelenks genommen; die Antwort sagt, welcher es war und welche es sonst noch gibt. Aendert '
      + 'die Timeline nicht.',
    inputSchema: {
      type: 'object',
      properties: {
        joint: { type: 'string', description: 'Gelenkname aus describe_rig, z. B. hip_l' },
        angleDeg: { type: 'number', minimum: -90, maximum: 90, description: 'Winkel in Grad, -90 bis 90' },
        channel: {
          type: 'string',
          description: 'optional: Kanalname dieses Gelenks aus describe_rig, z. B. flex. '
            + 'Die Namen sind je Gelenk verschieden - hip_l hat flex, arm_l hat lift. '
            + 'Fehlt die Angabe, wird der erste gemessene Kanal genommen'
        }
      },
      required: ['joint', 'angleDeg']
    }
  },
  {
    name: 'confirm_role',
    // In der Kiste, seit die Rollen-Rueckfrageoberflaeche abgeschaltet ist
    // (Commit de77965). Gemessen am Xbot: alle drei Pflichtrollen (pelvis,
    // foot_l, foot_r) haben Konfidenz 1 — es gibt nichts zu bestaetigen. Ein
    // sichtbares Werkzeug ohne Anlass kostete im Agentenlauf echte Aufrufe:
    // der Agent las den Hinweis in describe_rig als Pflicht und machte sich
    // daran, Zuordnungen zu bestaetigen, statt die Bewegung zu bauen.
    //
    // Der Rumpf bleibt (handlers.js) und ist ueber rufe() erreichbar. Duerfen
    // spaeter beliebige Modelle hochgeladen werden, kann eine Rolle unsicher
    // sein — dann gehoert das Werkzeug wieder in den sichtbaren Katalog, und
    // describe_rig nennt es wieder. Der Test dazu steht in
    // src/tools/rollensicherheit.test.mjs.
    kiste: true,
    description: 'Bestaetigt oder korrigiert, welcher Knochen eine Rolle traegt (foot_l, hand_r, ...). '
      + 'Noetig, wenn describe_rig eine Rolle mit Konfidenz unter 1 meldet. Danach gilt die '
      + 'Zuordnung als gemessen.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'semantische Rolle, z. B. foot_l' },
        bone: { type: 'string', description: 'Knochenname aus describe_rig' }
      },
      required: ['role', 'bone']
    }
  },
  {
    name: 'set_intent',
    description: 'Legt fest, woran die fertige Bewegung gemessen wird - was am Ende zutreffen muss. Wird '
      + 'sofort uebernommen, ohne Rueckfrage. Jedes Kriterium '
      + 'braucht seine Pflichtfelder: rotation {part, axis, minDeg oder maxDeg}, airtime {minSek '
      + 'oder maxSek}, travel {part, richtung, minHoehe oder maxHoehe}, contact_change {foot, von, '
      + 'bis}, clearance {partA, partB, minAnteil oder maxAnteil}, part_height {part, minAnteil '
      + 'oder maxAnteil}, part_speed {part, minHoeheProSek oder maxHoeheProSek}. WICHTIG: part ist '
      + 'ein KNOCHENNAME aus describe_rig, keine Rolle. Laengen in Anteilen der Koerperhoehe, '
      + 'Winkel in Grad, Zeiten in Sekunden.',
    inputSchema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          description: `Kriterien, je eines der ${INTENT_ARTEN.length} Arten: ${INTENT_ARTEN.join(', ')}`,
                    items: {
            type: 'object',
            description: 'Ein Kriterium. Welche Felder es braucht, haengt von kind ab — '
              + 'die Pflichtfelder stehen bei jedem Feld unten und in der Werkzeugbeschreibung.',
            properties: {
              kind: { type: 'string', enum: INTENT_ARTEN },
              part: {
                type: 'string',
                description: 'KNOCHENNAME aus describe_rig, keine Rolle. '
                  + 'Pflicht bei rotation, travel, part_height, part_speed.'
              },
              axis: {
                type: 'string', enum: ['x', 'y', 'z'],
                description: 'Drehachse. Pflicht bei rotation.'
              },
              minDeg: { type: 'number', description: 'Untergrenze in Grad. rotation: minDeg oder maxDeg.' },
              maxDeg: { type: 'number', description: 'Obergrenze in Grad. rotation: minDeg oder maxDeg.' },
              minSek: { type: 'number', description: 'Untergrenze in Sekunden. airtime: minSek oder maxSek.' },
              maxSek: { type: 'number', description: 'Obergrenze in Sekunden. airtime: minSek oder maxSek.' },
              richtung: {
                type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                description: 'Richtungsvektor [x, y, z], KEIN Wort wie "hoch". Pflicht bei travel.'
              },
              minHoehe: { type: 'number', description: 'Untergrenze in Koerperhoehen. travel: minHoehe oder maxHoehe.' },
              maxHoehe: { type: 'number', description: 'Obergrenze in Koerperhoehen. travel: minHoehe oder maxHoehe.' },
              foot: { type: 'string', description: 'Fussrolle, z. B. foot_l. Pflicht bei contact_change.' },
              von: { type: 'integer', description: 'Startframe. Pflicht bei contact_change.' },
              bis: { type: 'integer', description: 'Endframe. Pflicht bei contact_change.' },
              partA: { type: 'string', description: 'erstes Segment. Pflicht bei clearance.' },
              partB: { type: 'string', description: 'zweites Segment. Pflicht bei clearance.' },
              minAnteil: { type: 'number', description: 'Untergrenze als Anteil der Koerperhoehe.' },
              maxAnteil: { type: 'number', description: 'Obergrenze als Anteil der Koerperhoehe.' },
              minHoeheProSek: { type: 'number', description: 'Untergrenze in Koerperhoehen je Sekunde.' },
              maxHoeheProSek: { type: 'number', description: 'Obergrenze in Koerperhoehen je Sekunde.' },
              from: { type: 'integer', description: 'Startframe des Messfensters, optional.' },
              to: { type: 'integer', description: 'Endframe des Messfensters, optional.' }
            },
            required: ['kind']
          }
        }
      },
      required: ['checks']
    }
  },
  {
    name: 'set_duration',
    description: 'SCHRITT 3 - legt fest, wie lang die Bewegung ist, in Frames. Muss vor jedem Setzen von '
      + 'Haltungen oder Phasen kommen; ohne Laenge weisen die anderen Werkzeuge ab. Die Framerate '
      + 'steht in der Antwort. Ändert NICHTS an bestehenden Haltungen — für einen sauberen Neuanfang '
      + 'vor der nächsten Bewegung gibt es clear_motion.',
    inputSchema: {
      type: 'object',
      properties: {
        frameCount: {
          type: 'integer', minimum: FRAME_MIN, maximum: FRAME_MAX,
          description: `Anzahl Frames, ${FRAME_MIN} bis ${FRAME_MAX}`
        }
      },
      required: ['frameCount']
    }
  },
  {
    name: 'clear_motion',
    description: 'Löscht die gesamte Bewegung und macht die Timeline leer: alle gesetzten Haltungen '
      + '(set_pose, set_joint), alle Phasen, alle Fußanker (hold_foot) und die gesetzte Absicht '
      + '(set_intent). Modell, Vermessung und Rollen bleiben — die Länge der Timeline (set_duration) '
      + 'bleibt auch. Für eine NEUE Bewegung: erst clear_motion, dann Haltungen setzen. Ohne ihn '
      + 'erbst du alle Schlüsselbilder der vorigen Bewegung, auch auf Frames, die du nie anfasst.',
    inputSchema: leer
  },
  {
    name: 'add_phase',
    kiste: true,
    description: 'EBENE 3 - eine fertige Bewegung ueber einen Zeitabschnitt, statt eigener Haltungen. Der '
      + 'Loeser rechnet die Posen selbst. Nur nehmen, wenn eine dieser zehn Bewegungen genau passt; '
      + 'alles andere baut man mit set_pose. Parameter je Verb: stand {verteilung 0..1, atmen}, '
      + 'crouch {tiefe: Anteil der Koerperhoehe}, takeoff {vy: Koerperhoehen pro Sekunde, spinGrad, '
      + 'spinAchse: x, y oder z}, airborne {vy, spinGrad, tuck}, land {fuss, abfedern: Anteil}, '
      + 'step {weite: Anteil der Koerperhoehe, richtung: Grad, fuss}, turn {winkel: Grad}, settle '
      + '{ausschlag}, reach {ziel: [x, y, z] in Metern, hand}, swing_arms {richtung, ausschlag, '
      + 'wiederholungen}. Phasen duerfen sich zeitlich nur ueberlappen, wenn sie verschiedene '
      + 'Koerperteile betreffen.',
    inputSchema: {
      type: 'object',
      properties: {
        verb: { type: 'string', enum: VERBEN, description: `eines der ${VERBEN.length} Phasenverben` },
        from: { type: 'integer', minimum: 0, description: 'Startframe, ganzzahlig' },
        to: { type: 'integer', minimum: 1, description: 'Endframe, größer als from' },
        params: { type: 'object', description: 'Parameter des Verbs, Einheiten wie oben' }
      },
      required: ['verb', 'from', 'to', 'params']
    }
  },
  {
    name: 'edit_phase',
    kiste: true,
    description: 'Aendert eine mit add_phase angelegte Phase oder entfernt sie. Die Id steht in der Antwort '
      + 'von add_phase. Gilt nur fuer Phasen, nicht fuer gesetzte Haltungen.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Phasen-Id aus add_phase, z. B. p1' },
        from: { type: 'integer', minimum: 0 },
        to: { type: 'integer', minimum: 1 },
        params: { type: 'object' },
        remove: { type: 'boolean', description: 'true entfernt die Phase' }
      },
      required: ['id']
    }
  },
  {
    name: 'set_target',
    kiste: true,
    description: 'EBENE 2 - sagt, WO ein Koerperteil in einem Frame sein soll, statt welche Winkel es hat. '
      + 'Angabe in Metern im Weltsystem aus describe_world. ACHTUNG: Der Loeser setzt solche Ziele '
      + 'derzeit nur innerhalb der Verben reach und step um; ohne passende Phase bleibt der Frame '
      + 'unveraendert und der Bericht sagt es. Fuer verlaessliche Ergebnisse set_pose nehmen.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0, description: 'Frame, ganzzahlig im Timeline-Bereich' },
        part: { type: 'string', description: 'Endeffektor-Rolle aus describe_rig oder "com" für den Schwerpunkt' },
        pos: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: 'Zielpunkt [x, y, z] in Metern, Weltkoordinaten'
        }
      },
      required: ['frame', 'part', 'pos']
    }
  },
  {
    name: 'set_joint',
    description: 'EBENE 1, Feinschliff - setzt EINEN Kanal EINES Gelenks in einem Frame. Fuer '
      + 'Nachbesserungen an einer Haltung, die schon steht. Eine ganze Haltung setzt man mit '
      + 'set_pose, nicht mit vielen Aufrufen hiervon. Gelenk- und Kanalnamen kommen aus '
      + 'describe_rig; Werte ausserhalb der gemessenen Gelenkgrenze werden beim Loesen geklemmt und '
      + 'gemeldet.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0 },
        joint: { type: 'string', description: 'Gelenkname aus describe_rig' },
        angleDeg: { type: 'number', minimum: -180, maximum: 180, description: 'Winkel in Grad' },
        channel: {
          type: 'string',
          // Kein festes enum: die Kanaele sind je Gelenk verschieden und kommen
          // aus der Vermessung (shoulder_l: shrug/fwd, arm_l: lift/swing/twist,
          // hip_l: flex/spread/twist, ankle_l: point/tilt, knee_l: bend). Eine
          // feste Liste machte am Xbot 15 von 18 Gelenken unerreichbar.
          description: 'Kanalname des Gelenks, z. B. bend, lift, flex, shrug — '
            + 'welche es an welchem Gelenk gibt, sagt describe_rig'
        }
      },
      required: ['frame', 'joint', 'angleDeg', 'channel']
    }
  },
  {
    name: 'set_pose',
    description: 'EBENE 1, DER HAUPTWEG - setzt eine ganze Koerperhaltung auf einen Frame: alle Gelenke in '
      + 'einem Aufruf, so wie ein Animator ein Schluesselbild setzt. So arbeitet man hier: mehrere '
      + 'Haltungen auf verschiedene Frames setzen; dazwischen wird beim Loesen ueberblendet, weich '
      + 'oder linear (ease). BODEN: die Figur steht immer auf dem Boden, solange du keine Hoehe '
      + 'setzt - der Loeser senkt die Wurzel je Frame so ab, dass der tiefste Punkt auf der '
      + 'Bodenebene liegt (Hocke, Stand, Schritt brauchen kein root). Eine Zahl in root.pos[1] '
      + 'hebt sie an (Sprung, Flug); unter den Boden geht es nie, zu tief Gesetztes wird angehoben '
      + 'und gemeldet. Die Antwort sagt dir mit Zahl, ob sie steht, schwebt oder angehoben wurde. '
      + 'Danach mit look ansehen und mit describe_pose nachmessen. Die '
      + 'angegebenen Gelenke ERSETZEN die Haltung dieses Frames. Gelenk- und Kanalnamen kommen aus '
      + 'describe_rig und sind je Gelenk verschieden.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0, description: 'Frame, auf dem die Haltung sitzt' },
        joints: {
          type: 'object',
          description: 'Gelenkname auf Kanal auf Grad, z. B. '
            + '{"arm_l": {"lift": 70, "swing": 10}, "elbow_l": {"bend": 80}} — '
            + 'welche Gelenke und Kanäle es gibt, sagt describe_rig'
        },
        root: {
          type: 'object',
          description: 'WO die Figur steht und wohin sie schaut. Ohne root bleibt sie an ihrem Ort '
            + 'und steht auf dem Boden. '
            + '{pos: [x, y, z]} in Metern im Weltsystem aus describe_world; y = null heisst '
            + '"auf dem Boden" (der Loeser rechnet die Hoehe), eine Zahl in y ist eine feste Hoehe. '
            + '{turnGrad: Zahl} dreht die ganze Figur um die Hochachse. '
            + 'Ein Schritt: pos [x, null, z] wandert entlang der Blickrichtung, die Hoehe bleibt am Boden. '
            + 'Ein Sprung: Absprung- und Landeframe OHNE Hoehe (sie stehen), der Scheitel mit '
            + 'einer Zahl in y und ease "wurf" - die Parabel laeuft dann vom Boden zum Scheitel und zurueck. '
            + 'Zwischen gesetzten Frames wird die Wurzel wie alles andere ueberblendet.',
          properties: {
            pos: {
              type: 'array', items: { type: ['number', 'null'] }, minItems: 3, maxItems: 3,
              description: 'Position des Beckens [x, y, z] in Metern; y = null stellt die Figur auf den Boden'
            },
            turnGrad: {
              type: 'number',
              description: 'Kurzform fuer drehGrad.y — Drehung um die Hochachse in Grad'
            },
            drehGrad: {
              type: 'object',
              description: 'Drehung der ganzen Figur in Grad, je Achse. '
                + 'x = Salto vorwaerts/rueckwaerts (Nicken), '
                + 'y = Drehung im Stand (Gieren), '
                + 'z = seitliches Kippen (Rollen). '
                + 'Ein Rueckwaertssalto ist x von 0 auf -360 ueber die Flugphase; '
                + 'eine halbe Drehung im Stand ist y von 0 auf 180. '
                + 'Wird zwischen Schluesselbildern ueberblendet, Achse fuer Achse — '
                + 'volle Umdrehungen bleiben dabei volle Umdrehungen.',
              properties: {
                x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }
              }
            }
          }
        },
        ease: {
          type: 'string',
          enum: EASE_ARTEN,
          description: `Übergang zum nächsten gesetzten Frame. `
            + `"wurf" ist der freie Fall: die Höhe folgt exakt der Wurfparabel. `
            + `Nimm ihn für die Flugphase — dann genügen zwei Schlüsselbilder für den `
            + `ganzen Flug, und die Ballistikprüfung ist still. Sonst einer von `
            + `${EASE_ARTEN.length}: ${EASE_ARTEN.join(', ')}; ohne Angabe ${EASE_STANDARD}`
        }
      },
      required: ['frame', 'joints']
    }
  },
  {
    name: 'measure',
    description: 'DEIN MESSGERAET - du richtest es selbst aus. Statt fertiger Urteile bekommst '
      + 'du sieben Grundmessungen, die du beliebig kombinierst, um zu pruefen, ob eine Haltung '
      + 'stimmt. Beispiel Hocke: steht das Knie vor dem Zeh (abstand_vorne knee_l/toe_l), '
      + 'neigt sich der Rumpf nach vorne (neigung pelvis/neck), sitzt die Huefte hinter dem '
      + 'Knoechel (abstand_vorne pelvis/ankle_l)? Beispiel Schritt: wandert der Fuss (tempo), '
      + 'bleibt der andere stehen? Jede Bewegung braucht andere Fragen - stell sie. '
      + 'Koerperteile sind Rollennamen aus describe_rig, dazu "com" fuer den Schwerpunkt und '
      + '"sole_l" / "sole_r" fuer den tiefsten Sohlenpunkt je Fuss - damit misst du, ob ein Fuss '
      + 'auf dem Boden steht (hoehe sole_l = 0). Der Fussknochen selbst sitzt Zentimeter ueber der Sohle. '
      + 'Alle Laengen in Metern, Winkel in Grad.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0, description: 'Frame, in dem gemessen wird. Fuer mehrere Frames nimm frames.' },
        frames: {
          type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1,
          maxItems: MESS_FRAMES_MAX,
          description: `Mehrere Frames auf einmal, 1 bis ${MESS_FRAMES_MAX}. Dieselben Fragen `
            + 'werden auf jeden davon angewendet - so bekommst du einen Verlauf in EINEM Aufruf '
            + 'statt einem Aufruf je Frame. Ersetzt frame.'
        },
        fragen: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          description: 'Was du wissen willst. Je Frage {art, a, ...}: '
            + 'hoehe {a} - Hoehe ueber dem Boden. '
            + 'abstand {a, b} - Luftlinie zwischen zwei Teilen. '
            + 'abstand_vorne {a, b} - wie weit a vor b liegt, entlang der Blickrichtung; '
            + 'negativ heisst dahinter. '
            + 'abstand_seite {a, b} - wie weit a neben b liegt. '
            + 'abstand_hoch {a, b} - wie weit a ueber b liegt. '
            + 'winkel {a, b, c} - Winkel bei b zwischen den Strecken zu a und c. '
            + 'neigung {a, b} - wie weit die Strecke a nach b von der Senkrechten abweicht; '
            + '0 heisst lotrecht, 90 heisst waagerecht. '
            + 'tempo {a, bisFrame} - Weg pro Sekunde zwischen diesem und jenem Frame. '
            + 'Optional name: dein eigener Name fuer die Messung.',
          items: {
            type: 'object',
            properties: {
              art: {
                type: 'string',
                enum: ['hoehe', 'abstand', 'abstand_vorne', 'abstand_seite', 'abstand_hoch',
                  'winkel', 'neigung', 'tempo'],
              },
              a: { type: 'string', description: 'Koerperteil, Rollenname oder "com"' },
              b: { type: 'string', description: 'zweites Koerperteil, wo die Art es braucht' },
              c: { type: 'string', description: 'drittes Koerperteil, nur bei winkel' },
              bisFrame: { type: 'integer', description: 'Zielframe, nur bei tempo' },
              name: { type: 'string', description: 'eigener Name der Messung' },
            },
            required: ['art', 'a'],
          },
        },
      },
      required: ['fragen'],
    }
  },
  {
    name: 'list_poses',
    description: 'Zeigt alle gesetzten Haltungen mit ihrem Frame, der Zahl der Gelenke und ob '
      + 'eine Wurzelbewegung dabei ist. Der Ueberblick ueber die eigene Arbeit: ohne ihn weisst '
      + 'du nicht, was du schon gesetzt hast, und kannst nichts umsortieren.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'move_pose',
    description: 'Verschiebt eine gesetzte Haltung auf einen anderen Frame — der Schritt, mit '
      + 'dem du den zeitlichen Ablauf zurechtrueckst, nachdem die Haltungen stehen. Kommt eine '
      + 'Bewegung zu frueh, ruecke sie nach hinten, statt sie neu zu bauen. Auf dem Zielframe '
      + 'darf noch keine Haltung liegen.',
    inputSchema: {
      type: 'object',
      properties: {
        von: { type: 'integer', minimum: 0, description: 'Frame, auf dem die Haltung jetzt liegt' },
        nach: { type: 'integer', minimum: 0, description: 'Frame, auf den sie soll' }
      },
      required: ['von', 'nach']
    }
  },
  {
    name: 'delete_pose',
    description: 'Loescht eine gesetzte Haltung. Danach wird an dieser Stelle zwischen den '
      + 'benachbarten Haltungen durchgeblendet, als haette es sie nie gegeben. Fuer Haltungen, '
      + 'die sich als falsch erwiesen haben — undo nimmt nur den letzten Schritt zurueck.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0, description: 'Frame, dessen Haltung weg soll' }
      },
      required: ['frame']
    }
  },
  {
    name: 'describe_pose',
    description: 'Sagt in Zahlen, wie die Figur in einem Frame steht: Weltpositionen der Koerperteile in '
      + 'Metern, Schwerpunkt, Bodenkontakt, bodenabstand_m (tiefster Punkt ueber dem Boden, 0 = steht, '
      + 'negativ = im Boden), wurzelhoehe (ob Boden, dein root.pos oder eine Anhebung die Hoehe bestimmt '
      + 'hat, mit Betrag), sohlen_m je Fuss, und ob der Frame eine gesetzte '
      + 'Haltung ist oder eine Ueberblendung. Dazu winkel_grad — die gefahrenen Gelenkwinkel je '
      + 'Gelenk und Kanal in Grad, auch auf ueberblendeten Frames — und gesetzteWinkel_grad, nur '
      + 'die, die auf diesem Frame gesetzt wurden. Damit liest du deine Haltung in deiner eigenen '
      + 'Sprache zurueck. Das Gegenstueck zu look: dort das Bild, hier die Zahlen.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0, description: 'Frame, dessen Haltung gefragt ist' }
      },
      required: ['frame']
    }
  },
  {
    name: 'undo',
    description: 'Nimmt die letzte Aenderung zurueck, egal von welchem Werkzeug. Eine einzelne Haltung '
      + 'loescht du mit delete_pose, verschiebst sie mit move_pose und ueberschreibst sie, indem du '
      + 'set_pose erneut auf denselben Frame aufrufst - dafuer brauchst du undo nicht.',
    inputSchema: leer
  },
  {
    name: 'validate',
    description: 'Prueft die gesamte Bewegung und meldet, was nicht stimmt: Bodendurchdringung, '
      + 'Selbstdurchdringung, verletzte Gelenkgrenzen, rutschende Fuesse, Gleichgewicht, Flugbahn - '
      + 'jeweils mit Frame und Betrag in Metern oder Grad. Dazu die mit set_intent gesetzten '
      + 'Kriterien. Liefert immer einen Bildstreifen mit. Braucht gesetzte Kriterien.',
    inputSchema: leer
  },
    {
    name: 'trace',
    description: 'Zeigt den VERLAUF der ganzen Bewegung in EINEM Bild: die Bahnen von Haenden, '
      + 'Fuessen und Becken ueber alle Frames, dazu die Figur an einem Frame deiner Wahl. '
      + 'Die Bahn zeigt die Form der Bewegung, der Abstand der Punkte das Timing - eng ist '
      + 'langsam, weit ist schnell, ein Knaeuel ist Stillstand. Ein Knick in der Bahn ist ein '
      + 'Richtungswechsel. Damit siehst du, ob eine Bewegung flieszt, ohne Frame fuer Frame '
      + 'durchzugehen. Kamera wie bei look. RUFE DAS AUF, BEVOR DU EINE BEWEGUNG ABGIBST: '
      + 'ein einzelner Frame sagt nichts darueber, wie die Bewegung laeuft.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: {
          type: 'integer', minimum: 0,
          description: 'Welcher Frame als Figur im Bild steht. Die Bahnen laufen immer ueber '
            + 'die GANZE Timeline, unabhaengig davon. Ohne Angabe die Mitte.'
        },
        richtung_grad: {
          type: 'number', minimum: 0, maximum: 359,
          description: `Woher die Kamera blickt: 0 von vorn, 90 von links, 180 von hinten, `
            + `270 von rechts. Standard ${RICHTUNG_STANDARD_GRAD}. Eine Bahn, die auf die `
            + `Kamera zulaeuft, ist verkuerzt - dann von der Seite schauen.`
        },
        hoehe_grad: {
          type: 'number', minimum: -89, maximum: 90,
          description: `Wie hoch die Kamera steht: 0 auf Augenhoehe, 90 von oben. `
            + `Standard ${HOEHE_STANDARD_GRAD}. Fuer Schritte und Fussbahnen ist 90 gut.`
        }
      }
    }
  },
{
    name: 'look',
    description: 'Fotografiert EINEN Frame und liefert EIN grosses Bild, annotiert mit Bodengitter, '
      + 'Hoehenleiste, Schwerpunkt, Kontaktpunkten und Stuetzflaeche. Du richtest die Kamera '
      + 'selbst: Blickrichtung, Blickhoehe, worauf sie zielt und wie nah sie herangeht. Ohne '
      + 'Angabe steht sie schraeg von vorn und zeigt die ganze Figur. '
      + 'DEN VERLAUF EINER BEWEGUNG SIEHST DU, INDEM DU MEHRMALS AUFRUFST - je Frame ein Bild, '
      + 'z. B. 0, 6, 12, 18. Bei gleicher weite ist der Massstab in jedem Bild derselbe und das '
      + 'Bodengitter steht fest im Raum, die Bilder sind also untereinander vergleichbar. '
      + 'Einen Fehler an einem Gelenk findest du mit ziel und weite: nah heran, dann siehst du '
      + 'ihn. Braucht keine Vorbereitung und keine Kriterien - loest selbst. NACH JEDER '
      + 'AENDERUNG AUFRUFEN: Zahlen allein zeigen nicht, ob eine Bewegung richtig aussieht.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: {
          type: 'integer', minimum: 0,
          description: 'Der Frame, den du sehen willst. Ein Aufruf ist ein Bild; fuer eine '
            + 'Abfolge rufe mehrmals mit derselben Kamera auf.'
        },
        richtung_grad: {
          type: 'number', minimum: 0, maximum: 359,
          description: `Woher die Kamera blickt, um die Figur herum: 0 von vorn, 90 von links, `
            + `180 von hinten, 270 von rechts. Standard ${RICHTUNG_STANDARD_GRAD} - schraeg von `
            + `vorn, dort verdeckt keine Koerperseite die andere.`
        },
        hoehe_grad: {
          type: 'number', minimum: -89, maximum: 90,
          description: `Wie hoch die Kamera steht: 0 auf Augenhoehe, 90 senkrecht von oben `
            + `(Draufsicht, gut fuer Stand und Fussstellung), negativ von unten. `
            + `Standard ${HOEHE_STANDARD_GRAD}.`
        },
        ziel: {
          type: 'string',
          description: 'Worauf die Kamera zielt: "figur" fuer die ganze Figur (Standard) oder '
            + 'ein GELENK aus describe_rig - dieselben Namen, mit denen du set_pose fuetterst, '
            + 'z. B. "knee_l", "arm_r", "spine". Zusammen mit weite "nah" faehrst du damit an '
            + 'das Gelenk heran, das du gerade verstellt hast.'
        },
        weite: {
          type: 'string', enum: WEITEN,
          description: 'Wie viel im Bild ist, gemessen an der Koerperhoehe: "ganz" die ganze '
            + 'Figur (Standard), "halb" etwa ein Koerperteil wie Oberkoerper oder Bein, "nah" '
            + 'ein Gelenk mit seinen Nachbarn - dort erkennst du Durchdringung und Ueberbeugung.'
        }
      },
      required: ['frame']
    }
  },
  {
    name: 'ask_human',
    // IN DER KISTE, also fuer den Agenten unsichtbar.
    //
    // Gemessen am ausgelieferten Modell: die Erkennung stellt 0 Rueckfragen,
    // keine Rolle liegt unter der Sicherheitsschwelle. Es gibt nichts, was der
    // Agent den Menschen fragen muesste. Was blieb, war ein Fragefenster mit
    // Knochennamen und Konfidenzwerten darin — eine Sperre ohne Anlass.
    //
    // Der Rumpf bleibt (handlers.js) und ist ueber rufe() erreichbar. Wenn
    // spaeter beliebige Modelle hochgeladen werden duerfen, wird die Rueckfrage
    // neu gebaut: als Frage, die ein Mensch beantworten kann, zum leuchtenden
    // Koerperteil. Bis dahin fragt niemand.
    kiste: true,
    description: 'Fragt den Menschen am Bildschirm etwas, das sich nicht messen laesst - Geschmack, eine '
      + 'Entscheidung zwischen zwei Varianten. Der Aufruf wartet auf den Klick. Nur fuer Fragen, '
      + 'die man nicht selbst mit describe_rig, describe_pose oder look beantworten kann.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Frage in Alltagssprache' },
        options: {
          type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6,
          description: 'Antwortmoeglichkeiten, 2 bis 6 Stueck'
        }
      },
      required: ['question', 'options']
    }
  },
  {
    name: 'hold_foot',
    description: 'Nagelt einen Fuss ueber einen Frame-Bereich fest: er bleibt da stehen, wo er zu Beginn '
      + 'des Bereichs steht (auf dem Boden, wenn du keine Hoehe gesetzt hast), auch wenn sich das '
      + 'Becken bewegt. Der Loeser rechnet die Beinkette dafuer selbst - du musst keine Gelenkwinkel '
      + 'dafuer suchen; ohne gesetzte Hoehe darf das Becken dabei sinken, so wie beim Gehen. GENAU DAS '
      + 'BRAUCHST DU FUER SCHRITTE: der Standfuss bleibt fest, waehrend die Figur ueber ihn hinweg '
      + 'wandert, der andere schwingt frei - und den haeltst DU ueber dem Boden (Knie beugen, Huefte '
      + 'heben); steckt er im Boden, wird die Figur angehoben und der Anker verfehlt, die Antwort sagt es. '
      + 'Ohne Anker rutschen die Fuesse mit dem Becken mit und validate meldet es. Mehrere Anker sind '
      + 'erlaubt; foot "beide" nagelt beide Fuesse fest. Setze sie ERST, wenn die Haltungen stehen: sie '
      + 'wirken nach den Haltungen. Deine gesetzten Beinwinkel bleiben dabei stehen; reicht der Rest '
      + 'der Kette nicht bis zum Anker, gibt die Huefte nach und der Bericht nennt den Fuss mit dem '
      + 'Betrag in Metern, der fehlt.',
    inputSchema: {
      type: 'object',
      properties: {
        foot: { type: 'string', description: 'Fussrolle aus describe_rig: foot_l, foot_r oder beide' },
        von: { type: 'integer', minimum: 0, description: 'erster Frame, in dem der Fuss steht' },
        bis: { type: 'integer', minimum: 0, description: 'letzter Frame, in dem er steht' },
        remove: { type: 'boolean', description: 'true entfernt alle Anker dieses Fusses in diesem Bereich' }
      },
      required: ['foot', 'von', 'bis']
    }
  },
  {
    name: 'export_clip',
    description: 'Schreibt die fertige Bewegung als glTF heraus, mit Wurzelbewegung, in Metern und Y-oben. '
      + 'Letzter Schritt, wenn die Bewegung steht.',
    inputSchema: leer
  }
];

/**
 * Die Werkzeugkiste: fertige Bewegungen und Endeffektor-Ziele.
 *
 * Sie bleiben im Katalog und bleiben aufrufbar, aber der AGENT SIEHT SIE NICHT.
 * Grund ist ein zweimal reproduzierter Befund: Steht add_phase neben set_pose,
 * baut der Agent die ganze Bewegung aus fertigen Phasen und setzt keine
 * einzige eigene Haltung — im zweiten Lauf sieben Phasen, null Haltungen.
 * Die bequemere Tuer gewinnt, egal was in der Beschreibung steht.
 *
 * Dazu kommt: von den zehn Verben sind nur vier ueberhaupt geloest
 * (GEBAUTE_VERBEN in src/solver/loeser.js); die uebrigen sechs nehmen den
 * Aufruf an und halten die Pose. Der Agent lief damit in eine Wand.
 *
 * Die Kiste ist damit nicht weg, sondern spaeter zuschaltbar — als das, was
 * sie sein soll: eine Bibliothek, aus der man sich bedienen KANN.
 */
export const KISTE = KATALOG.filter((t) => t.kiste).map((t) => t.name);

/** Was der Agent sieht. */
export const KATALOG_SICHTBAR = KATALOG.filter((t) => !t.kiste);

/** Erwartete Anzahl. Weicht KATALOG davon ab, ist etwas verlorengegangen. */
export const KATALOG_GROESSE = 25;
