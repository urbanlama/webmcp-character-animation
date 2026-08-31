// Zusammenbau der Werkzeugschicht, AP7.
//
// Eine Zeile im Browser:
//   const schicht = await createToolLayer({ modelContext: document.modelContext });
//
// In Node laeuft dasselbe ohne modelContext; die Werkzeuge sind dann ueber
// schicht.getTools() und schicht.rufe(name, args) erreichbar — das ist der
// Weg, auf dem die Tests dieses Pakets aufrufen.

import { createStore, leererZustand } from './state.js';
import { createRegistry } from './registry.js';
import { baueWerkzeuge } from './handlers.js';
import { attrappenPorts } from './ports.js';
import { createAskBroker, BUDGET_STANDARD } from '../ui/ask-human.js';

export { KATALOG, KATALOG_GROESSE, VERBEN, INTENT_ARTEN, ANSICHTEN } from './catalog.js';
export { createStore, leererZustand, fingerabdruck } from './state.js';
export { createAskBroker } from '../ui/ask-human.js';
export { attrappenPorts } from './ports.js';

/**
 * @param {object} opt
 * @param {object} [opt.modelContext] `document.modelContext`, wenn vorhanden
 * @param {object} [opt.ports]        Anschluesse; Standard sind die Attrappen
 * @param {number} [opt.budget]       Fragen pro Auftrag, plan.md 6.7
 * @param {object} [opt.zustand]      Startzustand, z. B. aus einer Sitzung
 */
export async function createToolLayer({
  modelContext = null,
  ports = attrappenPorts(),
  budget = BUDGET_STANDARD,
  zustand = leererZustand()
} = {}) {
  const store = createStore(zustand);
  const ask = createAskBroker({ budget });
  const registry = createRegistry({ modelContext });

  for (const werkzeug of baueWerkzeuge({ store, ask, ports })) {
    await registry.registriere(werkzeug);
  }

  return {
    store,
    ask,
    registry,
    getTools: () => registry.getTools(),
    rufe: (name, args) => registry.rufe(name, args)
  };
}
