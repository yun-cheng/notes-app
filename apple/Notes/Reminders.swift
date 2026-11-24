import NotesKit
import SwiftUI
import UserNotifications

/// Due-date reminders on this device, as the web app's: an open todo with a due date (not waiting, archived or a
/// template) reminds at its time less the lead, or for a date alone at the time picked. The web sends them by push from
/// the server; here the device schedules them itself, which works offline and for encrypted vaults alike.
@MainActor
enum Reminders {
    static let onKey = "remindersOn"
    static let atKey = "remindAt"
    static let leadKey = "remindLead"
    /// The system keeps at most 64 waiting; the soonest go first.
    static let most = 60

    static var on: Bool { UserDefaults.standard.bool(forKey: onKey) }

    /// A notification in a few seconds, to see that reminders reach this device, as the web's Send a test.
    static func test() {
        let content = UNMutableNotificationContent()
        content.title = "Test reminder"
        content.body = "Reminders reach this device."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "test-\(UUID().uuidString)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false))
        UNUserNotificationCenter.current().add(request)
    }

    static func turnOn() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        UserDefaults.standard.set(granted, forKey: onKey)
        return granted
    }

    /// When a todo reminds, or nil.
    static func fireAt(_ card: Card) -> Date? {
        guard card.type == .todo, !card.isDone, !card.waiting, !card.archived, !card.template, let due = card.due, let day = DateKey.date(due) else { return nil }
        let at = UserDefaults.standard.string(forKey: atKey) ?? "09:00"
        let time = card.dueTime ?? at
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, var date = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day) else { return nil }
        if card.dueTime != nil { date.addTimeInterval(-Double(UserDefaults.standard.integer(forKey: leadKey)) * 60) }
        return date
    }

    /// What's scheduled now; nil until this launch first schedules, so what an earlier launch left is cleared too.
    private static var scheduled: String?

    /// Schedules the soonest reminders again from the todos as they are now, when they changed.
    static func reschedule(_ index: CardIndex) {
        let now = Date()
        let soon = on ? Array(index.todos.compactMap { card in fireAt(card).map { (card, $0) } }.filter { $0.1 > now }.sorted { $0.1 < $1.1 }.prefix(most)) : []
        let signature = soon.map { "\($0.0.id)|\($0.0.title)|\($0.1.timeIntervalSince1970)" }.joined(separator: ",")
        guard signature != scheduled else { return }
        scheduled = signature
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        for (card, at) in soon {
            let content = UNMutableNotificationContent()
            content.title = card.title.trimmingCharacters(in: .whitespaces).isEmpty ? "Todo" : card.title
            content.body = card.dueTime.map { "Due at \(TimeKey.format($0))" } ?? "Due today"
            content.sound = .default
            content.userInfo = ["cardId": card.id]
            content.threadIdentifier = "due"
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            center.add(UNNotificationRequest(identifier: "due:\(card.id)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
        }
    }
}

/// Opens the entry a reminder is about when it's pressed.
final class ReminderDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = ReminderDelegate()
    var open: (@MainActor (String) -> Void)?

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["cardId"] as? String else { return }
        await MainActor.run { open?(id) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

struct RemindersSettings: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Reminders.onKey) private var on = false
    @AppStorage(Reminders.atKey) private var at = "09:00"
    @AppStorage(Reminders.leadKey) private var lead = 0

    var body: some View {
        Section {
            Text("A notification when an open todo comes due, even with the app closed: at its time, or for a todo with only a date, at the time set below. Waiting todos don't remind. This is set for each device.")
                .foregroundStyle(Theme.muted)
            HStack {
                Text("This device")
                Spacer()
                if on {
                    Button("Send a test") { Reminders.test(); model.say("Sent a test reminder") }.buttonStyle(.borderless)
                    Button("Turn off") {
                        on = false
                        Reminders.reschedule(model.index)
                        model.say("Reminders are off on this device")
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("Turn on reminders") {
                        Task {
                            if await Reminders.turnOn() {
                                Reminders.reschedule(model.index)
                                model.say("Reminders are on on this device")
                            } else {
                                model.say("Notifications are off for this app. Turn them on in Settings.")
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            Picker("Todos with a time", selection: Binding(get: { lead }, set: { lead = $0; Reminders.reschedule(model.index) })) {
                Text("At the due time").tag(0)
                Text("5 minutes before").tag(5)
                Text("10 minutes before").tag(10)
                Text("15 minutes before").tag(15)
                Text("30 minutes before").tag(30)
                Text("1 hour before").tag(60)
                Text("2 hours before").tag(120)
            }
            DatePicker("Todos with only a date", selection: Binding(get: { DuePicker.date(at) }, set: { at = TimeKey.of($0); Reminders.reschedule(model.index) }), displayedComponents: .hourAndMinute)
        } header: {
            Text("Reminders")
        }
    }
}
