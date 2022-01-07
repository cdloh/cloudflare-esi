import {
  ESIConfig,
  getProcessorToken,
  getProcessorVersion,
  getProcessorVersionString,
} from ".";
import { getheaderToken } from "./headerUtils";

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
