# Pando Agent

Pando Agent is a combined frontend and backend workspace for the PandoShare agent prototype.

## Structure

- `frontend/` - React/Vite Web UI and local dev API launcher.
- `backend/` - Agent runtime source used by the local dev API.

## Local Development

Install frontend dependencies:

```powershell
npm --prefix frontend install
```

Start the Web UI and local API together:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:8765/
```

The local API listens on:

```text
http://127.0.0.1:3001/
```

## Notes

Runtime data is written under `.pandoshare/` and is intentionally ignored by Git.
Do not commit API keys, tokens, local logs, or generated build output.