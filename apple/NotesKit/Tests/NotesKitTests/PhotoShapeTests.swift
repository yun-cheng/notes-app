import Testing

@testable import NotesKit

/** A photo's block keeps its size, so its shape is known before it loads, as on the web (`content.test.ts`). */
@Suite struct PhotoShapeTests {
    @Test func blocksKeepTheirSize() {
        #expect(Doc.photoNode("p", width: 1800, height: 600) == ["type": "photo", "attrs": ["id": "p", "width": .int(1800), "height": .int(600)]])
        #expect(Doc.photoNode("q") == ["type": "photo", "attrs": ["id": "q"]])
        #expect(Doc.photoNode("r", width: 0, height: 5) == ["type": "photo", "attrs": ["id": "r"]])
        let page: JSONValue = ["type": "doc", "content": [Doc.photoNode("p", width: 1800, height: 600), Doc.photoNode("q"), ["type": "photo", "attrs": ["id": "s", "width": .double(-3), "height": .int(2)]]]]
        #expect(Doc.photoRatios(page) == ["p": 3])
    }
}
