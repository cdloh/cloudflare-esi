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

function headerHasDirective(header: string, directive: string): boolean {
  if (header == "") {
    return false;
  }

  const pattern = `(?:\\s*|,?)(${directive})\\s*(?:$|=|,)`;
  const patternCompiled = new RegExp(pattern, "i");

  return patternCompiled.test(header);
}
