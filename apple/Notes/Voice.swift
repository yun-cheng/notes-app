import AVFoundation
import NotesKit
import SwiftUI

/// A voice message (any sound) where it is, as the web app's player: play and pause, its loudness drawn along it, the
/// time, a speed, and its transcript, each sentence pressed to play from there.
struct VoicePlayer: View {
    @Environment(AppModel.self) private var model
    let file: Doc.FileInfo
    let vaultId: String
    @State private var player: AVPlayer?
    @State private var playing = false
    @State private var progress: Double = 0
    @State private var rate: Float = 1
    @State private var showWords = true
    @State private var observer: Any?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button(action: toggle) {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.accent))
                        .foregroundStyle(Theme.onAccent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause" : "Play")
                Waveform(peaks: file.peaks, progress: progress)
                    .frame(height: 26)
                    .frame(minWidth: 120)
                Text(Doc.clipLength((file.duration ?? 0) * (playing || progress > 0 ? progress : 1))).font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                Button("\(rate == 1 ? "1" : String(format: "%g", rate))×") {
                    rate = rate == 1 ? 1.5 : rate == 1.5 ? 2 : 1
                    if playing { player?.rate = rate }
                }
                .buttonStyle(.plain).font(.caption).padding(.horizontal, 6).background(Capsule().stroke(Theme.line))
                if file.transcript != nil {
                    Button { showWords.toggle() } label: { Image(systemName: "text.alignleft") }.buttonStyle(.plain).foregroundStyle(Theme.accent)
                        .accessibilityLabel(showWords ? "Hide words" : "Show words")
                }
            }
            if showWords, let transcript = file.transcript, !transcript.isEmpty {
                Divider()
                if file.cues.isEmpty {
                    Text(transcript).textSelection(.enabled)
                } else {
                    FlowText(cues: file.cues, current: currentCue) { seek(to: $0) }
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.sunken.opacity(0.5)))
        .padding(.top, 4)
        .onDisappear { player?.pause() }
    }

    private var currentCue: Int? {
        guard playing || progress > 0, let d = file.duration else { return nil }
        let t = progress * d
        return file.cues.lastIndex { $0.start <= t }
    }

    private func toggle() {
        if let player {
            if playing { player.pause() } else { player.playImmediately(atRate: rate) }
            playing.toggle()
            return
        }
        Task {
            guard let url = await Attachments.shared.fileURL(file.id, name: file.name.isEmpty ? "voice.m4a" : file.name, model: model) else {
                model.say("That voice message can't be fetched now.")
                return
            }
            let p = AVPlayer(url: url)
            observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { time in
                MainActor.assumeIsolated {
                    let total = p.currentItem?.duration.seconds ?? file.duration ?? 0
                    if total > 0 { progress = min(1, time.seconds / total) }
                    if progress >= 1 { playing = false; progress = 0; p.seek(to: .zero) }
                }
            }
            player = p
            p.playImmediately(atRate: rate)
            playing = true
        }
    }

    private func seek(to seconds: Double) {
        if player == nil { toggle() }
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }
}

/// A sound's loudness as bars, the part played in the accent color.
struct Waveform: View {
    let peaks: [Double]
    let progress: Double

    var body: some View {
        GeometryReader { geo in
            let bars = peaks.isEmpty ? Array(repeating: 30.0, count: 40) : peaks
            let w = geo.size.width / CGFloat(bars.count)
            HStack(alignment: .center, spacing: 0) {
                ForEach(bars.indices, id: \.self) { i in
                    Capsule()
                        .fill(Double(i) / Double(bars.count) < progress ? Theme.accent : Theme.muted.opacity(0.5))
                        .frame(width: max(1, w - 1.5), height: max(2, geo.size.height * bars[i] / 100))
                        .frame(width: w)
                }
            }
            .frame(maxHeight: .infinity)
        }
    }
}

/// A transcript's sentences, each pressed to play from there, the one being said marked.
struct FlowText: View {
    let cues: [Doc.Cue]
    let current: Int?
    let play: (Double) -> Void

    var body: some View {
        FlowLayout(spacing: 0) {
            ForEach(cues.indices, id: \.self) { i in
                Text(cues[i].text + " ")
                    .background(i == current ? Theme.accentSoft : .clear)
                    .onTapGesture { play(cues[i].start) }
            }
        }
    }
}

/// The box's mic: press to record a voice message, press again to stop. It's added to the box like a file, drawn by
/// its loudness, and transcribed by the server once it's up (not in an encrypted vault, whose words never reach it).
struct VoiceRecordButton: View {
    @Environment(AppModel.self) private var model
    let vaultId: String
    let add: (JSONValue) -> Void
    @State private var recorder: AVAudioRecorder?
    @State private var started: Date?

    var body: some View {
        Button(action: toggle) {
            if let started {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    Label(Doc.clipLength(context.date.timeIntervalSince(started)), systemImage: "stop.circle.fill")
                        .labelStyle(.titleAndIcon).foregroundStyle(Theme.alert).font(.callout.monospacedDigit())
                }
            } else {
                Image(systemName: "mic").foregroundStyle(Theme.muted)
            }
        }
        .buttonStyle(.plain)
        .padding(.bottom, 8)
        .accessibilityLabel(started == nil ? "Record a voice message" : "Stop recording")
    }

    private func toggle() {
        if let recorder {
            recorder.stop()
            self.recorder = nil
            started = nil
            finish(recorder.url)
            return
        }
        Task {
            guard await AVAudioApplication.requestRecordPermission() else {
                model.say("The app isn't allowed to use the microphone. Turn it on in Settings.")
                return
            }
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try? AVAudioSession.sharedInstance().setActive(true)
            #endif
            let url = URL.temporaryDirectory.appending(path: "voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue]
            guard let r = try? AVAudioRecorder(url: url, settings: settings), r.record() else {
                model.say("Recording didn't start.")
                return
            }
            recorder = r
            started = Date()
        }
    }

    private func finish(_ url: URL) {
        Task { await keep(url) }
    }

    private func keep(_ url: URL) async {
        guard let data = try? Data(contentsOf: url) else { return }
        let samples = Transcriber.samples(url) ?? []
        let duration = Double(samples.count) / Double(Voice.rate)
        do {
            let node = try await Attachments.shared.addFile(
                data, name: Voice.name(at: Date(), ext: "m4a"), mime: "audio/mp4", vaultId: vaultId, model: model, duration: duration > 0 ? duration : nil,
                extra: ["peaks": .array(Voice.peaks(samples).map(JSONValue.double))])
            add(node)
            if let id = node["attrs"]?["id"]?.stringValue, model.vault(vaultId)?.isEncrypted != true {
                Transcriber.shared.start(id: id, samples: samples, vaultId: vaultId, model: model)
            }
        } catch {
            model.say(error.localizedDescription)
        }
    }
}

/// Transcriptions under way, as the web app's `voice.tsx`: a transcription belongs to the app, not to the view that
/// started it, so one that comes back after its box was saved is written into the entry that has it.
@MainActor
final class Transcriber {
    static let shared = Transcriber()
    /// Finished, and not yet written into an entry, by file ID.
    private(set) var done: [String: Voice.Transcript] = [:]

    /// A sound file as 16 kHz mono samples, as the model hears it.
    nonisolated static func samples(_ url: URL) -> [Float]? {
        guard let file = try? AVAudioFile(forReading: url),
            let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(Voice.rate), channels: 1, interleaved: false),
            let converter = AVAudioConverter(from: file.processingFormat, to: target),
            let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
            (try? file.read(into: input)) != nil
        else { return nil }
        let capacity = AVAudioFrameCount(Double(file.length) * Double(Voice.rate) / file.processingFormat.sampleRate) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        nonisolated(unsafe) var fed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return input
        }
        guard error == nil, let channel = output.floatChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: channel[0], count: Int(output.frameLength)))
    }

    func start(id: String, samples: [Float], vaultId: String, model: AppModel) {
        let api = model.api
        Task {
            let cuts = [0] + Voice.cutPoints(samples) + [samples.count]
            var pieces: [(offset: Double, text: String, language: String?, cues: [Doc.Cue])] = []
            for i in 0..<(cuts.count - 1) where cuts[i] < cuts[i + 1] {
                do {
                    let r = try await api.transcribe(vaultId: vaultId, wav: Voice.wav(samples[cuts[i]..<cuts[i + 1]]))
                    pieces.append((Double(cuts[i]) / Double(Voice.rate), r.text, r.language, r.cues))
                } catch let error as ServerAPI.TranscribeError {
                    switch error {
                    case .limit: model.say("That's an hour of voice today. It wasn't transcribed.")
                    case .offline: model.say("The voice message will be transcribed when you're online.")
                    default: break
                    }
                    return
                } catch {
                    return
                }
            }
            done[id] = Voice.join(pieces)
            apply(model: model)
        }
    }

    /// Writes finished transcripts into the entries that hold their voice messages.
    func apply(model: AppModel) {
        for (id, words) in done {
            guard let card = model.index.live.first(where: { Doc.fileIds($0.content).contains(id) }), model.canEdit(card) else { continue }
            done[id] = nil
            let cardId = card.id
            model.perform { try await $0.update(cardId) { c in if let next = Voice.withTranscript(c.content, fileId: id, words) { c.content = next } } }
        }
    }

    /// A box's nodes with any finished transcripts put on them, before they're saved.
    func fill(_ nodes: [JSONValue]) -> [JSONValue] {
        nodes.map { node in
            guard let id = node["attrs"]?["id"]?.stringValue, let words = done[id] else { return node }
            done[id] = nil
            return Voice.withTranscript(["type": "doc", "content": [node]], fileId: id, words)?["content"]?.arrayValue?.first ?? node
        }
    }
}
