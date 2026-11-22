package dev.notesapp.app

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
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
 * A voice message (any sound) where it is, as the web app's player: play and pause, its loudness drawn along it, the
 * time, a speed, and its transcript, each sentence pressed to play from there.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VoicePlayer(file: Doc.FileInfo, vaultId: String) {
    val model = LocalModel.current
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var progress by remember { mutableDoubleStateOf(0.0) }
    var rate by remember { mutableFloatStateOf(1f) }
    var showWords by remember { mutableStateOf(true) }
    DisposableEffect(file.id) { onDispose { player?.release(); player = null } }
    LaunchedEffect(playing) {
        while (playing && isActive) {
            player?.let { p -> if (p.duration > 0) progress = p.currentPosition.toDouble() / p.duration }
            delay(100)
        }
    }
    fun speed(p: MediaPlayer) = runCatching { p.playbackParams = p.playbackParams.setSpeed(rate) }
    fun toggle() {
        val p = player
        if (p != null) {
            if (playing) p.pause() else { p.start(); speed(p) }
            playing = !playing
            return
        }
        model.scope.launch {
            val f = Attachments.fileFor(file.id, file.name.ifEmpty { "voice.m4a" }, model) ?: run { model.say("That voice message can't be fetched now."); return@launch }
            val mp = MediaPlayer()
            runCatching {
                mp.setDataSource(f.path)
                mp.prepare()
                mp.setOnCompletionListener { playing = false; progress = 0.0; it.seekTo(0) }
                mp.start()
                speed(mp)
                player = mp
                playing = true
            }.onFailure { mp.release(); model.say("That sound can't be played here.") }
        }
    }
    fun seek(seconds: Double) {
        if (player == null) toggle()
        player?.seekTo((seconds * 1000).toInt())
    }
    val duration = file.duration ?: 0.0
    val current = if (playing || progress > 0) file.cues.indexOfLast { it.start <= progress * duration }.takeIf { it >= 0 } else null
    Column(Modifier.padding(top = 4.dp).clip(RoundedCornerShape(12.dp)).background(Theme.sunken.copy(alpha = 0.5f)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).clip(CircleShape).background(Theme.accent).clickable(onClick = ::toggle), contentAlignment = Alignment.Center) {
                Icon(if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playing) "Pause" else "Play", tint = Theme.onAccent)
            }
            Waveform(file.peaks, progress, Modifier.weight(1f).widthIn(min = 100.dp).height(26.dp))
            Text(Doc.clipLength(duration * if (playing || progress > 0) progress else 1.0), fontSize = 12.sp, color = Theme.muted)
            Text(
                "${if (rate == 1f) "1" else if (rate == 1.5f) "1.5" else "2"}×",
                Modifier.clip(RoundedCornerShape(50)).border(1.dp, Theme.line, RoundedCornerShape(50)).clickable {
                    rate = if (rate == 1f) 1.5f else if (rate == 1.5f) 2f else 1f
                    player?.let { if (playing) speed(it) }
                }.padding(horizontal = 6.dp),
                fontSize = 12.sp, color = Theme.text,
            )
            if (file.transcript != null) Icon(Icons.AutoMirrored.Outlined.Notes, if (showWords) "Hide words" else "Show words", Modifier.size(20.dp).clickable { showWords = !showWords }, tint = Theme.accent)
        }
        val transcript = file.transcript
        if (showWords && !transcript.isNullOrEmpty()) {
            HorizontalDivider(color = Theme.line)
            if (file.cues.isEmpty()) Text(transcript, color = Theme.text)
            else FlowRow {
                file.cues.forEachIndexed { i, cue ->
                    Text(cue.text + " ", Modifier.background(if (i == current) Theme.accentSoft else androidx.compose.ui.graphics.Color.Transparent).clickable { seek(cue.start) }, color = Theme.text)
                }
            }
        }
    }
}

/** A sound's loudness as bars, the part played in the accent color. */
@Composable
fun Waveform(peaks: List<Double>, progress: Double, modifier: Modifier) {
    val accent = Theme.accent
    val muted = Theme.muted.copy(alpha = 0.5f)
    val bars = peaks.ifEmpty { List(40) { 30.0 } }
    Canvas(modifier) {
        val w = size.width / bars.size
        bars.forEachIndexed { i, p ->
            val h = maxOf(2f, size.height * (p / 100).toFloat())
            drawRoundRect(if (i.toDouble() / bars.size < progress) accent else muted, Offset(i * w, (size.height - h) / 2), Size(maxOf(1f, w - 3f), h), CornerRadius(2f, 2f))
        }
    }
}

/**
 * The box's mic: press to record a voice message, press again to stop. It's added to the box like a file, drawn by its
 * loudness, and transcribed by the server once it's up (not in an encrypted vault, whose words never reach it).
 */
@Composable
fun VoiceRecordButton(vaultId: String, add: (JsonElement) -> Unit) {
    val model = LocalModel.current
    val context = LocalContext.current
    var recorder by remember { mutableStateOf<Recorder?>(null) }
    var started by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(recorder) { while (recorder != null) { now = System.currentTimeMillis(); delay(500) } }
    fun begin() {
        val r = Recorder()
        if (!r.start()) { model.say("Recording didn't start."); return }
        recorder = r
        started = System.currentTimeMillis()
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) begin() else model.say("The app isn't allowed to use the microphone. Turn it on in Android's settings.")
    }
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
    val r = recorder
    if (r != null) {
        Row(
            Modifier.padding(bottom = 8.dp).clickable { recorder = null; finish(r) },
            horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.StopCircle, "Stop recording", Modifier.size(22.dp), tint = Theme.alert)
            Text(Doc.clipLength((now - started) / 1000.0), fontSize = 14.sp, color = Theme.alert)
        }
    } else {
        Icon(Icons.Outlined.Mic, "Record a voice message", Modifier.padding(bottom = 8.dp).size(22.dp).clickable {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin() else ask.launch(Manifest.permission.RECORD_AUDIO)
        }, tint = Theme.muted)
    }
}

/** Records from the microphone at the rate the transcriber hears, keeping the samples, and makes an AAC file of them. */
class Recorder {
    private var record: AudioRecord? = null
    private val out = ByteArrayOutputStream()
    @Volatile private var running = false
    private var thread: Thread? = null

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        val size = maxOf(AudioRecord.getMinBufferSize(Voice.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), 8192)
        val r = runCatching { AudioRecord(MediaRecorder.AudioSource.MIC, Voice.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size) }.getOrNull() ?: return false
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        record = r
        running = true
        r.startRecording()
        thread = Thread {
            val buf = ByteArray(size)
            while (running) { val n = r.read(buf, 0, buf.size); if (n > 0) synchronized(out) { out.write(buf, 0, n) } }
        }.apply { start() }
        return true
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

    fun start(id: String, samples: FloatArray, vaultId: String, model: AppModel) {
        val api = model.api
        model.scope.launch {
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
                    return@launch
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
