import { create as createHandleChunk } from "./handleChunk";
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

/**
 * Config for the parser
 *
 * @property {boolean | string[]} allowSurrogateDelegation - Allows Surrogate Delegation
 * If boolean and the Request has valid Surrogate Delegation headers then no parsing will take place and requests will be sent onwards
 * If Array of strings then each string is treated as an IP Address. If the originally connecting IP matches one of those IPs then Delegation will happen
 * @property {string[]} contentTypes - Array of strings of content types that the parser should parse for ESI Tags
 * Note: That these are case sensitive. See - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type
 * @property {boolean} disableThirdPartyIncludes - Whether or not to enable third party includes (includes from other domains)
 * @property {number} [recursionLimit] - Levels of recusion the parser is allowed to go do
 * think includes that include themselves causing recusion
 * @default 10
 * @property {string[]} thirdPatyIncludesDomainWhitelist - If third party includes are disabled you can white list them by including domains here
 * @property {string[]} varsCookieBlacklist - Array of strings of cookies that will be blacklisted from being expanded in esi VARs.
 */
export type ESIConfig = {
  allowSurrogateDelegation?: boolean | string[];
  contentTypes?: string[];
  disableThirdPartyIncludes?: boolean;
  recursionLimit?: number;
  thirdPatyIncludesDomainWhitelist?: string[];
  varsCookieBlacklist?: string[];
};

export type ESIVars = {
  headers: { [key: string]: string };
  method: string;
  esiArgs: URLSearchParams;
  url: URL;
};

/**
 * ESI Event Data for the Current Request
 *
 * @property {ESIConfig} config - ESIConfig when class was created
 * @property {object} headers - All headers of the request uppercased
 * @property {string} method - Method of the request
 * @property {URLSearchParams} esiArgs - Any ESI Arguments extracted from the URL Search params of the original request
 * Will be a URLSearchParam encoded object
 * @property {customESIVars} customVars - If a custom ESI Vars function is supplied this will be the result of that function
 * @property {URL} url - URL Object of the Request with ESI Args removed
 * @property {Request} request - Request object after ESI Args have been removed
 * @property {number} recursion - Recusion level we're currently at
 */
export type ESIEventData = {
  /**
   * {ESIConfig} for the current Request
   */
  config: ESIConfig;
  /**
   * All headers of the current Request in {Object}
   * All headers are uppercassed with - being converted to _
   */
  headers: { [key: string]: string };
  /**
   * Request Method
   */
  method: string;
  /**
   * Any ESI Arguments
   */
  esiArgs: URLSearchParams;
  /**
   * If a custom ESI Vars function is supplied this will be the result of that function
   *
   * @default false
   */
  customVars?: customESIVars;
  /**
   * {URL} Object of the Request with any ESI Args removed
   */
  url: URL;
  /**
   * Mutatable {Request} object with the ESI Args removed
   */
  request: Request;
  /**
   * Level of recursion the function is currently at
   *
   * @default 0
   */
  recursion: number;
};

export type customESIVars = {
  [key: string]: string | { [key: string]: string };
};
export type customESIVarsFunction = (
  request: Request,
) => Promise<customESIVars>;
export type fetchFunction = (request: string | Request) => Promise<Response>;
export type postBodyFunction = () => void | Promise<void>;

const processorToken = "ESI";
const processorVersion = 1.0;

export class esi {
  options: ESIConfig;
  esiFunction?: customESIVarsFunction;
  fetcher: fetchFunction;
  postBodyFunction?: postBodyFunction;

  constructor(
    options?: ESIConfig,
    customESIFunction?: customESIVarsFunction,
    fetcher = fetch as fetchFunction,
    postBodyFunction?: postBodyFunction,
  ) {
    const defaultConfig = {
      recursionLimit: 10,
      contentTypes: ["text/html", "text/plain"],
    };
    this.options = { ...defaultConfig, ...options };
    this.fetcher = fetcher;
    this.esiFunction = customESIFunction;
    this.postBodyFunction = postBodyFunction;
  }

  async parse(origRequest: Request, recursion = 0): Promise<Response> {
    // Hit our limit? Bail out
    const limit = this.options.recursionLimit as number;
    if (recursion >= limit) {
      // We dont have to set the URL value here
      // As we're going to get here in a ESI loop
      // And the parent value will have a URL set
      return new Response("");
    }

    // Get our HTTP_VARS & ESI Vars
    // Remove ESI Vars if they're in the request
    // Return a brand new request
    // eslint-disable-next-line
    let [request, esiVars] = await getVars(origRequest);

    // Load custom values if we can
    let customESIVariables;
    if (this.esiFunction) {
      customESIVariables = await this.esiFunction(origRequest);
    }

    // Add SurrogateControl header or append to it
    request = await advertiseSurrogateControl(request);

    // pack our nice stuff in
    const eventData: ESIEventData = {
      config: this.options,
      headers: esiVars.headers,
      method: esiVars.method,
      esiArgs: esiVars.esiArgs,
      customVars: customESIVariables,
      url: esiVars.url,
      request: request,
      recursion: recursion,
    };

    // grab the response from the upstream
    const response = await this.fetcher(request);

    // We can always return if any of the following
    // * Responses without bodies
    // * Responses that aren't an allowed content type
    // * Responses with Surrogate-Control is outside of our support
    // * We can delegate Surrogate downstream
    if (
      !response.body ||
      !this.validContentType(response) ||
      !this.validSurrogateControl(response) ||
      (await canDelegateToSurrogate(origRequest, this.options))
    ) {
      const resp = new Response(response.body, response);
      // We set the URL manually here as it doesn't come across from the copy˛
      Object.defineProperty(resp, "url", { value: response.url });
      return resp;
    }

    const { readable, writable } = new TransformStream();

    // Create mutable response to return to the client, using the readable
    // side of the `TransformStream` as the body. As we write to the
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
    mutResponse.headers.delete("Surrogate-Control");

    // `streamBody` will free the request context when finished
    this.streamBody(eventData, response.body, writable);

    return mutResponse;
  }

  async handleESI(eventData: ESIEventData, text: string): Promise<string> {
    text = await processEscaping(text);
    text = processComments(text);
    text = processRemove(text);
    text = await processESIVars(eventData, text);
    let vars = false;
    [text, vars] = await processConditionals(eventData, text);

    // finally our includes
    text = await processIncludes(
      eventData,
      text,
      vars,
      this.fetcher,
      this.esiFunction,
    );

    return text;
  }
  async handleTEXT(eventData: ESIEventData, text: string): Promise<string> {
    return text;
  }

  async streamBody(
    eventData: ESIEventData,
    readable: ReadableStream,
    writable: WritableStream,
  ): Promise<void> {
    const reader = readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Output
    // pending actions awaiting a response
    const output: Array<Promise<string>> = [];
    let pending: boolean;
    let ended: boolean;

    /**
     * Flushes output to the Writeable Stream
     */
    const flush_output = async () => {
      // Can't call this if we're waiting for an sync option to complete
      if (pending) {
        return;
      }

      // Mark as pending
      pending = true;

      // Loop through the pending list
      if (output.length) {
        const esi = output[0];

        esi
          .then(null, function (e) {
            // on error
            // Write nothing out
            console.log(e);
            return "";
          })
          .then(function (r) {
            const writer = writable.getWriter();
            writer.write(encoder.encode(r));
            output.shift();
            pending = false;
            writer.releaseLock();
            flush_output();
          });
      } else {
        pending = false;
      }

      if (ended && output.length === 0) {
        const writer = writable.getWriter();
        await writer.close();

        // we're completely done now notify the post body function
        if (this.postBodyFunction) {
          this.postBodyFunction();
        }
      }
    };

    const writer = (text: string, esi: boolean) => {
      if (esi) {
        output.push(this.handleESI(eventData, text));
      } else {
        output.push(this.handleTEXT(eventData, text));
      }
      flush_output();
    };

    // bind this so we can still see outside within the reader function
    const writerBound = writer.bind(this);

    const handler = createHandleChunk(writerBound);

    reader.read().then(async function processBlob(blob): Promise<void> {
      const chunk: ArrayBuffer = blob.value;
      const done: boolean = blob.done;
      // decode it
      const decodedChunk: string = decoder.decode(chunk, { stream: true });
      await handler(decodedChunk, done);

      // we're done bail out
      if (done) {
        ended = true;
        flush_output();
        return;
      }

      return reader.read().then(processBlob);
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
    const sControl = response.headers.get("Surrogate-Control");
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

//
// Return
// Pass in variables into ESI which identifies the request
//
export const esiArgsPrefix = "esi_";
const esiArgsRegex = /^esi_(\S+)/;
/**
 * Takes the original Request and strips ESI Args from the request
 * Return a brand new mutatable Request along with an ESIVars object
 *
 * @param {Request} request - Original Request
 * @returns {Promise<[Request, ESIVars]>} - Mutatable Request and ESIVars
 */
async function getVars(request: Request): Promise<[Request, ESIVars]> {
  const vars: ESIVars = {
    headers: {},
    method: request.method,
    esiArgs: new URLSearchParams(),
    url: new URL(request.url),
  };

  // We create our own array here
  // because if we use the iterator directly and cleanup a key
  // it causes the loop to skip one as the iterator doesn't update correctly
  const current = new URL(request.url);
  const keys = Array.from(current.searchParams.keys());

  for (const key of keys) {
    const match = key.match(esiArgsRegex);
    if (match && match[1]) {
      for (const entry of current.searchParams.getAll(key)) {
        // have to append each entry seperatrely
        // trying to push an array results in sanatised arguments
        vars.esiArgs.append(esiArgsPrefix + match[1], entry);
      }
      current.searchParams.delete(key);
    }
  }

  // Save the URL without the ESI args
  vars.url = current;

  // Make them match the nice standard they we have
  for (const header of request.headers.entries()) {
    vars.headers[header[0].replace(/-/g, "_").toUpperCase()] = header[1];
  }

  // return a brand new
  return [new Request(current.toString(), request.clone()), vars];
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

export default esi;
