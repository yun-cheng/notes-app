import Foundation

/// BLAKE2b (RFC 7693), unkeyed, as Argon2 uses it.
struct Blake2b {
    private static let iv: [UInt64] = [
        0x6a09_e667_f3bc_c908, 0xbb67_ae85_84ca_a73b, 0x3c6e_f372_fe94_f82b, 0xa54f_f53a_5f1d_36f1,
        0x510e_527f_ade6_82d1, 0x9b05_688c_2b3e_6c1f, 0x1f83_d9ab_fb41_bd6b, 0x5be0_cd19_137e_2179,
    ]
    private static let sigma: [[Int]] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
        [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
        [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
        [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
        [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
        [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
        [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
        [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
        [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
    ]

    private var h: [UInt64]
    private var counter: UInt64 = 0
    private var buffer: [UInt8] = []
    private let length: Int

    init(length: Int) {
        precondition((1...64).contains(length))
        self.length = length
        h = Self.iv
        h[0] ^= 0x0101_0000 ^ UInt64(length)
    }

    static func hash(_ data: [UInt8], length: Int) -> [UInt8] {
        var b = Blake2b(length: length)
        b.update(data)
        return b.finish()
    }

    mutating func update(_ data: [UInt8]) {
        buffer.append(contentsOf: data)
        // The last block is kept back, because it has to be compressed as the final one.
        while buffer.count > 128 {
            counter &+= 128
            compress(Array(buffer[0..<128]), last: false)
            buffer.removeFirst(128)
        }
    }

    mutating func finish() -> [UInt8] {
        counter &+= UInt64(buffer.count)
        compress(buffer + [UInt8](repeating: 0, count: 128 - buffer.count), last: true)
        var out: [UInt8] = []
        out.reserveCapacity(64)
        for word in h { for i in 0..<8 { out.append(UInt8(truncatingIfNeeded: word >> (8 * UInt64(i)))) } }
        return Array(out[0..<length])
    }

    @inline(__always) private static func rotr(_ x: UInt64, _ n: UInt64) -> UInt64 { (x >> n) | (x << (64 - n)) }

    private mutating func compress(_ block: [UInt8], last: Bool) {
        var m = [UInt64](repeating: 0, count: 16)
        for i in 0..<16 {
            var w: UInt64 = 0
            for j in 0..<8 { w |= UInt64(block[i * 8 + j]) << (8 * UInt64(j)) }
            m[i] = w
        }
        var v = h + Self.iv
        v[12] ^= counter
        if last { v[14] = ~v[14] }
        func g(_ a: Int, _ b: Int, _ c: Int, _ d: Int, _ x: UInt64, _ y: UInt64) {
            v[a] = v[a] &+ v[b] &+ x
            v[d] = Self.rotr(v[d] ^ v[a], 32)
            v[c] = v[c] &+ v[d]
            v[b] = Self.rotr(v[b] ^ v[c], 24)
            v[a] = v[a] &+ v[b] &+ y
            v[d] = Self.rotr(v[d] ^ v[a], 16)
            v[c] = v[c] &+ v[d]
            v[b] = Self.rotr(v[b] ^ v[c], 63)
        }
        for round in 0..<12 {
            let s = Self.sigma[round % 10]
            g(0, 4, 8, 12, m[s[0]], m[s[1]])
            g(1, 5, 9, 13, m[s[2]], m[s[3]])
            g(2, 6, 10, 14, m[s[4]], m[s[5]])
            g(3, 7, 11, 15, m[s[6]], m[s[7]])
            g(0, 5, 10, 15, m[s[8]], m[s[9]])
            g(1, 6, 11, 12, m[s[10]], m[s[11]])
            g(2, 7, 8, 13, m[s[12]], m[s[13]])
            g(3, 4, 9, 14, m[s[14]], m[s[15]])
        }
        for i in 0..<8 { h[i] ^= v[i] ^ v[i + 8] }
    }
}

/// Argon2id (RFC 9106, version 0x13), used to turn a vault's PIN into the key that unwraps its vault key.
public enum Argon2id {
    private static let blockWords = 128
    private static let syncPoints = 4

    private static func le32(_ n: Int) -> [UInt8] { (0..<4).map { UInt8(truncatingIfNeeded: n >> (8 * $0)) } }

    /// The variable-length hash H' from RFC 9106 section 3.3.
    static func longHash(_ input: [UInt8], length: Int) -> [UInt8] {
        let prefixed = le32(length) + input
        if length <= 64 { return Blake2b.hash(prefixed, length: length) }
        let r = (length + 31) / 32 - 2
        var v = Blake2b.hash(prefixed, length: 64)
        var out = Array(v[0..<32])
        for _ in 1..<r {
            v = Blake2b.hash(v, length: 64)
            out += v[0..<32]
        }
        return out + Blake2b.hash(v, length: length - 32 * r)
    }

    public static func hash(
        password: Data, salt: Data, secret: Data = Data(), associated: Data = Data(),
        memoryKiB: Int, iterations: Int, parallelism: Int, length: Int
    ) -> Data {
        let lanes = parallelism
        var h0Input = le32(lanes) + le32(length) + le32(memoryKiB) + le32(iterations) + le32(0x13) + le32(2)
        h0Input += le32(password.count) + [UInt8](password) + le32(salt.count) + [UInt8](salt)
        h0Input += le32(secret.count) + [UInt8](secret) + le32(associated.count) + [UInt8](associated)
        let h0 = Blake2b.hash(h0Input, length: 64)

        let blocks = max(memoryKiB, 2 * syncPoints * lanes) / (syncPoints * lanes) * (syncPoints * lanes)
        let laneLength = blocks / lanes
        let segmentLength = laneLength / syncPoints
        var memory = [UInt64](repeating: 0, count: blocks * blockWords)

        memory.withUnsafeMutableBufferPointer { mem in
            func load(_ bytes: [UInt8], into block: Int) {
                for w in 0..<blockWords {
                    var word: UInt64 = 0
                    for j in 0..<8 { word |= UInt64(bytes[w * 8 + j]) << (8 * UInt64(j)) }
                    mem[block * blockWords + w] = word
                }
            }
            for lane in 0..<lanes {
                load(longHash(h0 + le32(0) + le32(lane), length: 1024), into: lane * laneLength)
                load(longHash(h0 + le32(1) + le32(lane), length: 1024), into: lane * laneLength + 1)
            }

            var scratch = [UInt64](repeating: 0, count: blockWords * 2)
            var input = [UInt64](repeating: 0, count: blockWords)
            var address = [UInt64](repeating: 0, count: blockWords)

            for pass in 0..<iterations {
                for slice in 0..<syncPoints {
                    for lane in 0..<lanes {
                        let independent = pass == 0 && slice < syncPoints / 2
                        if independent {
                            for i in 0..<blockWords { input[i] = 0 }
                            input[0] = UInt64(pass)
                            input[1] = UInt64(lane)
                            input[2] = UInt64(slice)
                            input[3] = UInt64(blocks)
                            input[4] = UInt64(iterations)
                            input[5] = 2
                        }
                        func nextAddresses() {
                            input[6] &+= 1
                            fill(input, into: &address)
                        }
                        var start = 0
                        if pass == 0 && slice == 0 {
                            start = 2
                            if independent { nextAddresses() }
                        }
                        for index in start..<segmentLength {
                            let column = slice * segmentLength + index
                            let current = lane * laneLength + column
                            let previous = column == 0 ? lane * laneLength + laneLength - 1 : current - 1
                            let pseudo: UInt64
                            if independent {
                                if index % blockWords == 0 { nextAddresses() }
                                pseudo = address[index % blockWords]
                            } else {
                                pseudo = mem[previous * blockWords]
                            }
                            let refLane = pass == 0 && slice == 0 ? lane : Int((pseudo >> 32) % UInt64(lanes))
                            let sameLane = refLane == lane
                            let area: Int
                            if pass == 0 {
                                if slice == 0 {
                                    area = index - 1
                                } else {
                                    area = slice * segmentLength + (sameLane ? index - 1 : (index == 0 ? -1 : 0))
                                }
                            } else {
                                area = laneLength - segmentLength + (sameLane ? index - 1 : (index == 0 ? -1 : 0))
                            }
                            var relative = pseudo & 0xFFFF_FFFF
                            relative = (relative &* relative) >> 32
                            let offset = UInt64(area) - 1 - ((UInt64(area) &* relative) >> 32)
                            let startPosition = pass == 0 || slice == syncPoints - 1 ? 0 : (slice + 1) * segmentLength
                            let refIndex = (UInt64(startPosition) + offset) % UInt64(laneLength)
                            let reference = refLane * laneLength + Int(refIndex)
                            compressBlocks(mem, previous: previous, reference: reference, into: current, xor: pass > 0, scratch: &scratch)
                        }
                    }
                }
            }
        }

        var final = [UInt64](repeating: 0, count: blockWords)
        for lane in 0..<lanes {
            let last = (lane * laneLength + laneLength - 1) * blockWords
            for w in 0..<blockWords { final[w] ^= memory[last + w] }
        }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(1024)
        for word in final { for j in 0..<8 { bytes.append(UInt8(truncatingIfNeeded: word >> (8 * UInt64(j)))) } }
        return Data(longHash(bytes, length: length))
    }

    /// address = G(zero, G(zero, input)), for data-independent addressing. G(0, x) is P(x) xor x.
    private static func fill(_ input: [UInt64], into address: inout [UInt64]) {
        var r = input
        r.withUnsafeMutableBufferPointer { permute($0) }
        let once = (0..<blockWords).map { r[$0] ^ input[$0] }
        var r2 = once
        r2.withUnsafeMutableBufferPointer { permute($0) }
        for i in 0..<blockWords { address[i] = r2[i] ^ once[i] }
    }

    /// next = G(prev, ref), or next ^= G(prev, ref) after the first pass.
    private static func compressBlocks(
        _ mem: UnsafeMutableBufferPointer<UInt64>, previous: Int, reference: Int, into next: Int, xor: Bool, scratch: inout [UInt64]
    ) {
        scratch.withUnsafeMutableBufferPointer { s in
            let r = UnsafeMutableBufferPointer(rebasing: s[0..<blockWords])
            let keep = UnsafeMutableBufferPointer(rebasing: s[blockWords..<(2 * blockWords)])
            for i in 0..<blockWords {
                let v = mem[previous * blockWords + i] ^ mem[reference * blockWords + i]
                r[i] = v
                keep[i] = xor ? v ^ mem[next * blockWords + i] : v
            }
            permute(r)
            for i in 0..<blockWords { mem[next * blockWords + i] = r[i] ^ keep[i] }
        }
    }

    @inline(__always) private static func rotr(_ x: UInt64, _ n: UInt64) -> UInt64 { (x >> n) | (x << (64 - n)) }

    @inline(__always) private static func blaMka(_ x: UInt64, _ y: UInt64) -> UInt64 {
        x &+ y &+ 2 &* (x & 0xFFFF_FFFF) &* (y & 0xFFFF_FFFF)
    }

    @inline(__always) private static func gb(_ v: UnsafeMutableBufferPointer<UInt64>, _ a: Int, _ b: Int, _ c: Int, _ d: Int) {
        v[a] = blaMka(v[a], v[b])
        v[d] = rotr(v[d] ^ v[a], 32)
        v[c] = blaMka(v[c], v[d])
        v[b] = rotr(v[b] ^ v[c], 24)
        v[a] = blaMka(v[a], v[b])
        v[d] = rotr(v[d] ^ v[a], 16)
        v[c] = blaMka(v[c], v[d])
        v[b] = rotr(v[b] ^ v[c], 63)
    }

    /// The BlaMka round on 16 words, given by their positions in the block.
    @inline(__always) private static func round(_ v: UnsafeMutableBufferPointer<UInt64>, _ i: [Int]) {
        gb(v, i[0], i[4], i[8], i[12])
        gb(v, i[1], i[5], i[9], i[13])
        gb(v, i[2], i[6], i[10], i[14])
        gb(v, i[3], i[7], i[11], i[15])
        gb(v, i[0], i[5], i[10], i[15])
        gb(v, i[1], i[6], i[11], i[12])
        gb(v, i[2], i[7], i[8], i[13])
        gb(v, i[3], i[4], i[9], i[14])
    }

    private static let rows: [[Int]] = (0..<8).map { r in (0..<16).map { 16 * r + $0 } }
    private static let columns: [[Int]] = (0..<8).map { (c: Int) -> [Int] in
        var out: [Int] = []
        for j in 0..<8 {
            out.append(2 * c + 16 * j)
            out.append(2 * c + 1 + 16 * j)
        }
        return out
    }

    private static func permute(_ v: UnsafeMutableBufferPointer<UInt64>) {
        for r in rows { round(v, r) }
        for c in columns { round(v, c) }
    }
}
