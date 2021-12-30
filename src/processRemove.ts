const removeTagsRegex = /(<esi:remove>.*?<\/esi:remove>)/gs;

export async function process(chunk: string): Promise<string> {
  if (chunk.indexOf("<esi:remove") == -1) {
    return chunk;
  }
  // Change to replaceAll once upgraded node
  const ret = chunk.replace(removeTagsRegex, "");
  return ret;
}
