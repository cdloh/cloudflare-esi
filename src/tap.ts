import type { FullESIConfig } from "./types";
import type { IncludeSegment } from "./segments";

const noop = () => undefined;
const defaultHighWaterMark = 1024 * 1024;

/**
 * Writes a copy of an include's rendered output to a consumer supplied writable
 * without ever holding up the parent.
 *
 * Writes are never awaited by the caller. We keep count of how many bytes the
 * writable has been given but not yet accepted and if that goes past the high water mark
 * the writable is aborted and we stop copying to it.
 */
export class Tap {
  private pending = 0;
  // Closed, aborted or errored. Nothing more is written to it
  private ended = false;

  constructor(
    private writer: WritableStreamDefaultWriter<Uint8Array>,
    private highWaterMark: number,
  ) {}

  /**
   * Queues a copy of the chunk
   *
   * @param {Uint8Array} chunk bytes that were written to the parent
   */
  write(chunk: Uint8Array): void {
    if (this.ended) {
      return;
    }
    const size = chunk.byteLength;
    // A single chunk bigger than the mark is fine if the writable is keeping up
    if (this.pending > 0 && this.pending + size > this.highWaterMark) {
      this.abort(
        new Error(
          `include tap fell more than ${this.highWaterMark} bytes behind`,
        ),
      );
      return;
    }

    this.pending += size;
    // A copy as the same chunk goes to the parent too
    this.writer.write(chunk.slice()).then(
      () => {
        this.pending -= size;
      },
      () => {
        // Their writable errored. Nothing more for us to do for them
        this.ended = true;
      },
    );
  }

  /**
   * Aborts the writable. Not awaited. If their writable is stuck in a write the abort
   * can't complete until that write does, and that must not hold up the parent.
   *
   * @param {unknown} reason abort reason
   */
  abort(reason: unknown): void {
    if (!this.ended) {
      this.ended = true;
      this.writer.abort(reason).then(noop, noop);
    }
  }

  /**
   * Closes the writable once it has taken everything we gave it. Not awaited.
   * Only for when the include completed cleanly.
   */
  close(): void {
    if (!this.ended) {
      this.ended = true;
      this.writer.close().then(noop, noop);
    }
  }
}

/**
 * Asks `onIncludeStart` if the include should be tapped. Never throws.
 *
 * @param {FullESIConfig} config config with the hook
 * @param {IncludeSegment} include the include about to be written
 * @returns {Promise<Tap | undefined>} a tap, or undefined if there's nothing to copy to
 */
export async function startTap(
  config: FullESIConfig,
  include: IncludeSegment,
): Promise<Tap | undefined> {
  if (!config.onIncludeStart) {
    return undefined;
  }
  try {
    const writable = await config.onIncludeStart({
      request: include.request,
      ctx: include.ctx,
      recursion: include.recursion,
    });
    return writable
      ? new Tap(
          writable.getWriter(),
          config.includeTapHighWaterMark ?? defaultHighWaterMark,
        )
      : undefined;
  } catch (e) {
    console.error("cloudflare-esi: onIncludeStart failed", e);
    return undefined;
  }
}
