import { create as createHandleChunk } from "../src/handleChunk";

test("Writes a chunk with no esi", async () => {
  const testString = "<div>NO ESI HERE</div>";
  const writer = function (string: string, hasESI: boolean) {
    expect(hasESI).toBeFalsy();
    expect(string).toEqual(testString);
  };
  const handleChunk = createHandleChunk(writer);
  handleChunk(testString, false);
});

test("Writes the before of a chunk with ESI but not a whole tag", async () => {
  const testString = "BEFORE TEXT<esi:foo>dfafdsafdsa";
  const writer = function (string: string, hasESI: boolean) {
    expect(hasESI).toBeFalsy();
    expect(string).toEqual("BEFORE TEXT");
  };
  const handleChunk = createHandleChunk(writer);
  handleChunk(testString, false);
});

test("Writes the before of a chunk with ESI, then prints the ESI tag and after data", async () => {
  const testString = "BEFORE TEXT<esi:foo>dfafdsafdsa</esi:foo>AFTER TEXT";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeTruthy();
      expect(string).toEqual("<esi:foo>dfafdsafdsa</esi:foo>");
    } else if (write == 3) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("AFTER TEXT");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString, false);
  expect(write).toEqual(3);
});

test("Writes the before of a chunk with ESI, then prints the ESI tag and after data BUT only when it gets it in a second chunk", async () => {
  const testString1 = "BEFORE TEXT<esi:foo>dfafdsafdsa ";
  const testString2 = "fdsafdsafsdaf</esi:foo>AFTER TEXT";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeTruthy();
      expect(string).toEqual("<esi:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>");
    } else if (write == 3) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("AFTER TEXT");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString1, false);
  await handleChunk(testString2, false);
  expect(write).toEqual(3);
});

test("ESI Hints should work", async () => {
  const testString1 = "BEFORE TEXT<es";
  const testString2 = "i:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeTruthy();
      expect(string).toEqual("<esi:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>");
    } else if (write == 3) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("AFTER TEXT");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString1, false);
  await handleChunk(testString2, false);
  await handleChunk("AFTER TEXT", false);
  expect(write).toEqual(3);
});

test("Should print our full chunk even if it doesn't complete", async () => {
  const testString1 = "BEFORE TEXT<es";
  const testString2 = "i:foo>dfafdsafdsa";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("<esi:foo>dfafdsafdsa");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString1, false);
  await handleChunk(testString2, true);
  expect(write).toEqual(2);
});

test("Should print our full chunk even if it's an imcomplete tag", async () => {
  const testString1 = "BEFORE TEXT<esi";
  const testString2 = ":foo>dfafdsafdsa";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("<esi:foo>dfafdsafdsa");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString1, false);
  await handleChunk(testString2, true);
  expect(write).toEqual(2);
});

test("Should only add hint tag on the next chunk", async () => {
  const testString1 = "BEFORE TEXT<!--";
  const testString2 = "help -->dfafdsafdsa";
  const testString3 = "AFTER TEXT";
  let write = 0;
  const writer = function (string: string, hasESI: boolean) {
    write++;
    if (write == 1) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("BEFORE TEXT");
    } else if (write == 2) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("<!--help -->dfafdsafdsa");
    } else if (write == 3) {
      expect(hasESI).toBeFalsy();
      expect(string).toEqual("AFTER TEXT");
    } else {
      fail();
    }
  };
  const handleChunk = createHandleChunk(writer);
  await handleChunk(testString1, false);
  await handleChunk(testString2, false);
  await handleChunk(testString3, true);
  expect(write).toEqual(3);
});
