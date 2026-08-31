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
  KATALOG, VERBEN, INTENT_ARTEN, ANSICHTEN, KANAELE, FRAME_MIN, FRAME_MAX
} from './catalog.js';
import { nichtAngeschlossen } from './ports.js';

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
export function alsTimeline(z) {
  return {
    schemaVersion: z.schemaVersion,
    fps: z.fps,
    frameCount: z.frameCount,
    rotationFormat: z.rotationFormat,
    phases: z.phases,
    overrides: z.overrides
  };
}

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
      return json(ports.rig.world());
    },

    async describe_rig() {
      if (!ports.rig) throw nichtAngeschlossen('describe_rig', 'AP2 (Rig-Vermessung)', 'Die Gelenkliste');
      const roh = ports.rig.rig();
      const bestaetigt = store.roh().roleConfirmations;
      // Vom Menschen bestaetigte Rollen gelten als gemessen (plan.md 5.5, Nr. 5).
      const roles = { ...(roh.roles || {}) };
      for (const [role, bone] of Object.entries(bestaetigt)) {
        roles[role] = { bone, confidence: 1.0, source: 'vom Menschen bestätigt' };
      }
      return json({ ...roh, roles });
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

      const ergebnis = ports.rig.probe(a.joint, a.angleDeg);
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
      return text(`Rolle "${a.role}" auf Knochen "${a.bone}" festgelegt, Konfidenz 1.0; `
        + `${anzahl} Zuordnung${anzahl === 1 ? '' : 'en'} bestätigt. Rücknehmbar mit undo.`);
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

      // Fester Moment 2 aus plan.md 6.7: der Mensch bestaetigt die Absicht,
      // bevor gebaut wird. Erst nach dem Klick wird geaendert — bricht er ab,
      // ist die Timeline unberuehrt.
      const zeilen = checks.map((c) => `- ${c.kind}: ${JSON.stringify(c)}`).join('\n');
      const antwort = await ask.frage({
        pflicht: true,
        question: `Soll die Bewegung an diesen ${checks.length} Kriterien gemessen werden?\n${zeilen}`,
        options: ['Ja, so bauen', 'Nein, verwerfen']
      });

      if (antwort.index !== 0) {
        throw new WerkzeugMeldung({
          tool: 'set_intent', param: 'Bestätigung', value: 0,
          range: `1 Bestätigung für ${checks.length} Kriterien`,
          next: 'frage den Menschen mit ask_human, was er stattdessen will',
          message: `0 von ${checks.length} Kriterien übernommen: der Mensch hat "${antwort.answer}" `
            + 'geklickt; nichts wurde geändert — frage mit ask_human, was er stattdessen will'
        });
      }

      store.aendere((z) => { z.intent = { checks }; });
      return text(`${checks.length} Erfolgskriterien festgelegt und vom Menschen bestätigt: `
        + `${checks.map((c) => c.kind).join(', ')}.`);
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
          next: 'kürze die Phasen zuerst mit edit_phase',
          message: `${zuLang.length} Phase${zuLang.length === 1 ? '' : 'n'} `
            + `${zuLang.length === 1 ? 'reicht' : 'reichen'} über Frame ${neu} `
            + `hinaus (${zuLang.map((p) => `${p.id} bis ${p.to}`).join(', ')}); `
            + `verlangt sind mindestens ${Math.max(...z0.phases.map((p) => p.to))} Frames oder `
            + 'kürze die Phasen zuerst mit edit_phase'
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
      pruefeAuswahl('set_joint', 'channel', a.channel, KANAELE,
        'bend beugt, twist dreht um die Knochenachse, swing schwenkt seitlich');

      store.aendere((z) => {
        const o = z.overrides[String(a.frame)] || (z.overrides[String(a.frame)] = {});
        const joints = o.joints || (o.joints = {});
        const g = joints[a.joint] || (joints[a.joint] = {});
        g[a.channel] = a.angleDeg;
      });
      return text(`${a.joint}.${a.channel} in Frame ${a.frame} auf ${zahl(a.angleDeg)} Grad gesetzt; `
        + `${Object.keys(store.roh().overrides).length} Frames haben jetzt Overrides. `
        + 'Rücknehmbar mit undo.');
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

      const timeline = alsTimeline(z0);
      if (ports.solver) timeline.solved = ports.solver.loese(timeline);
      const bericht = ports.validator.pruefe(timeline, { intent: z0.intent });

      // plan.md 5.3: "Jeder Bericht enthaelt immer einen Bildverweis. Zahlen
      // ohne Bild werden nicht ausgeliefert." Fehlt der Streifen, wird er hier
      // beschafft — nicht weggelassen.
      let bilder = [];
      if ((!bericht.images || bericht.images.length === 0) && ports.renderer) {
        const frames = kritischeFrames(bericht, z0.frameCount);
        bilder = ports.renderer.streifen({ frames, views: ['side', 'front'] });
        bericht.images = bilder.map(({ view, frames: f, ref }) => ({ view, frames: f, ref }));
      }
      if (!bericht.images || bericht.images.length === 0) {
        throw nichtAngeschlossen('validate', 'AP9 (Bildstreifen)',
          'Ein Bericht ohne Bildstreifen wird nicht ausgeliefert (plan.md 5.3)');
      }

      return textMitBildern(JSON.stringify(bericht, null, 2), bilder);
    },

    async look(args) {
      const a = pruefeObjekt('look', 'Argumente', args, 'übergib {frames, views}');
      const z0 = store.roh();
      brauchtLaenge('look', z0.frameCount);
      pruefeListe('look', 'frames', a.frames, 1, 12,
        'mehr Frames passen nicht in eine Antwort von 512 KB');
      a.frames.forEach((f, i) => pruefeFrame('look', `frames[${i}]`, f, z0.frameCount));
      pruefeListe('look', 'views', a.views, 1, ANSICHTEN.length,
        `erlaubt sind ${ANSICHTEN.join(', ')}`);
      a.views.forEach((v, i) => pruefeAuswahl('look', `views[${i}]`, v, ANSICHTEN,
        'die Ansichten sind im Charakter-Bezugssystem, nicht in dem der Bühne'));

      if (!ports.renderer) {
        throw nichtAngeschlossen('look', 'AP9 (Bildstreifen)', 'Der Bildstreifen');
      }
      const bilder = ports.renderer.streifen({ frames: a.frames, views: a.views });
      return textMitBildern(
        `Bildstreifen: ${a.frames.length} Frames (${a.frames.join(', ')}) in `
        + `${a.views.length} Ansicht${a.views.length === 1 ? '' : 'en'} (${a.views.join(', ')}), `
        + 'annotiert mit Achsenkreuz, Bodengitter, Schwerpunkt, Stützfläche und Kontaktpunkten.'
        + (bilder[0] && bilder[0].warnung ? `\n${bilder[0].warnung}` : ''),
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

    async export_clip() {
      const z0 = store.roh();
      brauchtLaenge('export_clip', z0.frameCount);
      if (!ports.exporter) {
        throw nichtAngeschlossen('export_clip', 'den Export (plan.md 6.9)', 'Die glTF-Datei');
      }
      const timeline = alsTimeline(z0);
      if (ports.solver) timeline.solved = ports.solver.loese(timeline);
      const e = ports.exporter.gltf(timeline);
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
