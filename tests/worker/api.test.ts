/**
 * Worker API integration tests.
 *
 * Tests run inside the Cloudflare Workers runtime via miniflare (see
 * `vitest.config.ts` worker project).  All Worker bindings (D1, R2,
 * Workflows, FFMPEG_CONTAINER) are available as in-memory local stubs.
 *
 * ## Authentication pattern
 *
 * {@link signDevJwt} mints a short-lived HMAC JWT accepted by
 * `cloudflareAccess` without any JWKS network call.  This lets tests
 * cover authenticated paths without a browser login flow.
 *
 * @module tests/worker/api.test
 */

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { JWT_HEADER, signDevJwt } from "@adrianhall/cloudflare-auth";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";

// ---------------------------------------------------------------------------
// Dispatch helper
// ---------------------------------------------------------------------------

/**
 * Dispatches a request through the Hono app with a fresh execution context
 * and waits for all `waitUntil` promises to settle before returning.
 *
 * @param req - The HTTP request to dispatch.
 * @returns The HTTP response produced by the Hono app.
 */
async function dispatch(req: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/**
 * Returns a signed dev JWT header object ready to spread into `RequestInit.headers`.
 *
 * @param email - The email identity to embed in the token.
 * @returns A headers object `{ [JWT_HEADER]: "<token>" }`.
 */
async function authHeaders(
  email = "test@example.com",
): Promise<Record<string, string>> {
  const token = await signDevJwt(email);
  return { [JWT_HEADER]: token };
}

// ---------------------------------------------------------------------------
// Auth and public endpoints
// ---------------------------------------------------------------------------

describe("GET /api/version", () => {
  it("is public — returns 200 without credentials", async () => {
    const res = await dispatch(new Request("http://localhost/api/version"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(body.version).toBeDefined();
  });
});

describe("Protected route behaviour", () => {
  it("redirects to login (302) when no JWT is present", async () => {
    const res = await dispatch(new Request("http://localhost/api/videos"));
    expect(res.status).toBe(302);
  });

  it("returns 200 when a valid signDevJwt token is supplied", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
  });

  // NOTE: We do NOT test expired-token rejection here.  Token expiry is
  // validated entirely inside `cloudflareAccess` (library code); we trust
  // the library to handle that correctly.  Testing it would require triggering
  // a JWKS fetch to a fake domain, producing an unhandled rejection as a side
  // effect.  Our responsibility is only the authPolicies array and the routes.
});

// ---------------------------------------------------------------------------
// POST /api/videos — input validation
// ---------------------------------------------------------------------------

describe("POST /api/videos — input validation", () => {
  it("returns 400 when the request body is not valid JSON", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: "not-json{{{",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
  });

  it("returns 400 when filename is missing from the body", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/filename/i);
  });

  it("returns 400 when filename is an empty string", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "   " }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/filename/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/videos — happy path & format derivation
// ---------------------------------------------------------------------------

describe("POST /api/videos — happy path", () => {
  it("returns 200 with id and presigned upload_url", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "test-video.webm" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; upload_url: string };
    };
    expect(body.data.id).toBeDefined();
    expect(body.data.upload_url).toMatch(/^https?:\/\//);
  });

  it("derives format 'mp4' from a .mp4 filename", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "lecture.mp4" }),
      }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { id: string; upload_url: string };
    };
    // The R2 key contains the derived format as the file extension
    expect(data.upload_url).toContain(".mp4");
  });

  it("derives format 'bin' from a filename with no extension", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "noextension" }),
      }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { id: string; upload_url: string };
    };
    expect(data.upload_url).toContain(".bin");
  });
});

// ---------------------------------------------------------------------------
// GET /api/videos/:id — single video lookup
// ---------------------------------------------------------------------------

describe("GET /api/videos/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await dispatch(
      new Request(
        "http://localhost/api/videos/00000000-0000-0000-0000-000000000000",
        { headers: await authHeaders() },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 with a full VideoResource for a known id", async () => {
    // Create a video record first
    const createRes = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "sample.avi" }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string; upload_url: string };
    };

    // Fetch the created video by ID
    const res = await dispatch(
      new Request(`http://localhost/api/videos/${created.id}`, {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const { data: video } = (await res.json()) as {
      data: {
        id: string;
        filename: string;
        status: string;
        play_url: string | null;
      };
    };
    expect(video.id).toBe(created.id);
    expect(video.filename).toBe("sample.avi");
    expect(video.status).toBe("uploading");
    expect(video.play_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/videos/:id/status
// ---------------------------------------------------------------------------

describe("GET /api/videos/:id/status", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await dispatch(
      new Request(
        "http://localhost/api/videos/00000000-0000-0000-0000-000000000001/status",
        { headers: await authHeaders() },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when no workflow has been started for the video", async () => {
    // Create a video (status = "uploading", workflow_id = null)
    const createRes = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "pending.mkv" }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string; upload_url: string };
    };

    const res = await dispatch(
      new Request(`http://localhost/api/videos/${created.id}/status`, {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/workflow/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/videos/:id/stream
// ---------------------------------------------------------------------------

describe("GET /api/videos/:id/stream", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await dispatch(
      new Request(
        "http://localhost/api/videos/00000000-0000-0000-0000-000000000002/stream",
        { headers: await authHeaders() },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when r2_bw_key is null (processing not yet complete)", async () => {
    // Create a video — r2_bw_key starts null
    const createRes = await dispatch(
      new Request("http://localhost/api/videos", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "unprocessed.webm" }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string; upload_url: string };
    };

    const res = await dispatch(
      new Request(`http://localhost/api/videos/${created.id}/stream`, {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not yet ready/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/videos/:id/process
// ---------------------------------------------------------------------------

describe("POST /api/videos/:id/process", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await dispatch(
      new Request(
        "http://localhost/api/videos/00000000-0000-0000-0000-000000000003/process",
        {
          method: "POST",
          headers: await authHeaders(),
        },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when the video is not in uploading status", async () => {
    // Directly insert a video with status = "processing" via D1 exec
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO videos
         (id, filename, original_format, status, r2_incoming_key, created_at, updated_at)
       VALUES (?, ?, ?, 'processing', ?, ?, ?)`,
    )
      .bind(id, "already-processing.mp4", "mp4", `incoming/${id}.mp4`, now, now)
      .run();

    const res = await dispatch(
      new Request(`http://localhost/api/videos/${id}/process`, {
        method: "POST",
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/uploading/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/videos — list all videos
// ---------------------------------------------------------------------------

describe("GET /api/videos", () => {
  beforeEach(async () => {
    // Clean up videos table so list tests start from a known empty state.
    // Each beforeEach uses a fresh miniflare D1 context per Vitest isolation.
    await env.DB.exec("DELETE FROM videos;");
  });

  it("returns an empty array when no videos exist", async () => {
    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("returns all videos in reverse-chronological order", async () => {
    // Insert two videos directly via D1
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO videos (id, filename, original_format, status, r2_incoming_key, created_at, updated_at) VALUES (?, ?, ?, 'uploading', ?, ?, ?)",
    )
      .bind(
        "aaa-1",
        "first.mp4",
        "mp4",
        "incoming/aaa-1.mp4",
        "2025-01-01T00:00:00.000Z",
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO videos (id, filename, original_format, status, r2_incoming_key, created_at, updated_at) VALUES (?, ?, ?, 'uploading', ?, ?, ?)",
    )
      .bind(
        "aaa-2",
        "second.mp4",
        "mp4",
        "incoming/aaa-2.mp4",
        "2025-01-02T00:00:00.000Z",
        now,
      )
      .run();

    const res = await dispatch(
      new Request("http://localhost/api/videos", {
        headers: await authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { filename: string }[] };
    expect(body.data).toHaveLength(2);
    // Newest first (created_at DESC)
    expect(body.data[0].filename).toBe("second.mp4");
    expect(body.data[1].filename).toBe("first.mp4");
  });
});
