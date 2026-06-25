import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.env.PANDO_WORKSPACE_ROOT
  ? path.resolve(process.env.PANDO_WORKSPACE_ROOT)
  : path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const guiRoot = process.env.PANDO_HUMAN_GUI_ROOT
  ? path.resolve(process.env.PANDO_HUMAN_GUI_ROOT)
  : "D:/Users/Lenovo/Desktop/dingxu_agent";

const runServer = path.join(guiRoot, "run_server.py");
const python = resolvePython();

if (!existsSync(runServer)) {
  console.error(`Dingxu Human GUI MCP entry not found: ${runServer}`);
  process.exit(1);
}

const child = spawn(python.command, [...python.args, runServer], {
  cwd: guiRoot,
  env: {
    ...process.env,
    PANDO_WORKSPACE_ROOT: workspaceRoot,
  },
  stdio: ["inherit", "inherit", "inherit"],
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`Failed to start Dingxu Human GUI MCP: ${error.message}`);
  process.exit(1);
});

function resolvePython() {
  const explicit = process.env.PANDO_HUMAN_GUI_PYTHON?.trim();
  if (explicit) return { command: explicit, args: [] };

  const codexPython =
    "C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
  if (existsSync(codexPython)) return { command: codexPython, args: [] };

  return { command: "python", args: [] };
}
