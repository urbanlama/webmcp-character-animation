// Anschluesse an die Nachbarpakete. AP7 haengt nur an diesen vier Schnitt-
// stellen, damit die Werkzeugschicht fertig sein kann, bevor Loeser und
// Pruefungen stehen (docs/umsetzung.md, AP7: "Kann gegen Attrappen gebaut
// werden").
//
//   rig       AP2 Rig-Vermessung / AP3 Erkennung  -> world(), rig(), body(), probe()
//   solver    AP5 Phasenloeser                    -> loese(timeline)
//   validator AP4 Physik / AP6 Absicht und Stil   -> pruefe(timeline)
//   renderer  AP9 Bildstreifen                    -> streifen(frames, views)
//   exporter  6.9 Export                          -> gltf(timeline)
//
// Die Attrappen unten liefern KEINE erfundenen Koerpermasse als gemessene aus.
// Jede Antwort traegt `quelle: "attrappe"` und eine Warnung im Text. Wer eine
// Attrappenzahl in einer Abnahme sieht, sieht sofort, dass sie nicht gemessen
// ist (AGENTS.md, Regel 1).

import { WerkzeugMeldung } from './errors.js';
import { alsTimeline } from './state.js';
import { RICHTUNG_STANDARD_GRAD, HOEHE_STANDARD_GRAD } from './catalog.js';
import { BERICHT_ANSICHTEN } from '../validate/report.js';

/** Fehler, wenn ein Werkzeug ein Paket braucht, das noch nicht angeschlossen ist. */
export function nichtAngeschlossen(tool, paket, was) {
  return new WerkzeugMeldung({
    tool, param: 'Anschluss', value: 0,
    range: `1 angeschlossenes Paket ${paket}`,
    next: `${was} steht erst zur Verfügung, wenn ${paket} angeschlossen ist`,
    message: `0 von 1 benötigten Anschlüssen vorhanden: ${tool} braucht ${paket}; `
      + `${was} steht erst danach zur Verfügung`
  });
}

/** Ein 1x1-PNG, transparent. Platzhalter fuer den Bildstreifen aus AP9. */
const PLATZHALTER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Attrappen-Rig. Die Zahlen stammen aus keiner Messung und sagen das auch.
 * Wird durch AP2 ersetzt, sobald measure.js liefert.
 */
export function attrappenRig() {
  const gelenke = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'shoulder_l', 'shoulder_r',
    'elbow_l', 'elbow_r', 'spine', 'head'];
  return {
    quelle: 'attrappe',
    world() {
      return {
        quelle: 'attrappe',
        warnung: 'Attrappe: 0 Modelle vermessen — diese Werte sind keine Messung (AP2 fehlt)',
        up: 'y', forward: 'z', left: 'x',
        groundY: 0, height: null, unitsPerMeter: 1
      };
    },
    rig() {
      return {
        quelle: 'attrappe',
        warnung: `Attrappe: ${gelenke.length} Gelenknamen ohne gemessene Achsen und Vorzeichen (AP2 fehlt)`,
        roles: {},
        joints: Object.fromEntries(gelenke.map((j) => [j, {
          bone: null, dof: {}, signSource: 'nicht_messbar', limitSource: 'anatomisch'
        }]))
      };
    },
    body() {
      return {
        quelle: 'attrappe',
        warnung: 'Attrappe: 0 Segmente vermessen, 0 Sohlenpunkte erkannt (AP2 fehlt)',
        segments: [], soles: [], restDistances: {}, params: {}
      };
    },
    // Das ungefilterte RigProfile — was die Pruefungen brauchen, nicht was der
    // Agent liest. Die Attrappe hat keins und sagt das mit null.
    profil() {
      return null;
    },
    probe(joint) {
      return {
        quelle: 'attrappe',
        text: `Attrappe: Gelenk "${joint}" nicht bewegt, 0 Bilder gerendert (AP2 und AP9 fehlen)`,
        bild: null
      };
    },
    gelenke() {
      return gelenke;
    },
    rollen() {
      return [];
    }
  };
}

/** Attrappen-Loeser: rechnet nichts, meldet das. */
export function attrappenSolver() {
  return {
    quelle: 'attrappe',
    loese(timeline) {
      return {
        quelle: 'attrappe',
        frames: [],
        warnung: `Attrappe: 0 von ${timeline.frameCount} Frames gelöst (AP5 fehlt)`
      };
    }
  };
}

/**
 * Attrappen-Pruefer. Liefert einen formgueltigen ValidationReport, der als
 * ungeprueft ausgewiesen ist — passed bleibt null, nicht true. Eine Attrappe,
 * die "bestanden" meldet, waere die gefaehrlichste Zeile im Projekt.
 */
export function attrappenValidator() {
  return {
    quelle: 'attrappe',
    pruefe(timeline) {
      return {
        quelle: 'attrappe',
        frameCount: timeline.frameCount,
        phases: [],
        physics: { passed: null, issues: [], hinweis: 'Attrappe: 0 von 6 Physikprüfungen gelaufen (AP4 fehlt)' },
        intent: { passed: null, checks: [], hinweis: 'Attrappe: 0 Absichtskriterien geprüft (AP6 fehlt)' },
        style: { passed: null, issues: [], hinweis: 'Attrappe: 0 von 3 Stilprüfungen gelaufen (AP6 fehlt)' },
        images: []
      };
    }
  };
}

/** Attrappen-Renderer: liefert 1 Platzhalterbild je angeforderter Ansicht. */
export function attrappenRenderer() {
  return {
    quelle: 'attrappe',
    spur({ frame, ...kamera }) {
      return this.bild({ frame, ...kamera });
    },
    bild({ frame, ...kamera }) {
      return {
        view: 'blick',
        views: ['blick'],
        kamera: {
          richtungGrad: kamera.richtung_grad ?? RICHTUNG_STANDARD_GRAD,
          hoeheGrad: kamera.hoehe_grad ?? HOEHE_STANDARD_GRAD,
          ziel: kamera.ziel ?? 'figur',
          weite: kamera.weite ?? 'ganz',
          zielWelt: [0, 0, 0],
          sag: 'Attrappe: kein gemessener Blick'
        },
        frames: [frame],
        ref: `attrappe_blick_${frame}.png`,
        data: PLATZHALTER_PNG,
        mimeType: 'image/png',
        warnung: `Attrappe: 1x1 Platzhalter statt eines annotierten Bildes von Frame ${frame} (AP9 fehlt)`
      };
    },
    streifen({ frames, views }) {
      return views.map((view) => ({
        view,
        frames: frames.slice(),
        ref: `attrappe_${view}_${frames.join('-')}.png`,
        data: PLATZHALTER_PNG,
        mimeType: 'image/png',
        warnung: `Attrappe: 1x1 Platzhalter statt ${frames.length} annotierter Frames (AP9 fehlt)`
      }));
    }
  };
}

/** Attrappen-Export: erzeugt keine Datei, meldet die Zahlen. */
export function attrappenExporter() {
  return {
    quelle: 'attrappe',
    gltf(timeline) {
      return {
        quelle: 'attrappe',
        bytes: 0,
        ref: null,
        warnung: `Attrappe: 0 Bytes glTF aus ${timeline.frameCount} Frames geschrieben (Export fehlt)`
      };
    }
  };
}

/** Alle Attrappen auf einmal. */
export function attrappenPorts() {
  return {
    rig: attrappenRig(),
    solver: attrappenSolver(),
    validator: attrappenValidator(),
    renderer: attrappenRenderer(),
    exporter: attrappenExporter()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Echte Anschluesse (Verdrahtung, kein Neubau)
//
// Bis hierher stand nur die Attrappenseite. Ab hier haengen die sechzehn
// Werkzeuge an den gemessenen Modulen: Vermessung, Erkennung, Loeser, Bericht,
// Bildstreifen, Export. Die Werkzeugschicht wird beim Seitenstart gebaut, das
// Modell kommt erst mit dem Upload — deshalb sind die Ports LEBEND: sie zeigen
// auf ein veraenderliches Modell, das `setzeModell` einhaengt.
//
// Ohne Modell antwortet jeder Port mit einem Fehler, der die Zahl nennt
// ("0 Modelle geladen"), nicht mit einer erfundenen Zahl. Eine Attrappe kommt
// hier nirgends mehr vor.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absichts-Bausteine werden UNUEBERSETZT durchgereicht.
 *
 * Verbindlich sind die Namen des Werkzeugkatalogs (src/tools/catalog.js,
 * INTENT_ARTEN) — genau sie sieht der Agent. src/validate/intent.js zieht
 * gerade darauf nach: am 31.08.2026 stehen dort fuenf der sieben Faelle schon
 * auf den Katalognamen (rotation, airtime, travel, contact_change, clearance),
 * zwei noch auf den alten deutschen (hoehe statt part_height, tempo statt
 * part_speed). Eine Uebersetzung an dieser Stelle wuerde die fuenf fertigen
 * Faelle wieder brechen; sobald die letzten zwei nachgezogen sind, passt alles
 * von selbst. Bis dahin scheitern part_height und part_speed mit einer
 * Meldung, die den erwarteten Namen nennt.
 */

/** Fehler, wenn ein Werkzeug ein Modell braucht und keines geladen ist. */
function keinModell(tool, was) {
  return new WerkzeugMeldung({
    tool, param: 'Modell', value: 0,
    range: '1 geladenes Modell',
    next: 'lade eine .glb-Datei über die Dateiauswahl der Seite',
    message: `0 Modelle geladen: ${was} wird am geladenen Modell gemessen; `
      + 'lade eine .glb-Datei über die Dateiauswahl der Seite'
  });
}

/**
 * Baut die lebenden Anschluesse. SYNCHRON — die Funktion kehrt sofort zurueck.
 *
 * Die Nachbarpakete werden dynamisch geladen und dabei NICHT abgewartet:
 * three.js und die sieben Module wiegen zusammen mehr, als das load-Ereignis
 * der Seite tragen kann. Ein `await` an dieser Stelle schob `window.__boot
 * .bereit` hinter das load-Ereignis — 10 von 13 Browsertests fielen darauf
 * herein und meldeten „Seitenmodul wurde nicht ausgeführt“.
 *
 * Gebraucht werden die Module erst bei `setzeModell`, und das laeuft beim
 * Upload — dort wird gewartet. Bis dahin antwortet jeder Port ohnehin mit
 * „0 Modelle geladen“.
 *
 * @param {object} [opt]
 * @param {object} [opt.renderer] THREE.WebGLRenderer der Seite, fuer den Streifen
 * @returns {object} { rig, solver, validator, renderer, exporter,
 *                     setzeModell, loeseModell, stand, bereit }
 */
export function echtePorts(opt = {}) {
  const geladen = Promise.all([
    import('../rig/measure.js'),
    import('../rig/detect.js'),
    import('../solver/kinematik.js'),
    import('../solver/loeser.js'),
    import('../validate/report.js'),
    import('../render/strip.js'),
    import('../export/gltf.js')
  ]).then(([measure, detect, kinematik, loeser, report, strip, gltfExport]) =>
    ({ measure, detect, kinematik, loeser, report, strip, gltfExport }));

  // Nach dem ersten setzeModell steht M; alle synchronen Ports laufen erst
  // danach, weil sie ohne Modell mit "0 Modelle geladen" abbrechen.
  let M = null;
  geladen.then((x) => { M = x; });
  const mod = () => {
    if (!M) {
      throw new WerkzeugMeldung({
        tool: 'ports', param: 'Module', value: 0,
        range: '7 geladene Module',
        next: 'lade zuerst ein Modell — dabei werden die Module abgewartet',
        message: '0 von 7 Nachbarpaketen geladen: die Module kommen mit dem ersten Upload'
      });
    }
    return M;
  };

  // Der gemessene Stand des geladenen Modells. Alles hier drin ist gemessen
  // oder null — nichts ist geschaetzt.
  let m = null;         // { gltf, fileName, profil, erkennung, erkennungFehler, skel }
  // Letzte Loesung, damit der Bildstreifen dieselben Frames zeigt, die geprueft
  // wurden. Ohne diese Bruecke rendert `look` andere Posen als `validate` misst.
  let loesung = null;   // { frames, bericht, frameCount }
  /** Letzter Export, damit die Oberflaeche einen Download anbieten kann. */
  let letzterExport = null;

  const brauchtModell = (tool, was) => {
    if (!m) throw keinModell(tool, was);
    return m;
  };

  /** Skelett fuer den Loeser, einmal je Modell gebaut. */
  const skelett = () => {
    if (!m.skel) {
      const k = mod().kinematik;
      m.skel = k.baueSkeleton(m.profil, k.erfasseBind(m.gltf.scene));
    }
    return m.skel;
  };

  /** Rollen aus der Erkennung, sonst die drei Pflichtrollen der Vermessung. */
  const rollenTabelle = () => (m.erkennung ? m.erkennung.roles : m.profil.roles);

  /**
   * Bind-Pose der Szene, einmal je Modell gelesen: je Knochen Weltausrichtung
   * und Weltmassstab. Beides misst frameAusScene an derselben Szene, die auch
   * das Mesh stellt — nichts wird abgetippt.
   */
  const bindPose = () => {
    if (!m.bind) m.bind = mod().strip.frameAusScene(m.gltf.scene).bones;
    return m.bind;
  };

  /**
   * Uebersetzt einen geloesten Frame in die Form, die der Bildstreifen liest.
   *
   * Der Loeser liefert `positions` (je Knochen) und `joints` (je GELENK eine
   * Weltausrichtung, 18 Stueck bei Xbot). Der Streifen braucht `bones` mit
   * Position, Ausrichtung und Weltmassstab je Knochen — sonst bliebe das Mesh
   * in der Bind-Pose stehen und jedes Panel zeigte dasselbe Bild.
   *
   * Die fehlenden Ausrichtungen werden nicht geraten, sondern gerechnet: ein
   * Knochen ohne eigenen Freiheitsgrad dreht sich gegenueber seinem naechsten
   * gedrehten Vorfahren gar nicht. Seine Weltausrichtung ist deshalb exakt
   *
   *   q_welt(kind) = q_welt(vorfahre) · q_bind(vorfahre)⁻¹ · q_bind(kind)
   *
   * Der Weltmassstab kommt unveraendert aus der Bind-Pose.
   */
  const alsStreifenFrame = (f) => {
    const bind = bindPose();
    const eltern = new Map(m.profil.bones.map((b) => [b.id, b.parent]));

    // 1. Ausrichtungen, die der Loeser selbst gemessen hat: je Gelenk die
    //    WELT-Quaternion seines Knochens. Das Becken ist darunter (Gelenk
    //    `pelvis`, samt tilt/roll/turn). f.root.quat ist NICHT die Ausrichtung
    //    des Beckenknochens, sondern nur die Ganzkoerperdrehung (waxis) ohne
    //    Bind-Anteil und ohne Beckenneigung — als Knochenausrichtung genommen
    //    verliert die Anzeige die Beckenneigung.
    const quat = new Map();
    for (const [gelenk, q] of Object.entries(f.joints ?? {})) {
      const id = m.profil.joints[gelenk]?.bone;
      if (id && Array.isArray(q)) quat.set(id, q);
    }

    // 2. Die uebrigen aus dem naechsten bekannten Vorfahren fortrechnen.
    const holeQuat = (id) => {
      if (quat.has(id)) return quat.get(id);
      const kette = [];
      let cur = id;
      while (cur && !quat.has(cur)) { kette.push(cur); cur = eltern.get(cur) ?? null; }
      if (!cur) {                       // kein gedrehter Vorfahre: Bind gilt
        for (const k of kette) quat.set(k, bind[k]?.quaternion ?? [0, 0, 0, 1]);
        return quat.get(id);
      }
      for (let i = kette.length - 1; i >= 0; i--) {
        const k = kette[i];
        const p = eltern.get(k);
        const qP = quat.get(p) ?? [0, 0, 0, 1];
        const bP = bind[p]?.quaternion ?? [0, 0, 0, 1];
        const bK = bind[k]?.quaternion ?? [0, 0, 0, 1];
        const kin = mod().kinematik;
        quat.set(k, kin.qNorm(kin.qMul(qP, kin.qMul(kin.qconj(bP), bK))));
      }
      return quat.get(id);
    };

    const bones = {};
    for (const [id, p] of Object.entries(f.positions ?? {})) {
      if (!bind[id]) continue;          // Knochen, die das Profil nicht kennt
      bones[id] = { position: p, quaternion: holeQuat(id), weltSkala: bind[id].weltSkala };
    }
    return { ...f, bones };
  };

  const rig = {
    quelle: 'AP2 (src/rig/measure.js) + AP3 (src/rig/detect.js)',

    world() {
      const s = brauchtModell('describe_world', 'Der Weltvertrag');
      const w = {
        quelle: 'gemessen',
        datei: s.fileName,
        knochen: s.profil.source.boneCount,
        vertices: s.profil.source.vertexCount,
        ...s.profil.world,
        warnings: s.profil.warnings
      };
      // Vorne und links misst die Erkennung, nicht die Vermessung: sie liest
      // sie aus der Punktwolke, das Profil setzt sie fest auf z bzw. x.
      if (s.erkennung) {
        w.forward = s.erkennung.world.forward;
        w.left = s.erkennung.world.left;
        w.forwardVektor = s.erkennung.world.forwardVektor;
        w.leftVektor = s.erkennung.world.leftVektor;
        w.achsenWert = s.erkennung.world.achsenWert;
      }
      return w;
    },

    rig() {
      const s = brauchtModell('describe_rig', 'Die Gelenkliste');
      const bericht = {
        quelle: 'gemessen',
        roles: rollenTabelle(),
        joints: s.profil.joints,
        bones: s.profil.bones,
        warnings: s.profil.warnings
      };
      if (s.erkennung) {
        bericht.questions = s.erkennung.questions;
        bericht.unknown = s.erkennung.unknown;
        bericht.evidence = s.erkennung.evidence;
        bericht.warnings = [...s.profil.warnings, ...s.erkennung.warnings];
      } else if (s.erkennungFehler) {
        // Die Erkennung ist ausgefallen; die Vermessung steht trotzdem. Das
        // wird gesagt, nicht durch eine leere Rollenliste verschwiegen.
        bericht.erkennungFehler = s.erkennungFehler;
      }
      return bericht;
    },

    body() {
      const s = brauchtModell('describe_body', 'Das Körperprofil');
      return {
        quelle: 'gemessen',
        segments: s.profil.segments,
        soles: s.profil.soles,
        restDistances: s.profil.restDistances,
        params: s.profil.params,
        masseGesamt_kg: +s.profil.segments
          .reduce((a, x) => a + (x.mass ?? 0), 0).toFixed(4),
        warnings: s.profil.warnings
      };
    },

    // Das ungefilterte RigProfile fuer die Pruefungen. describe_body und
    // describe_rig schneiden fuer den Agenten zu; pruefePhysik braucht world,
    // segments und restDistances in einem Stueck.
    profil() {
      return m ? m.profil : null;
    },

    gelenke() {
      return m ? Object.keys(m.profil.joints) : [];
    },

    rollen() {
      return m ? Object.keys(rollenTabelle()) : [];
    },

    /**
     * Beugt ein Gelenk im geladenen Modell um `winkelGrad`, liest Vorher und
     * Nachher als Frames aus derselben Szene und rendert beide nebeneinander.
     * Die Bind-Pose wird danach wiederhergestellt.
     */
    probe(gelenk, winkelGrad, kanal) {
      const s = brauchtModell('probe_joint', 'Die Gelenkprobe');
      const j = s.profil.joints[gelenk];
      if (!j) {
        throw new WerkzeugMeldung({
          tool: 'probe_joint', param: 'joint', value: gelenk,
          range: `eines von ${Object.keys(s.profil.joints).length} gemessenen Gelenken`,
          next: 'rufe describe_rig auf',
          message: `Gelenk "${gelenk}" ist nicht gemessen: `
            + `${Object.keys(s.profil.joints).length} Gelenke stehen im Profil`
        });
      }
      const knochen = s.gltf.scene.getObjectByName(j.bone);
      if (!knochen) {
        throw new WerkzeugMeldung({
          tool: 'probe_joint', param: 'joint', value: gelenk,
          range: '1 Knochen in der Szene',
          next: 'lade das Modell erneut',
          message: `0 Knochen namens "${j.bone}" in der Szene gefunden, `
            + `obwohl das Profil ihn für ${gelenk} führt`
        });
      }
      // Der Agent darf den Kanal waehlen. Tut er es nicht, wird wie bisher
      // der erste mit gemessenem Vorzeichen genommen — aber die Antwort sagt
      // ihm, welcher das war und welche es sonst gaebe. Vorher war das eine
      // stille Entscheidung: bei arm_l (lift, swing, twist) probierte er
      // lift, ohne es zu erfahren, und konnte swing gar nicht ansehen.
      const namen = Object.keys(j.dof);
      if (kanal !== undefined && kanal !== null && kanal !== '') {
        if (!Object.prototype.hasOwnProperty.call(j.dof, kanal)) {
          throw new WerkzeugMeldung({
            tool: 'probe_joint', param: 'channel', value: kanal,
            range: `einer von ${namen.length} Kanaelen des Gelenks ${gelenk}: ${namen.join(', ')}`,
            next: 'die Kanalnamen je Gelenk stehen in describe_rig',
            message: `Kanal "${kanal}" gibt es am Gelenk ${gelenk} nicht; `
              + `es hat ${namen.length} Kanaele: ${namen.join(', ')}`
          });
        }
      }
      const dofName = (kanal !== undefined && kanal !== null && kanal !== '')
        ? kanal
        : (namen.find((n) => j.dof[n].signSource === 'gemessen') ?? namen[0]);
      const dof = j.dof[dofName];
      const weitere = namen.filter((n) => n !== dofName);
      const achse = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[dof.axis] ?? [1, 0, 0];
      const rad = (winkelGrad * Math.PI / 180) * (dof.sign ?? 1);

      const gesichert = knochen.quaternion.clone();
      const vorher = mod().strip.frameAusScene(s.gltf.scene, { frame: 0 });
      // Mit qMul aus kinematik.js gerechnet und dann gesetzt, nicht mit
      // Quaternion.multiply: three liest dort die internen Felder (_x .. _w).
      // Ein einfaches {x,y,z,w} ergibt NaN — der Teilbaum unter dem Gelenk
      // verliert dann seine Positionen und der Bildstreifen lehnt ab.
      const bind = [gesichert.x, gesichert.y, gesichert.z, gesichert.w];
      const kin = mod().kinematik;
      const neu = kin.qMul(bind, kin.qFromAxisAngle(achse, rad));
      knochen.quaternion.set(neu[0], neu[1], neu[2], neu[3]);
      s.gltf.scene.updateMatrixWorld(true);
      const nachher = mod().strip.frameAusScene(s.gltf.scene, { frame: 1 });
      knochen.quaternion.copy(gesichert);
      s.gltf.scene.updateMatrixWorld(true);

      const ende = Object.keys(nachher.positions).length;
      const text = `Gelenk ${gelenk} (${j.bone}), Kanal ${dofName}`
        + `${kanal ? ' (von dir gewaehlt)' : ' (nicht angegeben, erster gemessener genommen)'}`
        + ` um Achse ${dof.axis}, Vorzeichen ${dof.sign ?? 1} (${dof.signSource}): `
        + `${winkelGrad} Grad angelegt, ${ende} Knochen neu ausgewertet, `
        + `Grenzen ${JSON.stringify(dof.limit)} (${j.limitSource}). `
        + (weitere.length > 0
          ? `${weitere.length} weitere${weitere.length === 1 ? 'r Kanal' : ' Kanaele'} `
            + `an diesem Gelenk: ${weitere.join(', ')} `
            + '- mit channel waehlst du einen davon. '
          : `Dieses Gelenk hat nur diesen einen Kanal. `)
        + 'Links Bind-Pose, rechts gebeugt.';

      let bild = null;
      try {
        const r = mod().strip.createStripRenderer({
          scene: s.gltf.scene, profile: s.profil,
          frames: [vorher, nachher], frameCount: 2, renderer: opt.renderer
        });
        bild = r.streifen({ frames: [0, 1], views: ['side'] })[0];
      } catch (err) {
        return { quelle: 'gemessen', text: `${text}\nKein Bild: ${err.message}`, bild: null };
      }
      return { quelle: 'gemessen', text, bild };
    }
  };

  const solver = {
    quelle: 'AP5 (src/solver/loeser.js)',
    loese(timeline) {
      const s = brauchtModell('validate', 'Die gelöste Bewegung');
      const { frames, bericht } = mod().loeser.loeseBewegung(s.profil, skelett(), timeline);
      loesung = { frames, bericht, frameCount: timeline.frameCount };
      return { quelle: 'gemessen', frames, bericht };
    }
  };

  const rendererPort = {
    quelle: 'AP9 (src/render/strip.js)',
    /** Baut den Renderer auf der zuletzt gelösten Bewegung. */
    bauen(werkzeug) {
      const s = brauchtModell(werkzeug, 'Das Bild');
      if (!loesung) {
        throw new WerkzeugMeldung({
          tool: werkzeug, param: 'gelöste Frames', value: 0,
          range: 'mindestens 1 gelöster Frame',
          next: 'rufe zuerst validate auf, das löst die Timeline',
          message: '0 gelöste Frames vorhanden: das Bild zeigt die gelöste '
            + 'Bewegung, nicht die Bind-Pose — rufe zuerst validate auf'
        });
      }
      return mod().strip.createStripRenderer({
        scene: s.gltf.scene, profile: s.profil,
        frameQuelle: (i) => alsStreifenFrame(loesung.frames[i]),
        frameCount: loesung.frameCount, renderer: opt.renderer
      });
    },
    bild(anfrage) {
      return rendererPort.bauen('look').bild(anfrage);
    },
    streifen({ frames, views }) {
      return rendererPort.bauen('look').streifen({ frames, views });
    }
  };

  const validator = {
    quelle: 'AP4/AP6 (src/validate/report.js)',
    pruefe(timeline, { intent } = {}) {
      const s = brauchtModell('validate', 'Der Validierungsbericht');
      // Der Bericht holt sich seinen Streifen selbst (plan.md 5.3): Zahlen ohne
      // Bild gehen nicht raus. Die Auswahl kommt aus report.js, nicht von hier.
      // Zwei grosse Einzelbilder desselben Frames statt eines Rasters aus
      // sechs. Aus einem Blick ist der Raum nicht eindeutig, aus zwoelf
      // Briefmarken erkennt der Agent nichts (docs/buehne-befunde-2026-09-02.md,
      // Punkt 1). Der Verlauf gehoert `look`, das der Agent selbst richtet.
      const streifenQuelle = (auswahl) => {
        const frame = auswahl[0]?.frame ?? 0;
        const r = mod().strip.createStripRenderer({
          scene: s.gltf.scene,
          profile: s.profil,
          frameQuelle: (i) => alsStreifenFrame(
            auswahl.find((x) => x.frame === i) ?? timeline.solved.frames[i]),
          frameCount: timeline.frameCount,
          renderer: opt.renderer
        });
        gerendert = BERICHT_ANSICHTEN.map((k) => r.bild({ frame, ...k }));
        return gerendert;
      };
      let gerendert = [];
      const checks = Array.isArray(intent) ? intent : (intent && intent.checks) || [];
      const bericht = mod().report.baueValidationReport({
        profile: s.profil, timeline, intent: checks, strip: streifenQuelle
      });
      // Erst NACH der Schemapruefung angehaengt, damit der Bericht selbst
      // vertragsrein bleibt. handlers.js zieht das Feld heraus und loescht es.
      bericht.bilddaten = gerendert;
      return bericht;
    }
  };

  const exporter = {
    quelle: 'Export (src/export/gltf.js)',
    async gltf(timeline) {
      const s = brauchtModell('export_clip', 'Die glTF-Datei');
      // exportiereClip liefert { bytes: Uint8Array, animation, warnings,
      // koerperHoehe }; das Werkzeug meldet die BYTEZAHL, nicht das Array.
      const e = await mod().gltfExport.exportiereClip(s.gltf, timeline, s.profil);
      // Die Bytes festhalten, damit die Seite daraus eine Datei machen kann.
      // Das Werkzeug meldet nur die Bytezahl — bisher endete der Export damit
      // in einer Zahl, und der Mensch bekam nie einen Clip in die Hand.
      letzterExport = {
        daten: e.bytes,
        name: `${(s.fileName || 'clip').replace(/\.(glb|gltf)$/i, '')}_clip.glb`,
        bytes: e.bytes.length,
        zeit: Date.now(),
      };
      return {
        quelle: 'gemessen',
        bytes: e.bytes.length,
        ref: `${(s.fileName || 'clip').replace(/\.(glb|gltf)$/i, '')}_clip.glb`,
        daten: e.bytes,
        warnung: e.warnings && e.warnings.length
          ? `${e.warnings.length} Warnung${e.warnings.length === 1 ? '' : 'en'} beim Export: `
            + e.warnings.join('; ')
          : undefined
      };
    }
  };

  return {
    rig, solver, validator, renderer: rendererPort, exporter,

    /**
     * Misst das geladene Modell mit korrigierten Rollen NEU.
     *
     * Belegt in spikes/rollen/BEFUND.md: `confirm_role` schrieb die Korrektur
     * bisher nur in den Sitzungszustand, und describe_body antwortete danach
     * bitidentisch. Alles, was aus den Rollen abgeleitet ist — Segmente,
     * Massen, Sohlenpunkte, Gelenkachsen — blieb auf der urspruenglichen
     * Zuordnung stehen. Am Xbot gemessen: mit pelvis auf mixamorigSpine ergibt
     * die Neuvermessung 138,2 kg statt 151,9 kg Gesamtmasse und 48,0 statt
     * 61,7 kg im Rumpf. Die Bestaetigung des Menschen war damit folgenlos.
     *
     * measureRigProfile nimmt eine Rollentabelle entgegen und misst darueber
     * neu — dieser Weg existierte, wurde vom Werkzeug aber nie benutzt.
     *
     * @param {object} rollen  Rolle -> Knochenname, vom Menschen bestaetigt
     * @returns {object} was sich geaendert hat, mit Zahlen
     */
    vermesseMitRollen(rollen) {
      const s = brauchtModell('confirm_role', 'Die Neuvermessung');
      const vorher = {
        masse: (s.profil.segments ?? []).reduce((n, seg) => n + (seg.mass ?? 0), 0),
        segmente: (s.profil.segments ?? []).length,
        sohlen: (s.profil.soles ?? []).length,
      };
      const profil = mod().measure.measureRigProfile(s.gltf, {
        fileName: s.fileName,
        roles: rollen,
      });
      m = { ...m, profil, skel: null, bind: null };
      loesung = null;                 // die alte Loesung gehoert zum alten Profil
      const nachher = {
        masse: (profil.segments ?? []).reduce((n, seg) => n + (seg.mass ?? 0), 0),
        segmente: (profil.segments ?? []).length,
        sohlen: (profil.soles ?? []).length,
      };
      return { vorher, nachher, warnungen: profil.warnings.length };
    },

    /** Der zuletzt erzeugte Clip, oder null. Fuer den Download in der Seite. */
    holeLetztenExport: () => letzterExport,

    /**
     * Haengt ein geladenes Modell ein und misst es. Wirft, wenn die Vermessung
     * das Modell ablehnt — dann bleibt der vorherige Stand leer, nicht falsch.
     *
     * @returns {object} { knochen, hoehe, segmente, rollen, fragen, warnungen }
     */
    async setzeModell(gltf, o = {}) {
      await geladen;                    // erst hier warten, nicht beim Seitenstart
      const fileName = o.fileName ?? 'unbenannt.glb';
      const profil = mod().measure.measureRigProfile(gltf, { fileName });
      // Die Erkennung darf ausfallen, ohne die Vermessung mitzureissen: sie
      // liefert die feineren Rollen, die drei Pflichtrollen stehen im Profil.
      let erkennung = null;
      let erkennungFehler = null;
      try {
        erkennung = mod().detect.detectRig(gltf, { file: fileName });
      } catch (err) {
        erkennungFehler = err.message;
      }
      m = { gltf, fileName, profil, erkennung, erkennungFehler, skel: null, bind: null };
      loesung = null;
      return {
        knochen: profil.source.boneCount,
        hoehe: profil.world.height,
        segmente: profil.segments.length,
        rollen: Object.keys(erkennung ? erkennung.roles : profil.roles).length,
        fragen: erkennung ? erkennung.questions.length : 0,
        warnungen: profil.warnings.length,
        erkennungFehler
      };
    },

    /** Promise, das aufloest, sobald die sieben Module geladen sind. */
    bereit: geladen.then(() => true),

    /** Modell abhaengen, z. B. wenn ein Upload scheitert. */
    loeseModell() {
      m = null;
      loesung = null;
    },

    /** Was die Ports gerade sehen — fuer Spur und Abnahme. */
    stand() {
      return {
        modell: m ? m.fileName : null,
        knochen: m ? m.profil.source.boneCount : 0,
        hoehe: m ? m.profil.world.height : null,
        geloest: loesung ? loesung.frames.length : 0
      };
    },

    /**
     * Löst die aktuelle Timeline und liefert die Frames in der Form, die der
     * Bildstreifen liest (mit `bones` je Knochen: Position, Ausrichtung,
     * Weltmaßstab) — dieselbe Umsetzung, die look und validate benutzen,
     * nur einzeln aufrufbar. Für den Abspieler und für Prüfungen.
     *
     * @param {object} timeline  Timeline gemäß plan.md 5.2
     * @returns {object[]} gelöste Frames mit bones
     */
    /**
     * Loest den SITZUNGSZUSTAND (store.roh()) fuer die Live-Anzeige und gibt
     * die Frames mit bones-Tabellen zurueck, wie stellePose sie stellt.
     *
     * Nimmt den rohen Zustand, nicht eine fertige Timeline: der Eingang wird
     * hier ueber alsTimeline gebaut — derselbe Weg wie measure, look und
     * validate. Ein Aufrufer, der die Timeline selbst zusammenstellt, laesst
     * frueher oder spaeter ein Feld weg (index.html hatte `anchors`
     * vergessen, siehe alsTimeline in state.js).
     */
    loeseFuerSzene(zustand) {
      if (!m || m.gltf == null) {
        throw new WerkzeugMeldung({
          tool: 'ports', param: 'gelöste Frames', value: 0,
          range: 'mindestens 1 gelöster Frame',
          next: 'lade zuerst ein Modell',
          message: '0 Modelle geladen: ohne gemessenes Modell ist nichts zu lösen '
            + '(loeseFuerSzene)'
        });
      }
      const { frames } = solver.loese(alsTimeline(zustand));
      return frames.map(alsStreifenFrame);
    }
  };
}
