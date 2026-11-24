# kotlinx.serialization keeps what it needs through its own rules; these keep the app's serializable classes.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class dev.notesapp.** { *** Companion; }
-keepclasseswithmembers class dev.notesapp.** { kotlinx.serialization.KSerializer serializer(...); }
-dontwarn org.slf4j.**
# Credential Manager finds its Google Play services provider by name.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
