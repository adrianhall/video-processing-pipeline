# Issue 11 — Dockerfile for ffmpeg Container

## Summary

Create the Dockerfile for the ffmpeg processing container. The image is based on a Python slim image with ffmpeg installed. It will run the Flask HTTP server created in ISSUE-12.

## Relevant Skills

- `cloudflare`

## Dependencies

- ISSUE-01 (project scaffolding — `container/` directory)

## Acceptance Criteria

- [ ] `container/Dockerfile` exists, builds a working image with Python 3.12+, ffmpeg, and `tini` installed
- [ ] `tini` is set as the `ENTRYPOINT` for proper signal handling (SIGTERM/SIGKILL) required by Cloudflare Containers lifecycle management
- [ ] `container/requirements.txt` exists with `flask` and `gunicorn` pinned to recent versions
- [ ] The Dockerfile installs Python dependencies from `requirements.txt`
- [ ] The Dockerfile copies `server.py` into the image
- [ ] `ENTRYPOINT` is `["/usr/bin/tini", "--"]` and `CMD` runs gunicorn on port 8080
- [ ] The Dockerfile uses a slim base to keep image size reasonable
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `container/Dockerfile` | Added | Python + ffmpeg container image |
| `container/requirements.txt` | Added | Flask and gunicorn dependencies |

## Technical Implementation

### `container/Dockerfile`

```dockerfile
FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "1800", "server:app"]
```

Key decisions:

- **`python:3.12-slim`** — small base image with Python pre-installed
- **`ffmpeg`** from apt — the standard Debian package, no compilation needed
- **`tini`** as `ENTRYPOINT` — Cloudflare Containers use SIGTERM to request graceful shutdown and SIGKILL after a timeout. Neither Python nor gunicorn properly forward signals to child processes (ffmpeg subprocesses) by default. `tini` acts as PID 1 and handles signal forwarding and zombie process reaping. Without it, a SIGTERM sent by the container runtime would not reach the ffmpeg process, leading to orphaned processes and unclean shutdowns.
- **`gunicorn`** — production WSGI server with 30-minute worker timeout matching ffmpeg processing time. Gunicorn receives SIGTERM from tini and initiates graceful worker shutdown.
- **Port 8080** — Cloudflare Containers expect the application to listen on this port

### `container/requirements.txt`

```text
flask>=3.0,<4.0
gunicorn>=22.0,<23.0
```

### server.py Placeholder

ISSUE-12 creates `server.py`. For this issue, create a minimal placeholder so the Dockerfile has something to COPY:

```python
"""Placeholder — replaced by ISSUE-12."""
from flask import Flask
app = Flask(__name__)

@app.route("/health")
def health():
    return {"ok": True}
```

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `container/Dockerfile` — uses `python:3.12-slim`, installs ffmpeg, exposes 8080

## Other Notes

The container image is built by Wrangler during `wrangler deploy` via the `"image": "./container"` field in the `containers` binding (ISSUE-03). It does not need to be built manually. For local development, Docker must be installed if you want to test the container locally.

### Signal Handling Chain

The full signal flow for Cloudflare Container lifecycle:

1. Cloudflare Container runtime sends **SIGTERM** to PID 1 (tini)
2. `tini` forwards SIGTERM to gunicorn (its direct child)
3. Gunicorn begins graceful shutdown: stops accepting new requests, waits for active workers to finish (up to `--timeout`)
4. If a worker is running an ffmpeg subprocess, gunicorn waits for it to complete naturally
5. If the graceful timeout is exceeded, Cloudflare sends **SIGKILL** (unblockable) — all processes terminate immediately

The `tini` + `gunicorn` combination handles this correctly without any explicit signal handling code in `server.py`.
