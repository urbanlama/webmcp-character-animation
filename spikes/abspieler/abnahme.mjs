// Finale Abnahme: step (echtes gebautes? prüfen) / crouch + takeoff über die Timeline,
// dann Play über die Leiste, Knochenbewegung messen.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const fehl = [];
const ok = (name, cond, msg) => { if (cond) console.log(`✔ ${name}`); else { console.log(`✖ ${name}: ${msg}`); fehl.push(name); } };

await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__boot?.bereit === true, null, { timeout: 15000 });

const ausstand = await page.evaluate(() => {
  const w = document.getElementById('abs-leiste');
  return { da: !!w, grau: w.classList.contains('abs-aus'),
    grund: (w.querySelector('.abs-grund')?.textContent ?? '').trim(),
    grundSichtbar: w.querySelector('.abs-grund')?.hidden === false,
    schieberZu: w.querySelector('.abs-schieber')?.disabled };
});
ok('Auszustand: Leiste da, grau, Grund sichtbar',
  ausstand.da && ausstand.grau && ausstand.grundSichtbar && ausstand.grund.length > 0, JSON.stringify(ausstand));

// Das Beispielmodell lädt beim Start von selbst; auf einen Knopf zu warten
// wäre veraltet.
await page.waitForFunction(() => document.body.classList.contains('hat-modell'), null, { timeout: 20000 });

// crouch + takeoff + airborne + land sind gebaut (GEBAUTE_VERBEN): ein Hopser.
await page.evaluate(async () => {
  await window.__tools.rufe('set_duration', { frameCount: 60 });
  await window.__tools.rufe('add_phase', { verb: 'crouch', from: 0, to: 14, params: { tiefe: 0.2 } });
  await window.__tools.rufe('add_phase', { verb: 'takeoff', from: 15, to: 25, params: { vy: 2.5 } });
  await window.__tools.rufe('add_phase', { verb: 'airborne', from: 26, to: 44, params: {} });
  await window.__tools.rufe('add_phase', { verb: 'land', from: 45, to: 59, params: {} });
  window.__abspieler.pruefe();
});

const vorLoesung = await page.evaluate(() => {
  // frische Timeline OHNE Phasen simulieren: leere Phasenliste gibt frameCount>0,
  // der Löser liefert dann Hold-Frames — die Leiste muss trotzdem abspielbereit sein.
  const a = window.__abspieler;
  return a.stand();
});
ok('Nach dem Lösen bereit mit Frame 1 / 60',
  vorLoesung.bereit && vorLoesung.frameText === 'Frame 1 / 60', JSON.stringify(vorLoesung));

// Knochenstellung beim Abspielen messen
const aufnahme = await page.evaluate(() => new Promise((done) => {
  const a = window.__abspieler;
  const sammle = () => {
    const m = {};
    window.__scene.model.traverse((o) => { if (o.isBone) m[o.name] = o.matrixWorld.elements.slice(13).map((x) => +x.toFixed(5)); });
    return m;
  };
  a.anfahren(0);
  const vor = sammle();
  a.umschalten();                       // Play bei 1x ab Frame 1
  setTimeout(() => {
    const nach = sammle();
    let veraendert = 0;
    for (const k of Object.keys(nach)) {
      if ((vor[k] ?? []).some((x, i) => Math.abs(x - nach[k][i]) > 1e-4)) veraendert++;
    }
    done({ veraendert, stand: a.stand() });
  }, 1500);
}));
ok('Abspielen bewegt Knochen auf dem Modell',
  aufnahme.veraendert > 0, JSON.stringify({ veraendert: aufnahme.veraendert, stand: aufnahme.stand }));

// Tempo und Schieber
const bedien = await page.evaluate(() => {
  const a = window.__abspieler;
  a.anfahren(19);
  const s = a.stand();
  let abgelehnt = '';
  try { a.setzeTempo(4); } catch (e) { abgelehnt = e.message; }
  return { text: s.frameText, tempo: a.setzeTempo(0.5), abgelehnt };
});
ok('Schieber/anfahren stellt Frame 20 / 60', bedien.text === 'Frame 20 / 60', JSON.stringify(bedien));
ok('Tempo-Stufen: 0.5x wirksam, 4x abgelehnt', bedien.tempo === 0.5 && /0\.25x, 0\.5x, 1x/.test(bedien.abgelehnt),
  JSON.stringify(bedien));

await page.screenshot({ path: 'spikes/abspieler/abnahme.png' });
await browser.close();
if (fehl.length > 0) { console.log(`\n${fehl.length} FEHLER`); process.exit(1); }
console.log('\nalle Abnahmeprüfungen grün');
