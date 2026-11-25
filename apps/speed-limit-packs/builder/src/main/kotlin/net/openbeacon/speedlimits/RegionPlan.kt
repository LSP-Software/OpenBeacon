package net.openbeacon.speedlimits

import org.json.JSONObject

const val SPLIT_BYTES = 200L * 1024 * 1024
const val PRESPLIT_EXTRACT_BYTES = 8L * 1024 * 1024 * 1024

data class GeofabrikRegion(
  val id: String,
  val name: String,
  val parent: String?,
  val iso1: List<String>,
  val iso2: List<String>,
  val pbfUrl: String,
)

data class PlannedRegion(val region: GeofabrikRegion, val countryCode: String)

private val codelessTerritories =
  mapOf(
    "american-oceania" to "US",
    "azores" to "PT",
    "bermuda" to "BM",
    "canary-islands" to "ES",
    "comores" to "KM",
    "falklands" to "FK",
    "guernsey-jersey" to "GG",
    "isle-of-man" to "IM",
  )

private fun ownCode(region: GeofabrikRegion) =
  region.iso1.firstOrNull() ?: region.iso2.firstOrNull() ?: codelessTerritories[region.id]

fun countriesIn(index: List<GeofabrikRegion>, continent: String): List<PlannedRegion> {
  val root = index.single { it.id == continent && it.parent == null }
  val rootCode = ownCode(root)

  if (rootCode != null) {
    return listOf(PlannedRegion(root, rootCode))
  }

  val children = index.filter { it.parent == continent }
  val countries = children.mapNotNull { child -> ownCode(child)?.let { PlannedRegion(child, it) } }
  val territoriesOfCountries =
    index.filter { region ->
      region.id in codelessTerritories && children.any { it.id == region.parent && ownCode(it) != null }
    }

  return countries.flatMap { country ->
    listOf(country) +
      territoriesOfCountries
        .filter { it.parent == country.region.id }
        .map { PlannedRegion(it, codelessTerritories.getValue(it.id)) }
  }.distinctBy { it.region.id }
}

fun splitRegion(index: List<GeofabrikRegion>, planned: PlannedRegion): List<PlannedRegion> {
  val children =
    index.filter { it.parent == planned.region.id && it.id !in codelessTerritories }
  val subdivisions = children.filter { it.iso2.isNotEmpty() }

  return if (subdivisions.isNotEmpty()) {
    subdivisions.map { PlannedRegion(it, it.iso2.first()) }
  } else {
    children.map { PlannedRegion(it, planned.countryCode) }
  }
}

fun shouldSplit(index: List<GeofabrikRegion>, planned: PlannedRegion, packBytes: Long) =
  packBytes > SPLIT_BYTES && splitRegion(index, planned).isNotEmpty()

fun shouldSplitBeforeBuilding(index: List<GeofabrikRegion>, planned: PlannedRegion, extractBytes: Long) =
  extractBytes > PRESPLIT_EXTRACT_BYTES && splitRegion(index, planned).isNotEmpty()

fun parseGeofabrikIndex(json: String): List<GeofabrikRegion> {
  val features = JSONObject(json).getJSONArray("features")
  return (0 until features.length()).map { index ->
    val properties = features.getJSONObject(index).getJSONObject("properties")
    val strings = { key: String ->
      properties.optJSONArray(key)?.let { array -> (0 until array.length()).map { array.getString(it) } }
        ?: emptyList()
    }
    GeofabrikRegion(
      id = properties.getString("id"),
      name = properties.getString("name"),
      parent = properties.optString("parent", null),
      iso1 = strings("iso3166-1:alpha2"),
      iso2 = strings("iso3166-2"),
      pbfUrl = properties.getJSONObject("urls").getString("pbf"),
    )
  }
}
