import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.notesapp.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.notesapp.notes"
        minSdk = 29
        targetSdk = 36
        // CI passes a number that only grows (the commit count), so each release installs over the last.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = project.findProperty("versionName") as String? ?: "1.0"
        // The local dev server, from the emulator: `adb reverse tcp:5191 tcp:5191`, then
        // `./gradlew installDebug -Pserver=http://localhost:5191` (Vite serves the demo's photos and files; the API alone can't).
        buildConfigField("String", "SERVER", "\"${project.findProperty("server") ?: "https://notes-app.yuncheng-dev.workers.dev"}\"")
        // How long open vaults stay open with nothing done in the app: five minutes, or `-PvaultIdleSeconds=20` to try it.
        buildConfigField("long", "VAULT_IDLE_SECONDS", "${project.findProperty("vaultIdleSeconds") ?: 300}L")
        manifestPlaceholders["appName"] = "Notes"
        manifestPlaceholders["appScheme"] = "notesapp"
        buildConfigField("String", "APP_SCHEME", "\"notesapp\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The release key, when the environment names it (the GitHub workflow does, from its secrets). Without it, a
    // release build here is signed with this machine's debug key, to try it out.
    val keystore = System.getenv("ANDROID_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = keystore
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        // A build from here is its own app, "Notes Dev" on an amber icon (src/debug/res), installed beside the
        // released one with its own data, sign-in and link scheme (notesapp-dev://). Google sign-in knows it by its
        // own Android OAuth client: package dev.notesapp.notes.dev with this Mac's debug key.
        debug {
            applicationIdSuffix = ".dev"
            manifestPlaceholders["appName"] = "Notes Dev"
            manifestPlaceholders["appScheme"] = "notesapp-dev"
            buildConfigField("String", "APP_SCHEME", "\"notesapp-dev\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
        }
        // A release build to measure speed with (PERFORMANCE.md): optimized and not debuggable, as a debug build runs
        // most code in the interpreter and is many times slower, but its own app, "Notes Bench", signed with this
        // Mac's debug key and open to a profiler (src/bench). `./gradlew installBench -Pserver=http://localhost:5191`.
        create("bench") {
            initWith(getByName("release"))
            applicationIdSuffix = ".bench"
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            manifestPlaceholders["appName"] = "Notes Bench"
            manifestPlaceholders["appScheme"] = "notesapp-bench"
            buildConfigField("String", "APP_SCHEME", "\"notesapp-bench\"")
        }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // Sign-in with the Google accounts on the device, through Android's own account picker.
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    // Opening a private vault with the fingerprint; its sheet needs a FragmentActivity.
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    // A sync now and then with the app closed, so reminders know of todos made elsewhere.
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    // Translation on the device, where the server can't: offline, the day's translations used up, or an encrypted vault.
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("com.google.mlkit:language-id:17.0.6")
}
