import Foundation
import SwiftUI
import Testing

@testable import NotesKit

@MainActor
@Suite struct DocTextTests {
    let context = EnvironmentValues().fontResolutionContext

    func text(_ s: String, _ marks: [String] = []) -> JSONValue {
        var node: JSONValue = ["type": "text", "text": .string(s)]
        if !marks.isEmpty { node["marks"] = .array(marks.map { ["type": .string($0)] }) }
        return node
    }

    func para(_ inline: JSONValue...) -> JSONValue {
        inline.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": .array(inline)]
    }

    func doc(_ blocks: JSONValue...) -> JSONValue { ["type": "doc", "content": .array(blocks)] }

    func roundTrip(_ d: JSONValue) -> JSONValue { DocText(doc: d).doc(in: context) }

    @Test func paragraphsAndInlineMarks() {
        let d = doc(
            para(text("Plain, "), text("bold", ["bold"]), text(" and "), text("both", ["bold", "italic"])),
            para(),
            para(text("code", ["code"]), text(" "), text("gone", ["strike"]), text(" "), text("under", ["underline"])),
        )
        #expect(roundTrip(d) == d)
        #expect(String(DocText(doc: d).text.characters) == "Plain, bold and both\n\ncode gone under")
    }

    @Test func linksCardLinksAndBreaks() {
        let link: JSONValue = ["type": "text", "text": "site", "marks": [["type": "link", "attrs": ["href": "https://example.com/a"]]]]
        let card: JSONValue = ["type": "cardLink", "attrs": ["id": "c-1", "label": "Groceries"]]
        let d = doc(para(text("See "), card, text(" and "), link, ["type": "hardBreak"], text("next line")))
        #expect(roundTrip(d) == d)
        // Card links show the card's current title, and keep it.
        let renamed = DocText(doc: d, titleOf: { _, _ in "Shopping" })
        #expect(String(renamed.text.characters).hasPrefix("See Shopping and"))
        let relabelled = renamed.doc(in: context)["content"]?[0]?["content"]?[1]
        #expect(relabelled == ["type": "cardLink", "attrs": ["id": "c-1", "label": "Shopping"]])
    }

    @Test func headingsQuotesRulesAndCode() {
        let d = doc(
            ["type": "heading", "attrs": ["level": 2], "content": [text("Plan")]],
            ["type": "blockquote", "content": [para(text("Quoted")), para(text("twice"))]],
            ["type": "horizontalRule"],
            ["type": "codeBlock", "attrs": ["language": "swift"], "content": [text("let a = 1\nprint(a)")]],
            para(text("after")),
        )
        #expect(roundTrip(d) == d)
        #expect(String(DocText(doc: d).text.characters) == "## Plan\n> Quoted\n> twice\n---\n```swift\nlet a = 1\nprint(a)\n```\nafter")
    }

    @Test func nestedLists() {
        func item(_ s: String, _ more: JSONValue...) -> JSONValue {
            ["type": "listItem", "content": .array([para(text(s))] + more)]
        }
        let inner: JSONValue = ["type": "orderedList", "attrs": ["start": 1], "content": [item("one"), item("two")]]
        let d = doc(["type": "bulletList", "content": [item("milk", inner), item("eggs", para(text("free range")))]])
        #expect(String(DocText(doc: d).text.characters) == "• milk\n  1. one\n  2. two\n• eggs\n  free range")
        #expect(roundTrip(d) == d)
    }

    @Test func photosAndUnknownNodesSurvive() {
        let photo: JSONValue = ["type": "photo", "attrs": ["id": "p1", "alt": "Beach", "width": 800]]
        let table: JSONValue = ["type": "table", "content": [["type": "tableRow"]]]
        let d = doc(para(text("Trip")), photo, table)
        let t = DocText(doc: d)
        #expect(String(t.text.characters) == "Trip\n[Photo: Beach]\n[table]")
        #expect(t.doc(in: context) == d)
    }

    @Test func typedMarkersBecomeBlocks() {
        let typed = DocText(text: AttributedString("# Title\n- a\n- b\n1. first\nplain"), stash: [:])
        let d = typed.doc(in: context)
        let types = d["content"]?.arrayValue?.compactMap { $0["type"]?.stringValue }
        #expect(types == ["heading", "bulletList", "orderedList", "paragraph"])
        #expect(d["content"]?[1]?["content"]?.arrayValue?.count == 2)
    }

    @Test func emptyTextIsAnEmptyDoc() {
        #expect(DocText(text: AttributedString(""), stash: [:]).doc(in: context) == doc(para()))
        #expect(String(DocText(doc: Doc.empty).text.characters) == "")
    }
}

extension JSONValue {
    subscript(index: Int) -> JSONValue? { arrayValue.flatMap { index < $0.count ? $0[index] : nil } }
}
