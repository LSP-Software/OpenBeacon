package expo.modules.openbeacontracking.drives

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.floor

class SpeedLimitPackException(message: String) : Exception(message)

interface PackSource {
  val size: Long

  fun read(offset: Long, length: Int): ByteArray
}

class ByteArrayPackSource(private val bytes: ByteArray) : PackSource {
  override val size = bytes.size.toLong()

  override fun read(offset: Long, length: Int): ByteArray {
    if (offset < 0 || length < 0 || offset + length > size) {
      throw SpeedLimitPackException("Read past the end of the pack")
    }
    return bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
  }
}

class FilePackSource(file: File) : PackSource, Closeable {
  private val handle = RandomAccessFile(file, "r")
  override val size = handle.length()

  @Synchronized
  override fun read(offset: Long, length: Int): ByteArray {
    if (offset < 0 || length < 0 || offset + length > size) {
      throw SpeedLimitPackException("Read past the end of the pack")
    }
    val bytes = ByteArray(length)
    handle.seek(offset)
    handle.readFully(bytes)
    return bytes
  }

  override fun close() = handle.close()
}

enum class RoadLimitSource(val code: Int) {
  Unknown(0),
  Posted(1),
  RoadType(2),
}

data class RoadLimit(val source: RoadLimitSource, val tenthsKmh: Int) {
  val isNoLimit
    get() = source != RoadLimitSource.Unknown && tenthsKmh == 0
}

class PackRoadPiece(
  val roadId: Int,
  val roadClass: Int,
  val oneway: Boolean,
  val forward: RoadLimit,
  val backward: RoadLimit,
  val lonE5: IntArray,
  val latE5: IntArray,
)

data class PackTile(val x: Int, val y: Int, val offset: Long, val length: Int)

class SpeedLimitPack
private constructor(
  private val source: PackSource,
  val regionId: String,
  val build: Int,
  val tileSizeE5: Int,
  val roadCount: Int,
  val minLonE5: Int,
  val minLatE5: Int,
  val maxLonE5: Int,
  val maxLatE5: Int,
  val tiles: List<PackTile>,
) {
  private val tilesByKey = tiles.associateBy { it.x to it.y }
  private val cache =
    object : LinkedHashMap<PackTile, List<PackRoadPiece>>(16, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<PackTile, List<PackRoadPiece>>) =
        size > CACHED_TILES
    }

  @Synchronized
  fun readTile(tile: PackTile): List<PackRoadPiece> = cache.getOrPut(tile) { decodeTile(tile) }

  fun roadsNear(latitude: Double, longitude: Double, radiusMeters: Double): List<PackRoadPiece> {
    val latitudeDelta = radiusMeters / METERS_PER_DEGREE
    val longitudeDelta = radiusMeters / (METERS_PER_DEGREE * cos(Math.toRadians(latitude)))
    val minLon = (longitude - longitudeDelta) * 1e5
    val maxLon = (longitude + longitudeDelta) * 1e5
    val minLat = (latitude - latitudeDelta) * 1e5
    val maxLat = (latitude + latitudeDelta) * 1e5
    val fromX = floor(minLon / tileSizeE5).toInt()
    val toX = floor(maxLon / tileSizeE5).toInt()
    val fromY = floor(minLat / tileSizeE5).toInt()
    val toY = floor(maxLat / tileSizeE5).toInt()
    val result = ArrayList<PackRoadPiece>()

    for (tile in tiles) {
      if (tile.x !in fromX..toX || tile.y !in fromY..toY) {
        continue
      }
      for (piece in readTile(tile)) {
        if (
          piece.lonE5.min() <= maxLon &&
            piece.lonE5.max() >= minLon &&
            piece.latE5.min() <= maxLat &&
            piece.latE5.max() >= minLat
        ) {
          result.add(piece)
        }
      }
    }
    return result
  }

  fun tileAt(x: Int, y: Int): PackTile? = tilesByKey[x to y]

  private fun decodeTile(tile: PackTile): List<PackRoadPiece> {
    val reader = TileReader(source.read(tile.offset, tile.length))
    val attributes =
      List(reader.count()) {
        val roadClass = reader.byte()
        if (roadClass !in 1..MAX_ROAD_CLASS) {
          throw SpeedLimitPackException("Unknown road class $roadClass")
        }
        val oneway =
          when (reader.byte()) {
            0 -> false
            1 -> true
            else -> throw SpeedLimitPackException("Invalid oneway flag")
          }
        Triple(roadClass, oneway, reader.limit() to reader.limit())
      }
    var roadId = 0
    var lastLon = tile.x * tileSizeE5
    var lastLat = tile.y * tileSizeE5

    val pieces =
      List(reader.count()) {
        roadId += reader.count()
        if (roadId >= roadCount) {
          throw SpeedLimitPackException("Road $roadId is beyond the pack's road count")
        }
        val (roadClass, oneway, limits) =
          attributes.getOrNull(reader.count()) ?: throw SpeedLimitPackException("Missing attribute row")
        val pointCount = reader.count()
        if (pointCount < 2) {
          throw SpeedLimitPackException("A road piece needs at least two points")
        }
        val lon = IntArray(pointCount)
        val lat = IntArray(pointCount)
        for (point in 0 until pointCount) {
          lastLon += reader.signed()
          lastLat += reader.signed()
          lon[point] = lastLon
          lat[point] = lastLat
        }
        PackRoadPiece(roadId, roadClass, oneway, limits.first, limits.second, lon, lat)
      }
    if (!reader.finished) {
      throw SpeedLimitPackException("Tile ${tile.x},${tile.y} has trailing bytes")
    }
    return pieces
  }

  private class TileReader(private val bytes: ByteArray) {
    private var position = 0

    val finished
      get() = position == bytes.size

    fun byte(): Int {
      if (position >= bytes.size) {
        throw SpeedLimitPackException("A tile ends early")
      }
      return bytes[position++].toInt() and 0xFF
    }

    fun varint(): Long {
      var result = 0L
      var shift = 0
      while (true) {
        val next = byte()
        result = result or ((next and 0x7F).toLong() shl shift)
        if (next < 0x80) {
          return result
        }
        shift += 7
        if (shift > 35) {
          throw SpeedLimitPackException("A number in a tile is too long")
        }
      }
    }

    fun count(): Int {
      val value = varint()
      if (value > bytes.size.toLong() * 8) {
        throw SpeedLimitPackException("A count in a tile is larger than the tile")
      }
      return value.toInt()
    }

    fun signed(): Int {
      val value = varint()
      return ((value ushr 1) xor -(value and 1)).toInt()
    }

    fun limit(): RoadLimit {
      val code = byte()
      val source =
        RoadLimitSource.entries.firstOrNull { it.code == code }
          ?: throw SpeedLimitPackException("Unknown limit source")
      val tenthsKmh = varint()
      if (tenthsKmh > MAX_TENTHS_KMH) {
        throw SpeedLimitPackException("A limit is out of range")
      }
      return RoadLimit(source, tenthsKmh.toInt())
    }
  }

  companion object {
    const val FORMAT_VERSION = 1
    private const val FIXED_HEADER_BYTES = 42
    private const val DIRECTORY_ENTRY_BYTES = 16
    private const val CACHED_TILES = 32
    private const val MAX_ROAD_CLASS = 15
    private const val MAX_TENTHS_KMH = 3000L
    private const val METERS_PER_DEGREE = 111_320.0

    fun open(source: PackSource): SpeedLimitPack {
      if (source.size < FIXED_HEADER_BYTES) {
        throw SpeedLimitPackException("The pack is too short")
      }
      val fixed = ByteBuffer.wrap(source.read(0, FIXED_HEADER_BYTES)).order(ByteOrder.LITTLE_ENDIAN)
      val magic = ByteArray(4).also { fixed.get(it) }
      if (!magic.contentEquals("OBSL".toByteArray(Charsets.US_ASCII))) {
        throw SpeedLimitPackException("Not a speed limit pack")
      }
      val version = fixed.short.toInt() and 0xFFFF
      if (version != FORMAT_VERSION) {
        throw SpeedLimitPackException("Unsupported pack format $version")
      }
      val headerLength = fixed.short.toInt() and 0xFFFF
      val build = fixed.int
      val tileSizeE5 = fixed.int
      val roadCount = fixed.int
      val tileCount = fixed.int.toLong() and 0xFFFF_FFFFL
      val minLon = fixed.int
      val minLat = fixed.int
      val maxLon = fixed.int
      val maxLat = fixed.int
      val regionLength = fixed.short.toInt() and 0xFFFF
      if (headerLength != FIXED_HEADER_BYTES + regionLength || tileSizeE5 <= 0 || roadCount < 0) {
        throw SpeedLimitPackException("The pack header is malformed")
      }
      val directoryEnd = headerLength + tileCount * DIRECTORY_ENTRY_BYTES
      if (directoryEnd > source.size) {
        throw SpeedLimitPackException("The tile directory runs past the end of the pack")
      }
      val regionId = String(source.read(FIXED_HEADER_BYTES.toLong(), regionLength), Charsets.UTF_8)
      val directory =
        ByteBuffer.wrap(source.read(headerLength.toLong(), (tileCount * DIRECTORY_ENTRY_BYTES).toInt()))
          .order(ByteOrder.LITTLE_ENDIAN)
      val tiles =
        List(tileCount.toInt()) {
          val tile =
            PackTile(
              x = directory.int,
              y = directory.int,
              offset = directory.int.toLong() and 0xFFFF_FFFFL,
              length = directory.int,
            )
          if (tile.length < 0 || tile.offset < directoryEnd || tile.offset + tile.length > source.size) {
            throw SpeedLimitPackException("Tile ${tile.x},${tile.y} lies outside the pack")
          }
          tile
        }
      return SpeedLimitPack(source, regionId, build, tileSizeE5, roadCount, minLon, minLat, maxLon, maxLat, tiles)
    }
  }
}
