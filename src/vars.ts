import type { ESIVars } from "./types";

export const esiArgsPrefix = "esi_";
const esiArgsRegex = /^esi_(\S+)/;
/**
 * Takes the original Request and strips ESI Args from the request
 * Return a brand new mutatable Request along with an ESIVars object
 *
 * @param {Request} request - Original Request
 * @returns {[Request, ESIVars]} - Mutatable Request and ESIVars
 */
export function getVars(request: Request): [Request, ESIVars] {
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
  return [new Request(current.toString(), request), vars];
}
