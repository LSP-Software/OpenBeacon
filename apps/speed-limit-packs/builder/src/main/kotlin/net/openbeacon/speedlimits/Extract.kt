package net.openbeacon.speedlimits

import crosby.binary.BinaryParser
import crosby.binary.Osmformat
import crosby.binary.file.BlockInputStream
import java.io.File
import kotlin.math.roundToInt

private class LongList {
  var values = LongArray(1 shl 16)
  var size = 0

  fun add(value: Long) {
    if (size == values.size) {
      values = values.copyOf(values.size * 2)
    }
    values[size++] = value
  }
}

private abstract class OnlyParser : BinaryParser() {
  override fun parseRelations(relations: List<Osmformat.Relation>) {}

  override fun parseDense(nodes: Osmformat.DenseNodes) {}

  override fun parseNodes(nodes: List<Osmformat.Node>) {}

  override fun parseWays(ways: List<Osmformat.Way>) {}

  override fun parse(header: Osmformat.HeaderBlock) {}

  override fun complete() {}
}

fun readRoads(
  pbf: File,
  countryCode: String,
  defaults: DefaultSpeeds,
  onRoad: (SourceRoad) -> Unit,
) {
  val attributesByIndex = ArrayList<RoadAttributes>()
  val attributeIndexes = HashMap<RoadAttributes, Int>()
  val wayAttributes = ArrayList<Int>()
  val wayRefs = ArrayList<LongArray>()
  val needed = LongList()

  pbf.inputStream().buffered(1 shl 20).use { input ->
    BlockInputStream(
        input,
        object : OnlyParser() {
          override fun parseWays(ways: List<Osmformat.Way>) {
            ways.forEach { way ->
              val tags = HashMap<String, String>(way.keysCount * 2)
              for (index in 0 until way.keysCount) {
                tags[getStringById(way.getKeys(index))] = getStringById(way.getVals(index))
              }
              val attributes = resolveRoad(tags, countryCode, defaults) ?: return@forEach
              val refs = LongArray(way.refsCount)
              var id = 0L
              for (index in 0 until way.refsCount) {
                id += way.getRefs(index)
                refs[index] = id
                needed.add(id)
              }
              wayAttributes.add(attributeIndexes.getOrPut(attributes) { attributesByIndex.add(attributes); attributesByIndex.size - 1 })
              wayRefs.add(refs)
            }
          }
        },
      )
      .process()
  }

  val ids = needed.values.copyOf(needed.size)
  ids.sort()
  var unique = 0
  for (index in ids.indices) {
    if (index == 0 || ids[index] != ids[index - 1]) {
      ids[unique++] = ids[index]
    }
  }
  val nodeIds = ids.copyOf(unique)
  val lonE5 = IntArray(unique)
  val latE5 = IntArray(unique)
  val found = BooleanArray(unique)

  pbf.inputStream().buffered(1 shl 20).use { input ->
    BlockInputStream(
        input,
        object : OnlyParser() {
          private fun store(id: Long, lat: Double, lon: Double) {
            val slot = nodeIds.binarySearch(id)
            if (slot >= 0) {
              lonE5[slot] = (lon * 1e5).roundToInt()
              latE5[slot] = (lat * 1e5).roundToInt()
              found[slot] = true
            }
          }

          override fun parseDense(nodes: Osmformat.DenseNodes) {
            var id = 0L
            var lat = 0L
            var lon = 0L
            for (index in 0 until nodes.idCount) {
              id += nodes.getId(index)
              lat += nodes.getLat(index)
              lon += nodes.getLon(index)
              store(id, parseLat(lat), parseLon(lon))
            }
          }

          override fun parseNodes(nodes: List<Osmformat.Node>) {
            nodes.forEach { store(it.id, parseLat(it.lat), parseLon(it.lon)) }
          }
        },
      )
      .process()
  }

  wayRefs.forEachIndexed { wayIndex, refs ->
    val slots = refs.map { nodeIds.binarySearch(it) }.filter { it >= 0 && found[it] }
    if (slots.size >= 2) {
      onRoad(
        SourceRoad(
          attributesByIndex[wayAttributes[wayIndex]],
          IntArray(slots.size) { lonE5[slots[it]] },
          IntArray(slots.size) { latE5[slots[it]] },
        )
      )
    }
  }
}
