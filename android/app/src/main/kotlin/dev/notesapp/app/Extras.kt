package dev.notesapp.app

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import dev.notesapp.core.Card
import dev.notesapp.core.CardIndex
import dev.notesapp.core.Doc
import dev.notesapp.core.LinkPreview
import dev.notesapp.core.ServerApi
import dev.notesapp.core.get
import dev.notesapp.core.json
import dev.notesapp.core.str
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Link previews kept on the device for a week, as the web app's `useLinkPreview` (a page that gave nothing is asked
 * again after an hour). Links in encrypted vaults are never previewed, so those addresses don't leave the device.
 */
object LinkPreviews {
    @Serializable data class Kept(val preview: LinkPreview? = null, val at: Long)
    private val ser = MapSerializer(String.serializer(), Kept.serializer())
    private var prefs: android.content.SharedPreferences? = null
    private var kept = mutableMapOf<String, Kept>()
    private val asking = mutableSetOf<String>()

    fun init(context: Context) {
        prefs = context.getSharedPreferences("linkPreviews", Context.MODE_PRIVATE)
        kept = prefs?.getString("kept", null)?.let { runCatching { json.decodeFromString(ser, it).toMutableMap() }.getOrNull() } ?: mutableMapOf()
    }

    suspend fun preview(url: String, api: ServerApi): LinkPreview? {
        val now = System.currentTimeMillis()
        kept[url]?.let { k -> if (now - k.at < if (k.preview == null) 3_600_000L else 7 * 86_400_000L) return k.preview }
        if (!asking.add(url)) return null
        try {
            val p = runCatching { api.unfurl(url) }.getOrNull()
            val useful = p?.takeIf { it.title != null || it.description != null || it.image != null }
            kept[url] = Kept(useful, now)
            if (kept.size > 500) kept = kept.filterValues { now - it.at < 7 * 86_400_000L }.toMutableMap()
            prefs?.edit()?.putString("kept", json.encodeToString(ser, kept))?.apply()
            return useful
        } finally {
            asking.remove(url)
        }
    }
}

/**
 * A link as a card opening in the browser, as the web app's `LinkCard`: the page's own title, description and image
 * when it can be previewed, or else its site and path. With `address`, its whole address shows under it, as the Links
 * page has it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LinkCard(url: String, compact: Boolean, preview: Boolean = true, address: Boolean = false) {
    val model = LocalModel.current
    val uri = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    val p by produceState<LinkPreview?>(null, url, preview) { value = if (preview) LinkPreviews.preview(url, model.api) else null }
    var menu by remember { mutableStateOf(false) }
    val path = remember(url) { runCatching { java.net.URI(url).let { (it.path ?: "") + (it.query?.let { q -> "?$q" } ?: "") }.trimEnd('/') }.getOrDefault("") }
    Box {
        val open = Modifier.combinedClickable(onClick = { runCatching { uri.openUri(url) } }, onLongClick = { menu = true })
        if (compact) Row(
            Modifier.clip(RoundedCornerShape(50)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(50)).then(open).padding(horizontal = 10.dp, vertical = 3.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Link, null, Modifier.size(14.dp), tint = Theme.muted)
            Text(p?.title ?: (Doc.siteName(url) + path), maxLines = 1, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Theme.text)
            if (p?.title != null) Text(p?.site ?: Doc.siteName(url), maxLines = 1, fontSize = 12.sp, color = Theme.muted)
        } else {
            val rich = p?.title != null
            Row(
                Modifier.widthIn(max = 440.dp).clip(RoundedCornerShape(12.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(12.dp)).then(open)
                    .padding(if (rich) PaddingValues(8.dp) else PaddingValues(start = 9.dp, end = 12.dp, top = 7.dp, bottom = 7.dp)),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = if (rich) Alignment.Top else Alignment.CenterVertically,
            ) {
                val src = p?.image
                val image by produceState<ImageBitmap?>(null, src) { value = src?.let { WebImages.load(it) } }
                val img = image
                if (img != null) Image(img, null, Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                else Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Theme.sunken), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Link, null, Modifier.size(16.dp), tint = Theme.muted) }
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    p?.title?.let { Text(it, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, color = Theme.text) }
                    p?.description?.let { Text(it, fontSize = 12.sp, color = Theme.muted, maxLines = 2) }
                    if (!address || !rich) Text(p?.site ?: Doc.siteName(url), fontSize = if (rich) 11.sp else 13.sp, fontWeight = if (rich) FontWeight.Medium else FontWeight.SemiBold, color = if (rich) Theme.muted else Theme.text)
                    if (address) Text(runCatching { java.net.URLDecoder.decode(url, "UTF-8") }.getOrDefault(url), fontSize = 12.sp, color = Theme.accent, maxLines = 2)
                    else if (path.isNotEmpty() && !rich) Text(path, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
                }
            }
        }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(text = { Text("Open link") }, onClick = { menu = false; runCatching { uri.openUri(url) } })
            DropdownMenuItem(text = { Text("Copy link address") }, onClick = { menu = false; clipboard.setText(AnnotatedString(url)) })
        }
    }
}

/**
 * Translating an entry's words, shown in its bubble, as the web app's `translate.ts`: by the server, which reads a whole
 * note better, except in an encrypted vault, whose words never go there; on the device where the server can't
 * (offline, or the day's translations used up). Into this device's language, or into English when it's in that.
 */
object Translations {
    data class Kept(val source: String, val pieces: List<String>, val from: String, val to: String, val shown: Boolean = true)

    sealed class State {
        data object Working : State()
        data class Done(val kept: Kept) : State() {
            val to get() = kept.to
            val shown get() = kept.shown
        }
    }

    val states = mutableStateMapOf<String, State>()

    /** The language to translate into: this device's, as the translators name it. */
    val deviceLanguage: String
        get() {
            val l = Locale.getDefault()
            if (l.language == "zh" && (l.script == "Hant" || l.country in setOf("TW", "HK", "MO"))) return "zh-Hant"
            return l.language.ifEmpty { "en" }
        }

    /** The pieces of an entry a translation covers: its title, then its lines. */
    fun pieces(card: Card, index: CardIndex) = listOf(card.title) + Doc.previewLines(card.content, index.titleOf)

    fun translate(card: Card, model: AppModel) {
        val pieces = pieces(card, model.index)
        states[card.id] = State.Working
        val encrypted = model.vault(card.vaultId)?.isEncrypted == true
        val mine = deviceLanguage
        model.scope.launch {
            if (!encrypted) when (val r = model.api.translate(card.id, pieces, mine, if (mine == "en") null else "en")) {
                is ServerApi.Translated.Done -> { states[card.id] = State.Done(Kept(pieces.joinToString("\n"), r.pieces, r.from, r.to)); return@launch }
                is ServerApi.Translated.Same -> { states.remove(card.id); model.say("It's in your language already."); return@launch }
                else -> {}
            }
            // On this device, where the words stay.
            val done = onDevice(pieces, mine)
            if (done != null) states[card.id] = State.Done(Kept(pieces.joinToString("\n"), done.first, done.second, mine))
            else { states.remove(card.id); model.say("This device can't translate it.") }
        }
    }

    /** Each piece through the translator on this device, and the language they were in. */
    private suspend fun onDevice(pieces: List<String>, to: String): Pair<List<String>, String>? {
        val text = pieces.joinToString("\n")
        val from = suspendCancellableCoroutine<String?> { c ->
            LanguageIdentification.getClient().identifyLanguage(text).addOnSuccessListener { c.resume(it.takeIf { l -> l != "und" }) }.addOnFailureListener { c.resume(null) }
        } ?: return null
        val source = TranslateLanguage.fromLanguageTag(from) ?: return null
        val target = TranslateLanguage.fromLanguageTag(to.substringBefore("-")) ?: return null
        if (source == target) return null
        val translator = Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build())
        try {
            val ready = suspendCancellableCoroutine<Boolean> { c -> translator.downloadModelIfNeeded().addOnSuccessListener { c.resume(true) }.addOnFailureListener { c.resume(false) } }
            if (!ready) return null
            val out = pieces.map { piece ->
                if (piece.isBlank()) piece else suspendCancellableCoroutine<String?> { c -> translator.translate(piece).addOnSuccessListener { c.resume(it) }.addOnFailureListener { c.resume(null) } } ?: return null
            }
            return out to from
        } finally {
            translator.close()
        }
    }

    fun show(id: String, shown: Boolean) {
        val s = states[id] as? State.Done ?: return
        states[id] = State.Done(s.kept.copy(shown = shown))
    }
}

/** An entry's translation under it, with Show original and Save as a page. */
@Composable
fun BubbleTranslation(card: Card) {
    val model = LocalModel.current
    when (val s = Translations.states[card.id]) {
        Translations.State.Working -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
            Text("Translating…", fontSize = 12.sp, color = Theme.muted)
        }
        // Its words show in the bubble's place; above them, as the web's, where they're from, or a way back to them.
        is Translations.State.Done -> if (s.kept.shown) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("From ${Locale.forLanguageTag(s.kept.from).displayLanguage.ifEmpty { s.kept.from }}", fontSize = 12.sp, color = Theme.muted)
            Text("Show original", Modifier.clickable { Translations.show(card.id, false) }, fontSize = 12.sp, color = Theme.accent)
            if (model.canEdit(card)) Text("Save as a page", Modifier.clickable {
                // The translation as a page of its own.
                val doc = Doc.fromText(s.kept.pieces.filter { it.isNotBlank() }.joinToString("\n"))
                model.update(card.id) { c -> c.withMorePages(c.morePages.filter { p -> !Doc.isBlank(p) } + doc) }
                model.say("Saved as page ${card.turnPages.size + 2}", undoable = true)
            }, fontSize = 12.sp, color = Theme.accent)
        } else Text(
            "Show in ${Locale.forLanguageTag(s.kept.to).displayLanguage.ifEmpty { s.kept.to }}", Modifier.clickable { Translations.show(card.id, true) },
            fontSize = 12.sp, color = Theme.accent,
        )
        null -> {}
    }
}
