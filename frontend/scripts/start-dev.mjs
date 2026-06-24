import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiScript = path.join(rootDir, "scripts", "dev-api-server.mjs");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

const children = [];

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: false,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      shutdown(code);
    }
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("api", process.execPath, [apiScript, "--host", "127.0.0.1", "--port", "3001"]);
start(
  "ui",
  process.execPath,
  [viteBin, "--host", "127.0.0.1", "--port", "8765", "--strictPort"],
  {
    VITE_PANDOSHARE_API_TARGET: "http://127.0.0.1:3001",
    VITE_PANDOSHARE_API_FALLBACK: "http://127.0.0.1:3001",
  },
);
