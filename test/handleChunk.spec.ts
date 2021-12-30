import { create as createHandleChunk } from "../src/handleChunk";


test("Writes a chunk with no esi", async () => {
	let testString = "<div>NO ESI HERE</div>"
	let writer = function (string: string, hasESI: boolean) {
		expect(hasESI).toBeFalsy();
		expect(string).toEqual(testString);
	};
	let handleChunk = createHandleChunk(writer)
	handleChunk({ value: testString, done: false })
})

test("Writes the before of a chunk with ESI but not a whole tag", async () => {
	let testString = "BEFORE TEXT<esi:foo>dfafdsafdsa"
	let writer = function (string: string, hasESI: boolean) {
		expect(hasESI).toBeFalsy();
		expect(string).toEqual("BEFORE TEXT");
	};
	let handleChunk = createHandleChunk(writer)
	handleChunk({ value: testString, done: false })
})

test("Writes the before of a chunk with ESI, then prints the ESI tag and after data", async () => {
	let testString = "BEFORE TEXT<esi:foo>dfafdsafdsa</esi:foo>AFTER TEXT"
	let write = 0
	let writer = function (string: string, hasESI: boolean) {
		write++
		if (write == 1) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("BEFORE TEXT");
		} else if (write == 2) {
			expect(hasESI).toBeTruthy();
			expect(string).toEqual("<esi:foo>dfafdsafdsa</esi:foo>");
		} else if (write == 3) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("AFTER TEXT");
		} else { fail() }

	};
	let handleChunk = createHandleChunk(writer)
	await handleChunk({ value: testString, done: false })
	expect(write).toEqual(3)
})

test("Writes the before of a chunk with ESI, then prints the ESI tag and after data BUT only when it gets it in a second chunk", async () => {
	let testString1 = "BEFORE TEXT<esi:foo>dfafdsafdsa "
	let testString2 = "fdsafdsafsdaf</esi:foo>AFTER TEXT"
	let write = 0
	let writer = function (string: string, hasESI: boolean) {
		write++
		if (write == 1) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("BEFORE TEXT");
		} else if (write == 2) {
			expect(hasESI).toBeTruthy();
			expect(string).toEqual("<esi:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>");
		} else if (write == 3) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("AFTER TEXT");
		} else { fail() }

	};
	let handleChunk = createHandleChunk(writer)
	await handleChunk({ value: testString1, done: false })
	await handleChunk({ value: testString2, done: false })
	expect(write).toEqual(3)
})

test("ESI Hints should work", async () => {
	let testString1 = "BEFORE TEXT<es"
	let testString2 = "i:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>"
	let write = 0
	let writer = function (string: string, hasESI: boolean) {
		debugger
		write++
		if (write == 1) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("BEFORE TEXT");
		} else if (write == 2) {
			expect(hasESI).toBeTruthy();
			expect(string).toEqual("<esi:foo>dfafdsafdsa fdsafdsafsdaf</esi:foo>");
		} else if (write == 3) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("AFTER TEXT");
		} else { fail() }

	};
	let handleChunk = createHandleChunk(writer)
	await handleChunk({ value: testString1, done: false })
	await handleChunk({ value: testString2, done: false })
	await handleChunk({ value: "AFTER TEXT", done: false })
	expect(write).toEqual(3)
})

test("Should print our full chunk even if it doesn't complete", async () => {
	let testString1 = "BEFORE TEXT<es"
	let testString2 = "i:foo>dfafdsafdsa"
	let write = 0
	let writer = function (string: string, hasESI: boolean) {
		debugger
		write++
		if (write == 1) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("BEFORE TEXT");
		} else if (write == 2) {
			expect(hasESI).toBeFalsy();
			expect(string).toEqual("<esi:foo>dfafdsafdsa");
		} else { fail() }

	};
	let handleChunk = createHandleChunk(writer)
	await handleChunk({ value: testString1, done: false })
	await handleChunk({ value: testString2, done: true })
	expect(write).toEqual(2)
})
