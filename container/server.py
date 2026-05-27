"""Placeholder Flask server — replaced by ISSUE-12.

This stub exists so that the Dockerfile has a valid server.py to COPY
and the container image can be built. The full implementation in ISSUE-12
will add /transcode, /extract-audio, and /grayscale endpoints that invoke
ffmpeg via subprocess.
"""

from flask import Flask

app = Flask(__name__)


@app.route("/health")
def health():
    """Readiness probe used by Cloudflare Containers and the Workflow.

    Returns a 200 response with a JSON body indicating the server is ready
    to accept requests. The full implementation in ISSUE-12 keeps this
    endpoint but adds the three video-processing endpoints.

    Returns:
        A JSON object ``{"ok": True}`` with HTTP 200.
    """
    return {"ok": True}
