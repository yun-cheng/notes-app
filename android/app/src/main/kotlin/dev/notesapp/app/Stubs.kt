package dev.notesapp.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.notesapp.core.Card
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.Vault
import kotlinx.serialization.json.JsonElement

@Composable fun UnlockView(vault: Vault, modifier: Modifier = Modifier) { Text("Locked: ${vault.name}", modifier) }
@Composable fun BoardView(filter: StreamFilter, board: String) {}
@Composable fun BubbleAttachments(card: Card) {}
@Composable fun BubbleLinks(card: Card) {}
@Composable fun BubbleTranslation(card: Card) {}
@Composable fun EntryMenu(card: Card, open: Boolean, onDismiss: () -> Unit, revealHidden: () -> Unit, onPick: () -> Unit) {}
@Composable fun EntrySheet(id: String, dismiss: () -> Unit) {}
@Composable fun EntryPanelView(panel: EntryPanel, dismiss: () -> Unit) {}
@Composable fun AttachedThumb(node: JsonElement, vaultId: String, remove: () -> Unit) {}
class Pickers(val photos: () -> Unit, val files: () -> Unit)
@Composable fun rememberAttachmentPickers(vaultId: String, add: (JsonElement) -> Unit) = Pickers({}, {})
@Composable fun VoiceRecordButton(vaultId: String, add: (JsonElement) -> Unit) {}
@Composable private fun Stub(title: String, openDrawer: () -> Unit) { Column(Modifier.fillMaxSize()) { TopBar(title, openDrawer) } }
@Composable fun TrashPage(openDrawer: () -> Unit) = Stub("Trash", openDrawer)
@Composable fun HistoryPage(openDrawer: () -> Unit) = Stub("History", openDrawer)
@Composable fun CalendarPage(openDrawer: () -> Unit) = Stub("Calendar", openDrawer)
@Composable fun TimelinePage(openDrawer: () -> Unit) = Stub("Timeline", openDrawer)
@Composable fun PhotosPage(openDrawer: () -> Unit) = Stub("Photos", openDrawer)
@Composable fun LinksPage(openDrawer: () -> Unit) = Stub("Links", openDrawer)
@Composable fun FilesPage(openDrawer: () -> Unit) = Stub("Files", openDrawer)
@Composable fun TagsPage(openDrawer: () -> Unit) = Stub("Tags", openDrawer)
@Composable fun VaultsPage(openDrawer: () -> Unit) = Stub("Vaults", openDrawer)
@Composable fun SettingsPage(openDrawer: () -> Unit) = Stub("Settings", openDrawer)
@Composable fun SearchPage(openDrawer: () -> Unit) = Stub("Search", openDrawer)
