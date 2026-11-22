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

@Composable fun BoardView(filter: StreamFilter, board: String) {}
@Composable fun BubbleLinks(card: Card) {}
@Composable fun BubbleTranslation(card: Card) {}
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
@Composable fun SettingsPage(openDrawer: () -> Unit) = Stub("Settings", openDrawer)
@Composable fun SearchPage(openDrawer: () -> Unit) = Stub("Search", openDrawer)

@Composable fun CommentsSection(card: Card) {}
@Composable fun SharePanel(id: String) {}
@Composable fun EntryHistory(id: String, dismiss: () -> Unit) {}
object Translations {
    sealed class State { data class Done(val to: String, val shown: Boolean) : State() }
    val states = androidx.compose.runtime.mutableStateMapOf<String, State>()
    fun show(id: String, on: Boolean) {}
    fun translate(card: Card, model: AppModel) {}
}
@Composable fun VoicePlayer(file: dev.notesapp.core.Doc.FileInfo, vaultId: String) {}
@Composable fun PublicLinkMenu(id: String, vaultId: String, close: () -> Unit) {}
