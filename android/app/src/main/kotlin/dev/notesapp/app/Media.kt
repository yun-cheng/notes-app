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

/** An entry's photos and videos under its text, opening full screen; its other files as chips. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun BubbleAttachments(card: Card) {
    val model = LocalModel.current
    val media = Doc.media(card.content)
    val files = Doc.files(card.content).filter { !it.isVideo }
    var viewing by remember(card.id) { mutableStateOf<String?>(null) }
    var menuFor by remember(card.id) { mutableStateOf<String?>(null) }
    // How photos show: large, small thumbnails, or a count that opens them; each entry can say for itself.
    val style = card.payload["preview"]["photos"].str ?: Settings.photoStyle
    if (media.isNotEmpty() && style == "off") {
        Row(Modifier.padding(top = 4.dp).clickable { viewing = media[0].id }, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.PhotoLibrary, null, Modifier.size(16.dp), tint = Theme.accent)
            Text("${media.size} ${if (media.size == 1) "photo" else "photos"}", color = Theme.accent, fontSize = 15.sp)
        }
    } else if (media.isNotEmpty()) {
        FlowRow(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (m in media) Box {
                PhotoThumb(m, card.vaultId, if (style == "thumbs") 64.dp else if (media.size == 1) 200.dp else 110.dp, Modifier.combinedClickable(onClick = { viewing = m.id }, onLongClick = { menuFor = m.id }))
                DropdownMenu(menuFor == m.id, { menuFor = null }) { PhotoMenu(m.id, card) { menuFor = null } }
            }
        }
    }
    for (file in files) FileChip(file, card.vaultId)
    viewing?.let { MediaViewer(media, it, card.vaultId) { viewing = null } }
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

fun shareFile(context: android.content.Context, file: File, mime: String) {
    val uri = androidx.core.content.FileProvider.getUriForFile(context, "dev.notesapp.notes.files", file)
    val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType(mime).putExtra(android.content.Intent.EXTRA_STREAM, uri).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(android.content.Intent.createChooser(send, null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** An attached file as a chip: a sound plays where it is; anything else opens in the app that reads it. */
@Composable
fun FileChip(file: Doc.FileInfo, vaultId: String) {
    val model = LocalModel.current
    val context = LocalContext.current
    var opening by remember { mutableStateOf(false) }
    if (file.isAudio) { VoicePlayer(file, vaultId); return }
    val m = file.mime ?: ""
    val icon = when {
        m == "application/pdf" -> Icons.Outlined.PictureAsPdf
        m.startsWith("image/") -> Icons.Outlined.Photo
        m.contains("zip") -> Icons.Outlined.FolderZip
        m.contains("sheet") || m.contains("excel") || m.contains("csv") -> Icons.Outlined.TableChart
        else -> Icons.Outlined.Description
    }
    Row(
        Modifier.padding(top = 4.dp).clip(RoundedCornerShape(10.dp)).background(Theme.sunken).clickable {
            opening = true
            model.scope.launch {
                val f = Attachments.fileFor(file.id, file.name, model)
                opening = false
                if (f == null) model.say("That file can't be fetched now.") else Attachments.open(context, f, file.mime)
            }
        }.padding(horizontal = 10.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(16.dp), tint = Theme.text)
        Text(file.name, maxLines = 1, color = Theme.text, fontSize = 15.sp, modifier = Modifier.weight(1f, fill = false))
        file.size?.let { Text(Attachments.size(it), color = Theme.muted, fontSize = 13.sp) }
        if (opening) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
    }
}

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
                Icon(if (mime.startsWith("audio/")) Icons.Outlined.GraphicEq else if (mime.startsWith("video/")) Icons.Outlined.Movie else Icons.Outlined.Description, null, Modifier.size(18.dp), tint = Theme.text)
                Text(node["attrs"]["name"].str ?: "File", fontSize = 10.sp, maxLines = 1, color = Theme.text)
            }
        }
        Icon(Icons.Outlined.Cancel, "Take it out", Modifier.align(Alignment.TopEnd).padding(2.dp).size(18.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.5f)).clickable(onClick = remove), tint = Color.White)
    }
}

/**
 * Photos and files taken out of every entry, at the top of the Trash: each with the entry it was in and the days
 * left, to put back or delete for good.
 */
@Composable
fun TrashedAttachments() {
    val model = LocalModel.current
    val items = AttachmentKeeper.trash.value
    var confirming by remember { mutableStateOf<StoredAttachment?>(null) }
    if (items.isEmpty()) return
    Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Photos and files", fontWeight = FontWeight.SemiBold, color = Theme.text)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (a in items) Column(Modifier.width(120.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (a.isFile) Row(Modifier.size(120.dp, 80.dp).clip(RoundedCornerShape(8.dp)).background(Theme.sunken).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (a.mime.startsWith("video/")) Icons.Outlined.Movie else if (a.mime.startsWith("audio/")) Icons.Outlined.GraphicEq else Icons.Outlined.Description, null, Modifier.size(16.dp), tint = Theme.text)
                    Text(a.name ?: "File", maxLines = 1, fontSize = 13.sp, color = Theme.text)
                } else PhotoThumb(Doc.Media.Photo(a.id), a.vault_id, 120.dp)
                Text(a.trashed_from?.let { model.card(it) }?.let { "From “${it.displayTitle}”" } ?: "From an entry", fontSize = 12.sp, maxLines = 1, color = Theme.text)
                val left = a.daysLeft(System.currentTimeMillis())
                Text(if (left == 0) "Deleted at the next check" else if (left == 1) "1 day left" else "$left days left", fontSize = 11.sp, color = Theme.muted)
                if (model.vault(a.vault_id)?.let { it.role != "viewer" } == true) Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { AttachmentKeeper.putBack(a, model) }) { Text("Restore", fontSize = 13.sp) }
                    Icon(Icons.Outlined.Delete, "Delete for good", Modifier.size(18.dp).clickable { confirming = a }, tint = Theme.alert)
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
