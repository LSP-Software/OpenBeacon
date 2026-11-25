package expo.modules.openbeacontracking.drives

import java.io.File
import java.nio.charset.StandardCharsets
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.json.JSONArray
import org.json.JSONObject

class SpeedLimitPackTest {
  private val vectors =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("speed-limit-pack-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private val packBytes = Base64.getDecoder().decode(vectors.getString("packBase64"))

  private fun open(bytes: ByteArray) = SpeedLimitPack.open(ByteArrayPackSource(bytes))

  private fun limitJson(limit: RoadLimit) =
    mapOf("source" to limit.source.code, "tenthsKmh" to limit.tenthsKmh)

  private fun pieceJson(piece: PackRoadPiece) =
    mapOf(
      "roadId" to piece.roadId,
      "roadClass" to piece.roadClass,
      "oneway" to piece.oneway,
      "forward" to limitJson(piece.forward),
      "backward" to limitJson(piece.backward),
      "points" to piece.lonE5.indices.map { listOf(piece.lonE5[it], piece.latE5[it]) },
    )

  private fun plain(value: Any?): Any? =
    when (value) {
      is JSONObject -> value.keySet().associateWith { plain(value.get(it)) }
      is JSONArray -> (0 until value.length()).map { plain(value.get(it)) }
      else -> value
    }

  @Test
  fun readsTheHeader() {
    val pack = open(packBytes)
    val header = vectors.getJSONObject("header")
    val bounds = header.getJSONObject("bounds")

    assertEquals(header.getInt("formatVersion"), SpeedLimitPack.FORMAT_VERSION)
    assertEquals(header.getString("regionId"), pack.regionId)
    assertEquals(header.getInt("build"), pack.build)
    assertEquals(header.getInt("tileSizeE5"), pack.tileSizeE5)
    assertEquals(header.getInt("roadCount"), pack.roadCount)
    assertEquals(header.getInt("tileCount"), pack.tiles.size)
    assertEquals(
      listOf(bounds.getInt("minLonE5"), bounds.getInt("minLatE5"), bounds.getInt("maxLonE5"), bounds.getInt("maxLatE5")),
      listOf(pack.minLonE5, pack.minLatE5, pack.maxLonE5, pack.maxLatE5),
    )
  }

  @Test
  fun decodesEveryTileOfTheSharedVector() {
    val pack = open(packBytes)

    assertEquals(
      plain(vectors.getJSONArray("tiles")),
      pack.tiles.map { tile ->
        mapOf("x" to tile.x, "y" to tile.y, "pieces" to pack.readTile(tile).map { pieceJson(it) })
      },
    )
  }

  @Test
  fun findsTheRoadsNearAPoint() {
    val pack = open(packBytes)
    val queries = vectors.getJSONArray("queries")

    for (index in 0 until queries.length()) {
      val query = queries.getJSONObject(index)
      assertEquals(
        plain(query.getJSONArray("roadIds")),
        pack
          .roadsNear(query.getDouble("latitude"), query.getDouble("longitude"), query.getDouble("radiusMeters"))
          .map { it.roadId },
        "query $index",
      )
    }
  }

  @Test
  fun readsAPackFromAFile() {
    val file = File.createTempFile("pack", ".obsl")
    file.writeBytes(packBytes)
    FilePackSource(file).use { source ->
      val pack = SpeedLimitPack.open(source)
      assertEquals(listOf(0, 1, 2), pack.readTile(pack.tiles[1]).map { it.roadId })
    }
    file.delete()
  }

  @Test
  fun rejectsEveryInvalidPack() {
    val invalid = vectors.getJSONArray("invalid")
    check(invalid.length() > 0)

    for (index in 0 until invalid.length()) {
      val case = invalid.getJSONObject(index)
      val bytes = Base64.getDecoder().decode(case.getString("packBase64"))
      assertFailsWith<SpeedLimitPackException>(case.getString("name")) {
        val pack = open(bytes)
        pack.tiles.forEach { pack.readTile(it) }
      }
    }
  }
}
