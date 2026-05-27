# ffmpeg video processing container for the video-processing-pipeline.
#
# Provides three HTTP endpoints for CPU-intensive video operations:
#   POST /transcode       — transcode any format to H.264/AAC MP4
#   POST /extract-audio   — extract audio track to MP3
#   POST /grayscale       — apply grayscale filter, preserve audio
#   GET  /health          — readiness probe
#
# Signal handling:
#   tini acts as PID 1 and forwards SIGTERM → gunicorn → workers.
#   Without tini, SIGTERM from the Cloudflare Container runtime would not
#   reach the ffmpeg subprocess, causing orphaned processes and unclean
#   shutdowns. tini also reaps zombie processes.
#
# Port:
#   Cloudflare Containers expect the application to listen on port 8080.

FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8080

# tini is the init process (PID 1). It forwards signals to gunicorn and
# reaps zombie processes so ffmpeg subprocesses clean up correctly.
ENTRYPOINT ["/usr/bin/tini", "--"]

# gunicorn worker timeout is set to 1800 seconds (30 minutes) to match the
# maximum expected ffmpeg processing time for large video files.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "1800", "server:app"]
