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
import androidx.compose.material.icons.outlined.Menu

@Composable
fun Root() {
    val model = LocalModel.current
    Box(Modifier.fillMaxSize().background(Theme.bg)) {
        when (model.phase) {
            AppModel.Phase.loading -> {}
            AppModel.Phase.signedOut -> SignInView()
            AppModel.Phase.signedIn -> if (model.addingAccount) SignInView() else PhoneFrame()
        }
    }
}

/** The phone's frame, as the web app's: tabs (Journal, Today, Calendar, Search), with the sidebar in a drawer. */
@Composable
fun PhoneFrame() {
    val model = LocalModel.current
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(0) }
    val openDrawer: () -> Unit = { scope.launch { drawer.open() } }
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
            NavigationBar(containerColor = Theme.surface, tonalElevation = 0.dp) {
                val items = listOf(
                    "Journal" to Icons.AutoMirrored.Outlined.Article, "Today" to Icons.Outlined.WbSunny,
                    "Calendar" to Icons.Outlined.CalendarMonth, "Search" to Icons.Outlined.Search,
                )
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

/** The page the main column shows. */
@Composable
fun PageView(page: Page, openDrawer: () -> Unit) {
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
            item { SideRow("Journal", Icons.AutoMirrored.Outlined.Article, model.page == Page.Journal()) { go(Page.Journal()) } }
            item { SideRow("History", Icons.Outlined.History, model.page == Page.History) { go(Page.History) } }
            item { SideRow("Calendar", Icons.Outlined.CalendarMonth, model.page == Page.Calendar) { go(Page.Calendar) } }
            item { SideRow("Timeline", Icons.Outlined.Timeline, model.page == Page.Timeline) { go(Page.Timeline) } }
            item { SideRow("Photos", Icons.Outlined.Photo, model.page == Page.Photos) { go(Page.Photos) } }
            item { SideRow("Links", Icons.Outlined.Link, model.page == Page.Links) { go(Page.Links) } }
            item { SideRow("Files", Icons.Outlined.InsertDriveFile, model.page == Page.Files) { go(Page.Files) } }
            item { SideRow("Archive", Icons.Outlined.Archive, filter?.archived == true, archived) { go(Page.Journal(StreamFilter(archived = true))) } }
            item { SideRow("Trash", Icons.Outlined.Delete, model.page == Page.Trash, index.trash.size) { go(Page.Trash) } }
            for (group in index.tagGroups.groups) {
                item { SideHeader(group.title) }
                items(group.members, key = { "g${group.id}:${it.id}" }) { tag -> TagRow(tag, filter?.tagId == tag.id) { go(Page.Journal(StreamFilter(tagId = tag.id))) } }
            }
            item { SideHeader("Tags") }
            items(index.tagGroups.loose, key = { "t:${it.id}" }) { tag -> TagRow(tag, filter?.tagId == tag.id) { go(Page.Journal(StreamFilter(tagId = tag.id))) } }
            item { SideRow("All tags", Icons.Outlined.Label, model.page == Page.Tags) { go(Page.Tags) } }
            item { SideHeader("Vaults") }
            // A hidden vault stays out of the app until its PIN is entered.
            items(model.vaults.filter { !it.hidden || it.id in model.openVaults }, key = { "v:${it.id}" }) { vault ->
                val icon = if (vault.isPrivate) (if (vault.id in model.lockedVaults) Icons.Outlined.Lock else Icons.Outlined.LockOpen) else if ((vault.members ?: 1) > 1) Icons.Outlined.Group else Icons.Outlined.Inbox
                SideRow(vault.name, icon, filter?.vaultId == vault.id) { go(Page.Journal(StreamFilter(vaultId = vault.id))) }
            }
            item { SideRow("All vaults", Icons.Outlined.Layers, model.page == Page.Vaults) { go(Page.Vaults) } }
        }
        HorizontalDivider(color = Theme.line)
        AccountBadge(onPick)
    }
}

@Composable
private fun TagRow(tag: Card, selected: Boolean, onClick: () -> Unit) {
    val model = LocalModel.current
    val count = model.index.backlinks[tag.id]?.count { it.kind == dev.notesapp.core.Backlink.Kind.tag && it.from.isEntry && !it.from.archived && !it.from.template } ?: 0
    SideRow(tag.displayTitle, Icons.Outlined.Label, selected, count, onClick)
}

@Composable
fun SideHeader(text: String) {
    Text(text, Modifier.padding(start = 10.dp, top = 16.dp, bottom = 4.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
}

@Composable
fun SideRow(title: String, icon: ImageVector, selected: Boolean, count: Int? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (selected) Theme.accentSoft else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = if (selected) Theme.accent else Theme.muted)
        Text(title, Modifier.weight(1f), color = Theme.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
                Text(account.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Theme.text, maxLines = 1)
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
            DropdownMenuItem(text = { Text("Settings") }, onClick = { open = false; model.page = Page.Settings; onPick() })
            if (model.openVaults.isNotEmpty()) DropdownMenuItem(text = { Text("Lock private vaults") }, onClick = { open = false; model.lockAll() })
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Sign out", color = Theme.alert) }, onClick = { open = false; model.signOut() })
        }
    }
}

/** Pictures from the web (an account's photo, a link's preview), fetched once and kept for the session. */
object WebImages {
    private val cache = mutableMapOf<String, ImageBitmap?>()
    suspend fun load(url: String): ImageBitmap? {
        if (cache.containsKey(url)) return cache[url]
        val image = withContext(Dispatchers.IO) {
            runCatching {
                val c = URI(url).toURL().openConnection()
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                c.getInputStream().use { android.graphics.BitmapFactory.decodeStream(it) }?.asImageBitmap()
            }.getOrNull()
        }
        cache[url] = image
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
        Column(Modifier.weight(1f)) {
            PageTitle(title)
            if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

@Composable
fun statusBarTop(): Dp = with(androidx.compose.ui.platform.LocalDensity.current) {
    androidx.compose.foundation.layout.WindowInsets.statusBars.getTop(this).toDp()
}
