/**
 * Unit tests for the {@link VideoCard} component.
 *
 * Covers:
 * - Filename and date rendering
 * - Status badge label for every {@link VideoStatus} value
 * - Play button disabled for all non-complete states
 * - Play button disabled when status is `complete` but `play_url` is `null`
 * - Play button enabled and calls `onPlay` with the full {@link VideoResource}
 * - Error state: card title attribute contains `error_message`
 *
 * @module tests/ui/VideoCard.test
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VideoResource, VideoStatus } from "@/api";
import VideoCard from "../../ui/src/components/VideoCard";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a minimal but fully valid {@link VideoResource} for testing,
 * with optional field overrides.
 *
 * @param overrides - Partial VideoResource fields to merge into the base fixture.
 * @returns A complete VideoResource ready for rendering in tests.
 */
function makeVideo(overrides: Partial<VideoResource> = {}): VideoResource {
  return {
    id: "test-id-001",
    filename: "test-video.mp4",
    original_format: "mp4",
    status: "uploading",
    play_url: null,
    error_message: null,
    created_at: "2025-05-27T10:00:00.000Z",
    updated_at: "2025-05-27T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("VideoCard — rendering", () => {
  it("displays the filename", () => {
    render(<VideoCard video={makeVideo()} onPlay={vi.fn()} />);
    expect(screen.getByText("test-video.mp4")).toBeInTheDocument();
  });

  it("displays the formatted upload date", () => {
    render(<VideoCard video={makeVideo()} onPlay={vi.fn()} />);
    // The exact format depends on the system locale and timezone, so just
    // verify the year is rendered somewhere in the card.
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<VideoStatus, string> = {
  uploading: "Uploading",
  processing: "Processing",
  transcoding: "Transcoding",
  extracting_audio: "Extracting Audio",
  grayscaling: "Grayscaling",
  complete: "Complete",
  error: "Error",
};

describe("VideoCard — status badge", () => {
  for (const [status, label] of Object.entries(STATUS_LABELS) as [
    VideoStatus,
    string,
  ][]) {
    it(`renders badge label "${label}" for status "${status}"`, () => {
      render(<VideoCard video={makeVideo({ status })} onPlay={vi.fn()} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  }
});

// ---------------------------------------------------------------------------
// Play button — disabled states
// ---------------------------------------------------------------------------

const NON_COMPLETE_STATUSES: VideoStatus[] = [
  "uploading",
  "processing",
  "transcoding",
  "extracting_audio",
  "grayscaling",
  "error",
];

describe("VideoCard — Play button disabled states", () => {
  for (const status of NON_COMPLETE_STATUSES) {
    it(`is disabled when status is "${status}"`, () => {
      render(
        <VideoCard
          video={makeVideo({ status, play_url: null })}
          onPlay={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: /play/i })).toBeDisabled();
    });
  }

  it("is disabled when status is complete but play_url is null", () => {
    render(
      <VideoCard
        video={makeVideo({ status: "complete", play_url: null })}
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /play/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Play button — enabled and calls onPlay
// ---------------------------------------------------------------------------

describe("VideoCard — Play button enabled", () => {
  it("is enabled when status is complete and play_url is set", () => {
    const video = makeVideo({
      status: "complete",
      play_url: "/api/videos/test-id-001/stream",
    });
    render(<VideoCard video={video} onPlay={vi.fn()} />);
    expect(screen.getByRole("button", { name: /play/i })).not.toBeDisabled();
  });

  it("calls onPlay with the full VideoResource when clicked", async () => {
    const user = userEvent.setup();
    const handlePlay = vi.fn();
    const video = makeVideo({
      status: "complete",
      play_url: "/api/videos/test-id-001/stream",
    });

    render(<VideoCard video={video} onPlay={handlePlay} />);
    await user.click(screen.getByRole("button", { name: /play/i }));

    expect(handlePlay).toHaveBeenCalledOnce();
    expect(handlePlay).toHaveBeenCalledWith(video);
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("VideoCard — error state", () => {
  it("sets the card title attribute to the error_message", () => {
    const errorMessage = "ffmpeg exited with code 1: invalid input format";
    const video = makeVideo({
      status: "error",
      error_message: errorMessage,
    });

    const { container } = render(<VideoCard video={video} onPlay={vi.fn()} />);
    // The Card component receives the title prop which sets the HTML title attribute
    const card = container.querySelector("[title]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("title")).toBe(errorMessage);
  });

  it("does not set a title attribute when status is not error", () => {
    const { container } = render(
      <VideoCard
        video={makeVideo({ status: "processing" })}
        onPlay={vi.fn()}
      />,
    );
    const card = container.querySelector("[title]");
    expect(card).toBeNull();
  });
});
