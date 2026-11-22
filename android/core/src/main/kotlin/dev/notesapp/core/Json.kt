package dev.notesapp.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** Card payloads stay JSON, so fields this app doesn't know about survive a round trip, as in the web and Swift apps. */
val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
operator fun JsonElement?.get(index: Int): JsonElement? = (this as? JsonArray)?.getOrNull(index)

val JsonElement?.str: String? get() = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
val JsonElement?.long: Long?
    get() {
        val p = this as? JsonPrimitive ?: return null
        if (p.isString || p is JsonNull) return null
        p.longOrNull?.let { return it }
        val d = p.doubleOrNull ?: return null
        return if (d == Math.rint(d) && kotlin.math.abs(d) < 9.0e15) d.toLong() else null
    }
val JsonElement?.double: Double? get() = (this as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.doubleOrNull
val JsonElement?.bool: Boolean? get() = (this as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.booleanOrNull
val JsonElement?.arr: JsonArray? get() = this as? JsonArray
val JsonElement?.obj: JsonObject? get() = this as? JsonObject
val JsonElement?.isNull: Boolean get() = this == null || this is JsonNull

fun j(s: String?): JsonElement = s?.let { JsonPrimitive(it) } ?: JsonNull
fun j(n: Long?): JsonElement = n?.let { JsonPrimitive(it) } ?: JsonNull
fun j(n: Int): JsonElement = JsonPrimitive(n)
fun j(d: Double?): JsonElement = d?.let { JsonPrimitive(it) } ?: JsonNull
fun j(b: Boolean?): JsonElement = b?.let { JsonPrimitive(it) } ?: JsonNull
fun jarr(items: List<JsonElement>): JsonArray = JsonArray(items)
fun jstrings(items: List<String>): JsonArray = JsonArray(items.map { JsonPrimitive(it) })
fun jobj(vararg pairs: Pair<String, JsonElement?>): JsonObject = JsonObject(pairs.filter { it.second != null }.associate { it.first to it.second!! })

/** A copy of an object with one field set, or removed with null. */
fun JsonObject.with(key: String, value: JsonElement?): JsonObject = JsonObject(if (value == null) this - key else this + (key to value))

/** JSON text with keys sorted, as the Swift app writes it, so a payload reads the same whoever saved it last. */
fun JsonElement.sortedText(): String = json.encodeToString(JsonElement.serializer(), sorted(this))

private fun sorted(e: JsonElement): JsonElement = when (e) {
    is JsonObject -> JsonObject(e.entries.sortedBy { it.key }.associate { it.key to sorted(it.value) })
    is JsonArray -> JsonArray(e.map(::sorted))
    else -> e
}

fun parseJson(text: String): JsonElement? = runCatching { json.parseToJsonElement(text) }.getOrNull()
