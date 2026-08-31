// AP5 — Phasenlöser: Kinematik-Kern.
//
// Was hier passiert: aus dem GEMESSENEN RigProfile (docs/plan.md 5.1) und der
// eingefangenen Bind-Pose des geladenen Modells wird ein rechenbares Skelett.
// Forward-Kinematik (FK) liefert je Pose die Weltpositionen aller Knochen,
// den Schwerpunkt aus den gemessenen Segmentmassen und das Trägheitsmoment
// um eine Achse.
//
// Grundregel (AGENTS.md, Regel 1): dieses Modul enthält KEINE Körpermaße.
// Knochenlängen, Massen, Radien, Sohlenpunkte, Gelenkachsen, -vorzeichen und
// -grenzen kommen alle aus dem Profil. Die Gelenkrotation ist dasselbe
// Verfahren wie in der Vermessung (src/rig/measure.js):
//
//     Weltquat(Knochen) = Elternweltquat · BindLokalquat · AchsenWinkel(lokale Achse, roh)
//     roh = sign · Wert       (Wert > 0 bewegt das Kettenende in die in der
//                              Vermessung bestimmte Sollrichtung „want“)
//
// Damit ist die Wirkung eines dof-Werts im Löser exakt die, die AP2 gemessen hat.
//
// Das Modul ist bewusst frei von three.js: es arbeitet auf [x,y,z]-Arrays und
// [x,y,z,w]-Quaternionen. Es läuft identisch in Node und im Browser.

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// plan.md Kap. 4: an einer Stelle, mit Begründung.
// ─────────────────────────────────────────────────────────────────────────────

/** Toleranz des Selbstkonsistenz-Nachweises beim Skelettbau, Anteil der
 *  Körperhöhe: 10⁻³ (≈ 1,6 mm bei 1,59 m) — muss die Rundung der Profilwerte
 *  auf vier Nachkommastellen (plan.md 5.1, bis ~5·10⁻⁵ m je Gelenk) über
 *  tiefe Ketten akkumuliert aufnehmen; echte Kettenfehler (Skalierung, Scherung,
 *  vertauschte Eltern) richten Zentimeter an, keine Millimeter. */
export const BIND_KONSISTENZ_ANTEIL = 1e-3;

// ─────────────────────────────────────────────────────────────────────────────
// Vektor- und Quaternion-Mathe (klein, abgeschlossen, testbar)
// ─────────────────────────────────────────────────────────────────────────────

export function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
export function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export const Q_EINS = [0, 0, 0, 1];

/** a · b (Hintereinanderausführung: erst b, dann a — wie three.js premultiply) */
export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

export function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Vektor um Quaternion q rotieren */
export function qRot(q, v) {
  // t = 2·(q.xyz × v); v' = v + q.w·t + q.xyz × t   (schnelle Form)
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function qFromAxisAngle(axis, rad) {
  const l = vLen(axis) || 1;
  const h = rad / 2;
  const s = Math.sin(h);
  return qNorm([(axis[0] / l) * s, (axis[1] / l) * s, (axis[2] / l) * s, Math.cos(h)]);
}

/** Vorzeichenbewusste Multiplikation: Quaternion als 3×3-Matrix auf Vektor */
export function qToAxes(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], // Spalte 0
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], // Spalte 1
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], // Spalte 2
  ];
}

/** Winkel (Grad) und Achse einer Quaternion — für Drehberichte */
export function qZerlegen(q) {
  const qq = q[3] > 1 || q[3] < -1 ? qNorm(q) : q;
  const s = Math.sqrt(Math.max(0, 1 - qq[3] * qq[3]));
  const grad = (2 * Math.atan2(s, qq[3]) * 180) / Math.PI;
  if (s < 1e-9) return { grad: 0, achse: [0, 1, 0] };
  return { grad, achse: [qq[0] / s, qq[1] / s, qq[2] / s] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bind-Pose einfangen — aus einer geladenen Szene, ohne three-Import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liest aus einer geladenen Szene (three.js-Objektbaum) die Welttransformation
 * jedes Knochens. Läuft in Node und Browser, solange das Szenenobjekt
 * `traverse` und `matrixWorld` mitbringt — three.js wird nicht importiert.
 *
 * @param {{traverse: Function, updateMatrixWorld: Function}} scene
 * @returns {Array<{id: string, pos: number[], quat: number[]}>}
 */
export function erfasseBind(scene) {
  if (!scene || typeof scene.traverse !== 'function') {
    throw new Error(`Bind-Erfassung abgelehnt: Objekt ohne traverse-Methode (${scene === null ? 'null' : typeof scene})`);
  }
  scene.updateMatrixWorld(true);
  const out = [];
  let skaliert = 0;
  scene.traverse((o) => {
    if (!o.isBone) return;
    const e = o.matrixWorld && o.matrixWorld.elements;
    if (!e || e.length < 16) {
      throw new Error(`Bind-Erfassung abgelehnt: Knochen „${o.name}“ ohne 16-elementige Weltmatrix`);
    }
    const s = o.scale;
    if (s && (Math.abs(s.x - 1) > 1e-6 || Math.abs(s.y - 1) > 1e-6 || Math.abs(s.z - 1) > 1e-6)) {
      skaliert++;
    }
    // Position direkt aus der Matrix
    const pos = [e[12], e[13], e[14]];
    // Weltmaßstab des Knochens aus den Matrixspalten: Profil-Sohlenpunkte
    // (plan.md 5.1) stehen im KNOCHEN-lokalen System — bei einer Szene mit
    // Maßstabsknoten (Xbot: Faktor 0,01 über allem) sind das Zentimeter-Werte,
    // die erst mit diesem Faktor wieder Meter werden.
    const l0 = Math.hypot(e[0], e[1], e[2]);
    const l1 = Math.hypot(e[4], e[5], e[6]);
    const l2 = Math.hypot(e[8], e[9], e[10]);
    const unstet = Math.max(l0, l1, l2) - Math.min(l0, l1, l2);
    if (unstet > 1e-6 * (l0 + l1 + l2)) {
      throw new Error(`Bind-Erfassung abgelehnt: Knochen „${o.name}“ Matrix nicht einheitlich skaliert (Spaltenlängen ${l0.toFixed(6)}, ${l1.toFixed(6)}, ${l2.toFixed(6)} — Spreizung ${(unstet * 1e6).toFixed(1)}·10⁻⁶)`);
    }
    const c0 = [e[0] / l0, e[1] / l0, e[2] / l0], c1 = [e[4] / l1, e[5] / l1, e[6] / l1], c2 = [e[8] / l2, e[9] / l2, e[10] / l2];
    const m = [
      c0[0], c1[0], c2[0],
      c0[1], c1[1], c2[1],
      c0[2], c1[2], c2[2],
    ];
    out.push({ id: o.name, pos, quat: matrixZuQuat(m), weltmassstab: (l0 + l1 + l2) / 3 });
  });
  if (out.length === 0) {
    throw new Error('Bind-Erfassung abgelehnt: 0 Knochen in der Szene gefunden (isBone nowhere)');
  }
  if (skaliert > 0) {
    throw new Error(`Bind-Erfassung abgelehnt: ${skaliert} Knochen mit von 1 verschiedener lokaler Skalierung — reine Rotationsketten-Annahme verletzt`);
  }
  return out;
}

/** 3×3-Rotationsmatrix (zeilenweise, 9 Zahlen) → Quaternion [x,y,z,w] */
function matrixZuQuat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const sp = m00 + m11 + m22;
  let q;
  if (sp > 0) {
    const s = Math.sqrt(sp + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNorm(q);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skelett
// ─────────────────────────────────────────────────────────────────────────────

const ACHSENVEKTOR = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * Baut das rechenbare Skelett aus RigProfile + Bind-Erfassung.
 *
 * @param {object} profile      RigProfile (plan.md 5.1)
 * @param {Array}  bind         Ergebnis von erfasseBind
 * @returns {object} skel — Eingabe für poseKnochen, schwerpunkt, traegheit
 */
export function baueSkeleton(profile, bind) {
  if (!profile || typeof profile !== 'object') {
    throw new Error(`Skelettbau abgelehnt: RigProfile ist ${profile === null ? 'null' : typeof profile}`);
  }
  const height = profile.world?.height;
  if (!(height > 0)) {
    throw new Error(`Skelettbau abgelehnt: world.height = ${height}: Körperhöhe fehlt — alles hier skaliert an ihr`);
  }
  if (!profile.roles?.pelvis?.bone) {
    throw new Error('Skelettbau abgelehnt: Rolle pelvis fehlt im Profil — ohne Becken gibt es keine Wurzel');
  }

  const bindById = new Map(bind.map((b) => [b.id, b]));
  const order = [];              // Eltern vor Kindern
  const byId = new Map();

  for (const b of profile.bones ?? []) {
    const w = bindById.get(b.id);
    if (!w) {
      throw new Error(`Skelettbau abgelehnt: Knochen „${b.id}“ im Profil, aber in ${bind.length} erfassten Bind-Knochen nicht gefunden`);
    }
    byId.set(b.id, {
      id: b.id,
      parent: b.parent ?? null,
      bindWorld: b.bindWorld,
      wPos: w.pos,
      wQuat: w.quat,
      weltmassstab: w.weltmassstab ?? 1,
      lPos: null,
      lQuat: null,
      kinder: [],
    });
  }

  // Reihenfolge: Eltern vor Kindern (Profile kommen aus der Szenereihenfolge —
  // sicherheitshalber per Wiederholung, bis alle sortiert sind).
  const gesetzt = new Set();
  let offen = [...byId.values()];
  let runden = 0;
  while (offen.length > 0 && runden++ < 64) {
    const bleibt = [];
    for (const b of offen) {
      if (b.parent === null || !byId.has(b.parent) || gesetzt.has(b.parent)) {
        setztLokal(b);
        if (b.parent !== null && byId.has(b.parent)) byId.get(b.parent).kinder.push(b.id);
        order.push(b.id);
        gesetzt.add(b.id);
      } else bleibt.push(b);
    }
    if (bleibt.length === offen.length) {
      throw new Error(`Skelettbau abgelehnt: ${bleibt.length} Knochen in einem Eltern-Zyklus (z. B. „${bleibt[0].id}“) — hierarchie auflösen`);
    }
    offen = bleibt;
  }
  if (offen.length > 0) {
    throw new Error(`Skelettbau abgelehnt: ${offen.length} Knochen nicht einordbar nach ${runden} Sortierrunden`);
  }

  /** Lokale Bind-Transformation aus den Welttransformationen ableiten. */
  function setztLokal(b) {
    if (b.parent === null || !byId.has(b.parent)) {
      b.lPos = [...b.wPos];
      b.lQuat = [...b.wQuat];
      return;
    }
    const p = byId.get(b.parent);
    const pqk = qconj(p.wQuat);
    b.lQuat = qMul(pqk, b.wQuat);
    b.lPos = qRot(pqk, vSub(b.wPos, p.wPos));
  }

  // Gelenktabelle: „gelenk.dof“ → {bone, achse (local), vorzeichen, grenze}
  const dofs = {};
  const dofsByBone = new Map();
  for (const [name, j] of Object.entries(profile.joints ?? {})) {
    for (const [dof, d] of Object.entries(j.dof ?? {})) {
      if (!ACHSENVEKTOR[d.axis]) {
        throw new Error(`Skelettbau abgelehnt: ${name}.${dof} Achse „${d.axis}“ unbekannt (erwartet x, y oder z)`);
      }
      const eintrag = {
        key: `${name}.${dof}`,
        bone: j.bone,
        achse: ACHSENVEKTOR[d.axis],
        vorzeichen: d.sign ?? 1,
        grenze: d.limit,
      };
      dofs[eintrag.key] = eintrag;
      if (!dofsByBone.has(j.bone)) dofsByBone.set(j.bone, []);
      dofsByBone.get(j.bone).push(eintrag);
    }
  }

  // Segment-Massen und referenzierte Kettenknochen
  const segments = (profile.segments ?? []).map((s) => ({
    id: s.id, from: s.from, to: s.to, mass: s.mass, radius: s.radius,
  }));
  const kettenKnochen = new Set();
  for (const s of segments) { kettenKnochen.add(s.from); kettenKnochen.add(s.to); }

  const skel = {
    profile,
    height,
    groundY: profile.world.groundY ?? 0,
    byId,
    order,
    dofs,
    dofsByBone,
    segments,
    kettenKnochen,
    soles: profile.soles ?? [],
    rollenKnochen: {
      pelvis: profile.roles?.pelvis?.bone ?? null,
      foot_l: profile.roles?.foot_l?.bone ?? null,
      foot_r: profile.roles?.foot_r?.bone ?? null,
    },
    totalMass: segments.reduce((a, s) => a + s.mass, 0),
  };

  // Teilmenge der Knochen, die eine Ganzkörperdrehung (delta) mitnimmt:
  // alles ab dem Becken abwärts — ein einmal berechnetes Set statt Rekursion
  // je Frame und je IK-Schritt.
  skel.unterPelvis = new Set();
  if (skel.rollenKnochen.pelvis) {
    const stapel = [skel.rollenKnochen.pelvis];
    while (stapel.length) {
      const id = stapel.pop();
      skel.unterPelvis.add(id);
      for (const kind of byId.get(id).kinder) stapel.push(kind);
    }
  } else {
    for (const id of order) skel.unterPelvis.add(id);
  }

  // ── Selbstkonsistenz-Nachweis (Zahl, keine Behauptung): ──────────────────
  // FK der Bind-Kette ohne jede Pose muss auf die gemessenen
  // Bind-Weltpositionen zurückkommen. Schlägt es fehl, ist die
  // reine Rotationsketten-Annahme für dieses Modell verletzt.
  const pBind = poseKnochen(skel, { dofs: {} });
  let maxAbw = 0;
  let werAbw = '';
  for (const b of order) {
    const gemessen = byId.get(b).bindWorld;
    const gerechnet = pBind.get(b).pos;
    const d = vLen(vSub(gemessen, gerechnet));
    if (d > maxAbw) { maxAbw = d; werAbw = b; }
  }
  const grenze = height * BIND_KONSISTENZ_ANTEIL;
  if (maxAbw > grenze) {
    throw new Error(`Skelettbau abgelehnt: Bind-Kette reproduziert ihre Weltpositionen nicht — größte Abweichung ${(maxAbw * 100).toFixed(2)} cm an „${werAbw}“, Grenze ${(grenze * 100).toFixed(3)} cm (${BIND_KONSISTENZ_ANTEIL * 1e6}·10⁻⁶ der Körperhöhe)`);
  }

  return skel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward-Kinematik
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rechnet eine Pose auf Knochen-Welttransformationen.
 *
 * pose = {
 *   dofs: { "hip_l.flex": 23.4, ... },          // Werte in Grad, Sollrichtung
 *   delta: {                                     // optionale Ganzkörper-Rigidbewegung
 *     pos:  [x, y, z],                           // Weltverschiebung in Metern
 *     q:    [x, y, z, w],                        // Weltrotation um pivot
 *     pivot:[x, y, z]                            // Drehpunkt, Default: Becken
 *   }
 * }
 *
 * @param {object} skel Ergebnis von baueSkeleton
 * @param {object} pose
 * @returns {Map<string, {pos: number[], quat: number[]}>}
 */
export function poseKnochen(skel, pose) {
  const out = new Map();
  const dofs = pose.dofs ?? {};
  const delta = pose.delta ?? null;
  const dq = delta?.q ?? null;
  const pivot = delta?.pivot ?? skel.byId.get(skel.rollenKnochen.pelvis).wPos;
  const dpos = delta?.pos ?? null;

  for (const id of skel.order) {
    const b = skel.byId.get(id);
    let wq, wp;
    const boneDofs = skel.dofsByBone.get(id);
    if (boneDofs) {
      let extra = Q_EINS;
      for (const d of boneDofs) {
        const wert = dofs[d.key];
        if (wert === undefined || wert === 0) continue;
        const roh = d.vorzeichen * wert * GRAD;
        extra = qMul(extra, qFromAxisAngle(d.achse, roh));
      }
      if (b.parent === null || !out.has(b.parent)) {
        wq = qMul(b.lQuat, extra);
        wp = [...b.lPos];
      } else {
        const p = out.get(b.parent);
        wq = qMul(p.quat, qMul(b.lQuat, extra));
        wp = vAdd(qRot(p.quat, b.lPos), p.pos);
      }
    } else if (b.parent === null || !out.has(b.parent)) {
      wq = b.lQuat; wp = [...b.lPos];
    } else {
      const p = out.get(b.parent);
      wq = qMul(p.quat, b.lQuat);
      wp = vAdd(qRot(p.quat, b.lPos), p.pos);
    }
    // Wurzelbewegung (Verschiebung + Ganzkörperdrehung um den Pivot) wirkt
    // NUR auf die Wurzel des Beckenteilbaums. Die Kinder erben sie über
    // p.pos/p.quat der Kette — wer sie auf jeder Ebene erneut addiert, zieht
    // die Figur auseinander: gemessen 5 cm Wurzelversatz ergaben am Xbot
    // 35 cm am Kopf (Ebene 6) und 30 cm am Zeh (Ebene 5).
    const erbtDelta = b.parent !== null && out.has(b.parent) && skel.unterPelvis.has(b.parent);
    if (delta && skel.unterPelvis.has(id) && !erbtDelta) {
      wq = qMul(dq, wq);
      wp = vAdd(qRot(dq, vSub(wp, pivot)), vAdd(pivot, dpos));
    }
    out.set(id, { pos: wp, quat: wq });
  }
  return out;
}

const GRAD = Math.PI / 180;

// ─────────────────────────────────────────────────────────────────────────────
// Schwerpunkt und Trägheit — aus gemessenen Segmentmassen (plan.md 6.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schwerpunkt aus den Positionen der Segment-Endpunkte: jede Kapselmasse sitzt
 * in ihrer Mitte (dieselbe Definition wie in src/rig/measure.js).
 *
 * @param {object} skel
 * @param {Map}    kn  Ergebnis von poseKnochen
 * @param {Set<string>|null} [nur] nur diese Segmente (Knochen-ids müssen drinstehen)
 * @returns {{com: number[], masse: number, anteile: Map<string, number[]>}}
 */
export function schwerpunkt(skel, kn, nur = null) {
  const com = [0, 0, 0];
  let masse = 0;
  const anteile = new Map();
  for (const s of skel.segments) {
    if (nur && !nur.has(s.id)) continue;
    const a = kn.get(s.from), b = kn.get(s.to);
    if (!a || !b) {
      throw new Error(`Schwerpunkt nicht bildbar: Segment „${s.id}“ verweist auf Knochen „${a ? s.to : s.from}“, der nicht in ${kn.size} übergebenen Knochen liegt`);
    }
    const m = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2];
    anteile.set(s.id, m);
    com[0] += m[0] * s.mass; com[1] += m[1] * s.mass; com[2] += m[2] * s.mass;
    masse += s.mass;
  }
  if (!(masse > 0)) {
    throw new Error(`Schwerpunkt nicht bildbar: Gesamtmasse ${masse} kg über ${anteile.size} Segmente`);
  }
  return { com: vScale(com, 1 / masse), masse, anteile };
}

/**
 * Trägheitsmoment um eine Achse durch einen Punkt, aus den Segmentmassen:
 * I = Σ m·d⊥². Für den Salto: Achse = Wurzelrotationachse durch den
 * Schwerpunkt, pro Frame neu gerechnet (plan.md 6.5).
 */
export function traegheit(skel, kn, achse, punkt) {
  const a = vScale(achse, 1 / (vLen(achse) || 1));
  const { com, anteile } = schwerpunkt(skel, kn);
  void com;
  let i = 0;
  for (const s of skel.segments) {
    const m = anteile.get(s.id);
    const rel = vSub(m, punkt);
    const dPar = vDot(rel, a);
    const dSenk = [rel[0] - a[0] * dPar, rel[1] - a[1] * dPar, rel[2] - a[2] * dPar];
    i += s.mass * (dSenk[0] ** 2 + dSenk[1] ** 2 + dSenk[2] ** 2);
  }
  return i;
}

/**
 * Weltpositionen aller Sohlenpunkte einer Pose — die Kontaktpunkte.
 * Die lokalen Sohlenvektoren aus dem Profil stehen im Knochen-lokalen System;
 * die Weltmatrix des Knochens trägt den Skalierungsfaktor der Szene (Xbot:
 * 0,01 über dem Skelett). Ohne diese Rückrechnung landen Sohlen drei Meter
 * unter dem Boden.
 */
export function sohlenWelt(skel, kn) {
  const out = [];
  for (const s of skel.soles) {
    const b = kn.get(s.bone);
    if (!b) {
      throw new Error(`Sohlenberechnung fehlgeschlagen: Sohle „${s.id}“ an Knochen „${s.bone}“, nicht in ${kn.size} Knochen gefunden`);
    }
    const stab = skel.byId.get(s.bone).weltmassstab ?? 1;
    out.push({ id: s.id, bone: s.bone, pos: vAdd(b.pos, vScale(qRot(b.quat, s.local), stab)) });
  }
  return out;
}

/**
 * Kürzeste Strecke Becken → Boden in Bind-Richtung, je Fuß: die
 * GEMESSENEN Beingang-Längen, als {huefte, oberschenkel, unterschenkel, fuss}
 * — für Reichweiten- und Landebeurteilungen. Alles aus bindWorld, nichts getippt.
 */
export function beingaden(skel, fussKnochenId) {
  const hipId = skel.rollenKnochen.pelvis;
  const footId = fussKnochenId;
  if (!hipId || !footId) {
    throw new Error(`Beingaden nicht ableitbar: Rollen pelvis=${hipId} foot=${footId}`);
  }
  const weg = knochenPfad(skel, footId, hipId);
  const laengen = [];
  for (let i = 0; i + 1 < weg.length; i++) {
    laengen.push({ von: weg[i], nach: weg[i + 1], laenge: vLen(vSub(skel.byId.get(weg[i]).bindWorld, skel.byId.get(weg[i + 1]).bindWorld)) });
  }
  return { wegbild: weg, laengen, gesamt: laengen.reduce((a, l) => a + l.laenge, 0) };
}

/** Knochenpfad Kind → Vorfahr (über parent-Zeiger). */
export function knochenPfad(skel, vonId, nachId) {
  const weg = [vonId];
  let cur = skel.byId.get(vonId);
  let schritte = 0;
  while (cur && cur.id !== nachId && schritte++ < 64) {
    if (cur.parent === null || !skel.byId.has(cur.parent)) break;
    cur = skel.byId.get(cur.parent);
    weg.push(cur.id);
  }
  if (!cur || cur.id !== nachId) {
    throw new Error(`Knochenpfad „${vonId}“ → „${nachId}“ nach ${schritte} Schritten nicht gefunden — keine Vorfahr-Nachfahr-Beziehung`);
  }
  return weg;
}
