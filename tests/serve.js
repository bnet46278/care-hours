// A tiny web server for the tests: serves the Care Hours folder (one level up) at http://localhost:4173.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(root, rel);
  // Only serve files inside the app folder, and never the tests themselves.
  if (!file.startsWith(root) || file.startsWith(path.join(root, "tests"))) { res.writeHead(404).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  });
}).listen(port, () => console.log(`Care Hours test server on http://localhost:${port}`));
