import { process as processEscaping } from "./processEscaping";
import { process as processComments } from "./processComments";
import { process as processRemove } from "./processRemove";
import { process as processESIVars } from "./processESIVars";
import { process as processConditionals } from "./processConditionals";
import { process as processIncludes } from "./processIncludes";
import {
  advertiseSurrogateControl,
  canDelegateToSurrogate,
  splitESIToken,
} from "./surrogate";
import { getheaderToken } from "./headerUtils";
import { fireReport } from "./hooks";
import { Segment } from "./segments";
import { createOutputStream, streamBody } from "./streamBody";
import { UsageCollector } from "./usage";
import { getVars } from "./vars";
import type {
  customESIVarsFunction,
  ESIConfig,
  ESIEventData,
  FullESIConfig,
  fetchFunction,
  ParseResult,
  postBodyFunction,
} from "./types";

export * from "./types";
export { esiArgsPrefix } from "./vars";

const processorToken = "ESI";
const processorVersion = 1.0;
const defaultSurrogateControlHeader = "Surrogate-Control";

const defaultConfig: FullESIConfig = {
  allowSurrogateDelegation: false,
  contentTypes: ["text/html", "text/plain"],
  disableThirdPartyIncludes: false,
  recursionLimit: 10,
  surrogateControlHeader: defaultSurrogateControlHeader,
  thirdPartyIncludesDomainWhitelist: null,
  varsCookieBlacklist: null,
};

export class esi {
  options: FullESIConfig;
  esiFunction?: customESIVarsFunction;
  fetcher: fetchFunction;
  postBodyFunction?: postBodyFunction;
  ctx: Request[];

  constructor(config: ESIConfig = {}) {
    const {
      esiFunction,
      fetcher = defaultFetch,
      ctx = [],
      postBodyFunction,
      ...options
    } = config;
    this.options = { ...defaultConfig, ...options };
    this.esiFunction = esiFunction;
    this.fetcher = fetcher;
    this.ctx = ctx;
    this.postBodyFunction = postBodyFunction;
  }

  /**
   * Parses a request, fetching it and processing the ESI in the response
   *
   * @param {Request} origRequest the request to fetch and parse
   * @param {number} [recursion] recursion level we're starting at (0 for the root)
   * @returns {Promise<Response>} Response with the processed body streaming through it
   */
  async parse(origRequest: Request, recursion = 0): Promise<Response> {
    return (await this.parseInternal(origRequest, recursion)).response;
  }

  /**
   * Does the work of `parse`. Includes use it directly as they need more than the response.
   *
   * @param {Request} origRequest the request to fetch and parse
   * @param {number} recursion recursion level
   * @returns {Promise<ParseResult>} the response along with details the parent needs for includes
   */
  async parseInternal(
    origRequest: Request,
    recursion: number,
  ): Promise<ParseResult> {
    // Hit our limit? Bail out
    if (recursion >= this.options.recursionLimit!) {
      // We dont have to set the URL value here
      // As we're going to get here in a ESI loop
      // And the parent value will have a URL set
      return {
        response: new Response(""),
        request: origRequest,
        ctx: this.ctx.slice(),
        settled: Promise.resolve(),
      };
    }

    // Get our HTTP_VARS & ESI Vars
    // Remove ESI Vars if they're in the request
    // Return a brand new request
    const [mutableRequest, esiVars] = getVars(origRequest);

    // Load custom values if we can
    const customVars = this.esiFunction
      ? await this.esiFunction(origRequest)
      : undefined;

    // Add SurrogateControl header or append to it
    const request = advertiseSurrogateControl(mutableRequest);

    // pack our nice stuff in
    const eventData: ESIEventData = {
      config: this.options,
      headers: esiVars.headers,
      method: esiVars.method,
      esiArgs: esiVars.esiArgs,
      customVars,
      url: esiVars.url,
      request,
      recursion,
      usage: this.options.onDocumentProcessed
        ? new UsageCollector()
        : undefined,
    };

    // grab the response from the upstream
    const fetchCtx = this.ctx.slice();
    const response = await this.fetcher(request, fetchCtx);

    // pop this new request into our contexts
    // do it after the request so only includes pick it up and not the request itself
    this.ctx.push(request);

    // We can always return if any of the following
    // * Responses without bodies
    // * Responses that aren't an allowed content type
    // * Responses with Surrogate-Control is outside of our support
    // * We can delegate Surrogate downstream
    const isESI =
      !!response.body &&
      this.validContentType(response) &&
      this.validSurrogateControl(response) &&
      !canDelegateToSurrogate(origRequest, this.options);

    return isESI
      ? this.processBody(eventData, response, fetchCtx)
      : this.passThrough(eventData, response, fetchCtx);
  }

  /**
   * Response we don't process. Sent on as is
   *
   * @param {ESIEventData} eventData event data
   * @param {Response} response the upstream response
   * @param {Request[]} fetchCtx ctx passed to the fetcher
   * @returns {ParseResult} the response
   */
  private passThrough(
    eventData: ESIEventData,
    response: Response,
    fetchCtx: Request[],
  ): ParseResult {
    const { request } = eventData;
    const resp = new Response(response.body, response);
    // We set the URL manually here as it doesn't come across from the copy˛
    Object.defineProperty(resp, "url", { value: response.url });

    // There was nothing for us to process so the report can go out now
    const settled = fireReport(
      this.options.onDocumentProcessed,
      {
        request,
        response,
        recursion: eventData.recursion,
        ctx: fetchCtx,
        isESI: false,
        aborted: false,
      },
      eventData.usage,
    );
    // process postBody function if relevant
    if (this.postBodyFunction) {
      this.postBodyFunction();
    }
    return { response: resp, request, ctx: fetchCtx, settled };
  }

  /**
   * Response we do process. The response returned streams the processed body
   *
   * @param {ESIEventData} eventData event data
   * @param {Response} response the upstream response
   * @param {Request[]} fetchCtx ctx passed to the fetcher
   * @returns {ParseResult} the response
   */
  private processBody(
    eventData: ESIEventData,
    response: Response,
    fetchCtx: Request[],
  ): ParseResult {
    const { request } = eventData;
    const { readable, writable } = createOutputStream();

    // Create mutable response to return to the client, using the readable
    // side of the output stream as the body. As we write to the
    // writable side, this response will read from it.
    const mutResponse = new Response(readable, response);
    // We set the URL manually here as it doesn't come across from the copy˛
    Object.defineProperty(mutResponse, "url", { value: response.url });

    // Zero downstream lifetime
    mutResponse.headers.set("Cache-Control", "private, max-age=0");

    // remove last modified & etag
    // Even if the origin doesnt send them. Sometimes cloudfdlare does
    // https://blog.cloudflare.com/introducing-smart-edge-revalidation/
    mutResponse.headers.delete("Last-Modified");
    mutResponse.headers.delete("ETag");
    mutResponse.headers.delete("content-length");

    // Remove surrogate-control
    mutResponse.headers.delete(this.options.surrogateControlHeader);

    const settled = this.streamBody(
      eventData,
      response.body as ReadableStream,
      writable,
      (aborted) =>
        fireReport(
          this.options.onDocumentProcessed,
          {
            request,
            response,
            recursion: eventData.recursion,
            ctx: fetchCtx,
            isESI: true,
            aborted,
          },
          eventData.usage,
        ),
    );

    return { response: mutResponse, request, ctx: fetchCtx, settled };
  }

  /**
   * Processes a chunk of ESI into segments of text and streaming includes
   *
   * @param {ESIEventData} eventData event data of the document
   * @param {string} text chunk of ESI
   * @returns {Promise<Segment[]>} segments in document order
   */
  async handleESISegments(
    eventData: ESIEventData,
    text: string,
  ): Promise<Segment[]> {
    text = processEscaping(text);
    text = processComments(text);
    text = processRemove(text);
    eventData.usage?.scan(text);
    text = processESIVars(eventData, text);
    let vars: boolean;
    [text, vars] = await processConditionals(eventData, text);

    // finally our includes
    return processIncludes(eventData, text, vars, this);
  }

  // eslint-disable-next-line require-await
  async handleTEXT(eventData: ESIEventData, text: string): Promise<string> {
    return text;
  }

  /**
   * Reads the document, processes it and writes the result to the writable.
   *
   * @param {ESIEventData} eventData event data of the document
   * @param {ReadableStream} readable body of the document
   * @param {WritableStream} writable where to write the processed document
   * @param {Function} [report] sends the document's report. Called at most once
   * @returns {Promise<void>} resolves once the document has completely finished. Never rejects
   */
  streamBody(
    eventData: ESIEventData,
    readable: ReadableStream,
    writable: WritableStream,
    report?: (aborted: boolean) => Promise<void>,
  ): Promise<void> {
    return streamBody({
      config: this.options,
      readable,
      writable,
      processChunk: (text, isESI) =>
        isESI
          ? this.handleESISegments(eventData, text)
          : this.handleTEXT(eventData, text).then((t) => [t]),
      report,
      postBody: this.postBodyFunction,
    });
  }

  validContentType(response: Response): boolean {
    const resType = response.headers.get("Content-Type");
    if (resType) {
      for (const allowedType of this.options.contentTypes as string[]) {
        let sep: number | undefined = resType.search(";");
        if (sep === -1) sep = undefined;
        if (resType.substring(0, sep) === allowedType) {
          return true;
        }
      }
    }
    return false;
  }

  validSurrogateControl(response: Response): boolean {
    const sControl = response.headers.get(this.options.surrogateControlHeader);
    if (!sControl) {
      return false;
    }
    const esiToken = getheaderToken(sControl, "content");
    const [surrogateProcessor, surrogateVersion] = splitESIToken(esiToken);
    if (
      surrogateVersion &&
      surrogateVersion <= getProcessorVersion() &&
      surrogateProcessor &&
      surrogateProcessor == getProcessorToken()
    ) {
      return true;
    }
    return false;
  }
}

/**
 * Returns Processor Token string for Surrogate headers
 * eg "ESI"
 *
 * @returns {string} - supported procesor token
 */
export function getProcessorToken(): string {
  return processorToken;
}

/**
 * Returns Processor Version as a number for Surrogate headers
 * eg 1.0
 *
 * @returns {number} - processor supported version
 */
export function getProcessorVersion(): number {
  return processorVersion;
}

/**
 * Returns Processor Version as a string for Surrogate headers
 * eg "1.0"
 *
 * @returns {string} - processor supported version
 */
export function getProcessorVersionString(): string {
  return processorVersion.toFixed(1);
}
/**
 * Default fetch function we use if none is provided
 *
 * @param {RequestInfo} req request to fetch
 * @param {Request[]} ctx request ctx (parent requests)
 * @returns {Promise<Response>} - processor supported version
 */
function defaultFetch(
  req: RequestInfo,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: Request[],
): Promise<Response> {
  return fetch(req);
}

export default esi;
