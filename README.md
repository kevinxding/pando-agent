# Pando Agent

Pando Agent is a combined frontend and backend workspace for the PandoShare agent prototype.

## Structure

- `frontend/` - React/Vite Web UI. It talks to the backend over HTTP only.
- `backend/` - Agent runtime source and local HTTP API service.
- `.pandoshare/` - Local runtime state written by the backend. This directory is ignored by Git.

## Local Development

Install frontend dependencies:

```powershell
npm --prefix frontend install
```

Start the Web UI and backend API together:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:8765/
```

The backend API listens on:

```text
http://127.0.0.1:3001/
```

Useful focused commands:

```powershell
npm run dev:backend
npm run dev:frontend
npm run check
```

## Notes

Runtime data is written under `.pandoshare/` and is intentionally ignored by Git.
Do not commit API keys, tokens, local logs, or generated build output.