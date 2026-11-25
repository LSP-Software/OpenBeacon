package net.openbeacon.speedlimits

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import org.json.JSONObject

class PackVectorsTest {
  @Test
  fun writesTheSharedVectorByteForByte() {
    val vectors = JSONObject(javaClass.getResource("/speed-limit-pack-v1.json")!!.readText())
    val pack = vectors.getJSONObject("pack")
    val writer = PackWriter(pack.getString("regionId"), pack.getInt("build"), pack.getInt("tileSizeE5"))
    val limit = { json: JSONObject ->
      Limit(LimitSource.entries.single { it.code == json.getInt("source") }, json.getInt("tenthsKmh"))
    }
    val roads = vectors.getJSONArray("roads")

    for (index in 0 until roads.length()) {
      val road = roads.getJSONObject(index)
      val points = road.getJSONArray("points")
      writer.add(
        SourceRoad(
          RoadAttributes(
            RoadClass.entries.single { it.code == road.getInt("roadClass") },
            Oneway.valueOf(road.getString("oneway").replaceFirstChar { it.uppercase() }),
            limit(road.getJSONObject("forward")),
            limit(road.getJSONObject("backward")),
          ),
          IntArray(points.length()) { points.getJSONArray(it).getInt(0) },
          IntArray(points.length()) { points.getJSONArray(it).getInt(1) },
        )
      )
    }

    assertEquals(vectors.getString("packBase64"), Base64.getEncoder().encodeToString(writer.toByteArray()))
  }
}
