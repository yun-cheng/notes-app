package dev.notesapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A group of settings on a rounded card, as the web app's settings sections, with a heading and a note under it. */
@Composable
fun FormSection(title: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        if (title != null) Text(title, Modifier.padding(start = 4.dp, bottom = 6.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(12.dp)).padding(vertical = 4.dp), content = content)
        if (footer != null) Text(footer, Modifier.padding(start = 4.dp, top = 6.dp), fontSize = 12.sp, color = Theme.muted)
    }
}

/** A text field in a form row. */
@Composable
fun FormField(
    value: String, set: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, secret: Boolean = false, keyboard: KeyboardType = KeyboardType.Text,
    onDone: (() -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value, set,
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(8.dp)).background(Theme.bg)
            .border(1.dp, if (focused) Theme.accent else Theme.line, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 10.dp).onFocusChanged { focused = it.isFocused },
        singleLine = true, textStyle = TextStyle(color = Theme.text, fontSize = 16.sp), cursorBrush = SolidColor(Theme.accent),
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else keyboard, imeAction = if (onDone != null) ImeAction.Done else ImeAction.Default, autoCorrectEnabled = !secret),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        decorationBox = { inner -> Box { if (value.isEmpty()) Text(placeholder, color = Theme.muted, fontSize = 16.sp); inner() } },
    )
}

/** A field for a PIN: hidden as it's typed, never offered to a password manager as a new password. */
@Composable
fun PinField(value: String, set: (String) -> Unit, placeholder: String = "PIN", onDone: (() -> Unit)? = null, modifier: Modifier = Modifier) =
    FormField(value, set, placeholder, modifier, secret = true, onDone = onDone)

/** A button row in a form. */
@Composable
fun FormButton(label: String, enabled: Boolean = true, color: Color? = null, onClick: () -> Unit) {
    Text(
        label, Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp, vertical = 13.dp),
        color = if (!enabled) Theme.muted else color ?: Theme.accent, fontWeight = FontWeight.Medium, fontSize = 16.sp,
    )
}

/** A row naming a choice, which opens a menu of the others. */
@Composable
fun ChoiceRow(label: String, value: String, inset: androidx.compose.ui.unit.Dp = 16.dp, items: @Composable (close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.fillMaxWidth().clickable { open = true }.padding(horizontal = inset, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Theme.text)
            Text(value, color = Theme.accent, fontWeight = FontWeight.SemiBold)
        }
        DropdownMenu(open, { open = false }) { items { open = false } }
    }
}

@Composable
fun FormText(text: String, muted: Boolean = true) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = if (muted) Theme.muted else Theme.text, fontSize = if (muted) 14.sp else 16.sp)
}

@Composable
fun FormDivider() = HorizontalDivider(Modifier.padding(start = 16.dp), color = Theme.line)

@Composable
fun FormRow(title: String, detail: String? = null, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, color = Theme.text, fontSize = 16.sp)
            if (detail != null) Text(detail, color = Theme.muted, fontSize = 13.sp)
        }
        trailing()
    }
}
