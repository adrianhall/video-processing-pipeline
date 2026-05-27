# Placeholder Dockerfile for the ffmpeg video processing container.
#
# This stub exists so that wrangler.jsonc validates and local development
# commands (db:migrate:local, wrangler dev) work before the full container
# implementation is written.
#
# The production implementation (Flask + ffmpeg) will replace this file
# in the container implementation issue. It will expose:
#   POST /transcode       — transcode any format to H.264/AAC MP4
#   POST /extract-audio   — extract audio track to MP3
#   POST /grayscale       — apply grayscale filter, preserve audio
#   GET  /health          — readiness probe

FROM python:3.12-alpine

WORKDIR /app

# Minimal health server — responds 200 to GET /health, 404 to everything else.
# Replace entirely when the real Flask + ffmpeg server is implemented.
RUN printf '%s\n' \
  'from http.server import BaseHTTPRequestHandler, HTTPServer' \
  'class H(BaseHTTPRequestHandler):' \
  '  def do_GET(self):' \
  '    if self.path == "/health":' \
  '      self.send_response(200); self.end_headers()' \
  '      self.wfile.write(b'"'"'{"ok":true}'"'"')' \
  '    else:' \
  '      self.send_response(404); self.end_headers()' \
  '  def log_message(self, *a): pass' \
  'HTTPServer(("0.0.0.0", 8080), H).serve_forever()' \
  > server.py

EXPOSE 8080

CMD ["python", "server.py"]
