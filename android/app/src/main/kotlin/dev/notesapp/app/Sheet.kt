package dev.notesapp.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** A sheet from the foot of the screen, as the Swift app's sheets and the web's dialogs on a phone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(dismiss: () -> Unit, full: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = full)
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = state, containerColor = Theme.bg, contentWindowInsets = { androidx.compose.foundation.layout.WindowInsets(0) }) {
        Column(Modifier.navigationBarsPadding(), content = content)
    }
}
