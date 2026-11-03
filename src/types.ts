import type { UsageCollector } from "./usage";

/**
 * Everything the parser is constructed with. All of it is optional
 *
 * @property {boolean | string[]} allowSurrogateDelegation - Allows Surrogate Delegation
 * If boolean and the Request has valid Surrogate Delegation headers then no parsing will take place and requests will be sent onwards
 * If Array of strings then each string is treated as an IP Address. If the originally connecting IP matches one of those IPs then Delegation will happen
 * @property {string[]} contentTypes - Array of strings of content types that the parser should parse for ESI Tags
 * Note: That these are case sensitive. See - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type
 * @property {boolean} disableThirdPartyIncludes - Whether or not to enable third party includes (includes from other domains)
 * @property {number} [recursionLimit] - Levels of recursion the parser is allowed to include before bailing out
 * think includes that include themselves causing recursion
 * @default 10
 * @property {string} surrogateControlHeader - Name of the header that the library will check for Surrogate-Control
 * We allow customisation as Cloudflare priorities Surrogate-Control over Cache-Control
 * @property {string[]} thirdPartyIncludesDomainWhitelist - If third party includes are disabled you can white list them by including domains here
 * @property {string[]} varsCookieBlacklist - Array of strings of cookies that will be blacklisted from being expanded in esi VARs.
 * @property {Function} [onDocumentProcessed] - Optional hook called once for every document (root and each include) after its body has been processed
 * @property {Function} [onIncludeStart] - Optional hook called before an include's rendered output starts flowing into its parent. May return a WritableStream to receive a copy of the output
 * @property {Function} [onIncludeComplete] - Optional hook called once an include and everything beneath it has finished
 * @property {number} [includeTapHighWaterMark] - Max bytes a tap writable may fall behind before it's aborted
 * @default 1048576
 * @property {Function} [esiFunction] - Returns custom ESI vars for a request, available as `$(KEY)` in the document
 * @property {Function} [fetcher] - Fetches the document and every include. Defaults to `fetch`
 * @property {Request[]} [ctx] - Parent requests, passed to the fetcher. For the root there are normally none
 * @property {Function} [postBodyFunction] - Called once the document has finished being written
 */
export type ESIConfig = {
  allowSurrogateDelegation?: boolean | string[];
  contentTypes?: string[];
  disableThirdPartyIncludes?: boolean;
  recursionLimit?: number;
  surrogateControlHeader?: string;
  thirdPartyIncludesDomainWhitelist?: string[] | null;
  varsCookieBlacklist?: string[] | null;
  onDocumentProcessed?: onDocumentProcessedFunction;
  onIncludeStart?: onIncludeStartFunction;
  onIncludeComplete?: onIncludeCompleteFunction;
  includeTapHighWaterMark?: number;
  esiFunction?: customESIVarsFunction;
  fetcher?: fetchFunction;
  ctx?: Request[];
  postBodyFunction?: postBodyFunction;
};

/**
 * Summary of one include found in a document
 *
 * @property {string} src - The src attribute exactly as written in the document
 * @property {string} resolvedUrl - The absolute URL after any vars were evaluated and it was resolved against the document
 * @property {boolean} thirdParty - true if the include is on a different domain to the document
 * @property {boolean} allowed - false if the include was skipped because of the third party rules
 */
export type ESIIncludeReport = {
  src: string;
  resolvedUrl: string;
  thirdParty: boolean;
  allowed: boolean;
};

/**
 * Report passed to `onDocumentProcessed` for every document, the root and every include.
 * Describes that document's own body only. Never its descendants (use `ctx` to link them up).
 *
 * @property {Request} request - Request as sent to the fetcher (ESI args removed)
 * @property {Response} response - Response from the fetcher. Headers only, the body must not be read
 * @property {number} recursion - 0 is the root
 * @property {Request[]} ctx - Parent chain, same as passed to the fetcher
 * @property {boolean} isESI - true if the document was processed for ESI. false if passed through untouched
 * @property {ESIIncludeReport[]} includes - Includes this document attempted
 * @property {string[]} usedVars - Every `$(VAR)` / `$(VAR{key})` in the document, deduped
 * @property {string[]} usedEsiArgs - esi_* args referenced
 * @property {boolean} usedConditionals - document contains esi:choose / esi:when / esi:otherwise
 * @property {boolean} usedEsiVarsBlock - document contains an esi:vars block
 * @property {boolean} varsInIncludeSrc - any include src contained a `$(...)` expression
 * @property {boolean} recursionLimitHit - an include was skipped as it would go over recursionLimit
 * @property {boolean} aborted - the output of this document did not complete (an error, or whoever was reading it went away)
 */
export type ESIDocumentReport = {
  request: Request;
  response: Response;
  recursion: number;
  ctx: Request[];
  isESI: boolean;
  includes: ESIIncludeReport[];
  usedVars: string[];
  usedEsiArgs: string[];
  usedConditionals: boolean;
  usedEsiVarsBlock: boolean;
  varsInIncludeSrc: boolean;
  recursionLimitHit: boolean;
  aborted: boolean;
};

export type onDocumentProcessedFunction = (
  report: ESIDocumentReport,
) => void | Promise<void>;

/**
 * Info passed to `onIncludeStart`
 *
 * @property {Request} request - Include request as sent to the fetcher
 * @property {Request[]} ctx - Parent chain, same as passed to the fetcher
 * @property {number} recursion - Recursion level of the include (1 or more)
 */
export type ESIIncludeStartInfo = {
  request: Request;
  ctx: Request[];
  recursion: number;
};

/**
 * Info passed to `onIncludeComplete`
 *
 * @property {boolean} aborted - the output went away or errored before the include completed
 * @property {unknown} [error] - set if the include's own stream errored
 */
export type ESIIncludeCompleteInfo = ESIIncludeStartInfo & {
  aborted: boolean;
  error?: unknown;
};

export type onIncludeStartFunction = (
  info: ESIIncludeStartInfo,
) =>
  | WritableStream<Uint8Array>
  | undefined
  | Promise<WritableStream<Uint8Array> | undefined>;

export type onIncludeCompleteFunction = (
  info: ESIIncludeCompleteInfo,
) => void | Promise<void>;

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
 * @property {object} headers - All headers of the request in uppercase
 * @property {string} method - Method of the request
 * @property {URLSearchParams} esiArgs - Any ESI Arguments extracted from the URL Search params of the original request
 * Will be a URLSearchParam encoded object
 * @property {customESIVars} customVars - If a custom ESI Vars function is supplied this will be the result of that function
 * @property {URL} url - URL Object of the Request with ESI Args removed
 * @property {Request} request - Request object after ESI Args have been removed
 * @property {number} recursion - Recursion level we're currently at
 */
export type ESIEventData = {
  /**
   * {ESIConfig} for the current Request
   */
  config: FullESIConfig;
  /**
   * All headers of the current Request in {Object}
   * All headers are in uppercase and - is converted to _
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
  /**
   * Collects what the document uses for `onDocumentProcessed`. Only set if there is a hook
   *
   * @internal
   */
  usage?: UsageCollector;
};

export type customESIVars = {
  [key: string]: string | { [key: string]: string };
};
export type customESIVarsFunction = (
  request: Request,
) => Promise<customESIVars> | customESIVars;
export type fetchFunction = (
  request: Request,
  ctx: Request[],
) => Promise<Response>;
export type postBodyFunction = () => void | Promise<void>;
// What the processors are told: the settings, with the defaults filled in.
// The parts the parser holds itself (fetcher etc.) are not part of it
type RunKeys = "esiFunction" | "fetcher" | "ctx" | "postBodyFunction";
type DefaultedKeys =
  | "allowSurrogateDelegation"
  | "contentTypes"
  | "disableThirdPartyIncludes"
  | "recursionLimit"
  | "surrogateControlHeader"
  | "thirdPartyIncludesDomainWhitelist"
  | "varsCookieBlacklist";
export type FullESIConfig = Omit<ESIConfig, RunKeys> &
  Required<Pick<ESIConfig, DefaultedKeys>>;

/**
 * What parsing a document gives back to whoever asked, which is either
 * the caller or the include that is being parsed
 *
 * @internal
 */
export type ParseResult = {
  response: Response;
  /** Request as sent to the fetcher */
  request: Request;
  /** Parent chain as passed to the fetcher */
  ctx: Request[];
  /**
   * Resolves once everything about this document has finished, including
   * its onDocumentProcessed hook. Never rejects.
   */
  settled: Promise<void>;
};
