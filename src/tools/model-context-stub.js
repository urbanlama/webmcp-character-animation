// Nachbau von `document.modelContext` fuer Node-Tests.
//
// Bildet genau die API nach, die in Chrome 151 gemessen wurde (AGENTS.md,
// "WebMCP, gemessene Fakten"): registerTool, getTools, executeTool. executeTool
// nimmt die Argumente als JSON-String und gibt einen String zurueck — das ist
// die gemessene Form, nicht eine bequemere.
//
// Nur fuer Tests. Im Browser wird das echte document.modelContext uebergeben.

export function createModelContextStub() {
  const werkzeuge = new Map();

  return {
    async registerTool(def) {
      werkzeuge.set(def.name, def);
      return true;
    },

    /** Was der Agent sieht. Ohne execute — genau wie im Browser. */
    getTools() {
      return [...werkzeuge.values()].map(({ name, description, inputSchema }) =>
        ({ name, description, inputSchema }));
    },

    /** @param {string} name @param {string} argsAlsJsonString */
    async executeTool(name, argsAlsJsonString) {
      const def = werkzeuge.get(name);
      if (!def) return JSON.stringify({ error: `unbekanntes Werkzeug: ${name}` });
      const args = argsAlsJsonString ? JSON.parse(argsAlsJsonString) : {};
      return JSON.stringify(await def.execute(args));
    }
  };
}
