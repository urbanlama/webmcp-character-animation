#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Prüfstand: stehen alle Verfahrensparameter an einer Stelle?
//
// AGENTS.md: „Verfahrensparameter wie Perzentile oder Toleranzen sind unver-
// meidbar. Sie stehen an einer Stelle, mit Begründung, und werden im Rig-
// Bericht ausgegeben." Dieses Skript misst, ob das im Quelltext unter src/
// stimmt. Es ändert nichts, es schreibt nur auf.
//
// Aufruf:   node tools/parameter-pruefstand.mjs
// Ausgabe:  Tabelle aller Funde nach Kategorie, dann der Abgleich gegen die
//           in docs/plan.md Kapitel 4 festgelegten Werte, dann die Bilanz.
// Das Skript ist wiederholbar und stürzt nicht ab, wenn eine Datei fehlt.
//
// Verfahren (deterministisch, gleiche Eingabe — gleiche Tabelle):
//
//   Fund A — BENANNTE KONSTANTE: `const NAME = <Zahlenausdruck>` bzw. Objekt-
//   Container mit numerischen Einträgen (`GEWICHT.boden: 400`). Gesucht wird
//   `export const`, `const` und `let` mit reinem Zahlenausdruck; bei Containern
//   wird jeder numerische Eintrag eigener Fund mit dem Namen `CONTAINER.feld`.
//
//   Fund B — VERSTECKTES ZAHLENLITERAL: eine Zahl in Berechnung oder Vergleich,
//   die nicht in einer benannten Deklaration steht. Ausgefiltert sind
//   "offensichtliche" Nicht-Parameter:
//     - die Integers 0 bis 4 (Indizes, Vektorkomponenten, Hautgewichte k < 4)
//     - Hex-Zahlen (GLB-Magic, Byte-Offsets — Dateistruktur)
//     - Zahlen in Strings und Kommentaren
//     - Zahlen zwischen einzelnen eckigen Klammern [N] (Array-Zugriff)
//     - Zahlen in Darstellungsaufrufen (.toFixed, .slice, Math.pow …)
//     - Zahlen in Meldungs-/Fehlerzeilen (throw, fehler(), issues.push …) —
//       dort sind Multiplikatoren wie *100 Anzeigeumrechnung, kein Parameter
//
//   Begründung: zu jedem Fund werden die Kommentarzeilen unmittelbar darüber
//   (plus Kommentar am Zeilenende) eingesammelt. Gilt als Begründung, wer
//   mindestens 80 Zeichen Kommentar oder eines der Begründungswörter trägt
//   (weil, deshalb, damit, gemessen, ausgemessen, belegt, Grenze, groß genug,
//   klein genug, Referenz, plan.md …). Das ist eine Schwelle wie jede andere:
//   sie steht hier, mit Zahl, und wird in der Ausgabe genannt.
//
// Kategorien (Auftrag):
//   1 zentral und begründet        — benannte Konstante mit Begründungskommentar
//   2 benannt, aber ohne Begründung — Konstante ohne erklärenden Kommentar
//   3 versteckt                    — Zahl mitten im Code, ohne Namen
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(REPO, 'src');

// ── Schwellen dieses Prüfstands (Verfahrensparameter, mit Begründung) ────────

/** Mindestlänge des Umgebungskommentars in Zeichen, ab der eine Begründung
 *  angenommen wird, auch ohne Begründungswort. 80 Zeichen sind mehr als ein
 *  Satzfragment wie "nicht ändern" und weniger als eine vollständige
 *  Begründung ("warum dieser Wert und nicht der Nachbarwert"). */
const BEGRUENDUNG_MIN_ZEICHEN = 80;

/** Höchste Dateigröße in Zeilen, die eine Quelldatei haben darf, damit sie
 *  eingelesen wird. 20000 ist das Doppelte der längsten Quelldatei des Repos
 *  (src/rig/detect.js, 1468 Zeilen) und schützt nur vor kaputten Dateien. */
const MAX_ZEILEN = 20000;

/** Begründungswörter: eines davon im Umgebungskommentar genügt. */
const BEGRUENDUNG_WOERTER =
  /weil|denn\b|deshalb|darum|damit\b|gemessen|ausgemessen|belegt|Grenze|Grenzen|Referenz|Referenzen|vergleichen|Vergleich|groß genug|klein genug|gross genug|mindestens|unterhalb| oberhalb|plan\.md|AGENTS\.md|Abnahme|Vorgabe|Beweis|Beleg|Faktor|Rauschen|referenzclip|Referenzclip|Genauigkeit|Näherung|Spekifikation/i;

/** Zahlen, die in JEDEM Programm dieselbe feste Bedeutung tragen und deshalb
 *  kein Verfahrensparameter sind: Einheiten- und Formelkonstanten.
 *    9.81   — Erdbeschleunigung g (als Literal in Ballistik-Formeln)
 *    180/pi — Radiant-Grad-Umrechnung, Math.PI-Kehrwert (als 57.29… messbar)
 *    100, 1000, 1024 — Prozent-, Promille- und KB-Umrechnung
 *    0.5, 0.25 — Ballistik-Term -0.5·g·t² bzw. Quaternion-Formel 0.25·s
 *    1e-6 … 1e-15 — numerische Epsilon-Grenzen (Maschinengenauigkeit)
 *    16 — Anzahl Matrixelemente (glTF-Matrix); 4 — Vektorkomponenten
 * Die Aufnahme ist eine Einschätzung des Prüfstands, keine Befreiung:
 * jede dieser Zeilen steht trotzdem in der Tabelle, wenn sie kein Muster
 * dieses Filters trägt. */
const STRUKTURZAHLEN = /(Math\.PI|Math\.log10|\b1e-6\b|\b1e-7\b|\b1e-9\b|\b1e-12\b|\b1e-14\b|\b1e-15\b|\b0\.5\s*\*\s*G\b|0\.25\s*\*\s|9\.81|\*100\b|\* 100\b|\/ 1024|\/ 1000|\? 16 :|e\.length < 16)/;

// ── Dateisammlung ─────────────────────────────────────────────────────────────

function sammleDateien(wurzel) {
  const out = [];
  let eintraege;
  try {
    eintraege = readdirSync(wurzel, { withFileTypes: true });
  } catch {
    return out;   // Quellordner fehlt: 0 Dateien, kein Absturz
  }
  for (const e of eintraege) {
    const pfad = join(wurzel, e.name);
    if (e.isDirectory()) out.push(...sammleDateien(pfad));
    else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(pfad);
  }
  return out.sort();
}

// ── Zeilen von Kommentaren und Strings befreien ──────────────────────────────
// Blockkommentare gehen über Zeilen hinweg; der Zustand wird mitgeführt.
// Template-Literale werden behandelt: der Text draußen fliegt, der Ausdruck
// in ${...} bleibt als Code stehen.

function stripiereZeilen(zeilen) {
  const out = [];
  let inBlock = false;
  for (const roh of zeilen) {
    if (roh.length > 100000) { out.push(''); continue; }
    let code = '';
    let i = 0;
    let zustand = 'code';          // code | sq | dq | tmpl | tmplCode
    const templateStapel = [];
    while (i < roh.length) {
      const c = roh[i];
      if (inBlock) {
        if (c === '*' && roh[i + 1] === '/') { inBlock = false; i += 2; } else i++;
        continue;
      }
      if (zustand === 'code') {
        if (c === '/' && roh[i + 1] === '/') break;           // Zeilenkommentar
        if (c === '/' && roh[i + 1] === '*') { inBlock = true; i += 2; continue; }
        if (c === "'") { zustand = 'sq'; i++; continue; }
        if (c === '"') { zustand = 'dq'; i++; continue; }
        if (c === '`') { zustand = 'tmpl'; i++; continue; }
        code += c; i++;
        continue;
      }
      if (zustand === 'sq' || zustand === 'dq') {
        if (c === '\\') { i += 2; continue; }
        if ((zustand === 'sq' && c === "'") || (zustand === 'dq' && c === '"')) zustand = 'code';
        i++;
        continue;
      }
      if (zustand === 'tmpl') {
        if (c === '\\') { i += 2; continue; }
        if (c === '$' && roh[i + 1] === '{') { zustand = 'tmplCode'; templateStapel.push('tmpl'); i += 2; continue; }
        if (c === '`') zustand = 'code';
        i++;
        continue;
      }
      if (zustand === 'tmplCode') {
        if (c === '/' && roh[i + 1] === '/') break;            // Kommentar im Ausdruck
        if (c === '/' && roh[i + 1] === '*') { inBlock = true; i += 2; continue; }
        if (c === "'") { templateStapel.push('sq'); zustand = 'sq'; i++; continue; }
        if (c === '"') { templateStapel.push('dq'); zustand = 'dq'; i++; continue; }
        if (c === '}') { zustand = templateStapel.pop() ?? 'code'; i++; continue; }
        code += c; i++;
        continue;
      }
    }
    out.push(code);
  }
  return out;
}

// ── Zahlen-Fundstelle in einer Code-Zeile ────────────────────────────────────

const ZAHL_MUSTER = /(?<![\w$.])(0[xX][0-9a-fA-F]+|-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))(?![\w$.])/g;

/** Zahlen aus Darstellungsaufrufen fliegen raus, bevor gescannt wird. */
function entferneDarstellung(code) {
  return code
    .replace(/\.(?:toFixed|toPrecision|toString|padStart|padEnd|substr|substring|slice|repeat|fromCharCode)\s*\([^()]*\)/g, '()')
    .replace(/\bMath\.pow\s*\([^()]*\)/g, '()');
}

function zahlIstStruktur(zeile, match) {
  const roh = match[1];
  if (/^0[xX]/.test(roh)) return true;                       // Hex: Dateistruktur
  if (Number.isInteger(Number(roh)) && Number(roh) >= 0 && Number(roh) <= 4) return true;
  const vor = zeile.slice(Math.max(0, match.index - 2), match.index).trimEnd();
  const nach = zeile.slice(match.index + match[0].length, match.index + match[0].length + 2).trimStart();
  if (vor.endsWith('[') && nach.startsWith(']')) return true; // [0] Indizierung
  // Einheiten- und Formelkonstanten, siehe STRUKTURZAHLEN.
  if (STRUKTURZAHLEN.test(zeile)) return true;
  // Zahlen in Regex-Zeichenklassen und Regex-Literalen sind Muster, keine Werte.
  if (/\/[^/]*a-z0-9[\w-]*[^/]*\//.test(zeile)) return true;
  return false;
}

// ── Benannte Deklarationen ───────────────────────────────────────────────────

const DECL =
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$\u00c0-\u024f]*)\s*=\s*(.*)$/;

/** Reiner Zahlenausdruck? Nur Zahlen und Arithmetik — kein Funktionsaufruf. */
function alsZahlenausdruck(rest) {
  const rest1 = rest.trim().replace(/;+$/, '').trim();
  if (rest1 === '') return null;
  if (!/^[-+*/().,%\s\d]*$/.test(rest1.replace(/[eE][+-]?\d+/g, '0'))) return null;
  if (!/\d/.test(rest1)) return null;
  try {
    const wert = Function('"use strict"; return (' + rest1 + ')')();
    if (typeof wert !== 'number' || !Number.isFinite(wert)) return null;
    return { wert, text: rest1 };
  } catch {
    return null;
  }
}

/** Numerische Werteliste [1, 0.72, 0.5]. */
function alsZahlenliste(rest) {
  const innen = rest.trim().replace(/;+$/, '').trim();
  if (!innen.startsWith('[') || !innen.endsWith(']')) return null;
  const körper = innen.slice(1, -1).trim();
  if (körper === '') return null;
  if (!/^[-+*/().,%\s\d]+$/.test(körper)) return null;
  if (!/\d/.test(körper)) return null;
  try {
    const arr = Function('"use strict"; return (' + innen + ')')();
    if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    return { wert: arr, text: innen };
  } catch {
    return null;
  }
}

/** Ende einer Container-Deklaration finden: Klammerbalance über Code-Zeilen. */
function containerEnde(codeZeilen, startZeile, oeffner) {
  const schliesser = oeffner === '{' ? '}' : ']';
  let tiefe = 0;
  for (let i = startZeile; i < codeZeilen.length && i - startZeile < MAX_ZEILEN; i++) {
    for (const c of codeZeilen[i]) {
      if (c === oeffner) tiefe++;
      else if (c === schliesser) { tiefe--; if (tiefe === 0) return i; }
    }
  }
  return -1;
}

/** Kommentarzeilen unmittelbar oberhalb der Zeile einsammeln. */
function umgebungKommentar(zeilen, zeile) {
  const teile = [];
  let i = zeile - 1;
  let luft = 0;
  while (i >= 0 && luft <= 2 && zeile - i < 30) {
    const roh = zeilen[i];
    if (/^\s*(┌|─|═|└|┘|├|│|\+-+\+|={3,}|-{10,})/.test(roh)) break;   // Trennbanner: kein Begründungsträger
    const m = roh.match(/^\s*(?:\/\*\*|\/\*|\*|\/\/)\s?(.*)$/);
    if (m) { teile.unshift(m[1]); luft = 0; }
    else if (roh.trim() === '') { luft++; }
    else break;
    i--;
  }
  // Kommentar am selben Zeilenende (nach einem Semikolon).
  const selbst = zeilen[zeile];
  const hinten = selbst.match(/\)\s*;\s*(\/\/|\/\*)\s?(.*)$/) ?? selbst.match(/;\s*\/\/\s?(.*)$/);
  if (hinten) teile.push(hinten[2]);
  return teile.join(' ').trim();
}

function hatBegruendung(kommentar) {
  return kommentar.length >= BEGRUENDUNG_MIN_ZEICHEN || BEGRUENDUNG_WOERTER.test(kommentar);
}

/** Ausschlusszeilen für Kategorie 3: Zähler, Anzeige- und Strukturrunden
 *  tragen Zahlen, die kein Verfahrensparameter sind. */
const KEIN_PARAMETER_ZEILE =
  // for-Stufen und while-Köpfe: Zähler, nicht Schwellen
  /^\s*(?:for|while)\b.*[,;]\s*\w+\+\+|^\s*for\s*\(|^\s*while\s*\(/
  || null;

function istZaehlerOderStruktur(roh) {
  if (KEIN_PARAMETER_ZEILE && KEIN_PARAMETER_ZEILE.test && KEIN_PARAMETER_ZEILE.test(roh)) return true;
  if (/^\s*(?:let|var)\s+(?:i|j|k|l|s|t|n|cnt|gez|schritte|runden|laufendeId|verbraucht|tiefe|luft)\b\s*(=|;)/.test(roh)) return true;
  if (/^\s*(?:let|var)\s+\w+\s*=\s*0\s*;?\s*(\/\/.*)?$/.test(roh)) return true;   // Akkumulator-Init
  if (/^\s*(?:let|var)\s+\w+\s*=\s*-1\s*;?\s*(\/\/.*)?$/.test(roh)) return true;
  if (/^\s*(?:let|var)\s+\w+\s*=\s*\[\s*0(?:\s*,\s*0)+\s*\]\s*;?\s*(\/\/.*)?$/.test(roh)) return true;
  // Deklarationen (oben bereits benannt erfasst) nicht doppelt zählen.
  if (/^\s*(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$\u00c0-\u024f]*\s*=/.test(roh)) return true;
  // Export-/Schema-Darstellungen (inputSchema-Baum des Werkzeugkatalogs).
  if (/minItems|maxItems|minimum|maximum|default:/.test(roh)) return true;
  return false;
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────

function pruefeStand() {
  const funde = [];
  const dateien = sammleDateien(SRC);

  for (const datei of dateien) {
    let rohText;
    try {
      rohText = readFileSync(datei, 'utf8');
    } catch (err) {
      funde.push({ kategorie: 3, name: '(Datei unlesbar)', wert: '—', ort: datei, note: String(err && err.code || err) });
      continue;
    }
    const zeilen = rohText.split(/\r?\n/);
    if (zeilen.length > MAX_ZEILEN) continue;
    const code = stripiereZeilen(zeilen);
    const rel = relative(REPO, datei).split(sep).join('/');
    const testdatenDatei = /testdaten\.mjs$/.test(datei);

    // Container-Zeilenbereiche sammeln: dort kein Literalscan, dafür Props.
    const containerBereiche = [];
    for (let i = 0; i < code.length; i++) {
      const m = code[i].match(DECL);
      if (!m) continue;
      const rest = m[2];
      const oeffner = rest.trim()[0] === '{' ? '{' : rest.trim().startsWith('[') ? '[' : null;
      if (!oeffner) continue;
      if (alsZahlenliste(rest) && rest.includes(']')) continue;   // einzeilig, unten als Fund
      const bis = containerEnde(code, i, oeffner);
      if (bis < 0) continue;
      containerBereiche.push({ von: i, bis, name: m[1] });
      i = bis;
    }
    const inContainer = (n) => containerBereiche.some((b) => n >= b.von && n <= b.bis);

    // A) benannte Skalarkonstanten und Wertelisten
    for (let i = 0; i < code.length; i++) {
      if (inContainer(i)) continue;
      const m = code[i].match(DECL);
      if (!m) continue;
      const name = m[1];
      const liste = alsZahlenliste(m[2]);
      const skal = liste ? null : alsZahlenausdruck(m[2]);
      if (!liste && !skal) continue;
      const kommentar = umgebungKommentar(zeilen, i);
      funde.push({
        kategorie: hatBegruendung(kommentar) ? 1 : 2,
        name,
        wert: liste ? liste.text : skal.text,
        ort: `${rel}:${i + 1}`,
        note: kommentar ? `Kommentar: „${kommentar.slice(0, 90)}${kommentar.length > 90 ? '…' : ''}“` : 'kein Kommentar',
        zahl: liste ? null : skal.wert,
      });
      continue;
    }

    // A2) numerische Einträge in Container-Objekten (PARAMS, GEWICHT, …)
    for (const b of containerBereiche) {
      for (let i = b.von; i <= b.bis; i++) {
        const propM = zeilen[i].match(
          /^\s*([^\s:,'][^\s:,]*)\s*:\s*(-?(?:0[xX][0-9a-fA-F]+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))\s*,\s*(\/\/.*)?$/
        );
        if (propM) {
          const kommentar = umgebungKommentar(zeilen, i);
          funde.push({
            kategorie: hatBegruendung(kommentar) ? 1 : 2,
            name: `${b.name}.${propM[1]}`,
            wert: propM[2],
            ort: `${rel}:${i + 1}`,
            note: kommentar ? `Kommentar: „${kommentar.slice(0, 90)}${kommentar.length > 90 ? '…' : ''}“` : 'kein Kommentar',
            zahl: Number(propM[2]),
          });
        }
      }
    }

    // B) versteckte Zahlenliterale
    for (let i = 0; i < code.length; i++) {
      if (inContainer(i)) continue;
      const roh = zeilen[i];
      // Meldungszeilen und Anzeigeumrechnungen: dort sind *100 und *1000
      //_cm-Anzeige, keine Parameter. Ebenso Testdaten (GLB-Vertexlisten).
      if (/throw new|fehler\(|warnings\.push|issue\(|WerkzeugFehler|WerkzeugMeldung|message:|note:|warnung|hinweis|grund:|meldung:|text:|frage:/.test(roh)) continue;
      if (istZaehlerOderStruktur(roh)) continue;
      if (testdatenDatei) continue;   // erzeugte GLB-Testkörper: Koordinaten, keine Parameter
      if (roh.includes('`')) continue;   // Meldungstexte: angezeigte Zahlen, keine Schwellen
      const zeileCode = entferneDarstellung(code[i]);
      // Fundstelle je Zahl im Code; Duplikate einer Zeile einzeln melden.
      const muster = new RegExp(ZAHL_MUSTER.source, 'g');
      let m;
      while ((m = muster.exec(zeileCode)) !== null) {
        if (zahlIstStruktur(zeileCode, m)) continue;
        funde.push({
          kategorie: 3,
          name: '(unbenannt)',
          wert: m[1],
          ort: `${rel}:${i + 1}`,
          note: `Zeile: ${roh.trim().slice(0, 110)}${roh.trim().length > 110 ? '…' : ''}`,
        });
      }
    }
  }
  return funde;
}

// ── Abgleich gegen docs/plan.md Kapitel 4 ────────────────────────────────────

function abgleichPlan(funde) {
  const gesucht = [
    {
      name: 'Radiusperzentil',
      ist: 0.9,
      musters: [/RADIUS_PERCENTILE/i, /radiusPercentile/],
    },
    {
      name: 'Sohlentoleranz (Kontaktschwelle)',
      ist: 0.035,
      musters: [/SOLE_TOLERANCE/i, /soleTolerance/, /KONTAKT_SCHWELLE_ANTEIL/],
    },
    {
      name: 'Kontaktzuschlag',
      ist: 0.015,
      musters: [/CONTACT_MARGIN/i, /contactMargin/],
    },
    {
      name: 'Abtastwinkel (Grad)',
      ist: 20,
      musters: [/PROBE_DEG/i, /probeDeg/],
    },
  ];
  const zeilen = [];
  for (const g of gesucht) {
    // Benannte Funde: Name passt zum Muster und der Wert stimmt exakt.
    const benannt = funde.filter((f) =>
      f.kategorie !== 3 && f.zahl === g.ist && g.musters.some((r) => r.test(f.name)));
    // Versteckte Zusatzfundstellen derselben Zahl in Zeilen, die den Parameter-
    // namen tragen (Fallback-Kopien wie `?? 0.035`).
    const versteckt = funde.filter((f) =>
      f.kategorie === 3 && Number(f.wert) === g.ist &&
      g.musters.some((r) => r.test(f.note)));
    zeilen.push({ name: g.name, ist: g.ist, treffer: [...benannt, ...versteckt] });
  }
  return zeilen;
}

// ── Ausgabe ──────────────────────────────────────────────────────────────────

function fmt(x, n) { return String(x).padEnd(n); }

function druckeTabelle(funde) {
  const titel = { 1: 'KATEGORIE 1 — zentral und begründet (benannte Konstante mit Begründung)',
    2: 'KATEGORIE 2 — benannt, aber ohne Begründung',
    3: 'KATEGORIE 3 — versteckt (Zahl mitten im Code, ohne Namen)' };
  for (const k of [1, 2, 3]) {
    const liste = funde.filter((f) => f.kategorie === k);
    console.log(`\n${titel[k]} — ${liste.length} Funde`);
    console.log('-'.repeat(100));
    for (const f of liste.sort((a, b) => a.ort.localeCompare(b.ort, 'de'))) {
      console.log(`${f.ort.padEnd(34)} ${String(f.name).padEnd(34)} Wert ${String(f.wert).padEnd(18)} ${f.note}`);
    }
  }
}

function druckePlanAbgleich(abgleich) {
  console.log('\n' + '='.repeat(100));
  console.log('ABGLEICH GEGEN docs/plan.md Kapitel 4');
  for (const z of abgleich) {
    if (z.treffer.length === 0) {
      console.log(`  ${z.name} (Soll ${z.ist}): NICHT im Code gefunden`);
      continue;
    }
    const benannt = z.treffer.filter((f) => f.kategorie !== 3);
    const versteckt = z.treffer.filter((f) => f.kategorie === 3);
    const erte = benannt.map((f) => `${f.name} = ${f.wert} (${f.ort})`);
    const verOrte = versteckt.map((f) => f.ort);
    console.log(`  ${z.name} (Soll ${z.ist}):`);
    if (benannt.length) {
      const deckungsgleich =
        benannt.length > 0 && benannt.every((f) => Math.abs(Number(f.wert) - z.ist) < 1e-12);
      console.log(`    benannt an ${benannt.length} Stelle${benannt.length === 1 ? '' : 'n'} (dokumentierter Wert ${deckungsgleich ? 'überall deckungsgleich' : 'ABWEICHEND: ' + benannt.map((f) => f.wert).join(', ')}):`);
      for (const f of benannt) console.log(`      ${f.name} = ${f.wert}  ${f.ort}`);
    } else {
      console.log('    NICHT als benannte Konstante gefunden');
    }
    if (verOrte.length) console.log(`    zusätzlich versteckt als Literale: ${verOrte.join(', ')}`);
  }
}

function druckeBilanz(funde, abgleich) {
  const z1 = funde.filter((f) => f.kategorie === 1).length;
  const z2 = funde.filter((f) => f.kategorie === 2).length;
  const z3 = funde.filter((f) => f.kategorie === 3).length;
  const gesamt = z1 + z2 + z3;
  const abw = [];
  for (const z of abgleich) {
    if (z.treffer.length === 0) { abw.push(`${z.name} (Soll ${z.ist}): im Code nicht gefunden`); continue; }
    const benannt = z.treffer.filter((f) => f.kategorie !== 3);
    if (benannt.length === 0) {
      abw.push(`${z.name} (Soll ${z.ist}): nur als verstecktes Literal gefunden`);
    } else if (!benannt.every((f) => Math.abs(Number(f.wert) - z.ist) < 1e-12)) {
      abw.push(`${z.name}: Code ${benannt.map((f) => f.wert).join(', ')} gegen Soll ${z.ist} (plan.md)`);
    }
  }
  console.log('\n' + '='.repeat(100));
  console.log('BILANZ');
  console.log(`  Funde gesamt: ${gesamt} — Kategorie 1 (zentral und begründet): ${z1}, Kategorie 2 (benannt ohne Begründung): ${z2}, Kategorie 3 (versteckt): ${z3}`);
  const anteil = gesamt ? Math.round((z1 / gesamt) * 100) : 0;
  console.log(`  ${z1} von ${gesamt} Funden (${anteil} %) sind zentral und begründet; ${z2 + z3} von ${gesamt} (${100 - anteil} %) sind ohne Begründung benannt oder gar versteckt.`);
  if (abw.length === 0) {
    console.log('  Abgleich mit plan.md Kapitel 4: alle vier dokumentierten Werte stehen im Code, jeder mit dem dokumentierten Zahlenwert.');
  } else {
    console.log('  ABWEICHUNGEN GEGEN plan.md Kapitel 4:');
    for (const a of abw) console.log(`    - ${a}`);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

const funde = pruefeStand();
console.log('Prüfstand: Verfahrensparameter im Quelltext unter src/');
console.log(`Geprüfte Dateien: ${sammleDateien(SRC).length} (ohne *.test.mjs), Begründungsschwelle: Kommentar ab ${BEGRUENDUNG_MIN_ZEICHEN} Zeichen oder Begründungswort.`);
druckeTabelle(funde);
const abgleich = abgleichPlan(funde);
druckePlanAbgleich(abgleich);
druckeBilanz(funde, abgleich);