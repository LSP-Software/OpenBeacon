import Foundation
import SQLite3

struct CiphertextQueueRow {
  static let statusPending = "PENDING"
  static let statusInFlight = "IN_FLIGHT"

  var id: Int64 = 0
  var owner: String? = nil
  var clientPointId: String
  let captureId: String
  let groupId: String
  let epochId: String
  let senderDeviceId: String
  let kind: String
  let algorithm: String
  let nonce: String
  let ciphertext: String
  let queuedAt: Int64
  var attemptCount: Int64 = 0
  var lastAttemptAt: Int64? = nil
  var lastError: String? = nil
  var status = CiphertextQueueRow.statusPending
}

struct PlaceTransitionRow {
  let clientId: String
  let owner: String
  let senderDeviceId: String
  let groupId: String
  let placeId: String
  let direction: String
  let occurredAt: Int64
}

enum SQLValue {
  case text(String?)
  case integer(Int64?)
}

struct TrackingDatabaseError: Error {
  let message: String
}

final class TrackingDatabase {
  static let maxDatabaseBytes: Int64 = 9 * 1024 * 1024
  static let maxWalBytes: Int64 = 1024 * 1024
  static let maxPlaceTransitions = 500

  private static let instanceLock = NSLock()
  private static var instance: TrackingDatabase?

  static func shared() throws -> TrackingDatabase {
    instanceLock.lock()
    defer { instanceLock.unlock() }
    if let instance { return instance }
    let opened = try TrackingDatabase()
    instance = opened
    return opened
  }

  private let lock = NSRecursiveLock()
  private var db: OpaquePointer?

  private init() throws {
    let directory = try FileManager.default
      .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("OpenBeaconTracking", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    var excluded = URLResourceValues()
    excluded.isExcludedFromBackup = true
    var backupExcludedDirectory = directory
    try backupExcludedDirectory.setResourceValues(excluded)

    let path = directory.appendingPathComponent("tracking.sqlite").path
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      throw TrackingDatabaseError(message: "Could not open \(path).")
    }
    try execute("PRAGMA journal_mode = WAL")
    try execute("PRAGMA journal_size_limit = \(Self.maxWalBytes)")
    try execute("PRAGMA wal_autocheckpoint = 128")
    try execute(
      """
      CREATE TABLE IF NOT EXISTS ciphertext_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT,
        clientPointId TEXT NOT NULL,
        captureId TEXT NOT NULL,
        groupId TEXT NOT NULL,
        epochId TEXT NOT NULL,
        senderDeviceId TEXT NOT NULL,
        kind TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        queuedAt INTEGER NOT NULL,
        attemptCount INTEGER NOT NULL DEFAULT 0,
        lastAttemptAt INTEGER,
        lastError TEXT,
        status TEXT NOT NULL
      )
      """
    )
    try execute("CREATE UNIQUE INDEX IF NOT EXISTS ciphertext_queue_clientPointId ON ciphertext_queue (clientPointId)")
    try execute("CREATE INDEX IF NOT EXISTS ciphertext_queue_status_id ON ciphertext_queue (status, id)")
    try execute("CREATE INDEX IF NOT EXISTS ciphertext_queue_groupId_id ON ciphertext_queue (groupId, id)")
    try execute(
      """
      CREATE TABLE IF NOT EXISTS ciphertext_queue_eviction (
        owner TEXT NOT NULL PRIMARY KEY,
        pointCount INTEGER NOT NULL,
        oldestQueuedAt INTEGER NOT NULL,
        newestQueuedAt INTEGER NOT NULL,
        revision INTEGER NOT NULL
      )
      """
    )
    try execute(
      """
      CREATE TABLE IF NOT EXISTS place_transition_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId TEXT NOT NULL,
        owner TEXT NOT NULL,
        senderDeviceId TEXT NOT NULL,
        groupId TEXT NOT NULL,
        placeId TEXT NOT NULL,
        direction TEXT NOT NULL,
        occurredAt INTEGER NOT NULL
      )
      """
    )
    try execute("CREATE UNIQUE INDEX IF NOT EXISTS place_transition_queue_clientId ON place_transition_queue (clientId)")
    try execute("CREATE INDEX IF NOT EXISTS place_transition_queue_owner_id ON place_transition_queue (owner, id)")
    try execute("CREATE INDEX IF NOT EXISTS place_transition_queue_group_place ON place_transition_queue (groupId, placeId)")
  }

  func transaction<T>(_ body: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    try execute("BEGIN IMMEDIATE")
    do {
      let result = try body()
      try execute("COMMIT")
      return result
    } catch {
      _ = try? execute("ROLLBACK")
      throw error
    }
  }

  @discardableResult
  func execute(_ sql: String, _ values: [SQLValue] = []) throws -> Int {
    lock.lock()
    defer { lock.unlock() }
    let statement = try prepare(sql, values)
    defer { sqlite3_finalize(statement) }
    let result = sqlite3_step(statement)
    guard result == SQLITE_DONE || result == SQLITE_ROW else { throw lastError(sql) }
    return Int(sqlite3_changes(db))
  }

  func query<T>(_ sql: String, _ values: [SQLValue] = [], _ read: (OpaquePointer) -> T) throws -> [T] {
    lock.lock()
    defer { lock.unlock() }
    let statement = try prepare(sql, values)
    defer { sqlite3_finalize(statement) }
    var rows: [T] = []
    while true {
      let result = sqlite3_step(statement)
      if result == SQLITE_DONE { return rows }
      guard result == SQLITE_ROW, let statement else { throw lastError(sql) }
      rows.append(read(statement))
    }
  }

  private func prepare(_ sql: String, _ values: [SQLValue]) throws -> OpaquePointer? {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError(sql) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, value) in values.enumerated() {
      let position = Int32(index + 1)
      switch value {
      case let .text(text?): sqlite3_bind_text(statement, position, text, -1, transient)
      case let .integer(number?): sqlite3_bind_int64(statement, position, number)
      case .text(nil), .integer(nil): sqlite3_bind_null(statement, position)
      }
    }
    return statement
  }

  private func lastError(_ sql: String) -> TrackingDatabaseError {
    TrackingDatabaseError(message: "\(String(cString: sqlite3_errmsg(db))) in \(sql)")
  }

  private func usedBytes() throws -> Int64 {
    let pragma = { (name: String) throws -> Int64 in
      try self.query("PRAGMA \(name)") { sqlite3_column_int64($0, 0) }.first ?? 0
    }
    return try (pragma("page_count") - pragma("freelist_count")) * pragma("page_size")
  }

  private func placeholders(_ count: Int) -> String {
    Array(repeating: "?", count: count).joined(separator: ",")
  }

  private func forEachChunk<T>(_ items: [T], _ body: ([T]) throws -> Void) throws {
    var start = 0
    while start < items.count {
      let end = min(start + 500, items.count)
      try body(Array(items[start..<end]))
      start = end
    }
  }

  private static func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
    sqlite3_column_type(statement, column) == SQLITE_NULL ? nil : String(cString: sqlite3_column_text(statement, column))
  }

  private static func integer(_ statement: OpaquePointer, _ column: Int32) -> Int64? {
    sqlite3_column_type(statement, column) == SQLITE_NULL ? nil : sqlite3_column_int64(statement, column)
  }

  private static func ciphertextRow(_ statement: OpaquePointer) -> CiphertextQueueRow {
    CiphertextQueueRow(
      id: sqlite3_column_int64(statement, 0),
      owner: text(statement, 1),
      clientPointId: text(statement, 2) ?? "",
      captureId: text(statement, 3) ?? "",
      groupId: text(statement, 4) ?? "",
      epochId: text(statement, 5) ?? "",
      senderDeviceId: text(statement, 6) ?? "",
      kind: text(statement, 7) ?? "",
      algorithm: text(statement, 8) ?? "",
      nonce: text(statement, 9) ?? "",
      ciphertext: text(statement, 10) ?? "",
      queuedAt: sqlite3_column_int64(statement, 11),
      attemptCount: sqlite3_column_int64(statement, 12),
      lastAttemptAt: integer(statement, 13),
      lastError: text(statement, 14),
      status: text(statement, 15) ?? CiphertextQueueRow.statusPending
    )
  }

  private static let ciphertextColumns =
    "id, owner, clientPointId, captureId, groupId, epochId, senderDeviceId, kind, algorithm, nonce, ciphertext, queuedAt, attemptCount, lastAttemptAt, lastError, status"

  func insertCiphertexts(_ rows: [CiphertextQueueRow]) throws -> Int {
    try transaction {
      var inserted = 0
      for row in rows {
        inserted += try execute(
          """
          INSERT OR IGNORE INTO ciphertext_queue
          (owner, clientPointId, captureId, groupId, epochId, senderDeviceId, kind, algorithm, nonce, ciphertext, queuedAt, attemptCount, lastAttemptAt, lastError, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
          [
            .text(row.owner), .text(row.clientPointId), .text(row.captureId), .text(row.groupId), .text(row.epochId),
            .text(row.senderDeviceId), .text(row.kind), .text(row.algorithm), .text(row.nonce), .text(row.ciphertext),
            .integer(row.queuedAt), .integer(row.attemptCount), .integer(row.lastAttemptAt), .text(row.lastError), .text(row.status),
          ]
        )
      }
      if inserted > 0 { try evictOldestPendingOverLimit() }
      return inserted
    }
  }

  private func evictOldestPendingOverLimit() throws {
    while true {
      let used = try usedBytes()
      if used <= Self.maxDatabaseBytes { return }
      let rowCount = try query("SELECT COUNT(*) FROM ciphertext_queue") { sqlite3_column_int64($0, 0) }.first ?? 0
      if rowCount == 0 { return }
      let overflow = min((used - Self.maxDatabaseBytes) * rowCount / used + 1, 500)
      let evicted = try query(
        "SELECT \(Self.ciphertextColumns) FROM ciphertext_queue WHERE status = ? ORDER BY id ASC LIMIT ?",
        [.text(CiphertextQueueRow.statusPending), .integer(overflow)],
        Self.ciphertextRow
      )
      if evicted.isEmpty { return }
      try deleteCiphertexts(ids: evicted.map(\.id))
      for (owner, ownerRows) in Dictionary(grouping: evicted, by: \.owner) {
        guard let owner else { continue }
        let existing = try ciphertextEviction(owner: owner)
        try execute(
          "INSERT OR REPLACE INTO ciphertext_queue_eviction (owner, pointCount, oldestQueuedAt, newestQueuedAt, revision) VALUES (?, ?, ?, ?, ?)",
          [
            .text(owner),
            .integer((existing?.pointCount ?? 0) + Int64(ownerRows.count)),
            .integer(min(existing?.oldestQueuedAt ?? .max, ownerRows.map(\.queuedAt).min() ?? .max)),
            .integer(max(existing?.newestQueuedAt ?? .min, ownerRows.map(\.queuedAt).max() ?? .min)),
            .integer(max((existing?.revision ?? 0) + 1, Int64(Date().timeIntervalSince1970 * 1000))),
          ]
        )
      }
    }
  }

  func ciphertextEviction(owner: String) throws -> (pointCount: Int64, oldestQueuedAt: Int64, newestQueuedAt: Int64, revision: Int64)? {
    try query(
      "SELECT pointCount, oldestQueuedAt, newestQueuedAt, revision FROM ciphertext_queue_eviction WHERE owner = ?",
      [.text(owner)]
    ) { (sqlite3_column_int64($0, 0), sqlite3_column_int64($0, 1), sqlite3_column_int64($0, 2), sqlite3_column_int64($0, 3)) }.first
  }

  func acknowledgeCiphertextEviction(owner: String, revision: Int64) throws {
    try execute("DELETE FROM ciphertext_queue_eviction WHERE owner = ? AND revision = ?", [.text(owner), .integer(revision)])
  }

  func listCiphertexts(status: String, limit: Int, owner: String?, afterId: Int64) throws -> [CiphertextQueueRow] {
    try execute(
      "UPDATE ciphertext_queue SET status = ? WHERE status = ? AND lastAttemptAt < ?",
      [.text(CiphertextQueueRow.statusPending), .text(CiphertextQueueRow.statusInFlight), .integer(Int64(Date().timeIntervalSince1970 * 1000) - 120_000)]
    )
    return try query(
      "SELECT \(Self.ciphertextColumns) FROM ciphertext_queue WHERE status = ? AND id > ? AND (? IS NULL OR owner = ?) ORDER BY id ASC LIMIT ?",
      [.text(status), .integer(afterId), .text(owner), .text(owner), .integer(Int64(max(limit, 0)))],
      Self.ciphertextRow
    )
  }

  func markCiphertextsInFlight(ids: [Int64], attemptedAt: Int64) throws -> [Int64] {
    if ids.isEmpty { return [] }
    return try transaction {
      var claimed: [Int64] = []
      try forEachChunk(ids) { chunk in
        claimed += try query(
          "SELECT id FROM ciphertext_queue WHERE status = ? AND id IN (\(placeholders(chunk.count)))",
          [.text(CiphertextQueueRow.statusPending)] + chunk.map { .integer($0) }
        ) { sqlite3_column_int64($0, 0) }
      }
      try forEachChunk(claimed) { chunk in
        try execute(
          "UPDATE ciphertext_queue SET status = ?, attemptCount = attemptCount + 1, lastAttemptAt = ? WHERE id IN (\(placeholders(chunk.count)))",
          [.text(CiphertextQueueRow.statusInFlight), .integer(attemptedAt)] + chunk.map { .integer($0) }
        )
      }
      return claimed
    }
  }

  func requeueCiphertexts(ids: [Int64], attemptedAt: Int64, error: String?) throws {
    try forEachChunk(ids) { chunk in
      try execute(
        "UPDATE ciphertext_queue SET status = ?, lastAttemptAt = ?, lastError = ? WHERE id IN (\(placeholders(chunk.count)))",
        [.text(CiphertextQueueRow.statusPending), .integer(attemptedAt), .text(error)] + chunk.map { .integer($0) }
      )
    }
  }

  func deleteCiphertexts(ids: [Int64]) throws {
    try forEachChunk(ids) { chunk in
      try execute("DELETE FROM ciphertext_queue WHERE id IN (\(placeholders(chunk.count)))", chunk.map { .integer($0) })
    }
  }

  func deleteCiphertexts(owner: String) throws {
    try execute("DELETE FROM ciphertext_queue WHERE owner = ?", [.text(owner)])
  }

  func deleteCiphertexts(owner: String, groupId: String) throws {
    try execute("DELETE FROM ciphertext_queue WHERE owner = ? AND groupId = ?", [.text(owner), .text(groupId)])
  }

  func countUnassignedCiphertexts(senderDeviceId: String) throws -> Int64 {
    try query(
      "SELECT COUNT(*) FROM ciphertext_queue WHERE owner IS NULL AND senderDeviceId = ?",
      [.text(senderDeviceId)]
    ) { sqlite3_column_int64($0, 0) }.first ?? 0
  }

  func assignUnassignedCiphertexts(senderDeviceId: String, owner: String) throws {
    try execute("UPDATE ciphertext_queue SET owner = ? WHERE owner IS NULL AND senderDeviceId = ?", [.text(owner), .text(senderDeviceId)])
  }

  func insertPlaceTransitions(_ rows: [PlaceTransitionRow]) throws {
    if rows.isEmpty { return }
    try transaction {
      for row in rows {
        try execute(
          "INSERT OR IGNORE INTO place_transition_queue (clientId, owner, senderDeviceId, groupId, placeId, direction, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [.text(row.clientId), .text(row.owner), .text(row.senderDeviceId), .text(row.groupId), .text(row.placeId), .text(row.direction), .integer(row.occurredAt)]
        )
      }
      try execute(
        "DELETE FROM place_transition_queue WHERE id NOT IN (SELECT id FROM place_transition_queue ORDER BY id DESC LIMIT ?)",
        [.integer(Int64(Self.maxPlaceTransitions))]
      )
    }
  }

  func listPlaceTransitions(owner: String, limit: Int) throws -> [PlaceTransitionRow] {
    try query(
      "SELECT clientId, owner, senderDeviceId, groupId, placeId, direction, occurredAt FROM place_transition_queue WHERE owner = ? ORDER BY id ASC LIMIT ?",
      [.text(owner), .integer(Int64(limit))]
    ) {
      PlaceTransitionRow(
        clientId: Self.text($0, 0) ?? "",
        owner: Self.text($0, 1) ?? "",
        senderDeviceId: Self.text($0, 2) ?? "",
        groupId: Self.text($0, 3) ?? "",
        placeId: Self.text($0, 4) ?? "",
        direction: Self.text($0, 5) ?? "",
        occurredAt: sqlite3_column_int64($0, 6)
      )
    }
  }

  func hasPlaceTransitions(owner: String) throws -> Bool {
    try !query("SELECT 1 FROM place_transition_queue WHERE owner = ? LIMIT 1", [.text(owner)]) { _ in true }.isEmpty
  }

  func deletePlaceTransitions(clientIds: [String]) throws {
    try forEachChunk(clientIds) { chunk in
      try execute("DELETE FROM place_transition_queue WHERE clientId IN (\(placeholders(chunk.count)))", chunk.map { .text($0) })
    }
  }

  func deletePlaceTransitions(owner: String?) throws {
    if let owner {
      try execute("DELETE FROM place_transition_queue WHERE owner = ?", [.text(owner)])
    } else {
      try execute("DELETE FROM place_transition_queue")
    }
  }

  func deletePlaceTransitions(groupId: String, except keepPlaceIds: [String]) throws {
    try execute(
      "DELETE FROM place_transition_queue WHERE groupId = ? AND placeId NOT IN (\(placeholders(keepPlaceIds.count)))",
      [.text(groupId)] + keepPlaceIds.map { .text($0) }
    )
  }

  func deletePlaceTransitions(groupIds: [String]) throws {
    try forEachChunk(groupIds) { chunk in
      try execute("DELETE FROM place_transition_queue WHERE groupId IN (\(placeholders(chunk.count)))", chunk.map { .text($0) })
    }
  }
}
