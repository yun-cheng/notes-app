import Foundation
import Testing

@testable import NotesKit

/// The web app's own test cases for the journal's rules, run against the Swift port.
@Suite struct EntryTests {
    static let today = "2026-11-12"  // a Thursday

    static func t(_ text: String, _ marks: [JSONValue]? = nil) -> JSONValue {
        var n: JSONValue = ["type": "text", "text": .string(text)]
        if let marks { n["marks"] = .array(marks) }
        return n
    }
    static func para(_ content: JSONValue...) -> JSONValue { content.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": .array(content)] }
    static func item(_ checked: Bool, _ content: JSONValue...) -> JSONValue { ["type": "taskItem", "attrs": ["checked": .bool(checked)], "content": .array(content)] }
    static func tasks(_ items: JSONValue...) -> JSONValue { ["type": "taskList", "content": .array(items)] }
    static func doc(_ content: JSONValue...) -> JSONValue { ["type": "doc", "content": .array(content)] }
    func parse(_ text: String) -> Entry? { EntryParser.parseEntry(text, today: Self.today) }

    @Test func plainTextIsANote() {
        let e = parse("Call the bank\nabout the card")
        #expect(e?.kind == .note && e?.title == "" && e?.content == Doc.fromText("Call the bank\nabout the card") && e?.due == nil)
        #expect(parse("  \n ") == nil && parse("#work #home") == nil && parse("[] ") == nil)
    }

    @Test func tags() {
        let e = parse("Idea for the #Work offsite\n#ideas #work")
        #expect(e?.tags == ["Work", "ideas"] && e?.content == Doc.fromText("Idea for the offsite"))
        #expect(parse("買菜 #家裡")?.tags == ["家裡"])
        #expect(parse("issue#12 and C#")?.tags == [])
    }

    @Test func todoMarkers() {
        for text in ["[] Buy milk", "[ ] Buy milk", "[]Buy milk", "TODO Buy milk", "Buy milk #todo"] {
            #expect(parse(text)?.kind == .todo && parse(text)?.title == "Buy milk", "\(text)")
        }
        #expect(parse("todo list for the week")?.kind == .note)
        let done = parse("[x] Bought milk")
        #expect(done?.title == "Bought milk" && done?.done == true)
        let pack = parse("[] Pack for the trip\npassport\ncharger")
        #expect(pack?.title == "Pack for the trip" && pack?.content == Doc.fromText("passport\ncharger"))
        #expect(parse("[] Pack")?.content == Doc.empty)
    }

    @Test func dueDatesAndDiary() {
        let rent = parse("[] Pay rent @tomorrow #home")
        #expect(rent?.title == "Pay rent" && rent?.due == "2026-11-13" && rent?.tags == ["home"])
        #expect(parse("[] Email @someone")?.title == "Email @someone" && parse("[] Email @someone")?.due == nil)
        #expect(parse("Lunch @friday was fun")?.content == Doc.fromText("Lunch @friday was fun"))
        let walk = parse("Long walk by the river. #diary")
        #expect(walk?.diary == true && walk?.content == Doc.fromText("Long walk by the river.") && walk?.tags == [])
        #expect(parse("[] Call grandma #diary")?.diary == true)
    }

    @Test func severalEntries() {
        let titles = { (text: String, all: Bool) in
            EntryParser.parseEntries(text, today: Self.today, allTodos: all).map { e in
                "\(e.kind.rawValue):\(e.title.isEmpty ? (e.content["content"]?.arrayValue?.first?["content"]?.arrayValue?.first?["text"]?.stringValue ?? "") : e.title)"
            }
        }
        #expect(titles("[] milk\n[] eggs @tomorrow\nTODO call mom", false) == ["todo:milk", "todo:eggs", "todo:call mom"])
        #expect(titles("Shopping for the party\n[] cake\n[] candles", false) == ["note:Shopping for the party", "todo:cake", "todo:candles"])
        #expect(EntryParser.parseEntries("[] milk #dairy\n[] bread\n\n#groceries #home", today: Self.today).map(\.tags) == [["dairy", "groceries", "home"], ["groceries", "home"]])
        #expect(titles("milk\n\neggs\n[] bread", true) == ["todo:milk", "todo:eggs", "todo:bread"])
    }

    @Test func fromTheBox() {
        let entries = EntryParser.entries(
            from: Self.doc(Self.para(Self.t("Party prep")), Self.para(Self.t("at Sam’s")), Self.tasks(Self.item(false, Self.para(Self.t("cake @fri"))), Self.item(true, Self.para(Self.t("balloons")))), Self.para(Self.t("#home"))),
            today: Self.today)
        #expect(entries.count == 3)
        #expect(entries[0].kind == .note && entries[0].content == Self.doc(Self.para(Self.t("Party prep")), Self.para(Self.t("at Sam’s"))) && entries[0].tags == ["home"])
        #expect(entries[1].title == "cake" && entries[1].due == "2026-11-13" && entries[1].content == Doc.empty)
        #expect(entries[2].title == "balloons" && entries[2].done)

        let link: [JSONValue] = [["type": "link", "attrs": ["href": "https://a.example"]]]
        let read = EntryParser.entries(from: Self.doc(Self.para(Self.t("Read "), Self.t("this", link), Self.t(" later #reading"))), today: Self.today)
        #expect(read.first?.tags == ["reading"] && read.first?.content == Self.doc(Self.para(Self.t("Read "), Self.t("this", link), Self.t(" later"))))

        let code: JSONValue = ["type": "codeBlock", "content": [Self.t("#include <stdio.h>\n@media print {}")]]
        let inline: [JSONValue] = [["type": "code"]]
        let coded = EntryParser.entries(from: Self.doc(Self.para(Self.t("Snippet #c")), code, Self.tasks(Self.item(false, Self.para(Self.t("run "), Self.t("@daily", inline), Self.t(" #ops @fri"))))), today: Self.today)
        #expect(coded.count == 2 && coded[0].content == Self.doc(Self.para(Self.t("Snippet")), code) && coded[0].tags == ["c"])
        #expect(coded[1].title == "run @daily" && coded[1].tags == ["ops"] && coded[1].due == "2026-11-13")

        let nested = Self.item(false, Self.para(Self.t("Trip")), Self.para(Self.t("passport")), Self.tasks(Self.item(false, Self.para(Self.t("book hotel")))))
        let trip = EntryParser.entries(from: Self.doc(Self.tasks(nested)), today: Self.today)
        #expect(trip.map(\.title) == ["Trip", "book hotel"] && trip[0].content == Self.doc(Self.para(Self.t("passport"))))

        #expect(EntryParser.entries(from: Self.doc(Self.para(Self.t("[x] posted the letter"))), today: Self.today).first?.title == "posted the letter")
        #expect(EntryParser.entries(from: Self.doc(Self.para(), Self.tasks(Self.item(false, Self.para())), Self.para(Self.t("#work"))), today: Self.today).isEmpty)
        let photo: JSONValue = ["type": "photo", "attrs": ["id": "p-1"]]
        #expect(EntryParser.entries(from: Self.doc(photo), today: Self.today).first?.content == Self.doc(photo))
    }

    @Test func dueWords() {
        #expect(EntryParser.parseDue("Tomorrow", today: Self.today) == "2026-11-13")
        #expect(EntryParser.parseDue("2026-02-30", today: Self.today) == nil)
        #expect(EntryParser.parseDue("fr", today: Self.today) == nil)
        #expect(EntryParser.parseDue("fri", today: Self.today) == "2026-11-13")
        #expect(EntryParser.parseDue("monday", today: Self.today) == "2026-11-16")
        #expect(EntryParser.parseDue("thu", today: Self.today) == "2026-11-19")
        let rent = parse("[] Pay rent @monthly @2026-12-01 @9am")
        #expect(rent?.due == "2026-12-01" && rent?.dueTime == "09:00" && rent?.repeat == Repeat(unit: .month, every: 1))
        let dentist = parse("[] Call the dentist @3:30pm")
        #expect(dentist?.due == Self.today && dentist?.dueTime == "15:30")
        #expect(parse("[] Ask @bob about 3pm")?.title == "Ask @bob about 3pm")
        #expect(["fri", "3pm", "weekly", "bob"].map { EntryParser.dueKind($0, today: Self.today) } == [.date, .time, .repeat, nil])
    }
}

@Suite struct RepeatTests {
    static let today = "2026-11-12"
    let daily = Repeat(unit: .day, every: 1)
    let weekly = Repeat(unit: .week, every: 1)
    let monthly = Repeat(unit: .month, every: 1)
    let weekdays = Repeat(unit: .weekday, every: 1)

    @Test func nextDue() {
        #expect(daily.nextDue(after: Self.today, today: Self.today) == "2026-11-13")
        #expect(Repeat(unit: .week, every: 2).nextDue(after: Self.today, today: Self.today) == "2026-11-26")
        #expect(Repeat(unit: .year, every: 1).nextDue(after: Self.today, today: Self.today) == "2027-11-12")
        #expect(weekly.nextDue(after: "2026-11-20", today: Self.today) == "2026-11-27")
        #expect(daily.nextDue(after: "2026-11-09", today: Self.today) == "2026-11-13")
        #expect(weekly.nextDue(after: "2026-11-09", today: Self.today) == "2026-11-16")
        #expect(monthly.nextDue(after: "2026-08-30", today: Self.today) == "2026-11-30")
        #expect(monthly.nextDue(after: "2026-01-31", today: "2026-01-31") == "2026-02-28")
        #expect(monthly.nextDue(after: "2026-01-31", today: "2026-03-05") == "2026-03-31")
        #expect(Repeat(unit: .year, every: 1).nextDue(after: "2028-02-29", today: "2028-02-29") == "2029-02-28")
        #expect(weekdays.nextDue(after: "2026-11-13", today: "2026-11-13") == "2026-11-16")
        #expect(weekdays.nextDue(after: "2026-11-09", today: Self.today) == "2026-11-13")
        #expect(weekdays.firstDue(today: "2026-11-14") == "2026-11-16")
        #expect(weekly.firstDue(today: "2026-11-14") == "2026-11-14")
        #expect(weekly.nextDue(after: nil, today: Self.today) == "2026-11-19")
    }

    @Test func words() {
        #expect(Repeat.parse("Weekly") == weekly && Repeat.parse("weekdays") == weekdays && Repeat.parse("every-day") == daily)
        #expect(Repeat.parse("every-3-months") == Repeat(unit: .month, every: 3))
        for word in ["every-0-days", "every-2-weekdays", "fortnightly", "every", "every-2"] { #expect(Repeat.parse(word) == nil, "\(word)") }
        for r in Repeat.choices + [Repeat(unit: .day, every: 3)] { #expect(Repeat.parse(r.word) == r) }
        #expect(Repeat.choices.map(\.label) == ["Daily", "Every weekday", "Weekly", "Every 2 weeks", "Monthly", "Yearly"])
        #expect(Repeat(unit: .day, every: 3).label == "Every 3 days")
    }

    @Test func tickingARepeatingTodoMovesItOn() {
        var todo = Card(id: "t", vaultId: "v", updatedAt: 1, deleted: false, seq: 0, payload: ["type": "todo", "status": "open", "due": "2026-11-09", "start": "2026-11-07", "waiting": true])
        todo.repeat = weekly
        let next = todo.complete(today: Self.today, at: 5)
        #expect(next == "2026-11-16" && todo.due == "2026-11-16" && todo.start == "2026-11-14" && !todo.isDone && !todo.waiting)
        var once = Card(id: "o", vaultId: "v", updatedAt: 1, deleted: false, seq: 0, payload: ["type": "todo", "status": "open", "due": "2026-11-09"])
        #expect(once.isOverdue(today: Self.today))
        once.complete(today: Self.today, at: 5)
        #expect(once.isDone && !once.isOverdue(today: Self.today))
    }
}

@Suite struct StreamTests {
    static func card(_ id: String, _ fields: [String: JSONValue], vault: String = "v1", created: Int64 = 1) -> Card {
        var p: [String: JSONValue] = ["type": "note", "title": "", "tags": [], "content": Doc.fromText(id), "createdAt": .int(created)]
        p.merge(fields) { _, new in new }
        return Card(id: id, vaultId: vault, updatedAt: created, deleted: false, seq: 1, payload: p)
    }

    @Test func filtersAndOrders() {
        let day: Int64 = 86_400_000
        let base = Int64(DateKey.date("2026-11-10")!.timeIntervalSince1970 * 1000)
        let cards = [
            Self.card("a", [:], created: base),
            Self.card("b", ["type": "todo", "status": "open", "due": "2026-11-12"], created: base + day),
            Self.card("c", ["type": "todo", "status": "open", "due": "2026-11-20", "dueTime": "09:00"], created: base + 2 * day),
            Self.card("d", ["type": "todo", "status": "open", "due": "2026-11-12", "waiting": true], created: base + 3 * day),
            Self.card("e", ["archived": true], created: base),
            Self.card("f", ["template": true], created: base),
            Self.card("g", ["stack": ["a"]], created: base + 4 * day),
            Self.card("tag", ["type": "tag", "title": "Home"]),
        ]
        let index = CardIndex(cards)
        let ids = { (f: StreamFilter) in Stream.items(index, f, today: "2026-11-12").map(\.card.id) }
        #expect(ids(StreamFilter()) == ["a", "e", "b", "c", "d", "g"].filter { $0 != "e" })
        #expect(ids(StreamFilter(status: .today)) == ["b"])
        #expect(ids(StreamFilter(status: .waiting)) == ["d"])
        #expect(ids(StreamFilter(status: .upcoming)) == ["c"])
        #expect(ids(StreamFilter(type: .stack)) == ["g"])
        #expect(ids(StreamFilter(type: .note)) == ["a"])
        #expect(ids(StreamFilter(archived: true)) == ["e"])
        #expect(ids(StreamFilter(template: true)) == ["f"])
        #expect(ids(StreamFilter(sort: .newest)) == ["g", "d", "c", "b", "a"])
        #expect(ids(StreamFilter(sort: .due)) == ["b", "d", "c", "a", "g"])
        #expect(ids(StreamFilter(when: "2026-11-11..2026-11-12")) == ["b", "c"])
        #expect(Stream.foldStacks(Stream.items(index, StreamFilter(), today: "2026-11-12"), stackOf: index.stackOf).map(\.card.id) == ["b", "c", "d", "g"])
        #expect(index.stackEntries(index.byId["g"]!).map(\.id) == ["a"])
    }

    @Test func tagGroupsAndScope() {
        let high = Self.card("high", ["type": "tag", "title": "High"])
        let low = Self.card("low", ["type": "tag", "title": "Low"])
        let group = Self.card("prio", ["type": "tag", "title": "Priority", "members": ["high", "low"], "choice": "one", "ordered": true])
        let home = Self.card("home", ["type": "tag", "title": "Home", "scope": "vault"], vault: "family")
        let groups = TagGroups([group, high, low, home])
        #expect(groups.with(["high", "x"], "low") == ["x", "low"])
        #expect(groups.order(["x", "low", "high"]) == ["high", "low", "x"])
        #expect(groups.clashing(["high", "low"]) == ["high", "low"])
        #expect(groups.isGroupName(" priority "))
        #expect(groups.groups.first?.pick(["high"], nil) == [])
        let shared: SharedInto = ["home": ["personal"]]
        #expect(home.offered(in: "personal", shared) && home.offered(in: "family", [:]) && !home.offered(in: "work", shared))
        #expect(tagsFor([high, home], vaultId: "family", [:]).map(\.id) == ["home", "high"])
        #expect(tagNamed("HOME", in: [high, home], vaultId: "work", [:]) == nil)
        #expect(home.tagVaults(shared) == ["family", "personal"] && high.tagVaults(shared) == nil)
    }

    @Test func searchFindsWordsTheirStartsAndTypos() {
        let cards = [Self.card("one", ["title": "Packing list"]), Self.card("two", ["content": Doc.fromText("買菜 and errands")]), Self.card("three", ["content": Doc.fromText("Holiday photos")])]
        let search = CardSearch(CardIndex(cards))
        #expect(search.search("pack").first?.card.id == "one")
        #expect(search.search("菜").first?.card.id == "two")
        #expect(search.search("holliday").first?.card.id == "three")
        #expect(search.search("packing holiday").isEmpty)
        #expect(CardSearch.tokenize("買菜 and C#") == ["買", "菜", "and", "C"])
    }

    @Test func retypeAndTemplates() {
        var note = Self.card("n", ["content": Doc.fromText("buy milk")])
        note.retype(.todo)
        #expect(note.type == .todo && note.title == "buy milk" && note.content == Doc.empty && note.payload["status"] == "open")
        note.retype(.note)
        #expect(note.type == .note && note.title == "" && note.content == Doc.fromText("buy milk") && note.payload["status"] == nil)
        let template = Self.card("tp", ["title": "Review {date}", "content": EntryTests.doc(EntryTests.tasks(EntryTests.item(true, EntryTests.para(EntryTests.t("Inbox"))))), "template": true, "color": "blue"])
        let made = template.fromTemplate(today: "2026-11-12")
        #expect(made["title"]?.stringValue == "Review \(DateKey.formatDay("2026-11-12"))")
        #expect(made["content"]?["content"]?.arrayValue?.first?["content"]?.arrayValue?.first?["attrs"]?["checked"] == false)
        #expect(made["color"] == "blue" && made["template"] == nil)
    }
}
