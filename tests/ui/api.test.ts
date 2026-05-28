/**
 * Unit tests for the {@link module:api} UI API client.
 *
 * All HTTP calls are intercepted by replacing the global `fetch` with a
 * Vitest spy/mock so no real network requests are made.  Each test verifies
 * the correct URL, method, body, and response parsing.
 *
 * @module tests/ui/api.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoResource } from "../../ui/src/api";
import { createVideo, fetchVideos, startProcessing } from "../../ui/src/api";

// ---------------------------------------------------------------------------
// fetch mock setup
// ---------------------------------------------------------------------------

/**
 * Creates a mock `fetch` that returns a JSON response with the given body and
 * HTTP status code.
 *
 * @param body - The JSON-serialisable response body.
 * @param status - HTTP status code (default `200`).
 * @returns A Vitest spy configured to resolve with the mocked `Response`.
 */
function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  // Replace global fetch before each test
  vi.stubGlobal("fetch", mockFetch({}));
});

afterEach(() => {
  // Restore the real fetch after each test
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createVideo
// ---------------------------------------------------------------------------

describe("createVideo", () => {
  it("POSTs to /api/videos with the filename in the body", async () => {
    const mockFetchFn = mockFetch({
      data: { id: "abc", upload_url: "https://r2.example.com/upload" },
    });
    vi.stubGlobal("fetch", mockFetchFn);

    await createVideo("my-video.webm");

    expect(mockFetchFn).toHaveBeenCalledOnce();
    const [url, init] = mockFetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/videos");
    expect(init.method).toBe("POST");
    const parsed = JSON.parse(init.body as string) as { filename: string };
    expect(parsed.filename).toBe("my-video.webm");
  });

  it("parses and returns the { id, upload_url } data envelope", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        data: {
          id: "test-uuid",
          upload_url: "https://r2.example.com/presigned",
        },
      }),
    );

    const result = await createVideo("clip.mp4");
    expect(result.id).toBe("test-uuid");
    expect(result.upload_url).toBe("https://r2.example.com/presigned");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Missing filename" }, 400));

    await expect(createVideo("")).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// startProcessing
// ---------------------------------------------------------------------------

describe("startProcessing", () => {
  it("POSTs to /api/videos/:id/process", async () => {
    const mockFetchFn = mockFetch({
      data: { id: "abc", status: "processing" },
    });
    vi.stubGlobal("fetch", mockFetchFn);

    await startProcessing("abc");

    expect(mockFetchFn).toHaveBeenCalledOnce();
    const [url, init] = mockFetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/videos/abc/process");
    expect(init.method).toBe("POST");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Video not found" }, 404));

    await expect(startProcessing("missing-id")).rejects.toThrow(/404/);
  });
});

// ---------------------------------------------------------------------------
// fetchVideos
// ---------------------------------------------------------------------------

describe("fetchVideos", () => {
  it("GETs /api/videos and returns the data array", async () => {
    const videos: VideoResource[] = [
      {
        id: "v1",
        filename: "first.mp4",
        original_format: "mp4",
        status: "complete",
        play_url: "/api/videos/v1/stream",
        error_message: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
    ];
    const mockFetchFn = mockFetch({ data: videos });
    vi.stubGlobal("fetch", mockFetchFn);

    const result = await fetchVideos();

    expect(mockFetchFn).toHaveBeenCalledOnce();
    const [url] = mockFetchFn.mock.calls[0] as [string];
    expect(url).toBe("/api/videos");
    expect(result).toEqual(videos);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Unauthorized" }, 401));

    await expect(fetchVideos()).rejects.toThrow(/401/);
  });
});
