#!/usr/bin/env node
/**
 * Server HTTPS estático para testear la galería en el Quest 3 vía WiFi local.
 * WebXR exige contexto seguro (HTTPS) para orígenes que no sean localhost.
 *
 * Uso:  node serve-https.js
 * Luego, en el Meta Browser del Quest:  https://<IP-de-la-Mac>:8443
 * (aceptar una vez la advertencia de certificado auto-firmado)
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 8443;
const ROOT = path.join(__dirname, "docs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const options = {
  key: fs.readFileSync(path.join(__dirname, "certs", "key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "certs", "cert.pem")),
};

const server = https.createServer(options, (req, res) => {
  // Decodifica %20 etc. y previene path traversal.
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end("No encontrado: " + urlPath); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
  });
});

function localIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  🦇  Buenos Aires by Night — El Archivo (HTTPS)\n");
  console.log("  En el Meta Browser del Quest 3 (misma WiFi), entrá a:\n");
  for (const ip of localIPs()) {
    console.log(`     https://${ip}:${PORT}`);
  }
  console.log(`\n  (local)  https://localhost:${PORT}`);
  console.log("\n  La primera vez el Quest avisa que el certificado no es de confianza:");
  console.log("  tocá 'Advanced' / 'Avanzado' → 'Proceed' / 'Continuar'. Es tu propio cert, es seguro.\n");
});
