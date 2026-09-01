// Eine Animation, zwei Arten sie anzusehen.
//
// Die Timeline bleibt immer unveraendert. Im Editor wird nur die Darstellung
// horizontal auf die Ausgangsposition zurueckgesetzt: Die Figur kann springen,
// drehen und jeden Gelenkweg ausfuehren, reist aber nicht durch den Raum.
// Die Welt bekommt den Originalframe unveraendert.

export const ANSICHT_EDITOR = 'editor';
export const ANSICHT_WELT = 'welt';

function istPunkt(v) {
  return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
}

function verschiebePose(pose, dx, dz) {
  if (!pose || typeof pose !== 'object') return pose;
  const kopie = {};
  for (const [name, knochen] of Object.entries(pose)) {
    if (!knochen || !istPunkt(knochen.position)) {
      kopie[name] = knochen;
      continue;
    }
    kopie[name] = {
      ...knochen,
      position: [knochen.position[0] + dx, knochen.position[1], knochen.position[2] + dz],
    };
  }
  return kopie;
}

/**
 * Liefert eine reine Darstellungs-Kopie eines Frames fuer den Editor.
 * X/Z aller Knochen liegen relativ zum ersten Root-Frame wieder am Ursprung;
 * Y, Rotation, Gelenke und die Originaltimeline bleiben unveraendert.
 */
export function editorFrame(frame, startFrame) {
  const start = startFrame?.root?.pos;
  const aktuell = frame?.root?.pos;
  if (!istPunkt(start) || !istPunkt(aktuell)) return frame;

  const dx = start[0] - aktuell[0];
  const dz = start[2] - aktuell[2];
  const editor = {
    ...frame,
    root: { ...frame.root, pos: [start[0], aktuell[1], start[2]] },
  };
  if (frame.bones) editor.bones = verschiebePose(frame.bones, dx, dz);
  if (frame.pose) editor.pose = verschiebePose(frame.pose, dx, dz);
  return editor;
}

export function frameFuerAnsicht(ansicht, frame, startFrame) {
  return ansicht === ANSICHT_EDITOR ? editorFrame(frame, startFrame) : frame;
}

/** Hängt die zentrale Editor/Welt-Insel in die Kopfzeile. */
export function mounteAnsichtsumschalter({ wurzel, beimWechsel, initial = ANSICHT_EDITOR }) {
  if (!wurzel || !wurzel.ownerDocument) {
    throw new Error('mounteAnsichtsumschalter: 0 Container übergeben, erwartet 1 Kopfzeilen-Element');
  }
  if (typeof beimWechsel !== 'function') {
    throw new Error('mounteAnsichtsumschalter: beimWechsel ist keine Funktion');
  }
  const dok = wurzel.ownerDocument;
  const insel = dok.createElement('div');
  insel.className = 'ansicht-insel';
  insel.setAttribute('role', 'group');
  insel.setAttribute('aria-label', 'Ansicht');
  const knoepfe = new Map();

  // Die Insel besitzt KEINEN Modus. Sie zeichnet ausschließlich den Zustand,
  // den die Bühne hält. Zwei getrennte Wahrheiten führten zu widersprüchlichen
  // Screenshots: Welt gerendert, aber Editor noch hervorgehoben.
  function zeige(neu) {
    const ansicht = neu === ANSICHT_WELT ? ANSICHT_WELT : ANSICHT_EDITOR;
    for (const [wert, knopf] of knoepfe) {
      const aktiv = wert === ansicht;
      knopf.classList.toggle('aktiv', aktiv);
      knopf.setAttribute('aria-pressed', String(aktiv));
    }
    return ansicht;
  }

  for (const [wert, titel] of [[ANSICHT_EDITOR, 'Editor'], [ANSICHT_WELT, 'Welt']]) {
    const knopf = dok.createElement('button');
    knopf.type = 'button';
    knopf.className = 'ansicht-knopf';
    knopf.textContent = titel;
    knopf.addEventListener('click', () => beimWechsel(wert));
    knoepfe.set(wert, knopf);
    insel.append(knopf);
  }
  wurzel.replaceChildren(insel);
  zeige(initial);

  return { zeige };
}
