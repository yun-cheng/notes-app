package dev.notesapp.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Pairing
import dev.notesapp.core.ServerApi
import kotlinx.coroutines.delay

/**
 * Signs in through the web app: the browser opens the site, where the user confirms the code shown here. Google
 * doesn't allow its sign-in inside apps, so the browser does that part, and sends it back to `notesapp://paired`.
 */
@Composable
fun SignInView() {
    val model = LocalModel.current
    val context = LocalContext.current
    var pairing by remember { mutableStateOf<Pairing?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(attempt) {
        if (attempt == 0) return@LaunchedEffect
        problem = null
        val api = ServerApi(model.site, null)
        val next = try { api.startPairing() } catch (_: Exception) {
            problem = "Connect to the internet to sign in."
            return@LaunchedEffect
        }
        pairing = next
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(api.pairingPage(next))))
        while (true) {
            when (val c = runCatching { api.claim(next) }.getOrNull()) {
                is ServerApi.Claim.SignedIn -> { model.signedIn(c.info, c.token); return@LaunchedEffect }
                ServerApi.Claim.Expired -> { pairing = null; problem = "That took too long. Try again."; return@LaunchedEffect }
                else -> delay(2000)
            }
        }
    }

    Column(
        Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Outlined.Description, null, Modifier.size(56.dp), tint = Theme.accent)
        Text("Notes", fontSize = 34.sp, fontWeight = FontWeight.Bold, fontFamily = Theme.titleFont, color = Theme.text)
        Text("Your notes, todos and diary, on every device.", color = Theme.muted, textAlign = TextAlign.Center)
        val p = pairing
        if (p != null) {
            Text("Confirm this code in the browser:", color = Theme.muted)
            Text(
                p.code.toList().joinToString(" "), fontSize = 38.sp, fontFamily = Theme.mono, fontWeight = FontWeight.SemiBold, color = Theme.text,
                modifier = Modifier.semantics { contentDescription = "Code ${p.code.toList().joinToString(" ")}" },
            )
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            TextButton(onClick = { attempt++ }) { Text("Start again") }
        } else {
            Spacer(Modifier.height(4.dp))
            Button(onClick = { attempt++ }, Modifier.widthIn(min = 220.dp)) { Text("Sign in") }
        }
        problem?.let { Text(it, color = Theme.alert, textAlign = TextAlign.Center) }
        if (model.addingAccount) TextButton(onClick = { model.addingAccount = false }) { Text("Cancel") }
    }
}
