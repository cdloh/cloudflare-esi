type tagData = {
  from: number;
  to: number;
  tag: string;
};

export type tag = {
  opening: tagData;
  closing: tagData | null;
  tagname: string;
  whole: string | null;
  contents: string | null;
};

export class tagParser {
  #content: string;
  #pos: number;

  constructor(content: string, offset?: number) {
    this.#content = content;
    this.#pos = offset || 0;

    this.next = this.next.bind(this);
  }

  async next(
    tagname?: string
  ): Promise<[tag | null, string | undefined, string | undefined]> {
    const tag = await this.#findWholeTag(tagname);
    let before, after;

    if (tag) {
      before = this.#content.substring(this.#pos, tag.opening.from);
      if (tag.closing) {
        after = this.#content.substring(tag.closing.to + 1);
        this.#pos = tag.closing.to + 1;
      } else {
        after = this.#content.substring(tag.opening.to + 1);
        this.#pos = tag.opening.to + 1;
      }
    }

    return [tag, before, after];
  }

  openingTag(tag: string): RegExp {
    if (tag == "!--esi") {
      return /<(!--esi)/is;
    }

    return new RegExp(
      `<(${tag})(?:\\s*(?:[a-z]+=\\".+?(?<!\\\\)\\"))?[^>]*?(?:\\s*)(/>|>)?`
    );
  }

  eitherTag(tag: string): RegExp {
    if (tag == "!--esi") {
      return /(?:<(!--esi)|(-->))/;
    }
    return new RegExp(
      `<[\\/]?(${tag})(?:\\s*(?:[a-z]+=\\".+?(?<!\\\\)\\"))?[^>]*?(?:\\s*)(\\s*/>|>)?`
    );
  }

  closeTag(tag: string): RegExp {
    if (tag == "!--esi") {
      return /-->/;
    }
    return new RegExp(`<\\/(${tag})\\s*>`);
  }

  async #findWholeTag(tag?: string): Promise<tag | null> {
    const markup = this.#content.slice(this.#pos);

    if (!tag) {
      tag = "(?:!--esi)|(?:esi:[a-z]+)";
    }

    const open_pos = markup.search(this.openingTag(tag));
    if (open_pos == -1) {
      return null;
    }

    let matches = markup.match(this.openingTag(tag));
    if (!matches || matches.length == 0) {
      return null;
    }

    const open_pos_end = open_pos + matches[0].length - 1;

    const ret: tag = {
      opening: {
        from: open_pos + this.#pos,
        to: open_pos_end + this.#pos,
        tag: matches[0],
      },
      tagname: matches[1],
      closing: null,
      whole: null,
      contents: null,
    };

    if (matches[2] !== undefined && matches[2].substring(0, 2) == "/>") {
      ret.whole = matches[0];
      return ret;
    }

    let search = open_pos_end + 1;
    let level = 1;
    let closing_f, closing_t;

    do {
      matches = markup.substring(search).match(this.eitherTag(ret.tagname));
      if (!matches || matches.index == undefined) {
        // Couldnt find anything
        break;
      }
      // Moving closing markers along
      closing_f = matches.index;
      closing_t = matches.index + matches[0].length;

      const tagInner = markup.substring(search).substring(closing_f, closing_t);

      // check our depth
      if (tagInner.search(this.openingTag(ret.tagname)) !== -1) {
        level++;
      } else if (tagInner.search(this.closeTag(ret.tagname)) !== -1) {
        level--;
      }
      search = search + closing_t;

      // We're done here
      if (level == 0) {
        break;
      }

      // eslint-disable-next-line no-constant-condition
    } while (true);

    if (closing_t && level == 0 && matches) {
      closing_t = search - 1;
      closing_f = search - matches[0].length;

      ret.closing = {
        from: closing_f + this.#pos,
        to: closing_t + this.#pos,
        tag: matches[0],
      };
      ret.contents = markup.substring(open_pos_end + 1, closing_f);
      ret.whole = markup.substring(open_pos, closing_t + 1);

      return ret;
    } else {
      return ret;
    }
  }
}
