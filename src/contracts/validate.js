// Gemeinsame Helfer fuer alle Vertragspruefer in diesem Verzeichnis.
// Form der Rueckgabe (ueberall gleich): { ok: boolean, errors: [{field, message}] }

/** Zahl? (keine NaN, kein Infinity) */
export function istZahl(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Ganzzahl? (keine NaN) */
export function istInt(v) {
  return Number.isInteger(v);
}

export function ns(v) {
  return JSON.stringify(v);
}

/**
 * Fehlermeldung in der Projektform: Pfad, Ist-Wert, erwarteter Wertebereich.
 * Beispiele: "world.height = -1: erwartet Zahl > 0 und < 10 (Meter, Bind-Pose)"
 */
export function fehler(errors, field, actual, erwartet) {
  errors.push({
    field,
    message: `${field} = ${ns(actual)}: erwartet ${erwartet}`
  });
}

export function ergebnis(errors) {
  return { ok: errors.length === 0, errors };
}