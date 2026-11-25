package net.openbeacon.speedlimits

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.hypot

const val PACK_FORMAT_VERSION = 1
const val DEFAULT_TILE_SIZE_E5 = 10_000
const val SIMPLIFY_TOLERANCE_METRES = 1.0

private const val FIXED_HEADER_BYTES = 42
private const val DIRECTORY_ENTRY_BYTES = 16
private const val METRES_PER_E5_DEGREE = 1.1132

class SourceRoad(val attributes: RoadAttributes, val lonE5: IntArray, val latE5: IntArray)

private data class TileAttributes(
  val roadClass: RoadClass,
  val oneway: Boolean,
  val forward: Limit,
  val backward: Limit,
)

private class Piece(val roadId: Int, val attributes: Int, val lonE5: IntArray, val latE5: IntArray)

private class TileBuilder {
  val attributes = LinkedHashMap<TileAttributes, Int>()
  val pieces = ArrayList<Piece>()
}

class PackWriter(
  private val regionId: String,
  private val build: Int,
  private val tileSizeE5: Int = DEFAULT_TILE_SIZE_E5,
) {
  private val tiles = HashMap<Long, TileBuilder>()
  private var roadCount = 0
  private var minLon = Int.MAX_VALUE
  private var minLat = Int.MAX_VALUE
  private var maxLon = Int.MIN_VALUE
  private var maxLat = Int.MIN_VALUE

  fun add(road: SourceRoad) {
    if (road.lonE5.size < 2) {
      return
    }
    val reversed = road.attributes.oneway == Oneway.Reverse
    val lon = if (reversed) road.lonE5.reversedArray() else road.lonE5
    val lat = if (reversed) road.latE5.reversedArray() else road.latE5
    val kept = simplify(lon, lat)
    val keptLon = IntArray(kept.size) { lon[kept[it]] }
    val keptLat = IntArray(kept.size) { lat[kept[it]] }
    val attributes =
      TileAttributes(
        roadClass = road.attributes.roadClass,
        oneway = road.attributes.oneway != Oneway.No,
        forward = if (reversed) road.attributes.backward else road.attributes.forward,
        backward = if (reversed) road.attributes.forward else road.attributes.backward,
      )
    val roadId = roadCount++

    keptLon.forEachIndexed { index, value ->
      minLon = minOf(minLon, value)
      maxLon = maxOf(maxLon, value)
      minLat = minOf(minLat, keptLat[index])
      maxLat = maxOf(maxLat, keptLat[index])
    }

    val segmentsByTile = LinkedHashMap<Long, MutableList<Int>>()
    for (segment in 0 until keptLon.size - 1) {
      val fromX = Math.floorDiv(minOf(keptLon[segment], keptLon[segment + 1]), tileSizeE5)
      val toX = Math.floorDiv(maxOf(keptLon[segment], keptLon[segment + 1]), tileSizeE5)
      val fromY = Math.floorDiv(minOf(keptLat[segment], keptLat[segment + 1]), tileSizeE5)
      val toY = Math.floorDiv(maxOf(keptLat[segment], keptLat[segment + 1]), tileSizeE5)
      for (x in fromX..toX) {
        for (y in fromY..toY) {
          segmentsByTile.getOrPut(tileKey(x, y)) { ArrayList() }.add(segment)
        }
      }
    }

    segmentsByTile.forEach { (key, segments) ->
      val tile = tiles.getOrPut(key) { TileBuilder() }
      val attributeIndex = tile.attributes.getOrPut(attributes) { tile.attributes.size }
      var start = segments[0]
      var previous = segments[0]
      val emit = { first: Int, last: Int ->
        tile.pieces.add(
          Piece(
            roadId,
            attributeIndex,
            keptLon.copyOfRange(first, last + 2),
            keptLat.copyOfRange(first, last + 2),
          )
        )
      }
      for (segment in segments.drop(1)) {
        if (segment != previous + 1) {
          emit(start, previous)
          start = segment
        }
        previous = segment
      }
      emit(start, previous)
    }
  }

  fun writeTo(output: OutputStream) {
    val regionBytes = regionId.toByteArray(Charsets.UTF_8)
    val headerLength = FIXED_HEADER_BYTES + regionBytes.size
    val ordered = tiles.keys.sortedWith(compareBy({ tileY(it) }, { tileX(it) }))
    val bodies = ordered.map { encodeTile(it, tiles.getValue(it)) }
    val header = ByteBuffer.allocate(headerLength + ordered.size * DIRECTORY_ENTRY_BYTES).order(ByteOrder.LITTLE_ENDIAN)
    val empty = roadCount == 0

    header.put("OBSL".toByteArray(Charsets.US_ASCII))
    header.putShort(PACK_FORMAT_VERSION.toShort())
    header.putShort(headerLength.toShort())
    header.putInt(build)
    header.putInt(tileSizeE5)
    header.putInt(roadCount)
    header.putInt(ordered.size)
    header.putInt(if (empty) 0 else minLon)
    header.putInt(if (empty) 0 else minLat)
    header.putInt(if (empty) 0 else maxLon)
    header.putInt(if (empty) 0 else maxLat)
    header.putShort(regionBytes.size.toShort())
    header.put(regionBytes)

    var offset = header.capacity().toLong()
    ordered.forEachIndexed { index, key ->
      header.putInt(tileX(key))
      header.putInt(tileY(key))
      header.putInt(offset.toInt())
      header.putInt(bodies[index].size)
      offset += bodies[index].size
      require(offset <= 0xFFFF_FFFFL) { "A pack must be smaller than 4 GiB" }
    }

    output.write(header.array())
    bodies.forEach { output.write(it) }
  }

  fun toByteArray(): ByteArray = ByteArrayOutputStream().also { writeTo(it) }.toByteArray()

  private fun encodeTile(key: Long, tile: TileBuilder): ByteArray {
    val out = ByteArrayOutputStream()
    writeVarint(out, tile.attributes.size.toLong())
    tile.attributes.keys.forEach { attributes ->
      out.write(attributes.roadClass.code)
      out.write(if (attributes.oneway) 1 else 0)
      out.write(attributes.forward.source.code)
      writeVarint(out, attributes.forward.tenthsKmh.toLong())
      out.write(attributes.backward.source.code)
      writeVarint(out, attributes.backward.tenthsKmh.toLong())
    }

    val pieces = tile.pieces.sortedBy { it.roadId }
    writeVarint(out, pieces.size.toLong())
    var previousRoad = 0
    var lastLon = tileX(key) * tileSizeE5
    var lastLat = tileY(key) * tileSizeE5
    pieces.forEach { piece ->
      writeVarint(out, (piece.roadId - previousRoad).toLong())
      previousRoad = piece.roadId
      writeVarint(out, piece.attributes.toLong())
      writeVarint(out, piece.lonE5.size.toLong())
      piece.lonE5.forEachIndexed { index, lon ->
        writeVarint(out, zigzag(lon - lastLon))
        writeVarint(out, zigzag(piece.latE5[index] - lastLat))
        lastLon = lon
        lastLat = piece.latE5[index]
      }
    }
    return out.toByteArray()
  }
}

fun simplify(lonE5: IntArray, latE5: IntArray, toleranceMetres: Double = SIMPLIFY_TOLERANCE_METRES): IntArray {
  if (lonE5.size <= 2) {
    return IntArray(lonE5.size) { it }
  }
  val lonScale = METRES_PER_E5_DEGREE * cos(Math.toRadians(latE5[0] / 1e5))
  val keep = BooleanArray(lonE5.size)
  keep[0] = true
  keep[lonE5.size - 1] = true
  val stack = ArrayDeque<Pair<Int, Int>>()
  stack.addLast(0 to lonE5.size - 1)

  while (stack.isNotEmpty()) {
    val (first, last) = stack.removeLast()
    val ax = lonE5[first] * lonScale
    val ay = latE5[first] * METRES_PER_E5_DEGREE
    val bx = lonE5[last] * lonScale
    val by = latE5[last] * METRES_PER_E5_DEGREE
    var furthest = -1
    var furthestDistance = toleranceMetres
    for (index in first + 1 until last) {
      val distance =
        distanceToSegment(lonE5[index] * lonScale, latE5[index] * METRES_PER_E5_DEGREE, ax, ay, bx, by)
      if (distance > furthestDistance) {
        furthest = index
        furthestDistance = distance
      }
    }
    if (furthest >= 0) {
      keep[furthest] = true
      stack.addLast(first to furthest)
      stack.addLast(furthest to last)
    }
  }

  return keep.indices.filter { keep[it] }.toIntArray()
}

private fun distanceToSegment(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
  val dx = bx - ax
  val dy = by - ay
  val lengthSquared = dx * dx + dy * dy
  val t = if (lengthSquared == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
  return hypot(px - (ax + t * dx), py - (ay + t * dy))
}

private fun tileKey(x: Int, y: Int) = (x.toLong() shl 32) or (y.toLong() and 0xFFFF_FFFFL)

private fun tileX(key: Long) = (key shr 32).toInt()

private fun tileY(key: Long) = key.toInt()

private fun zigzag(value: Int) = ((value shl 1) xor (value shr 31)).toLong() and 0xFFFF_FFFFL

private fun writeVarint(out: OutputStream, value: Long) {
  var remaining = value
  while (remaining >= 0x80) {
    out.write(((remaining and 0x7F) or 0x80).toInt())
    remaining = remaining ushr 7
  }
  out.write(remaining.toInt())
}
