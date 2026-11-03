import { setupNetwork } from "@msw/cloudflare";

export const network = setupNetwork();

/** URLs of outbound requests that no handler matched */
export const unmatched: string[] = [];

network.configure({
  // Fail loudly rather than letting a stray request reach the real network
  onUnhandledFrame: ({ frame, defaults }) => {
    unmatched.push((frame.data as { request: Request }).request.url);
    defaults.error();
  },
});
