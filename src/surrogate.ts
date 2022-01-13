import {
  ESIConfig,
  getProcessorToken,
  getProcessorVersion,
  getProcessorVersionString,
} from ".";
import { getheaderToken } from "./headerUtils";

/**
 * Takes a request object and either appends to or adds a Surrogate-Capability header
 * with the Processor Token and Version that we support
 * If we have Colo data in the Request object we add that to our identifier
 *
 * @param {Request} request Request to modify
 * @returns {Promise<Request>} Request with SurrogateControl header added
 */
export async function advertiseSurrogateControl(
  request: Request
): Promise<Request> {
  let coloName = "";
  if (request.cf && request.cf.colo) {
    coloName = `-${request.cf.colo}`;
  }
  request.headers.append(
    "Surrogate-Capability",
    `cloudflareWorkerESI${coloName}="${getProcessorToken()}/${getProcessorVersionString()}"`
  );
  return request;
}

/**
 * Takes a request object and checks if we can delegate this request to a downstream surrogate or not
 *
 * @param {Request} request Request to confirm against
 * @param {ESIConfig} config Config for the current request
 * @returns {Promise<boolean>} result
 */
export async function canDelegateToSurrogate(
  request: Request,
  config: ESIConfig
): Promise<boolean> {
  const surrogates = config.allowSurrogateDelegation;
  if (surrogates === undefined || surrogates === false) return false;

  const surrogateCapability = request.headers.get("Surrogate-Capability");
  if (surrogateCapability) {
    const capabilityToken = getheaderToken(
      surrogateCapability,
      "[!#\\$%&'\\*\\+\\-.\\^_`\\|~0-9a-zA-Z]+"
    );
    const [capabilityProcessor, capabilityVersion] =
      splitESIToken(capabilityToken);

    if (
      capabilityProcessor &&
      capabilityVersion &&
      capabilityProcessor == getProcessorToken() &&
      capabilityVersion <= getProcessorVersion()
    ) {
      if (surrogates == true) {
        return true;
      }
      const remoteAddr = request.headers.get("CF-Connecting-IP");
      if (remoteAddr && surrogates.includes(remoteAddr)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Takes an ESI Token string and returns it's processor token (string) and version (number)
 * or null
 *
 * @param {string | null} token ESI Token to split
 * @returns {[string | null, number | null]} A valid token split or null
 */
export function splitESIToken(
  token: string | null
): [string | null, number | null] {
  if (!token) return [null, null];
  const matches = token.match(/^([A-Za-z0-9-_]+)\/(\d+\.?\d+)$/);
  if (matches) {
    return [matches[1], parseFloat(matches[2])];
  }
  return [null, null];
}
