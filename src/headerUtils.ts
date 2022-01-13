/**
 * Takes a header string and a directive to check if the directive is within the header
 * Returns the value of the directive if it exists or null if not
 *
 * @param {string} header header to check if it has a directive
 * @param {string} directive directive to find within the header
 * @returns {string | null } the value of the directive if it exists or null if not
 */
export function getheaderToken(
  header: string,
  directive: string
): string | null {
  if (headerHasDirective(header, directive)) {
    const matches = header.match(
      new RegExp(
        `${directive}="?([a-z0-9_~!#%&/',\`\\$\\*\\+\\-\\|\\^\\.]+)"?`,
        "i"
      )
    );
    if (matches) {
      return matches[1];
    }
  }
  return null;
}

/**
 * Checks if header has a directive
 *
 * @param {string} header header value
 * @param {string} directive directive to check if in header
 * @returns {boolean} true if header has directive otherwise false
 */
function headerHasDirective(header: string, directive: string): boolean {
  if (header == "") {
    return false;
  }

  const pattern = `(?:\\s*|,?)(${directive})\\s*(?:$|=|,)`;
  const patternCompiled = new RegExp(pattern, "i");

  return patternCompiled.test(header);
}
