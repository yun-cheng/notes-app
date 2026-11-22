import NotesKit
import SwiftUI
import Translation

/// Translating an entry's words, shown in its bubble, as the web app's `translate.ts`: by the server, which reads a
/// whole note better, except in an encrypted vault, whose words never go there; on the device where the server can't
/// (offline, or the day's translations used up). Into this device's language, or into English when it's in that.
@MainActor
@Observable
final class Translations {
    static let shared = Translations()

    struct Kept: Codable, Hashable {
        var source: String
        var pieces: [String]
        var from: String
        var to: String
        var shown = true
    }

    enum State: Hashable { case working, done(Kept), onDevice([String]) }

    var states: [String: State] = [:]

    /// The language to translate into: this device's, as the translators name it.
    static var deviceLanguage: String {
        let id = Locale.current.identifier.lowercased()
        if id.hasPrefix("zh") && (id.contains("hant") || id.contains("tw") || id.contains("hk") || id.contains("mo")) { return "zh-Hant" }
        return Locale.current.language.languageCode?.identifier ?? "en"
    }

    /// The pieces of an entry a translation covers: its title, then its lines.
    static func pieces(_ card: Card, index: CardIndex) -> [String] {
        [card.title] + Doc.previewLines(card.content, titleOf: index.titleOf)
    }

    func translate(_ card: Card, model: AppModel) {
        let pieces = Self.pieces(card, index: model.index)
        states[card.id] = .working
        let encrypted = model.vault(card.vaultId)?.isEncrypted == true
        let mine = Self.deviceLanguage
        Task {
            if !encrypted {
                switch await model.api.translate(cardId: card.id, pieces: pieces, to: mine, otherwise: mine == "en" ? nil : "en") {
                case .done(let from, let to, let out):
                    states[card.id] = .done(Kept(source: pieces.joined(separator: "\n"), pieces: out, from: from, to: to))
                    return
                case .same:
                    states[card.id] = nil
                    model.say("It's in your language already.")
                    return
                case .limit, .failed:
                    break
                }
            }
            // On this device, where the words stay.
            states[card.id] = .onDevice(pieces)
        }
    }

    func show(_ id: String, _ shown: Bool) {
        guard case .done(var k) = states[id] else { return }
        k.shown = shown
        states[id] = .done(k)
    }
}

/// An entry's translation under it, with Show original and Save as a page; one being made on the device runs here,
/// where the system's translator can be asked.
struct BubbleTranslation: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @State private var config: TranslationSession.Configuration?

    var body: some View {
        switch Translations.shared.states[card.id] {
        case .working?:
            HStack { ProgressView().controlSize(.small); Text("Translating…").font(.caption).foregroundStyle(Theme.muted) }
        case .done(let kept)? where kept.shown:
            VStack(alignment: .leading, spacing: 4) {
                Divider()
                Text(kept.pieces.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: "\n")).textSelection(.enabled)
                HStack(spacing: 12) {
                    Text("Translated from \(Locale.current.localizedString(forLanguageCode: kept.from) ?? kept.from)").foregroundStyle(Theme.muted)
                    Button("Show original") { Translations.shared.show(card.id, false) }
                    if model.canEdit(card) { Button("Save as a page") { saveAsPage(kept.pieces) } }
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(Theme.accent)
            }
        case .onDevice(let pieces)?:
            HStack { ProgressView().controlSize(.small); Text("Translating on this device…").font(.caption).foregroundStyle(Theme.muted) }
                .onAppear { config = TranslationSession.Configuration(source: nil, target: Locale.Language(identifier: Translations.deviceLanguage)) }
                .translationTask(config) { session in
                    do {
                        // The session is used only here, for this one translation.
                        nonisolated(unsafe) let only = session
                        let (out, from) = try await Self.run(only, pieces)
                        Translations.shared.states[card.id] = .done(.init(source: pieces.joined(separator: "\n"), pieces: out, from: from, to: Translations.deviceLanguage))
                    } catch {
                        Translations.shared.states[card.id] = nil
                        model.say("This device can't translate it.")
                    }
                }
        default:
            EmptyView()
        }
    }

    /// Each piece through the system's translator, in order, and the language they were in.
    nonisolated static func run(_ session: TranslationSession, _ pieces: [String]) async throws -> ([String], String) {
        let requests = pieces.enumerated().map { TranslationSession.Request(sourceText: $0.element.isEmpty ? " " : $0.element, clientIdentifier: String($0.offset)) }
        let responses = try await session.translations(from: requests)
        let out = responses.sorted { (Int($0.clientIdentifier ?? "0") ?? 0) < (Int($1.clientIdentifier ?? "0") ?? 0) }.map(\.targetText)
        return (out, responses.first?.sourceLanguage.languageCode?.identifier ?? "")
    }

    /// The translation as a page of its own, unless a page has its words already.
    private func saveAsPage(_ pieces: [String]) {
        let doc = Doc.fromText(pieces.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: "\n"))
        let id = card.id
        model.perform { try await $0.update(id) { c in c.morePages = c.morePages.filter { !Doc.isBlank($0) } + [doc] } }
        model.say("Saved as page \(card.turnPages.count + 2)", undoable: true)
    }
}
