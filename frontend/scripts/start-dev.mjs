import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(frontendRoot, "..");
const runtimeDataRoot = path.join(workspaceRoot, ".pandoshare");
const apiScript = path.join(workspaceRoot, "backend", "src", "server", "index.js");
const gatewayScript = path.join(workspaceRoot, "backend", "src", "gateway", "index.js");
const viteBin = path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js");

const children = [];
const backgroundMode = process.env.PANDO_DEV_BACKGROUND === "1";

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: backgroundMode ? ["ignore", "inherit", "inherit"] : "inherit",
    windowsHide: backgroundMode,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    console.error(`${label} exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
    if (code && code !== 0) {
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

console.log(`Pando Agent repository root: ${workspaceRoot}`);
console.log(`Pando Agent runtime data: ${runtimeDataRoot}`);

const sharedEnv = {
  PANDO_WORKSPACE_ROOT: workspaceRoot,
};

start("api", process.execPath, [apiScript, "--host", "127.0.0.1", "--port", "3001"], {
  cwd: workspaceRoot,
  env: sharedEnv,
});
start("gateway", process.execPath, [gatewayScript], {
  cwd: workspaceRoot,
  env: sharedEnv,
});
start("ui", process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "8765", "--strictPort"], {
  cwd: frontendRoot,
  env: {
    ...sharedEnv,
    VITE_PANDOSHARE_API_TARGET: "http://127.0.0.1:3001",
    VITE_PANDOSHARE_API_FALLBACK: "http://127.0.0.1:3001",
  },
});
