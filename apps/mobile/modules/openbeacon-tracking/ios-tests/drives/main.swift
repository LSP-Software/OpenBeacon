import Foundation

var failures = 0

func check(_ condition: @autoclosure () throws -> Bool, _ message: String, line: Int = #line) {
  let passed = (try? condition()) ?? false
  if !passed {
    failures += 1
    print("FAIL line \(line): \(message)")
  }
}

let vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let packData = Data(base64Encoded: vectors["packBase64"] as! String)!
let pack = try SpeedLimitPack.open(DataPackSource(packData))
let header = vectors["header"] as! [String: Any]
let bounds = header["bounds"] as! [String: Int]
let expectedBounds: [Int] = ["minLonE5", "minLatE5", "maxLonE5", "maxLatE5"].map { bounds[$0]! }
let actualBounds: [Int] = [pack.minLonE5, pack.minLatE5, pack.maxLonE5, pack.maxLatE5]

check(SpeedLimitPack.formatVersion == header["formatVersion"] as! Int, "reads format version 1")
check(pack.regionId == header["regionId"] as! String, "reads the region ID")
check(pack.build == header["build"] as! Int, "reads the build date")
check(pack.tileSizeE5 == header["tileSizeE5"] as! Int, "reads the tile size")
check(pack.roadCount == header["roadCount"] as! Int, "reads the road count")
check(pack.tiles.count == header["tileCount"] as! Int, "reads every tile in the directory")
check(actualBounds == expectedBounds, "reads the bounds")

let limitJson = { (limit: RoadLimit) -> NSDictionary in ["source": limit.source.rawValue, "tenthsKmh": limit.tenthsKmh] }
let pieceJson = { (piece: PackRoadPiece) -> NSDictionary in
  [
    "roadId": piece.roadId,
    "roadClass": piece.roadClass,
    "oneway": piece.oneway,
    "forward": limitJson(piece.forward),
    "backward": limitJson(piece.backward),
    "points": piece.lonE5.indices.map { [piece.lonE5[$0], piece.latE5[$0]] },
  ]
}
let decoded = try pack.tiles.map { tile -> NSDictionary in ["x": tile.x, "y": tile.y, "pieces": try pack.readTile(tile).map(pieceJson)] }
check(NSArray(array: decoded).isEqual(to: vectors["tiles"] as! [Any]), "decodes every tile of the shared vector")

for (index, query) in (vectors["queries"] as! [[String: Any]]).enumerated() {
  let roads = try pack.roadsNear(
    latitude: (query["latitude"] as! NSNumber).doubleValue,
    longitude: (query["longitude"] as! NSNumber).doubleValue,
    radiusMeters: (query["radiusMeters"] as! NSNumber).doubleValue
  )
  check(roads.map(\.roadId) == query["roadIds"] as! [Int], "query \(index) finds the roads near the point")
}

let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("speed-limit-pack-\(UUID().uuidString).obsl")
try packData.write(to: fileURL)
let filePack = try SpeedLimitPack.open(try FilePackSource(url: fileURL))
check(try filePack.readTile(filePack.tiles[1]).map(\.roadId) == [0, 1, 2], "reads a pack from a file")
try? FileManager.default.removeItem(at: fileURL)

let invalid = vectors["invalid"] as! [[String: String]]
check(!invalid.isEmpty, "the vector lists invalid packs")
for invalidCase in invalid {
  let rejected: Bool
  do {
    let broken = try SpeedLimitPack.open(DataPackSource(Data(base64Encoded: invalidCase["packBase64"]!)!))
    for tile in broken.tiles {
      _ = try broken.readTile(tile)
    }
    rejected = false
  } catch is SpeedLimitPackError {
    rejected = true
  }
  check(rejected, "rejects a pack with \(invalidCase["name"]!)")
}

if failures > 0 {
  print("\(failures) speed limit pack check(s) failed")
  exit(1)
}
print("Speed limit pack checks passed")
