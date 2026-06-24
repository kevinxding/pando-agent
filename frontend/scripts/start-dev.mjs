import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(frontendRoot, "..");
const apiScript = path.join(workspaceRoot, "backend", "src", "server", "index.js");
const viteBin = path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js");

const children = [];

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...(options.env ?? {}) },
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

start("api", process.execPath, [apiScript, "--host", "127.0.0.1", "--port", "3001"], {
  cwd: workspaceRoot,
});
start("ui", process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "8765", "--strictPort"], {
  cwd: frontendRoot,
  env: {
    VITE_PANDOSHARE_API_TARGET: "http://127.0.0.1:3001",
    VITE_PANDOSHARE_API_FALLBACK: "http://127.0.0.1:3001",
  },
});