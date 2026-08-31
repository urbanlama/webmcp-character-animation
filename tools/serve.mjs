#!/usr/bin/env node
// Statischer Datei-Server für die Entwicklung. Kein Express, nur node:http.
//
//   node tools/serve.mjs            → Port 8000
//   PORT=8080 node tools/serve.mjs  → Port 8080
//   PORT=0    node tools/serve.mjs  → frei zugeteilter Port, steht in der
//                                     Startmeldung
//
// Bedient das Repo-Root (das Verzeichnis über tools/). Windows-kompatibel:
// Pfade über path.join/posix, keine shell-spezifischen Aufrufe.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// PORT=0 ist erlaubt: der Betriebssystem-Port wird dann frei gewählt und
// korrekt ausgegeben — nötig, wenn belegte Ports einen Test nicht blocken sollen.
const PORT = process.env.PORT !== undefined && process.env.PORT !== ''
  ? Number(process.env.PORT)
  : 8000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Pfad-Escape blocken: aufgelöst muss der Pfad unter ROOT bleiben.
    const filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 verweigert');
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 nicht gefunden: ${pathname}`);
      return;
    }
    if (fileStat.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 nicht gefunden: ${pathname} (Verzeichnis)`);
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 interner Fehler: ' + err.message);
  }
});

server.listen(PORT, () => {
  // Ausgegeben wird der tatsächlich gebundene Port — bei PORT=0 ist das nicht
  // der gesetzte Wert, sondern die Zuteilung des Betriebssystems.
  console.log(`Server läuft: http://localhost:${server.address().port}/ (Root: ${ROOT})`);
});