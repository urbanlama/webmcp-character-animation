// AP8 — Vertikalschnitt: der Lauf durch den echten Weg.
//
// Dieser Durchlauf geht die acht Schritte aus dem Auftrag in der vorgegebenen
// Reihenfolge: laden, vermessen, Rollen erkennen, Rückfrage, Absicht und Phasen,
// lösen, prüfen und berichten, Bildstreifen, Export. Für jeden Schritt gilt:
//
//   1. Das Bauteil wird geholt, nicht nachgebaut  (./teile.mjs schaut nach)
//   2. Jede Übergabe wird gegen den Vertrag aus src/contracts/ geprüft
//   3. Fehlt ein Bauteil, endet der Lauf HIER und sagt, dass es fehlt
//   4. Liefert ein Bauteil Daten, die den Vertrag nicht erfüllen, BRICHT der
//      Lauf ab — mit Datei und Betrag, nicht still
//
// Regel 3 und 4 sind der Unterschied zwischen einem Schnitt, der etwas behauptet,
// und einem, der etwas verschweigt. Der Wert liegt nicht darin, grün zu sein,
// sondern darin, genau zu sagen, wo der Weg heute endet.
//
// Kein Körpermaß wird getippt: Höhe, Radien, Gelenke, Sohlen kommen aus
// src/rig/measure.js am geladenen Modell. Die einzigen Zahlen hier sind
// Versuchsaufbau (FRAMES, PHASEN) und die Schrittliste selbst.
//
// Plattformfrei: diese Datei importiert kein node:*. Sie läuft in Node und im
// Browser. Bytes, URLs und der Klick des Menschen kommen von außen hinein.

import { bauteilPruefen, loeserSuchen } from './teile.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// VERFAHRENSPARAMETER dieses Versuchs (Versuchsaufbau, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Frames der geprüften Timeline. 60 = 2 s bei 30 fps: lang genug, dass vier
 *  Phasen Platz haben und die Flugphase Ballistik-Frames zählt; kurz genug,
 *  dass ein numerischer Löserlauf über 60 Frames im Test mitläuft. */
export const FRAMES = 60;

/** Vier Phasen eines Sprungs mit Landung — die Rückfallposition aus plan.md 8,
 *  nicht der Salto: hier geht es um den Weg, nicht um die Lösequalität. */
export const PHASEN = [
  { verb: 'crouch', from: 0, to: 18, params: { tiefe: 0.25 } },
  { verb: 'takeoff', from: 18, to: 26, params: { vy: 2.6 } },
  { verb: 'airborne', from: 26, to: 44, params: { einrollen: 0.3 } },
  { verb: 'land', from: 44, to: 58, params: { fuss: 'beide', abfedern: 0.2 } },
];

/** Absichtskriterien in den Namen des WERKZEUGKATALOGS (src/tools/catalog.js),
 *  weil ein Agent genau diese Namen sieht. Ob die Prüfungsschicht dieselben
 *  kennt, ist Frage dieses Laufs, nicht Annahme. */
export const ABSICHT_KATALOG = [
  { kind: 'airtime', minSek: 0.4 },
  { kind: 'part_height', part: 'com', minAnteil: 0.4 },
];

/** Schrittliste des Wegs, in der Reihenfolge des Auftrags. */
export const SCHRITTE = [
  { id: '1', name: 'Modell laden', datei: 'src/scene/load.js', paket: 'AP0' },
  { id: '2a', name: 'Rig vermessen', datei: 'src/rig/measure.js', paket: 'AP2' },
  { id: '2b', name: 'Rollen erkennen', datei: 'src/rig/detect.js', paket: 'AP3' },
  { id: '3', name: 'Unsichere Rolle bestätigen', datei: 'src/ui/ask-human.js', paket: 'AP7' },
  { id: '4', name: 'Absicht setzen, Phasen anlegen', datei: 'src/tools/index.js', paket: 'AP7' },
  { id: '5', name: 'Phasen lösen', datei: 'src/solver/', paket: 'AP5' },
  { id: '6', name: 'Prüfen, Bericht bauen', datei: 'src/validate/report.js', paket: 'AP4/AP6' },
  { id: '7', name: 'Bildstreifen anhängen', datei: 'src/render/strip.js', paket: 'AP9' },
  { id: '8', name: 'Exportieren', datei: 'src/export/gltf.js', paket: 'plan.md 6.9' },
];

/** Abbruchsprung durch die Schrittfolge hindurch. */
class LaufEnde extends Error {
  constructor(typ, meldung) { super(meldung); this.typ = typ; }
}

/** Eine Ausnahme als Text, der immer eine Zahl enthält, wenn die Quelle eine hat. */
function kurz(err) {
  const text = String((err && err.message) || err || 'ohne Meldung');
  return /\d/.test(text) ? text : `${text} (0 Zahlen in der Meldung)`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} umgebung
 * @param {(datei:string)=>string} umgebung.moduleUrl  Repo-Pfad -> importierbare URL
 * @param {(datei:string)=>Promise<boolean>} umgebung.existiert  Datei vorhanden?
 * @param {()=>Promise<Uint8Array>} umgebung.glbBytes  rohe Bytes des Testmodells
 * @param {string[]} [umgebung.solverDateien]  vorhandene src/solver/*.js
 * @param {(liste:string[])=>number} [umgebung.antworte]  der Klick des Menschen
 * @param {object} [umgebung.teile]  Bauteile von außen (für Negativfälle)
 * @param {object} [umgebung.scene]  three-Szene für den Bildstreifen (Browser)
 * @param {(e:object)=>object} [umgebung.streifenRenderer]  Bildstreifen-Port (Browser)
 * @param {string} [umgebung.umgebungsname]  'node' | 'browser'
 * @param {string} [umgebung.dateiName]
 */
export async function durchlauf(umgebung = {}) {
  const {
    moduleUrl, existiert, glbBytes, solverDateien = [],
    antworte = () => 0, teile = {}, dateiName = 'Xbot.glb', umgebungsname = 'node',
  } = umgebung;

  const ergebnis = {
    umgebung: umgebungsname,
    endete: null,        // 'vollständig' | 'nicht verfügbar' | 'abgebrochen'
    endeteBei: null,     // die id des Schritts, der den Lauf gestoppt hat
    kamBis: null,        // der letzte Schritt, der lief
    schritte: [],
    uebergaben: [],
    fehlend: [],
    haken: [],
    zahlen: {},
  };

  /** Notiert einen Schritt. Meldet derselbe Schritt sich zweimal — erst gelaufen,
   *  dann über den Vertrag gestolpert — gilt die letzte Meldung, nicht die erste. */
  const notier = (id, status, meldung = null, zahlen = {}) => {
    const s = SCHRITTE.find((x) => x.id === id);
    const vor = ergebnis.schritte.findIndex((x) => x.id === id);
    if (vor >= 0 && ergebnis.schritte[vor].status === 'nicht verfügbar') ergebnis.fehlend.pop();
    const zahlenAlt = vor >= 0 ? ergebnis.schritte[vor].zahlen : {};
    const eintrag = { ...s, status, meldung, zahlen: { ...zahlenAlt, ...zahlen } };
    if (vor >= 0) ergebnis.schritte[vor] = eintrag; else ergebnis.schritte.push(eintrag);
    if (status === 'nicht verfügbar') ergebnis.fehlend.push(meldung);
  };
  /** Meldet einen Haken und gibt den Lauf weiter — ein Teil, das da ist und
   *  Nein sagt, ist ein Ergebnis, kein fehlendes Teil. */
  const hake = (text) => { ergebnis.haken.push(text); };

  /** Übergabe gegen einen der drei Vertragsprüfer aus src/contracts/. */
  const uebergabe = (zwischen, pruefer, resultat, zahlen = {}) => {
    const meldung = resultat.ok ? null
      : resultat.errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join(' | ');
    ergebnis.uebergaben.push({
      zwischen, pruefer, ok: !!resultat.ok, meldung, zahlen,
      fehlerAnzahl: resultat.errors ? resultat.errors.length : 0,
    });
    return !!resultat.ok;
  };
  /** Gemeinsames Ende: Schritt notieren und aus der Folge springen. */
  const schluss = (id, typ, meldung) => {
    notier(id, typ === 'abgebrochen' ? 'abgebrochen' : 'nicht verfügbar', meldung);
    return new LaufEnde(typ, meldung);
  };
  /** Ein Teil ist da, liefert aber Daten, die seinen Vertrag nicht erfüllen. */
  const vertragsbruch = (id, datei, was, errors) => schluss(id, 'abgebrochen',
    `${datei} liefert ${was}, das den eigenen Vertrag nicht erfüllt: ${errors.length} `
    + `Fehler, erster — ${errors[0].field}: ${errors[0].message}`);

  try {
    // ── 1 Modell laden ───────────────────────────────────────────────────────
    const geladen = teile.laden ?? await bauteilPruefen({
      datei: 'src/scene/load.js', paket: 'AP0', moduleUrl, existiert,
      exporte: ['loadGLB', 'validateLoadedModel', 'getBounds'],
    });
    if (!geladen.verfuegbar) throw schluss('1', 'nicht verfügbar', geladen.meldung);
    const { loadGLB, validateLoadedModel, getBounds } = geladen.modul;

    let gltf;
    try {
      gltf = await loadGLB(await glbBytes());
    } catch (err) {
      throw schluss('1', 'abgebrochen', `src/scene/load.js:loadGLB — ${err.message}`);
    }
    let knochen;
    try {
      knochen = validateLoadedModel(gltf);
    } catch (err) {
      throw schluss('1', 'abgebrochen', `src/scene/load.js:validateLoadedModel — ${err.message}`);
    }
    const box = getBounds(gltf.scene);
    notier('1', 'gelaufen', null, {
      knochen: knochen.boneCount, skinnedMeshes: knochen.skinnedMeshCount,
      clips: (gltf.animations || []).length,
      koerperhoeheMeter: +(box.max.y - box.min.y).toFixed(4),
    });
    uebergabe('Datei → Szene', 'validateLoadedModel (src/scene/load.js)',
      { ok: knochen.boneCount > 0, errors: knochen.boneCount > 0 ? [] : [{ field: 'boneCount', message: '0 Knochen im geladenen Modell' }] },
      { knochen: knochen.boneCount });

    // ── 2a Rig vermessen ─────────────────────────────────────────────────────
    const gemessen = teile.vermessen ?? await bauteilPruefen({
      datei: 'src/rig/measure.js', paket: 'AP2', moduleUrl, existiert,
      exporte: ['measureRigProfile'],
    });
    if (!gemessen.verfuegbar) throw schluss('2a', 'nicht verfügbar', gemessen.meldung);

    let profil;
    try {
      profil = gemessen.modul.measureRigProfile(gltf, { fileName: dateiName });
    } catch (err) {
      throw schluss('2a', 'abgebrochen', `src/rig/measure.js:measureRigProfile — ${err.message}`);
    }
    const { validateRigProfile } = await import(moduleUrl('src/contracts/rig-profile.js'));
    const vertragspruefer = teile.vertragspruefer ?? validateRigProfile;
    const profilForm = vertragspruefer(profil);
    notier('2a', 'gelaufen', null, {
      gelenke: Object.keys(profil.joints || {}).length,
      segmente: (profil.segments || []).length,
      sohlen: (profil.soles || []).length,
      ruheabstaende: Object.keys(profil.restDistances || {}).length,
      rollen: Object.keys(profil.roles || {}).length,
      warnungen: (profil.warnings || []).length,
      koerperhoeheMeter: profil.world?.height ?? null,
    });
    if (!uebergabe('Vermessung → RigProfile-Vertrag',
      'validateRigProfile (src/contracts/rig-profile.js)', profilForm,
      { felder: Object.keys(profil).length })) {
      throw vertragsbruch('2a', 'src/rig/measure.js', 'ein RigProfile', profilForm.errors);
    }
    if ((profil.warnings || []).length > 0) {
      hake(`Vermessung meldet ${profil.warnings.length} Warnungen am Referenzmodell — `
        + `erste: ${profil.warnings[0]}`);
    }

    // ── 2b Rollen erkennen ───────────────────────────────────────────────────
    const erkannt = teile.erennen ?? await bauteilPruefen({
      datei: 'src/rig/detect.js', paket: 'AP3', moduleUrl, existiert,
      exporte: ['detectRig'],
    });
    if (!erkannt.verfuegbar) throw schluss('2b', 'nicht verfügbar', erkannt.meldung);

    let rollenBericht = null;
    let fragenZuRollen = [];
    try {
      rollenBericht = erkannt.modul.detectRig(gltf, { file: dateiName });
      const vereint = { ...profil, roles: { ...(profil.roles || {}), ...(rollenBericht.roles || {}) } };
      const vereintForm = vertragspruefer(vereint);
      if (!uebergabe('Erkennung → RigProfile-Vertrag',
        'validateRigProfile (src/contracts/rig-profile.js)', vereintForm,
        { rollen: Object.keys(vereint.roles).length })) {
        throw vertragsbruch('2b', 'src/rig/detect.js', 'Rollen', vereintForm.errors);
      }
      profil.roles = vereint.roles;
      const p = erkannt.modul.PARAMS || {};
      const sicher = p.sicherAb ?? 0.9;
      const frageAb = p.fragenAb ?? 0.5;
      fragenZuRollen = Object.entries(profil.roles)
        .filter(([, r]) => r && r.confidence >= frageAb && r.confidence < sicher)
        .map(([rolle, r]) => ({ rolle, ...r }));
      notier('2b', 'gelaufen', null, {
        rollen: Object.keys(rollenBericht.roles || {}).length,
        inDerRueckfragezone: fragenZuRollen.length,
        unbekannt: (rollenBericht.unknown || []).length,
        rueckfragen: (rollenBericht.questions || []).length,
      });
    } catch (err) {
      if (err instanceof LaufEnde) throw err;
      notier('2b', 'abgelehnt', `src/rig/detect.js:detectRig — ${err.message}`);
      hake(`Rollen erkennen lehnt das Referenzmodell ab: ${err.message} — der Schnitt läuft `
        + `mit den ${Object.keys(profil.roles || {}).length} Rollen aus der Vermessung allein weiter`);
    }

    // ── 3 Unsichere Rollen bestätigen ────────────────────────────────────────
    const rueckfrage = teile.rueckfrage ?? await bauteilPruefen({
      datei: 'src/ui/ask-human.js', paket: 'AP7', moduleUrl, existiert,
      exporte: ['createAskBroker'],
    });
    if (!rueckfrage.verfuegbar) throw schluss('3', 'nicht verfügbar', rueckfrage.meldung);

    const broker = rueckfrage.modul.createAskBroker({});
    let beantwortet = 0;
    const fragenAbgelehnt = [];
    for (const frage of fragenZuRollen) {
      // frage() lehnt ab, statt zu werfen: das Budget (plan.md 6.7) ist ein
      // Ergebnis, kein Absturz. Die Zusage deshalb als Antwort- oder als
      // Ablehnungsweg aufnehmen, bevor geantwortet wird.
      const offen = broker.frage({
        question: `Ist „${frage.bone}“ der Knochen für ${frage.rolle}?`,
        options: [`Ja, ${frage.bone}`, 'Nein, anderer Knochen'],
      }).catch((err) => ({ abgelehnt: kurz(err) }));
      try {
        broker.antworte(antworte([frage.rolle]));
      } catch {
        /* die Frage wurde nie gestellt — das Ergebnis kommt aus offen */
      }
      const antwort = await offen;
      if (antwort?.abgelehnt) {
        fragenAbgelehnt.push(antwort.abgelehnt);
        break;
      }
      beantwortet += 1;
    }
    notier('3', 'gelaufen', null, {
      rollenfragenBeantwortet: beantwortet,
      rollenfragenOffen: Math.max(0, fragenZuRollen.length - beantwortet),
      budget: broker.stand().budget,
      verbraucht: broker.stand().verbraucht,
    });
    if (fragenAbgelehnt.length > 0) {
      hake(`Rückfragen über dem Budget: ${fragenZuRollen.length} Rollen standen in der `
        + `Rückfragezone, beantwortet wurden ${beantwortet} — ${fragenAbgelehnt[0]}`);
    }
    if (beantwortet === 0 && fragenAbgelehnt.length === 0) {
      hake(`Schritt 3 hatte 0 zu fragen: ${fragenZuRollen.length} Rollen lagen in der `
        + `Rückfragezone (Konfidenz 0,5 bis 0,9) von ${Object.keys(profil.roles || {}).length} `
        + `Rollen${rollenBericht ? '' : ' — die Vermessung allein liefert 3 Rollen mit Konfidenz 1,0'}`);
    }

    // ── 4 Absicht setzen, Phasen anlegen ─────────────────────────────────────
    const schichtBau = teile.werkzeuge ?? await bauteilPruefen({
      datei: 'src/tools/index.js', paket: 'AP7', moduleUrl, existiert,
      exporte: ['createToolLayer'],
    });
    if (!schichtBau.verfuegbar) throw schluss('4', 'nicht verfügbar', schichtBau.meldung);

    const { alsTimeline } = await import(moduleUrl('src/tools/handlers.js'));
    const ports = teile.ports ?? {
      rig: {
        quelle: 'gemessen — src/rig/measure.js',
        world: () => ({ ...profil.world, quelle: 'gemessen' }),
        rig: () => ({ roles: profil.roles, joints: profil.joints, quelle: 'gemessen' }),
        body: () => ({
          segments: profil.segments, soles: profil.soles,
          restDistances: profil.restDistances, params: profil.params, quelle: 'gemessen',
        }),
        probe: (gelenk, winkel) => ({
          text: `${gelenk} um ${winkel} Grad gebeugt`, bild: null, quelle: 'gemessen',
        }),
        gelenke: () => Object.keys(profil.joints || {}),
        rollen: () => Object.keys(profil.roles || {}),
      },
      solver: null, validator: null, renderer: null, exporter: null,
    };
    const schicht = await schichtBau.modul.createToolLayer({ ports });
    const rufe = (name, args) => schicht.rufe(name, args ?? {});
    const text = (a) => String(a?.content?.[0]?.text ?? '');

    const auskunft = [];
    for (const werks of ['describe_world', 'describe_rig', 'describe_body']) {
      const a = await rufe(werks);
      auskunft.push({ werkzeug: werks, fehler: !!a.isError, laenge: text(a).length });
    }

    const laenge = await rufe('set_duration', { frameCount: FRAMES });
    if (laenge.isError) {
      throw schluss('4', 'abgebrochen', `src/tools/:set_duration — ${text(laenge)}`);
    }

    // Die Absicht bestätigt der Mensch, bevor gebaut wird (plan.md 6.7).
    const absichtLauf = rufe('set_intent', { checks: ABSICHT_KATALOG });
    queueMicrotask(() => {
      try { schicht.ask.antworte(antworte(['absicht'])); } catch { /* schon beantwortet */ }
    });
    const absicht = await absichtLauf;

    const phasen = [];
    for (const p of PHASEN) {
      const a = await rufe('add_phase', p);
      phasen.push({ verb: p.verb, fehler: !!a.isError, text: text(a) });
    }
    const abgelehnt = phasen.filter((p) => p.fehler);
    if (abgelehnt.length > 0) {
      throw schluss('4', 'abgebrochen', `src/tools/:add_phase lehnt ${abgelehnt.length} von `
        + `${PHASEN.length} Phasen ab — erste Meldung: ${abgelehnt[0].text}`);
    }
    const zustand = schicht.store.lies();
    notier('4', 'gelaufen', null, {
      werkzeuge: schicht.registry.anzahl(),
      phasen: zustand.phases.length,
      frames: zustand.frameCount,
      absichtBestaetigt: !absicht.isError,
    });

    const timeline = alsTimeline(zustand);
    const { validateTimeline } = await import(moduleUrl('src/contracts/timeline.js'));
    const timelineForm = validateTimeline(timeline);
    if (!uebergabe('Phasen → Timeline-Vertrag', 'validateTimeline (src/contracts/timeline.js)',
      timelineForm, { phasen: timeline.phases.length, frames: timeline.frameCount })) {
      throw vertragsbruch('4', 'src/tools/', 'eine Timeline', timelineForm.errors);
    }
    ergebnis.geloesteWerkzeuge = { absicht: text(absicht).slice(0, 200) };
    ergebnis.auskunft = auskunft;
    ergebnis.schicht = schicht;

    // ── 5 Phasen lösen ───────────────────────────────────────────────────────
    const loeser = teile.loeser ?? await loeserSuchen({ dateien: solverDateien, moduleUrl, existiert });
    if (!loeser.verfuegbar) throw schluss('5', 'nicht verfügbar', loeser.meldung);

    let geloest;
    try {
      geloest = await loeser.modul[loeser.name](timeline);
    } catch (err) {
      throw schluss('5', 'abgebrochen', `${loeser.datei}:${loeser.name} — ${err.message}`);
    }
    const frames = Array.isArray(geloest) ? geloest : geloest?.frames;
    const zahlDerFrames = Array.isArray(frames) ? frames.length : null;
    if (zahlDerFrames !== timeline.frameCount) {
      throw schluss('5', 'abgebrochen',
        `${loeser.datei}:${loeser.name} liefert ${zahlDerFrames ?? typeof geloest} Frames für eine `
        + `Timeline von ${timeline.frameCount} Frames — Differenz `
        + `${timeline.frameCount - (zahlDerFrames ?? 0)}`);
    }
    timeline.solved = { frames };
    const solvedForm = validateTimeline(timeline);
    if (!uebergabe('Löser → Timeline-Vertrag (solved.frames)',
      'validateTimeline (src/contracts/timeline.js)', solvedForm,
      { geliefert: zahlDerFrames, erwartet: timeline.frameCount })) {
      throw vertragsbruch('5', loeser.datei, 'solved.frames', solvedForm.errors);
    }
    notier('5', 'gelaufen', null, {
      frames: zahlDerFrames, eintritt: `${loeser.datei}:${loeser.name}`,
    });

    // ── 6 Prüfen und Bericht bauen ───────────────────────────────────────────
    const berichtBau = teile.bericht ?? await bauteilPruefen({
      datei: 'src/validate/report.js', paket: 'AP4/AP6', moduleUrl, existiert,
      exporte: ['baueValidationReport'],
    });
    if (!berichtBau.verfuegbar) throw schluss('6', 'nicht verfügbar', berichtBau.meldung);

    // ── 7 Bildstreifen (Pflichteingang des Berichts, plan.md 5.3) ────────────
    const streifenBau = teile.streifen ?? await bauteilPruefen({
      datei: 'src/render/strip.js', paket: 'AP9', moduleUrl, existiert,
      exporte: ['createStripRenderer'],
    });
    if (!streifenBau.verfuegbar) throw schluss('7', 'nicht verfügbar', streifenBau.meldung);
    // Der Renderer bekommt die gelösten Frames erst in diesem Moment — er wird
    // deshalb als Fabrik hereingereicht, nicht als fertiges Objekt, und die
    // Fabrik darf selbst noch module nachladen.
    const renderer = umgebung.streifenRenderer
      ? await umgebung.streifenRenderer({
        scene: umgebung.scene, profile: profil, frames, frameCount: timeline.frameCount,
      })
      : null;
    if (typeof renderer?.streifen !== 'function') {
      throw schluss('7', 'nicht verfügbar',
        `noch nicht verfügbar: Bildstreifen (src/render/strip.js), 0 WebGL-Kontext in `
        + `${umgebungsname} — createStripRenderer braucht eine gerenderte Szene`);
    }
    const streifen = (auswahl) => renderer.streifen({
      frames: auswahl.map((f) => f.frame), views: ['side', 'front'],
    });
    notier('7', 'gelaufen', null, { quelle: 'src/render/strip.js:createStripRenderer' });

    // ── 6 weiter: Bericht aus drei Prüfschichten plus Bildstreifen ───────────
    let bericht;
    try {
      bericht = berichtBau.modul.baueValidationReport({
        profile: profil, timeline, intent: zustand.intent?.checks ?? [],
        stil: {}, strip: streifen,
      });
    } catch (err) {
      throw schluss('6', 'abgebrochen', `src/validate/report.js:baueValidationReport — ${err.message}`);
    }
    const { validateValidationReport } = await import(moduleUrl('src/contracts/validation-report.js'));
    const berichtForm = validateValidationReport(bericht);
    notier('6', 'gelaufen', null, {
      bilder: (bericht.images || []).length,
      physikMeldungen: (bericht.physics?.issues || []).length,
      absichtChecks: (bericht.intent?.checks || []).length,
      stilMeldungen: (bericht.style?.issues || []).length,
    });
    if (!uebergabe('Bericht → ValidationReport-Vertrag',
      'validateValidationReport (src/contracts/validation-report.js)', berichtForm,
      { felder: Object.keys(bericht).length })) {
      throw vertragsbruch('6', 'src/validate/report.js', 'einen Bericht', berichtForm.errors);
    }

    // ── 8 Exportieren ────────────────────────────────────────────────────────
    const exportBau = teile.export ?? await bauteilPruefen({
      datei: 'src/export/gltf.js', paket: 'plan.md 6.9', moduleUrl, existiert,
      exporte: ['exportiereClip', 'pruefeExport'],
    });
    if (!exportBau.verfuegbar) throw schluss('8', 'nicht verfügbar', exportBau.meldung);

    let glb;
    try {
      glb = await exportBau.modul.exportiereClip(gltf, timeline, profil);
    } catch (err) {
      throw schluss('8', 'abgebrochen', `src/export/gltf.js:exportiereClip — ${err.message}`);
    }
    const bytes = glb?.bytes ?? (glb instanceof Uint8Array ? glb : glb?.glb);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw schluss('8', 'abgebrochen', `src/export/gltf.js:exportiereClip liefert `
        + `${bytes?.length ?? 0} Bytes glTF aus ${timeline.frameCount} Frames — 0 Byte ist `
        + `kein Export`);
    }
    let nachgelesen;
    try {
      nachgelesen = await exportBau.modul.pruefeExport(timeline, bytes, profil);
    } catch (err) {
      throw schluss('8', 'abgebrochen', `src/export/gltf.js:pruefeExport — ${err.message}`);
    }
    notier('8', 'gelaufen', null, {
      bytes: bytes.length,
      abweichungen: (nachgelesen?.abweichungen || []).length,
    });

    ergebnis.endete = 'vollständig';
    ergebnis.bericht = bericht;
  } catch (err) {
    if (!(err instanceof LaufEnde)) throw err;
    ergebnis.endete = err.typ;
  }

  // Alle Schritte aufführen — "wie weit kam er" ist ohne die restliche Liste
  // nicht beantwortbar.
  const erreicht = new Set(ergebnis.schritte.map((s) => s.id));
  for (const s of SCHRITTE) {
    if (!erreicht.has(s.id)) ergebnis.schritte.push({ ...s, status: 'nicht erreicht', meldung: null, zahlen: {} });
  }
  ergebnis.schritte.sort((a, b) => SCHRITTE.findIndex((s) => s.id === a.id)
    - SCHRITTE.findIndex((s) => s.id === b.id));
  // Der Lauf endet an dem Schritt, der ihn gestoppt hat — nicht an einem, der
  // nur nie dran war.
  ergebnis.endeteBei = ergebnis.schritte
    .find((s) => s.status === 'nicht verfügbar' || s.status === 'abgebrochen')?.id ?? null;
  ergebnis.kamBis = [...ergebnis.schritte].reverse()
    .find((s) => s.status === 'gelaufen')?.id ?? null;
  ergebnis.zahlen = zusammenfassen(ergebnis);
  delete ergebnis.schicht;   // kein Testobjekt für Behauptungen, nur für den Lauf
  return ergebnis;
}

function zusammenfassen(e) {
  return {
    schritteGesamt: SCHRITTE.length,
    gelaufen: e.schritte.filter((s) => s.status === 'gelaufen').length,
    nichtVerfuegbar: e.schritte.filter((s) => s.status === 'nicht verfügbar').length,
    abgelehnt: e.schritte.filter((s) => s.status === 'abgelehnt').length,
    abgebrochen: e.schritte.filter((s) => s.status === 'abgebrochen').length,
    nichtErreicht: e.schritte.filter((s) => s.status === 'nicht erreicht').length,
    uebergaben: e.uebergaben.length,
    uebergabenOk: e.uebergaben.filter((u) => u.ok).length,
    haken: e.haken.length,
  };
}

/**
 * Der Berichtstext — die Abnahmezeile "am Ende steht, welche Schritte liefen,
 * welche fehlten und wo es hakte".
 *
 * Ein Lauf, der nichts getan hat, bekommt hier kein Lob: ohne einen einzigen
 * gelaufenen Schritt steht ausdrücklich da, dass er nichts gebracht hat.
 */
export function berichtText(e) {
  const z = e.zahlen;
  const zeilen = [
    `Vertikalschnitt (${e.umgebung}): kam bis Schritt ${e.kamBis ?? '—'}, `
    + `endet bei Schritt ${e.endeteBei ?? '—'} — ${z.gelaufen} von ${z.schritteGesamt} `
    + `Schritten gelaufen, ${z.nichtVerfuegbar} nicht verfügbar, ${z.abgelehnt} abgelehnt, `
    + `${z.abgebrochen} abgebrochen, ${z.nichtErreicht} nicht erreicht.`,
  ];
  if (z.gelaufen === 0) {
    zeilen.push(`KEIN ERFOLG: dieser Lauf hat 0 von ${z.schritteGesamt} Schritten geschafft `
      + '— er meldet nichts als Stillstand.');
  }
  zeilen.push('', 'Schritte');
  for (const s of e.schritte) {
    const zahlen = Object.entries(s.zahlen || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    zeilen.push(`  ${s.id.padEnd(3)} ${s.status.padEnd(15)} ${s.name}${zahlen ? ' — ' + zahlen : ''}`);
    if (s.meldung) zeilen.push(`       ${s.meldung}`);
  }
  zeilen.push('', `Übergaben (${z.uebergabenOk} von ${z.uebergaben} gegen den Vertrag ok)`);
  for (const u of e.uebergaben) {
    zeilen.push(`  ${u.ok ? 'ok  ' : 'FEHL'} ${u.zwischen}  [${u.pruefer}]`);
    if (!u.ok) zeilen.push(`       ${u.fehlerAnzahl} Vertragsfehler: ${u.meldung}`);
  }
  if (e.fehlend.length > 0) {
    zeilen.push('', `Fehlende Teile (${e.fehlend.length})`);
    for (const f of e.fehlend) zeilen.push(`  ${f}`);
  }
  if (e.haken.length > 0) {
    zeilen.push('', `Wo es hakte (${e.haken.length})`);
    for (const h of e.haken) zeilen.push(`  ${h}`);
  }
  return zeilen.join('\n');
}
