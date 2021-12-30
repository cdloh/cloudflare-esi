import { create as createHandleChunk } from "./handleChunk";
import { process as processEscaping } from "./processEscaping";
import { process as processComments } from "./processComments";
import { process as processRemove } from "./processRemove";
import { process as processESIVars } from "./processESIVars";
import { process as processConditionals } from "./processConditionals";


export type ESIVars = {
  headers: { [key: string]: string };
  method: string;
  esiArgs: URLSearchParams
  url: URL
};

export type ESIEventData = {
  headers: { [key: string]: string };
  method: string;
  esiArgs: URLSearchParams
  url: URL
  request: Request,
  recursion: number,

}

export class esi {

  constructor() { }

  async parse(request: Request, recursion: number = 0): Promise<Response> {

    // Get our HTTP_VARS & ESI Vars
    // Remove ESI Vars if they're in the request
    // Return a new request
    let [esiVarsRequest, esiVars] = await getVars(request)

    // pack our nice stuff in
    let eventData: ESIEventData = {
      headers: esiVars.headers,
      method: esiVars.method,
      esiArgs: esiVars.esiArgs,
      url: esiVars.url,
      request: esiVarsRequest,
      recursion: recursion
    }

    // grab the response from the upstream
    let response = await fetch(esiVarsRequest);

    // Responses without bodies can just be returned as is
    if (!response.body) {
      return response;
    }

    let { readable, writable } = new TransformStream();

    // Create mutable response to return to the client, using the readable
    // side of the `TransformStream` as the body. As we write to the
    // writable side, this response will read from it.
    let mutResponse = new Response(readable, response);

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

    text = await processEscaping(text)
    text = await processComments(text)
    text = await processRemove(text)
    text = await processESIVars(eventData, text)
    let vars = false;
    [text, vars] = await processConditionals(eventData, text)
    return text
  }

  async #handleTEXT(eventData: ESIEventData, text: string): Promise<string> {
    return text
  }

  async #streamBody(eventData: ESIEventData, readable: ReadableStream, writable: WritableStream) {

    let reader = readable.getReader();

    let encoder = new TextEncoder();
    let decoder = new TextDecoder();

    // Output
    // pending actions awaiting a response
    var output: Array<Promise<string>> = [], pending: boolean, ended: boolean;

    async function flush_output() {

      // Can't call this if we're waiting for an sync option to complete
      if (pending) {
        return;
      }

      // Mark as pending
      pending = true;

      // Loop through the pending list
      if (output.length) {

        var esi = output[0];

        esi.then(null, function (e) {

          // on error
          // Write nothing out
          console.log(e)
          return '';

        }).then(function (r) {

          let writer = writable.getWriter();
          writer.write(encoder.encode(r));
          output.shift();
          pending = false;
          writer.releaseLock();
          flush_output();

        });
      } else { pending = false };


      if (ended && output.length === 0) {

        let writer = writable.getWriter();
        await writer.close();

      }
    }

    async function writer(text: string, esi: boolean) {
      if (esi) {
        // @ts-ignore
        output.push(this.#handleESI(eventData, text))
      } else {
        // @ts-ignore
        output.push(this.#handleTEXT(eventData, text))
      }
      flush_output()
    }

    // bind this so we can still see outside within the reader function
    let writerBound = writer.bind(this);


    let handler = createHandleChunk(writerBound)

    reader.read().then(async function processBlob(blob): Promise<void> {

      let chunk: ArrayBuffer = blob.value;
      let done: boolean = blob.done;

      // decode it
      let decodedChunk: string = decoder.decode(chunk, { stream: true })
      await handler({ value: decodedChunk, done: done })

      // we're done bail out
      if (done) {
        ended = true
        flush_output();
        return
      }

      return reader.read().then(
        processBlob
      );
    });
  }

};


let esiArgsRegex = /^esi_(\S+)/
async function getVars(request: Request): Promise<[Request, ESIVars]> {
  var vars: ESIVars = {
    headers: {},
    method: request.method,
    esiArgs: new URLSearchParams(),
    url: new URL(request.url)
  };

  let hasEsiVars = false
  let current = new URL(request.url);

  for (var key of current.searchParams.keys()) {
    let match = key.match(esiArgsRegex);
    if (match && match[1]) {
      hasEsiVars = true
      for (var entry of current.searchParams.getAll(key)) {
        // have to append each entry seperatrely
        // trying to push an array results in sanatised arguments
        vars.esiArgs.append(match[1], entry)
      }
      current.searchParams.delete(key);
    }
  }

  // Save the URL without the ESI args
  vars.url = current

  // Make them match the nice standard they we have
  for (var header of request.headers.entries()) {
    let t = header[0].replace(/\-/g, '_').toUpperCase();
    vars.headers[header[0].replace(/\-/g, '_').toUpperCase()] = header[1]
  }

  // Create a new request without the ESI Args
  if (hasEsiVars) request = new Request(current.toString(), request);

  return [request, vars];
}

export default esi;
