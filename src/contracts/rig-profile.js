// Pruefer fuer den RigProfile-Vertrag, docs/plan.md 5.1.
//
// Auslegung der Verfahrensparameter (AGENTS.md, Regel 1): Diese Schranken sind
// KEINE Koerpermasse und werden nicht aus einem Modell geraten. Sie begrenzen nur,
// welche Modelle als solide Vermessung gelten:
//   world.height < 10 Meter — der groesste plausible Humanoid; laesst keine
//     offensichtlich falsch skalierten Uploads durch (Hoehe in Millimetern oder
//     Lichtjahren), schliesst aber kein reales Modell aus.
//   world.height > 0 — eine Figur ohne Hoehe ist nicht vermessen.

import { istZahl, istInt, fehler, ergebnis } from './validate.js';

/** Pflichtrollen; Fehlt eine, wird das Modell abgelehnt statt geraten (plan.md 5.1) */
const PFLICHTROLLEN = ['pelvis', 'foot_l', 'foot_r'];

const ACHSEN = ['x', 'y', 'z'];
const SIGN_QUELLEN = ['gemessen', 'nicht_messbar'];
const LIMIT_QUELLEN = ['anatomisch', 'gemessen'];

function pruefeBindWorld(errors, field, v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(istZahl)) {
    fehler(errors, field, v, 'Array mit genau 3 endlichen Zahlen [x,y,z]');
  }
}

function pruefeRolle(errors, field, v, boneIds, name) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    fehler(errors, field, v, 'Objekt {bone, confidence}');
    return;
  }
  if (typeof v.bone !== 'string' || v.bone === '') {
    fehler(errors, `${field}.bone`, v.bone, 'nicht-leerer String (Knochen-id)');
  } else if (!boneIds.has(v.bone)) {
    fehler(errors, `${field}.bone`, v.bone,
      `existierender Knochen; vorhandene ids: ${boneIds.size} Stueck, u. a. ${[...boneIds].slice(0, 3).join(', ')}`);
  }
  if (!istZahl(v.confidence) || v.confidence < 0 || v.confidence > 1) {
    fehler(errors, `${field}.confidence`, v.confidence, 'Zahl in [0, 1]');
  }
}

/**
 * validateRigProfile(obj) -> { ok, errors: [{field, message}] }
 * Jede Meldung nennt den Feldpfad, den Ist-Wert und den erwarteten Wertebereich.
 */
export function validateRigProfile(obj) {
  const errors = [];

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fehler(errors, '$', obj, 'Objekt RigProfile');
    return ergebnis(errors);
  }

  // schemaVersion
  if (obj.schemaVersion !== 1) {
    fehler(errors, 'schemaVersion', obj.schemaVersion, 'genau 1');
  }

  // source
  const src = obj.source;
  if (src === null || typeof src !== 'object' || Array.isArray(src)) {
    fehler(errors, 'source', src, 'Objekt {file, boneCount, vertexCount}');
  } else {
    if (typeof src.file !== 'string' || src.file === '') {
      fehler(errors, 'source.file', src.file, 'nicht-leerer String (Dateiname)');
    }
    if (!istInt(src.boneCount) || src.boneCount < 0) {
      fehler(errors, 'source.boneCount', src.boneCount, 'ganzzahlig >= 0');
    }
    if (!istInt(src.vertexCount) || src.vertexCount < 0) {
      fehler(errors, 'source.vertexCount', src.vertexCount, 'ganzzahlig >= 0');
    }
  }

  // world
  const world = obj.world;
  if (world === null || typeof world !== 'object' || Array.isArray(world)) {
    fehler(errors, 'world', world, 'Objekt {up, forward, left, groundY, height, unitsPerMeter}');
  } else {
    for (const k of ['up', 'forward', 'left']) {
      if (typeof world[k] !== 'string' || world[k] === '') {
        fehler(errors, `world.${k}`, world[k], 'nicht-leerer String (Achsenname)');
      }
    }
    if (!istZahl(world.groundY)) {
      fehler(errors, 'world.groundY', world.groundY, 'Zahl (Hoehe der Bodenebene in Modelleinheiten)');
    }
    if (!istZahl(world.height) || world.height <= 0 || world.height >= 10) {
      fehler(errors, 'world.height', world.height,
        'Zahl > 0 und < 10 (Meter, Bind-Pose; Verfahrensparameter, siehe Dateikopf)');
    }
    if (!istZahl(world.unitsPerMeter) || world.unitsPerMeter <= 0) {
      fehler(errors, 'world.unitsPerMeter', world.unitsPerMeter, 'Zahl > 0');
    }
  }

  // bones
  const bones = obj.bones;
  if (!Array.isArray(bones)) {
    fehler(errors, 'bones', bones, 'Array von {id, parent, bindWorld}');
  } else {
    const boneIds = new Set(bones.map((b) => (b && typeof b.id === 'string') ? b.id : null));
    bones.forEach((b, i) => {
      const field = `bones.${i}`;
      if (b === null || typeof b !== 'object' || Array.isArray(b)) {
        fehler(errors, field, b, 'Objekt {id, parent, bindWorld}');
        return;
      }
      if (typeof b.id !== 'string' || b.id === '') {
        fehler(errors, `${field}.id`, b.id, 'nicht-leerer String');
      }
      if (b.parent !== null && (typeof b.parent !== 'string' || b.parent === '')) {
        fehler(errors, `${field}.parent`, b.parent, 'nicht-leerer String oder null (Wurzel)');
      } else if (typeof b.parent === 'string' && !boneIds.has(b.parent)) {
        fehler(errors, `${field}.parent`, b.parent,
          `existierender Knochen; alle ${boneIds.size} gelisteten ids geprueft, kein Treffer`);
      }
      pruefeBindWorld(errors, `${field}.bindWorld`, b.bindWorld);
    });
  }

  // roles — braucht die bone-ids; deshalb hier nochmal lokal gesammelt
  let boneIds = null;
  if (Array.isArray(bones)) {
    boneIds = new Set(bones.map((b) => (b && typeof b.id === 'string') ? b.id : null));
  }
  const roles = obj.roles;
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) {
    fehler(errors, 'roles', roles, `Objekt; Pflichtrollen: ${PFLICHTROLLEN.join(', ')}`);
  } else {
    for (const name of PFLICHTROLLEN) {
      if (!(name in roles)) {
        errors.push({
          field: `roles.${name}`,
          message: `roles.${name} fehlt: Modell wird abgelehnt statt geraten (plan.md 5.1)`
        });
      }
    }
    for (const [name, v] of Object.entries(roles)) {
      pruefeRolle(errors, `roles.${name}`, v, boneIds ?? new Set(), name);
    }
  }

  // joints
  const joints = obj.joints;
  if (joints === null || typeof joints !== 'object' || Array.isArray(joints)) {
    fehler(errors, 'joints', joints, 'Objekt {name: {bone, dof, signSource}}');
  } else {
    if (!boneIds) boneIds = new Set();
    for (const [name, j] of Object.entries(joints)) {
      const field = `joints.${name}`;
      if (j === null || typeof j !== 'object' || Array.isArray(j)) {
        fehler(errors, field, j, 'Objekt {bone, dof, signSource}');
        continue;
      }
      if (typeof j.bone !== 'string' || j.bone === '') {
        fehler(errors, `${field}.bone`, j.bone, 'nicht-leerer String (Knochen-id)');
      } else if (!boneIds.has(j.bone)) {
        fehler(errors, `${field}.bone`, j.bone, 'existierender Knochen aus bones[].id');
      }
      if (j.dof === null || typeof j.dof !== 'object' || Array.isArray(j.dof)) {
        fehler(errors, `${field}.dof`, j.dof, 'Objekt {freiheitsgrad: {axis, sign, limit}}');
      } else {
        for (const [fg, d] of Object.entries(j.dof)) {
          const f = `${field}.dof.${fg}`;
          if (d === null || typeof d !== 'object' || Array.isArray(d)) {
            fehler(errors, f, d, 'Objekt {axis, sign, limit}');
            continue;
          }
          if (!ACHSEN.includes(d.axis)) {
            fehler(errors, `${f}.axis`, d.axis, `einer von ${JSON.stringify(ACHSEN)}`);
          }
          if (!istZahl(d.sign) || d.sign < -1 || d.sign > 1) {
            fehler(errors, `${f}.sign`, d.sign, 'Zahl in [-1, 1]');
          }
          if (!Array.isArray(d.limit) || d.limit.length !== 2
              || !istZahl(d.limit[0]) || !istZahl(d.limit[1]) || d.limit[0] >= d.limit[1]) {
            fehler(errors, `${f}.limit`, d.limit, 'Paar [min, max] mit min < max');
          }
          // Die Herkunft der Grenze steht pro Kanal UND pro Richtung. Ein
          // Kanal kann unten anatomisch und oben gemessen sein — am Xbot
          // arm.swing: nach hinten stoppt keine Selbstberührung, nach vorn
          // der Rumpf. Eine Herkunft je Gelenk verschwiege das.
          const q = d.limitSource;
          if (q === null || typeof q !== 'object' || Array.isArray(q)
              || !LIMIT_QUELLEN.includes(q.min) || !LIMIT_QUELLEN.includes(q.max)) {
            fehler(errors, `${f}.limitSource`, q,
              `Objekt {min, max} mit je einem von ${JSON.stringify(LIMIT_QUELLEN)}`);
          }
        }
      }
      if (!SIGN_QUELLEN.includes(j.signSource)) {
        fehler(errors, `${field}.signSource`, j.signSource,
          `einer von ${JSON.stringify(SIGN_QUELLEN)}`);
      }
    }
  }

  // segments
  if (!Array.isArray(obj.segments)) {
    fehler(errors, 'segments', obj.segments, 'Array von {id, from, to, radius, mass, volume}');
  } else {
    obj.segments.forEach((s, i) => {
      const field = `segments.${i}`;
      if (s === null || typeof s !== 'object' || Array.isArray(s)) {
        fehler(errors, field, s, 'Objekt {id, from, to, radius, mass, volume}');
        return;
      }
      for (const k of ['id', 'from', 'to']) {
        if (typeof s[k] !== 'string' || s[k] === '') {
          fehler(errors, `${field}.${k}`, s[k], 'nicht-leerer String');
        }
      }
      for (const k of ['radius', 'mass', 'volume']) {
        if (!istZahl(s[k]) || s[k] <= 0) {
          fehler(errors, `${field}.${k}`, s[k], 'Zahl > 0');
        }
      }
    });
  }

  // soles
  if (!Array.isArray(obj.soles)) {
    fehler(errors, 'soles', obj.soles, 'Array von {id, bone, local}');
  } else {
    const boneIds2 = boneIds ?? new Set();
    obj.soles.forEach((s, i) => {
      const field = `soles.${i}`;
      if (s === null || typeof s !== 'object' || Array.isArray(s)) {
        fehler(errors, field, s, 'Objekt {id, bone, local}');
        return;
      }
      if (typeof s.id !== 'string' || s.id === '') {
        fehler(errors, `${field}.id`, s.id, 'nicht-leerer String');
      }
      if (typeof s.bone !== 'string' || s.bone === '') {
        fehler(errors, `${field}.bone`, s.bone, 'nicht-leerer String (Knochen-id)');
      } else if (!boneIds2.has(s.bone)) {
        fehler(errors, `${field}.bone`, s.bone, 'existierender Knochen aus bones[].id');
      }
      pruefeBindWorld(errors, `${field}.local`, s.local);
    });
  }

  // restDistances — Schluessel 'a|b', Werte: endliche Zahlen in Metern.
  //
  // Die Paarzahl ist NICHT begrenzt: der Vertrag zaehlt keine Eintraege, und
  // es waere falsch, das zu tun. Am Xbot sind es 105 Paare aus 15 Segmenten,
  // einschließlich der Gelenkpaare; ein Rig mit mehr Segmenten hat mehr.
  //
  // Negative Werte sind zulaessig und gewollt: der Eintrag ist der
  // OBERFLAECHENabstand der beiden Kapseln in der Bind-Pose, und der ist
  // negativ, wo sich die Kapseln schon dort ueberschneiden (Xbot:
  // torso_lower|thigh_r bei -0,16 m, weil die Radien das 90. Perzentil der
  // Huellpunkte sind). Frueher stand hier "Zahl >= 0" und measure.js schnitt
  // bei 0 ab — damit war die Modellueberdeckung verschwiegen, die die
  // Durchdringungspruefung als Untergrenze braucht.
  const rd = obj.restDistances;
  if (rd === null || typeof rd !== 'object' || Array.isArray(rd)) {
    fehler(errors, 'restDistances', rd,
      'Objekt mit Schluesseln der Form "a|b" und endlichen Zahlen (Meter, Bind-Pose, negativ erlaubt)');
  } else {
    for (const [key, v] of Object.entries(rd)) {
      if (!key.includes('|')) {
        fehler(errors, `restDistances["${key}"]`, key, 'Schluessel der Form "segmentA|segmentB"');
      }
      if (!istZahl(v)) {
        fehler(errors, `restDistances["${key}"]`, v,
          'endliche Zahl in Metern (Oberflaechenabstand der Bind-Pose, negativ = Kapseln ueberschneiden sich)');
      }
    }
  }

  // params
  const p = obj.params;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    fehler(errors, 'params', p, 'Objekt {radiusPercentile, soleTolerance, contactMargin}');
  } else {
    if (!istZahl(p.radiusPercentile) || p.radiusPercentile <= 0 || p.radiusPercentile >= 1) {
      fehler(errors, 'params.radiusPercentile', p.radiusPercentile,
        'Zahl in (0, 1) — 0,90 laut plan.md Kapitel 4');
    }
    if (!istZahl(p.soleTolerance) || p.soleTolerance <= 0 || p.soleTolerance >= 0.1) {
      fehler(errors, 'params.soleTolerance', p.soleTolerance,
        'Zahl in (0, 0.1) — Anteil der Koerperhoehe, 0,035 laut plan.md Kapitel 4');
    }
    if (!istZahl(p.contactMargin) || p.contactMargin < 0) {
      fehler(errors, 'params.contactMargin', p.contactMargin, 'Zahl >= 0 (Meter)');
    }
  }

  // warnings
  if (!Array.isArray(obj.warnings) || !obj.warnings.every((w) => typeof w === 'string')) {
    fehler(errors, 'warnings', obj.warnings, 'Array von Strings');
  }

  return ergebnis(errors);
}
