/**
 * An include that has been fetched (headers only) and whose rendered body is
 * waiting to be piped into the parent's output.
 */
export type IncludeSegment = {
  /** Rendered body of the include. null when the response had no body */
  body: ReadableStream<Uint8Array> | null;
  /** Request as sent to the fetcher */
  request: Request;
  /** Parent chain as passed to the fetcher */
  ctx: Request[];
  /** Recursion level of the include */
  recursion: number;
  /**
   * Resolves once the include's own processing has completely finished
   * (including its onDocumentProcessed hook). Never rejects.
   */
  settled: Promise<void>;
};

/**
 * Output of processing one chunk of ESI. Strings are already fully processed text,
 * includes are streams that get piped through in order
 */
export type Segment = string | IncludeSegment;

/**
 * Cancels the bodies of any include segments. Used when we are bailing out and
 * will never read them so the nested parsers stop working.
 * (Cancelling a body that is already being read is harmless, it just rejects)
 *
 * @param {Segment[]} segments segments to cancel
 * @param {unknown} [reason] cancel reason
 */
export function cancelSegments(segments: Segment[], reason?: unknown): void {
  for (const segment of segments) {
    if (typeof segment !== "string" && segment.body) {
      segment.body.cancel(reason).catch(() => undefined);
    }
  }
}
