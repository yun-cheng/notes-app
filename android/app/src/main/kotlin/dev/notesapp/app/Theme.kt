package dev.notesapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.CardColor

/** The web app's colors (`styles.css` `:root`), in light and dark. */
data class Palette(
    val bg: Color, val surface: Color, val sunken: Color, val raised: Color, val line: Color, val text: Color, val muted: Color,
    val accent: Color, val accentSoft: Color, val onAccent: Color, val alert: Color, val added: Color, val removed: Color,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightPalette = Palette(
    c(0xF5F2EA), c(0xFFFEFB), c(0xE8E3D8), c(0xFFFFFF), c(0xD6CFC1), c(0x22262A), c(0x5F6563), c(0x1F5C57), c(0xC6E1D7), c(0xFBFAF6), c(0xB23A2E), c(0xD6ECD2), c(0xF5D9D3),
)
val DarkPalette = Palette(
    c(0x151817), c(0x232927), c(0x313835), c(0x48514D), c(0x454E4A), c(0xECE9E2), c(0xA7AEAA), c(0x84C9BC), c(0x2E5B53), c(0x12211E), c(0xF0907F), c(0x24452C), c(0x4D2A25),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

object Theme {
    val p: Palette @Composable get() = LocalPalette.current
    val bg @Composable get() = p.bg
    val surface @Composable get() = p.surface
    val sunken @Composable get() = p.sunken
    val raised @Composable get() = p.raised
    val line @Composable get() = p.line
    val text @Composable get() = p.text
    val muted @Composable get() = p.muted
    val accent @Composable get() = p.accent
    val accentSoft @Composable get() = p.accentSoft
    val onAccent @Composable get() = p.onAccent
    val alert @Composable get() = p.alert

    /** An entry's tint (`.tint--red` and the rest). */
    fun tint(color: CardColor): Color = when (color) {
        CardColor.red -> c(0xD4574A)
        CardColor.orange -> c(0xDE8A3A)
        CardColor.yellow -> c(0xD6B236)
        CardColor.green -> c(0x5A9E5F)
        CardColor.blue -> c(0x4F86C6)
        CardColor.purple -> c(0x8A6CC2)
        CardColor.pink -> c(0xCF6A9B)
        CardColor.gray -> c(0x8A8F8C)
    }

    fun colorName(color: CardColor) = color.name.replaceFirstChar { it.uppercase() }

    val titleFont = FontFamily.Serif
    val mono = FontFamily.Monospace
}

@Composable
fun NotesTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) darkColorScheme(
        primary = p.accent, onPrimary = p.onAccent, primaryContainer = p.accentSoft, onPrimaryContainer = p.text, background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, surfaceVariant = p.sunken, onSurfaceVariant = p.muted, outline = p.line, outlineVariant = p.line, error = p.alert,
        surfaceContainer = p.surface, surfaceContainerHigh = p.raised, surfaceContainerLow = p.surface, surfaceContainerHighest = p.raised, secondaryContainer = p.accentSoft,
    ) else lightColorScheme(
        primary = p.accent, onPrimary = p.onAccent, primaryContainer = p.accentSoft, onPrimaryContainer = p.text, background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, surfaceVariant = p.sunken, onSurfaceVariant = p.muted, outline = p.line, outlineVariant = p.line, error = p.alert,
        surfaceContainer = p.surface, surfaceContainerHigh = p.raised, surfaceContainerLow = p.surface, surfaceContainerHighest = p.raised, secondaryContainer = p.accentSoft,
    )
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/** A small rounded chip, as the web's `.chip--small`. */
@Composable
fun Chip(text: String, tint: Color? = null, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    Row(
        modifier.background(tint?.copy(alpha = 0.22f) ?: Theme.sunken, RoundedCornerShape(50)).padding(horizontal = 7.dp, vertical = 1.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(12.dp), tint = Theme.text)
        Text(text, fontSize = 12.sp, color = Theme.text)
    }
}

/** A page title in the web app's serif. */
@Composable
fun PageTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, fontFamily = Theme.titleFont, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Theme.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
}

/**
 * A time as the cards and the server keep it (milliseconds since 1970), written as this device writes dates and
 * times. Leave out `date` or `time` for the other alone.
 */
fun formatMillis(ms: Long, date: Int? = java.text.DateFormat.MEDIUM, time: Int? = java.text.DateFormat.SHORT): String = when {
    date != null && time != null -> java.text.DateFormat.getDateTimeInstance(date, time)
    date != null -> java.text.DateFormat.getDateInstance(date)
    else -> java.text.DateFormat.getTimeInstance(time ?: java.text.DateFormat.SHORT)
}.format(java.util.Date(ms))
