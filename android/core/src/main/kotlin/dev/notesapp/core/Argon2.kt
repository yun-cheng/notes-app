package dev.notesapp.core

/** BLAKE2b (RFC 7693), unkeyed, as Argon2 uses it. */
class Blake2b(private val length: Int) {
    private val h = IV.copyOf().also { it[0] = it[0] xor (0x01010000L xor length.toLong()) }
    private var counter = 0L
    private var buffer = ByteArray(0)

    fun update(data: ByteArray) {
        buffer += data
        // The last block is kept back, as it has to be compressed as the final one.
        while (buffer.size > 128) {
            counter += 128
            compress(buffer.copyOfRange(0, 128), false)
            buffer = buffer.copyOfRange(128, buffer.size)
        }
    }

    fun finish(): ByteArray {
        counter += buffer.size
        compress(buffer + ByteArray(128 - buffer.size), true)
        val out = ByteArray(64)
        for (i in 0 until 8) for (k in 0 until 8) out[i * 8 + k] = (h[i] ushr (8 * k)).toByte()
        return out.copyOf(length)
    }

    private fun compress(block: ByteArray, last: Boolean) {
        val m = LongArray(16) { i -> var w = 0L; for (k in 0 until 8) w = w or ((block[i * 8 + k].toLong() and 0xFF) shl (8 * k)); w }
        val v = h + IV
        v[12] = v[12] xor counter
        if (last) v[14] = v[14].inv()
        fun g(a: Int, b: Int, c: Int, d: Int, x: Long, y: Long) {
            v[a] = v[a] + v[b] + x; v[d] = (v[d] xor v[a]).rotateRight(32)
            v[c] = v[c] + v[d]; v[b] = (v[b] xor v[c]).rotateRight(24)
            v[a] = v[a] + v[b] + y; v[d] = (v[d] xor v[a]).rotateRight(16)
            v[c] = v[c] + v[d]; v[b] = (v[b] xor v[c]).rotateRight(63)
        }
        for (round in 0 until 12) {
            val s = SIGMA[round % 10]
            g(0, 4, 8, 12, m[s[0]], m[s[1]]); g(1, 5, 9, 13, m[s[2]], m[s[3]])
            g(2, 6, 10, 14, m[s[4]], m[s[5]]); g(3, 7, 11, 15, m[s[6]], m[s[7]])
            g(0, 5, 10, 15, m[s[8]], m[s[9]]); g(1, 6, 11, 12, m[s[10]], m[s[11]])
            g(2, 7, 8, 13, m[s[12]], m[s[13]]); g(3, 4, 9, 14, m[s[14]], m[s[15]])
        }
        for (i in 0 until 8) h[i] = h[i] xor v[i] xor v[i + 8]
    }

    companion object {
        private val IV = longArrayOf(
            0x6a09e667f3bcc908L, -0x4498517a7b3558c5L, 0x3c6ef372fe94f82bL, -0x5ab00ac5a0e2c90fL,
            0x510e527fade682d1L, -0x64fa9773d4c193e1L, 0x1f83d9abfb41bd6bL, 0x5be0cd19137e2179L,
        )
        private val SIGMA = arrayOf(
            intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15), intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3),
            intArrayOf(11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4), intArrayOf(7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8),
            intArrayOf(9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13), intArrayOf(2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9),
            intArrayOf(12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11), intArrayOf(13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10),
            intArrayOf(6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5), intArrayOf(10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0),
        )
        fun hash(data: ByteArray, length: Int) = Blake2b(length).apply { update(data) }.finish()
    }
}

/** Argon2id (RFC 9106, version 0x13), turning a vault's PIN into the key that unwraps its vault key. */
object Argon2id {
    private const val WORDS = 128
    private const val SYNC = 4

    private fun le32(n: Int) = ByteArray(4) { (n ushr (8 * it)).toByte() }

    fun longHash(input: ByteArray, length: Int): ByteArray {
        val prefixed = le32(length) + input
        if (length <= 64) return Blake2b.hash(prefixed, length)
        val r = (length + 31) / 32 - 2
        var v = Blake2b.hash(prefixed, 64)
        var out = v.copyOf(32)
        for (i in 1 until r) { v = Blake2b.hash(v, 64); out += v.copyOf(32) }
        return out + Blake2b.hash(v, length - 32 * r)
    }

    fun hash(password: ByteArray, salt: ByteArray, secret: ByteArray = ByteArray(0), associated: ByteArray = ByteArray(0), memoryKiB: Int, iterations: Int, parallelism: Int, length: Int): ByteArray {
        val lanes = parallelism
        val h0 = Blake2b.hash(
            le32(lanes) + le32(length) + le32(memoryKiB) + le32(iterations) + le32(0x13) + le32(2) + le32(password.size) + password + le32(salt.size) + salt +
                le32(secret.size) + secret + le32(associated.size) + associated, 64,
        )
        val blocks = maxOf(memoryKiB, 2 * SYNC * lanes) / (SYNC * lanes) * (SYNC * lanes)
        val laneLength = blocks / lanes
        val segment = laneLength / SYNC
        val mem = LongArray(blocks * WORDS)
        fun load(bytes: ByteArray, block: Int) {
            for (w in 0 until WORDS) { var word = 0L; for (k in 0 until 8) word = word or ((bytes[w * 8 + k].toLong() and 0xFF) shl (8 * k)); mem[block * WORDS + w] = word }
        }
        for (lane in 0 until lanes) {
            load(longHash(h0 + le32(0) + le32(lane), 1024), lane * laneLength)
            load(longHash(h0 + le32(1) + le32(lane), 1024), lane * laneLength + 1)
        }
        val input = LongArray(WORDS)
        val address = LongArray(WORDS)
        val r = LongArray(WORDS)
        val keep = LongArray(WORDS)
        for (pass in 0 until iterations) for (slice in 0 until SYNC) for (lane in 0 until lanes) {
            val independent = pass == 0 && slice < SYNC / 2
            if (independent) {
                input.fill(0)
                input[0] = pass.toLong(); input[1] = lane.toLong(); input[2] = slice.toLong(); input[3] = blocks.toLong(); input[4] = iterations.toLong(); input[5] = 2
            }
            fun nextAddresses() { input[6] += 1; fill(input, address) }
            var start = 0
            if (pass == 0 && slice == 0) { start = 2; if (independent) nextAddresses() }
            for (index in start until segment) {
                val column = slice * segment + index
                val current = lane * laneLength + column
                val previous = if (column == 0) lane * laneLength + laneLength - 1 else current - 1
                val pseudo = if (independent) { if (index % WORDS == 0) nextAddresses(); address[index % WORDS] } else mem[previous * WORDS]
                val refLane = if (pass == 0 && slice == 0) lane else ((pseudo ushr 32) % lanes).toInt()
                val same = refLane == lane
                val area = if (pass == 0) {
                    if (slice == 0) index - 1 else slice * segment + (if (same) index - 1 else if (index == 0) -1 else 0)
                } else laneLength - segment + (if (same) index - 1 else if (index == 0) -1 else 0)
                var relative = pseudo and 0xFFFFFFFFL
                relative = (relative * relative) ushr 32
                val offset = area.toLong() - 1 - ((area.toLong() * relative) ushr 32)
                val startPosition = if (pass == 0 || slice == SYNC - 1) 0 else (slice + 1) * segment
                val refIndex = ((startPosition.toLong() + offset) % laneLength).toInt()
                val reference = refLane * laneLength + refIndex
                for (i in 0 until WORDS) {
                    val v = mem[previous * WORDS + i] xor mem[reference * WORDS + i]
                    r[i] = v
                    keep[i] = if (pass > 0) v xor mem[current * WORDS + i] else v
                }
                permute(r)
                for (i in 0 until WORDS) mem[current * WORDS + i] = r[i] xor keep[i]
            }
        }
        val final = LongArray(WORDS)
        for (lane in 0 until lanes) { val last = (lane * laneLength + laneLength - 1) * WORDS; for (w in 0 until WORDS) final[w] = final[w] xor mem[last + w] }
        val bytes = ByteArray(1024)
        for (w in 0 until WORDS) for (k in 0 until 8) bytes[w * 8 + k] = (final[w] ushr (8 * k)).toByte()
        return longHash(bytes, length)
    }

    private fun fill(input: LongArray, address: LongArray) {
        val r = input.copyOf()
        permute(r)
        val once = LongArray(WORDS) { r[it] xor input[it] }
        val r2 = once.copyOf()
        permute(r2)
        for (i in 0 until WORDS) address[i] = r2[i] xor once[i]
    }

    private fun blaMka(x: Long, y: Long) = x + y + 2 * (x and 0xFFFFFFFFL) * (y and 0xFFFFFFFFL)

    private fun gb(v: LongArray, a: Int, b: Int, c: Int, d: Int) {
        v[a] = blaMka(v[a], v[b]); v[d] = (v[d] xor v[a]).rotateRight(32)
        v[c] = blaMka(v[c], v[d]); v[b] = (v[b] xor v[c]).rotateRight(24)
        v[a] = blaMka(v[a], v[b]); v[d] = (v[d] xor v[a]).rotateRight(16)
        v[c] = blaMka(v[c], v[d]); v[b] = (v[b] xor v[c]).rotateRight(63)
    }

    private fun round(v: LongArray, i: IntArray) {
        gb(v, i[0], i[4], i[8], i[12]); gb(v, i[1], i[5], i[9], i[13]); gb(v, i[2], i[6], i[10], i[14]); gb(v, i[3], i[7], i[11], i[15])
        gb(v, i[0], i[5], i[10], i[15]); gb(v, i[1], i[6], i[11], i[12]); gb(v, i[2], i[7], i[8], i[13]); gb(v, i[3], i[4], i[9], i[14])
    }

    private val rows = Array(8) { r -> IntArray(16) { 16 * r + it } }
    private val columns = Array(8) { c -> IntArray(16) { k -> 2 * c + (k % 2) + 16 * (k / 2) } }

    private fun permute(v: LongArray) {
        for (r in rows) round(v, r)
        for (c in columns) round(v, c)
    }
}
