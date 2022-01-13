const removeCommentsRegex = /<esi:comment (?:.*?)\/>/gs;

/**
 * Processes chunk of text and handles <esi:comment> tags
 *
 * @param {string} chunk chunk of text to process
 * @returns {Promise<string>} processed string
 */
export async function process(chunk: string): Promise<string> {
  if (chunk.indexOf("<esi:comment") == -1) {
    return chunk;
  }

  // Change to replaceAll once upgraded node
  return chunk.replace(removeCommentsRegex, "");
}
