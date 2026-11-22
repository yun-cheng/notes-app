import CryptoKit
import Foundation

/// Photos and files in an encrypted vault, sealed on the device before they're kept or uploaded, as the web app's
/// `crypto/attachmentSeal.ts`, byte for byte.
///
/// Layout: "nae1", the piece size (u32), the vault ID's length (u16) and the vault ID, the sealed facts' length
/// (u32) and the sealed facts (IV then ciphertext), then the file in pieces of 1 MiB, each sealed with the file's own
/// key under a nonce of the piece's number and whether it's the last. Numbers are big-endian. The file is padded to a
/// rounder size first, and its facts to a multiple of 128 bytes.
public enum AttachmentSeal {
    static let magic: [UInt8] = [0x6E, 0x61, 0x65, 0x31]
    public static let pieceBytes = 1024 * 1024
    static let tagBytes = 16
    static let factsStep = 128

    /// What a sealed attachment says of itself, once opened.
    public struct Facts: Codable, Sendable, Hashable {
        public var mime: String
        /// Its size before it was sealed.
        public var size: Int
        public var name: String?
        public var width: Double?
        public var height: Double?
        public var duration: Double?

        public init(mime: String, size: Int, name: String? = nil, width: Double? = nil, height: Double? = nil, duration: Double? = nil) {
            self.mime = mime
            self.size = size
            self.name = name
            self.width = width
            self.height = height
            self.duration = duration
        }
    }

    struct Header {
        var vaultId: String
        var pieceBytes: Int
        var bodyAt: Int
        var facts: Data
    }

    /// A file's size rounded up as Padmé does, so many sizes look the same.
    public static func padded(_ size: Int) -> Int {
        if size < 2 { return size }
        let e = Int(log2(Double(size)).rounded(.down))
        let s = Int(log2(Double(e)).rounded(.down)) + 1
        let step = 1 << (e - s)
        return (size + step - 1) / step * step
    }

    static func u32(_ d: Data, _ at: Int) -> Int { d[d.startIndex + at..<d.startIndex + at + 4].reduce(0) { $0 << 8 | Int($1) } }
    static func u16(_ d: Data, _ at: Int) -> Int { d[d.startIndex + at..<d.startIndex + at + 2].reduce(0) { $0 << 8 | Int($1) } }

    static func readHeader(_ data: Data) -> Header? {
        guard data.count >= 14, Array(data.prefix(4)) == magic else { return nil }
        let pieceBytes = u32(data, 4)
        let idLength = u16(data, 8)
        let factsAt = 10 + idLength
        guard pieceBytes >= 1, data.count >= factsAt + 4 else { return nil }
        let vaultId = String(decoding: data[data.startIndex + 10..<data.startIndex + factsAt], as: UTF8.self)
        let factsLength = u32(data, factsAt)
        let bodyAt = factsAt + 4 + factsLength
        guard factsLength >= 12 + tagBytes, data.count >= bodyAt else { return nil }
        return Header(vaultId: vaultId, pieceBytes: pieceBytes, bodyAt: bodyAt, facts: Data(data[data.startIndex + factsAt + 4..<data.startIndex + bodyAt]))
    }

    /// Whether these bytes are a sealed file, and for which vault.
    public static func sealedVault(_ data: Data) -> String? { readHeader(data)?.vaultId }

    static func factsAAD(_ id: String, _ vaultId: String) -> Data { Data("notes-app attachment v1|\(id)|\(vaultId)".utf8) }

    static func nonce(_ index: Int, last: Bool) -> AES.GCM.Nonce {
        var n = [UInt8](repeating: 0, count: 12)
        n[0] = UInt8((index >> 24) & 0xFF)
        n[1] = UInt8((index >> 16) & 0xFF)
        n[2] = UInt8((index >> 8) & 0xFF)
        n[3] = UInt8(index & 0xFF)
        n[11] = last ? 1 : 0
        return try! AES.GCM.Nonce(data: n)
    }

    struct Told: Decodable {
        let k: String
    }

    /// A sealed photo or file opened, with what it says of itself; nil if it isn't sealed or this key doesn't open it.
    public static func open(_ data: Data, id: String, key vaultKey: SymmetricKey) -> (data: Data, facts: Facts)? {
        guard let header = readHeader(data),
            let plain = VaultCrypto.open(vaultKey, header.facts.base64EncodedString(), aad: factsAAD(id, header.vaultId)),
            let facts = try? JSONDecoder().decode(Facts.self, from: plain), let told = try? JSONDecoder().decode(Told.self, from: plain),
            let raw = Data(base64Encoded: told.k)
        else { return nil }
        let key = SymmetricKey(data: raw)
        let sealedPiece = header.pieceBytes + tagBytes
        let body = data.count - header.bodyAt
        let count = max(1, (body + sealedPiece - 1) / sealedPiece)
        var out = Data()
        out.reserveCapacity(body)
        for i in 0..<count {
            let at = data.startIndex + header.bodyAt + i * sealedPiece
            let piece = data[at..<min(data.endIndex, at + sealedPiece)]
            guard piece.count >= tagBytes,
                let box = try? AES.GCM.SealedBox(nonce: nonce(i, last: i == count - 1), ciphertext: piece.dropLast(tagBytes), tag: piece.suffix(tagBytes)),
                let opened = try? AES.GCM.open(box, using: key)
            else { return nil }
            out.append(opened)
        }
        guard out.count == padded(facts.size) || out.count == facts.size else { return nil }
        return (out.prefix(facts.size), facts)
    }

    /// Seals a photo or file for attachment `id` in `vaultId`, under the vault's key.
    public static func seal(_ data: Data, id: String, vaultId: String, key vaultKey: SymmetricKey, facts: Facts) throws -> Data {
        let raw = VaultKeys.random(32)
        let key = SymmetricKey(data: raw)
        var told = facts
        told.size = data.count
        var json = try JSON.encoder.encode(told)
        // The file's key goes in with the facts.
        json = Data(String(decoding: json, as: UTF8.self).dropLast().utf8) + Data(",\"k\":\"\(raw.base64EncodedString())\"}".utf8)
        let length = json.count
        json.append(Data(repeating: 0x20, count: (length + factsStep - 1) / factsStep * factsStep - length))
        let sealedFacts = try AES.GCM.seal(json, using: vaultKey, authenticating: factsAAD(id, vaultId)).combined!
        let vault = Data(vaultId.utf8)
        var out = Data(magic)
        func be(_ v: Int, _ bytes: Int) -> Data { Data((0..<bytes).reversed().map { UInt8((v >> ($0 * 8)) & 0xFF) }) }
        out.append(be(pieceBytes, 4))
        out.append(be(vault.count, 2))
        out.append(vault)
        out.append(be(sealedFacts.count, 4))
        out.append(sealedFacts)
        var plain = data
        plain.append(Data(count: padded(data.count) - data.count))
        let count = max(1, (plain.count + pieceBytes - 1) / pieceBytes)
        for i in 0..<count {
            let piece = plain[plain.startIndex + i * pieceBytes..<min(plain.endIndex, plain.startIndex + (i + 1) * pieceBytes)]
            let box = try AES.GCM.seal(piece, using: key, nonce: nonce(i, last: i == count - 1))
            out.append(box.ciphertext)
            out.append(box.tag)
        }
        return out
    }
}
