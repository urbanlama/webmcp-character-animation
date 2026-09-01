// AP8 — Vertikalschnitt: die Nahtstellen HINTER der Blockade.
//
// Der Lauf (./durchlauf.mjs) kam früher nur bis zum Phasenlöser; heute löst er
// und endet an der Berichtsschicht. Die Übergaben dahinter sind damit weiterhin
// nicht durch den Lauf selbst erreicht — aber nicht jede von ihnen ist
// ungeprüft, solange man die Blockade umgehen kann, ohne ein Teil zu ersetzen.
//
// Diese Datei stellt deshalb Fragen, die KEINE gelöste Bewegung brauchen:
//
//   S1  Derselbe Name für dieselbe Sache?  Die Werkzeugschicht nimmt andere
//       Absichtskriterien an als die Absichtsprüfung kennt. Ein Agent sieht den
//       Katalog, der Prüfer die switch-Anweisung — der Schnitt muss sagen, ob
//       sich diese beiden Mengen überhaupt schneiden.
//   S2  Dasselbe Feld für dieselbe Größe?  Die Physikprüfung liest
//       frames[i].positions, die Absichtsprüfung frames[i].bones. Beides sind
//       Weltpositionen je Knochen. Ein Löser kann nur liefern, was beide lesen.
//   S3  Und der Export?  Der erwartet eine dritte Form (root/joints).
//   S4  Die Bildgrenze  —  MAX_BILDFRAMES (report.js) muss zu FRAMES_MAX
//       (strip.js) passen, sonst schneidet der Bericht Frames ab, die der
//       Renderer nicht mehr annimmt (BRETT.md, Eintrag AP8-Bericht).
//
// Für S1 bis S3 braucht es EINEN Frame. Das ist keine erfundene Bewegung: der
// Frame ist die Bind-Pose des Modells, ausgerechnet von der projekt-eigenen
// Forward-Kinematik (src/solver/kinematik.js) über das gemessene RigProfile.
// Der Kontaktzustand ist an den gemessenen Sohlenpunkten nachgerechnet, nicht
// gesetzt. Kein Körpermaß wird getippt.
//
// Wächst der Löser, wachsen diese Prüfungen mit: sie behaupten nichts über die
// Zukunft, sie messen die Mengen und Feldnamen, die heute dastehen.

const kurz = (e) => String((e && e.message) || e || '');

/** Ein Frame aus der Bind-Pose: Weltpositionen aus der gemessenen FK. */
function bindFrame({ profil, kinematik, skel }) {
  const kn = kinematik.poseKnochen(skel, {});
  const positionen = {};
  for (const [id, wert] of kn) positionen[id] = wert.pos;
  const { com } = kinematik.schwerpunkt(skel, kn);
  // Kontakt wird gemessen, wie in src/validate/physics.js: eine Sohle dicht am
  // Boden heißt Kontakt.
  const sohlen = kinematik.sohlenWelt(skel, kn);
  const schwelle = profil.world.height * (profil.params?.soleTolerance ?? 0.035);
  const boden = profil.world.groundY ?? 0;
  const amBoden = Object.values(sohlen ?? {}).some((p) => (p[1] ?? p.y ?? 0) - boden < schwelle);
  return { positions: positionen, bones: positionen, com, contact: amBoden ? 'kontakt' : 'flug' };
}

function timelineMit(frame, frameCount = 1) {
  return {
    schemaVersion: 1, fps: 30, frameCount, rotationFormat: 'quaternion',
    phases: [], overrides: {}, solved: { frames: Array.from({ length: frameCount }, () => frame) },
  };
}

/**
 * Prüft die Nahtstellen hinter der Löser-Blockade.
 * @param {object} e
 * @param {object} e.profil  gemessenes RigProfile
 * @param {object} e.gltf    geladene Szene
 * @param {(pfad:string)=>string} e.moduleUrl
 * @param {string[]} e.katalogArten  die INTENT_ARTEN aus src/tools/catalog.js
 */
export async function nahtstellen({ profil, gltf, moduleUrl, katalogArten }) {
  const befunde = [];
  const notier = (name, status, meldung, zahlen = {}) => befunde.push({ name, status, meldung, zahlen });

  const kinematik = await import(moduleUrl('src/solver/kinematik.js'));
  const { pruefePhysik } = await import(moduleUrl('src/validate/physics.js'));
  const { pruefeAbsicht } = await import(moduleUrl('src/validate/intent.js'));
  const skel = kinematik.baueSkeleton(profil, kinematik.erfasseBind(gltf.scene));
  const frame = bindFrame({ profil, kinematik, skel });
  const fuss = profil.roles?.foot_l?.bone;

  // ── S1: Absichtsnamen ──────────────────────────────────────────────────────
  const abgelehnteArten = [];
  const akzeptierteArten = [];
  for (const art of katalogArten) {
    try {
      pruefeAbsicht(profil, timelineMit(frame), [{ kind: art, part: fuss, minAnteil: 0 }]);
      akzeptierteArten.push(art);
    } catch (err) {
      // Nur die Arten-Ablehnung zählt; alles andere (fehlende Parameter) heißt,
      // die Art ist bekannt und wollte nur andere Werte sehen.
      if (/^Absichtsprüfung abgelehnt: kind =/.test(kurz(err))) abgelehnteArten.push(art);
      else akzeptierteArten.push(art);
    }
  }
  const ueberschneidung = katalogArten.filter((a) => akzeptierteArten.includes(a));
  if (ueberschneidung.length === katalogArten.length) {
    notier('Absichtsnamen Werkzeugkatalog ↔ Absichtsprüfung', 'ok',
      `alle ${katalogArten.length} Arten des Katalogs werden von pruefeAbsicht angenommen`,
      { katalog: katalogArten.length, angenommen: ueberschneidung.length });
  } else {
    notier('Absichtsnamen Werkzeugkatalog ↔ Absichtsprüfung', 'befund',
      `${abgelehnteArten.length} von ${katalogArten.length} Absichtsarten, die der Werkzeugkatalog `
      + `dem Agenten anbietet, lehnt src/validate/intent.js ab — ein über set_intent gesetztes `
      + `Kriterium wirft beim Prüfen. Katalog: ${katalogArten.join(', ')}. Abgelehnt: `
      + `${abgelehnteArten.join(', ')}. Beispielmeldung: kind = `
      + `"${abgelehnteArten[0]}": erwartet einen der sieben Bausteine aus plan.md 6.6`,
      { katalog: katalogArten.length, abgelehnt: abgelehnteArten.length, ueberschneidung: ueberschneidung.length });
  }

  // ── S2 und S3: welche Feldnamen die Verbraucher lesen ──────────────────────
  const formNur = (feld) => ({ ...frame, positions: undefined, bones: undefined, [feld]: frame.positions });
  const Leser = [
    { name: 'Physikprüfung', datei: 'src/validate/physics.js', feld: 'positions',
      ruf: (fr) => pruefePhysik(profil, [fr], 30) },
    { name: 'Absichtsprüfung', datei: 'src/validate/intent.js', feld: 'bones',
      ruf: (fr) => pruefeAbsicht(profil, timelineMit(fr), [{ kind: 'hoehe', part: fuss, minAnteil: 0 }]) },
  ];
  const erwartet = [];
  for (const leser of Leser) {
    const eigene = formNur(leser.feld);
    let meldung = null;
    try { leser.ruf(eigene); } catch (err) { meldung = kurz(err); }
    // Der Leser ist zufrieden, wenn er sein eigenes Feld bekommt und nicht über
    // ein Feld klagt.
    const zufrieden = meldung === null || !/fehlt/.test(meldung);
    erwartet.push({ leser: leser.name, datei: leser.datei, feld: leser.feld, zufrieden });
    if (!zufrieden) {
      notier(`Frame-Feld ${leser.name}`, 'befund',
        `${leser.datei} nimmt einen Frame mit nur ${leser.feld === 'positions' ? 'bones' : 'positions'}`
        + ` nicht an: ${meldung}`, { feld: leser.feld });
    }
  }
  const felder = erwartet.map((e) => e.feld);
  const verschieden = new Set(felder).size > 1;
  if (verschieden) {
    notier('Frame-Feld der gelösten Timeline', 'befund',
      `die beiden Prüfschichten lesen dasselbe — Weltposition je Knochen — unter `
      + `verschiedenen Feldnamen: ${erwartet.map((e) => `${e.leser} liest "${e.feld}"`).join(', ')}. `
      + `plan.md 5.2 nennt für solved.frames weder das eine noch das andere, sondern `
      + `"root" und "joints". Ein Löser muss alle drei bedienen, sonst wirft der Bericht.`
      + ` src/export/gltf.js liest als dritte Form frame.root.pos/quat und frame.joints<id>.`,
      { verbraucher: erwartet.length, felder: [...new Set(felder)].join(', ') });
  }

  // ── S3: der Export mit demselben Frame ─────────────────────────────────────
  // Der Export ist der letzte Schritt des Wegs und der einzige, der eine Datei
  // zurücklässt. Nimmt er Frames an, die keine Pose enthalten, schreibt er eine
  // Animation, in der nichts passiert — und meldet Erfolg.
  const { exportiereClip } = await import(moduleUrl('src/export/gltf.js'));
  const timelineOhnePose = timelineMit(frame, 2);
  let exportMeldung = null;
  let exportBytes = 0;
  try {
    const glb = await exportiereClip(gltf, timelineOhnePose, profil);
    exportBytes = glb?.bytes?.length ?? (glb instanceof Uint8Array ? glb.length : 0);
  } catch (err) { exportMeldung = kurz(err); }
  const kanaeleOhnePose = !(frame.joints || frame.root);
  if (exportMeldung !== null) {
    notier('Export-Form des gelösten Frames', 'befund',
      `src/export/gltf.js lehnt denselben Frame ab, den Physik und Absicht lesen können: `
      + `${exportMeldung}`, { abgelehnt: 1 });
  } else if (kanaeleOhnePose && exportBytes > 0) {
    notier('Export-Form des gelösten Frames', 'befund',
      `exportiereClip schreibt ${exportBytes} Bytes glTF aus 2 Frames, obwohl dieser Frame `
      + `weder "root" noch "joints" trägt — ${Object.keys(frame.positions).length} Knochen stehen `
      + `in "positions" und "bones", die der Export nicht liest. Der Export meldet Erfolg für eine `
      + `Animation ohne jeden Bewegungskanal (AGENTS.md: Fehlerfreiheit ist kein Erfolg).`,
      { bytes: exportBytes, gelenkkanaele: 0, geleseneFelder: 'root, joints' });
  } else {
    notier('Export-Form des gelösten Frames', 'ok',
      `exportiereClip nimmt den 1 Frame aus der gemessenen Bind-Pose an und schreibt `
      + `${exportBytes} Bytes, Bewegungskanäle: 1 Satz Gelenkquaternionen`,
      { bytes: exportBytes });
  }

  // ── S4: Bildgrenze Bericht ↔ Renderer ──────────────────────────────────────
  // MAX_BILDFRAMES (report.js) liegt UNTER FRAMES_MAX (strip.js): der Bericht
  // darf nie mehr Frames wählen, als der Renderer annimmt — umgekehrt ist
  // Reserve erlaubt, der Renderer nimmt noch die an, die der Bericht wählt.
  const { MAX_BILDFRAMES } = await import(moduleUrl('src/validate/report.js'));
  const { FRAMES_MAX } = await import(moduleUrl('src/render/strip.js'));
  notier('Bildgrenze Bericht ↔ Renderer',
    MAX_BILDFRAMES <= FRAMES_MAX ? 'ok' : 'befund',
    MAX_BILDFRAMES <= FRAMES_MAX
      ? `MAX_BILDFRAMES = ${MAX_BILDFRAMES} liegt unter FRAMES_MAX = ${FRAMES_MAX} — `
      + 'der Bericht wählt nie mehr, als der Renderer annimmt'
      : `src/validate/report.js wählt bis zu ${MAX_BILDFRAMES} Frames, `
      + `src/render/strip.js nimmt höchstens ${FRAMES_MAX} an — `
      + `${Math.abs(MAX_BILDFRAMES - FRAMES_MAX)} Frames mehr, als der Renderer annimmt`,
    { bericht: MAX_BILDFRAMES, renderer: FRAMES_MAX });

  return befunde;
}
