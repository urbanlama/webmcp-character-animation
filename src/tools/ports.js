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
