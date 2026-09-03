// AP2 — Rig-Vermessung. Misst aus einem geladenen glTF/GLB-Modell ein RigProfile
// im Format aus docs/journal/plan.md Abschnitt 5.1.
//
// Grundregel (AGENTS.md, Regel 1): Körpermaße werden GEMESSEN, nie getippt.
// Radien, Massen, Kontaktpunkte, Gelenkachsen, Blickrichtung — alles aus der
// Bind-Pose des geladenen Modells. Die einzigen getippten Zahlen sind
// Verfahrensparameter; sie stehen als BENANNTE PARAMETER an EINER Stelle unten,
// mit Begründung, und werden im RigProfile unter "params" ausgegeben.
//
// Import (Grundsatz aus vendor/README.md): three.js und der GLTFLoader kommen
// aus node_modules (npm r180) — derselbe Build wie vendor/. Der Alias
// 'three/addons/loaders/GLTFLoader.js' liefert dieselbe Datei wie
// vendor/GLTFLoader.js; fällt der Alias weg, ist die Datei zusätzlich im Repo
// unter vendor/GLTFLoader.js && vendor/ abgelegt.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Rollen kommen aus der Erkennung (AP3), nicht aus Knochennamen. detect.js
// vergibt sie namensunabhängig über Geometrie und Skeletttopologie; diese Datei
// liest davon nur das Ergebnis und misst. Ein Namensschema wäre keine Messung
// (AGENTS.md, Regel 1) — vor dieser Kopplung lief die Vermessung ausschließlich
// auf Rigs mit Mixamo-Benennung.
import { detectRig, PARAMS as ERKENNUNG } from './detect.js';
import { dreieckSchnitt, Kollisionsgitter } from './kollision.js';

// ─────────────────────────────────────────────────────────────────────────────
// BENANNTE PARAMETER (Verfahrensparameter, keine Körpermaße)
// plan.md Kapitel 4: alle Verfahrensparameter stehen an EINER Stelle, mit
// Begründung, und werden im RigProfile unter "params" ausgegeben.
// ─────────────────────────────────────────────────────────────────────────────

/** Radiusperzentil. plan.md: 0,80 unterschätzt die Körperbreite, 1,00 fängt Ausreißer. */
export const RADIUS_PERCENTILE = 0.90;

/** Sohlentoleranz als Anteil der Körperhöhe. plan.md: muss Modelle erfassen,
 *  die auf dem Ballen stehen. */
export const SOLE_TOLERANCE = 0.035;

/** Kontaktzuschlag in Metern über dem höchsten Sohlenpunkt. plan.md Kapitel 4. */
export const CONTACT_MARGIN = 0.015;

/** Abtastwinkel in Grad für die Vorzeichenmessung (plan.md 3.5): groß genug
 *  für messbare Wirkung am Kettenende, klein genug ohne Überschlag. */
export const PROBE_DEG = 20;

/** Ab diesem Skin-Gewicht traegt ein Knochen ueberhaupt Haut.
 *
 *  Getrennt von MIN_DOMINANT_WEIGHT: dort geht es um die Frage, WELCHEM
 *  Segment ein Vertex gehoert; hier nur darum, OB an einem Knochen
 *  ueberhaupt Geometrie haengt.
 *
 *  Warum das gebraucht wird: Mixamo-Rigs fuehren Hilfsknochen ohne jede
 *  Haut — beide Toe_End, HeadTop_End, die Augen und alle zehn
 *  Fingerspitzen (…4). Gemessen am Xbot: 15 Knochen mit 0 gewichteten
 *  Vertices. Die Bodenpruefung lief ueber ALLE Knochenpositionen und
 *  meldete deshalb Toe_End als „im Boden steckend" — an einem Punkt, an
 *  dem kein einziges Dreieck haengt.
 *
 *  Der Betrag ist unkritisch: gemessen liegt jedes echte Gewicht ueber
 *  0,01, jeder Hilfsknochen exakt bei 0. */
export const MIN_HAUT_GEWICHT = 0.001;

/** Minimal-Skin-Gewicht, ab dem ein Vertex seinem dominanten Knochen zugerechnet
 *  wird. 0,5 heißt: mehr als die Hälfte der Hautwirkung liegt bei diesem Knochen. */
export const MIN_DOMINANT_WEIGHT = 0.5;

/** Konstante Dichte für die Masse aus dem Kapselvolumen. Das Volumen wird
 *  gemessen; die Dichte ist am Modell nicht messbar und wird offen benannt.
 * Massen sind in erster Linie relative Anteile; kg sind die Wunscheinheit. */
export const DENSITY_KG_PER_M3 = 1000;

/** Maximale Abweichung eines gemessenen Radius zur Mesh-Hülle, Anteil der
 *  Körperhöhe. Abnahmekriterium AP2 „Radien“: Abweichung unter 15 %. */
export const RADIUS_DEVIATION_MAX = 0.15;

/** Mindestanteil der Fußlänge, den die erkannte Sohlenfläche abdecken muss.
 *  Abnahmekriterium AP2 „Sohlen“: mindestens 60 %. */
export const SOLE_COVERAGE_MIN = 0.60;

/** Mindestwirkung am Kettenende als Anteil der Körperhöhe, ab der eine
 *  Abtastung als „messbar“ gilt. Darunter gilt der Freiheitsgrad als
 *  nicht_messbar (plan.md 6.1) — nicht stillschweigend als gemessen. */
export const DEAD_MOVE_FRACTION = 0.01;

/** Mindestlänge einer Sohle als Anteil der Fußlänge; darunter ist die
 *  erkannte „Sohle“ zu klein, um als Fußkontaktfläche zu gelten. */
export const SOLE_LENGTH_MIN = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// Semantische Segmente und Segmentzuordnung
// ─────────────────────────────────────────────────────────────────────────────

/** Segmentliste in ROLLEN, von → bis. Die Rollen vergibt die Erkennung
 *  (detect.js ROLLEN); die Kettenenden („ende_…“) sind keine Rollen, sondern
 *  werden topologisch aus der Rolle abgeleitet — siehe kettenEnde().
 *  Reihenfolge = Reihenfolge im Profil. */
export const SEGMENTS = [
  { id: 'torso_lower', from: 'pelvis',   to: 'spine'        },
  { id: 'torso_upper', from: 'spine',    to: 'neck'         },
  { id: 'head',       from: 'neck',      to: 'ende_kopf'    },
  { id: 'upperarm_l', from: 'arm_l',     to: 'forearm_l'    },
  { id: 'forearm_l',  from: 'forearm_l', to: 'hand_l'       },
  { id: 'hand_l',     from: 'hand_l',    to: 'ende_hand_l'  },
  { id: 'upperarm_r', from: 'arm_r',     to: 'forearm_r'    },
  { id: 'forearm_r',  from: 'forearm_r', to: 'hand_r'       },
  { id: 'hand_r',     from: 'hand_r',    to: 'ende_hand_r'  },
  { id: 'thigh_l',    from: 'thigh_l',   to: 'shin_l'       },
  { id: 'shin_l',     from: 'shin_l',    to: 'foot_l'       },
  { id: 'foot_l',     from: 'foot_l',    to: 'ende_fuss_l'  },
  { id: 'thigh_r',    from: 'thigh_r',   to: 'shin_r'       },
  { id: 'shin_r',     from: 'shin_r',    to: 'foot_r'       },
  { id: 'foot_r',     from: 'foot_r',    to: 'ende_fuss_r'  },
];

/** Kettenenden, die kein semantisches Gelenk sind (Scheitel, Fingerspitze,
 *  Zehenspitze). Sie dienen als Messpunkt am Ende einer Kette und werden vom
 *  ersten verfügbaren Startpunkt der Liste aus abgestiegen. */
const KETTENENDEN = [
  { id: 'ende_kopf',   ab: ['head', 'neck', 'chest', 'spine'] },
  { id: 'ende_hand_l', ab: ['hand_l', 'forearm_l', 'arm_l'] },
  { id: 'ende_hand_r', ab: ['hand_r', 'forearm_r', 'arm_r'] },
  { id: 'ende_fuss_l', ab: ['toe_l', 'foot_l'] },
  { id: 'ende_fuss_r', ab: ['toe_r', 'foot_r'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Gelenk-Katalog: benannte Freiheitsgrade mit semantischer Richtung.
//   bone  : ROLLE des Gelenkknochens, end: Rolle oder Kettenende. Welcher
//           Knochen das ist, sagt die Erkennung — hier steht kein Name.
//   axis  : Achse der Gelenkrotation im Knochen-lokalen Bezugssystem der
//           Bind-Pose (x nach Charakter-links, y hoch, z vorn — am Modell
//           gemessen; die Abtastung dreht die lokale Achse in die anliegende
//           Bind-Pose-Orientierung des Knochens, siehe worldAxis unten).
//   moves : Weltachse, auf der die Wirkung am Kettenende auftritt. Sie ist
//           IMMER eine andere als axis: eine Drehung um eine Achse bewegt
//           Punkte parallel zu dieser Achse nicht. Der Name des
//           Freiheitsgrads (flex, lift, spread …) zusammen mit dem
//           Weltvertrag (plan.md 5.5: oben +y, Charakter-vorne +z, links +x)
//           legt beide fest.
//   want  : +1/-1 — ob ein positiver Wert des Freiheitsgrads das Kettenende
//           in Richtung +moves (oder -moves) bewegen soll. Vereinbarung,
//           keine Messung.
//   mirror: Erwartung bezieht sich auf eine nach links/rechts zeigende
//           Richtung; die rechte Seite dreht die Erwartung um (Spiegelung).
//   limit : anatomische Standardgrenzen in Grad [min, max], gültig für den
//           NORMALISIERTEN Wert des Freiheitsgrads — denselben, den der Agent
//           setzt. Sie gelten auf BEIDEN Seiten identisch (arm_l.lift und
//           arm_r.lift haben dasselbe [min, max]); die links/rechts-Spiegelung
//           sitzt allein im gemessenen Vorzeichen. Vor der Normierung waren die
//           Grenzen ins Rohtags-Vorzeichen gespiegelt (arm_r [-170, 40]): ein
//           Agent, der beide Arme mit +80 hebt, wurde rechts auf 40 geklemmt,
//           weil der Klemmvergleich (handlers.js set_joint/set_pose, ik.js
//           an_grenze) den Agenten-Wert gegen diese Rohtags-Grenzen rechnet.
//   richtung : ein Satz Alltagssprache, was ein POSITIVER Wert tut. Fester
//           Bestandteil jedes dof-Datensatzes; kommt über describe_rig beim
//           Agenten an. Zusammen mit den ungespiegelten Grenzen beseitigt er
//           die Raterei, in welche Richtung ein Winkel wirkt.
//   twist : Rotation um die eigene Kettenachse. Erzeugt am Kettenende keine
//           messbare Bewegung (plan.md 3.5) → signSource 'nicht_messbar'.
//   limit : anatomische Standardgrenzen in Grad [min, max]; limitSource bleibt
//           "anatomisch", aus der Bind-Pose nicht ableitbar (plan.md 6.1).
//
// Achsenkorrektur (Beleg: src/rig/measure.test.mjs, Reihe „Vorzeichen“):
// Die Abtastung maß die Bewegung entlang ACHSE statt entlang MOVES. Das kann
// keine Wirkung zeigen — gedreht wird um diese Achse, also ist die Verschiebung
// parallel zu ihr strukturell 0. Von 30 Freiheitsgraden galten 0 als messbar,
// bei Bewegungen bis 0,3440 m am Zehenende und einer Nachweisgrenze von
// 0,0181 m. Nach der Korrektur liest die Abtastung die Wirkung in benannter
// Richtung; Drehachsen, die dazu nicht passten, sind nachgemessen und umgesetzt:
// Hüftbeugung — Drehung um z bewegt den Zeh um 0,0000 m in z (gar nichts) und
// um 0,3336 m in x (das ist Spreizen); Drehung um x bewegt ihn um 0,3440 m in z.
// Beugung ist also eine Drehung um x, wie plan.md 5.1 für hip_l.flex nennt.
// ─────────────────────────────────────────────────────────────────────────────

/** Der Gelenkkatalog, auch fuer die Werkzeugschicht: handlers.js baut daraus
 *  die Zuordnung Setz-Name -> Messname in der measure-Fehlermeldung (Befund
 *  2.1, Buehnenlauf 2. September 2026 — hip_l heisst beim Messen thigh_l). */
export const JOINT_CATALOG = [
  { joint: 'pelvis',     bone: 'pelvis',    end: 'ende_kopf', dofs: {
      tilt:  { axis: 'x', moves: 'z', want: +1, mirror: true,  limit: [-40, 40],
               richtung: 'tilt: + neigt das Becken nach vorn, - nach hinten' },
      roll:  { axis: 'z', moves: 'x', want: +1, mirror: false, limit: [-30, 30],
               richtung: 'roll: + kippt das Becken nach links, - nach rechts' },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-90, 90], twist: true,
               richtung: 'turn: + dreht das Becken nach links, - nach rechts' } } },
  { joint: 'spine',      bone: 'spine',     end: 'ende_kopf', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-25, 35],
               richtung: 'bend: + krümmt die Wirbelsäule nach vorn, - streckt sie nach hinten' },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25],
               richtung: 'side: + beugt die Wirbelsäule nach links, - nach rechts' },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-25, 25], twist: true,
               richtung: 'turn: + dreht Oberkörper und Kopf nach links, - nach rechts' } } },
  { joint: 'neck',       bone: 'neck',      end: 'ende_kopf', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-40, 40],
               richtung: 'bend: + neigt den Kopf nach vorn, - nach hinten' },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 30],
               richtung: 'side: + neigt den Kopf zur linken Schulter, - zur rechten' },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true,
               richtung: 'turn: + dreht den Kopf nach links, - nach rechts' } } },
  { joint: 'head',       bone: 'head',      end: 'ende_kopf', dofs: {
      bend:  { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-35, 30],
               richtung: 'bend: + neigt den Kopf nach vorn, - nach hinten' },
      side:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 30],
               richtung: 'side: + neigt den Kopf nach links, - nach rechts' },
      turn:  { axis: 'y', want: +1, mirror: false, limit: [-45, 45], twist: true,
               richtung: 'turn: + dreht den Kopf nach links, - nach rechts' } } },
  { joint: 'shoulder_l', bone: 'shoulder_l', end: 'ende_hand_l', dofs: {
      shrug: { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-20, 25],
               richtung: 'shrug: + hebt die linke Schulter nach oben, - senkt sie' },
      fwd:   { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-25, 25],
               richtung: 'fwd: + schiebt die linke Schulter nach vorn, - nach hinten' } } },
  { joint: 'shoulder_r', bone: 'shoulder_r', end: 'ende_hand_r', dofs: {
      shrug: { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-20, 25],
               richtung: 'shrug: + hebt die rechte Schulter nach oben, - senkt sie' },
      fwd:   { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-25, 25],
               richtung: 'fwd: + schiebt die rechte Schulter nach vorn, - nach hinten' } } },
  // Bezugspunkt ist die Bind-Pose, und die ist eine T-Pose: lift 0 heisst Arm
  // WAAGERECHT. Arme am Koerper sind -90, senkrecht nach oben +90.
  //
  // Die Grenzen standen auf [-40, 170] und waren an beiden Enden falsch. Unten:
  // bei -40 stehen die Arme noch 50 Grad abgespreizt — die Figur konnte sie in
  // KEINER Pose herunternehmen. Oben: 170 sind 80 Grad hinter die Senkrechte,
  // dort klappt der Arm nach hinten weg. Im Agentenlauf gemessen: der Agent
  // fuhr auf lift 142 und bekam genau das.
  { joint: 'arm_l',      bone: 'arm_l',     end: 'ende_hand_l', dofs: {
      lift:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-95, 100],
               richtung: 'lift: + hebt den linken Arm nach oben, - senkt ihn. '
                 + '0 = waagerecht (wie in der T-Pose), -90 = am Körper, +90 = senkrecht nach oben' },
      swing: { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-130, 90],
               richtung: 'swing: + schwingt den linken Arm nach vorn, - nach hinten' },
      twist: { axis: 'x', want: +1, mirror: false, limit: [-90, 90], twist: true,
               richtung: 'twist: + dreht die Handflaeche am haengenden linken Arm nach HINTEN, - nach VORN; am vorgestreckten Arm '
                 + '+ nach UNTEN, - nach OBEN. Die Hand dreht mit dem Arm, ein eigenes Handgelenk gibt es nicht. GEMESSEN am Xbot, '
                 + 'gleiches Vorzeichen auf beiden Seiten. OHNE twist liegt die Handflaeche am haengenden Arm (lift -80) schon am '
                 + 'Koerper und zeigt am vorgestreckten Arm (swing +80) nach innen - das ist die natuerliche Stellung. Nimm twist nur, '
                 + 'wenn die Handflaeche bewusst woandershin soll.' } } },
  { joint: 'arm_r',      bone: 'arm_r',     end: 'ende_hand_r', dofs: {
      lift:  { axis: 'z', moves: 'y', want: +1, mirror: false, limit: [-95, 100],
               richtung: 'lift: + hebt den rechten Arm nach oben, - senkt ihn. '
                 + '0 = waagerecht (wie in der T-Pose), -90 = am Körper, +90 = senkrecht nach oben' },
      swing: { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [-130, 90],
               richtung: 'swing: + schwingt den rechten Arm nach vorn, - nach hinten' },
      twist: { axis: 'x', want: +1, mirror: false, limit: [-90, 90], twist: true,
               richtung: 'twist: + dreht die Handflaeche am haengenden rechten Arm nach HINTEN, - nach VORN; am vorgestreckten Arm '
                 + '+ nach UNTEN, - nach OBEN. Die Hand dreht mit dem Arm, ein eigenes Handgelenk gibt es nicht. GEMESSEN am Xbot, '
                 + 'gleiches Vorzeichen auf beiden Seiten. OHNE twist liegt die Handflaeche am haengenden Arm (lift -80) schon am '
                 + 'Koerper und zeigt am vorgestreckten Arm (swing +80) nach innen - das ist die natuerliche Stellung. Nimm twist nur, '
                 + 'wenn die Handflaeche bewusst woandershin soll.' } } },
  { joint: 'elbow_l',    bone: 'forearm_l', end: 'ende_hand_l', dofs: {
      // ACHSE GEMESSEN, nicht katalogisiert. Am Xbot durchprobiert: die alte
      // Achse 'z' bewegte die Hand bei bend=+60 um 24,5 cm nach OBEN und 0,0 cm
      // nach vorn - der Arm knickte in der Frontalebene, seitlich weg vom Koerper.
      // Ein menschlicher Ellbogen fuehrt die Hand nach VORN zur Schulter. Nur die
      // Achse 'y' tut das (24,5 cm vorn, Hand-Schulter 0,562 -> 0,486 m); 'x' ist
      // die Armachse und wirkungslos. Das Vorzeichen ist seitenverschieden.
      bend:  { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [0, 150],
               richtung: 'bend: + beugt den linken Ellbogen, die Hand kommt nach VORN zur Schulter. 0 ist der gestreckte Arm und die Untergrenze - ein Ellbogen laesst sich nicht ueberstrecken.' },
      twist: { axis: 'x', want: +1, mirror: false, limit: [-90, 90], twist: true,
               richtung: 'twist: + dreht die Handflaeche des linken Unterarms nach UNTEN (Pronation), - nach OBEN (Supination). '
                 + 'GEMESSEN am Xbot bei gebeugtem Ellbogen; ohne twist zeigt sie nach innen. Die Hand dreht mit, ein Handgelenk gibt es nicht.' } } },
  { joint: 'elbow_r',    bone: 'forearm_r', end: 'ende_hand_r', dofs: {
      // ACHSE GEMESSEN, nicht katalogisiert. Am Xbot durchprobiert: die alte
      // Achse 'z' bewegte die Hand bei bend=+60 um 24,5 cm nach OBEN und 0,0 cm
      // nach vorn - der Arm knickte in der Frontalebene, seitlich weg vom Koerper.
      // Ein menschlicher Ellbogen fuehrt die Hand nach VORN zur Schulter. Nur die
      // Achse 'y' tut das (24,5 cm vorn, Hand-Schulter 0,562 -> 0,486 m); 'x' ist
      // die Armachse und wirkungslos. Das Vorzeichen ist seitenverschieden.
      bend:  { axis: 'y', moves: 'z', want: +1, mirror: false, limit: [0, 150],
               richtung: 'bend: + beugt den rechten Ellbogen, die Hand kommt nach VORN zur Schulter. 0 ist der gestreckte Arm und die Untergrenze - ein Ellbogen laesst sich nicht ueberstrecken.' },
      twist: { axis: 'x', want: +1, mirror: false, limit: [-90, 90], twist: true,
               richtung: 'twist: + dreht die Handflaeche des rechten Unterarms nach UNTEN (Pronation), - nach OBEN (Supination). '
                 + 'GEMESSEN am Xbot bei gebeugtem Ellbogen; ohne twist zeigt sie nach innen. Die Hand dreht mit, ein Handgelenk gibt es nicht.' } } },
  { joint: 'hip_l',      bone: 'thigh_l',   end: 'ende_fuss_l', dofs: {
      flex:   { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-30, 130],
                richtung: 'flex: + zieht das linke Bein nach vorn, - führt es nach hinten' },
      spread: { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 45],
                richtung: 'spread: + spreizt das linke Bein nach außen, - zieht es zur Körpermitte' },
      twist:  { axis: 'y', want: +1, mirror: true,  limit: [-45, 45], twist: true,
                richtung: 'twist: + dreht den linken Oberschenkel nach außen, - nach innen' } } },
  { joint: 'hip_r',      bone: 'thigh_r',   end: 'ende_fuss_r', dofs: {
      flex:   { axis: 'x', moves: 'z', want: +1, mirror: false, limit: [-30, 130],
                richtung: 'flex: + zieht das rechte Bein nach vorn, - führt es nach hinten' },
      spread: { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-30, 45],
                richtung: 'spread: + spreizt das rechte Bein nach außen, - zieht es zur Körpermitte' },
      twist:  { axis: 'y', want: +1, mirror: true,  limit: [-45, 45], twist: true,
                richtung: 'twist: + dreht den rechten Oberschenkel nach außen, - nach innen' } } },
  { joint: 'knee_l',     bone: 'shin_l',    end: 'ende_fuss_l', dofs: {
      bend: { axis: 'x', moves: 'z', want: -1, mirror: false, limit: [0, 150],
              richtung: 'bend: + beugt das linke Knie nach hinten, - streckt es' } } },
  { joint: 'knee_r',     bone: 'shin_r',    end: 'ende_fuss_r', dofs: {
      bend: { axis: 'x', moves: 'z', want: -1, mirror: false, limit: [0, 150],
              richtung: 'bend: + beugt das rechte Knie nach hinten, - streckt es' } } },
  { joint: 'ankle_l',    bone: 'foot_l',    end: 'ende_fuss_l', dofs: {
      point: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-45, 55],
               richtung: 'point: + streckt den linken Fuß nach unten (Spitzfuß), - zieht ihn hoch (Fersenstand)' },
      tilt:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25],
               richtung: 'tilt: + kippt den linken Fuß nach außen, - nach innen' } } },
  { joint: 'ankle_r',    bone: 'foot_r',    end: 'ende_fuss_r', dofs: {
      point: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-45, 55],
               richtung: 'point: + streckt den rechten Fuß nach unten (Spitzfuß), - zieht ihn hoch (Fersenstand)' },
      tilt:  { axis: 'z', moves: 'x', want: +1, mirror: true,  limit: [-25, 25],
               richtung: 'tilt: + kippt den rechten Fuß nach außen, - nach innen' } } },
  { joint: 'toes_l',     bone: 'toe_l',     end: 'ende_fuss_l', dofs: {
      bend: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-40, 60],
              richtung: 'bend: + beugt die linken Zehen nach unten, - hebt sie' } } },
  { joint: 'toes_r',     bone: 'toe_r',     end: 'ende_fuss_r', dofs: {
      bend: { axis: 'x', moves: 'y', want: -1, mirror: false, limit: [-40, 60],
              richtung: 'bend: + beugt die rechten Zehen nach unten, - hebt sie' } } },
];

/** Einheitsvektoren der Weltachsen für die Wirkungsrichtung. */
const ACHSENVEKTOR = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

// ─────────────────────────────────────────────────────────────────────────────
// Rollen: was welcher Knochen ist, kommt aus der Erkennung
//
// Vorher stand hier ein Namensschema: „mixamorig“ + „LeftFoot“. Damit war jede
// Messung an ein Benennungsschema gebunden, und ein Modell, dessen Knochen
// anders heißen, wurde abgelehnt, obwohl seine Geometrie vollständig messbar
// ist. Gemessen wird jetzt an dem, was detect.js aus Geometrie und Topologie
// erkennt; Namen tauchen nur noch als Bezeichnung in der Ausgabe auf.
// ─────────────────────────────────────────────────────────────────────────────

/** Konfidenzschwellen aus plan.md 5.1, übernommen aus der Erkennung, damit
 *  beide Module dieselbe Grenze meinen: ab 0,9 sicher, zwischen 0,5 und 0,9
 *  wird der Mensch gefragt, darunter gibt es keine Rolle. */
export const ROLLE_SICHER = ERKENNUNG.sicherAb;
export const ROLLE_MINDESTENS = ERKENNUNG.fragenAb;

/** Anteil des längsten Kettenglieds, unter dem ein blattständiger Knochen am
 *  Kettenende ein reiner Markerknochen ist und nicht als Messpunkt zählt.
 *  Derselbe Wert wie ERKENNUNG.fingerKuerze — dieselbe Frage („ist dieses
 *  Endglied noch Körper oder nur eine Markierung?“), also dieselbe Grenze.
 *  An Xbot gemessen: der Fingerendpunkt liegt 0,0283 m hinter dem letzten
 *  Fingerglied, das längste Glied der Handkette misst 0,0953 m — 30 %, also
 *  Marker. Zehenspitze 0,0928 von 0,1382 m = 67 % und Scheitel 0,1800 von
 *  0,1800 m = 100 % bleiben Messpunkt. */
export const MARKER_KUERZE = ERKENNUNG.fingerKuerze;

/** Erkennungsbericht je geladenem Modell, einmal gerechnet. Vier Messwege
 *  (Segmente, Sohlen, Gelenke, Ruheabstände) brauchen dieselben Rollen; ohne
 *  Ablage liefe die Erkennung viermal über dieselbe Punktwolke. */
const berichtCache = new WeakMap();

function erkennungsBericht(gltf, opts = {}) {
  if (berichtCache.has(gltf)) return berichtCache.get(gltf);
  const bericht = detectRig(gltf, { file: opts.fileName });
  berichtCache.set(gltf, bericht);
  return bericht;
}

/**
 * Die Rollen-Korrekturen, die nach der Erkennung durch den Menschen gekommen
 * sind: opts.roles (direkt) und opts.bestaetigteRollen (Tool-Store) zusammen,
 * nur die Einträge, die eine ERKANNTE Zuordnung wirklich ändern oder ergänzen.
 *
 * Liefert null, wenn nichts abweicht — dann ist das einmal gemessene Profil
 * bereits das der bestätigten Zuordnung, und ein zweiter Messlauf wäre
 * Wiederholung, keine Korrektur.
 *
 * @returns {object|null} { rolle: knochenName } oder null
 */
function rollenDifferenz(bericht, opts = {}) {
  const vorgaben = Object.assign({}, opts.bestaetigteRollen ?? {}, opts.roles ?? {});
  const abweichend = {};
  for (const [rolle, name] of Object.entries(vorgaben)) {
    const erkannt = bericht.roles[rolle];
    if (!erkannt || erkannt.bone !== name) abweichend[rolle] = name;
  }
  return Object.keys(abweichend).length ? abweichend : null;
}

/**
 * Knochen-Objekte unter den ids, die der Erkennungsbericht benutzt.
 *
 * Die Erkennung gibt Rollen als id-Strings zurück, nicht als Objekte, und
 * vergibt bei doppelten oder leeren Namen einen Indexzusatz („bone#7“). Die
 * Auflösung hier bildet dieselbe Reihenfolge nach — Szenendurchlauf über alle
 * Bones, Skelettknochen als Rückfall. Sauberer wäre, wenn der Bericht die
 * Objekte selbst mitgäbe; das ist eine Frage an detect.js, nicht an diese Datei.
 */
function knochenNachErkennungsId(gltf, skelettKnochen) {
  const objs = [];
  gltf.scene.traverse((o) => { if (o.isBone) objs.push(o); });
  if (objs.length === 0) objs.push(...skelettKnochen);
  const zaehlung = new Map();
  for (const b of objs) zaehlung.set(b.name, (zaehlung.get(b.name) || 0) + 1);
  const karte = new Map();
  objs.forEach((o, i) => {
    const roh = typeof o.name === 'string' ? o.name : '';
    karte.set(zaehlung.get(roh) > 1 || roh === '' ? `${roh || 'bone'}#${i}` : roh, o);
  });
  return karte;
}

/** Weltposition eines Knochens in der anliegenden (Bind-)Pose. */
function weltPos(bone) { return bone.getWorldPosition(new THREE.Vector3()); }

/**
 * Ende der Kette unter einem Knochen, rein topologisch: an jeder Verzweigung
 * gewinnt der Zweig mit der größten Reichweite (weitester Nachfahre), am Ende
 * fällt ein reiner Markerknochen weg.
 *
 * Warum die größte Reichweite und nicht die größte Tiefe: eine Hand hat fünf
 * Finger mit gleich vielen Gliedern; entscheiden soll, welcher am weitesten
 * vom Handgelenk wegreicht — das ist eine Messung, kein Zählwerk. Warum der
 * Marker am Ende wegfällt: siehe MARKER_KUERZE.
 *
 * @returns {{bone: THREE.Bone, glieder: number}} Endknochen und Kettenlänge in
 *   Gliedern; glieder 0, wenn der Startknochen selbst schon das Ende ist.
 */
function kettenEnde(start) {
  const kette = [];
  let cur = start;
  while (true) {
    const kinder = cur.children.filter((c) => c.isBone);
    if (kinder.length === 0) break;
    const pc = weltPos(cur);
    let best = null, bestReich = -1;
    for (const k of kinder) {
      let reich = 0;
      k.traverse((x) => { if (x.isBone) reich = Math.max(reich, weltPos(x).distanceTo(pc)); });
      if (reich > bestReich) { bestReich = reich; best = k; }
    }
    if (kette.some((g) => g.bone === best)) break;      // Schutz gegen Zyklen
    kette.push({ bone: best, glied: weltPos(best).distanceTo(pc) });
    cur = best;
  }
  if (kette.length === 0) return { bone: start, glieder: 0 };
  const laengstes = kette.reduce((m, g) => Math.max(m, g.glied), 0);
  const letztes = kette[kette.length - 1];
  const istBlatt = letztes.bone.children.filter((c) => c.isBone).length === 0;
  if (kette.length > 1 && istBlatt && letztes.glied < MARKER_KUERZE * laengstes) kette.pop();
  return { bone: kette[kette.length - 1].bone, glieder: kette.length };
}

/**
 * Rolle → Knochen für dieses Modell. Quelle ist der Erkennungsbericht; die
 * Kettenenden kommen topologisch dazu.
 *
 * opts.roles: { rolle: 'knochenname' } — die Antwort eines Menschen auf eine
 * Rückfrage der Erkennung (plan.md 5.1: zwischen 0,5 und 0,9 wird gefragt).
 * Eine so gesetzte Rolle gilt als bestätigt, Konfidenz 1.
 *
 * opts.bestaetigteRollen: dieselbe Form, aber als NACHTRAG — die Zuordnungen,
 * die der Mensch über confirm_role (src/ui/rollen-bestaetigung.js) festgelegt
 * hat, NACHDEM die Seite das Modell einmal vermessen hatte. Sie überschreiben
 * die erkannten Rollen auf dieselbe Weise wie opts.roles; ohne sie bliebe eine
 * Korrektur kosmetisch (Beleg: spikes/rollen/BEFUND.md, Pfad B).
 */
function rollenAufloesen(gltf, skelettKnochen, opts = {}) {
  const bericht = erkennungsBericht(gltf, opts);
  const karte = knochenNachErkennungsId(gltf, skelettKnochen);
  const nachName = new Map(skelettKnochen.map((b) => [b.name, b]));
  const rollen = new Map();

  for (const [rolle, v] of Object.entries(bericht.roles)) {
    if (v.confidence < ROLLE_MINDESTENS) continue;
    const bone = karte.get(v.bone);
    if (!bone) continue;
    rollen.set(rolle, { bone, id: v.bone, confidence: v.confidence, quelle: 'erkannt' });
  }

  // Bestätigungen, die vor der Messung eingegangen sind (Tool-Store), und die
  // des direkten Aufrufs (opts.roles) gelten beide: Rolle → Konfidenz 1.
  const vorgaben = Object.assign({}, opts.bestaetigteRollen ?? {}, opts.roles ?? {});
  for (const [rolle, name] of Object.entries(vorgaben)) {
    const bone = nachName.get(name) ?? karte.get(name);
    if (!bone) {
      throw new Error(`Rollenvorgabe ${rolle}: Knochen „${name}“ gibt es in diesem Skelett mit ${skelettKnochen.length} Knochen nicht`);
    }
    rollen.set(rolle, { bone, id: bone.name, confidence: 1.0, quelle: 'bestaetigt' });
  }

  for (const ende of KETTENENDEN) {
    for (const ab of ende.ab) {
      const start = rollen.get(ab);
      if (!start) continue;
      const e = kettenEnde(start.bone);
      rollen.set(ende.id, { bone: e.bone, id: e.bone.name, confidence: start.confidence, quelle: `kettenende(${ab})` });
      break;
    }
  }

  return { rollen, bericht };
}

/**
 * Segment je Knochen, topologisch statt über Namen: ein Knochen gehört zu dem
 * Segment, dessen Startknochen sein nächster Vorfahr (oder er selbst) ist.
 * Ein Fingerknochen landet damit bei der Hand, ein Wirbel beim Rumpf, ein
 * Zehenknochen beim Fuß — ohne dass irgendwo „Spine“ oder „Toe“ steht.
 * Knochen oberhalb des Beckens gehören zu keinem Segment (null), wie zuvor.
 */
function segmentDerKnochen(rollen, bones) {
  const startSegment = new Map();
  for (const s of SEGMENTS) {
    const r = rollen.get(s.from);
    if (r && !startSegment.has(r.bone)) startSegment.set(r.bone, s.id);
  }
  const segOf = new Map();
  for (const b of bones) {
    let cur = b, seg = null;
    while (cur) {
      if (startSegment.has(cur)) { seg = startSegment.get(cur); break; }
      cur = cur.parent && cur.parent.isBone ? cur.parent : null;
    }
    segOf.set(b, seg);
  }
  return segOf;
}


// ─────────────────────────────────────────────────────────────────────────────
// Helfer
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Konvexe Hülle von 2D-Punkten [x, z] in der x–z-Ebene (von oben gesehen).
 *  Rückgabe: Array von [x, z] in mathematisch positivem Umlaufsinn. */
function convexHull2D(points) {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  // Orientierung erzwingen: positiv (gegen Uhrzeigersinn in der x–z-Ebene).
  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  if (area2 < 0) hull.reverse();
  return hull;
}

/** Punkt-in-konvexer-Hülle-Test für 2D-Punkte [x, z]. Die Hülle muss in
 *  positivem Umlaufsinn vorliegen (convexHull2D stellt das sicher). */
function pointInHull(p, hull) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr < 0) return false;
  }
  return true;
}

/**
 * Mesh-Hülle eines Segments, unabhängig von seinem einen Perzentil-Radius: 10
 * Stationen entlang der Segmentachse, je das Perzentil der senkrechten Abstände
 * aller Vertex in dieser Scheibe, daraus der Median. Eine Kapsel, die die Haut
 * trifft, muss dieses Stationsprofil ebenfalls treffen — Auswüchse an den
 * Segmentenden (Finger, Schädel) schlagen darin nicht als Pauschalabweichung
 * durch.
 *
 * Rueckgabe { huelle, groesster, anzahl } in Metern; huelle 0, wenn zu wenige
 * Vertex in den Scheiben liegen.
 */
function meshHuelle(verts, a, b, stationen = 10, p = RADIUS_PERCENTILE) {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  const laenge = Math.sqrt(l2);
  if (!verts.length || !(laenge > 0)) return { huelle: 0, groesster: 0, anzahl: verts.length };
  const zerlegt = verts.map((v) => {
    const t = THREE.MathUtils.clamp(v.clone().sub(a).dot(ab) / l2, 0, 1);
    return { t, d: v.distanceTo(a.clone().addScaledVector(ab, t)) };
  });
  const band = 1 / (2 * stationen);      // Achsenanteil, t ist auf [0,1] normiert
  const proStation = [];
  for (let s = 0; s < stationen; s++) {
    const mittig = (s + 0.5) / stationen;
    // percentile() erwartet SORTIERTE Eingabe — sie greift blind auf einen
    // Index zu. Ohne dieses sort() lieferte jede Station einen beliebigen
    // Abstand statt ihres Perzentils, und die Stationshülle fiel systematisch
    // zu klein aus: Rumpf 0,1232 statt 0,1484 m, Fuß 0,0379 statt 0,0598 m.
    // Damit meldete die Hüllenprüfung alle 14 Segmente als abweichend (23 bis
    // 60 %), obwohl die Radien stimmen. Sortiert liegen 13 der 14 Segmente
    // unter 8 %, der Rumpf als konischstes Segment bei 13,9 % — unter der
    // Grenze von 15 %. (Beleg: src/rig/measure.test.mjs, Reihe „Radien“.)
    const inDerScheibe = zerlegt
      .filter((x) => Math.abs(x.t - mittig) <= band)
      .map((x) => x.d)
      .sort((x, y) => x - y);
    if (inDerScheibe.length >= 4) proStation.push(percentile(inDerScheibe, p));
  }
  if (proStation.length === 0) return { huelle: 0, groesster: 0, anzahl: verts.length };
  proStation.sort((x, y) => x - y);
  return {
    huelle: percentile(proStation, 0.5),
    groesster: zerlegt.reduce((m, x) => Math.max(m, x.d), 0),
    anzahl: verts.length,
  };
}


/** Der schwächste Beleg einer Rollenzuordnung, als Satz mit Zahl. Die
 *  Erkennung legt jeder Rolle ihre Faktoren bei ({name, wert, messung}); für
 *  eine Ablehnung ist der schwächste davon die Begründung. */
function schwaechsterBeleg(faktoren, achsenWert) {
  if (!Array.isArray(faktoren) || faktoren.length === 0) return 'kein Beleg beigelegt';
  const f = faktoren.reduce((m, x) => (x.wert < m.wert ? x : m));
  if (f.wert >= 0.99) {
    // Alle Einzelbelege voll: dann kommt der Konfidenzverlust nicht aus dieser
    // Rolle, sondern aus der Güte der Aufwärtsachse, mit der die Erkennung jede
    // Konfidenz skaliert. Das gehört in die Meldung, sonst steht dort ein
    // Beleg mit Wert 1,00 als angeblicher Grund einer Ablehnung.
    return `alle ${faktoren.length} Rollenbelege voll (${faktoren.map((x) => x.name).join(', ')}),`
      + ` die Konfidenz sinkt über die Güte der Aufwärtsachse (Achsenwert ${achsenWert})`;
  }
  return `${f.name} ${Number(f.wert).toFixed(2)} (${f.messung})`;
}

function r4(x) { return Number(x.toFixed(4)); }
function r5(x) { return Number(x.toFixed(5)); }

/** Pflichtrollen (plan.md 5.1): fehlt eine, wird das Modell abgelehnt statt
 *  geraten. Dieselbe Liste wie in der Erkennung. */
const PFLICHTROLLEN = ['pelvis', 'foot_l', 'foot_r'];

// ─────────────────────────────────────────────────────────────────────────────
// Laden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lädt eine GLB/GLTF-Datei in ein three.js-gltf-Objekt ({scene, animations}).
 * @param {Uint8Array|ArrayBuffer} buffer  rohe Bytes einer .glb-/-.gltf-Datei
 * @throws {Error} bei leerem oder fehlerhaftem Puffer — Meldung mit Zahl.
 */
export async function loadGLB(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer
    : buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : null;
  if (!bytes || bytes.length === 0) {
    throw new Error(`Laden fehlgeschlagen: Puffer ist leer oder hat falschen Typ (${bytes === null ? typeof buffer : '0 Byte'})`);
  }
  const loader = new GLTFLoader();
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kontext: einmal aus dem Modell ziehen, was alle Messungen brauchen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * collectContext mit nachträglichen Rollenkorrekturen.
 *
 * Die Bestätigungen des Menschen (opts.roles und opts.bestaetigteRollen aus
 * dem Tool-Store) werden gegen die erkannten Rollen des einmal gerechneten
 * Erkennungsberichts gestellt. Weicht mindestens eine Zuordnung ab, wird der
 * Kontext mit der korrigierten Rollentabelle NEU gebaut — Vertexbesitze,
 * Segmentzuordnung, Sohlenseiten und Rollen dann aus der neuen Zuordnung
 * gemessen (dasselbe Verfahren wie beim ersten Lauf, kein Schätzweg).
 *
 * Läuft nur ab, wenn wirklich geändert wurde — ein reines Bestätigen derselben
 * Zuordnung kostet keinen zweiten Lauf.
 */
function contextMitKorrekturen(gltf, opts = {}) {
  const ctx = collectContext(gltf, opts);
  const korrektur = rollenDifferenz(ctx.bericht, opts);
  if (!korrektur) return ctx;
  return collectContext(gltf, { ...opts, roles: Object.assign({}, opts.roles ?? {}, korrektur) });
}

/**
 * Sammelt Skeleton, Bind-Pose-Kopie, Vertexpositionen in Weltkoordinaten
 * (Bind-Pose), dominante Segment-Zuordnung je Vertex über die Skin-Gewichte
 * und die bodennahen (Sohlen-)Vertices. Wirft mit Zahl und Grund, wenn das
 * Modell nicht vermessen werden kann.
 */
function collectContext(gltf, opts = {}) {
  const scene = gltf && gltf.scene;
  if (!(scene instanceof THREE.Object3D)) {
    throw new Error(`Vermessung abgelehnt: kein Szenen-Objekt im Loader-Ergebnis (Typ ${gltf === null || gltf === undefined ? String(gltf) : typeof gltf})`);
  }
  let mesh = null;
  const meshes = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh) { meshes.push(o); if (!mesh) mesh = o; }
  });
  const skeleton = mesh ? mesh.skeleton : null;
  const bones = skeleton ? skeleton.bones : [];
  if (!mesh || bones.length === 0) {
    throw new Error(`Vermessung abgelehnt: ${bones.length} Knochen, ${meshes.length} SkinnedMesh gefunden — Vermessung braucht ein geriggtes Modell`);
  }

  scene.updateMatrixWorld(true);
  skeleton.update();

  const byName = new Map(bones.map((b) => [b.name, b]));

  // Rollen zuerst: ohne sie ist kein Vertex einem Segment zuzuordnen. Die
  // Erkennung lehnt hier ab, wenn das Modell kein aufrechtes zweibeiniges
  // Skelett ist — mit geometrischer Begründung, nicht mit fehlenden Namen.
  const { rollen, bericht } = rollenAufloesen(gltf, bones, opts);
  const segOfBoneObj = segmentDerKnochen(rollen, bones);

  const v = new THREE.Vector3();
  const worldVerts = [];
  const segOfVertex = [];
  let minY = Infinity, maxY = -Infinity;

  // ALLE SkinnedMeshes vermessen, nicht nur das erste. Xbot.glb bringt zwei mit
  // (Beta_Joints 12473, Beta_Surface 15901 Vertex). Wer nur das erste nimmt,
  // vermisst 12473 von 28374 Vertex = 44 % und erhält eine Körperhöhe von
  // 1,5968 m statt der nachgemessenen 1,8093 m — 0,2125 m = 11,7 % zu wenig.
  // Jede Toleranz dieses Profils ist auf diese Höhe relativ, also wäre das
  // gesamte Profil um 13,3 % zu eng. (Beleg: src/rig/measure.test.mjs,
  // „Vertrag, Positivfall“.)
  const knochenMitHaut = new Set();
  for (const haut of meshes) {
    const posAttr = haut.geometry.attributes.position;
    const si = haut.geometry.attributes.skinIndex;
    const sw = haut.geometry.attributes.skinWeight;
    if (!si || !sw) {
      throw new Error(`Vermessung abgelehnt: SkinnedMesh „${haut.name || 'unbenannt'}“ mit ${posAttr.count} Vertices ohne skinIndex/skinWeight — Segmentzuordnung unmöglich`);
    }

    for (let i = 0; i < posAttr.count; i++) {
      // Bind-Pose-Position über die Haut holen (getVertexPosition rechnet die
      // Skin-Gewichte), dann ins Weltkoordinatensystem. Die Rohposition der
      // SkinnedMeshes liegt im Bind-Space; applyMatrix4(matrixWorld) allein
      // darauf wäre falsch.
      haut.getVertexPosition(i, v);
      haut.localToWorld(v);
      const p = v.clone();
      worldVerts.push(p);
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;

      let bestW = -1, bestB = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        const bi = si.getComponent(i, k);
        if (w > MIN_HAUT_GEWICHT && bones[bi]) knochenMitHaut.add(bones[bi].name);
        if (w > bestW) { bestW = w; bestB = bi; }
      }
      segOfVertex.push(bestW >= MIN_DOMINANT_WEIGHT ? (segOfBoneObj.get(bones[bestB]) ?? null) : null);
    }
  }

  const vertexCount = worldVerts.length;
  const height = maxY - minY;
  if (!(height > 0)) {
    throw new Error(`Vermessung abgelehnt: Körperhöhe ${height} m aus ${vertexCount} Vertices von ${meshes.length} SkinnedMeshes — keine Ausdehnung auf der Hochachse y`);
  }

  // Bodennahe Vertices, aufgeteilt auf linke und rechte Körperseite.
  const soleTolMeters = height * SOLE_TOLERANCE;
  const footL = rollen.has('foot_l') ? rollen.get('foot_l').bone : null;
  const footR = rollen.has('foot_r') ? rollen.get('foot_r').bone : null;
  const soleVertsL = [], soleVertsR = [];
  if (footL && footR) {
    const fl = footL.getWorldPosition(new THREE.Vector3());
    const fr = footR.getWorldPosition(new THREE.Vector3());
    for (const p of worldVerts) {
      if (p.y < minY + soleTolMeters) {
        (p.distanceTo(fl) <= p.distanceTo(fr) ? soleVertsL : soleVertsR).push(p);
      }
    }
  }

  return {
    scene, mesh, skeleton, bones, byName,
    rollen, bericht,
    vertexCount, worldVerts, segOfVertex, knochenMitHaut,
    minY, maxY, height,
    soleTolMeters,
    footL, footR,
    soleVertsL, soleVertsR,
  };
}

function worldVertsOfSegment(ctx, segId) {
  const out = [];
  for (let i = 0; i < ctx.vertexCount; i++) {
    if (ctx.segOfVertex[i] === segId) out.push(ctx.worldVerts[i]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmente: Radius zur Segmentachse, Masse aus Kapselvolumen, Schwerpunkt
// ─────────────────────────────────────────────────────────────────────────────

function measureSegments(ctx, opts = {}) {
  const radiusPercentile = opts.radiusPercentile ?? RADIUS_PERCENTILE;
  const massOverrides = opts.massOverrides ?? {};
  const radiusOverrides = opts.radiusOverrides ?? {};
  const segments = [];
  const massBySeg = new Map();
  const comBySeg = new Map();
  const achsen = new Map();
  const uebersprungen = [];

  for (const s of SEGMENTS) {
    // Ein Segment, dessen Rollen dieses Modell nicht hat (ein Rig ohne Zehen,
    // ohne Finger, ohne Schulterblatt), wird ÜBERSPRUNGEN und gemeldet — nicht
    // geraten und nicht als Fehler ausgegeben. Vorher fiel an dieser Stelle
    // jedes Modell durch, dessen Knochen anders heißen.
    const ra = ctx.rollen.get(s.from);
    const rb = ctx.rollen.get(s.to);
    if (!ra || !rb) {
      const fehlt = [!ra ? s.from : null, !rb ? s.to : null].filter(Boolean);
      uebersprungen.push(`Segment ${s.id} übersprungen: Rolle ${fehlt.join(' und ')} in diesem Skelett mit ${ctx.bones.length} Knochen nicht erkannt`);
      continue;
    }
    const ba = ra.bone;
    const bb = rb.bone;
    if (ba === bb) {
      uebersprungen.push(`Segment ${s.id} übersprungen: Rollen ${s.from} und ${s.to} zeigen beide auf „${ba.name}“ — keine Segmentachse messbar`);
      continue;
    }
    const verts = worldVertsOfSegment(ctx, s.id);
    if (verts.length === 0) {
      uebersprungen.push(`Segment ${s.id} übersprungen: 0 von ${ctx.vertexCount} Vertices tragen ein Gewicht ≥ ${MIN_DOMINANT_WEIGHT} auf einem Knochen dieses Segments — Radius nicht messbar`);
      continue;
    }
    const a = ba.getWorldPosition(new THREE.Vector3());
    const b = bb.getWorldPosition(new THREE.Vector3());
    const dists = verts
      .map((p) => pointSegDist(p, a, b))
      .sort((x, y) => x - y);
    const globalerRadius = percentile(dists, radiusPercentile);
    const stationenRadius = meshHuelle(verts, a, b, 10, radiusPercentile).huelle;
    // Ein kurzes Teilsegment kann an einem Ende eine breite Hüfte oder
    // Schulter streifen. Dann bläht das globale 90.-Perzentil die gesamte
    // Kapsel auf (unterer Xbot-Rumpf: 17,8 statt 14,4 cm) und erzeugt später
    // Kollisions-Fehlalarme. Die über mindestens fünf Stationen gemessene
    // Hülle beschreibt den Segmentkörper; nur bei mehr als 15 % Überhöhung
    // ersetzt sie deshalb den globalen Wert.
    let radius = stationenRadius > 0
      && globalerRadius > stationenRadius * (1 + RADIUS_DEVIATION_MAX)
      ? stationenRadius
      : globalerRadius;
    if (!(radius > 0) || !Number.isFinite(radius)) {
      uebersprungen.push(`Segment ${s.id} übersprungen: Radius ${radius} m aus ${dists.length} Vertex-Abständen (Perzentil ${radiusPercentile}) — keine Haut am Segment messbar`);
      continue;
    }
    if (radiusOverrides[s.id] !== undefined) {
      radius = radius * radiusOverrides[s.id];   // Testhaken: künstlich veränderter Radius
    }
    const length = a.distanceTo(b);
    // Kapselvolumen: Zylinder plus zwei Halbkugeln. Masse NICHT aus der
    // Vertexzahl — feine Modellierung (viele Finger-Vertices) heißt nicht
    // viel Masse (Spike-Kalibrierung).
    const volume = Math.PI * radius * radius * length
      + (4 / 3) * Math.PI * radius * radius * radius;
    let mass = volume * DENSITY_KG_PER_M3;
    if (massOverrides[s.id] !== undefined) {
      mass = mass * massOverrides[s.id];      // Testhaken: künstliche Massenverlagerung
    }
    segments.push({
      id: s.id, from: ba.name, to: bb.name,
      radius: r4(radius), mass: r5(mass), volume: r5(volume),
    });
    massBySeg.set(s.id, mass);
    comBySeg.set(s.id, a.clone().add(b).multiplyScalar(0.5));    // Kapselmitte
    achsen.set(s.id, [ba, bb]);
  }
  if (segments.length === 0) {
    throw new Error(`Vermessung abgelehnt: 0 von ${SEGMENTS.length} Segmenten messbar bei ${ctx.bones.length} Knochen und ${ctx.rollen.size} erkannten Rollen`);
  }
  return { segments, massBySeg, comBySeg, achsen, uebersprungen };
}

/**
 * Misst Schwerpunkt und Standfläche der Bind-Pose.
 * opts.massOverrides: { segmentId: faktor } skaliert die gemessene Segmentmasse
 * künstlich — ausschließlich Testhaken für den Negativfall des Abnahmetests
 * „Massen“ (verdreifachte Handmasse).
 *
 * Positivfall des Abnahmetests: der Schwerpunkt der unveränderten Bind-Pose
 * liegt innerhalb der Standfläche (konvexe Hülle der bodennahen Vertices).
 */
export function measureMasses(gltf, opts = {}) {
  const ctx = contextMitKorrekturen(gltf, opts);
  const { segments, massBySeg, comBySeg } = measureSegments(ctx, opts);

  let total = 0;
  const com = new THREE.Vector3();
  for (const s of segments) {
    const m = massBySeg.get(s.id);
    if (!(m > 0)) {
      throw new Error(`Segment ${s.id}: Masse ${m} kg nach eventuell künstlicher Skalierung — Summe über alle Segmente nicht bildbar`);
    }
    total += m;
    com.addScaledVector(comBySeg.get(s.id), m);
  }
  if (!(total > 0)) {
    throw new Error(`Schwerpunkt nicht messbar: Gesamtmasse ${total.toFixed(3)} kg über ${segments.length} Segmente`);
  }
  com.divideScalar(total);

  const solePts = [...ctx.soleVertsL, ...ctx.soleVertsR].map((p) => [p.x, p.z]);
  if (solePts.length < 3) {
    throw new Error(`Standfläche nicht messbar: nur ${solePts.length} Vertices in Bodennähe (Toleranz ${(ctx.height * SOLE_TOLERANCE).toFixed(4)} m bei Körperhöhe ${ctx.height.toFixed(3)} m)`);
  }
  const hull = convexHull2D(solePts);
  const inside = pointInHull([com.x, com.z], hull);
  return {
    comXYZ: [r4(com.x), r4(com.y), r4(com.z)],
    supportPolygon: hull,
    insideSupportPolygon: inside,
    totalMassKg: r5(total),
    segments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sohlen: Kontaktpunkte, Abdeckung, Ferse-gegen-Ballen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst die Sohlenkontaktpunkte aus der Bodennähe in der Bind-Pose
 * (plan.md 3.3). Ein Modell mit angehobener Ferse wird NICHT stillschweigend
 * falsch vermessen: zu jeder Sohle gehört eine Statistik mit der gemessenen
 * Höhendifferenz Ferse gegen Ballen — der Aufrufer entscheidet anhand der Zahl.
 */
export function measureSoles(gltf, opts = {}) {
  const ctx = contextMitKorrekturen(gltf, opts);
  return measureSolesCore(ctx);
}

/** Kern der Sohlenmessung auf einem collectContext-Ergebnis. */
function measureSolesCore(ctx) {
  const soles = [];
  const stats = {};

  const sides = [
    { tag: 'l', group: ctx.soleVertsL, foot: ctx.footL, segId: 'foot_l' },
    { tag: 'r', group: ctx.soleVertsR, foot: ctx.footR, segId: 'foot_r' },
  ];

  for (const { tag, group, foot, segId } of sides) {
    if (group.length < 4) {
      stats[tag] = {
        vertexCount: group.length,
        coverage: 0,
        note: `nur ${group.length} Vertices in Bodennähe (Schwelle ${ctx.soleTolMeters.toFixed(4)} m bei Körperhöhe ${ctx.height.toFixed(3)} m)`,
      };
      continue;
    }
    const xs = group.map((p) => p.x), zs = group.map((p) => p.z);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);

    const corners = [
      ['back_in', xMin, zMin], ['back_out', xMax, zMin],
      ['front_in', xMin, zMax], ['front_out', xMax, zMax],
    ];
    for (const [pos, tx, tz] of corners) {
      let best = group[0], bestD = Infinity;
      for (const p of group) {
        const d = (p.x - tx) * (p.x - tx) + (p.z - tz) * (p.z - tz);
        if (d < bestD) { bestD = d; best = p; }
      }
      const local = foot.worldToLocal(best.clone());
      soles.push({
        id: `sole_${tag}_${pos}`,
        bone: foot.name,
        local: [r5(local.x), r5(local.y), r5(local.z)],
      });
    }

    // Fußlänge aus der Haut der Fuß-Kette (dominante Zuordnung), nicht getippt.
    const footVerts = worldVertsOfSegment(ctx, segId);
    let footLength = 0, soleLength = 0, coverage = 0;
    let heelLowY = NaN, toeLowY = NaN, heelLift = NaN;
    if (footVerts.length > 0) {
      const fz = footVerts.map((p) => p.z);
      const fzMin = Math.min(...fz), fzMax = Math.max(...fz);
      footLength = fzMax - fzMin;

      // Abdeckung über das KONTAKTBAND, nicht über das Sohlentoleranzband.
      // Die Sohlentoleranz (3,5 % der Körperhöhe = 0,0633 m an diesem Modell)
      // dient dazu, Sohlenpunkte zu FINDEN — auch an einem Fuß, der auf dem
      // Ballen steht. Als Maß für BERÜHRUNG taugt sie nicht: bei 20°
      // Zehenneigung schneidet ein 0,0633-m-Band 0,2011 m aus einem 0,2355 m
      // langen Fuß, also 85 % — die angehobene Ferse bliebe unter der Grenze
      // von 60 % unbemerkt. Über den Kontaktzuschlag (0,015 m) gemessen sind
      // es 31 %. An Xbot.glb bei 0/5/10/15/20/30° Zehenneigung: 98 / 88 / 48 /
      // 38 / 31 / 24 % — die 60-%-Grenze trennt zwischen 5° und 10°.
      const imKontakt = footVerts.filter((p) => p.y < ctx.minY + CONTACT_MARGIN);
      if (imKontakt.length > 0) {
        const kz = imKontakt.map((p) => p.z);
        soleLength = Math.max(...kz) - Math.min(...kz);
      }
      coverage = footLength > 0 ? Math.min(1, soleLength / footLength) : 0;

      // Fersenanhebung: TIEFSTER Punkt der hinteren gegen tiefsten der vorderen
      // Fußhälfte, über alle Fuß-Vertex. Vorher verglich das Maß die HÖCHSTEN
      // Punkte innerhalb des Bodenbands — die liegen beide an dessen Oberkante,
      // das Maß war strukturell blind: 0,0015 / 0,0004 / 0,0001 m bei 0 / 10 /
      // 20° Zehenneigung, also fallend, obwohl die Ferse steigt. So gemessen:
      // 0,0005 / 0,0172 / 0,0344 m — der Kontaktzuschlag von 0,015 m trennt
      // zwischen 5° (0,0090 m) und 10° (0,0172 m).
      const zMitte = (fzMin + fzMax) / 2;
      const ferse = footVerts.filter((p) => p.z < zMitte);
      const zeh = footVerts.filter((p) => p.z >= zMitte);
      if (ferse.length && zeh.length) {
        heelLowY = Math.min(...ferse.map((p) => p.y));
        toeLowY = Math.min(...zeh.map((p) => p.y));
        heelLift = Math.abs(heelLowY - toeLowY);
      }
    }

    stats[tag] = {
      vertexCount: group.length,
      soleLength: r4(soleLength),
      footLength: r4(footLength),
      coverage: r4(coverage),
      heelLowY: Number.isFinite(heelLowY) ? r4(heelLowY) : null,
      toeLowY: Number.isFinite(toeLowY) ? r4(toeLowY) : null,
      heelLiftMeters: Number.isFinite(heelLift) ? r4(heelLift) : null,
    };
  }
  return { soles, stats, height: r4(ctx.height) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorzeichen messen (plan.md 3.5): Gelenk um PROBE_DEG beugen, Wirkung am
// Kettenende messen. Twist wird nicht stillschweigend zu 1.
// ─────────────────────────────────────────────────────────────────────────────

function restoreBind(ctx) {
  for (const [name, saved] of ctx.bindSaved) {
    const bone = ctx.byName.get(name);
    if (bone) {
      bone.quaternion.copy(saved.q);
      bone.position.copy(saved.p);
    }
  }
  ctx.skeleton.update();
  ctx.scene.updateMatrixWorld(true);
}

/**
 * Misst alle Gelenke des Katalogs: Freiheitsgrade, Vorzeichen, Grenzen.
 *
 * Verfahren (plan.md 3.5): das Gelenk wird um PROBE_DEG Grad um seine
 * Knochen-lokale Achse (axis) gedreht; gemessen wird, wie weit sich das
 * Kettenende in der benannten Wirkungsrichtung (moves) bewegt. Für den
 * Spiegelvergleich zählt die rechte Seite mit umgekehrter Erwartung (mirror).
 *
 * opts.invert: { 'joint.dof': true } kehrt das gemessene Vorzeichen künstlich
 * um — ausschließlich Testhaken für den Negativfall des Abnahmetests
 * „Vorzeichen“ (absichtlich invertiertes Vorzeichen muss gemeldet werden).
 */
export function measureJoints(gltf, opts = {}) {
  const ctx = contextMitKorrekturen(gltf, opts);
  const probeDeg = opts.probeDeg ?? PROBE_DEG;
  const invert = opts.invert ?? {};
  const probeRad = probeDeg * Math.PI / 180;
  // Mindestwirkung am Kettenende, ab der eine Abtastung als messbar gilt.
  const deadMove = ctx.height * DEAD_MOVE_FRACTION;

  ctx.bindSaved = new Map();
  for (const b of ctx.bones) {
    ctx.bindSaved.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }

  applyBindPose(ctx);   // sicherstellen, dass wirklich die Bind-Pose anliegt

  // Grenze eines Kanals: gemessen, wenn measureJointLimits ein Ergebnis
  // beigelegt hat, sonst der Katalogwert. Die Herkunft steht PRO RICHTUNG —
  // ein Kanal kann unten anatomisch und oben gemessen sein (arm.swing am
  // Xbot: nach hinten stoppt keine Selbstberührung, nach vorn der Rumpf).
  // Eine pauschale Herkunft je Gelenk verschwiege genau das.
  const gemesseneGrenzen = opts.limits && opts.limits.limits ? opts.limits.limits : null;
  const grenzeFuer = (joint, name, spec) => {
    const g = gemesseneGrenzen ? gemesseneGrenzen[`${joint}.${name}`] : null;
    if (!g) return { limit: spec.limit, limitSource: { min: 'anatomisch', max: 'anatomisch' } };
    return { limit: g.limit, limitSource: { min: g.source.min, max: g.source.max } };
  };

  const joints = {};
  let measurableCount = 0;
  let notMeasurableCount = 0;
  const warnings = [];

  for (const def of JOINT_CATALOG) {
    // Katalogintegrität: jeder Freiheitsgrad braucht eine Richtung in
    // Alltagssprache. Fehlt sie, ist der Katalog kaputt — das fällt hier auf,
    // nicht als fehlendes Feld im Agentenbericht.
    for (const [name, spec] of Object.entries(def.dofs)) {
      if (typeof spec.richtung !== 'string' || spec.richtung.length < 10) {
        throw new Error(
          `Gelenkkatalog unvollständig: ${def.joint}.${name} hat keine richtung-` +
          `Beschreibung (erwartet ein Satz darüber, was ein positiver Wert tut) — ` +
          `${Object.keys(def.dofs).length} Freiheitsgrade im Gelenk geprüft`
        );
      }
    }
    // Gelenk und Kettenende kommen als ROLLE aus der Erkennung. Hat dieses
    // Modell die Rolle nicht, bleibt das Gelenk ungemessen und wird gemeldet.
    const rBone = ctx.rollen.get(def.bone);
    const rEnd = ctx.rollen.get(def.end);
    if (!rBone) {
      warnings.push(`Gelenk ${def.joint}: Rolle ${def.bone} in diesem Skelett mit ${ctx.bones.length} Knochen nicht erkannt — Gelenk bleibt ungemessen`);
      continue;
    }
    if (!rEnd) {
      warnings.push(`Gelenk ${def.joint}: Kettenende ${def.end} in diesem Skelett mit ${ctx.bones.length} Knochen nicht bestimmbar — Vorzeichen nicht messbar`);
      continue;
    }
    const bone = rBone.bone;
    const end = rEnd.bone;
    if (bone === end) {
      warnings.push(`Gelenk ${def.joint}: Rolle ${def.bone} und Kettenende ${def.end} zeigen beide auf „${bone.name}“ — Wirkung am Kettenende nicht messbar`);
      continue;
    }

    // Datensicherung vor dem Abtasten (Restore unten sowieso, das hier ist
    // der Ausgangszustand für die Bind-Pose-Delta-Rechnung).
    const bindQ = bone.quaternion.clone();

    const dofOut = {};
    let anyMeasurable = false;

    for (const [name, spec] of Object.entries(def.dofs)) {
      if (spec.twist) {
        // Twist: Drehung um die eigene Kettenachse — erzeugt am Kettenende
        // keine messbare Bewegung (plan.md 3.5). Kennzeichnung gegen das
        // stille Setzen auf 1 mit falscher Quelle.
        //
        // Die Spiegelung gilt trotzdem: sie ist Katalogwissen, keine Messung.
        // Bis zum 2. September 2026 sprang dieser Zweig mit sign 1 heraus,
        // bevor mirror ausgewertet wurde — hip_r.twist drehte damit nach
        // innen, wo sein eigener Text „nach außen" versprach.
        dofOut[name] = {
          axis: spec.axis,
          sign: spec.mirror && def.joint.endsWith('_r') ? -1 : 1,
          ...grenzeFuer(def.joint, name, spec),
          richtung: spec.richtung,
          signSource: 'nicht_messbar',
        };
        continue;
      }

      // Abtastachse: Knochen-lokale Achse aus dem Katalog in Weltkoordinaten
      // gedreht (Bind-Pose-Orientierung des Knochens).
      const localAxis = new THREE.Vector3(
        spec.axis === 'x' ? 1 : 0,
        spec.axis === 'y' ? 1 : 0,
        spec.axis === 'z' ? 1 : 0,
      );
      const worldAxis = localAxis.applyQuaternion(bindQ).normalize();

      // Wirkungsrichtung: die Achse, auf der der Name des Freiheitsgrads eine
      // Bewegung verspricht. Nie die Drehachse selbst — die Verschiebung
      // parallel zur Drehachse ist bei einer Drehung strukturell 0.
      const richtung = ACHSENVEKTOR[spec.moves];
      if (!richtung) {
        throw new Error(`Gelenk ${def.joint}.${name}: Wirkungsrichtung „${spec.moves}“ unbekannt — erwartet x, y oder z (Skelett mit ${ctx.bones.length} Knochen)`);
      }

      const before = end.getWorldPosition(new THREE.Vector3());
      const qProbe = new THREE.Quaternion().setFromAxisAngle(worldAxis, probeRad);
      bone.quaternion.copy(bindQ).premultiply(qProbe);
      ctx.skeleton.update();
      ctx.scene.updateMatrixWorld(true);
      const after = end.getWorldPosition(new THREE.Vector3());
      bone.quaternion.copy(bindQ);
      ctx.skeleton.update();
      ctx.scene.updateMatrixWorld(true);

      const dWorld = after.clone().sub(before);
      const measured = dWorld.dot(richtung);

      if (!Number.isFinite(measured) || Math.abs(measured) < deadMove) {
        // Bewegung am Kettenende unterhalb der Nachweisgrenze: nicht messbar,
        // ausdrücklich gekennzeichnet — nicht stillschweigend 1.
        dofOut[name] = {
          axis: spec.axis, sign: 1, ...grenzeFuer(def.joint, name, spec),
          richtung: spec.richtung,
          signSource: 'nicht_messbar',
        };
        notMeasurableCount++;
        continue;
      }

      const mirrored = spec.mirror && def.joint.endsWith('_r');
      const want = spec.want * (mirrored ? -1 : 1);
      let sign = Math.sign(measured) === Math.sign(want) ? 1 : -1;
      if (invert[`${def.joint}.${name}`]) {
        sign = -sign;         // Testhaken Negativfall: künstlich invertiert
      }
      dofOut[name] = {
        axis: spec.axis, sign, ...grenzeFuer(def.joint, name, spec),
        richtung: spec.richtung,
        signSource: 'gemessen',
        measured: r4(measured),      // Welt-verschiebung am Kettenende in Metern
      };
      anyMeasurable = true;
      measurableCount++;
    }

    joints[def.joint] = {
      bone: bone.name,
      dof: dofOut,
      signSource: anyMeasurable ? 'gemessen' : 'nicht_messbar',
    };
  }

  restoreBind(ctx);

  return {
    joints,
    counts: { measurable: measurableCount, notMeasurable: notMeasurableCount },
    warnings,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Gelenkgrenzen am Modell messen (statt sie aus einem Katalog zu übernehmen)
//
// Belegt (docs/journal/buehne-befunde-2026-09-02.md, Befund E): der anatomische
// Katalog erlaubt `arm.swing -130`, `arm.lift 100` und `knee.bend 150`. Am
// Bild steckt der Oberarm im Kopf und der Unterschenkel im Oberschenkel, und
// kein Werkzeug meldet es. docs/journal/nachlese-2026-09-01.md Punkt 3 beschreibt dieselbe Sorte
// Fehler eine Ebene tiefer: die Ellbogenachse stand als Handbuchwissen im
// Katalog, statt gemessen zu werden.
//
// Verfahren: den Kanal aus der Bind-Pose heraus schrittweise aufdrehen und
// nach jedem Schritt prüfen, ob sich zwei Hautdreiecke schneiden. Der letzte
// schnittfreie Winkel ist die Grenze. Das Kriterium ist binär — Haut in Haut
// oder nicht — und braucht keine Abstandsschwelle, die von der Vertexdichte
// des Modells abhinge.
//
// Drei Dinge, die am Xbot gemessen wurden und ohne die das Verfahren falsche
// Zahlen liefert:
//
// 1. NUR INNERHALB DESSELBEN MESHES. In der Bind-Pose schneiden sich am Xbot
//    157 Dreieckspaare an der Schulter, 140 am Ellbogen, 113 am Knie —
//    ausnahmslos `Beta_Joints × Beta_Surface`. Das Modell bringt ein zweites
//    Mesh mit Gelenkkappen mit, das konstruktiv in der Außenhaut steckt.
//    Meshübergreifend gerechnet wäre schon die Ruhepose eine Kollision.
//
// 2. DIE GELENKREGION BLEIBT AUSSEN VOR. Beim Beugen schiebt sich die Haut in
//    der Beuge zusammen und schneidet sich selbst. Das ist Skinning, keine
//    Kollision: die Schnitte sitzen alle wenige Zentimeter vom Gelenk. Ohne
//    Ausschluss liefert das Verfahren knee.bend 40° statt 129° und elbow.bend
//    35° statt 127° — die
//    Figur wäre unbeweglich. Ausgeschlossen wird, was näher am Gelenk liegt
//    als die Summe der beiden GEMESSENEN Kapselradien (Knie 15,2 cm, Ellbogen
//    10,2 cm, Schulter 22,2 cm am Xbot).
//
// 3. NUR EINDEUTIG ZUGEORDNETE DREIECKE. Ein Dreieck zählt zu einem Segment,
//    wenn alle drei Ecken ausschließlich von Knochen dieses Segments gewichtet
//    werden. Am Xbot fallen dadurch 157 von 49 112 Dreiecken weg — 0,3 %.
//
// Was das Verfahren NICHT kann: Grenzen, an denen keine Haut auf Haut trifft.
// Die Schulter stoppt im echten Körper durch Bänder und das Schulterblatt,
// nicht durch Selbstberührung; `arm.swing` schwingt am Modell bis -150° frei.
// Dort bleibt der Katalogwert stehen und heißt `anatomisch`. Die Herkunft
// steht deshalb pro Kanal und pro Richtung, nicht pro Gelenk.
//
// Gemessen wird jeder Kanal ISOLIERT aus der Bind-Pose, alle anderen auf 0.
// Echte Gelenkgrenzen sind gekoppelt — die Schulter kann bei angelegtem Arm
// anderes als bei gehobenem. Das Verfahren liefert die Grenze in Neutral-
// stellung, nicht mehr.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verfahrensparameter der Grenzmessung. AGENTS.md Regel 1: unvermeidbar, aber
 * an einer Stelle, mit Begründung, und im Ergebnis ausgegeben.
 *
 *  schrittGrad  Grobraster des Sweeps. 10° hält den Lauf bezahlbar; feiner
 *               wird ausschließlich um den gefundenen Übergang herum gesucht.
 *  feinGrad     Auflösung der anschließenden Bisektion. 1° ist die Einheit,
 *               in der der Agent Winkel setzt — feiner brächte ihm nichts.
 *  zellgroesseAnteil
 *               Kantenlänge einer Gitterzelle als Anteil der Körperhöhe
 *               (1,1 % = 2,0 cm am Xbot). Reiner Geschwindigkeitsparameter:
 *               das Gitter filtert nur vor, das Ergebnis hängt nicht daran.
 *  ausschluss   Wie weit um das Gelenk herum Schnitte als Hautfaltung gelten.
 *               'radiensumme' heißt: die Summe der beiden gemessenen
 *               Kapselradien. Eine Setzung — aber eine aus dem Modell
 *               abgeleitete, keine eingetippte Zahl.
 */
export const GRENZ_PARAMS = {
  schrittGrad: 10,
  feinGrad: 1,
  zellgroesseAnteil: 0.011,
  ausschluss: 'radiensumme',
};

/**
 * Die vier Entwicklungsclips. `run`, `headShake` und `sneak_pose` bleiben der
 * Abnahme vorbehalten (AGENTS.md, Regel 3) und zaehlen hier nicht mit.
 */
export const REFERENZ_CLIPS = new Set(['idle', 'walk', 'agree', 'sad_pose']);

/**
 * Welche Winkel die mitgelieferten Animationen je Kanal tatsaechlich fahren.
 *
 * Wozu: eine Gelenkgrenze, gegen die eine ausgelieferte Animation DESSELBEN
 * Modells verstoesst, ist widerlegt. Am Xbot klemmte der anatomische Katalog
 * head.bend bei 30 Grad, waehrend `agree` 35,2 Grad faehrt, und
 * shoulder_l.fwd bei 25 Grad gegen 26,4 gefahrene. Das Kriterium kommt aus dem
 * Modell, nicht aus einer gewaehlten Zahl (docs/journal/buehne-befunde-2026-09-02.md,
 * Nachlese zu Auftrag E).
 *
 * Gemessen wird die Drehung gegen die Bind-Pose, um die Katalogachse zerlegt
 * und durch das gemessene Vorzeichen geteilt — also in derselben Groesse, in
 * der `limit` steht und der Agent seine Winkel setzt.
 *
 * @param {object} gltf  geladenes GLB mit `animations` und Skelett
 * @returns {Map<string, {min: number, max: number}>}  Schluessel "gelenk.kanal"
 */
export function clipSpannen(gltf) {
  const out = new Map();
  if (!gltf || !Array.isArray(gltf.animations) || gltf.animations.length === 0) return out;

  const { joints } = measureJoints(gltf);
  let skeleton = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton; });
  if (!skeleton) return out;
  const bind = new Map(skeleton.bones.map((b) => [b.name, b.quaternion.clone()]));

  for (const clip of gltf.animations) {
    if (!REFERENZ_CLIPS.has(clip.name)) continue;
    const spuren = new Map();
    for (const t of clip.tracks) {
      if (t.name.endsWith('.quaternion')) spuren.set(t.name.slice(0, -11), t);
    }
    for (const [gelenk, j] of Object.entries(joints)) {
      const spur = spuren.get(j.bone);
      const qb = bind.get(j.bone);
      if (!spur || !qb) continue;
      for (const [kanal, d] of Object.entries(j.dof ?? {})) {
        const schluessel = `${gelenk}.${kanal}`;
        let e = out.get(schluessel);
        if (!e) { e = { min: 0, max: 0 }; out.set(schluessel, e); }
        const achse = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2;
        for (let i = 0; i < spur.values.length / 4; i++) {
          const q = [spur.values[i * 4], spur.values[i * 4 + 1],
            spur.values[i * 4 + 2], spur.values[i * 4 + 3]];
          const inv = [-qb.x, -qb.y, -qb.z, qb.w];
          const dq = [
            inv[3] * q[0] + inv[0] * q[3] + inv[1] * q[2] - inv[2] * q[1],
            inv[3] * q[1] - inv[0] * q[2] + inv[1] * q[3] + inv[2] * q[0],
            inv[3] * q[2] + inv[0] * q[1] - inv[1] * q[0] + inv[2] * q[3],
            inv[3] * q[3] - inv[0] * q[0] - inv[1] * q[1] - inv[2] * q[2],
          ];
          let grad = 2 * Math.atan2(dq[achse], dq[3]) * 180 / Math.PI;
          if (grad > 180) grad -= 360;
          if (grad < -180) grad += 360;
          const w = grad / (d.sign || 1);
          if (!Number.isFinite(w)) continue;
          if (w < e.min) e.min = w;
          if (w > e.max) e.max = w;
        }
      }
    }
  }
  return out;
}

/**
 * Weitet anatomische Schranken auf, gegen die die Referenzclips verstossen.
 *
 * Nur `anatomisch` wird aufgeweitet: hinter einer `gemessen`-Grenze steht ein
 * Haut-auf-Haut-Kontakt, also ein Beleg GEGEN die Bewegung. Faehrt ein Clip
 * dort hinein, ist das Selbstdurchdringung und Sache der Physikpruefung, keine
 * Gelenkgrenze.
 *
 * Beidseitig: der Katalog fuehrt die Grenzen ausdruecklich auf beiden Seiten
 * identisch. `agree` winkt nur mit links — ohne Spiegelung waere die Figur
 * danach einseitig beweglicher als vorher.
 *
 * @param {object} limits                Ergebnis der Kollisionsmessung, "gelenk.kanal" -> Eintrag
 * @param {Map<string, object>} spannen  Ergebnis von clipSpannen
 * @returns {string[]}  je aufgeweiteter Richtung eine Zeile fuer den Bericht
 */
export function weiteAnClips(limits, spannen) {
  const bericht = [];
  const gegen = (k) => (k.includes('_l.') ? k.replace('_l.', '_r.')
    : k.includes('_r.') ? k.replace('_r.', '_l.') : null);

  for (const [schluessel, s] of spannen) {
    const paare = [schluessel, gegen(schluessel)].filter((k) => k && limits[k]);
    if (paare.length === 0) continue;

    for (const [seite, idx, verstoss] of [
      ['min', 0, s.min < (limits[schluessel]?.limit?.[0] ?? 0)],
      ['max', 1, s.max > (limits[schluessel]?.limit?.[1] ?? 0)],
    ]) {
      if (!verstoss) continue;
      const gefahren = seite === 'min' ? s.min : s.max;
      for (const k of paare) {
        const e = limits[k];
        if (e.source[seite] !== 'anatomisch') continue;   // gemessener Beleg bleibt
        const alt = e.limit[idx];
        const neu = Math.round(seite === 'min' ? Math.min(alt, gefahren) : Math.max(alt, gefahren));
        if (neu === alt) continue;
        e.limit[idx] = neu;
        e.source[seite] = 'gemessen';
        bericht.push(`${k} ${seite === 'min' ? 'unten' : 'oben'} ${alt}° → ${neu}° `
          + `(Referenzclip faehrt ${gefahren.toFixed(1)}°)`);
      }
    }
  }
  return bericht;
}

/**
 * Das spiegelbildliche Segment: thigh_l ↔ thigh_r. `null`, wenn es keins gibt.
 *
 * Warum es ausgenommen wird: eine Gelenkgrenze ist das, was das Gelenk selbst
 * begrenzt. Beim isolierten Messen steht das gegenüberliegende Glied in
 * Neutralstellung direkt daneben — beim Gehen ist es woanders. Am Xbot
 * klemmte hip.spread dadurch bei 5° (foot_l gegen shin_r), während walk
 * 10,9° fährt. Ausgenommen wird die ganze gespiegelte Kette, nicht nur das
 * eine Segment: der Fuß trifft den Unterschenkel der Gegenseite. Zwei Glieder,
 * die in einer Haltung ineinanderstecken, meldet die Physikprüfung
 * (src/validate/physics.js, Prüfung 2); das ist keine Grenze des Gelenks.
 */
function spiegel(segId) {
  if (segId.endsWith('_l')) return `${segId.slice(0, -2)}_r`;
  if (segId.endsWith('_r')) return `${segId.slice(0, -2)}_l`;
  return null;
}

/** Ist `bone` der Knochen selbst oder ein Nachfahre von `vorfahr`? */
function istNachfahre(bone, vorfahr) {
  let cur = bone;
  while (cur) {
    if (cur === vorfahr) return true;
    cur = cur.parent && cur.parent.isBone ? cur.parent : null;
  }
  return false;
}

/**
 * Hautdreiecke mit eindeutiger Segmentzugehörigkeit.
 *
 * Ein Dreieck zählt zu Segment S, wenn alle drei Ecken ausschließlich von
 * Knochen aus S gewichtet werden. Ecken mit Gewicht auf zwei Segmenten sind
 * die Übergangszone am Gelenk; ihre Dreiecke fallen weg.
 */
function hautDreiecke(ctx) {
  const meshes = [];
  ctx.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const tris = [];
  let verworfen = 0, gesamt = 0;

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    const bones = m.skeleton ? m.skeleton.bones : ctx.bones;
    const segOfBone = segmentDerKnochen(ctx.rollen, bones);
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    const anzahl = m.geometry.attributes.position.count;
    if (!si || !sw) {
      throw new Error(`Grenzmessung abgelehnt: SkinnedMesh „${m.name || 'unbenannt'}“ mit ${anzahl} Vertices ohne skinIndex/skinWeight — Segmentzuordnung unmöglich`);
    }

    const segOfVertex = new Array(anzahl).fill(null);
    for (let i = 0; i < anzahl; i++) {
      let seg = null, eindeutig = true;
      for (let k = 0; k < 4; k++) {
        if (sw.getComponent(i, k) <= 0) continue;
        const b = bones[si.getComponent(i, k)];
        const s = b ? (segOfBone.get(b) ?? null) : null;
        if (seg === null) seg = s;
        else if (seg !== s) { eindeutig = false; break; }
      }
      segOfVertex[i] = eindeutig ? seg : null;
    }

    const idx = m.geometry.index;
    const dreiecke = idx ? idx.count / 3 : anzahl / 3;
    gesamt += dreiecke;
    for (let t = 0; t < dreiecke; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const seg = segOfVertex[a];
      if (seg !== null && segOfVertex[b] === seg && segOfVertex[c] === seg) {
        tris.push({ mi, mesh: m, ecken: [a, b, c], seg });
      } else {
        verworfen++;
      }
    }
  }
  return { meshes, tris, gesamt, verworfen };
}

/**
 * Weltpositionen einer Vertexmenge eines Meshes in der aktuell anliegenden
 * Pose. Einmal je Vertex, nicht je Dreieck — ein Vertex gehört im Schnitt zu
 * sechs Dreiecken.
 */
function posiere(mesh, ziel) {
  const v = new THREE.Vector3();
  for (const i of ziel.keys()) {
    mesh.getVertexPosition(i, v);
    mesh.localToWorld(v);
    ziel.set(i, [v.x, v.y, v.z]);
  }
}

/**
 * Misst die Gelenkgrenzen am Modell.
 *
 * @param {{scene: THREE.Object3D}} gltf  Ergebnis von loadGLB
 * @param {object} [opts]
 * @param {string[]} [opts.joints]  nur diese Gelenke messen (sonst alle)
 * @param {number} [opts.ausschlussRadius]  Faktor auf die Radiensumme; 0
 *   schaltet den Ausschluss der Gelenkregion ab (Negativfall der Tests).
 * @returns {{limits: object, params: object, warnings: string[], ms: number,
 *   dreiecke: {gesamt: number, zugeordnet: number, verworfen: number}}}
 */
export function measureJointLimits(gltf, opts = {}) {
  const t0 = Date.now();
  const ctx = contextMitKorrekturen(gltf, opts);
  const { joints } = measureJoints(gltf, opts);
  const { segments } = measureSegments(ctx);
  const radiusVon = new Map(segments.map((s) => [s.id, s.radius]));
  const ausschlussFaktor = opts.ausschlussRadius ?? 1;
  const nurGelenke = opts.joints ? new Set(opts.joints) : null;
  const zellgroesseM = ctx.height * GRENZ_PARAMS.zellgroesseAnteil;

  ctx.bindSaved = new Map();
  for (const b of ctx.bones) {
    ctx.bindSaved.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }
  applyBindPose(ctx);

  const { meshes, tris, gesamt, verworfen } = hautDreiecke(ctx);
  const warnings = [];
  const nichtMessbar = [];
  const limits = {};

  for (const def of JOINT_CATALOG) {
    if (nurGelenke && !nurGelenke.has(def.joint)) continue;
    const rBone = ctx.rollen.get(def.bone);
    const gemessen = joints[def.joint];
    if (!rBone || !gemessen) {
      warnings.push(`Gelenk ${def.joint}: Rolle ${def.bone} in diesem Skelett mit ${ctx.bones.length} Knochen nicht erkannt — Grenzen bleiben anatomisch`);
      continue;
    }
    const bone = rBone.bone;

    // Was bewegt sich mit? Die Frage wird je VERTEX beantwortet, nicht je
    // Segment: ein Segment kann mehrere Knochen umfassen (torso reicht vom
    // Becken bis zum Hals), von denen nur ein Teil unter dem Gelenk hängt.
    // Segmentweise gerechnet stand der halbe Rumpf still, während spine ihn
    // verformte — spine.side klemmte dadurch bei 2°.
    const bewegtVertex = new Map();
    for (const m of meshes) {
      const mb = m.skeleton ? m.skeleton.bones : ctx.bones;
      const si = m.geometry.attributes.skinIndex;
      const sw = m.geometry.attributes.skinWeight;
      const flags = new Uint8Array(m.geometry.attributes.position.count);
      for (let i = 0; i < flags.length; i++) {
        for (let k = 0; k < 4; k++) {
          if (sw.getComponent(i, k) <= 0) continue;
          const b = mb[si.getComponent(i, k)];
          if (b && istNachfahre(b, bone)) { flags[i] = 1; break; }
        }
      }
      bewegtVertex.set(m, flags);
    }
    const bewegteTris = [], stehendeTris = [];
    for (const t of tris) {
      const f = bewegtVertex.get(t.mesh);
      const n = f[t.ecken[0]] + f[t.ecken[1]] + f[t.ecken[2]];
      if (n === 3) bewegteTris.push(t);
      else if (n === 0) stehendeTris.push(t);
      // gemischt: Dreieck wird beim Drehen verzerrt, es gehört keiner Seite
    }

    // Die gespiegelte Kette begrenzt dieses Gelenk nicht: bewegt sich das
    // linke Bein, sind thigh_r, shin_r und foot_r keine Gelenkgrenze.
    const gespiegelteKette = new Set();
    for (const t of bewegteTris) {
      const g = spiegel(t.seg);
      if (g) gespiegelteKette.add(g);
    }
    if (bewegteTris.length === 0 || stehendeTris.length === 0) {
      // Kein Fehler, sondern der Normalfall an der Wurzel: dreht das Becken,
      // dreht die ganze Figur mit, und es gibt keine stehende Seite, gegen
      // die etwas stoßen könnte. Solche Gelenke behalten ihre Katalogwerte.
      // Als Warnung im Rig-Bericht wäre das Rauschen — dort steht, was am
      // Modell auffällig ist, nicht was das Verfahren strukturell nicht kann.
      nichtMessbar.push(`${def.joint}: ${bewegteTris.length} bewegte und ${stehendeTris.length} stehende Dreiecke — an diesem Gelenk kann keine Selbstberührung entstehen`);
      continue;
    }

    // Stehende Seite einmal posieren und ins Gitter legen.
    const stehendePunkte = new Map();
    for (const m of meshes) stehendePunkte.set(m, new Map());
    for (const t of stehendeTris) {
      const ziel = stehendePunkte.get(t.mesh);
      for (const i of t.ecken) if (!ziel.has(i)) ziel.set(i, null);
    }
    for (const m of meshes) posiere(m, stehendePunkte.get(m));
    const gitter = new Kollisionsgitter(zellgroesseM);
    for (let i = 0; i < stehendeTris.length; i++) {
      const t = stehendeTris[i];
      const p = stehendePunkte.get(t.mesh);
      gitter.einfuegen(i, p.get(t.ecken[0]), p.get(t.ecken[1]), p.get(t.ecken[2]));
    }

    const bewegtePunkte = new Map();
    for (const m of meshes) bewegtePunkte.set(m, new Map());
    for (const t of bewegteTris) {
      const ziel = bewegtePunkte.get(t.mesh);
      for (const i of t.ecken) if (!ziel.has(i)) ziel.set(i, null);
    }

    const bindQ = bone.quaternion.clone();

    /** Erstes schneidendes Segmentpaar bei diesem Agentenwinkel, oder null. */
    const schnittBei = (grad, spec, sign) => {
      const localAxis = new THREE.Vector3(
        spec.axis === 'x' ? 1 : 0, spec.axis === 'y' ? 1 : 0, spec.axis === 'z' ? 1 : 0);
      const worldAxis = localAxis.applyQuaternion(bindQ).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(worldAxis, (grad * sign) * Math.PI / 180);
      bone.quaternion.copy(bindQ).premultiply(q);
      ctx.skeleton.update();
      ctx.scene.updateMatrixWorld(true);

      for (const m of meshes) posiere(m, bewegtePunkte.get(m));
      const gelenkOrt = bone.getWorldPosition(new THREE.Vector3());

      for (const t of bewegteTris) {
        const p = bewegtePunkte.get(t.mesh);
        const a = p.get(t.ecken[0]), b = p.get(t.ecken[1]), c = p.get(t.ecken[2]);
        // Schwerpunkt des Dreiecks: sein Abstand zum Gelenk entscheidet, ob
        // der Schnitt Hautfaltung ist oder eine echte Kollision.
        const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
        const abstand = Math.hypot(mx - gelenkOrt.x, my - gelenkOrt.y, mz - gelenkOrt.z);
        for (const j of gitter.kandidaten(a, b, c)) {
          const s = stehendeTris[j];
          if (s.mi !== t.mi) continue;               // andere Meshes stecken konstruktiv ineinander
          if (gespiegelteKette.has(s.seg)) continue; // die Gegenseite steht nur zufaellig daneben
          if (abstand < ausschlussFaktor * ((radiusVon.get(t.seg) ?? 0) + (radiusVon.get(s.seg) ?? 0))) continue;
          const q0 = stehendePunkte.get(s.mesh);
          if (dreieckSchnitt(a, b, c, q0.get(s.ecken[0]), q0.get(s.ecken[1]), q0.get(s.ecken[2]))) {
            return `${t.seg}|${s.seg}`;
          }
        }
      }
      return null;
    };

    for (const [name, spec] of Object.entries(def.dofs)) {
      const dof = gemessen.dof[name];
      const sign = dof ? (dof.sign ?? 1) : 1;
      const eintrag = {
        limit: [spec.limit[0], spec.limit[1]],
        source: { min: 'anatomisch', max: 'anatomisch' },
        treffer: { min: null, max: null },
      };
      for (const seite of ['min', 'max']) {
        const schranke = seite === 'min' ? spec.limit[0] : spec.limit[1];
        if (schranke === 0) continue;               // nichts aufzudrehen
        const richtung = Math.sign(schranke);
        let frei = 0, paar = null, treffer = null;
        for (let g = GRENZ_PARAMS.schrittGrad; g <= Math.abs(schranke); g += GRENZ_PARAMS.schrittGrad) {
          paar = schnittBei(g * richtung, spec, sign);
          if (paar) { treffer = g; break; }
          frei = g;
        }
        if (!treffer && Math.abs(schranke) % GRENZ_PARAMS.schrittGrad !== 0) {
          paar = schnittBei(schranke, spec, sign);
          if (paar) treffer = Math.abs(schranke);
        }
        if (!treffer) continue;                     // kein Schnitt: Katalog bleibt

        // Zwischen dem letzten freien und dem ersten schneidenden Schritt
        // bisektieren, bis feinGrad erreicht ist.
        let unten = frei, oben = treffer, letztesPaar = paar;
        while (oben - unten > GRENZ_PARAMS.feinGrad) {
          const mitte = Math.round((unten + oben) / 2);
          if (mitte === unten || mitte === oben) break;
          const p = schnittBei(mitte * richtung, spec, sign);
          if (p) { oben = mitte; letztesPaar = p; } else { unten = mitte; }
        }
        eintrag.limit[seite === 'min' ? 0 : 1] = unten * richtung;
        eintrag.source[seite] = 'gemessen';
        eintrag.treffer[seite] = letztesPaar;
      }
      limits[`${def.joint}.${name}`] = eintrag;
    }

    bone.quaternion.copy(bindQ);
    ctx.skeleton.update();
    ctx.scene.updateMatrixWorld(true);
  }

  restoreBind(ctx);

  // Nach dem Einengen das Aufweiten: die Kollisionsmessung kann eine Schranke
  // nur enger machen. Eine Schranke, gegen die eine ausgelieferte Animation
  // desselben Modells verstoesst, ist aber widerlegt — am Xbot klemmte
  // head.bend bei 30 Grad, waehrend `agree` 35,2 faehrt.
  const aufgeweitet = weiteAnClips(limits, clipSpannen(gltf));

  return {
    limits,
    aufgeweitet,
    params: {
      schrittGrad: GRENZ_PARAMS.schrittGrad,
      feinGrad: GRENZ_PARAMS.feinGrad,
      zellgroesseM: r4(zellgroesseM),
      ausschluss: GRENZ_PARAMS.ausschluss,
    },
    dreiecke: { gesamt, zugeordnet: tris.length, verworfen },
    nichtMessbar,
    warnings,
    ms: Date.now() - t0,
  };
}

/** Setzt alle Knochen strikt auf die bei collectContext gesicherte Bind-Pose
 *  zurück und aktualisiert MatrixWorld. */
export function applyBindPose(ctx) {
  for (const [name, saved] of ctx.bindSaved) {
    const bone = ctx.byName.get(name);
    if (bone) {
      bone.quaternion.copy(saved.q);
      bone.position.copy(saved.p);
    }
  }
  ctx.skeleton.update();
  ctx.scene.updateMatrixWorld(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bind-Pose-Ruheabstände (Grundlage der Durchdringungsprüfung, plan.md 3.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst den Bind-Pose-Oberflächenabstand ALLER Segmentpaare, in Metern und
 * MIT VORZEICHEN: negativ, wo sich die Kapseln schon in der Bind-Pose
 * überschneiden. An einem gemeinsamen Gelenk beginnt die Kapsel erst einen
 * gemessenen Radius hinter dem Gelenk; die konstruktive Berührung selbst wird
 * damit nicht als Durchdringung gespeichert.
 *
 * @returns {Object<string, number>} {"segmentA|segmentB": Abstand in Metern}
 */
export function measureRestDistances(gltf, opts = {}) {
  const ctx = contextMitKorrekturen(gltf, opts);
  const { segments, achsen } = measureSegments(ctx);
  const radiusById = new Map(segments.map((s) => [s.id, s.radius]));
  const caps = new Map();
  for (const s of SEGMENTS) {
    if (!radiusById.has(s.id)) continue;
    const paar = achsen.get(s.id);
    if (paar) {
      const [ba, bb] = paar;
      caps.set(s.id, [ba.getWorldPosition(new THREE.Vector3()), bb.getWorldPosition(new THREE.Vector3())]);
    }
  }
  const ids = [...caps.keys()];

  // ALLE Paare eintragen, auch die zehn Gelenkpaare. Früher wurden sie
  // grundsätzlich ausgelassen; ein vollständig in den Oberschenkel
  // eingeklappter Unterschenkel war dadurch strukturell unsichtbar. Die
  // gekürzten Achsen lassen die normale Gelenkregion frei, aber nicht die
  // Überbeugung dahinter (Bühnenbefund D).
  //
  // Nicht nur in der Bind-Pose nahe Paare eintragen:
  // nahen. Die frühere Schranke (5 % Körperhöhe) ließ am Xbot 22 von 82
  // Paaren übrig — ohne torso|hand_l und ohne torso|forearm_l. Eine Hand im
  // Rumpf konnte deshalb gar nicht gemeldet werden: das Paar existierte in
  // der Prüfung nicht. Die T-Pose sagt nichts darüber, welche Körperteile
  // sich später nahe kommen; sie hält die Arme gerade weit weg.
  //
  // Eingetragen wird der OBERFLÄCHENabstand MIT VORZEICHEN. Negativ heißt:
  // die Kapseln überschneiden sich schon in der Bind-Pose — am Xbot
  // torso|thigh_r mit -0,16 m, weil die Radien das 90. Perzentil der
  // Hüllpunkte sind. Genau dieser Betrag ist für die Physikprüfung die
  // Untergrenze dessen, was das Kapselmodell selbst erzeugt; ein Abschneiden
  // bei 0 hätte ihn verschwiegen (src/validate/physics.js, Prüfung 2).
  const restDistances = {};
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const [a1, a2] = caps.get(a);
      const [b1, b2] = caps.get(b);
      const A = SEGMENTS.find((s) => s.id === a);
      const B = SEGMENTS.find((s) => s.id === b);
      if (!A || !B) continue;
      const [aa1, aa2, bb1, bb2] = kapselachsenAmGelenk(
        a1, a2, b1, b2, A, B, radiusById.get(a), radiusById.get(b));
      restDistances[`${a}|${b}`] =
        r4(segSegDist(aa1, aa2, bb1, bb2) - (radiusById.get(a) + radiusById.get(b)));
    }
  }
  return restDistances;
}

/** Gemeinsamer Rollenendpunkt zweier Segmentdefinitionen, sonst null. */
function gemeinsamesSegmentgelenk(A, B) {
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      if ([A.from, A.to][a] === [B.from, B.to][b]) return { a, b };
    }
  }
  return null;
}

/** Schneidet die Kapselachse am gemeinsamen Gelenk um ihren gemessenen Radius. */
function kuerzeKapselachse(p0, p1, ende, radius) {
  const out = [p0.clone(), p1.clone()];
  const joint = out[ende];
  const other = out[1 - ende];
  const laenge = joint.distanceTo(other);
  if (!(laenge > 0) || !(radius > 0)) return out;
  out[ende].lerp(other, Math.min(radius, laenge / 2) / laenge);
  return out;
}

/** Kapselachsen eines Paares; Nachbarn ohne konstruktive Gelenküberdeckung. */
function kapselachsenAmGelenk(a1, a2, b1, b2, A, B, rA, rB) {
  const geteilt = gemeinsamesSegmentgelenk(A, B);
  if (!geteilt) return [a1, a2, b1, b2];
  return [
    ...kuerzeKapselachse(a1, a2, geteilt.a, rA),
    ...kuerzeKapselachse(b1, b2, geteilt.b, rB),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Komplettprofil (plan.md 5.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misst das komplette RigProfile gemäß docs/journal/plan.md 5.1 aus der Bind-Pose.
 *
 * @param {{scene: THREE.Object3D}} gltf  Ergebnis von loadGLB
 * @param {{fileName?: string}} [opts]
 * @returns {object} RigProfile (schemaVersion 1)
 * @throws {Error} wenn das Modell nicht vermessen werden kann. Jede Meldung
 *   enthält eine Zahl (AGENTS.md, Handwerkliches).
 */
export function measureRigProfile(gltf, opts = {}) {
  // Kontext über die ERKANNTE Rollentabelle; tragen die Bestätigungen des
  // Menschen (opts.roles, opts.bestaetigteRollen aus dem Tool-Store) eine
  // andere Zuordnung ein, baut contextMitKorrekturen den Kontext neu und die
  // gesamte Vermessung darunter läuft über die korrigierten Rollen —
  // Segmente, Massen, Sohlen, Gelenke, Ruheabstände, alle aus derselben
  // Messung wie beim ersten Mal (BEFUND: spikes/rollen/BEFUND.md). Ein
  // Bestätigen derselben Zuordnung kostet keinen zweiten Lauf.
  const ctx = contextMitKorrekturen(gltf, opts);
  const warnings = [];
  const radiusPercentile = opts.radiusPercentile ?? RADIUS_PERCENTILE;

  // Bind-Pose sichern, damit die Abtastung sie restaurieren kann.
  ctx.bindSaved = new Map();
  for (const b of ctx.bones) {
    ctx.bindSaved.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }
  applyBindPose(ctx);

  // Rollen: aus der geometrischen Erkennung, nicht aus Namen.
  //
  // Drei Zonen nach plan.md 5.1, alle drei:
  //   ab 0,90        sicher — wird gemessen, fertig.
  //   0,50 bis 0,90  der Mensch wird gefragt. Gemessen wird trotzdem: die
  //                  Erkennung HAT einen Kandidaten, sie ist sich seiner nur
  //                  nicht sicher. Die Rolle trägt ihre gemessene Konfidenz
  //                  und die Marke `confirm`, die Warnung nennt die Zahl. Die
  //                  Rückfrage samt Optionen liegt im Erkennungsbericht
  //                  (detect.js `questions`), die Antwort des Menschen kommt
  //                  über confirm_role als opts.roles zurück und ersetzt die
  //                  Zuordnung.
  //   unter 0,50     kein Kandidat. Ablehnung, mit geometrischer Begründung.
  //
  // Vorher gab es nur „sicher“ oder „abgelehnt“. Das kostete 7 von 10 fremden
  // Modellen die Vermessung — darunter Michelle, ein Mixamo-Rig mit 65 Knochen,
  // das an seiner eigenen Unsicherheit (foot_l 0,58) starb, nicht an Namen.
  const roles = {};
  for (const role of PFLICHTROLLEN) {
    const r = ctx.rollen.get(role);
    if (!r) {
      throw new Error(
        `Vermessung abgelehnt: Pflichtrolle ${role} ohne Kandidaten über der Frageschwelle ${ROLLE_MINDESTENS.toFixed(2)}`
        + ` (${ctx.bones.length} Knochen, ${ctx.rollen.size} vergebene Rollen,`
        + ` Achsenwert ${ctx.bericht.world.achsenWert}, ${ctx.bericht.questions.length} offene Rückfragen)`
        + ' — Modell wird abgelehnt statt geraten'
      );
    }
    roles[role] = { bone: r.bone.name, confidence: r.confidence };
    if (r.confidence < ROLLE_SICHER && r.quelle !== 'bestaetigt') {
      roles[role].confirm = true;
      const belege = ctx.bericht.evidence.rollen?.[role];
      warnings.push(
        `Pflichtrolle ${role} auf „${r.id}“ nur mit Konfidenz ${r.confidence.toFixed(2)} erkannt`
        + ` (sicher ab ${ROLLE_SICHER.toFixed(2)}, gefragt ab ${ROLLE_MINDESTENS.toFixed(2)},`
        + ` ${ctx.bones.length} Knochen geprüft, Achsenwert ${ctx.bericht.world.achsenWert})`
        + (belege ? ` — schwächster Beleg: ${schwaechsterBeleg(belege, ctx.bericht.world.achsenWert)}` : '')
        + ' — gemessen, aber bestätigungsbedürftig: der Mensch wird gefragt'
      );
    }
  }
  // Rollen unterhalb 0,9, die kein Pflichtfeld sind, stehen als Rückfrage im
  // Erkennungsbericht (detect.js `questions`) — dort gehören sie hin, dorthin
  // antwortet der Mensch. Sie werden hier nicht zusätzlich als Warnung
  // ausgegeben: eine Warnung meint einen Befund an der MESSUNG.

  // Segmente, Massen, Schwerpunkt, Standfläche.
  // Die Verfahrensparameter des Aufrufers müssen hier durchgerechnet werden —
  // sonst meldet das Profil params.radiusPercentile 0,5, hat aber mit 0,9
  // gemessen (Beleg: measure.test.mjs „Verfahrensparameter“: alle 14 Radien
  // blieben identisch, thigh_l 0,0977 m, obwohl params auf 0,5 stand).
  const { segments, massBySeg, comBySeg, achsen, uebersprungen } = measureSegments(ctx, opts);
  warnings.push(...uebersprungen);
  let totalMass = 0;
  const com = new THREE.Vector3();
  for (const s of segments) {
    const m = massBySeg.get(s.id);
    totalMass += m;
    com.addScaledVector(comBySeg.get(s.id), m);
  }
  com.divideScalar(totalMass);
  const solePts = [...ctx.soleVertsL, ...ctx.soleVertsR].map((p) => [p.x, p.z]);
  if (solePts.length < 3) {
    throw new Error(`Standfläche nicht messbar: nur ${solePts.length} Vertices in Bodennähe (Toleranz ${ctx.soleTolMeters.toFixed(4)} m)`);
  }
  const supportPolygon = convexHull2D(solePts);
  const comInsideFootprint = pointInHull([com.x, com.z], supportPolygon);
  if (!comInsideFootprint) {
    warnings.push(`Schwerpunkt der Bind-Pose liegt außerhalb der Standfläche (${com.x.toFixed(4)}, ${com.z.toFixed(4)}) — Standfläche mit ${supportPolygon.length} Ecken`);
  }

  // Radien-Hüllenprüfung (Abnahmekriterium „Radien“): der gemeldete Radius wird
  // gegen die Mesh-Hülle je Segment gerechnet.
  //
  // Verfahrensparameter: RADIUS_DEVIATION_MAX = 15 %, bezogen auf die
  // Segmenthülle. Der Bezug war hier zuerst die Körperhöhe (plan.md Kapitel 4:
  // „alle Toleranzen relativ zur Körperhöhe“); das macht die Prüfung untätig —
  // für jeden denkbaren Radius: die größte gemessene Segmenthülle ist der Rumpf
  // mit 0,1937 m bei 1,8093 m Körperhöhe. Einen Radius von 0 gemessen betrüge
  // die Abweichung damit 10,7 % der Körperhöhe, immer noch unter der Grenze von
  // 15 %. Ein halbierte Schenkelradius (0,0977 → 0,0489 m) ergibt 4,4 % der
  // Körperhöhe: unbemerkt. Gegen die Segmenthülle gerechnet sind es 52,6 %:
  // gemeldet. Die Grenze bleibt skalierungsunabhängig, weil sie zwei
  // Körperlängen ins Verhältnis setzt.
  // Beleg: src/rig/measure.test.mjs, Reihe „Radien“.
  const radiusCheck = [];
  for (const s of segments) {
    const verts = worldVertsOfSegment(ctx, s.id);
    const paar = achsen.get(s.id);
    if (!paar || verts.length === 0) continue;
    const [ba, bb] = paar;
    const a = ba.getWorldPosition(new THREE.Vector3());
    const b = bb.getWorldPosition(new THREE.Vector3());
    const hue = meshHuelle(verts, a, b, 10, radiusPercentile);
    if (!(hue.huelle > 0)) continue;
    const dev = Math.abs(hue.huelle - s.radius) / hue.huelle;
    radiusCheck.push({
      id: s.id, radius: s.radius, hullRadius: r5(hue.huelle),
      hullMax: r5(hue.groesster), deviationFraction: r4(dev),
    });
  }
  for (const r of radiusCheck.filter((x) => x.deviationFraction > RADIUS_DEVIATION_MAX)) {
    warnings.push(`Segment ${r.id}: Radius ${r.radius.toFixed(4)} m weicht ${(r.deviationFraction * 100).toFixed(1)} % von der Mesh-Hülle dieses Segments (${r.hullRadius.toFixed(4)} m Stationshülle, ${r.hullMax.toFixed(4)} m höchste Ausdehnung) ab — Grenze ${(RADIUS_DEVIATION_MAX * 100).toFixed(0)} %`);
  }

  // Sohlen + Sohlenabdeckung (Abnahmekriterium „Sohlen“: 60 % der Fußlänge).
  const { soles, stats: soleStats } = measureSolesCore(ctx);
  for (const tag of ['l', 'r']) {
    const st = soleStats[tag];
    if (st && st.footLength > 0 && st.coverage < SOLE_COVERAGE_MIN) {
      warnings.push(`Sohle ${tag}: erkannte Fläche deckt ${(st.coverage * 100).toFixed(0)} % der Fußlänge (${st.soleLength.toFixed(4)} m von ${st.footLength.toFixed(4)} m) ab — unter der Grenze von ${(SOLE_COVERAGE_MIN * 100).toFixed(0)} %`);
    }
    // Zweiter, unabhängiger Befund derselben Lage: die Ferse hängt in der Luft.
    // Abdeckung und Fersenanhebung können auseinanderlaufen (breiter Fuß, der
    // nur vorn aufsetzt), deshalb wird beides gemeldet, nicht eines aus dem
    // anderen abgeleitet.
    if (st && st.heelLiftMeters !== null && st.heelLiftMeters >= CONTACT_MARGIN) {
      warnings.push(`Sohle ${tag}: Ferse steht ${st.heelLiftMeters.toFixed(4)} m über dem Ballen (tiefster Fersenpunkt y ${st.heelLowY.toFixed(4)} m gegen tiefsten Zehenpunkt y ${st.toeLowY.toFixed(4)} m) — über dem Kontaktzuschlag von ${CONTACT_MARGIN.toFixed(4)} m, der Fuß liegt nicht flach auf`);
    }
  }

  // Gelenke: Vorzeichen messen, Grenzen am Modell suchen.
  //
  // Die Grenzmessung kostet am Xbot 1,9 s gegenüber 0,13 s für den
  // Rest des Profils — sie dreht jeden Kanal durch und prüft nach jedem
  // Schritt auf Selbstdurchdringung. Das ist der Preis dafür, dass die
  // Grenzen aus dem Modell kommen statt aus einem Handbuch. Sie läuft einmal
  // je geladenem Modell. `opts.grenzenMessen: false` schaltet sie ab; die
  // Grenzen heißen dann wieder durchgehend `anatomisch`, wie vor dieser
  // Messung (docs/journal/plan.md 6.1 in seiner alten Fassung).
  const probeDeg = opts.probeDeg ?? PROBE_DEG;
  let grenzen = null;
  if (opts.grenzenMessen !== false) {
    grenzen = measureJointLimits(gltf, { ...opts, probeDeg });
    warnings.push(...grenzen.warnings);
  }
  const measured = measureJoints(gltf, { ...opts, probeDeg, limits: grenzen });
  warnings.push(...measured.warnings);

  // Ruheabstände.
  const restDistances = measureRestDistances(gltf, opts);

  // Knochenliste: id, Elternteil, Bind-Pose-Weltposition.
  const bonesOut = ctx.bones.map((b) => ({
    id: b.name,
    parent: b.parent && b.parent.isBone ? b.parent.name : null,
    bindWorld: (() => {
      const p = b.getWorldPosition(new THREE.Vector3());
      return [r4(p.x), r4(p.y), r4(p.z)];
    })(),
  }));

  restoreBind(ctx);

  return {
    schemaVersion: 1,
    source: {
      file: opts.fileName ?? 'unbenannt.glb',
      boneCount: ctx.bones.length,
      vertexCount: ctx.vertexCount,
    },
    // Knochen, an denen ueberhaupt Haut haengt. Wer das nicht hat, kann auch
    // nicht im Boden stecken — siehe MIN_HAUT_GEWICHT.
    skinnedBones: [...ctx.knochenMitHaut].sort(),
    world: {
      up: 'y',
      forward: 'z',
      left: 'x',
      groundY: r5(ctx.minY),
      height: r4(ctx.height),
      unitsPerMeter: 1.0,
    },
    bones: bonesOut,
    roles: {
      pelvis: roles.pelvis,
      foot_l: roles.foot_l,
      foot_r: roles.foot_r,
    },
    joints: measured.joints,
    segments,
    soles,
    restDistances,
    params: {
      radiusPercentile: opts.radiusPercentile ?? RADIUS_PERCENTILE,
      soleTolerance: SOLE_TOLERANCE,
      contactMargin: CONTACT_MARGIN,
      // Verfahrensparameter der Grenzmessung, damit im Rig-Bericht steht,
      // wie fein gesucht und was um das Gelenk herum ausgeschlossen wurde.
      grenzen: grenzen ? grenzen.params : null,
    },
    warnings,
  };
}

export default measureRigProfile;
