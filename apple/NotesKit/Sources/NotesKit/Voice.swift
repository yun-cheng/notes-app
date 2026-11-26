import Foundation

/// Voice messages, as the web app's `voice.ts`: drawn by their loudness, cut into pieces to transcribe, sent as WAV, and
/// their pieces' words joined into one transcript kept on the file block.
public enum Voice {
    /// The rate voice is sent to be transcribed at, as the model hears it.
    public static let rate = 16_000
    /// The longest piece sent to be transcribed at once, in seconds.
    public static let pieceSeconds = 120
    /// How many bars a voice message is drawn with.
    public static let peakBars = 48
    /// Target speech loudness in dB below full scale, as the web app's `LEVEL_TARGET`.
    public static let levelTarget = -18.0
    private static let levelGate = -50.0
    private static let mostUp = 18.0
    private static let mostDown = -6.0

    /// How loud a short stretch of sound is: its RMS in dB below full scale, -infinity for silence.
    public static func loudness(_ samples: [Float]) -> Double {
        samples.withUnsafeBufferPointer(loudness)
    }

    public static func loudness(_ samples: UnsafeBufferPointer<Float>) -> Double {
        guard !samples.isEmpty else { return -.infinity }
        var sum = 0.0
        for s in samples { sum += Double(s) * Double(s) }
        let rms = (sum / Double(samples.count)).squareRoot()
        return rms > 0 ? 20 * log10(rms) : -.infinity
    }

    /// How loud a voice message is speaking, from what it was and the stretch just `heard`; nil until it's spoken.
    public static func nextLevel(_ level: Double?, heard: Double) -> Double? {
        guard heard > levelGate else { return level }
        guard let level else { return heard }
        return level + (heard - level) * (heard > level ? 0.5 : 0.04)
    }

    /// What to multiply a voice message by, speaking at `level`, to be heard at `levelTarget`: as it is until it's spoken.
    public static func levelGain(_ level: Double?) -> Double {
        guard let level else { return 1 }
        return pow(10, min(mostUp, max(mostDown, levelTarget - level)) / 20)
    }

    /// Soft limiter above -4 dBFS so a boosted quiet recording never digitally clips, matching Web Audio's compressor.
    public static func limit(_ x: Float) -> Float {
        let a = abs(x)
        let threshold: Float = 0.63095734 // -4 dBFS
        guard a > threshold else { return x }
        let ceiling: Float = 0.99
        let headroom = ceiling - threshold
        let over = a - threshold
        let compressed = threshold + (over * headroom) / (headroom + over)
        return x < 0 ? -compressed : compressed
    }

    /// Real-time loudness leveler used while a voice message plays: measures 50 ms stretches, follows speech with
    /// `nextLevel`, ramps gain toward `levelGain` with a 0.15 s time constant, and soft-limits peaks under full scale.
    public final class Leveler: @unchecked Sendable {
        public private(set) var level: Double?
        public private(set) var gain: Double
        private var targetGain: Double
        private var sumSquares = 0.0
        private var windowSamples = 0

        public init(initialLevel: Double? = nil) {
            self.level = initialLevel
            let g = Voice.levelGain(initialLevel)
            self.gain = g
            self.targetGain = g
        }

        /// Levels one audio render buffer in place (non-interleaved channels, or interleaved channels).
        public func process(channels: [UnsafeMutableBufferPointer<Float>], frames: Int, sampleRate: Double, interleavedChannels: Int = 1) {
            guard frames > 0, !channels.isEmpty else { return }
            let rate = sampleRate > 0 ? sampleRate : 44_100
            let windowSize = max(1, Int((rate * 0.05).rounded()))
            let decay = exp(-1.0 / (rate * 0.15))

            if interleavedChannels > 1, let buf = channels.first {
                let ch = interleavedChannels
                let total = min(buf.count, frames * ch)
                let frameCount = total / ch
                for f in 0..<frameCount {
                    var frameEnergy = 0.0
                    let base = f * ch
                    for c in 0..<ch {
                        let s = Double(buf[base + c])
                        frameEnergy += s * s
                    }
                    sumSquares += frameEnergy / Double(ch)
                    windowSamples += 1
                    if windowSamples >= windowSize {
                        finishWindow()
                    }
                    gain = targetGain + (gain - targetGain) * decay
                    let g = Float(gain)
                    for c in 0..<ch {
                        buf[base + c] = Voice.limit(buf[base + c] * g)
                    }
                }
                return
            }

            let ch = channels.count
            let frameCount = min(frames, channels.map(\.count).min() ?? 0)
            for f in 0..<frameCount {
                var frameEnergy = 0.0
                for c in 0..<ch {
                    let s = Double(channels[c][f])
                    frameEnergy += s * s
                }
                sumSquares += frameEnergy / Double(ch)
                windowSamples += 1
                if windowSamples >= windowSize {
                    finishWindow()
                }
                gain = targetGain + (gain - targetGain) * decay
                let g = Float(gain)
                for c in 0..<ch {
                    channels[c][f] = Voice.limit(channels[c][f] * g)
                }
            }
        }

        private func finishWindow() {
            let rms = windowSamples > 0 ? (sumSquares / Double(windowSamples)).squareRoot() : 0
            let heard = rms > 0 ? 20 * log10(rms) : -.infinity
            if let next = Voice.nextLevel(level, heard: heard), next != level {
                level = next
                targetGain = Voice.levelGain(next)
            }
            sumSquares = 0
            windowSamples = 0
        }
    }

    /// A voice message's words as an entry keeps them.
    public struct Transcript: Sendable, Hashable {
        public var transcript: String
        public var language: String?
        public var cues: [Doc.Cue]
        public init(transcript: String, language: String?, cues: [Doc.Cue]) {
            self.transcript = transcript
            self.language = language
            self.cues = cues
        }
    }

    /// A recording's name, from when it was made: "Voice message 2026-11-20 14.32.m4a".
    public static func name(at date: Date, ext: String) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return String(format: "Voice message %04d-%02d-%02d %02d.%02d.%@", c.year!, c.month!, c.day!, c.hour!, c.minute!, ext)
    }

    /// How loud a sound is along its length, in `bars` bars from 0 to 100, the loudest at 100.
    public static func peaks(_ samples: [Float], bars: Int = peakBars) -> [Double] {
        guard !samples.isEmpty else { return [] }
        let each = Double(samples.count) / Double(bars)
        let levels = (0..<bars).map { i -> Double in
            let from = Int((Double(i) * each).rounded(.down))
            let to = max(from + 1, Int((Double(i + 1) * each).rounded(.down)))
            var sum = 0.0
            for j in from..<min(to, samples.count) { sum += Double(samples[j] * samples[j]) }
            return (sum / Double(to - from)).squareRoot()
        }
        let loudest = levels.max() ?? 0
        return levels.map { loudest > 0 ? ($0 / loudest * 100).rounded() : 0 }
    }

    /// Where to cut a long recording into pieces to transcribe: no piece longer than `pieceSeconds`, each cut at the
    /// quietest moment in the 15 seconds before that, so it falls between words.
    public static func cutPoints(_ samples: [Float], rate: Int = rate, most: Int = pieceSeconds) -> [Int] {
        var cuts: [Int] = []
        let window = Int((Double(rate) * 0.05).rounded())
        let span = rate * 15
        var start = 0
        while samples.count - start > most * rate {
            let limit = start + most * rate
            var best = limit
            var quietest = Float.infinity
            var at = limit - span
            while at + window <= limit {
                var sum: Float = 0
                for j in at..<(at + window) { sum += samples[j] * samples[j] }
                if sum < quietest {
                    quietest = sum
                    best = at + Int((Double(window) / 2).rounded())
                }
                at += window
            }
            cuts.append(best)
            start = best
        }
        return cuts
    }

    /// Sound as a WAV file: one channel, 16 bits, at `rate`.
    public static func wav(_ samples: ArraySlice<Float>, rate: Int = rate) -> Data {
        var out = Data()
        func tag(_ s: String) { out.append(contentsOf: Array(s.utf8)) }
        func u32(_ v: Int) { withUnsafeBytes(of: UInt32(v).littleEndian) { out.append(contentsOf: $0) } }
        func u16(_ v: Int) { withUnsafeBytes(of: UInt16(v).littleEndian) { out.append(contentsOf: $0) } }
        let data = samples.count * 2
        tag("RIFF"); u32(36 + data); tag("WAVE"); tag("fmt "); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16); tag("data"); u32(data)
        out.reserveCapacity(44 + data)
        for s in samples {
            let c = max(-1, min(1, s))
            let v = Int16(c < 0 ? c * 0x8000 : c * 0x7FFF)
            withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) }
        }
        return out
    }

    static func unspaced(_ language: String?) -> Bool {
        guard let l = language?.lowercased() else { return false }
        return ["zh", "ja", "th", "lo", "km", "my"].contains { l == $0 || l.hasPrefix($0 + "-") || l.hasPrefix($0 + "_") }
    }

    /// The pieces of one voice message as one transcript: their words in order, their cues moved on by where each
    /// piece starts. The language is the one heard most.
    public static func join(_ pieces: [(offset: Double, text: String, language: String?, cues: [Doc.Cue])]) -> Transcript {
        var heard: [String: Int] = [:]
        for p in pieces { if let l = p.language { heard[l, default: 0] += p.text.count } }
        let language = heard.max { $0.value < $1.value }?.key
        let text = pieces.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: unspaced(language) ? "" : " ")
        let cues = pieces.flatMap { p in p.cues.map { Doc.Cue(start: ((($0.start + p.offset) * 100).rounded()) / 100, text: $0.text) } }
        return Transcript(transcript: text, language: language, cues: cues)
    }

    /// A document with a transcript put on the voice message `fileId`, wherever it is; nil if it doesn't hold it.
    public static func withTranscript(_ doc: JSONValue, fileId: String, _ words: Transcript?) -> JSONValue? {
        var found = false
        func visit(_ node: JSONValue) -> JSONValue {
            if node["type"] == "file", node["attrs"]?["id"]?.stringValue == fileId {
                found = true
                var n = node
                var attrs = n["attrs"]?.objectValue ?? [:]
                attrs["transcript"] = words.map { .string($0.transcript) } ?? .null
                attrs["language"] = words?.language.map(JSONValue.string) ?? .null
                attrs["cues"] = words.map { .array($0.cues.map { ["start": .double($0.start), "text": .string($0.text)] }) } ?? .null
                n["attrs"] = .object(attrs)
                return n
            }
            guard let children = node["content"]?.arrayValue else { return node }
            var n = node
            n["content"] = .array(children.map(visit))
            return n
        }
        let next = visit(doc)
        // `.none`, not `nil`, which would read as JSON's null here.
        guard found else { return .none }
        return next
    }
}

extension ServerAPI {
    public enum TranscribeError: Error, Sendable { case encrypted, limit, notSetUp, offline, failed }

    /// One piece of a voice message transcribed by the server's Whisper, as WAV at 16 kHz.
    public func transcribe(vaultId: String, wav: Data) async throws(TranscribeError) -> (text: String, language: String?, cues: [Doc.Cue]) {
        struct R: Decodable {
            struct C: Decodable { let start: Double; let text: String }
            let text: String
            let language: String?
            let cues: [C]
        }
        let result: (Data, Int)
        do {
            result = try await send("/transcribe?vault=" + Self.part(vaultId), method: "POST", raw: wav, type: "audio/wav")
        } catch {
            throw .offline
        }
        switch result.1 {
        case 200..<300:
            guard let r = try? JSONDecoder().decode(R.self, from: result.0) else { throw .failed }
            return (r.text, r.language, r.cues.map { Doc.Cue(start: $0.start, text: $0.text) })
        case 403: throw .encrypted
        case 429: throw .limit
        case 501: throw .notSetUp
        default: throw .failed
        }
    }
}
