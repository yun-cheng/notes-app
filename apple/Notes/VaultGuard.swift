import Foundation
import NotesKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Keeping private vaults shut, as the web's `VaultLocks`: every open vault locks after five minutes with no click,
/// tap or key, and when the app goes to the background (`NotesApp`); after five wrong PINs, the next try waits 30
/// seconds. Before 2026-11-25 the apps locked only when asked to.
enum VaultGuard {
    /// Five minutes; `-vaultIdleSeconds 10` at launch shortens it, to try it.
    static var idle: Duration {
        let set = UserDefaults.standard.double(forKey: "vaultIdleSeconds")
        return .seconds(set > 0 ? set : 5 * 60)
    }
    static let freeTries = 5
    static let wait: TimeInterval = 30
}

/// What trying a PIN came to, with the web's words for it.
enum PinResult: Equatable {
    case ok, wrong, throttled

    var problem: String? {
        switch self {
        case .ok: nil
        case .wrong: "That PIN isn't right."
        case .throttled: "Too many tries. Wait 30 seconds and try again."
        }
    }
}

extension AppModel {
    /// Starts the five idle minutes again, as anything done in the app does.
    func touchVaults() {
        idleLock?.cancel()
        guard !openVaults.isEmpty else { return idleLock = nil }
        idleLock = Task { [weak self] in
            try? await Task.sleep(for: VaultGuard.idle)
            guard !Task.isCancelled else { return }
            self?.lockAll()
        }
    }

    private var pinThrottled: Bool { Date() < pinBlockedUntil }

    /// A wrong PIN: the fifth in a row makes the next try wait.
    private func pinFailed() -> PinResult {
        pinFailures += 1
        if pinFailures >= VaultGuard.freeTries {
            pinBlockedUntil = Date().addingTimeInterval(VaultGuard.wait)
            pinFailures = 0
        }
        return .wrong
    }

    /// Opens a private vault with its PIN, unless too many wrong ones were just tried.
    func unlock(_ vault: Vault, pin: String) async -> PinResult {
        guard !pinThrottled else { return .throttled }
        return await unlock(vault, pin: pin, recoveryKey: false) ? .ok : pinFailed()
    }

    /// Opens every hidden vault this PIN opens, as one try, as the web's.
    func unlockHidden(pin: String) async -> PinResult {
        guard !pinThrottled else { return .throttled }
        var opened = 0
        for vault in vaults where vault.hidden && !openVaults.contains(vault.id) {
            if await unlock(vault, pin: pin, recoveryKey: false) { opened += 1 }
        }
        return opened > 0 ? .ok : pinFailed()
    }
}

#if os(macOS)
/// Every click and key in the app counts as being there. And as the web's lock when its page is hidden: a Mac's
/// scene doesn't go to the background when its window is minimized or the app hidden, so those lock here, as does the
/// screen sleeping or locking.
@MainActor
enum VaultActivity {
    private static var monitor: Any?
    private static var hidden: [NSObjectProtocol] = []

    static func watch(_ model: AppModel) {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]) { [weak model] event in
            model?.touchVaults()
            return event
        }
        let lock: @Sendable (Notification) -> Void = { [weak model] _ in Task { @MainActor in model?.lockAll() } }
        let center = NotificationCenter.default
        let workspace = NSWorkspace.shared.notificationCenter
        hidden = [
            center.addObserver(forName: NSWindow.didMiniaturizeNotification, object: nil, queue: .main, using: lock),
            center.addObserver(forName: NSApplication.didHideNotification, object: nil, queue: .main, using: lock),
            workspace.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main, using: lock),
            workspace.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main, using: lock),
            DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main, using: lock),
        ]
    }
}
#else
/// Every touch in the app counts as being there: a recognizer on the window that sees each touch begin and never takes it.
final class TouchWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let touched: () -> Void

    init(_ touched: @escaping () -> Void) {
        self.touched = touched
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        touched()
        state = .failed
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

@MainActor
enum VaultActivity {
    private static var watched = false

    static func watch(_ model: AppModel) {
        guard !watched, let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return }
        watched = true
        window.addGestureRecognizer(TouchWatcher { [weak model] in Task { @MainActor in model?.touchVaults() } })
    }
}
#endif
