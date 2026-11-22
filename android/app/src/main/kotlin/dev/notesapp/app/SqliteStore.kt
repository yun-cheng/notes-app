package dev.notesapp.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import dev.notesapp.core.CardRecord
import dev.notesapp.core.CardStore
import dev.notesapp.core.ChangeEntry
import dev.notesapp.core.Vault
import dev.notesapp.core.json

/**
 * Cards, vaults and sync state in SQLite, one database for each account, as the Swift app's `CardStore`: a local
 * write marks the card dirty until the server has it, and a remote change never overwrites a dirty card.
 */
class SqliteStore(context: Context, name: String) : CardStore {
    private val helper = object : SQLiteOpenHelper(context, name, null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE cards (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL)")
            db.execSQL("CREATE TABLE dirty (id TEXT PRIMARY KEY)")
            db.execSQL("CREATE TABLE vaults (id TEXT PRIMARY KEY, json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execSQL("CREATE TABLE changes (n INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

        override fun onConfigure(db: SQLiteDatabase) { db.enableWriteAheadLogging() }
    }
    private val db get() = helper.writableDatabase

    private inline fun <T> tx(block: SQLiteDatabase.() -> T): T {
        val d = db
        d.beginTransaction()
        try {
            val r = d.block()
            d.setTransactionSuccessful()
            return r
        } finally {
            d.endTransaction()
        }
    }

    private fun query(sql: String, vararg args: String): List<List<Any?>> = db.rawQuery(sql, args).use { c ->
        val rows = mutableListOf<List<Any?>>()
        while (c.moveToNext()) rows.add((0 until c.columnCount).map { i ->
            when (c.getType(i)) {
                android.database.Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
                android.database.Cursor.FIELD_TYPE_NULL -> null
                else -> c.getString(i)
            }
        })
        rows
    }

    private val columns = "id, vault_id, updated_at, deleted, seq, payload"
    private fun record(r: List<Any?>) = CardRecord(r[0] as String, r[1] as String, r[2] as Long, (r[3] as Long) != 0L, r[4] as Long, r[5] as String)

    private fun SQLiteDatabase.put(r: CardRecord) {
        insertWithOnConflict("cards", null, ContentValues().apply {
            put("id", r.id); put("vault_id", r.vault_id); put("updated_at", r.updated_at); put("deleted", if (r.deleted) 1 else 0); put("seq", r.seq); put("payload", r.payload)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    override fun listCards() = query("SELECT $columns FROM cards").map(::record)
    override fun getCard(id: String) = query("SELECT $columns FROM cards WHERE id = ?", id).firstOrNull()?.let(::record)

    override fun putCards(records: List<CardRecord>) = tx {
        for (r in records) {
            put(r)
            execSQL("INSERT OR IGNORE INTO dirty (id) VALUES (?)", arrayOf(r.id))
        }
    }

    override fun listDirty() = query("SELECT c.id, c.vault_id, c.updated_at, c.deleted, c.seq, c.payload FROM cards c JOIN dirty d ON d.id = c.id").map(::record)

    override fun applyRemote(records: List<CardRecord>): Int = tx {
        var stored = 0
        for (r in records) {
            if (query("SELECT 1 FROM dirty WHERE id = ?", r.id).isNotEmpty()) continue
            if (query("SELECT seq FROM cards WHERE id = ?", r.id).firstOrNull()?.firstOrNull() == r.seq) continue
            put(r)
            stored++
        }
        stored
    }

    override fun forceRemote(record: CardRecord, ifUpdatedAt: Long?): Boolean = tx {
        if (ifUpdatedAt != null && getCard(record.id)?.updated_at != ifUpdatedAt) return@tx false
        put(record)
        delete("dirty", "id = ?", arrayOf(record.id))
        true
    }

    override fun markSynced(id: String, updatedAt: Long, seq: Long) = tx {
        val card = getCard(id) ?: return@tx
        execSQL("UPDATE cards SET seq = ? WHERE id = ?", arrayOf<Any>(seq, id))
        if (card.updated_at == updatedAt) delete("dirty", "id = ?", arrayOf(id))
    }

    override fun deleteCards(ids: List<String>) = tx {
        for (id in ids) {
            delete("cards", "id = ?", arrayOf(id))
            delete("dirty", "id = ?", arrayOf(id))
        }
    }

    override fun listVaults() = query("SELECT json FROM vaults").mapNotNull { runCatching { json.decodeFromString(Vault.serializer(), it[0] as String) }.getOrNull() }

    override fun putVaults(vaults: List<Vault>) = tx {
        for (v in vaults) insertWithOnConflict("vaults", null, ContentValues().apply { put("id", v.id); put("json", json.encodeToString(Vault.serializer(), v)) }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    override fun replaceVaults(vaults: List<Vault>) = tx {
        delete("vaults", null, null)
        for (v in vaults) insert("vaults", null, ContentValues().apply { put("id", v.id); put("json", json.encodeToString(Vault.serializer(), v)) })
    }

    override fun getMeta(key: String) = query("SELECT value FROM meta WHERE key = ?", key).firstOrNull()?.get(0) as String?

    override fun setMeta(key: String, value: String?) {
        if (value == null) db.delete("meta", "key = ?", arrayOf(key))
        else db.insertWithOnConflict("meta", null, ContentValues().apply { put("key", key); put("value", value) }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    private fun change(r: List<Any?>) = runCatching { json.decodeFromString(ChangeEntry.serializer(), r[1] as String).copy(n = r[0] as Long) }.getOrNull()

    override fun putChange(entry: ChangeEntry) {
        val text = json.encodeToString(ChangeEntry.serializer(), entry.copy(n = null))
        val n = entry.n
        if (n != null) db.execSQL("UPDATE changes SET json = ? WHERE n = ?", arrayOf<Any>(text, n))
        else db.execSQL("INSERT INTO changes (json) VALUES (?)", arrayOf(text))
    }

    override fun listChanges() = query("SELECT n, json FROM changes ORDER BY n").mapNotNull(::change)
    override fun getChange(n: Long) = query("SELECT n, json FROM changes WHERE n = ?", n.toString()).firstOrNull()?.let(::change)
    override fun lastChange() = query("SELECT n, json FROM changes ORDER BY n DESC LIMIT 1").firstOrNull()?.let(::change)

    override fun deleteChanges(ns: List<Long>) {
        if (ns.isEmpty()) return
        tx { for (n in ns) delete("changes", "n = ?", arrayOf(n.toString())) }
    }

    override fun trimChanges(limit: Int) = db.execSQL("DELETE FROM changes WHERE n NOT IN (SELECT n FROM changes ORDER BY n DESC LIMIT ?)", arrayOf<Any>(limit))

    override fun clear() = tx {
        for (t in listOf("cards", "dirty", "vaults", "meta", "changes")) delete(t, null, null)
    }

    fun close() = helper.close()
}
