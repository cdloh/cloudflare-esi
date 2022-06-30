import { tagParser } from "./tagParser";

/**
 * writerFunction for writing chunks of text from a readable stream
 *
 * @param {string} text chunk of text to write
 * @param {boolean} esi Whether or not we found ESI in the chunk
 * @returns {void}
 */
type writerFunction = (text: string, esi: boolean) => void;
type handleFunction = (value: string, done: boolean) => Promise<void>;

/**
 *  Creates a chunk handler and returns a
 *  handler that can takes a chunk of text and an indication if the stream has completed or nto
 *
 * @param {writerFunction} writer function to handle found chunks
 * @returns {Function} chunk handler
 */
export function create(writer: writerFunction): handleFunction {
  let prev_chunk = "";

  const writeString = function (str: string | undefined): void {
    if (typeof str == "string" && str.length !== 0) {
      writer(str, false);
    }
  };

  return async function (value: string, done: boolean): Promise<void> {
    value = prev_chunk + value;
    prev_chunk = "";

    const parser = new tagParser(value);
    do {
      const [tag, before, after] = await parser.next();

      // Always write before if we have it
      writeString(before);

      if (tag && tag.whole) {
        writer(tag.whole, true);
        value = after as string;
      } else if (tag && !tag.whole) {
        prev_chunk = tag.opening.tag + after;
        break;
      } else {
        const incompleteTag = value.search(/<(?:!--)?esi/);
        if (incompleteTag !== -1) {
          prev_chunk = value;
          break;
        }

        const hintMatch = value
          .slice(-6)
          .match(/(?:<!--es|<!--e|<!--|<es|<!-|<e|<!|<)$/);
        if (hintMatch) {
          prev_chunk = hintMatch[0];
          value = value.substring(0, value.length - prev_chunk.length);
        }
        writeString(value);
        break;
      }

      // eslint-disable-next-line no-constant-condition
    } while (true);

    // Check if we had something left over
    // But we didnt write it
    if (done) {
      writeString(prev_chunk);
    }
  };
}
