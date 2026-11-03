import type { ESIDocumentReport } from "./types";
import type { UsageCollector } from "./usage";

/**
 * Calls a user supplied hook. Hooks may be sync or async, and anything they
 * throw is logged and swallowed so it can never affect the output.
 *
 * @param {Function | undefined} hook hook to call
 * @param {unknown} arg argument to pass
 * @returns {Promise<void>} resolves once the hook has finished, never rejects
 */
export async function callHook<T>(
  hook: ((arg: T) => void | Promise<void>) | undefined,
  arg: T,
): Promise<void> {
  if (!hook) {
    return;
  }
  try {
    await hook(arg);
  } catch (e) {
    console.error("cloudflare-esi: hook threw", e);
  }
}

/**
 * Sends the report for a document to `onDocumentProcessed`
 *
 * @param {Function | undefined} hook the onDocumentProcessed hook
 * @param {object} document details of the document the report is for
 * @param {UsageCollector} [usage] what the document used. Nothing if it wasn't processed
 * @returns {Promise<void>} resolves once the hook has finished, never rejects
 */
export function fireReport(
  hook: ((report: ESIDocumentReport) => void | Promise<void>) | undefined,
  document: Pick<
    ESIDocumentReport,
    "request" | "response" | "recursion" | "ctx" | "isESI" | "aborted"
  >,
  usage?: UsageCollector,
): Promise<void> {
  return callHook(hook, {
    ...document,
    includes: usage ? usage.includes.map((include) => ({ ...include })) : [],
    usedVars: usage ? Array.from(usage.vars) : [],
    usedEsiArgs: usage ? Array.from(usage.esiArgs) : [],
    usedConditionals: usage ? usage.conditionals : false,
    usedEsiVarsBlock: usage ? usage.varsBlock : false,
    varsInIncludeSrc: usage ? usage.varsInIncludeSrc : false,
    recursionLimitHit: usage ? usage.recursionLimitHit : false,
  });
}
