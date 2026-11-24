package dev.notesapp.app

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
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
import androidx.compose.runtime.rememberCoroutineScope
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
import dev.notesapp.core.ApiError
import dev.notesapp.core.Pairing
import dev.notesapp.core.ServerApi
import kotlinx.coroutines.delay

/**
 * Signs in with the Google accounts on this device, through Android's own account picker (Credential Manager), and
 * trades the ID token it gives for this device's session. Where that can't work (no Google Play services, say), it
 * signs in through the web app instead: the browser opens the site, where the user confirms the code shown here, and
 * sends it back to `notesapp://paired`.
 */
@Composable
fun SignInView() {
    val model = LocalModel.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pairing by remember { mutableStateOf<Pairing?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    // Shown once the account picker has failed, so the browser is still a way in.
    var offerBrowser by remember { mutableStateOf(false) }

    fun signInWithGoogle() = scope.launch {
        busy = true
        problem = null
        try {
            val api = ServerApi(model.site, null)
            val clientId = api.googleClientId().ifEmpty { throw IllegalStateException("Sign-in is not set up on the server.") }
            val option = GetSignInWithGoogleOption.Builder(clientId).build()
            val credential = CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(option))).credential
            if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) throw IllegalStateException("Google didn't send an account.")
            val signedIn = api.signInWithGoogle(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            model.signedIn(signedIn.info, signedIn.token)
        } catch (_: GetCredentialCancellationException) {
            // Closed the account picker: nothing to say, but the browser is a way in without adding the account to the phone.
            offerBrowser = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: GetCredentialException) {
            Log.w("SignIn", "Google sign-in failed", e)
            problem = "Google sign-in didn't work on this device."
            offerBrowser = true
        } catch (_: ApiError.Offline) {
            problem = "Connect to the internet to sign in."
        } catch (e: Exception) {
            Log.w("SignIn", "Google sign-in failed", e)
            problem = e.message ?: "Sign-in failed. Try again."
            offerBrowser = true
        } finally {
            busy = false
        }
    }

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
            Button(onClick = { signInWithGoogle() }, Modifier.widthIn(min = 220.dp), enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Sign in with Google")
            }
            if (offerBrowser) TextButton(onClick = { attempt++ }) { Text("Sign in with the browser") }
        }
        problem?.let { Text(it, color = Theme.alert, textAlign = TextAlign.Center) }
        if (model.addingAccount) TextButton(onClick = { model.addingAccount = false }) { Text("Cancel") }
    }
}
