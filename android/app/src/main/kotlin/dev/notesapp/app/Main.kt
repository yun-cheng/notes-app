package dev.notesapp.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Account
import dev.notesapp.core.Card
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.SyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URI
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.material.icons.outlined.Menu

@Composable
fun Root() {
    val model = LocalModel.current
    Box(Modifier.fillMaxSize().background(Theme.bg)) {
        when (model.phase) {
            AppModel.Phase.loading -> {}
            AppModel.Phase.signedOut -> SignInView()
            AppModel.Phase.signedIn -> if (model.addingAccount) SignInView() else androidx.compose.foundation.layout.BoxWithConstraints {
                // A tablet or an unfolded phone shows the sidebar beside the page, as the web app does on a wide screen.
                if (maxWidth >= 840.dp) WideFrame() else PhoneFrame()
            }
        }
    }
}

/** The phone's frame, as the web app's: tabs (Journal, Today, Calendar, Search), with the sidebar in a drawer. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun PhoneFrame() {
    val model = LocalModel.current
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(0) }
    val openDrawer: (() -> Unit)? = { scope.launch { drawer.open() } }
    // A page picked from another tab (a day on the calendar, a tag in a result) shows in the Journal tab.
    var shownPage by remember { mutableStateOf(model.page) }
    if (model.page != shownPage) { shownPage = model.page; tab = 0 }
    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(!drawer.isOpen && tab == 0 && model.page != Page.Journal()) { model.page = Page.Journal() }

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = Theme.bg, modifier = Modifier.widthIn(max = 320.dp)) {
                Sidebar(onPick = { tab = 0; scope.launch { drawer.close() } })
            }
        },
    ) {
        Column(Modifier.fillMaxSize().background(Theme.bg)) {
            Box(Modifier.weight(1f)) {
                when (tab) {
                    0 -> PageView(model.page, openDrawer)
                    1 -> JournalView(StreamFilter(status = StreamFilter.TodoStatus.today), openDrawer, fixed = true)
                    2 -> CalendarPage(openDrawer)
                    else -> SearchPage(openDrawer)
                }
                ToastView(Modifier.align(Alignment.BottomCenter))
            }
            // The keyboard takes the tabs' place while it's up.
            if (!androidx.compose.foundation.layout.WindowInsets.isImeVisible) NavigationBar(containerColor = Theme.surface, tonalElevation = 0.dp) {
                val items = listOf("journal", "today", "calendar", "search").map { destination(it).let { d -> d.title to d.icon } }
                items.forEachIndexed { i, (label, icon) ->
                    NavigationBarItem(
                        selected = tab == i, onClick = { if (tab == i && i == 0) model.page = Page.Journal(); tab = i },
                        icon = { Icon(icon, null) }, label = { Text(label) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = Theme.accent, selectedTextColor = Theme.accent, indicatorColor = Theme.accentSoft, unselectedIconColor = Theme.muted, unselectedTextColor = Theme.muted),
                    )
                }
            }
        }
    }
    model.openEntry?.let { EntrySheet(it) { model.openEntry = null } }
    model.panel?.let { EntryPanelView(it) { model.panel = null } }
}

/** A wide screen's frame: the sidebar always beside the page, as the web app's. */
@Composable
fun WideFrame() {
    val model = LocalModel.current
    Row(Modifier.fillMaxSize().background(Theme.bg).navigationBarsPadding()) {
        Box(Modifier.width(280.dp).fillMaxSize().padding(top = statusBarTop())) { Sidebar(onPick = {}) }
        androidx.compose.material3.VerticalDivider(color = Theme.line)
        Box(Modifier.weight(1f)) {
            PageView(model.page, null)
            ToastView(Modifier.align(Alignment.BottomCenter))
        }
    }
    model.openEntry?.let { EntrySheet(it) { model.openEntry = null } }
    model.panel?.let { EntryPanelView(it) { model.panel = null } }
}

/** The page the main column shows. */
@Composable
fun PageView(page: Page, openDrawer: (() -> Unit)?) {
    when (page) {
        is Page.Journal -> androidx.compose.runtime.key(page.filter) { JournalView(page.filter, openDrawer) }
        Page.Trash -> TrashPage(openDrawer)
        Page.History -> HistoryPage(openDrawer)
        Page.Calendar -> CalendarPage(openDrawer)
        Page.Timeline -> TimelinePage(openDrawer)
        Page.Photos -> PhotosPage(openDrawer)
        Page.Links -> LinksPage(openDrawer)
        Page.Files -> FilesPage(openDrawer)
        Page.Tags -> TagsPage(openDrawer)
        Page.Vaults -> VaultsPage(openDrawer)
        Page.Settings -> SettingsPage(openDrawer)
        Page.Search -> SearchPage(openDrawer)
    }
}

/** A page to go to by name, with its icon. `listed` ones are in the sidebar's list of pages. */
class Destination(val key: String, val title: String, val icon: ImageVector, val page: Page, val listed: Boolean = true)

/** Every page with a name, in the sidebar's order: the sidebar, the phone's tabs and the drawer all take them from here. */
val destinations = listOf(
    Destination("journal", "Journal", Icons.AutoMirrored.Outlined.Article, Page.Journal()),
    Destination("today", "Today", Icons.Outlined.WbSunny, Page.Journal(StreamFilter(status = StreamFilter.TodoStatus.today)), listed = false),
    Destination("history", "History", Icons.Outlined.History, Page.History),
    Destination("calendar", "Calendar", Icons.Outlined.CalendarMonth, Page.Calendar),
    Destination("timeline", "Timeline", Icons.Outlined.Timeline, Page.Timeline),
    Destination("photos", "Photos", Icons.Outlined.Photo, Page.Photos),
    Destination("links", "Links", Icons.Outlined.Link, Page.Links),
    Destination("files", "Files", Icons.Outlined.InsertDriveFile, Page.Files),
    Destination("archive", "Archive", Icons.Outlined.Archive, Page.Journal(StreamFilter(archived = true))),
    Destination("trash", "Trash", Icons.Outlined.Delete, Page.Trash),
    Destination("tags", "All tags", Icons.Outlined.Label, Page.Tags, listed = false),
    Destination("vaults", "Manage vaults", Icons.Outlined.Layers, Page.Vaults, listed = false),
    Destination("settings", "Backup & settings", Icons.Outlined.Tune, Page.Settings, listed = false),
    Destination("search", "Search", Icons.Outlined.Search, Page.Search, listed = false),
)

fun destination(key: String) = destinations.first { it.key == key }

/**
 * The sidebar, as the web app's: New note, the pages, tag groups with their tags, other tags, vaults, and the account
 * at the foot.
 */
@Composable
fun Sidebar(onPick: () -> Unit) {
    val model = LocalModel.current
    val index = model.index
    fun go(p: Page) { model.page = p; onPick() }
    val filter = (model.page as? Page.Journal)?.filter
    val archived = index.live.count { it.isEntry && it.archived }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).padding(horizontal = 10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp)) {
            item {
                Text("Notes", Modifier.padding(start = 10.dp, bottom = 10.dp), fontFamily = Theme.titleFont, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, color = Theme.text)
                Button(onClick = { go(Page.Journal()); model.focusBox++ }, Modifier.fillMaxWidth().padding(bottom = 8.dp)) { Text("New note") }
            }
            items(destinations.filter { it.listed }, key = { "p:${it.key}" }) { d ->
                when (d.key) {
                    // The Archive is the journal narrowed to archived entries, whatever else it's narrowed by.
                    "archive" -> SideRow(d.title, d.icon, filter?.archived == true, archived) { go(d.page) }
                    "trash" -> SideRow(d.title, d.icon, model.page == d.page, index.trash.size) { go(d.page) }
                    else -> SideRow(d.title, d.icon, model.page == d.page) { go(d.page) }
                }
            }
            for (group in index.tagGroups.groups) {
                item { SideHeader(group.title) }
                items(group.members, key = { "g${group.id}:${it.id}" }) { tag -> TagRow(tag, filter?.tagId == tag.id) { go(Page.Journal(StreamFilter(tagId = tag.id))) } }
            }
            // As the web's: pinned tags outside a group, and the one the journal is narrowed to.
            item { SideHeader("Tags") }
            val pinned = index.pinnedTags.filter { index.tagGroups.groupOf[it.id] == null }
            val narrowedTo = filter?.tagId
            val tagsShown = if (narrowedTo == null || pinned.any { it.id == narrowedTo } || index.tagGroups.groupOf[narrowedTo] != null) pinned else pinned + index.tags.filter { it.id == narrowedTo }
            items(tagsShown, key = { "t:${it.id}" }) { tag -> TagRow(tag, filter?.tagId == tag.id) { go(Page.Journal(StreamFilter(tagId = tag.id))) } }
            item { destination("tags").let { d -> SideRow(d.title, null, model.page == d.page, quiet = true) { go(d.page) } } }
            item { SideHeader("Vaults") }
            // A hidden vault stays out of the app until its PIN is entered; a lone vault isn't listed.
            val vaultsShown = model.vaults.filter { !it.hidden || it.id in model.openVaults }
            if (vaultsShown.size > 1) items(vaultsShown, key = { "v:${it.id}" }) { vault ->
                SideRow(vault.name, if (vault.id in model.lockedVaults) Icons.Outlined.Lock else null, filter?.vaultId == vault.id) { go(Page.Journal(StreamFilter(vaultId = vault.id))) }
            }
            item { destination("vaults").let { d -> SideRow(d.title, null, model.page == d.page, quiet = true) { go(d.page) } } }
        }
        HorizontalDivider(color = Theme.line)
        destination("settings").let { d -> Box(Modifier.padding(horizontal = 10.dp, vertical = 4.dp)) { SideRow(d.title, d.icon, model.page == d.page) { go(d.page) } } }
        HorizontalDivider(color = Theme.line)
        AccountBadge(onPick)
    }
}

@Composable
private fun TagRow(tag: Card, selected: Boolean, onClick: () -> Unit) {
    val model = LocalModel.current
    // Every entry it's on, archived and templates too, as the web counts.
    val count = model.index.backlinks[tag.id]?.count { it.kind == dev.notesapp.core.Backlink.Kind.tag } ?: 0
    SideRow(tag.displayTitle, Icons.Outlined.Label, selected, count, tint = tag.color?.let { Theme.tint(it) }, onClick = onClick)
}

@Composable
fun SideHeader(text: String) {
    Text(text, Modifier.padding(start = 10.dp, top = 16.dp, bottom = 4.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
}

@Composable
fun SideRow(title: String, icon: ImageVector?, selected: Boolean, count: Int? = null, quiet: Boolean = false, tint: Color? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (selected) Theme.accentSoft else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // No icon lines the name up with those above it; a quiet link, All tags or Manage vaults, is fainter.
        if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = tint ?: if (selected) Theme.accent else Theme.muted) else Spacer(Modifier.width(20.dp))
        Text(title, Modifier.weight(1f), color = if (quiet) Theme.muted else Theme.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (count != null && count > 0) Text("$count", color = Theme.muted, fontSize = 13.sp)
    }
}

/** The account at the foot of the sidebar: who's signed in, with switching, Settings and signing out behind it. */
@Composable
fun AccountBadge(onPick: () -> Unit) {
    val model = LocalModel.current
    val account = model.account ?: return
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.fillMaxWidth().clickable { open = true }.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(account, 32.dp)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(account.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Theme.text, maxLines = 1)
                    // The demo account carries the web's DEMO tag.
                    if (account.email.lowercase().endsWith(".test")) Text("DEMO", Modifier.clip(RoundedCornerShape(50)).background(Theme.alert.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 1.dp), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Theme.alert)
                }
                Text(account.email, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
            }
            SyncBadge()
        }
        DropdownMenu(open, { open = false }) {
            for (other in model.accounts) {
                DropdownMenuItem(
                    text = { Text("${other.name} (${other.email})") }, onClick = { open = false; model.switchTo(other) },
                    leadingIcon = { if (other.id == account.id) Icon(Icons.Outlined.CheckCircle, null, tint = Theme.accent) else Avatar(other, 22.dp) },
                )
            }
            DropdownMenuItem(text = { Text("Add another account") }, onClick = { open = false; model.addingAccount = true; onPick() })
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Backup & settings") }, onClick = { open = false; model.page = Page.Settings; onPick() })
            if (model.openVaults.isNotEmpty()) DropdownMenuItem(text = { Text("Lock private vaults") }, onClick = { open = false; model.lockAll() })
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Sign out", color = Theme.alert) }, onClick = { open = false; model.signOut() })
        }
    }
}

/**
 * Pictures from the web (an account's photo, a link's preview), fetched once and decoded no bigger than they're shown,
 * kept a while in a cache of bounded size. Two asking for the same one at once share one download.
 */
object WebImages {
    /** The longest edge kept, in pixels: a preview is shown at most about 360dp wide. */
    private const val EDGE = 1024
    private val cache = object : android.util.LruCache<String, ImageBitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }
    private val failed = mutableSetOf<String>()
    private val loading = mutableMapOf<String, kotlinx.coroutines.CompletableDeferred<ImageBitmap?>>()

    suspend fun load(url: String): ImageBitmap? {
        cache.get(url)?.let { return it }
        if (url in failed) return null
        loading[url]?.let { return it.await() }
        val waiting = kotlinx.coroutines.CompletableDeferred<ImageBitmap?>()
        loading[url] = waiting
        val image = withContext(Dispatchers.IO) {
            runCatching {
                val c = URI(url).toURL().openConnection()
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                val bytes = c.getInputStream().use { it.readBytes() }
                val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= EDGE) sample *= 2
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
        if (image != null) cache.put(url, image) else failed.add(url)
        loading.remove(url)
        waiting.complete(image)
        return image
    }
}

/** An account's Google photo, or its first letter. */
@Composable
fun Avatar(account: Account, size: Dp) {
    val image by produceState<ImageBitmap?>(null, account.picture) { value = account.picture?.let { WebImages.load(it) } }
    Box(Modifier.size(size).clip(CircleShape).background(Color(0xFFED8C73)), contentAlignment = Alignment.Center) {
        val i = image
        if (i != null) Image(i, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(account.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.45f).sp)
    }
}

/** A short message at the foot of the screen, with Undo when it can be taken back. */
@Composable
fun ToastView(modifier: Modifier = Modifier) {
    val model = LocalModel.current
    val toast = model.toast
    LaunchedEffect(toast?.id) {
        if (toast == null) return@LaunchedEffect
        delay(5000)
        if (model.toast?.id == toast.id) model.toast = null
    }
    AnimatedVisibility(toast != null, modifier.padding(bottom = 96.dp), enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
        val t = toast ?: return@AnimatedVisibility
        Surface(shape = RoundedCornerShape(50), color = Theme.raised, shadowElevation = 8.dp) {
            Row(Modifier.padding(horizontal = 18.dp, vertical = 11.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t.message, color = Theme.text)
                if (t.undo) Text("Undo", Modifier.clickable { model.toast = null; model.undo() }, color = Theme.accent, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
fun SyncBadge() {
    val model = LocalModel.current
    val sync = model.sync ?: return
    val s = model.syncStatus
    val (label, icon) = when (s.state) {
        SyncEngine.State.offline -> "Offline" to Icons.Outlined.CloudOff
        SyncEngine.State.signedOut -> "Sign in to sync" to Icons.Outlined.ErrorOutline
        SyncEngine.State.error -> "Not synced" to Icons.Outlined.ErrorOutline
        else -> if (s.pending > 0) "Syncing…" to Icons.Outlined.CloudSync else "Synced" to Icons.Outlined.CloudDone
    }
    Icon(icon, label, Modifier.size(18.dp).clickable { model.scope.launch { sync.sync() } }, tint = Theme.muted)
}

/** A page's top bar: the drawer's button, its title, and what it offers on the right. */
@Composable
fun TopBar(title: String, openDrawer: (() -> Unit)?, subtitle: String? = null, actions: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().background(Theme.bg).padding(top = statusBarTop()).padding(start = 4.dp, end = 8.dp).height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (openDrawer != null) {
            androidx.compose.material3.IconButton(onClick = openDrawer) { Icon(Icons.Outlined.Menu, "Pages, tags and vaults", tint = Theme.text) }
        } else Spacer(Modifier.width(12.dp))
        Row(Modifier.weight(1f), verticalAlignment = Alignment.Bottom) {
            PageTitle(title, Modifier.weight(1f, fill = false))
            if (subtitle != null) Text(subtitle, Modifier.padding(start = 10.dp, bottom = 3.dp), fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, color = Theme.muted, maxLines = 1)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

@Composable
fun statusBarTop(): Dp = with(androidx.compose.ui.platform.LocalDensity.current) {
    androidx.compose.foundation.layout.WindowInsets.statusBars.getTop(this).toDp()
}
