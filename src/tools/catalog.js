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

/** Ansichten des Bildstreifens, plan.md 5.5 Werkzeug 14 und AP9. */
export const ANSICHTEN = ['front', 'side', 'quarter', 'top'];

/** Kanaele eines Gelenkwinkels, plan.md 5.5 Werkzeug 11. */
export const KANAELE = ['bend', 'twist', 'swing'];

/** Grenzen der Timeline-Laenge, plan.md 5.5 Werkzeug 7. */
export const FRAME_MIN = 12;
export const FRAME_MAX = 600;

const leer = { type: 'object', properties: {}, required: [] };

/**
 * Die sechzehn Katalogeintraege in der Reihenfolge aus plan.md 5.4.
 * Der Aufruf-Rumpf kommt in handlers.js dazu.
 */
export const KATALOG = [
  {
    name: 'describe_world',
    description: 'Liefert den Weltvertrag: oben, vorne, links, Bodenhöhe, Maßstab und Figurgröße.',
    inputSchema: leer
  },
  {
    name: 'describe_rig',
    description: 'Liefert Rollen, Gelenke, Freiheitsgrade mit Achsen, Vorzeichen und Grenzwerten '
      + 'sowie alle Zuordnungen mit Konfidenz unter 1 und ihre Vermessungsquelle.',
    inputSchema: leer
  },
  {
    name: 'describe_body',
    description: 'Liefert das gemessene Körperprofil: Segmente mit Radius und Masse in Metern und '
      + 'Kilogramm, Sohlenpunkte in Knochen-lokalen Metern, Ruheabstände in Metern und alle '
      + 'Verfahrensparameter mit Begründung.',
    inputSchema: leer
  },
  {
    name: 'probe_joint',
    description: 'Beugt ein Gelenk probeweise (biegt es testweise, um zu sehen/zu schauen, was '
      + 'passiert), um z. B. ein Hüft- oder Kniegelenk kurz auszutesten, und liefert Vorher/Nachher '
      + 'als Bild. Der Winkel ist in Grad, das Vorzeichen wirkt in dem in describe_rig genannten '
      + 'Bezugssystem des Gelenks.',
    inputSchema: {
      type: 'object',
      properties: {
        joint: { type: 'string', description: 'Gelenkname aus describe_rig, z. B. hip_l' },
        angleDeg: { type: 'number', minimum: -90, maximum: 90, description: 'Winkel in Grad, -90 bis 90' }
      },
      required: ['joint', 'angleDeg']
    }
  },
  {
    name: 'confirm_role',
    description: 'Bestätigt oder korrigiert eine Zuordnung von Rolle zu Knochen; gilt nach '
      + 'Bestätigung als gemessen.',
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
    description: 'Legt die Erfolgskriterien der Bewegung fest — was am Ende erreicht sein '
      + 'muss (Drehung, Sprungweite, Bodenkontakt, Abstände), nicht wie lang die Animation '
      + 'insgesamt dauert; dafür dient set_duration. Alle Längen in Anteilen der '
      + 'Körperhöhe, alle Winkel in Grad, alle Zeiten in Sekunden. Wird vor dem Bauen vom '
      + 'Menschen bestätigt.',
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
            properties: { kind: { type: 'string', enum: INTENT_ARTEN } },
            required: ['kind']
          }
        }
      },
      required: ['checks']
    }
  },
  {
    name: 'set_duration',
    description: 'Setzt, wie lang die Animation insgesamt dauert — die Gesamtlänge in '
      + 'Sekunden ausgedrückt, angegeben als framerate-abhängige Frame-Anzahl: bei der im '
      + 'Timeline-Vertrag genannten Framerate entspricht eine Sekunde der Framerate an '
      + 'Frames. Legt den Zeitrahmen fest; die inhaltlichen Erfolgskriterien setzt set_intent.',
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
    name: 'add_phase',
    description: 'Legt eine Bewegungsphase an, z. B. einen Schritt nach links (Verb step), '
      + 'einen Sprung (takeoff/airborne/land) oder eine Drehung (turn) — baut also einen '
      + 'gesamten Bewegungsabschnitt statt eines Einzelziels. Zeiten in Frames, '
      + 'Phase-Parameter in den Einheiten des Verbs (Tiefe in Anteilen der Körperhöhe, '
      + 'Geschwindigkeit in Körperhöhen pro Sekunde, Winkel in Grad). Verben und Parameter: '
      + 'plan.md 6.3.',
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
    description: 'Ändert oder entfernt eine bestehende Phase. Dieselben Einheiten wie add_phase. '
      + 'Änderungen sind über undo rückgängig zu machen.',
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
    description: 'Setzt für einen einzelnen Frame ein Ziel für einen Endeffektor oder den '
      + 'Schwerpunkt, in Metern, Weltkoordinaten des Weltvertrags — also eine Wunschposition '
      + 'wie „das Bein soll bei Frame 40 auf 0,35 m stehen“, nicht einen Gelenkwinkel; '
      + 'Winkel in Grad setzt set_joint. Wird vom Löser angestrebt und kann ihm nicht gelingen; '
      + 'das steht dann im Bericht.',
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
    description: 'Setzt für einen einzelnen Frame einen Gelenkwinkel in Grad, Vorzeichen und Achse '
      + 'wie in describe_rig.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'integer', minimum: 0 },
        joint: { type: 'string', description: 'Gelenkname aus describe_rig' },
        angleDeg: { type: 'number', minimum: -180, maximum: 180, description: 'Winkel in Grad' },
        channel: { type: 'string', enum: KANAELE, description: `einer von ${KANAELE.length}: ${KANAELE.join(', ')}` }
      },
      required: ['frame', 'joint', 'angleDeg', 'channel']
    }
  },
  {
    name: 'undo',
    description: 'Nimmt die letzte Änderung zurück, macht sie also rückgängig: den letzten '
      + 'Schritt an Phasen oder Overrides, z. B. wenn das Ergebnis dem Menschen nicht gefällt.',
    inputSchema: leer
  },
  {
    name: 'validate',
    description: 'Prüft, ob die gesamte Timeline in Ordnung ist — phasenabhängig, mit '
      + 'vollständigem Bericht und einem Bildstreifen der kritischen Frames. Anders als look '
      + 'zeigt es nicht nur, sondern prüft und beanstandet. Alle Zahlen in den Einheiten des '
      + 'Weltvertrags (Meter, Grad, Sekunden).',
    inputSchema: leer
  },
  {
    name: 'look',
    description: 'Zeigt, wie die Figurenbewegung aussieht: erzeugt einen Bildstreifen aus '
      + 'gewählten Frames und Ansichten — front = von vorn, side = von der Seite, quarter = '
      + 'aus dem Viertel, top = von oben — im Charakter-Bezugssystem, immer annotiert. Ansinnen '
      + 'wie „zeig mir von vorne/von der Seite, wie das aussieht“ gehört hierher. Prüft nichts '
      + 'und beanstandet nichts; zum Prüfen dient validate. Frames ganzzahlig im Timeline-Bezug.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: {
          type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1, maxItems: 12,
          description: 'Frames, 1 bis 12 Stück'
        },
        views: {
          type: 'array', items: { type: 'string', enum: ANSICHTEN }, minItems: 1, maxItems: 4,
          description: `Ansichten aus ${ANSICHTEN.join('/')}`
        }
      },
      required: ['frames', 'views']
    }
  },
  {
    name: 'ask_human',
    description: 'Stellt dem Menschen eine Frage mit Antwortmöglichkeiten und wartet auf einen '
      + 'Klick; die Antwort kommt im selben Aufruf zurück. Budget: siehe UI-Anzeige.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Frage in Alltagssprache' },
        options: {
          type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6,
          description: 'Antwortmöglichkeiten, 2 bis 6 Stück'
        }
      },
      required: ['question', 'options']
    }
  },
  {
    name: 'export_clip',
    description: 'Exportiert die Timeline als glTF mit Wurzelbewegung in Meter, Y-oben, '
      + 'Charakter-vorne +Z. Rotationen als Quaternionen.',
    inputSchema: leer
  }
];

/** Erwartete Anzahl. Weicht KATALOG davon ab, ist etwas verlorengegangen. */
export const KATALOG_GROESSE = 16;
