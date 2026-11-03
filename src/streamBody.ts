import { create as createHandleChunk } from "./handleChunk";
import { callHook } from "./hooks";
import { cancelSegments, IncludeSegment, Segment } from "./segments";
import { startTap, Tap } from "./tap";
import type { FullESIConfig, postBodyFunction } from "./types";

// How much of a document's own text we'll queue up awaiting output
// before we stop reading from upstream
const maxReadAheadBytes = 1024 * 1024;

const noop = () => undefined;

/**
 * Creates the stream the parser writes its output to and the caller reads from.
 *
 * Uses IdentityTransformStream as a plain TransformStream stops applying backpressure
 * once its reader has started reading, which would let a slow client make us buffer everything.
 * IdentityTransformStream holds each write until it's read.
 *
 * @returns {{readable: ReadableStream, writable: WritableStream}} the two ends of the stream
 */
export function createOutputStream(): {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
} {
  return new IdentityTransformStream();
}

export type BodyStreamOptions = {
  config: FullESIConfig;
  /** Body of the document */
  readable: ReadableStream;
  /** Where the processed document goes */
  writable: WritableStream;
  /** Turns a chunk of the document (text or an ESI tag) into what should be written */
  processChunk: (text: string, isESI: boolean) => Promise<Segment[]>;
  /** Sends the document's report. Called at most once */
  report?: (aborted: boolean) => Promise<void>;
  postBody?: postBodyFunction;
};

/**
 * Reads a document, processes it and writes the result to the writable.
 *
 * Output is written strictly in document order. Includes are fetched as soon as
 * they're found but their output is a stream that is only read when it's their turn,
 * and only as fast as the writable accepts it.
 *
 * @param {BodyStreamOptions} options what to stream, and where to
 * @returns {Promise<void>} resolves once the document has completely finished. Never rejects
 */
export function streamBody(options: BodyStreamOptions): Promise<void> {
  return new BodyStreamer(options).start();
}

type Outcome =
  | { kind: "done" }
  // Reading the include failed. The parent carries on
  | { kind: "include-error"; error: unknown }
  // Writing to the output failed or the parent has failed. The parent is done for
  | { kind: "output-failed"; error: unknown };

class BodyStreamer {
  private reader: ReadableStreamDefaultReader;
  private writer: WritableStreamDefaultWriter;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  // Chunks awaiting their turn to be written, in document order
  // bytes is the size of the raw text, used to limit reading ahead
  private queue: Array<{ promise: Promise<Segment[]>; bytes: number }> = [];
  private queuedBytes = 0;
  private wakeProducer?: () => void;
  private draining = false;
  // Everything has been read from upstream
  private ended = false;

  private status: "running" | "finished" | "failed" = "running";
  private failReason: unknown;
  private reportSent = false;

  // The include currently being piped, so a failure can interrupt its read
  private activeReader?: ReadableStreamDefaultReader<Uint8Array>;
  // onIncludeComplete calls and anything else to wait for before closing
  private completions: Array<Promise<void>> = [];

  private settle: () => void = noop;
  private settled = new Promise<void>((resolve) => {
    this.settle = resolve;
  });

  constructor(private options: BodyStreamOptions) {
    this.reader = options.readable.getReader();
    this.writer = options.writable.getWriter();
  }

  private get running(): boolean {
    return this.status === "running";
  }

  start(): Promise<void> {
    this.produce();
    return this.settled;
  }

  // Reading upstream

  private async produce(): Promise<void> {
    const handler = createHandleChunk((text, esi) => this.enqueue(text, esi));
    try {
      for (;;) {
        // Don't read too far ahead of whoever is consuming us
        while (this.queuedBytes > maxReadAheadBytes && this.running) {
          await new Promise<void>((resolve) => {
            this.wakeProducer = resolve;
          });
        }

        const blob = await this.reader.read();
        if (!this.running) {
          return;
        }
        handler(this.decoder.decode(blob.value, { stream: true }), blob.done);

        if (blob.done) {
          this.ended = true;
          this.drain();
          return;
        }
      }
    } catch (e) {
      // upstream broke, there's no way to complete the output
      this.fail(e).catch(noop);
    }
  }

  private enqueue(text: string, esi: boolean): void {
    if (!this.running) {
      return;
    }
    const promise = this.options.processChunk(text, esi);
    // Handled when it's this ones turn. Don't want to be told about it until then
    promise.catch(noop);
    this.queue.push({ promise, bytes: text.length });
    this.queuedBytes += text.length;
    this.drain();
  }

  // Writing the output

  /**
   * Writes queued chunks until there are none left. Only one runs at a time
   * and the one that finds the queue empty is the one that finishes up
   */
  private async drain(): Promise<void> {
    if (this.draining || !this.running) {
      return;
    }
    this.draining = true;
    try {
      while (this.running) {
        const item = this.queue[0];
        if (!item) {
          if (this.ended) {
            await this.finish();
          }
          return;
        }
        await this.write(await this.settleSegments(item.promise));
        this.queue.shift();
        this.queuedBytes -= item.bytes;
        if (this.wakeProducer) this.wakeProducer();
      }
    } catch (e) {
      if (this.running) {
        // Couldn't write. Whoever was reading our output has gone
        this.fail(e).catch(noop);
      } else if (this.status === "finished") {
        // post body function threw
        throw e;
      }
    } finally {
      this.draining = false;
    }
  }

  private async settleSegments(
    promise: Promise<Segment[]>,
  ): Promise<Segment[]> {
    try {
      return await promise;
    } catch (e) {
      // Write nothing out. If we have already failed this is just fallout
      if (this.running) console.log(e);
      return [];
    }
  }

  private async write(segments: Segment[]): Promise<void> {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!this.running) {
        cancelSegments(segments.slice(i));
        return;
      }
      try {
        if (typeof segment !== "string") {
          await this.pipeInclude(segment);
        } else if (segment.length) {
          await this.writer.write(this.encoder.encode(segment));
        }
      } catch (e) {
        cancelSegments(segments.slice(i + 1), e);
        throw e;
      }
    }
  }

  /**
   * Pipes an include into the output. Reads from it only as fast as the output takes it.
   * Throws only if the output is no good anymore.
   *
   * @param {IncludeSegment} include the include
   * @returns {Promise<void>} resolves once the whole include has been written
   */
  private async pipeInclude(include: IncludeSegment): Promise<void> {
    const tap = await startTap(this.options.config, include);
    const outcome = await this.copyBody(include, tap);

    if (outcome.kind === "done") {
      if (tap) tap.close();
    } else if (tap) {
      tap.abort(outcome.error);
    }

    this.completions.push(this.completeInclude(include, outcome));

    if (outcome.kind === "output-failed") {
      throw outcome.error;
    }
  }

  private async copyBody(include: IncludeSegment, tap?: Tap): Promise<Outcome> {
    if (!include.body) {
      return { kind: "done" };
    }
    // We might have been failed while the tap was starting
    if (!this.running) {
      include.body.cancel(this.failReason).catch(noop);
      return { kind: "output-failed", error: this.failReason };
    }

    const reader = include.body.getReader();
    this.activeReader = reader;
    const outcome = await this.copyChunks(reader, tap);
    this.activeReader = undefined;
    if (outcome.kind !== "done") {
      reader.cancel(outcome.error).catch(noop);
    }
    return outcome;
  }

  private async copyChunks(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    tap?: Tap,
  ): Promise<Outcome> {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        // If it broke because we did, it's not the include's fault
        return this.running
          ? { kind: "include-error", error }
          : { kind: "output-failed", error: this.failReason };
      }
      // When we fail our read gets cancelled. Which looks like a clean end
      if (!this.running) {
        return { kind: "output-failed", error: this.failReason };
      }
      if (result.done) {
        return { kind: "done" };
      }

      if (tap) tap.write(result.value);
      try {
        await this.writer.write(result.value);
      } catch (error) {
        return { kind: "output-failed", error };
      }
    }
  }

  /**
   * Calls onIncludeComplete once the include's whole subtree has finished.
   * The include's own reports go out before it closes its output so they are
   * usually already done, but when the output has failed its report can lag behind.
   *
   * @param {IncludeSegment} include the include
   * @param {Outcome} outcome how it went
   * @returns {Promise<void>} resolves once the hook has been called
   */
  private async completeInclude(
    include: IncludeSegment,
    outcome: Outcome,
  ): Promise<void> {
    await include.settled;
    await callHook(this.options.config.onIncludeComplete, {
      request: include.request,
      ctx: include.ctx,
      recursion: include.recursion,
      aborted: outcome.kind === "output-failed",
      error: outcome.kind === "include-error" ? outcome.error : undefined,
    });
  }

  // Ending

  /**
   * Everything has been written. Wrap up
   *
   * @returns {Promise<void>} resolves once complete
   */
  private async finish(): Promise<void> {
    // taps and hooks of the includes
    await Promise.allSettled(this.completions);

    // Before we close so whoever is reading our output
    // knows they are all in by the time they see the end
    if (this.running) await this.sendReport(false);
    if (!this.running) {
      return;
    }

    // Not awaited. It only resolves once the reader has taken everything, which
    // could be after they have seen the end and gone on to look at what we did
    this.writer.close().catch(noop);
    this.status = "finished";

    try {
      // we're completely done now notify the post body function
      if (this.options.postBody) {
        await this.options.postBody();
      }
    } finally {
      this.settle();
    }
  }

  /**
   * Abnormal end. Downstream went away, or upstream broke.
   * Errors the output so nothing reading it sees a truncated body that looks complete
   *
   * @param {unknown} reason why
   * @returns {Promise<void>} resolves when all tidied up
   */
  private async fail(reason: unknown): Promise<void> {
    if (!this.running) {
      return;
    }
    this.status = "failed";
    this.failReason = reason;
    if (this.wakeProducer) this.wakeProducer();

    this.reader.cancel(reason).catch(noop);
    if (this.activeReader) this.activeReader.cancel(reason).catch(noop);
    // Includes we are never going to read
    for (const item of this.queue) {
      item.promise.then((segments) => cancelSegments(segments, reason), noop);
    }
    this.writer.abort(reason).catch(noop);

    try {
      // Not waiting on the includes' completion hooks here. They wait on their
      // includes to settle and a hung fetch could keep that from ever happening
      await this.sendReport(true);
    } finally {
      this.settle();
    }
  }

  private sendReport(aborted: boolean): Promise<void> {
    if (this.reportSent || !this.options.report) {
      return Promise.resolve();
    }
    this.reportSent = true;
    return this.options.report(aborted);
  }
}
