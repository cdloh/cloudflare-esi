import { replace_vars } from "./processESIVars";
import esi from ".";
import type { ESIEventData, FullESIConfig } from "./types";
import { cancelSegments, IncludeSegment, Segment } from "./segments";
import { esi_include_pattern } from "./usage";

/**
 * Handles any <esi:include tags in supplied chunk
 * returns the processed chunk as an ordered list of segments.
 * Text is returned as strings, each include is returned as a segment holding
 * the stream of its rendered body, so it can be piped to the output without being buffered.
 *
 * @param {ESIEventData} eventData config for the current request
 * @param {string} chunk chunk of text that we are about to process
 * @param {boolean} evalVars Whether or not we need to process any esi Vars in the content
 * @param {esi} parser the parser that is processing the document. Includes get a parser with the same settings
 * @returns {Promise<Segment[]>} processed chunk as segments in document order
 */
export async function process(
  eventData: ESIEventData,
  chunk: string,
  evalVars: boolean,
  parser: esi,
): Promise<Segment[]> {
  if (chunk.indexOf("<esi:include") == -1) {
    if (evalVars) {
      return [replace_vars(eventData, chunk)];
    } else {
      return [chunk];
    }
  }

  const res: Segment[] = [];
  // Adjacent text gets merged back together
  const pushText = (text: string) => {
    if (text.length === 0) {
      return;
    }
    const last = res[res.length - 1];
    if (typeof last === "string") {
      res[res.length - 1] = last + text;
    } else {
      res.push(text);
    }
  };
  let retFrom = 0;

  try {
    do {
      chunk = chunk.substring(retFrom);
      const includeMatch = chunk.match(esi_include_pattern);

      if (includeMatch && includeMatch.index !== undefined) {
        // Push anything from before the tag into the response
        const before = chunk.substring(0, includeMatch.index);
        pushText(evalVars ? replace_vars(eventData, before) : before);

        // Keep the remainder for next chunk
        retFrom = includeMatch.index + includeMatch[0].length;

        const include = await fetchInclude(
          eventData,
          includeMatch[1], // pass the src tag straight through
          parser,
        );

        // Already escaped by the fetcher
        if (include) {
          res.push(include);
        }
      } else {
        // push the remainder
        pushText(evalVars ? replace_vars(eventData, chunk) : chunk);
        break;
      }

      // eslint-disable-next-line no-constant-condition
    } while (true);
  } catch (e) {
    // The whole chunk is dropped when an include fails
    // So don't leave includes we already started running
    cancelSegments(res, e);
    throw e;
  }

  return res;
}

/**
 * Handles fetching the include
 * If we aren't allowed to include returns nothing
 * Otherwise parses the include and returns its (still streaming) rendered body
 *
 * @param {ESIEventData} eventData config for the current request
 * @param {string} include the full include tag from the content
 * @param {esi} parser the parser that is processing the document. Includes get a parser with the same settings
 * @returns {Promise<IncludeSegment | undefined>} the include or undefined if there is nothing to include
 */
async function fetchInclude(
  eventData: ESIEventData,
  include: string,
  parser: esi,
): Promise<IncludeSegment | undefined> {
  // replace any vars in the src string
  const src = replace_vars(eventData, include);

  // TY JS for handling relatives etc for us
  const srcUrl = new URL(src, eventData.url.toString());
  const sameDomain = isIncludeOnSameDomain(eventData.url, srcUrl);
  const allowed =
    sameDomain || thirdPartyWhitelisted(eventData.config, srcUrl.host);

  eventData.usage?.includes.push({
    src: include,
    resolvedUrl: srcUrl.toString(),
    thirdParty: !sameDomain,
    allowed,
  });

  // Not the same domain are we even allowed to include this
  if (!allowed) {
    return undefined;
  }

  // Too deep. The parser would return an empty response for us so don't bother
  if (eventData.recursion + 1 >= (eventData.config.recursionLimit as number)) {
    if (eventData.usage) {
      eventData.usage.recursionLimitHit = true;
    }
    return undefined;
  }

  const req = new Request(srcUrl.toString());

  // Add authorization and cookie data if on the same domain
  if (sameDomain) {
    if (eventData.request.headers.get("Authorization")) {
      req.headers.set(
        "Authorization",
        eventData.request.headers.get("Authorization") as string,
      );
    }
    if (eventData.request.headers.get("Cookie")) {
      req.headers.set(
        "Cookie",
        eventData.request.headers.get("Cookie") as string,
      );
    }
  }

  // Add our recursion level and parent uri
  req.headers.set(
    "X-ESI-Recursion-Level",
    (eventData.recursion + 1).toString(),
  );
  req.headers.set("X-ESI-Parent-URI", eventData.request.url);
  if (eventData.request.headers.get("Cache-Control")) {
    req.headers.set(
      "Cache-Control",
      eventData.request.headers.get("Cache-Control") as string,
    );
  }

  // create a new parser with current config
  const includeParser = new esi({
    ...eventData.config,
    esiFunction: parser.esiFunction,
    fetcher: parser.fetcher,
    ctx: parser.ctx.slice(),
  });
  const result = await includeParser.parseInternal(
    req,
    eventData.recursion + 1,
  );

  // The body is deliberately not read. The caller pipes it through when it's this include's turn
  return {
    body: result.response.body,
    request: result.request,
    ctx: result.ctx,
    recursion: eventData.recursion + 1,
    settled: result.settled,
  };
}

/**
 * Checks if the include is on the same domain as the original request
 * Returns false if not
 *
 * @param {URL} requestURL Original Request URL
 * @param {URL} srcURL URL that we are about to include
 * @returns {boolean} true if on the same domain
 */
function isIncludeOnSameDomain(requestURL: URL, srcURL: URL): boolean {
  return srcURL.hostname == requestURL.hostname;
}

/**
 * checks if a third party domain is whitelisted based off the current
 * running config
 *
 * @param {ESIConfig} config config for the current request
 * @param {string} host host to check against
 * @returns {boolean} true if domain is whitelisted. false if not
 */
function thirdPartyWhitelisted(config: FullESIConfig, host: string): boolean {
  if (config.disableThirdPartyIncludes) {
    if (!config.thirdPartyIncludesDomainWhitelist) {
      return false;
    }

    return config.thirdPartyIncludesDomainWhitelist.includes(host);
  }

  return true;
}
