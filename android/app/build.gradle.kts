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
        versionCode = 1
        versionName = "1.0"
        // The local dev server, from the emulator: `adb reverse tcp:5191 tcp:5191`, then
        // `./gradlew installDebug -Pserver=http://localhost:5191` (Vite serves the demo's photos and files; the API alone can't).
        buildConfigField("String", "SERVER", "\"${project.findProperty("server") ?: "https://notes-app.yuncheng-dev.workers.dev"}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signed with the debug key until there's a release key, so it installs for testing.
            signingConfig = signingConfigs.getByName("debug")
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
    // Translation on the device, where the server can't: offline, the day's translations used up, or an encrypted vault.
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("com.google.mlkit:language-id:17.0.6")
}
