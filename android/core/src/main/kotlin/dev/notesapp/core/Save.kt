package dev.notesapp.core

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Where entries from the journal box go: the journal filter's tag and vault, its todo default, the day it shows, and
 * whether they're templates. As the web app's `useSaveEntry.ts`.
 */
data class SaveOptions(
    val due: String? = null,
    /** Todos start out waiting. */
    val waiting: Boolean = false,
    val tagId: String? = null,
    /** More tags every entry gets, after `tagId`: a board column's. */
    val tags: List<String> = emptyList(),
    val vaultId: String? = null,
    /** A day other than today: entries are written on it, at this time of day. */
    val date: String? = null,
    val template: Boolean = false,
) {
    companion object {
        /** What the journal is narrowed to, as defaults for what is written into it. */
        fun journal(f: StreamFilter, today: String) = SaveOptions(
            due = if (f.status == StreamFilter.TodoStatus.today) today else null,
            waiting = f.status == StreamFilter.TodoStatus.waiting,
            tagId = f.tagId, vaultId = f.vaultId,
            date = f.`when`?.takeIf { DateKey.isKey(it) && it != today },
            template = f.template,
        )
    }
}

sealed class SaveResult {
    /** The entries made, in the order typed, and the action to undo them by. */
    data class Saved(val ids: List<String>, val group: String) : SaveResult()
    /** A vault they'd go into is locked: nothing is saved, so the text stays in the box. */
    data class Unlock(val vaultId: String) : SaveResult()
    data object Nothing : SaveResult()
}

/** What saving needs to know about the account. */
data class SaveContext(val accountId: String, val vaults: List<Vault>, val locked: Set<String>, val index: CardIndex, val sharedInto: SharedInto) {
    val mainVault get() = vaults.firstOrNull { it.isDefault(accountId) } ?: vaults.firstOrNull()
    val diaryVault get() = vaults.firstOrNull { it.isDiary(accountId) }
}

/**
 * Saves entries read from the journal box. Tags typed in several entries are made once; a typed tag is the one
 * offered in the entry's vault by that name, or a new one kept to that vault.
 */
suspend fun Repository.save(entries: List<Entry>, opts: SaveOptions = SaveOptions(), context: SaveContext, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): SaveResult {
    if (entries.isEmpty()) return SaveResult.Nothing
    val diary = context.diaryVault?.id
    val main = context.mainVault?.id
    val vaultOf = { e: Entry -> if (e.diary && diary != null) diary else opts.vaultId }
    entries.mapNotNull(vaultOf).firstOrNull { it in context.locked }?.let { return SaveResult.Unlock(it) }

    val group = action()
    val made = mutableMapOf<String, String>()
    val groups = context.index.tagGroups
    suspend fun tagIds(names: List<String>, vaultId: String?): List<String> {
        val ids = mutableListOf<String>()
        for (id in listOfNotNull(opts.tagId) + opts.tags) if (id !in ids) ids.add(id)
        for (name in names) {
            if (groups.isGroupName(name)) continue
            val key = "${vaultId ?: ""}:${name.lowercase()}"
            val id = tagNamed(name, context.index.tags, vaultId, context.sharedInto)?.id ?: made[key]
                ?: createTag(title = name, vaultId = vaultId, group = group).id.also { made[key] = it }
            if (id !in ids) ids.add(id)
        }
        // A one-choice group keeps the last of its tags: what was typed wins over the journal's filter.
        return groups.settle(ids)
    }
    // Written for another day: on that day, at this time of day, so they keep the order they're written in.
    val at = DateKey.parse(opts.date)?.let { day ->
        val time = LocalDateTime.ofInstant(now, zone).toLocalTime()
        day.atTime(time).atZone(zone).toInstant().toEpochMilli()
    }
    val ids = mutableListOf<String>()
    for ((i, entry) in entries.withIndex()) {
        val vault = vaultOf(entry)
        val tags = tagIds(entry.tags, vault ?: main)
        val createdAt = entry.createdAt ?: at?.plus(i)
        val extra = if (opts.template || entry.template) jobj("template" to j(true)) else jobj()
        val card = if (entry.kind == Entry.Kind.note) {
            createNote(id = entry.id, title = entry.title, content = entry.content, pages = entry.pages, tags = tags, vaultId = vault, createdAt = createdAt, extra = extra, group = group)
        } else {
            createTodo(
                id = entry.id, title = entry.title, due = entry.due ?: opts.due, dueTime = entry.dueTime, start = entry.start, repeat = entry.repeat,
                content = entry.content, pages = entry.pages, tags = tags, vaultId = vault, done = entry.done, waiting = opts.waiting, createdAt = createdAt,
                extra = extra, group = group,
            )
        }
        ids.add(card.id)
    }
    return SaveResult.Saved(ids, group)
}
