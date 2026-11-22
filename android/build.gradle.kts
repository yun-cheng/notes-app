// The Android app: `core` is plain Kotlin (models, storage-free rules, sync and crypto), tested on the JVM; `app` is
// the Compose app on top of it.
plugins {
    kotlin("jvm") version "2.2.20" apply false
    kotlin("android") version "2.2.20" apply false
    kotlin("plugin.serialization") version "2.2.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
    id("com.android.application") version "8.12.1" apply false
}
