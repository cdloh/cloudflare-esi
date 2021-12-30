import { create as createHandleChunk } from "./handleChunk";
import { process as processEscaping } from "./processEscaping";
import { process as processComments } from "./processComments";
import { process as processRemove } from "./processRemove";
import { process as processESIVars } from "./processESIVars";
import { process as processConditionals } from "./processConditionals";
import { process as processIncludes } from "./processIncludes";

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
  url: URL;
  request: Request;
  recursion: number;
};

export class esi {
  #options: ESIConfig;

  constructor(options?: ESIConfig) {
    const defaultConfig = {
      recursionLimit: 10,
      enabled: true,
      contentTypes: ["text/html", "text/plain"],
    };
    this.#options = { ...defaultConfig, ...options };
  }

  async parse(request: Request, recursion = 0): Promise<Response> {
    // Hit our limit? Bail out
    const limit = this.#options.recursionLimit as number;
    if (recursion >= limit) {
      return new Response("");
    }

    // Get our HTTP_VARS & ESI Vars
    // Remove ESI Vars if they're in the request
    // Return a new request
    const [esiVarsRequest, esiVars] = await getVars(request);

    // pack our nice stuff in
    const eventData: ESIEventData = {
      config: this.#options,
      headers: esiVars.headers,
      method: esiVars.method,
      esiArgs: esiVars.esiArgs,
      url: esiVars.url,
      request: esiVarsRequest,
      recursion: recursion,
    };

    // grab the response from the upstream
    const response = await fetch(esiVarsRequest);

    // We can always return if any of the following
    // * Responses without bodies
    // * Responses that aren't an allowed content type
    // * Responses with Surrogate-Control is outside of our support
    if (
      !response.body ||
      this.#disallowedContentType(response) ||
      !this.#checkSurrogateControl(response)
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
    text = await processIncludes(eventData, text, vars);

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
      await handler({ value: decodedChunk, done: done });

      // we're done bail out
      if (done) {
        ended = true;
        flush_output();
        return;
      }

      return reader.read().then(processBlob);
    });
  }

  #disallowedContentType(response: Response): boolean {
    const resType = response.headers.get("Content-Type");
    if (resType) {
      for (const allowedType of this.#options.contentTypes as string[]) {
        let sep: number | undefined = resType.search(";");
        if (sep === -1) sep = undefined;
        if (resType.substring(0, sep) === allowedType) {
          return false;
        }
      }
    }
    return true;
  }

  #checkSurrogateControl(response: Response): boolean {
    const sControl = response.headers.get("Surrogate-Control");
    if (!sControl) {
      return false;
    }
    // we only support 1.0 at present
    const version = /content="ESI\/([0-1].\d)"/.exec(sControl);
    if (version && parseFloat(version[1]) <= 1.0) return true;
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

  let hasEsiVars = false;
  const current = new URL(request.url);

  for (const key of current.searchParams.keys()) {
    const match = key.match(esiArgsRegex);
    if (match && match[1]) {
      hasEsiVars = true;
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

  // Create a new request without the ESI Args
  if (hasEsiVars) request = new Request(current.toString(), request);

  return [request, vars];
}

export default esi;
