import { tagParser } from "../src/tagParser";

test("Find next tag", async () => {
  const parser = new tagParser("content-before<foo>inside</foo>content-after");
  const [tag, parserBefore, parserAfter] = await parser.next("foo");
  expect(tag).toEqual({
    opening: { from: 14, to: 18, tag: "<foo>" },
    tagname: "foo",
    closing: { from: 25, to: 30, tag: "</foo>" },
    whole: "<foo>inside</foo>",
    contents: "inside",
  });
  expect(parserBefore).toEqual("content-before");
  expect(parserAfter).toEqual("content-after");
});

describe("Default next tag finds esi", () => {
  const parser = new tagParser(
    "content-before<esi:foo>inside</esi:foo>content-after<!--esi comment-->last",
  );
  test("first tag", async () => {
    const [tag, parserBefore, parserAfter] = await parser.next();
    expect(tag).toEqual({
      opening: { from: 14, to: 22, tag: "<esi:foo>" },
      tagname: "esi:foo",
      closing: { from: 29, to: 38, tag: "</esi:foo>" },
      whole: "<esi:foo>inside</esi:foo>",
      contents: "inside",
    });
    expect(parserBefore).toEqual("content-before");
    expect(parserAfter).toEqual("content-after<!--esi comment-->last");
  });
  test("second tag", async () => {
    const [tag, parserBefore, parserAfter] = await parser.next();
    expect(tag).toEqual({
      opening: { from: 52, to: 59, tag: "<!--esi " },
      tagname: "!--esi",
      closing: { from: 67, to: 69, tag: "-->" },
      whole: "<!--esi comment-->",
      contents: "comment",
    });
    expect(parserBefore).toEqual("content-after");
    expect(parserAfter).toEqual("last");
  });
});

test("Finds a unclosed tag", async () => {
  const parser = new tagParser(
    "content-before<esi:foo>inside content-after<!--esi comment-->last",
  );
  const [tag, parserBefore, parserAfter] = await parser.next();
  expect(tag).toEqual({
    opening: { from: 14, to: 22, tag: "<esi:foo>" },
    tagname: "esi:foo",
    closing: null,
    whole: null,
    contents: null,
  });
  expect(parserBefore).toEqual("content-before");
  expect(parserAfter).toEqual("inside content-after<!--esi comment-->last");
});

test("Finds a closed tag", async () => {
  const parser = new tagParser(
    'content-before<esi:comment test="12345" />content-after',
  );
  const [tag, parserBefore, parserAfter] = await parser.next();
  expect(tag).toEqual({
    opening: { from: 14, to: 41, tag: '<esi:comment test="12345" />' },
    tagname: "esi:comment",
    closing: null,
    whole: '<esi:comment test="12345" />',
    contents: null,
  });
  expect(parserBefore).toEqual("content-before");
  expect(parserAfter).toEqual("content-after");
});

test("Finds correct tag after an illegal closure", async () => {
  const parser = new tagParser(
    `BEFORE CONTENT<esi:when test="$(QUERY_STRING{c}) == 'c'">c<esi:choose></esi:vars alt="BAD ILLEGAL NESTING"><esi:when test="$(QUERY_STRING{l1d}) == 'l1d'">l1d</esi:when><esi:when test="$(QUERY_STRING{l1e}) == 'l1e'">l1e<esi:choose><esi:when test="$(QUERY_STRING{l2f}) == 'l2f'">l2f</esi:when><esi:otherwise>l2 OTHERWISE</esi:otherwise></esi:choose></esi:when><esi:otherwise>l1 OTHERWISE<esi:choose><esi:when test="$(QUERY_STRING{l2g}) == 'l2g'">l2g</esi:when></esi:when alt="MORE BAD ILLEGAL NESTING"></esi:choose></esi:otherwise></esi:choose></esi:when>AFTER`,
  );
  const [tag, parserBefore, parserAfter] = await parser.next(
    "esi:when|esi:otherwise",
  );
  expect(tag).toEqual({
    opening: {
      from: 14,
      to: 56,
      tag: "<esi:when test=\"$(QUERY_STRING{c}) == 'c'\">",
    },
    tagname: "esi:when",
    closing: { from: 542, to: 552, tag: "</esi:when>" },
    whole: `<esi:when test="$(QUERY_STRING{c}) == 'c'">c<esi:choose></esi:vars alt="BAD ILLEGAL NESTING"><esi:when test="$(QUERY_STRING{l1d}) == 'l1d'">l1d</esi:when><esi:when test="$(QUERY_STRING{l1e}) == 'l1e'">l1e<esi:choose><esi:when test="$(QUERY_STRING{l2f}) == 'l2f'">l2f</esi:when><esi:otherwise>l2 OTHERWISE</esi:otherwise></esi:choose></esi:when><esi:otherwise>l1 OTHERWISE<esi:choose><esi:when test="$(QUERY_STRING{l2g}) == 'l2g'">l2g</esi:when></esi:when alt="MORE BAD ILLEGAL NESTING"></esi:choose></esi:otherwise></esi:choose></esi:when>`,
    contents: `c<esi:choose></esi:vars alt="BAD ILLEGAL NESTING"><esi:when test="$(QUERY_STRING{l1d}) == 'l1d'">l1d</esi:when><esi:when test="$(QUERY_STRING{l1e}) == 'l1e'">l1e<esi:choose><esi:when test="$(QUERY_STRING{l2f}) == 'l2f'">l2f</esi:when><esi:otherwise>l2 OTHERWISE</esi:otherwise></esi:choose></esi:when><esi:otherwise>l1 OTHERWISE<esi:choose><esi:when test="$(QUERY_STRING{l2g}) == 'l2g'">l2g</esi:when></esi:when alt="MORE BAD ILLEGAL NESTING"></esi:choose></esi:otherwise></esi:choose>`,
  });
  expect(parserBefore).toEqual("BEFORE CONTENT");
  expect(parserAfter).toEqual("AFTER");
});

test("Find tag with attributes", async () => {
  const parser = new tagParser(
    "content-before<foo attr='value' attr2='value2'>inside</foo>content-after",
  );
  const [tag, parserBefore, parserAfter] = await parser.next("foo");
  expect(tag).toEqual({
    opening: { from: 14, to: 18, tag: `<foo ` },
    tagname: "foo",
    closing: { from: 53, to: 58, tag: "</foo>" },
    whole: `<foo attr='value' attr2='value2'>inside</foo>`,
    contents: `attr='value' attr2='value2'>inside`,
  });
  expect(parserBefore).toEqual("content-before");
  expect(parserAfter).toEqual("content-after");
});

describe("Find nested tags", () => {
  test("first tag", async () => {
    const parser = new tagParser(
      "content-before<foo>inside-foo<bar>inside-bar</bar>after-bar<foo>inside-foo-2</foo></foo>content-after",
    );
    const [tag, parserBefore, parserAfter] = await parser.next("foo");
    expect(tag).toEqual({
      opening: { from: 14, to: 18, tag: `<foo>` },
      tagname: "foo",
      closing: { from: 82, to: 87, tag: "</foo>" },
      whole: `<foo>inside-foo<bar>inside-bar</bar>after-bar<foo>inside-foo-2</foo></foo>`,
      contents: `inside-foo<bar>inside-bar</bar>after-bar<foo>inside-foo-2</foo>`,
    });
    expect(parserBefore).toEqual("content-before");
    expect(parserAfter).toEqual("content-after");
  });
  test("second tag", async () => {
    const parser = new tagParser(
      "content-before<foo>inside-foo<bar>inside-bar</bar>after-bar<foo>inside-foo-2</foo></foo>content-after",
    );
    const [tag, parserBefore, parserAfter] = await parser.next("bar");
    expect(tag).toEqual({
      opening: { from: 29, to: 33, tag: "<bar>" },
      tagname: "bar",
      closing: { from: 44, to: 49, tag: "</bar>" },
      whole: "<bar>inside-bar</bar>",
      contents: "inside-bar",
    });
    expect(parserBefore).toEqual("content-before<foo>inside-foo");
    expect(parserAfter).toEqual(
      "after-bar<foo>inside-foo-2</foo></foo>content-after",
    );
  });
});

describe("open pattern matches", () => {
  const parser = new tagParser("");
  const pattern = parser.openingTag("tag");
  const checks = [
    { string: "start <tag> end", details: "simple tag" },
    { string: "start <tag></tag> end", details: "simple closed tag" },
    {
      string: "start <tag> asdfsd </tag> end",
      details: "simple closed tag with content",
    },
    { string: "start <tag > end", details: "simple tag whitespace" },
    { string: "start <tag/> end", details: "self-closing tag" },
    { string: "start <tag /> end", details: "self-closing tag whitespace" },
    { string: "start <tag end", details: "unclosed tag" },
    {
      string: "start <tag attr='value'> end",
      details: "simple tag with attribute",
    },
    {
      string: 'start <tag attr="value"> end',
      details: "simple tag with attribute (single-quote)",
    },
    {
      string: 'start <tag attr123="value123"> end',
      details: "simple tag with attribute (numeric)",
    },
    {
      string: 'start <tag attr_123-foo="value 123-test_"> end',
      details: "simple tag with attribute (special chars)",
    },
  ];
  checks.forEach(function (check) {
    it(check.details, async () => {
      const match = check.string.search(pattern);
      expect(match).toBeGreaterThan(-1);
    });
  });
});
describe("close pattern matches", () => {
  const parser = new tagParser("");
  const pattern = parser.closeTag("tag");
  const checks = [
    { string: "start </tag> end", details: "simple tag" },
    { string: "start <tag></tag> end", details: "simple closed tag" },
    {
      string: "start <tag> asdfsd </tag> end",
      details: "simple closed tag with content",
    },
    { string: "start </tag > end", details: "simple tag with whitespace" },
  ];
  checks.forEach(function (check) {
    test(check.details, async () => {
      const match = check.string.search(pattern);
      expect(match).toBeGreaterThan(-1);
    });
  });
});
describe("either pattern matches", () => {
  const parser = new tagParser("");
  const pattern = parser.eitherTag("tag");
  const checks = [
    { string: "start <tag> end", details: "simple tag" },
    { string: "start <tag></tag> end", details: "simple closed tag" },
    {
      string: "start <tag> asdfsd </tag> end",
      details: "simple closed tag with content",
    },
    { string: "start <tag > end", details: "simple tag whitespace" },
    { string: "start <tag/> end", details: "self-closing tag" },
    { string: "start <tag /> end", details: "self-closing tag whitespace" },
    { string: "start <tag end", details: "unclosed tag" },
    {
      string: "start <tag attr='value'> end",
      details: "simple tag with attribute",
    },
    {
      string: 'start <tag attr="value"> end',
      details: "simple tag with attribute (single-quote)",
    },
    {
      string: 'start <tag attr123="value123"> end',
      details: "simple tag with attribute (numeric)",
    },
    {
      string: 'start <tag attr_123-foo="value 123-test_"> end',
      details: "simple tag with attribute (special chars)",
    },
    { string: "start </tag> end", details: "simple tag" },
    { string: "start <tag></tag> end", details: "simple closed tag" },
    {
      string: "start <tag> asdfsd </tag> end",
      details: "simple closed tag with content",
    },
    { string: "start </tag > end", details: "simple tag with whitespace" },
  ];
  checks.forEach(function (check) {
    test(check.details, async () => {
      const match = check.string.search(pattern);
      expect(match).toBeGreaterThan(-1);
    });
  });
});
