import Foundation

struct SpeedLimitPackError: Error, CustomStringConvertible {
  let description: String
}

protocol PackSource: AnyObject {
  var size: Int64 { get }
  func read(offset: Int64, length: Int) throws -> [UInt8]
}

final class DataPackSource: PackSource {
  private let bytes: [UInt8]
  let size: Int64

  init(_ data: Data) {
    bytes = [UInt8](data)
    size = Int64(bytes.count)
  }

  func read(offset: Int64, length: Int) throws -> [UInt8] {
    guard offset >= 0, length >= 0, offset + Int64(length) <= size else {
      throw SpeedLimitPackError(description: "Read past the end of the pack")
    }
    return Array(bytes[Int(offset)..<Int(offset) + length])
  }
}

final class FilePackSource: PackSource {
  private let handle: FileHandle
  private let lock = NSLock()
  let size: Int64

  init(url: URL) throws {
    handle = try FileHandle(forReadingFrom: url)
    size = Int64(try handle.seekToEnd())
  }

  deinit {
    try? handle.close()
  }

  func read(offset: Int64, length: Int) throws -> [UInt8] {
    guard offset >= 0, length >= 0, offset + Int64(length) <= size else {
      throw SpeedLimitPackError(description: "Read past the end of the pack")
    }
    lock.lock()
    defer { lock.unlock() }
    try handle.seek(toOffset: UInt64(offset))
    let data = try handle.read(upToCount: length) ?? Data()
    guard data.count == length else {
      throw SpeedLimitPackError(description: "The pack file ends early")
    }
    return [UInt8](data)
  }
}

enum RoadLimitSource: Int {
  case unknown = 0
  case posted = 1
  case roadType = 2
}

struct RoadLimit: Equatable {
  let source: RoadLimitSource
  let tenthsKmh: Int

  var isNoLimit: Bool { source != .unknown && tenthsKmh == 0 }
}

struct PackRoadPiece {
  let roadId: Int
  let roadClass: Int
  let oneway: Bool
  let forward: RoadLimit
  let backward: RoadLimit
  let lonE5: [Int]
  let latE5: [Int]
}

struct PackTile: Hashable {
  let x: Int
  let y: Int
  let offset: Int64
  let length: Int
}

final class SpeedLimitPack {
  static let formatVersion = 1
  private static let fixedHeaderBytes = 42
  private static let directoryEntryBytes = 16
  private static let cachedTiles = 32
  private static let maxRoadClass = 15
  private static let maxTenthsKmh = 3000
  private static let metersPerDegree = 111_320.0

  let regionId: String
  let build: Int
  let tileSizeE5: Int
  let roadCount: Int
  let minLonE5: Int
  let minLatE5: Int
  let maxLonE5: Int
  let maxLatE5: Int
  let tiles: [PackTile]

  private let source: PackSource
  private let lock = NSLock()
  private var cache: [PackTile: [PackRoadPiece]] = [:]
  private var cacheOrder: [PackTile] = []

  private init(source: PackSource, regionId: String, build: Int, tileSizeE5: Int, roadCount: Int, bounds: [Int], tiles: [PackTile]) {
    self.source = source
    self.regionId = regionId
    self.build = build
    self.tileSizeE5 = tileSizeE5
    self.roadCount = roadCount
    minLonE5 = bounds[0]
    minLatE5 = bounds[1]
    maxLonE5 = bounds[2]
    maxLatE5 = bounds[3]
    self.tiles = tiles
  }

  static func open(_ source: PackSource) throws -> SpeedLimitPack {
    guard source.size >= Int64(fixedHeaderBytes) else {
      throw SpeedLimitPackError(description: "The pack is too short")
    }
    let fixed = try source.read(offset: 0, length: fixedHeaderBytes)
    guard Array(fixed[0..<4]) == Array("OBSL".utf8) else {
      throw SpeedLimitPackError(description: "Not a speed limit pack")
    }
    let version = Int(littleEndian(fixed, 4, 2))
    guard version == formatVersion else {
      throw SpeedLimitPackError(description: "Unsupported pack format \(version)")
    }
    let headerLength = Int(littleEndian(fixed, 6, 2))
    let build = Int(Int32(bitPattern: UInt32(littleEndian(fixed, 8, 4))))
    let tileSizeE5 = Int(Int32(bitPattern: UInt32(littleEndian(fixed, 12, 4))))
    let roadCount = Int(Int32(bitPattern: UInt32(littleEndian(fixed, 16, 4))))
    let tileCount = Int64(littleEndian(fixed, 20, 4))
    let bounds = (0..<4).map { Int(Int32(bitPattern: UInt32(littleEndian(fixed, 24 + $0 * 4, 4)))) }
    let regionLength = Int(littleEndian(fixed, 40, 2))
    guard headerLength == fixedHeaderBytes + regionLength, tileSizeE5 > 0, roadCount >= 0 else {
      throw SpeedLimitPackError(description: "The pack header is malformed")
    }
    let directoryEnd = Int64(headerLength) + tileCount * Int64(directoryEntryBytes)
    guard directoryEnd <= source.size else {
      throw SpeedLimitPackError(description: "The tile directory runs past the end of the pack")
    }
    let regionId = String(decoding: try source.read(offset: Int64(fixedHeaderBytes), length: regionLength), as: UTF8.self)
    let directory = try source.read(offset: Int64(headerLength), length: Int(tileCount) * directoryEntryBytes)
    let tiles = try (0..<Int(tileCount)).map { index -> PackTile in
      let base = index * directoryEntryBytes
      let tile = PackTile(
        x: Int(Int32(bitPattern: UInt32(littleEndian(directory, base, 4)))),
        y: Int(Int32(bitPattern: UInt32(littleEndian(directory, base + 4, 4)))),
        offset: Int64(littleEndian(directory, base + 8, 4)),
        length: Int(Int32(bitPattern: UInt32(littleEndian(directory, base + 12, 4))))
      )
      guard tile.length >= 0, tile.offset >= directoryEnd, tile.offset + Int64(tile.length) <= source.size else {
        throw SpeedLimitPackError(description: "Tile \(tile.x),\(tile.y) lies outside the pack")
      }
      return tile
    }
    return SpeedLimitPack(source: source, regionId: regionId, build: build, tileSizeE5: tileSizeE5, roadCount: roadCount, bounds: bounds, tiles: tiles)
  }

  func readTile(_ tile: PackTile) throws -> [PackRoadPiece] {
    lock.lock()
    defer { lock.unlock() }
    if let cached = cache[tile] {
      cacheOrder.removeAll { $0 == tile }
      cacheOrder.append(tile)
      return cached
    }
    let pieces = try decodeTile(tile)
    cache[tile] = pieces
    cacheOrder.append(tile)
    if cacheOrder.count > Self.cachedTiles {
      cache.removeValue(forKey: cacheOrder.removeFirst())
    }
    return pieces
  }

  func roadsNear(latitude: Double, longitude: Double, radiusMeters: Double) throws -> [PackRoadPiece] {
    let latitudeDelta = radiusMeters / Self.metersPerDegree
    let longitudeDelta = radiusMeters / (Self.metersPerDegree * cos(latitude * .pi / 180))
    let minLon = (longitude - longitudeDelta) * 1e5
    let maxLon = (longitude + longitudeDelta) * 1e5
    let minLat = (latitude - latitudeDelta) * 1e5
    let maxLat = (latitude + latitudeDelta) * 1e5
    let size = Double(tileSizeE5)
    let xs = Int((minLon / size).rounded(.down))...Int((maxLon / size).rounded(.down))
    let ys = Int((minLat / size).rounded(.down))...Int((maxLat / size).rounded(.down))

    return try tiles.filter { xs.contains($0.x) && ys.contains($0.y) }.flatMap { tile in
      try readTile(tile).filter { piece in
        Double(piece.lonE5.min()!) <= maxLon && Double(piece.lonE5.max()!) >= minLon &&
          Double(piece.latE5.min()!) <= maxLat && Double(piece.latE5.max()!) >= minLat
      }
    }
  }

  private func decodeTile(_ tile: PackTile) throws -> [PackRoadPiece] {
    var reader = TileReader(bytes: try source.read(offset: tile.offset, length: tile.length))
    let attributes = try (0..<reader.count()).map { _ -> (Int, Bool, RoadLimit, RoadLimit) in
      let roadClass = try reader.byte()
      guard (1...Self.maxRoadClass).contains(roadClass) else {
        throw SpeedLimitPackError(description: "Unknown road class \(roadClass)")
      }
      let onewayFlag = try reader.byte()
      guard onewayFlag <= 1 else {
        throw SpeedLimitPackError(description: "Invalid oneway flag")
      }
      return (roadClass, onewayFlag == 1, try reader.limit(), try reader.limit())
    }
    var roadId = 0
    var lastLon = tile.x * tileSizeE5
    var lastLat = tile.y * tileSizeE5

    let pieces = try (0..<reader.count()).map { _ -> PackRoadPiece in
      roadId += try reader.count()
      guard roadId < roadCount else {
        throw SpeedLimitPackError(description: "Road \(roadId) is beyond the pack's road count")
      }
      let attributeIndex = try reader.count()
      guard attributeIndex < attributes.count else {
        throw SpeedLimitPackError(description: "Missing attribute row")
      }
      let (roadClass, oneway, forward, backward) = attributes[attributeIndex]
      let pointCount = try reader.count()
      guard pointCount >= 2 else {
        throw SpeedLimitPackError(description: "A road piece needs at least two points")
      }
      var lon: [Int] = []
      var lat: [Int] = []
      lon.reserveCapacity(pointCount)
      lat.reserveCapacity(pointCount)
      for _ in 0..<pointCount {
        lastLon += try reader.signed()
        lastLat += try reader.signed()
        lon.append(lastLon)
        lat.append(lastLat)
      }
      return PackRoadPiece(roadId: roadId, roadClass: roadClass, oneway: oneway, forward: forward, backward: backward, lonE5: lon, latE5: lat)
    }
    guard reader.finished else {
      throw SpeedLimitPackError(description: "Tile \(tile.x),\(tile.y) has trailing bytes")
    }
    return pieces
  }

  private struct TileReader {
    let bytes: [UInt8]
    var position = 0

    var finished: Bool { position == bytes.count }

    mutating func byte() throws -> Int {
      guard position < bytes.count else {
        throw SpeedLimitPackError(description: "A tile ends early")
      }
      defer { position += 1 }
      return Int(bytes[position])
    }

    mutating func varint() throws -> UInt64 {
      var result: UInt64 = 0
      var shift: UInt64 = 0
      while true {
        let next = try byte()
        result |= UInt64(next & 0x7F) << shift
        if next < 0x80 {
          return result
        }
        shift += 7
        guard shift <= 35 else {
          throw SpeedLimitPackError(description: "A number in a tile is too long")
        }
      }
    }

    mutating func count() throws -> Int {
      let value = try varint()
      guard value <= UInt64(bytes.count) * 8 else {
        throw SpeedLimitPackError(description: "A count in a tile is larger than the tile")
      }
      return Int(value)
    }

    mutating func signed() throws -> Int {
      let value = try varint()
      return Int(Int64(bitPattern: value >> 1) ^ -Int64(bitPattern: value & 1))
    }

    mutating func limit() throws -> RoadLimit {
      guard let source = RoadLimitSource(rawValue: try byte()) else {
        throw SpeedLimitPackError(description: "Unknown limit source")
      }
      let tenthsKmh = try varint()
      guard tenthsKmh <= UInt64(SpeedLimitPack.maxTenthsKmh) else {
        throw SpeedLimitPackError(description: "A limit is out of range")
      }
      return RoadLimit(source: source, tenthsKmh: Int(tenthsKmh))
    }
  }
}

private func littleEndian(_ bytes: [UInt8], _ offset: Int, _ count: Int) -> UInt64 {
  (0..<count).reduce(UInt64(0)) { $0 | UInt64(bytes[offset + $1]) << (8 * UInt64($1)) }
}
