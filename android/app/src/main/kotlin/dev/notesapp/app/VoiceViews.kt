package dev.notesapp.app

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.automirrored.outlined.VolumeDown
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaPlayer
import android.media.MediaRecorder
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Mic
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import dev.notesapp.core.Card
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.notesapp.core.Doc
import dev.notesapp.core.ServerApi
import dev.notesapp.core.Voice
import dev.notesapp.core.get
import dev.notesapp.core.j
import dev.notesapp.core.jarr
import dev.notesapp.core.jobj
import dev.notesapp.core.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDateTime

/**
 * The voice message playing, for every player and the bar along the top of the journal, as the web's: one plays at a
 * time, one that ends runs on to the next while they come one after another (in the same entry, or the next one), and
 * all play at one volume kept on this device, read as heard (half way is a quarter as loud), or muted.
 */
object VoicePlayback {
    data class Item(val file: Doc.FileInfo, val cardId: String?, val vaultId: String)

    var item by mutableStateOf<Item?>(null); private set
    var playing by mutableStateOf(false); private set
    var time by mutableDoubleStateOf(0.0); private set
    var total by mutableDoubleStateOf(0.0); private set
    var rate by mutableFloatStateOf(1f); private set
    private var player: MediaPlayer? = null
    private var model: AppModel? = null
    private var ticking: kotlinx.coroutines.Job? = null

    private val heard get() = if (Settings.voiceMuted) 0f else Settings.voiceVolume * Settings.voiceVolume

    fun isCurrent(id: String) = item?.file?.id == id

    /** Plays `file` from `at` seconds (or where it was), stopping any other. */
    fun play(file: Doc.FileInfo, cardId: String?, vaultId: String, model: AppModel, at: Double? = null) {
        this.model = model
        val p = player
        if (item?.file?.id == file.id && p != null) {
            at?.let { p.seekTo((it * 1000).toInt()); time = it }
            p.start(); speed(p); p.setVolume(heard, heard)
            playing = true
            tick()
            return
        }
        release()
        item = Item(file, cardId, vaultId)
        time = at ?: 0.0
        total = file.duration ?: 0.0
        playing = true
        model.scope.launch {
            val f = Attachments.fileFor(file.id, file.name.ifEmpty { "voice.m4a" }, model)
            if (f == null) { if (isCurrent(file.id)) stop(); model.say("That voice message can't be fetched now."); return@launch }
            if (!isCurrent(file.id)) return@launch
            val mp = MediaPlayer()
            runCatching {
                mp.setDataSource(f.path)
                mp.prepare()
                mp.setOnCompletionListener { finished() }
                if (mp.duration > 0) total = mp.duration / 1000.0
                at?.let { mp.seekTo((it * 1000).toInt()) }
                mp.setVolume(heard, heard)
                player = mp
                if (playing) { mp.start(); speed(mp); tick() }
            }.onFailure { mp.release(); stop(); model.say("That sound can't be played here.") }
        }
    }

    private fun speed(p: MediaPlayer) { runCatching { p.playbackParams = p.playbackParams.setSpeed(rate) } }

    private fun tick() {
        ticking?.cancel()
        val m = model ?: return
        ticking = m.scope.launch {
            while (isActive && playing) {
                player?.let { p -> runCatching { time = p.currentPosition / 1000.0 } }
                delay(100)
            }
        }
    }

    fun toggle() {
        val p = player ?: run { playing = !playing; return }
        if (playing) p.pause() else { p.start(); speed(p) }
        playing = !playing
        if (playing) tick()
    }

    fun seek(seconds: Double) { time = seconds; player?.seekTo((seconds * 1000).toInt()) }

    /** 1×, 1.5×, 2× and round. */
    fun faster() {
        rate = if (rate == 1f) 1.5f else if (rate == 1.5f) 2f else 1f
        player?.let { if (playing) speed(it) }
    }

    /** Stops it and closes the bar. */
    fun stop() { release(); item = null; playing = false; time = 0.0 }

    fun setVolume(v: Float) { Settings.setVoice(v, false); player?.setVolume(heard, heard) }

    /** Mutes them, or brings them back: at half volume, from none. */
    fun toggleMute() {
        if (Settings.voiceMuted || Settings.voiceVolume == 0f) Settings.setVoice(if (Settings.voiceVolume == 0f) 0.5f else Settings.voiceVolume, false)
        else Settings.setVoice(Settings.voiceVolume, true)
        player?.setVolume(heard, heard)
    }

    private fun release() { ticking?.cancel(); player?.release(); player = null }

    private fun finished() {
        playing = false
        time = 0.0
        player?.seekTo(0)
        if (!playAfter()) stop()
    }

    private fun entries(): List<Card> = model?.index?.live.orEmpty().filter { it.type != dev.notesapp.core.CardType.tag && !it.archived }.sortedBy { it.createdAt }

    /** The voice messages on show, in the journal's order (oldest first), each with its entry. */
    private fun all(): List<Item> = entries().flatMap { c -> Doc.files(c.content).filter { it.isAudio }.map { Item(it, c.id, c.vaultId) } }

    /** The previous or next voice message, if any. */
    fun beside(after: Boolean): Item? {
        val now = item ?: return null
        val list = all()
        val i = list.indexOfFirst { it.file.id == now.file.id }
        if (i < 0) return null
        return list.getOrNull(i + if (after) 1 else -1)
    }

    fun skip(after: Boolean) {
        val next = beside(after) ?: return
        val m = model ?: return
        play(next.file, next.cardId, next.vaultId, m, 0.0)
    }

    /** Plays the one straight after, in the same entry or the next one; whether it did. */
    private fun playAfter(): Boolean {
        val now = item ?: return false
        val next = beside(true) ?: return false
        val m = model ?: return false
        if (next.cardId != now.cardId) {
            val order = entries().map { it.id }
            val a = order.indexOf(now.cardId)
            val b = order.indexOf(next.cardId)
            if (a < 0 || b != a + 1) return false
        }
        play(next.file, next.cardId, next.vaultId, m, 0.0)
        return true
    }
}

/**
 * A voice message (any sound) where it is, as the web app's player: play and pause, its loudness drawn along it to seek
 * in, the time, a speed, the volume all voice messages play at, and its transcript, each sentence pressed to play from
 * there and the one being said marked.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VoicePlayer(file: Doc.FileInfo, vaultId: String, card: Card? = null) {
    val model = LocalModel.current
    val playback = VoicePlayback
    val isCurrent = playback.isCurrent(file.id)
    val playing = isCurrent && playback.playing
    val duration = if (isCurrent && playback.total > 0) playback.total else file.duration ?: 0.0
    val time = if (isCurrent) playback.time else 0.0
    var showWords by remember(file.id) { mutableStateOf(file.id !in hiddenTranscripts) }
    fun play(at: Double? = null) = playback.play(file, card?.id, vaultId, model, at)
    val current = if (isCurrent) file.cues.indexOfLast { it.start <= time }.takeIf { it >= 0 } else null
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val canTranscribe = card != null && model.canEdit(card) && model.vault(vaultId)?.isEncrypted == false
    val working = file.id in Transcriber.working
    fun transcribe() {
        model.scope.launch {
            val f = Attachments.fileFor(file.id, file.name.ifEmpty { "voice.m4a" }, model)
            val samples = f?.let { Transcriber.samples(it) }
            if (samples == null || samples.isEmpty()) { model.say("That voice message can't be fetched now."); return@launch }
            Transcriber.start(file.id, samples, vaultId, model)
        }
    }
    val shape = RoundedCornerShape(14.dp)
    Column(Modifier.widthIn(max = 420.dp).clip(shape).background(Theme.surface).border(1.dp, Theme.line, shape).padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).clip(CircleShape).background(Theme.accent).clickable { if (isCurrent) playback.toggle() else play() }, contentAlignment = Alignment.Center) {
                Icon(if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playing) "Pause" else "Play", tint = Theme.onAccent)
            }
            Waveform(file.peaks, if (duration > 0) time / duration else 0.0, Modifier.weight(1f).widthIn(min = 100.dp).height(26.dp)) { f -> play(f * duration) }
            Text(Doc.clipLength(if (playing || time > 0) time else duration), fontSize = 12.sp, color = Theme.muted)
            Text(
                rateLabel(playback.rate),
                Modifier.clip(RoundedCornerShape(50)).border(1.dp, Theme.line, RoundedCornerShape(50)).clickable { playback.faster() }.padding(horizontal = 6.dp),
                fontSize = 12.sp, color = Theme.muted,
            )
            VolumeButton()
            if (file.transcript != null) Icon(Icons.AutoMirrored.Outlined.Notes, if (showWords) "Hide transcript" else "Show transcript", Modifier.size(20.dp).clickable {
                showWords = !showWords
                if (showWords) hiddenTranscripts.remove(file.id) else hiddenTranscripts.add(file.id)
            }, tint = if (showWords) Theme.accent else Theme.muted)
        }
        val transcript = file.transcript
        if (transcript != null) {
            if (showWords) {
                HorizontalDivider(color = Theme.line)
                when {
                    transcript.isEmpty() -> Text("No words were heard.", color = Theme.muted, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, fontSize = 14.sp)
                    file.cues.isEmpty() -> Text(transcript, color = Theme.text, fontSize = 14.sp)
                    else -> {
                        // One paragraph, wrapping as the web's, each sentence pressed to play from there.
                        val soft = Theme.accentSoft
                        Text(androidx.compose.ui.text.buildAnnotatedString {
                            file.cues.forEachIndexed { i, cue ->
                                withLink(androidx.compose.ui.text.LinkAnnotation.Clickable("cue$i", linkInteractionListener = { play(cue.start) })) {
                                    if (i == current) withStyle(androidx.compose.ui.text.SpanStyle(background = soft)) { append(cue.text) } else append(cue.text)
                                }
                                if (i < file.cues.size - 1) append(" ")
                            }
                        }, color = Theme.text, fontSize = 14.sp)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (transcript.isNotEmpty()) Row(Modifier.clickable { clipboard.setText(androidx.compose.ui.text.AnnotatedString(transcript)); model.say("Copied the transcript.") }, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.ContentCopy, null, Modifier.size(14.dp), tint = Theme.muted); Text("Copy", color = Theme.muted, fontSize = 12.sp)
                    }
                    if (canTranscribe && !working) Row(Modifier.clickable(onClick = ::transcribe), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Repeat, null, Modifier.size(14.dp), tint = Theme.muted); Text("Transcribe again", color = Theme.muted, fontSize = 12.sp)
                    }
                    if (working) Text("Transcribing…", color = Theme.muted, fontSize = 12.sp)
                }
            }
        } else if (working) {
            Text("Transcribing…", color = Theme.muted, fontSize = 12.sp)
        } else if (canTranscribe) {
            Row(Modifier.clickable(onClick = ::transcribe), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Outlined.Notes, null, Modifier.size(14.dp), tint = Theme.accent); Text("Transcribe", color = Theme.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Transcripts hidden from their players, on this device, as the web keeps them. */
val hiddenTranscripts = androidx.compose.runtime.mutableStateListOf<String>()

fun rateLabel(rate: Float) = "${if (rate == 1f) "1" else if (rate == 1.5f) "1.5" else "2"}×"

/**
 * The volume all voice messages play at, as the web's: a press shows the slider (a mouse's press mutes them, as a
 * computer's click does there).
 */
@Composable
fun VolumeButton() {
    var open by remember { mutableStateOf(false) }
    val silent = Settings.voiceMuted || Settings.voiceVolume == 0f
    Box {
        Icon(
            if (silent) Icons.AutoMirrored.Outlined.VolumeOff else if (Settings.voiceVolume < 0.5f) Icons.AutoMirrored.Outlined.VolumeDown else Icons.AutoMirrored.Outlined.VolumeUp,
            if (silent) "Unmute voice messages" else "Mute voice messages",
            Modifier.size(20.dp).clip(CircleShape).clickable { open = true }, tint = Theme.muted,
        )
        androidx.compose.material3.DropdownMenu(open, { open = false }, containerColor = Theme.raised) {
            Row(Modifier.padding(horizontal = 12.dp).widthIn(min = 200.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (silent) Icons.AutoMirrored.Outlined.VolumeOff else Icons.AutoMirrored.Outlined.VolumeUp, if (silent) "Unmute" else "Mute", Modifier.size(22.dp).clickable { VoicePlayback.toggleMute() }, tint = Theme.text)
                androidx.compose.material3.Slider(if (Settings.voiceMuted) 0f else Settings.voiceVolume, { VoicePlayback.setVolume(it) }, Modifier.widthIn(min = 160.dp))
            }
        }
    }
}

/**
 * The voice message playing, in a bar along the top of the journal while it plays and while it's only paused, as the
 * web's (and Telegram's over a chat): play and pause between the previous and next voice message, its entry's name and
 * what's being said, the time, the speed and the volume, a close, and a line along its foot to seek in.
 */
@Composable
fun VoiceBar() {
    val model = LocalModel.current
    val playback = VoicePlayback
    val item = playback.item ?: return
    val card = item.cardId?.let { model.card(it) }
    val name = card?.let { c -> c.title.ifBlank { Doc.previewLines(c.content).firstOrNull() ?: "Voice message" } } ?: item.file.name
    val saying = item.file.cues.indexOfLast { it.start <= playback.time }.takeIf { it >= 0 }?.let { item.file.cues[it].text }
    Column(Modifier.fillMaxWidth().background(Theme.surface)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val before = playback.beside(false) != null
            val after = playback.beside(true) != null
            Icon(Icons.Outlined.SkipPrevious, "Previous voice message", Modifier.size(28.dp).clip(CircleShape).clickable(enabled = before) { playback.skip(false) }.padding(3.dp), tint = if (before) Theme.text else Theme.muted.copy(alpha = 0.4f))
            Icon(if (playback.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playback.playing) "Pause" else "Play", Modifier.size(28.dp).clip(CircleShape).clickable { playback.toggle() }.padding(2.dp), tint = Theme.text)
            Icon(Icons.Outlined.SkipNext, "Next voice message", Modifier.size(28.dp).clip(CircleShape).clickable(enabled = after) { playback.skip(true) }.padding(3.dp), tint = if (after) Theme.text else Theme.muted.copy(alpha = 0.4f))
            Column(Modifier.weight(1f).clickable { item.cardId?.let { model.lastSaved = it } }) {
                Text(name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = Theme.text, maxLines = 1)
                saying?.let { Text(it, fontSize = 12.sp, color = Theme.muted, maxLines = 1) }
            }
            Text("${Doc.clipLength(playback.time)} / ${Doc.clipLength(playback.total)}", fontSize = 12.sp, color = Theme.muted)
            Text(rateLabel(playback.rate), Modifier.clickable { playback.faster() }.padding(horizontal = 4.dp), fontSize = 12.sp, color = Theme.text)
            VolumeButton()
            Icon(Icons.Outlined.Close, "Stop and close", Modifier.size(28.dp).clip(CircleShape).clickable { playback.stop() }.padding(4.dp), tint = Theme.text)
        }
        Waveform(emptyList(), if (playback.total > 0) playback.time / playback.total else 0.0, Modifier.fillMaxWidth().height(3.dp), line = true) { f -> playback.seek(f * playback.total) }
    }
}

/** A sound's loudness as bars, the part played in the accent color; pressed at a point, the fraction of the way along, to play from there. */
@Composable
fun Waveform(peaks: List<Double>, progress: Double, modifier: Modifier, line: Boolean = false, seek: ((Double) -> Unit)? = null) {
    val accent = Theme.accent
    val muted = Theme.muted.copy(alpha = 0.5f)
    val lineColor = Theme.line
    val bars = peaks.ifEmpty { List(40) { 30.0 } }
    val pressed = if (seek != null) Modifier.pointerInput(seek) { detectTapGestures { o -> if (size.width > 0) seek((o.x / size.width).toDouble().coerceIn(0.0, 1.0)) } } else Modifier
    if (line) {
        Canvas(modifier.then(pressed)) {
            drawRect(lineColor)
            drawRect(accent, size = Size(size.width * progress.toFloat().coerceIn(0f, 1f), size.height))
        }
        return
    }
    Canvas(modifier.then(pressed)) {
        val w = size.width / bars.size
        bars.forEachIndexed { i, p ->
            val h = maxOf(2f, size.height * (p / 100).toFloat())
            drawRoundRect(if (i.toDouble() / bars.size < progress) accent else muted, Offset(i * w, (size.height - h) / 2), Size(maxOf(1f, w - 3f), h), CornerRadius(2f, 2f))
        }
    }
}

/**
 * A voice message being recorded from the box's mic, as the web app's `useVoiceRecorder`: while it records, a bar over
 * the box shows the time, how loud it is now, Discard and Done (`VoiceRecordingBar`). Only Discard throws it away:
 * Done, or stopping by itself after 15 minutes, hands what was recorded on.
 */
class VoiceRecording {
    /** When it started, or 0 when it isn't recording. */
    var started by mutableLongStateOf(0L)
        private set
    /** How loud it was over the last few seconds, oldest first, each from 0 to 100. */
    var levels by mutableStateOf(List(LEVELS) { 0f })
        private set
    val isRecording get() = started != 0L
    private var recorder: Recorder? = null
    private var done: ((Recorder) -> Unit)? = null

    /** Starts, unless it's recording already; `done` gets the recorder once it's stopped and kept. */
    fun start(done: (Recorder) -> Unit): Boolean {
        if (recorder != null) return true
        val r = Recorder()
        if (!r.start()) return false
        recorder = r
        this.done = done
        levels = List(LEVELS) { 0f }
        started = System.currentTimeMillis()
        return true
    }

    /** Takes how loud it is now, and stops it once it's run as long as one can. */
    fun sample() {
        val r = recorder ?: return
        levels = levels.drop(1) + minOf(100f, Math.round(r.level * 400).toFloat())
        if (System.currentTimeMillis() - started >= MAX_SECONDS * 1000) finish(true)
    }

    /** Stops, keeping what was recorded or throwing it away. */
    fun finish(keep: Boolean) {
        val r = recorder ?: return
        recorder = null
        started = 0L
        val d = done
        done = null
        if (keep && d != null) d(r) else r.discard()
    }

    companion object {
        const val LEVELS = 28
        const val MAX_SECONDS = 15 * 60
    }
}

/** The bar over the box while a voice message records, as the web's: a dot, the time, how loud it is now, Discard and Done. */
@Composable
fun VoiceRecordingBar(recording: VoiceRecording) {
    val started = recording.started
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(started) {
        while (recording.isRecording) { recording.sample(); now = System.currentTimeMillis(); delay(100) }
    }
    val dim by rememberInfiniteTransition(label = "recording").animateFloat(
        1f, 0.3f, infiniteRepeatable(tween(600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "dot",
    )
    val accent = Theme.accent
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Row(
            Modifier.semantics(mergeDescendants = false) { contentDescription = "Recording a voice message" }
                .shadow(6.dp, CircleShape).clip(CircleShape).background(Theme.raised).border(1.dp, Theme.line, CircleShape)
                .padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(10.dp).graphicsLayer { alpha = dim }.clip(CircleShape).background(Theme.alert))
            Text(
                Doc.clipLength(((now - started).coerceAtLeast(0) / 1000).toDouble()), Modifier.widthIn(min = 38.dp),
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Theme.text, style = TextStyle(fontFeatureSettings = "tnum"),
            )
            Canvas(Modifier.size(112.dp, 26.dp).clearAndSetSemantics {}) {
                val bars = recording.levels
                val gap = 2.dp.toPx()
                val w = (size.width - gap * (bars.size - 1)) / bars.size
                bars.forEachIndexed { i, l ->
                    val h = size.height * maxOf(8f, l) / 100f
                    drawRoundRect(accent, Offset(i * (w + gap), (size.height - h) / 2), Size(w, h), CornerRadius(2.dp.toPx()))
                }
            }
            Icon(
                Icons.Outlined.Delete, "Discard the recording",
                Modifier.size(36.dp).clip(CircleShape).clickable { recording.finish(false) }.padding(7.dp), tint = Theme.muted,
            )
            Row(
                Modifier.clip(CircleShape).background(Theme.accent).clickable { recording.finish(true) }.padding(start = 12.dp, end = 14.dp, top = 7.dp, bottom = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Stop, null, Modifier.size(16.dp), tint = Theme.onAccent)
                Text("Done", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Theme.onAccent)
            }
        }
    }
}

/**
 * The box's mic: press to record a voice message, shown in the bar over the box (`VoiceRecordingBar`) until it's done.
 * It's added to the box like a file, drawn by its loudness, and transcribed by the server once it's up (not in an
 * encrypted vault, whose words never reach it).
 */
@Composable
fun VoiceRecordButton(vaultId: String, recording: VoiceRecording, start: Int = 0, add: (JsonElement) -> Unit) {
    val model = LocalModel.current
    val context = LocalContext.current
    fun finish(r: Recorder) {
        model.scope.launch {
            val samples = r.stop()
            if (samples.isEmpty()) return@launch
            val m4a = withContext(Dispatchers.Default) { Recorder.m4a(samples, context.cacheDir) } ?: run { model.say("The recording couldn't be saved."); return@launch }
            val duration = samples.size.toDouble() / Voice.RATE
            try {
                val node = Attachments.addFile(
                    m4a, Voice.name(LocalDateTime.now(), "m4a"), "audio/mp4", vaultId, model, duration.takeIf { it > 0 },
                    jobj("peaks" to JsonArray(Voice.peaks(samples).map { j(it) })),
                )
                add(node)
                val id = node["attrs"]["id"].str
                if (id != null && model.vault(vaultId)?.isEncrypted != true) Transcriber.start(id, samples, vaultId, model)
            } catch (e: Exception) {
                model.say(e.message ?: "The recording couldn't be added.")
            }
        }
    }
    fun begin() {
        if (!recording.start { finish(it) }) model.say("Recording didn't start.")
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) begin() else model.say("The app isn't allowed to use the microphone. Turn it on in Android's settings.")
    }
    fun press() {
        if (recording.isRecording) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin() else ask.launch(Manifest.permission.RECORD_AUDIO)
    }
    // The box's /voice starts recording.
    LaunchedEffect(start) { if (start > 0) press() }
    Icon(
        if (recording.isRecording) Icons.Filled.Mic else Icons.Outlined.Mic, "Record a voice message",
        Modifier.padding(bottom = 8.dp).size(22.dp).clickable { press() }, tint = if (recording.isRecording) Theme.accent else Theme.muted,
    )
}

/** Records from the microphone at the rate the transcriber hears, keeping the samples, and makes an AAC file of them. */
class Recorder {
    private var record: AudioRecord? = null
    private val out = ByteArrayOutputStream()
    @Volatile private var running = false
    private var thread: Thread? = null
    /** How loud the last tenth of a second was: the root of its mean square, from 0 to 1. */
    @Volatile var level = 0f
        private set

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        val size = maxOf(AudioRecord.getMinBufferSize(Voice.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), 8192)
        val r = runCatching { AudioRecord(MediaRecorder.AudioSource.MIC, Voice.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size) }.getOrNull() ?: return false
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        record = r
        running = true
        r.startRecording()
        thread = Thread {
            // A tenth of a second at a time, so how loud it is now keeps up.
            val buf = ByteArray(Voice.RATE / 10 * 2)
            while (running) {
                val n = r.read(buf, 0, buf.size)
                if (n <= 0) continue
                synchronized(out) { out.write(buf, 0, n) }
                var sum = 0.0
                for (i in 0 until n / 2) {
                    val v = ((buf[2 * i].toInt() and 0xff) or (buf[2 * i + 1].toInt() shl 8)).toShort() / 32768.0
                    sum += v * v
                }
                level = kotlin.math.sqrt(sum / maxOf(1, n / 2)).toFloat()
            }
        }.apply { start() }
        return true
    }

    /** Stops and throws away what was recorded, off the main thread. */
    fun discard() {
        running = false
        val t = thread
        Thread { t?.join(); record?.stop(); record?.release() }.start()
    }

    /** Stops, and the sound as samples from -1 to 1. */
    suspend fun stop(): FloatArray = withContext(Dispatchers.IO) {
        running = false
        thread?.join()
        record?.stop()
        record?.release()
        val bytes = synchronized(out) { out.toByteArray() }
        FloatArray(bytes.size / 2) { i -> ((bytes[2 * i].toInt() and 0xff) or (bytes[2 * i + 1].toInt() shl 8)).toShort() / 32768f }
    }

    companion object {
        /** Samples as an AAC sound in an MP4 file, as the other apps record voice messages. */
        fun m4a(samples: FloatArray, dir: File): ByteArray? = runCatching {
            val file = File(dir, "voice-${System.nanoTime()}.m4a")
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, Voice.RATE, 1).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 48_000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
            }
            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            val muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var track = -1
            var at = 0
            var inputDone = false
            val info = MediaCodec.BufferInfo()
            while (true) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        buf.clear()
                        val n = minOf(buf.capacity() / 2, samples.size - at)
                        for (k in 0 until n) buf.putShort((samples[at + k].coerceIn(-1f, 1f) * 32767).toInt().toShort())
                        val time = at * 1_000_000L / Voice.RATE
                        at += n
                        if (at >= samples.size) { codec.queueInputBuffer(i, 0, n * 2, time, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else codec.queueInputBuffer(i, 0, n * 2, time, 0)
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { track = muxer.addTrack(codec.outputFormat); muxer.start() }
                else if (o >= 0) {
                    val buf = codec.getOutputBuffer(o)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (info.size > 0 && track >= 0) muxer.writeSampleData(track, buf, info)
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
            codec.stop(); codec.release(); muxer.stop(); muxer.release()
            file.readBytes().also { file.delete() }
        }.getOrNull()
    }
}

/**
 * Transcriptions under way, as the web app's `voice.tsx`: a transcription belongs to the app, not to the view that
 * started it, so one that comes back after its box was saved is written into the entry that has it.
 */
object Transcriber {
    /** Finished, and not yet written into an entry, by file ID. */
    private val done = mutableMapOf<String, Voice.Transcript>()
    /** Voice messages being transcribed now, by file ID. */
    val working = androidx.compose.runtime.mutableStateListOf<String>()

    /** A sound file as 16 kHz mono samples, as the model hears it: decoded, its channels mixed, its rate changed. */
    suspend fun samples(file: java.io.File): FloatArray? = withContext(Dispatchers.Default) {
        runCatching {
            val extractor = android.media.MediaExtractor().apply { setDataSource(file.path) }
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(android.media.MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return@runCatching null
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val codec = android.media.MediaCodec.createDecoderByType(format.getString(android.media.MediaFormat.KEY_MIME)!!)
            codec.configure(format, null, null, 0)
            codec.start()
            var rate = format.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
            val pcm = java.io.ByteArrayOutputStream()
            val info = android.media.MediaCodec.BufferInfo()
            var inputDone = false
            while (true) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
                        if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = codec.outputFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
                } else if (o >= 0) {
                    val buf = codec.getOutputBuffer(o)!!
                    val bytes = ByteArray(info.size)
                    buf.position(info.offset); buf.get(bytes)
                    pcm.write(bytes)
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
            codec.stop(); codec.release(); extractor.release()
            val raw = pcm.toByteArray()
            val frames = raw.size / 2 / channels
            val mono = FloatArray(frames) { f ->
                var sum = 0f
                for (c in 0 until channels) { val k = (f * channels + c) * 2; sum += ((raw[k].toInt() and 0xff) or (raw[k + 1].toInt() shl 8)).toShort() / 32768f }
                sum / channels
            }
            if (rate == Voice.RATE) mono
            else FloatArray((mono.size.toLong() * Voice.RATE / rate).toInt()) { i ->
                val at = i.toDouble() * rate / Voice.RATE
                val a = at.toInt().coerceAtMost(mono.size - 1)
                val b = (a + 1).coerceAtMost(mono.size - 1)
                (mono[a] + (mono[b] - mono[a]) * (at - a)).toFloat()
            }
        }.getOrNull()
    }

    fun start(id: String, samples: FloatArray, vaultId: String, model: AppModel) {
        val api = model.api
        if (id !in working) working.add(id)
        model.scope.launch {
            try { run(id, samples, vaultId, model, api) } finally { working.remove(id) }
        }
    }

    private suspend fun run(id: String, samples: FloatArray, vaultId: String, model: AppModel, api: ServerApi) {
        run {
            val cuts = listOf(0) + Voice.cutPoints(samples) + samples.size
            val pieces = mutableListOf<Voice.Piece>()
            for (i in 0 until cuts.size - 1) {
                if (cuts[i] >= cuts[i + 1]) continue
                try {
                    val wav = withContext(Dispatchers.Default) { Voice.wav(samples, cuts[i], cuts[i + 1]) }
                    val r = api.transcribe(vaultId, wav)
                    pieces.add(Voice.Piece(cuts[i].toDouble() / Voice.RATE, r.text, r.language, r.cues))
                } catch (e: ServerApi.TranscribeError) {
                    when (e) {
                        is ServerApi.TranscribeError.Limit -> model.say("That's an hour of voice today. It wasn't transcribed.")
                        is ServerApi.TranscribeError.Offline -> model.say("The voice message will be transcribed when you're online.")
                        else -> {}
                    }
                    return
                }
            }
            done[id] = Voice.join(pieces)
            apply(model)
        }
    }

    /** Writes finished transcripts into the entries that hold their voice messages. */
    fun apply(model: AppModel) {
        for ((id, words) in done.toMap()) {
            val card = model.index.live.firstOrNull { id in Doc.fileIds(it.content) } ?: continue
            if (!model.canEdit(card)) continue
            done.remove(id)
            model.update(card.id) { c -> Voice.withTranscript(c.content, id, words)?.let(c::withContent) ?: c }
        }
    }

    /** A box's nodes with any finished transcripts put on them, before they're saved. */
    fun fill(nodes: List<JsonElement>): List<JsonElement> = nodes.map { node ->
        val id = node["attrs"]["id"].str ?: return@map node
        val words = done.remove(id) ?: return@map node
        Voice.withTranscript(Doc.of(listOf(node)), id, words)?.get("content")?.let { (it as? JsonArray)?.firstOrNull() } ?: node
    }
}
