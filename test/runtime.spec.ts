import { expect, test } from "vitest";

test("Tests run inside the workerd runtime", () => {
  expect(navigator.userAgent).toEqual("Cloudflare-Workers");
});
