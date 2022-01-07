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

export type ESIConfig = {
  enabled?: boolean;
  disableThirdPartyIncludes?: boolean;
  thirdPatyIncludesDomainWhitelist?: string[];
  varsCookieBlacklist?: string[];
  contentTypes?: string[];
  allowSurrogateDelegation?: boolean | string[];
  recursionLimit?: number;
};

export type ESIVars = {
  headers: { [key: string]: string };
  method: string;
  esiArgs: URLSearchParams;
  url: URL;
};

export type ESIEventData = {
  config: ESIConfig;
  headers: { [key: string]: string };
  method: string;
  esiArgs: URLSearchParams;
  customVars?: customESIVars;
  url: URL;
  request: Request;
  recursion: number;
};

export type customESIVars = {
  [key: string]: string | { [key: string]: string };
};
export type customESIVarsFunction = (
  request: Request
) => Promise<customESIVars>;

const processorToken = "ESI";
const processorVersion = 1.0;

export class esi {
  #options: ESIConfig;
  #esiFunction?: customESIVarsFunction;

  constructor(options?: ESIConfig, customESIFunction?: customESIVarsFunction) {
    const defaultConfig = {
      recursionLimit: 10,
      enabled: true,
      contentTypes: ["text/html", "text/plain"],
    };
    this.#options = { ...defaultConfig, ...options };
    if (customESIFunction) this.#esiFunction = customESIFunction;
  }

  async parse(origRequest: Request, recursion = 0): Promise<Response> {
    // Hit our limit? Bail out
    const limit = this.#options.recursionLimit as number;
    if (recursion >= limit) {
      return new Response("");
    }

    // Get our HTTP_VARS & ESI Vars
    // Remove ESI Vars if they're in the request
    // Return a brand new request
    // eslint-disable-next-line
    let [request, esiVars] = await getVars(origRequest);

    // Load custom values if we can
    let customESIVariables;
    if (this.#esiFunction) {
      customESIVariables = await this.#esiFunction(origRequest);
    }

    // Add SurrogateControl header or append to it
    request = await advertiseSurrogateControl(request);

    // pack our nice stuff in
    const eventData: ESIEventData = {
      config: this.#options,
      headers: esiVars.headers,
      method: esiVars.method,
      esiArgs: esiVars.esiArgs,
      customVars: customESIVariables,
      url: esiVars.url,
      request: request,
      recursion: recursion,
    };

    // grab the response from the upstream
    const response = await fetch(request);

    // We can always return if any of the following
    // * Responses without bodies
    // * Responses that aren't an allowed content type
    // * Responses with Surrogate-Control is outside of our support
    // * We can delegate Surrogate downstream
    if (
      !response.body ||
      !this.#validContentType(response) ||
      !this.#validSurrogateControl(response) ||
      (await canDelegateToSurrogate(origRequest, this.#options))
    ) {
      return response;
    }

    const { readable, writable } = new TransformStream();

    // Create mutable response to return to the client, using the readable
    // side of the `TransformStream` as the body. As we write to the
    // writable side, this response will read from it.
    const mutResponse = new Response(readable, response);

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
    this.#streamBody(eventData, response.body, writable);

    return mutResponse;
  }

  async #handleESI(eventData: ESIEventData, text: string): Promise<string> {
    text = await processEscaping(text);
    text = await processComments(text);
    text = await processRemove(text);
    text = await processESIVars(eventData, text);
    let vars = false;
    [text, vars] = await processConditionals(eventData, text);

    // finally our includes
    text = await processIncludes(eventData, text, vars, this.#esiFunction);

    return text;
  }
  async #handleTEXT(eventData: ESIEventData, text: string): Promise<string> {
    return text;
  }

  async #streamBody(
    eventData: ESIEventData,
    readable: ReadableStream,
    writable: WritableStream
  ): Promise<void> {
    const reader = readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Output
    // pending actions awaiting a response
    const output: Array<Promise<string>> = [];
    let pending: boolean;
    let ended: boolean;

    async function flush_output() {
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
      }
    }

    const writer = (text: string, esi: boolean) => {
      if (esi) {
        output.push(this.#handleESI(eventData, text));
      } else {
        output.push(this.#handleTEXT(eventData, text));
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

  #validContentType(response: Response): boolean {
    const resType = response.headers.get("Content-Type");
    if (resType) {
      for (const allowedType of this.#options.contentTypes as string[]) {
        let sep: number | undefined = resType.search(";");
        if (sep === -1) sep = undefined;
        if (resType.substring(0, sep) === allowedType) {
          return true;
        }
      }
    }
    return false;
  }

  #validSurrogateControl(response: Response): boolean {
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
const esiArgsRegex = /^esi_(\S+)/;
async function getVars(request: Request): Promise<[Request, ESIVars]> {
  const vars: ESIVars = {
    headers: {},
    method: request.method,
    esiArgs: new URLSearchParams(),
    url: new URL(request.url),
  };

  const current = new URL(request.url);

  for (const key of current.searchParams.keys()) {
    const match = key.match(esiArgsRegex);
    if (match && match[1]) {
      for (const entry of current.searchParams.getAll(key)) {
        // have to append each entry seperatrely
        // trying to push an array results in sanatised arguments
        vars.esiArgs.append(match[1], entry);
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
  return [new Request(current.toString(), request), vars];
}

export function getProcessorToken(): string {
  return processorToken;
}

export function getProcessorVersion(): number {
  return processorVersion;
}

export function getProcessorVersionString(): string {
  return processorVersion.toFixed(1);
}

export default esi;
