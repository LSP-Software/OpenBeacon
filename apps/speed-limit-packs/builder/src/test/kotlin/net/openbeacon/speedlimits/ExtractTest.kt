package net.openbeacon.speedlimits

import com.google.protobuf.ByteString
import crosby.binary.Fileformat
import crosby.binary.Osmformat
import java.io.DataOutputStream
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

class ExtractTest {
  private data class Way(val id: Long, val refs: List<Long>, val tags: Map<String, String>)

  private fun writePbf(file: File, nodes: Map<Long, Pair<Double, Double>>, ways: List<Way>) {
    val strings = mutableListOf("")
    val stringId = { value: String ->
      strings.indexOf(value).takeIf { it >= 0 } ?: strings.size.also { strings.add(value) }
    }
    val dense = Osmformat.DenseNodes.newBuilder()
    var lastId = 0L
    var lastLat = 0L
    var lastLon = 0L
    nodes.toSortedMap().forEach { (id, position) ->
      val lat = Math.round(position.first * 1e7)
      val lon = Math.round(position.second * 1e7)
      dense.addId(id - lastId).addLat(lat - lastLat).addLon(lon - lastLon)
      lastId = id
      lastLat = lat
      lastLon = lon
    }
    val wayGroup = Osmformat.PrimitiveGroup.newBuilder()
    ways.forEach { way ->
      val builder = Osmformat.Way.newBuilder().setId(way.id)
      way.tags.forEach { (key, value) -> builder.addKeys(stringId(key)).addVals(stringId(value)) }
      var previous = 0L
      way.refs.forEach { ref ->
        builder.addRefs(ref - previous)
        previous = ref
      }
      wayGroup.addWays(builder)
    }
    val block =
      Osmformat.PrimitiveBlock.newBuilder()
        .setGranularity(100)
        .addPrimitivegroup(Osmformat.PrimitiveGroup.newBuilder().setDense(dense))
        .addPrimitivegroup(wayGroup)
        .setStringtable(Osmformat.StringTable.newBuilder().addAllS(strings.map { ByteString.copyFromUtf8(it) }))
        .build()
    val header = Osmformat.HeaderBlock.newBuilder().addRequiredFeatures("OsmSchema-V0.6").addRequiredFeatures("DenseNodes").build()

    DataOutputStream(file.outputStream()).use { out ->
      listOf("OSMHeader" to header.toByteString(), "OSMData" to block.toByteString()).forEach { (type, data) ->
        val blob = Fileformat.Blob.newBuilder().setRaw(data).setRawSize(data.size()).build().toByteArray()
        val blobHeader = Fileformat.BlobHeader.newBuilder().setType(type).setDatasize(blob.size).build().toByteArray()
        out.writeInt(blobHeader.size)
        out.write(blobHeader)
        out.write(blob)
      }
    }
  }

  @Test
  fun buildsDrivableRoadsWithTheirLimitsFromAnExtract() {
    val file = File.createTempFile("extract", ".osm.pbf")
    writePbf(
      file,
      nodes =
        mapOf(
          1L to (51.50000 to -0.10000),
          2L to (51.50100 to -0.10000),
          3L to (51.50200 to -0.10100),
          4L to (51.51000 to -0.12000),
          5L to (51.51000 to -0.12500),
          6L to (51.52000 to -0.13000),
        ),
      ways =
        listOf(
          Way(10, listOf(1, 2, 3), mapOf("highway" to "motorway", "maxspeed" to "70 mph")),
          Way(11, listOf(4, 5), mapOf("highway" to "residential")),
          Way(12, listOf(5, 6), mapOf("highway" to "footway")),
          Way(13, listOf(3, 4), mapOf("highway" to "secondary", "maxspeed" to "GB:nsl_single", "oneway" to "-1")),
          Way(14, listOf(6, 99), mapOf("highway" to "primary", "maxspeed" to "30 mph")),
          Way(15, listOf(2, 99, 6), mapOf("highway" to "primary", "maxspeed" to "fast")),
          Way(16, listOf(1, 2), mapOf("building" to "yes")),
        ),
    )

    val roads = mutableListOf<SourceRoad>()
    readRoads(file, "GB", DefaultSpeeds.load()) { roads.add(it) }
    file.delete()

    assertEquals(
      listOf(
        Triple(
          RoadAttributes(RoadClass.Motorway, Oneway.Forward, Limit(LimitSource.Posted, 1127), Limit(LimitSource.Posted, 1127)),
          listOf(-10000, -10000, -10100),
          listOf(5150000, 5150100, 5150200),
        ),
        Triple(
          RoadAttributes(RoadClass.Residential, Oneway.No, Limit(LimitSource.Unknown, 0), Limit(LimitSource.Unknown, 0)),
          listOf(-12000, -12500),
          listOf(5151000, 5151000),
        ),
        Triple(
          RoadAttributes(RoadClass.Secondary, Oneway.Reverse, Limit(LimitSource.RoadType, 966), Limit(LimitSource.RoadType, 966)),
          listOf(-10100, -12000),
          listOf(5150200, 5151000),
        ),
        Triple(
          RoadAttributes(RoadClass.Primary, Oneway.No, Limit(LimitSource.Unknown, 0), Limit(LimitSource.Unknown, 0)),
          listOf(-10000, -13000),
          listOf(5150100, 5152000),
        ),
      ),
      roads.map { Triple(it.attributes, it.lonE5.toList(), it.latE5.toList()) },
    )
  }
}
