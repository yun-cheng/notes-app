package dev.notesapp.app

import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.notesapp.core.Card
import dev.notesapp.core.Doc
import dev.notesapp.core.StoredAttachment
import dev.notesapp.core.get
import dev.notesapp.core.str
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.io.File

/** A photo, or a video's still, as a square thumbnail. */
@Composable
fun PhotoThumb(media: Doc.Media, vaultId: String, size: Dp, modifier: Modifier = Modifier) {
    val model = LocalModel.current
    val id = when (media) { is Doc.Media.Photo -> media.id; is Doc.Media.Video -> media.file.poster ?: Doc.posterId(media.file.id) }
    val px = with(androidx.compose.ui.platform.LocalDensity.current) { size.roundToPx() * 2 }
    val image by produceState<android.graphics.Bitmap?>(null, id) { value = Attachments.bitmap(id, model, maxOf(256, px)) }
    Box(modifier.size(size).clip(RoundedCornerShape(6.dp)).background(Theme.sunken), contentAlignment = Alignment.Center) {
        val b = image
        if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(if (model.vault(vaultId)?.isEncrypted == true) Icons.Outlined.Lock else Icons.Outlined.Photo, null, tint = Theme.muted)
        if (media is Doc.Media.Video) {
            Icon(Icons.Outlined.PlayCircle, "Video", Modifier.size(32.dp), tint = Color.White)
            media.file.duration?.let { d ->
                Text(Doc.clipLength(d), Modifier.align(Alignment.BottomEnd).padding(4.dp).background(Color.Black.copy(alpha = 0.5f)).padding(3.dp), color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/**
 * An entry's photos, videos, voice messages, files and web links, under its bubble, as the web app's `Attachments`:
 * photos and videos whole at their own shapes (large, as thumbnails, or as a count, by the device's setting or the
 * entry's own), four at most with the rest counted on the last; voice messages playing where they are; files as chips;
 * links as cards.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun EntryAttachments(card: Card) {
    val model = LocalModel.current
    val media = remember(card.id, card.updatedAt) { Doc.media(card.content) }
    val all = remember(card.id, card.updatedAt) { Doc.files(card.content).filter { !it.isVideo } }
    val voices = all.filter { it.isAudio }
    val files = all.filter { !it.isAudio }
    val links = remember(card.id, card.updatedAt) { Doc.linkUrls(card.content).filter { !Doc.isImageUrl(it) } }
    val linkStyle = card.payload["preview"]["links"].str ?: Settings.linkStyle
    var viewing by remember(card.id) { mutableStateOf<String?>(null) }
    var menuFor by remember(card.id) { mutableStateOf<String?>(null) }
    val style = card.payload["preview"]["photos"].str ?: Settings.photoStyle
    if (media.isEmpty() && all.isEmpty() && (links.isEmpty() || linkStyle == "off")) return
    Column(Modifier.widthIn(max = 560.dp).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (media.isNotEmpty() && style == "off") {
            Row(
                Modifier.clip(RoundedCornerShape(50)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(50)).clickable { viewing = media[0].id }.padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (media.all { it is Doc.Media.Video }) Icons.Outlined.Videocam else Icons.Outlined.Photo, null, Modifier.size(16.dp), tint = Theme.muted)
                Text(mediaCount(media), color = Theme.muted, fontSize = 13.sp)
            }
        } else if (media.isNotEmpty()) {
            val height = if (style == "thumbs") 120.dp else 180.dp
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                media.take(MAX_PHOTOS).forEachIndexed { i, m ->
                    Box {
                        ShapedThumb(
                            m, card.vaultId, height, alone = media.size == 1 && style != "thumbs", more = if (i == MAX_PHOTOS - 1) media.size - MAX_PHOTOS else 0,
                            modifier = Modifier.combinedClickable(onClick = { viewing = m.id }, onLongClick = { menuFor = m.id }),
                        )
                        DropdownMenu(menuFor == m.id, { menuFor = null }) { PhotoMenu(m.id, card) { menuFor = null } }
                    }
                }
            }
        }
        for (v in voices) VoicePlayer(v, card.vaultId, card)
        for (f in files) FileChip(f, card.vaultId)
        if (linkStyle != "off") {
            val preview = model.vault(card.vaultId)?.isEncrypted == false
            for (url in links.take(3)) LinkCard(url, linkStyle == "compact", preview)
            if (links.size > 3) Text("and ${links.size - 3} more links", color = Theme.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
        }
    }
    viewing?.let { MediaViewer(media, it, card.vaultId) { viewing = null } }
}

const val MAX_PHOTOS = 4

/** "3 photos", "1 video", "2 photos and 1 video". */
fun mediaCount(items: List<Doc.Media>): String {
    val videos = items.count { it is Doc.Media.Video }
    val photos = items.size - videos
    fun say(n: Int, one: String) = if (n == 1) "1 $one" else "$n ${one}s"
    return if (photos > 0 && videos > 0) "${say(photos, "photo")} and ${say(videos, "video")}" else if (videos > 0) say(videos, "video") else say(photos, "photo")
}

/**
 * A photo, or a video's still, whole at its own shape, a row's height tall (a lone one larger), as the web's `.thumb`;
 * a video marked with its length, and the last of a row with how many more there are.
 */
@Composable
fun ShapedThumb(media: Doc.Media, vaultId: String, height: Dp, alone: Boolean = false, more: Int = 0, modifier: Modifier = Modifier) {
    val model = LocalModel.current
    val id = when (media) { is Doc.Media.Photo -> media.id; is Doc.Media.Video -> media.file.poster ?: Doc.posterId(media.file.id) }
    val image by produceState<android.graphics.Bitmap?>(null, id) { value = Attachments.bitmap(id, model, 1200) }
    val b = image
    val aspect = when {
        b != null && b.height > 0 -> b.width.toFloat() / b.height
        media is Doc.Media.Video && (media.file.height ?: 0.0) > 0 -> (media.file.width ?: 1.0).toFloat() / media.file.height!!.toFloat()
        else -> 1f
    }
    val tall = if (alone) minOf(360.dp, 320.dp / maxOf(aspect, 0.3f)) else height
    val wide = (tall * aspect).coerceIn(96.dp, if (alone) 340.dp else 300.dp)
    Box(modifier.size(wide, tall).clip(RoundedCornerShape(12.dp)).background(Theme.sunken).border(1.dp, Theme.line, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
        if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        else Icon(if (model.vault(vaultId)?.isEncrypted == true) Icons.Outlined.Lock else Icons.Outlined.Photo, null, tint = Theme.muted)
        if (more > 0) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) { Text("+$more", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
        } else if (media is Doc.Media.Video) VideoMark(media.file.duration, Modifier.align(Alignment.TopEnd))
    }
}

/** A video's length with a play mark, in a dark pill in a corner of its still, as the web's `VideoMark`. */
@Composable
fun VideoMark(duration: Double?, modifier: Modifier = Modifier) {
    Row(
        modifier.padding(6.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 7.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        duration?.let { Text(Doc.clipLength(it), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
        Icon(Icons.Outlined.PlayArrow, null, Modifier.size(12.dp), tint = Color.White)
    }
}

/** A photo's menu: copy it, open its entry, show it in the journal, share it by its Drive link. */
@Composable
fun PhotoMenu(id: String, card: Card, close: () -> Unit) {
    val model = LocalModel.current
    val context = LocalContext.current
    DropdownMenuItem(text = { Text("Share photo") }, onClick = {
        close()
        model.scope.launch { Attachments.fileFor(id, "photo.jpg", model)?.let { shareFile(context, it, "image/*") } }
    })
    DropdownMenuItem(text = { Text("Open entry") }, onClick = { close(); model.openEntry = card.id })
    DropdownMenuItem(text = { Text("Show in journal") }, onClick = { close(); model.page = Page.Journal(); model.lastSaved = card.id })
    PublicLinkMenu(id, card.vaultId, close)
}

fun shareFile(context: android.content.Context, file: File, mime: String) = shareFiles(context, listOf(file), mime)

/**
 * An attached file as a chip, as the web app's: its kind, name, and size with its extension; pressing it opens it in
 * the app that reads it, the share button shares it by a public link (in a vault that can), and the arrow saves a copy
 * to Downloads. A sound plays where it is instead.
 */
@Composable
fun FileChip(file: Doc.FileInfo, vaultId: String) {
    val model = LocalModel.current
    val context = LocalContext.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var opening by remember { mutableStateOf(false) }
    if (file.isAudio) { VoicePlayer(file, vaultId); return }
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.widthIn(max = 360.dp).clip(shape).background(Theme.surface).border(1.dp, Theme.line, shape), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f, fill = false).clickable {
                opening = true
                model.scope.launch {
                    val f = Attachments.fileFor(file.id, file.name, model)
                    opening = false
                    if (f == null) model.say("That file can't be fetched now.") else Attachments.open(context, f, file.mime)
                }
            }.padding(start = 8.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Theme.sunken), contentAlignment = Alignment.Center) { Icon(fileIcon(file.mime), null, Modifier.size(16.dp), tint = Theme.muted) }
            Column {
                Text(file.name, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, color = Theme.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(fileDetail(file.size, file.name), color = Theme.muted, fontSize = 12.sp)
            }
            if (opening) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        }
        if (model.vault(vaultId)?.let { it.role != "viewer" && !it.isEncrypted } == true) {
            Icon(Icons.Outlined.Share, "Share ${file.name} via a public link", Modifier.size(36.dp, 40.dp).clickable {
                model.scope.launch { model.api.shareDriveLink(file.id).fold({ clipboard.setText(androidx.compose.ui.text.AnnotatedString(it)); model.say("Public link copied") }, { model.say(it.message ?: "It couldn't be shared. Try again.") }) }
            }.padding(10.dp), tint = Theme.muted)
        }
        Icon(Icons.Outlined.Download, "Download ${file.name}", Modifier.size(36.dp, 40.dp).clickable {
            model.scope.launch {
                val f = Attachments.fileFor(file.id, file.name, model) ?: run { model.say("That file can't be fetched now."); return@launch }
                model.say(if (Attachments.saveToDownloads(context, f, file.name, file.mime)) "Saved to Downloads" else "It couldn't be saved.")
            }
        }.padding(10.dp), tint = Theme.muted)
    }
}

/** "150 B · TXT", as the web's chip. */
fun fileDetail(size: Long?, name: String): String = listOfNotNull(size?.let(::fileSize), extensionLabel(name)).joinToString(" · ")

/** A file's size as the web app writes it: "150 B", "12 KB", "3.4 MB", "1.2 GB". */
fun fileSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${Math.round(bytes / 1024.0)} KB"
    bytes >= 1024L * 1024 * 1024 -> "${Math.round(bytes / 1073741824.0 * 10) / 10.0} GB".replace(".0 GB", " GB")
    else -> (bytes / 1048576.0).let { if (it < 10) String.format(java.util.Locale.US, "%.1f MB", it) else "${Math.round(it)} MB" }
}

/** A file's extension in capitals, "PDF", or "File". */
fun extensionLabel(name: String): String = Regex("\\.([A-Za-z0-9]{1,5})$").find(name)?.groupValues?.get(1)?.uppercase() ?: "File"

/** Photos and videos full screen, paged through, a photo zoomed with a pinch or a double tap. */
@Composable
fun MediaViewer(media: List<Doc.Media>, start: String, vaultId: String, dismiss: () -> Unit) {
    val pager = rememberPagerState(maxOf(0, media.indexOfFirst { it.id == start })) { media.size }
    androidx.compose.ui.window.Dialog(dismiss, androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { i -> MediaPage(media[i], vaultId) }
            Text(
                "Done", Modifier.align(Alignment.TopEnd).padding(top = statusBarTop() + 8.dp, end = 16.dp).clickable(onClick = dismiss).padding(8.dp),
                color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
            )
            if (media.size > 1) Text("${pager.currentPage + 1} / ${media.size}", Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp), color = Color.White.copy(alpha = 0.8f))
        }
    }
}

@Composable
private fun MediaPage(media: Doc.Media, vaultId: String) {
    val model = LocalModel.current
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when (media) {
            is Doc.Media.Photo -> {
                val image by produceState<android.graphics.Bitmap?>(null, media.id) { value = Attachments.bitmap(media.id, model, 2048) }
                var scale by remember { mutableFloatStateOf(1f) }
                var offset by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
                val state = rememberTransformableState { zoom, pan, _ -> scale = (scale * zoom).coerceIn(1f, 5f); offset = if (scale > 1f) offset + pan else androidx.compose.ui.geometry.Offset.Zero }
                val b = image
                if (b == null) CircularProgressIndicator(color = Color.White)
                else Image(
                    b.asImageBitmap(), null,
                    Modifier.fillMaxSize().transformable(state, canPan = { scale > 1f })
                        .pointerInput(Unit) { detectTapGestures(onDoubleTap = { scale = if (scale > 1f) 1f else 2.5f; offset = androidx.compose.ui.geometry.Offset.Zero }) }
                        .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
                    contentScale = ContentScale.Fit,
                )
            }
            is Doc.Media.Video -> {
                val file by produceState<File?>(null, media.id) { value = Attachments.fileFor(media.file.id, media.file.name, model) }
                val f = file
                if (f == null) CircularProgressIndicator(color = Color.White)
                else AndroidView({ c -> VideoView(c).apply { setMediaController(MediaController(c).also { it.setAnchorView(this) }); setVideoPath(f.path); start() } }, Modifier.fillMaxSize(), onRelease = { it.stopPlayback() })
            }
        }
    }
}

/** A photo or file added to the box, before it's saved, with an × to take it out. */
@Composable
fun AttachedThumb(node: JsonElement, vaultId: String, remove: () -> Unit) {
    Box {
        val id = node["attrs"]["id"].str
        if (node["type"].str == "photo" && id != null) PhotoThumb(Doc.Media.Photo(id), vaultId, 56.dp)
        else {
            val mime = node["attrs"]["mime"].str ?: ""
            Column(Modifier.size(width = 76.dp, height = 56.dp).clip(RoundedCornerShape(6.dp)).background(Theme.sunken).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(fileIcon(mime), null, Modifier.size(18.dp), tint = Theme.text)
                Text(node["attrs"]["name"].str ?: "File", fontSize = 10.sp, maxLines = 1, color = Theme.text)
            }
        }
        Icon(Icons.Outlined.Cancel, "Take it out", Modifier.align(Alignment.TopEnd).padding(2.dp).size(18.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.5f)).clickable(onClick = remove), tint = Color.White)
    }
}

/**
 * Photos, videos and files taken out of every entry, at the top of the Trash, as the web's: each with the entry it was
 * in and the days left before it's deleted, from Google Drive too, to put back or delete for good. A video's still goes
 * where the video goes, so it isn't listed on its own. `vaultId` narrows it to one vault.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TrashedAttachments(vaultId: String? = null) {
    val model = LocalModel.current
    val all = AttachmentKeeper.trash.value
    var confirming by remember { mutableStateOf<StoredAttachment?>(null) }
    val items = all.filter { (vaultId == null || it.vault_id == vaultId) && !it.id.endsWith("-poster") }
    val shown = items.filter { !it.isFile || it.mime.startsWith("video/") } + items.filter { it.isFile && !it.mime.startsWith("video/") }
    if (shown.isEmpty()) return
    Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Photos and files", fontWeight = FontWeight.SemiBold, color = Theme.text, fontSize = 17.sp)
        Text("Taken out of their entries. Each is deleted for good ${StoredAttachment.TRASH_DAYS} days after, from Google Drive too.", fontSize = 13.sp, color = Theme.muted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for (a in shown) Column(Modifier.width(150.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(8.dp)).background(Theme.sunken)) {
                    when {
                        a.mime.startsWith("video/") -> {
                            val still = Doc.posterId(a.id).takeIf { id -> all.any { it.id == id } } ?: a.id
                            FillThumb(Doc.Media.Photo(still), a.vault_id, Modifier.fillMaxSize())
                            VideoMark(a.duration, Modifier.align(Alignment.TopEnd))
                        }
                        a.isFile -> Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
                            Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Theme.surface), contentAlignment = Alignment.Center) { Icon(fileIcon(a.mime), null, Modifier.size(16.dp), tint = Theme.muted) }
                            Spacer(Modifier.weight(1f))
                            Text(a.name ?: "File", maxLines = 2, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Theme.text)
                            Text(fileDetail(a.size, a.name ?: ""), fontSize = 12.sp, color = Theme.muted)
                        }
                        else -> FillThumb(Doc.Media.Photo(a.id), a.vault_id, Modifier.fillMaxSize())
                    }
                }
                Text(a.trashed_from?.let { model.card(it) }?.let { "From “${it.displayTitle}”" } ?: "From an entry", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, color = Theme.text)
                val left = a.daysLeft(System.currentTimeMillis())
                Text(if (left == 0) "Deleted at the next check" else if (left == 1) "1 day left" else "$left days left", fontSize = 12.sp, color = Theme.muted)
                if (model.vault(a.vault_id)?.let { it.role != "viewer" } == true) Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.OutlinedButton(onClick = { AttachmentKeeper.putBack(a, model) }) { Text("Restore", fontSize = 13.sp) }
                    Icon(Icons.Outlined.Delete, "Delete for good", Modifier.padding(start = 4.dp).size(20.dp).clickable { confirming = a }, tint = Theme.muted)
                }
            }
        }
    }
    confirming?.let { a ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            title = { Text("Delete it for good?") },
            text = { Text("It's deleted from Google Drive too, and can't be undone.") },
            confirmButton = { TextButton(onClick = { confirming = null; AttachmentKeeper.deleteForGood(a, model) }) { Text("Delete for good", color = Theme.alert) } },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text("Cancel") } },
        )
    }
}

/** The icon a file is shown with, the same everywhere it shows. */
fun fileIcon(mime: String?): androidx.compose.ui.graphics.vector.ImageVector {
    val m = mime ?: ""
    return when {
        m.startsWith("video/") -> Icons.Outlined.Movie
        m.startsWith("audio/") -> Icons.Outlined.GraphicEq
        m.startsWith("image/") -> Icons.Outlined.Photo
        m == "application/pdf" -> Icons.Outlined.PictureAsPdf
        m.contains("zip") -> Icons.Outlined.FolderZip
        m.contains("sheet") || m.contains("excel") || m.contains("csv") -> Icons.Outlined.TableChart
        else -> Icons.Outlined.Description
    }
}
