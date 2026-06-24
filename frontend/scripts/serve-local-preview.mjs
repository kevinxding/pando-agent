import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const host = args.get("--host") || "127.0.0.1";
const port = Number(args.get("--port") || "5188");
const backend = args.get("--backend") || "http://127.0.0.1:8765";
const logPath = path.join(rootDir, ".preview-server.log");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyApi(req, res) {
  const target = new URL(req.url || "/", backend);
  const headers = { ...req.headers, host: target.host };
  const body = await readRequestBody(req);
  const response = await fetch(target, {
    method: req.method,
    headers,
    body,
  });
  const responseHeaders = Object.fromEntries(response.headers.entries());
  delete responseHeaders["content-length"];
  res.writeHead(response.status, responseHeaders);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://local");
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(distDir, `.${requestedPath}`);

  if (!filePath.startsWith(distDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(distDir, "index.html");
  const ext = path.extname(finalPath);
  const contentType = contentTypes.get(ext) || "application/octet-stream";
  send(res, 200, fs.readFileSync(finalPath), { "content-type": contentType });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/")) {
    proxyApi(req, res).catch((error) => {
      send(res, 502, JSON.stringify({ error: String(error?.message || error) }), {
        "content-type": "application/json; charset=utf-8",
      });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(port, host, () => {
  fs.appendFileSync(
    logPath,
    `[${new Date().toISOString()}] preview=http://${host}:${port}/ backend=${backend}` + "\n",
  );
});
