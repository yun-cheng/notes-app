package dev.notesapp.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.io.ByteArrayOutputStream
import java.time.LocalDateTime
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Voice messages, as the web app's `voice.ts`: drawn by their loudness, cut into pieces to transcribe, sent as WAV, and
 * their pieces' words joined into one transcript kept on the file block.
 */
object Voice {
    /** The rate voice is sent to be transcribed at, as the model hears it. */
    const val RATE = 16_000
    /** The longest piece sent to be transcribed at once, in seconds. */
    const val PIECE_SECONDS = 120
    /** How many bars a voice message is drawn with. */
    const val PEAK_BARS = 48

    data class Transcript(val transcript: String, val language: String?, val cues: List<Doc.Cue>)
    data class Piece(val offset: Double, val text: String, val language: String?, val cues: List<Doc.Cue>)

    /** A recording's name, from when it was made: "Voice message 2026-11-20 14.32.m4a". */
    fun name(at: LocalDateTime, ext: String) = "Voice message %04d-%02d-%02d %02d.%02d.%s".format(at.year, at.monthValue, at.dayOfMonth, at.hour, at.minute, ext)

    /** How loud a sound is along its length, in `bars` bars from 0 to 100, the loudest at 100. */
    fun peaks(samples: FloatArray, bars: Int = PEAK_BARS): List<Double> {
        if (samples.isEmpty()) return emptyList()
        val each = samples.size.toDouble() / bars
        val levels = (0 until bars).map { i ->
            val from = floor(i * each).toInt()
            val to = maxOf(from + 1, floor((i + 1) * each).toInt())
            var sum = 0.0
            for (j in from until minOf(to, samples.size)) sum += (samples[j] * samples[j]).toDouble()
            sqrt(sum / (to - from))
        }
        val loudest = levels.max()
        return levels.map { if (loudest > 0) Math.round(it / loudest * 100).toDouble() else 0.0 }
    }

    /**
     * Where to cut a long recording into pieces to transcribe: no piece longer than `most` seconds, each cut at the
     * quietest moment in the 15 seconds before that, so it falls between words.
     */
    fun cutPoints(samples: FloatArray, rate: Int = RATE, most: Int = PIECE_SECONDS): List<Int> {
        val cuts = mutableListOf<Int>()
        val window = (rate * 0.05).roundToInt()
        val span = rate * 15
        var start = 0
        while (samples.size - start > most * rate) {
            val limit = start + most * rate
            var best = limit
            var quietest = Float.POSITIVE_INFINITY
            var at = limit - span
            while (at + window <= limit) {
                var sum = 0f
                for (j in at until at + window) sum += samples[j] * samples[j]
                if (sum < quietest) { quietest = sum; best = at + (window / 2.0).roundToInt() }
                at += window
            }
            cuts.add(best)
            start = best
        }
        return cuts
    }

    /** Sound as a WAV file: one channel, 16 bits, at `rate`. */
    fun wav(samples: FloatArray, from: Int = 0, to: Int = samples.size, rate: Int = RATE): ByteArray {
        val out = ByteArrayOutputStream(44 + (to - from) * 2)
        fun tag(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun u32(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff); out.write((v shr 16) and 0xff); out.write((v shr 24) and 0xff) }
        fun u16(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff) }
        val data = (to - from) * 2
        tag("RIFF"); u32(36 + data); tag("WAVE"); tag("fmt "); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16); tag("data"); u32(data)
        for (i in from until to) {
            val c = samples[i].coerceIn(-1f, 1f)
            u16((if (c < 0) c * 0x8000 else c * 0x7FFF).toInt().toShort().toInt())
        }
        return out.toByteArray()
    }

    fun unspaced(language: String?): Boolean {
        val l = language?.lowercase() ?: return false
        return listOf("zh", "ja", "th", "lo", "km", "my").any { l == it || l.startsWith("$it-") || l.startsWith("${it}_") }
    }

    /**
     * The pieces of one voice message as one transcript: their words in order, their cues moved on by where each
     * piece starts. The language is the one heard most.
     */
    fun join(pieces: List<Piece>): Transcript {
        val heard = mutableMapOf<String, Int>()
        for (p in pieces) p.language?.let { heard[it] = (heard[it] ?: 0) + p.text.length }
        val language = heard.maxByOrNull { it.value }?.key
        val text = pieces.map { it.text.trim() }.filter { it.isNotEmpty() }.joinToString(if (unspaced(language)) "" else " ")
        val cues = pieces.flatMap { p -> p.cues.map { Doc.Cue(Math.round((it.start + p.offset) * 100) / 100.0, it.text) } }
        return Transcript(text, language, cues)
    }

    /** A document with a transcript put on the voice message `fileId`, wherever it is; null if it doesn't hold it. */
    fun withTranscript(doc: JsonElement, fileId: String, words: Transcript?): JsonElement? {
        var found = false
        fun visit(node: JsonElement): JsonElement {
            val o = node as? JsonObject ?: return node
            if (o["type"].str == "file" && o["attrs"]["id"].str == fileId) {
                found = true
                val attrs = (o["attrs"].obj ?: JsonObject(emptyMap()))
                    .with("transcript", words?.let { j(it.transcript) } ?: JsonNull)
                    .with("language", j(words?.language))
                    .with("cues", words?.let { w -> JsonArray(w.cues.map { jobj("start" to j(it.start), "text" to j(it.text)) }) } ?: JsonNull)
                return o.with("attrs", attrs)
            }
            val children = o["content"].arr ?: return node
            return o.with("content", JsonArray(children.map(::visit)))
        }
        val next = visit(doc)
        return if (found) next else null
    }
}
