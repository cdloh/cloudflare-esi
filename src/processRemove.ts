const removeTagsRegex = /(<esi:remove>.*?<\/esi:remove>)/gs;

/**
 * Processes chunk of text and handles <esi:remove> tags
 *
 * @param {string} chunk chunk of text to process
 * @returns {Promise<string>} processed string
 */
export async function process(chunk: string): Promise<string> {
  if (chunk.indexOf("<esi:remove") == -1) {
    return chunk;
  }
  // Change to replaceAll once upgraded node
  const ret = chunk.replace(removeTagsRegex, "");
  return ret;
}
