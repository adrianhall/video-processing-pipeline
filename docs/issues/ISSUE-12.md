# Issue 12 — ffmpeg HTTP Server

## Summary

Implement the Flask HTTP server that wraps ffmpeg. It exposes three POST endpoints (`/transcode`, `/extract-audio`, `/grayscale`) plus a health check. Each endpoint downloads the input file from a presigned URL, runs an ffmpeg command, and uploads the output to another presigned URL.

## Relevant Skills

- `cloudflare`

## Dependencies

- ISSUE-11 (Dockerfile that runs this server)

## Acceptance Criteria

- [ ] `container/server.py` implements a Flask app with four routes: `GET /health`, `POST /transcode`, `POST /extract-audio`, `POST /grayscale`
- [ ] All three POST endpoints accept JSON: `{ "input_url": "...", "output_url": "..." }`
- [ ] All three POST endpoints: download from `input_url`, run ffmpeg, upload to `output_url`
- [ ] Success response: `{ "ok": true, "duration_seconds": <float> }` (200)
- [ ] Error response: `{ "ok": false, "error": "<message>", "stderr": "<truncated>" }` (500 or 504)
- [ ] ffmpeg commands match PLAN.md's Container HTTP API Contract table
- [ ] subprocess timeout is 1800 seconds (30 minutes) with `subprocess.TimeoutExpired` handling
- [ ] stderr is truncated to last 2000 characters in error responses
- [ ] Temporary files are cleaned up in a `finally` block (critical for clean shutdown when tini forwards SIGTERM)
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `container/server.py` | Modified | Replace placeholder with full Flask server |

## Technical Implementation

### Route Structure

Each processing route follows the same pattern:

1. Parse JSON body for `input_url` and `output_url`
2. Create a temp directory with `tempfile.mkdtemp()`
3. Download input from `input_url` using `requests` or `urllib`
4. Run the appropriate ffmpeg command via `subprocess.run()`
5. Upload output to `output_url` via HTTP PUT
6. Return success JSON with elapsed time
7. Clean up temp files in `finally`

### ffmpeg Commands

| Endpoint | Command |
|----------|---------|
| `/transcode` | `ffmpeg -i input -c:v libx264 -c:a aac -y output.mp4` |
| `/extract-audio` | `ffmpeg -i input -vn -c:a libmp3lame -y output.mp3` |
| `/grayscale` | `ffmpeg -i input -vf format=gray -c:a copy -y output.mp4` |

The `-y` flag overwrites output files without prompting.

### Error Handling

```python
try:
    result = subprocess.run(cmd, capture_output=True, check=True, timeout=1800)
except subprocess.CalledProcessError as e:
    return jsonify({
        "ok": False,
        "error": f"ffmpeg exited with code {e.returncode}",
        "stderr": e.stderr.decode("utf-8", errors="replace")[-2000:]
    }), 500
except subprocess.TimeoutExpired:
    return jsonify({
        "ok": False,
        "error": "ffmpeg timed out after 30 minutes"
    }), 504
```

### Upload to Presigned URL

Use `urllib.request.urlopen` with a PUT request to upload the output file to the presigned URL. Set `Content-Type` appropriately (`video/mp4` or `audio/mpeg`). Use `requests` library if preferred (add to requirements.txt).

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `container/server.py` — all four routes present, ffmpeg commands match PLAN.md table
3. Inspect error handling — TimeoutExpired returns 504, CalledProcessError returns 500 with truncated stderr

## Other Notes

This server runs inside the Cloudflare Container, not in the Worker runtime. It uses standard Python libraries. The `urllib` module from the standard library is sufficient for HTTP operations and avoids adding a `requests` dependency, though either approach is acceptable.

### Signal Handling

No explicit signal handling code is needed in `server.py`. The `tini` ENTRYPOINT (ISSUE-11) handles signal forwarding: when Cloudflare sends SIGTERM, tini forwards it to gunicorn, which gracefully shuts down workers. The `finally` block in each route ensures temp files are cleaned up even during an interrupted request. If an ffmpeg subprocess is actively running when SIGTERM arrives, gunicorn waits up to its `--timeout` (1800s) for the worker to finish before exiting.
