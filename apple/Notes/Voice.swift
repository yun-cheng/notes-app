import AVFoundation
import MediaToolbox
import NotesKit
import SwiftUI

/// The voice message playing, for every player and the bar along the top of the journal, as the web's: one plays at a
/// time, one that ends runs on to the next while they come one after another (in the same entry, or the next one), each
/// is evened out as it plays (`Voice.Leveler`), and all play at one volume kept on this device, read as heard (half
/// way is a quarter as loud), or muted.
@MainActor
@Observable
final class VoicePlayback {
    static let shared = VoicePlayback()

    struct Item: Equatable {
        var file: Doc.FileInfo
        var cardId: String?
        var vaultId: String
    }

    private(set) var item: Item?
    private(set) var playing = false
    private(set) var time: Double = 0
    private(set) var total: Double = 0
    private(set) var rate: Float = 1
    private(set) var volume: Double = UserDefaults.standard.object(forKey: "voiceVolume") as? Double ?? 1
    private(set) var muted = UserDefaults.standard.bool(forKey: "voiceMuted")
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var ended: NSObjectProtocol?
    @ObservationIgnored private var levels: [String: Double] = [:]
    @ObservationIgnored private var activeLeveler: Voice.Leveler?
    @ObservationIgnored private weak var model: AppModel?

    private var heard: Float { muted ? 0 : Float(volume * volume) }

    func isCurrent(_ id: String) -> Bool { item?.file.id == id }

    /// Plays `file` from `at` seconds (or where it was), stopping any other.
    func play(_ file: Doc.FileInfo, cardId: String?, vaultId: String, model: AppModel, at: Double? = nil) {
        self.model = model
        if item?.file.id == file.id, let player {
            if let at { player.seek(to: CMTime(seconds: at, preferredTimescale: 600)); time = at }
            player.playImmediately(atRate: rate)
            player.volume = heard
            playing = true
            return
        }
        stopPlayer()
        item = Item(file: file, cardId: cardId, vaultId: vaultId)
        time = at ?? 0
        total = file.duration ?? 0
        playing = true
        Task {
            guard let url = await Attachments.shared.fileURL(file.id, name: file.name.isEmpty ? "voice.m4a" : file.name, model: model) else {
                if item?.file.id == file.id { playing = false; item = nil }
                model.say("That voice message can't be fetched now.")
                return
            }
            guard item?.file.id == file.id else { return }
            let asset = AVURLAsset(url: url)
            let playerItem = AVPlayerItem(asset: asset)
            let leveler = Voice.Leveler(initialLevel: levels[file.id])
            if let mix = await makeLevelingMix(for: asset, leveler: leveler) {
                playerItem.audioMix = mix
            }
            guard item?.file.id == file.id else { return }
            activeLeveler = leveler
            let p = AVPlayer(playerItem: playerItem)
            p.volume = heard
            observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] t in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.time = t.seconds
                    if let d = p.currentItem?.duration.seconds, d.isFinite, d > 0 { self.total = d }
                }
            }
            ended = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: p.currentItem, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.finished() }
            }
            player = p
            if let at { await p.seek(to: CMTime(seconds: at, preferredTimescale: 600)) }
            if playing { p.playImmediately(atRate: rate) }
        }
    }

    func toggle() {
        guard let player else { playing.toggle(); return }
        if playing { player.pause() } else { player.playImmediately(atRate: rate) }
        playing.toggle()
    }

    func pause() {
        player?.pause()
        playing = false
    }

    func seek(_ seconds: Double) {
        time = seconds
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }

    /// 1×, 1.5×, 2× and round.
    func faster() {
        rate = rate == 1 ? 1.5 : rate == 1.5 ? 2 : 1
        if playing { player?.rate = rate }
    }

    /// Stops it and closes the bar.
    func stop() {
        stopPlayer()
        item = nil
        playing = false
        time = 0
    }

    func setVolume(_ v: Double) {
        volume = max(0, min(1, v))
        muted = false
        save()
    }

    /// Mutes them, or brings them back: at half volume, from none.
    func toggleMute() {
        if muted || volume == 0 {
            if volume == 0 { volume = 0.5 }
            muted = false
        } else {
            muted = true
        }
        save()
    }

    private func save() {
        UserDefaults.standard.set(volume, forKey: "voiceVolume")
        UserDefaults.standard.set(muted, forKey: "voiceMuted")
        player?.volume = heard
    }

    private func stopPlayer() {
        if let id = item?.file.id, let level = activeLeveler?.level {
            levels[id] = level
        }
        activeLeveler = nil
        player?.pause()
        if let observer, let player { player.removeTimeObserver(observer) }
        if let ended { NotificationCenter.default.removeObserver(ended) }
        observer = nil
        ended = nil
        player = nil
    }

    private func finished() {
        playing = false
        time = 0
        player?.seek(to: .zero)
        if !playAfter() { stop() }
    }

    /// The voice messages on show, in the journal's order (oldest first), each with its entry.
    private func all() -> [Item] {
        guard let model else { return [] }
        return model.index.live.filter { $0.type != .tag && !$0.archived }.sorted { $0.createdAt < $1.createdAt }.flatMap { card in
            Doc.files(card.content).filter(\.isAudio).map { Item(file: $0, cardId: card.id, vaultId: card.vaultId) }
        }
    }

    /// The previous or next voice message, if any.
    func beside(after: Bool) -> Item? {
        guard let item else { return nil }
        let list = all()
        guard let i = list.firstIndex(where: { $0.file.id == item.file.id }) else { return nil }
        let j = i + (after ? 1 : -1)
        return list.indices.contains(j) ? list[j] : nil
    }

    func skip(after: Bool) {
        guard let next = beside(after: after), let model else { return }
        play(next.file, cardId: next.cardId, vaultId: next.vaultId, model: model, at: 0)
    }

    /// Plays the one straight after, in the same entry or the next one; whether it did.
    private func playAfter() -> Bool {
        guard let item, let next = beside(after: true), let model else { return false }
        if next.cardId != item.cardId {
            let order = model.index.live.filter { $0.type != .tag && !$0.archived }.sorted { $0.createdAt < $1.createdAt }.map(\.id)
            guard let a = order.firstIndex(where: { $0 == item.cardId }), let b = order.firstIndex(where: { $0 == next.cardId }), b == a + 1 else { return false }
        }
        play(next.file, cardId: next.cardId, vaultId: next.vaultId, model: model, at: 0)
        return true
    }
}

/// Real-time audio tap attached to an `AVPlayerItem` to apply `Voice.Leveler` on every rendered buffer.
private final class LevelTapContext: @unchecked Sendable {
    let leveler: Voice.Leveler
    var sampleRate: Double = 44_100
    var isFloat = true
    var isInterleaved = false
    var channelCount = 1

    init(leveler: Voice.Leveler) {
        self.leveler = leveler
    }
}

private func makeLevelingMix(for asset: AVAsset, leveler: Voice.Leveler) async -> AVAudioMix? {
    guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { return nil }
    let context = LevelTapContext(leveler: leveler)
    let created: MTAudioProcessingTap? = withExtendedLifetime(context) {
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: Unmanaged.passUnretained(context).toOpaque(),
            init: { _, clientInfo, tapStorageOut in
                guard let clientInfo else { return }
                tapStorageOut.pointee = Unmanaged<LevelTapContext>.fromOpaque(clientInfo).retain().toOpaque()
            },
            finalize: { tap in
                Unmanaged<LevelTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
            },
            prepare: { tap, _, processingFormat in
                let ctx = Unmanaged<LevelTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                let fmt = processingFormat.pointee
                ctx.sampleRate = fmt.mSampleRate
                ctx.isFloat = fmt.mFormatID == kAudioFormatLinearPCM && (fmt.mFormatFlags & kAudioFormatFlagIsFloat) != 0
                ctx.isInterleaved = (fmt.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
                ctx.channelCount = max(1, Int(fmt.mChannelsPerFrame))
            },
            unprepare: nil,
            process: { tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
                let status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut)
                guard status == noErr, numberFramesOut.pointee > 0 else { return }
                let ctx = Unmanaged<LevelTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                guard ctx.isFloat else { return }
                let buffers = UnsafeMutableAudioBufferListPointer(bufferListInOut)
                var channels: [UnsafeMutableBufferPointer<Float>] = []
                channels.reserveCapacity(buffers.count)
                for b in buffers {
                    guard let raw = b.mData else { continue }
                    let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
                    channels.append(UnsafeMutableBufferPointer(start: raw.assumingMemoryBound(to: Float.self), count: count))
                }
                ctx.leveler.process(
                    channels: channels,
                    frames: Int(numberFramesOut.pointee),
                    sampleRate: ctx.sampleRate,
                    interleavedChannels: ctx.isInterleaved ? ctx.channelCount : 1
                )
            }
        )
        var tap: MTAudioProcessingTap?
        guard MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap) == noErr else {
            return nil
        }
        return tap
    }
    guard let tap = created else { return nil }
    let params = AVMutableAudioMixInputParameters(track: track)
    params.audioTapProcessor = tap
    let mix = AVMutableAudioMix()
    mix.inputParameters = [params]
    return mix
}

/// A voice message (any sound) where it is, as the web app's player: play and pause, its loudness drawn along it to
/// seek in, the time, a speed, the volume all voice messages play at, and its transcript, each sentence pressed to
/// play from there and the one being said marked.
struct VoicePlayer: View {
    @Environment(AppModel.self) private var model
    let file: Doc.FileInfo
    let vaultId: String
    /// The entry it's in, for Transcribe to write into; nil where it can't be changed.
    var card: Card? = nil
    @AppStorage("hiddenTranscripts") private var hidden = ""

    var body: some View {
        let playback = VoicePlayback.shared
        let current = playback.isCurrent(file.id)
        let playing = current && playback.playing
        let total = current && playback.total > 0 ? playback.total : file.duration ?? 0
        let time = current ? playback.time : 0
        let showWords = !hidden.split(separator: ",").contains(Substring(file.id))
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button { press(current: current) } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.accent))
                        .foregroundStyle(Theme.onAccent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause" : "Play")
                Waveform(peaks: file.peaks, progress: total > 0 ? time / total : 0) { fraction in
                    playback.play(file, cardId: card?.id, vaultId: vaultId, model: model, at: fraction * total)
                }
                .frame(height: 26)
                .frame(minWidth: 120)
                Text(Doc.clipLength(playing || time > 0 ? time : total)).font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                Button(rateLabel(playback.rate)) { playback.faster() }
                    .buttonStyle(.plain).font(.caption).padding(.horizontal, 6).background(Capsule().stroke(Theme.line))
                    .help("Playback speed")
                VolumeButton()
                if file.transcript != nil {
                    Button { toggleWords(showWords) } label: { Image(systemName: "text.alignleft") }.buttonStyle(.plain).foregroundStyle(showWords ? Theme.accent : Theme.muted)
                        .help(showWords ? "Hide transcript" : "Show transcript")
                        .accessibilityLabel(showWords ? "Hide transcript" : "Show transcript")
                }
            }
            if let transcript = file.transcript {
                if showWords {
                    VStack(alignment: .leading, spacing: 4) {
                        if transcript.isEmpty {
                            Text("No words were heard.").italic().foregroundStyle(Theme.muted)
                        } else if file.cues.isEmpty {
                            Text(transcript).textSelection(.enabled)
                        } else {
                            FlowText(cues: file.cues, current: current ? file.cues.lastIndex { $0.start <= time } : nil) { start in
                                playback.play(file, cardId: card?.id, vaultId: vaultId, model: model, at: start)
                            }
                        }
                        HStack(spacing: 12) {
                            if !transcript.isEmpty {
                                Button { Clipboard.copy(transcript); model.say("Copied the transcript.") } label: { Label("Copy", systemImage: "doc.on.doc") }
                            }
                            if canTranscribe && !working {
                                Button(action: transcribe) { Label("Transcribe again", systemImage: "repeat") }
                            }
                            if working { Text("Transcribing…") }
                        }
                        .buttonStyle(.plain)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                    }
                    .font(.subheadline)
                    .padding(.top, 6)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
                }
            } else if working {
                Text("Transcribing…").font(.caption).foregroundStyle(Theme.muted)
            } else if canTranscribe {
                Button(action: transcribe) { Label("Transcribe", systemImage: "text.alignleft") }
                    .buttonStyle(.plain).font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
    }

    private func press(current: Bool) {
        let playback = VoicePlayback.shared
        if current { playback.toggle() } else { playback.play(file, cardId: card?.id, vaultId: vaultId, model: model) }
    }

    /// Hidden or shown from the player, on this device, as the web's.
    private func toggleWords(_ shown: Bool) {
        var ids = Set(hidden.split(separator: ",").map(String.init))
        if shown { ids.insert(file.id) } else { ids.remove(file.id) }
        hidden = ids.sorted().joined(separator: ",")
    }

    /// Transcribing is for an entry this account can change, outside an encrypted vault, whose words never reach the server.
    private var canTranscribe: Bool {
        guard let card else { return false }
        return model.canEdit(card) && model.vault(vaultId)?.isEncrypted == false
    }

    private var working: Bool { Transcriber.shared.working.contains(file.id) }

    private func transcribe() {
        Task {
            guard let url = await Attachments.shared.fileURL(file.id, name: file.name.isEmpty ? "voice.m4a" : file.name, model: model),
                let samples = Transcriber.samples(url)
            else {
                model.say("That voice message can't be fetched now.")
                return
            }
            Transcriber.shared.start(id: file.id, samples: samples, vaultId: vaultId, model: model)
        }
    }
}

func rateLabel(_ rate: Float) -> String { "\(rate == 1 ? "1" : String(format: "%g", rate))×" }

/// The volume all voice messages play at, as the web's: a click mutes or unmutes them on a computer, with the slider
/// shown while pointed at; a press shows the slider on a phone.
struct VolumeButton: View {
    @State private var open = false

    var body: some View {
        let playback = VoicePlayback.shared
        let silent = playback.muted || playback.volume == 0
        Button {
            #if os(macOS)
            playback.toggleMute()
            #else
            open.toggle()
            #endif
        } label: {
            Image(systemName: silent ? "speaker.slash" : playback.volume < 0.5 ? "speaker.wave.1" : "speaker.wave.2")
                .font(.system(size: 13))
                .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.muted)
        .help(silent ? "Unmute" : "Mute")
        .accessibilityLabel(silent ? "Unmute voice messages" : "Mute voice messages")
        #if os(macOS)
        .onHover { if $0 { open = true } }
        #endif
        .popover(isPresented: $open, arrowEdge: .bottom) {
            Slider(value: Binding(get: { playback.muted ? 0 : playback.volume }, set: { playback.setVolume($0) }), in: 0...1)
                .frame(width: 160)
                .padding(12)
                .accessibilityLabel("Voice message volume")
                .presentationCompactAdaptation(.popover)
        }
    }
}

/// The voice message playing, in a bar along the top of the journal while it plays and while it's only paused, as the
/// web's (and Telegram's over a chat): play and pause between the previous and next voice message, its entry's name
/// and what's being said, the time, the speed and the volume, a close, and a line along its foot to seek in.
struct VoiceBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let playback = VoicePlayback.shared
        if let item = playback.item {
            let card = item.cardId.flatMap { model.card($0) }
            let name = card.map { $0.title.isEmpty ? (Doc.previewLines($0.content).first ?? "Voice message") : $0.title } ?? item.file.name
            let saying = item.file.cues.lastIndex { $0.start <= playback.time }.map { item.file.cues[$0].text }
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button { playback.skip(after: false) } label: { Image(systemName: "backward.fill") }
                        .disabled(playback.beside(after: false) == nil).help("Previous voice message").accessibilityLabel("Previous voice message")
                    Button { playback.toggle() } label: { Image(systemName: playback.playing ? "pause.fill" : "play.fill").frame(width: 22) }
                        .accessibilityLabel(playback.playing ? "Pause" : "Play")
                    Button { playback.skip(after: true) } label: { Image(systemName: "forward.fill") }
                        .disabled(playback.beside(after: true) == nil).help("Next voice message").accessibilityLabel("Next voice message")
                    Button { if let id = item.cardId { model.lastSaved = id } } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(name).fontWeight(.semibold).lineLimit(1)
                            if let saying { Text(saying).font(.caption).foregroundStyle(Theme.muted).lineLimit(1) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .help("Show it")
                    Text("\(Doc.clipLength(playback.time)) / \(Doc.clipLength(playback.total))").font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                    Button(rateLabel(playback.rate)) { playback.faster() }.font(.caption).help("Playback speed")
                    VolumeButton()
                    Button { playback.stop() } label: { Image(systemName: "xmark") }.help("Stop and close").accessibilityLabel("Stop and close")
                }
                .buttonStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Theme.line)
                        Rectangle().fill(Theme.accent).frame(width: geo.size.width * (playback.total > 0 ? min(1, playback.time / playback.total) : 0))
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { p in if playback.total > 0 { playback.seek(p.x / geo.size.width * playback.total) } }
                }
                .frame(height: 3)
            }
            .background(Theme.surface)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Voice message playing")
        }
    }
}

/// A sound's loudness as bars, the part played in the accent color.
struct Waveform: View {
    let peaks: [Double]
    let progress: Double
    /// Pressed at a point, the fraction of the way along: to play from there, as the web's.
    var seek: ((Double) -> Void)? = nil

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
            .contentShape(Rectangle())
            .onTapGesture { p in if let seek, geo.size.width > 0 { seek(max(0, min(1, p.x / geo.size.width))) } }
        }
        .accessibilityLabel("Position")
    }
}

/// A transcript's sentences as one paragraph, wrapping as the web's, each pressed to play from there, the one being
/// said marked.
struct FlowText: View {
    let cues: [Doc.Cue]
    let current: Int?
    let play: (Double) -> Void

    var body: some View {
        var text = AttributedString()
        for (i, cue) in cues.enumerated() {
            var piece = AttributedString(cue.text)
            piece.link = URL(string: "notes-cue:\(i)")
            if i == current { piece.backgroundColor = Theme.accentSoft }
            text += piece
            if i < cues.count - 1 { text += AttributedString(" ") }
        }
        return Text(text)
            .tint(Theme.text)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.openURL, OpenURLAction { url in
                if url.scheme == "notes-cue", let i = Int(url.absoluteString.dropFirst("notes-cue:".count)), cues.indices.contains(i) { play(cues[i].start) }
                return .handled
            })
    }
}

/// A voice message being recorded from the box's mic, as the web app's `useVoiceRecorder`: while it records, a bar over
/// the box shows the time, how loud it is now, Discard and Done (`VoiceRecordingBar`). Only Discard throws it away:
/// Done, or stopping by itself after 15 minutes, hands what was recorded on.
@MainActor
@Observable
final class VoiceRecording {
    static let levelCount = 28
    static let maxSeconds = 15.0 * 60
    private(set) var started: Date?
    /// How loud it was over the last few seconds, oldest first, each from 0 to 100.
    private(set) var levels = [Double](repeating: 0, count: levelCount)
    var isRecording: Bool { started != nil }
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var tick: Timer?
    @ObservationIgnored private var asking = false
    @ObservationIgnored private var done: ((URL) -> Void)?

    /// Asks for the microphone and starts, unless it's recording already; `done` gets the file once it's stopped and kept.
    func start(model: AppModel, done: @escaping (URL) -> Void) {
        guard recorder == nil, !asking else { return }
        asking = true
        Task {
            defer { asking = false }
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
            guard let r = try? AVAudioRecorder(url: url, settings: settings) else {
                model.say("Recording didn't start.")
                return
            }
            r.isMeteringEnabled = true
            guard r.record() else {
                model.say("Recording didn't start.")
                return
            }
            recorder = r
            self.done = done
            levels = [Double](repeating: 0, count: Self.levelCount)
            started = Date()
            let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.sample() } }
            // Kept ticking while a menu is open or the page scrolls.
            RunLoop.main.add(t, forMode: .common)
            tick = t
        }
    }

    private func sample() {
        guard let recorder, let started else { return }
        recorder.updateMeters()
        // From decibels to how far the sound swings, scaled as the web's.
        let power = Double(recorder.averagePower(forChannel: 0))
        levels = Array(levels.dropFirst()) + [min(100, (pow(10, power / 20) * 400).rounded())]
        if Date().timeIntervalSince(started) >= Self.maxSeconds { finish(keep: true) }
    }

    /// Stops, keeping what was recorded or throwing it away.
    func finish(keep: Bool) {
        guard let recorder else { return }
        tick?.invalidate()
        tick = nil
        recorder.stop()
        self.recorder = nil
        started = nil
        let done = self.done
        self.done = nil
        if keep { done?(recorder.url) } else { try? FileManager.default.removeItem(at: recorder.url) }
    }
}

/// The bar over the box while a voice message records, as the web's: a dot, the time, how loud it is now, Discard and Done.
struct VoiceRecordingBar: View {
    let recording: VoiceRecording
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var dim = false

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Theme.alert).frame(width: 10, height: 10)
                .opacity(dim ? 0.3 : 1)
                .onAppear {
                    guard !still else { return }
                    withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { dim = true }
                }
            if let started = recording.started {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    Text(Doc.clipLength(context.date.timeIntervalSince(started).rounded(.down)))
                        .font(.callout.weight(.semibold).monospacedDigit())
                        .frame(minWidth: 38, alignment: .leading)
                }
            }
            HStack(spacing: 2) {
                ForEach(recording.levels.indices, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2).fill(Theme.accent)
                        .frame(height: 26 * max(8, recording.levels[i]) / 100)
                }
            }
            .frame(width: 112, height: 26)
            .accessibilityHidden(true)
            Button { recording.finish(keep: false) } label: { Image(systemName: "trash").foregroundStyle(Theme.muted).frame(width: 32, height: 32) }
                .buttonStyle(.plain)
                .help("Discard")
                .accessibilityLabel("Discard the recording")
            Button { recording.finish(keep: true) } label: {
                Label("Done", systemImage: "stop.fill")
                    .font(.callout.weight(.semibold))
                    .padding(.vertical, 7).padding(.leading, 12).padding(.trailing, 14)
                    .background(Capsule().fill(Theme.accent))
                    .foregroundStyle(Theme.onAccent)
            }
            .buttonStyle(.plain)
            .help("Stop and add it")
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
        .background(Capsule().fill(Theme.raised))
        .overlay(Capsule().stroke(Theme.line))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Recording a voice message")
    }
}

/// The box's mic: press to record a voice message, shown in the bar over the box (`VoiceRecordingBar`) until it's
/// done. It's added to the box like a file, drawn by its loudness, and transcribed by the server once it's up (not in
/// an encrypted vault, whose words never reach it).
struct VoiceRecordButton: View {
    @Environment(AppModel.self) private var model
    let vaultId: String
    let recording: VoiceRecording
    /// Raised to start recording from elsewhere, as the box's /voice does.
    var start = 0
    let add: (JSONValue) -> Void

    var body: some View {
        Button(action: begin) {
            Image(systemName: recording.isRecording ? "mic.fill" : "mic").foregroundStyle(recording.isRecording ? Theme.accent : Theme.muted)
        }
        .buttonStyle(.plain)
        .padding(.bottom, 8)
        .help("Record a voice message")
        .accessibilityLabel("Record a voice message")
        .onChange(of: start) { begin() }
    }

    private func begin() {
        recording.start(model: model) { url in finish(url) }
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
@Observable
final class Transcriber {
    static let shared = Transcriber()
    /// Voice messages being transcribed now, by file ID.
    private(set) var working: Set<String> = []
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
        working.insert(id)
        Task {
            defer { working.remove(id) }
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
            model.update(cardId) { c in if let next = Voice.withTranscript(c.content, fileId: id, words) { c.content = next } }
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
