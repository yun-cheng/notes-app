import Foundation
import SQLite3

public struct DatabaseError: Error, CustomStringConvertible {
    public let description: String
}

/// A minimal SQLite connection. Used only from inside the `Repository` actor, one call at a time.
final class Database {
    private var handle: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    enum Value {
        case text(String)
        case int(Int64)
        case null
    }

    /// `path` is a file path, or ":memory:" for tests.
    init(path: String) throws {
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw DatabaseError(description: "Couldn't open the database at \(path)")
        }
        try execute("PRAGMA journal_mode = WAL")
    }

    deinit { sqlite3_close_v2(handle) }

    private func failure() -> DatabaseError {
        DatabaseError(description: String(cString: sqlite3_errmsg(handle)))
    }

    private func prepare(_ sql: String, _ args: [Value]) throws -> OpaquePointer? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw failure() }
        for (i, arg) in args.enumerated() {
            let index = Int32(i + 1)
            switch arg {
            case .text(let s): sqlite3_bind_text(statement, index, s, -1, Self.transient)
            case .int(let n): sqlite3_bind_int64(statement, index, n)
            case .null: sqlite3_bind_null(statement, index)
            }
        }
        return statement
    }

    func execute(_ sql: String, _ args: [Value] = []) throws {
        let statement = try prepare(sql, args)
        defer { sqlite3_finalize(statement) }
        var result = sqlite3_step(statement)
        while result == SQLITE_ROW { result = sqlite3_step(statement) }
        guard result == SQLITE_DONE else { throw failure() }
    }

    /// Rows as arrays of column values, each a String, an Int64, or nil.
    func query(_ sql: String, _ args: [Value] = []) throws -> [[Any?]] {
        let statement = try prepare(sql, args)
        defer { sqlite3_finalize(statement) }
        var rows: [[Any?]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw failure() }
            rows.append((0..<sqlite3_column_count(statement)).map { column -> Any? in
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: sqlite3_column_int64(statement, column)
                case SQLITE_NULL: nil
                default: String(cString: sqlite3_column_text(statement, column))
                }
            })
        }
        return rows
    }

    func transaction<T>(_ work: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try work()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }
}
