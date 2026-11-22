import NotesKit
import SwiftUI

#if os(macOS)
import AppKit
typealias PlatformColor = NSColor
#else
import UIKit
typealias PlatformColor = UIColor
#endif

/// The web app's colors (`styles.css` `:root`), in light and dark.
enum Theme {
    static func color(_ light: UInt32, _ dark: UInt32) -> Color {
        func make(_ hex: UInt32) -> PlatformColor {
            PlatformColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        }
        #if os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? make(dark) : make(light)
        })
        #else
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? make(dark) : make(light) })
        #endif
    }

    static let bg = color(0xF5F2EA, 0x151817)
    static let surface = color(0xFFFEFB, 0x232927)
    static let sunken = color(0xE8E3D8, 0x313835)
    static let raised = color(0xFFFFFF, 0x48514D)
    static let line = color(0xD6CFC1, 0x454E4A)
    static let text = color(0x22262A, 0xECE9E2)
    static let muted = color(0x5F6563, 0xA7AEAA)
    static let accent = color(0x1F5C57, 0x84C9BC)
    static let accentSoft = color(0xC6E1D7, 0x2E5B53)
    static let onAccent = color(0xFBFAF6, 0x12211E)
    static let alert = color(0xB23A2E, 0xF0907F)
    static let added = color(0xD6ECD2, 0x24452C)
    static let removed = color(0xF5D9D3, 0x4D2A25)

    /// An entry's tint (`.tint--red` and the rest).
    static func tint(_ color: CardColor) -> Color {
        switch color {
        case .red: Color(red: 0xD4 / 255, green: 0x57 / 255, blue: 0x4A / 255)
        case .orange: Color(red: 0xDE / 255, green: 0x8A / 255, blue: 0x3A / 255)
        case .yellow: Color(red: 0xD6 / 255, green: 0xB2 / 255, blue: 0x36 / 255)
        case .green: Color(red: 0x5A / 255, green: 0x9E / 255, blue: 0x5F / 255)
        case .blue: Color(red: 0x4F / 255, green: 0x86 / 255, blue: 0xC6 / 255)
        case .purple: Color(red: 0x8A / 255, green: 0x6C / 255, blue: 0xC2 / 255)
        case .pink: Color(red: 0xCF / 255, green: 0x6A / 255, blue: 0x9B / 255)
        case .gray: Color(red: 0x8A / 255, green: 0x8F / 255, blue: 0x8C / 255)
        }
    }

    static func colorName(_ color: CardColor) -> String { color.rawValue.capitalized }

    /// The page titles' serif.
    static let mono = Font.system(.body, design: .monospaced)
}

/// A small rounded chip, as the web's `.chip--small`.
struct Chip: View {
    let text: String
    var tint: Color? = nil
    var systemImage: String? = nil

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            Text(text)
        }
        .font(.caption)
        .padding(.horizontal, 7)
        .padding(.vertical, 1)
        .background(Capsule().fill(tint.map { $0.opacity(0.22) } ?? Theme.sunken))
        .foregroundStyle(Theme.text)
    }
}

extension View {
    /// The web's page background behind a scrolling page.
    func pageBackground() -> some View { background(Theme.bg.ignoresSafeArea()) }
}

/// A PIN typed in, hidden, that the system doesn't take for an account's password: no strong-password offer, no
/// saving it to Passwords. Numbers on a phone's keyboard first.
struct PinField: View {
    let title: String
    @Binding var text: String
    var onSubmit: () -> Void = {}

    init(_ title: String, text: Binding<String>, onSubmit: @escaping () -> Void = {}) {
        self.title = title
        _text = text
        self.onSubmit = onSubmit
    }

    var body: some View {
        SecureField(title, text: $text)
            .textContentType(.oneTimeCode)
            #if os(iOS)
            .keyboardType(.numbersAndPunctuation)
            .textInputAutocapitalization(.never)
            #endif
            .autocorrectionDisabled()
            .onSubmit(onSubmit)
    }
}
