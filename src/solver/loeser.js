// AP5 — Phasenlöser: Einstiegspunkt. Nimmt RigProfile, Skeleton und eine
// Timeline-artige Phasenliste und liefert gelöste Frames plus Bericht.
//
// Aufruf (so bauen AP6/AP7/AP8):
//
//   import { loadGLB } from '../scene/load.js';
//   import { measureRigProfile } from '../rig/measure.js';
//   import { erfasseBind, baueSkeleton } from './solver/kinematik.js';
//   import { loeseBewegung } from './solver/loeser.js';
//
//   const gltf   = await loadGLB(puffer);
//   const profil = measureRigProfile(gltf);
//   const skel   = baueSkeleton(profil, erfasseBind(gltf.scene));
//   const { frames, bericht } = loeseBewegung(profil, skel, timeline);
//
// Die Frames sind doppelt verwendbar:
//   • als solved.frames nach plan.md 5.2: { root:{pos,quat}, joints:{name:quat} }
//   • direkt als Eingabe für die AP4-Physikprüfung pruefePhysik(profil, frames, fps):
//     jedes Frame trägt positions (Knochen→Weltmeter), com, contact und anchored.
//
// Einheiten der Phasenparameter (plan.md 5.5 — dieselben wie add_phase):
//   Tiefe  : Anteil der Körperhöhe            (crouch.tiefe, land.tiefe)
//   Tempo  : Körperhöhen pro Sekunde          (takeoff.vy)
//   Winkel : Grad                              (takeoff.spinX/Y/Z, spinGrad)
//   Zeit   : Frames ganzzahlig, [from, to)    (timeline-Vertrag)
//
// Was der Löser NICHT stillschweigend tut:
//   • gebaute Verben lösen; alles andere bleibt Lücke im Bericht mit Zahl
//   • Overrides auf Gelenkebene werden nach dem Lösen gesetzt und hart auf
//     die gemessene Grenze geklemmt — die Abweichung steht im Bericht
//   • set_target-Ziele können nicht aufgelöst werden, solange kein
//     Endeffektor-Verb gebaut ist: Lücke mit Framezahl, kein Raten

import { validateRigProfile } from '../contracts/rig-profile.js';
import { validateTimeline } from '../contracts/timeline.js';
import { schwerpunkt } from './kinematik.js';
import { poseZuFk, kopierePose } from './ik.js';
import {
  vermesseAusgangslage, startZustand,
  phaseCrouch, phaseTakeoff, phaseAirborne, phaseLand,
} from './verben.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// ─────────────────────────────────────────────────────────────────────────────

/** Verben, die dieser Löser baut (plan.md 6.3: Reihenfolge des Auftrags). */
export const GEBAUTE_VERBEN = ['crouch', 'takeoff', 'airborne', 'land'];

/** Alle Verben des Inventars — fehlende werden als Lücke gemeldet. */
export const PHASE_INVENTAR = [
  'stand', 'crouch', 'swing_arms', 'takeoff', 'airborne',
  'land', 'step', 'reach', 'turn', 'settle',
];

const VERBN = {
  crouch: phaseCrouch,
  takeoff: phaseTakeoff,
  airborne: phaseAirborne,
  land: phaseLand,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hauptfunktion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Löst eine Timeline (phases + fps + frameCount, plan.md 5.2) gegen Profil
 * und Skelett.
 *
 * @param {object} profile  RigProfile (plan.md 5.1)
 * @param {object} skel     baueSkeleton(profil, erfasseBind(scene))
 * @param {object} timeline { schemaVersion?, fps, frameCount, phases, overrides? }
 * @param {object} [opts]   { drehimpulsKorrektur: bool } globaler Testhaken
 * @returns {{frames: object[], bericht: object}}
 */
export function loeseBewegung(profile, skel, timeline, opts = {}) {
  // ── Eingaben mit Verträgen prüfen — AP1-Prüfer nutzen, nicht nachbauen ──
  if (!profile || typeof profile !== 'object') {
    throw new Error(`Löser abgelehnt: RigProfile ist ${profile === null ? 'null' : typeof profile}`);
  }
  const pv = validateRigProfile(profile);
  if (!pv.ok) {
    throw new Error(`Löser abgelehnt: RigProfile ungültig (${pv.errors.length} Fehler, erster: ${pv.errors[0].field} — ${pv.errors[0].message})`);
  }
  if (!skel || !skel.byId) {
    throw new Error(`Löser abgelehnt: Skeleton fehlt — baueSkeleton(profile, erfasseBind(scene)) zuerst aufrufen (bekommen: ${skel === null ? 'null' : typeof skel})`);
  }
  if (!timeline || typeof timeline !== 'object') {
    throw new Error(`Löser abgelehnt: Timeline ist ${timeline === null ? 'null' : typeof timeline}`);
  }
  const tl = {
    schemaVersion: timeline.schemaVersion ?? 1,
    fps: timeline.fps,
    frameCount: timeline.frameCount,
    rotationFormat: timeline.rotationFormat ?? 'quaternion',
    phases: timeline.phases ?? [],
    overrides: timeline.overrides ?? {},
  };
  const tv = validateTimeline(tl);
  if (!tv.ok) {
    throw new Error(`Löser abgelehnt: Timeline ungültig (${tv.errors.length} Fehler, erster: ${tv.errors[0].field} — ${tv.errors[0].message})`);
  }

  const phasen = tl.phases.slice().sort((a, b) => a.from - b.from);

  // ── Vermessung + Zustand ────────────────────────────────────────────────
  const vorgang = vermesseAusgangslage(skel);
  const ctx = { skel, profile, fps: tl.fps, opts, vorgang };
  const z = startZustand(skel, vorgang);
  const frames = [];
  const bericht = {
    frameCount: tl.frameCount,
    fps: tl.fps,
    koerperhoehe: skel.height,
    phasen: [],
    konflikt: [],          // geopferte Bedingungen — mit Betrag, plan.md 6.4
    lucken: [],            // unverbaute Verben / nicht umsetzbareOverrides
    hinweise: [],
    bewegung: null,        // am Ende nachgemessen: Der Löser muss Bewegung zeigen
    konfiguration: {
      verben: GEBAUTE_VERBEN,
      maxAbsenkung_m: +vorgang.maxAbsenkung.toFixed(4),
      sohlenVersatz_m: +vorgang.sohlenVersatz.toFixed(4),
    },
  };

  // ── Frames vor der ersten Phase: Bind-Stand halten ──────────────────────
  let cursor = 0;
  const holdPhase = { id: 'halt', verb: 'halt' };
  const halteBis = (ziel) => {
    for (; cursor < ziel && cursor < tl.frameCount; cursor++) {
      frames.push(halteFrame(ctx, z, holdPhase, cursor));
    }
  };

  // ── Phasen in Zeitreihenfolge ───────────────────────────────────────────
  for (const phase of phasen) {
    if (!GEBAUTE_VERBEN.includes(phase.verb)) {
      halteBis(Math.min(phase.to, tl.frameCount));
      const n = Math.max(0, Math.min(phase.to, tl.frameCount) - Math.max(phase.from, cursor));
      bericht.lucken.push({
        phase: phase.id, verb: phase.verb, from: phase.from, to: phase.to,
        meldung: `Verb „${phase.verb}“ ist noch nicht gebaut (Inventar plan.md 6.3, umgesetzt: ${GEBAUTE_VERBEN.join(', ')}) — ${n} Frames bleiben gehalten statt geraten`,
      });
      cursor = Math.max(cursor, Math.min(phase.to, tl.frameCount));
      continue;
    }
    halteBis(phase.from);
    if (phase.from < cursor) {
      bericht.hinweise.push(`Phase ${phase.id} (${phase.verb}, ${phase.from}–${phase.to}) überlappt die vorherige bis Frame ${cursor} — spätere Phase gewinnt ab Frame ${cursor}`);
    }
    const r = { ...phase };
    const before = frames.length;
    VERBN[phase.verb](ctx, r, z, frames, bericht);
    cursor = Math.max(cursor, Math.min(phase.to, tl.frameCount));
    bericht.phasen.push({
      id: phase.id, verb: phase.verb, from: phase.from, to: phase.to,
      state: z.kontakt ? 'kontakt' : 'flug',
      frames: frames.length - before,
    });
  }
  halteBis(tl.frameCount);

  // ── Overrides (Ebene 2/3): nach dem Lösen setzen, hart klemmen ──────────
  wendeOverridesAn(ctx, z, tl, frames, bericht);

  // ── Nachmessen: hat die Timeline Bewegung? (Fehlerfreiheit ist kein Erfolg)
  bericht.bewegung = bewegeKennzahlen(frames);

  return { frames, bericht };
}

// ─────────────────────────────────────────────────────────────────────────────
// Override-Ebene
// ─────────────────────────────────────────────────────────────────────────────

function wendeOverridesAn(ctx, z, tl, frames, bericht) {
  const { skel } = ctx;
  for (const [key, ov] of Object.entries(tl.overrides ?? {})) {
    const f = Number(key);
    const frame = frames.find((x) => x.frame === f);
    if (!frame) {
      bericht.lucken.push({
        frame: f,
        meldung: `Override für Frame ${f}: kein gelöster Frame — Timeline endet bei ${tl.frameCount - 1}`,
      });
      continue;
    }
    // Gelenkwinkel: Wert in Grad (plan.md 5.5), Grenzen gemessen.
    if (ov.joints && typeof ov.joints === 'object') {
      const pose = kopierePose(z.pose);
      for (const [gelenk, vorgaben] of Object.entries(ov.joints)) {
        for (const [dof, grad] of Object.entries(vorgaben ?? {})) {
          const k = `${gelenk}.${dof}`;
          const d = skel.dofs[k];
          if (!d) {
            bericht.lucken.push({ key: k, meldung: `Override-Gelenk „${k}“ nicht im Profil (${Object.keys(skel.dofs).length} Freiheitsgrade durchsucht)` });
            continue;
          }
          if (typeof grad !== 'number' || !Number.isFinite(grad)) {
            bericht.lucken.push({ key: k, meldung: `Override-Wert für ${k} ist ${JSON.stringify(grad)}: erwartet Grad als Zahl` });
            continue;
          }
          const gek = Math.min(d.grenze[1], Math.max(d.grenze[0], grad));
          pose.dofs[k] = gek;
          if (Math.abs(gek - grad) > 1e-6) {
            bericht.konflikt.push({
              frame: f, verb: 'override', bedingung: 'gelenkwinkel', einheit: 'grad',
              soll: grad, erreicht: gek, betrag: Math.abs(grad - gek),
              grund: `Gelenkgrenze ${d.grenze.join('…')}° (Rang 1, nie verletzt)`,
              meldung: `Override ${k} Frame ${f}: verlangte ${grad}°, geklemmt auf ${gek}° — Gelenkgrenze lässt ${d.grenze[0]}…${d.grenze[1]}° zu`,
            });
          }
        }
      }
      const kn = poseZuFk(skel, pose);
      ueberschreibeFrame(ctx, skel, frame, pose, kn);
    }
    // set_target-Ziele: erst mit Endeffektor-Verb lösbar — Lücke, kein Raten.
    if (ov.targets || ov.pos) {
      bericht.lucken.push({
        frame: f,
        meldung: `Override für Frame ${f} setzt ein Ziel (set_target, plan.md 5.5 Nr. 10): Endeffektor-Ziele löst der Löser erst mit den Verben reach/step — ${Object.keys(ov).join(', ')} unverändert gelassen`,
      });
    }
  }
}

/** Pose-Änderung in einen fertigen Frame zurückschreiben. */
function ueberschreibeFrame(ctx, skel, frame, pose, kn) {
  const com = schwerpunkt(skel, kn).com;
  const positionen = {};
  for (const [id, b] of kn) positionen[id] = [...b.pos];
  const joints = {};
  for (const [name, j] of Object.entries(skel.profile.joints)) {
    const b = kn.get(j.bone);
    if (b) joints[name] = [...b.quat];
  }
  frame.positions = positionen;
  frame.com = [...com];
  frame.joints = joints;
  frame.root = { pos: [...pose.wpos], quat: [...(wurzelQ(pose))] };
  frame.override = true;
}

function wurzelQ(pose) {
  const w = Math.hypot(...pose.waxis);
  return w > 1e-12 ? quatAchseWinkel(pose.waxis, w) : [0, 0, 0, 1];
}

function quatAchseWinkel(achse, grad) {
  const l = Math.hypot(achse[0], achse[1], achse[2]) || 1;
  const h = (grad * Math.PI / 180) / 2;
  const s = Math.sin(h);
  return [achse[0] / l * s, achse[1] / l * s, achse[2] / l * s, Math.cos(h)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Halteframe (Bind-Pose oder letzte Pose, phasenzustandstreue Markierung)
// ─────────────────────────────────────────────────────────────────────────────

function halteFrame(ctx, z, phase, f) {
  const { skel } = ctx;
  const kn = poseZuFk(skel, z.pose);
  const com = schwerpunkt(skel, kn).com;
  const positionen = {};
  for (const [id, b] of kn) positionen[id] = [...b.pos];
  const joints = {};
  for (const [name, j] of Object.entries(skel.profile.joints)) {
    const b = kn.get(j.bone);
    if (b) joints[name] = [...b.quat];
  }
  return {
    frame: f,
    phase: phase.id,
    root: { pos: [...z.pose.wpos], quat: [...wurzelQ(z.pose)] },
    joints,
    positions: positionen,
    com: [...com],
    contact: z.kontakt ? 'kontakt' : 'flug',
    anchored: z.kontakt ? soleIds(skel, z.anker) : [],
    geschwindigkeit: [...z.comVel],
  };
}

function soleIds(skel, anker) {
  const out = [];
  for (const a of anker) for (const s of skel.soles) if (s.bone === a.knochen) out.push(s.id);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bewegungsnachweis — Zahlen statt Eindrücken
// ─────────────────────────────────────────────────────────────────────────────

function bewegeKennzahlen(frames) {
  if (frames.length < 2) {
    return { frames: frames.length, meldung: 'zu wenige Frames für Bewegungsmessung' };
  }
  let comWeg = 0, maxSpeed = 0, toteFrames = 0;
  let rotWeg = 0;
  let kontaktwechsel = 0;
  let letzter = null;
  let qVorher = frames[0].root?.quat ?? null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].com, b = frames[i].com;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    comWeg += d;
    maxSpeed = Math.max(maxSpeed, d);
    if (d < 1e-5) toteFrames++;
    const rq = frames[i].root?.quat;
    if (rq && qVorher) {
      // Winkel zwischen aufeinanderfolgenden Wurzelquaternionen:
      // 2·atan2(|q₁⁻¹q₂|_vektor, q₁⁻¹q₂_skalar) — Betragsaddition,
      // Vorzeichensprünge (359°→−1°) zählen als Bewegung, nicht als Stillstand.
      const inv = [-qVorher[0], -qVorher[1], -qVorher[2], qVorher[3]];
      const dqx = inv[3]*rq[0] + inv[0]*rq[3] + inv[1]*rq[2] - inv[2]*rq[1];
      const dqy = inv[3]*rq[1] - inv[0]*rq[2] + inv[1]*rq[3] + inv[2]*rq[0];
      const dqz = inv[3]*rq[2] + inv[0]*rq[1] - inv[1]*rq[0] + inv[2]*rq[3];
      const dqw = inv[3]*rq[3] - inv[0]*rq[0] - inv[1]*rq[1] - inv[2]*rq[2];
      rotWeg += 2 * Math.atan2(Math.hypot(dqx, dqy, dqz), dqw) * 180 / Math.PI;
    }
    if (rq) qVorher = rq;
    if (letzter && frames[i].contact !== letzter) kontaktwechsel++;
    letzter = frames[i].contact;
  }
  return {
    frames: frames.length,
    schwerpunktWeg_m: +comWeg.toFixed(4),
    starksteFrameBewegung_m: +maxSpeed.toFixed(4),
    toteFrames,
    wurzelDrehungWeg_grad: +rotWeg.toFixed(1),
    kontaktwechsel,
  };
}
