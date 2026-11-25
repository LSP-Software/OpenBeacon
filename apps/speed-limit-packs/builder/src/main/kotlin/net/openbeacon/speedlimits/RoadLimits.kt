package net.openbeacon.speedlimits

import de.westnordost.osm_legal_default_speeds.Certitude
import de.westnordost.osm_legal_default_speeds.LegalDefaultSpeeds
import de.westnordost.osm_legal_default_speeds.RoadType
import de.westnordost.osm_legal_default_speeds.RoadTypeFilter
import org.json.JSONObject

const val NO_LIMIT = 0

enum class LimitSource(val code: Int) {
  Unknown(0),
  Posted(1),
  RoadType(2),
}

data class Limit(val source: LimitSource, val tenthsKmh: Int)

enum class Oneway {
  No,
  Forward,
  Reverse,
}

enum class RoadClass(val code: Int, val highway: String) {
  Motorway(1, "motorway"),
  MotorwayLink(2, "motorway_link"),
  Trunk(3, "trunk"),
  TrunkLink(4, "trunk_link"),
  Primary(5, "primary"),
  PrimaryLink(6, "primary_link"),
  Secondary(7, "secondary"),
  SecondaryLink(8, "secondary_link"),
  Tertiary(9, "tertiary"),
  TertiaryLink(10, "tertiary_link"),
  Unclassified(11, "unclassified"),
  Residential(12, "residential"),
  LivingStreet(13, "living_street"),
  Service(14, "service"),
  Road(15, "road"),
}

data class RoadAttributes(
  val roadClass: RoadClass,
  val oneway: Oneway,
  val forward: Limit,
  val backward: Limit,
)

private val unknownLimit = Limit(LimitSource.Unknown, 0)
private val roadClassesByHighway = RoadClass.entries.associateBy { it.highway }
private val excludedServices = setOf("parking_aisle", "driveway", "drive-through")
private val impliedOnewayClasses = setOf(RoadClass.Motorway, RoadClass.MotorwayLink)

class DefaultSpeeds(
  private val legalDefaultSpeeds: LegalDefaultSpeeds,
  private val roadTypesByCountryCode: Map<String, List<RoadType>>,
) {
  fun limitFor(countryCode: String, tags: Map<String, String>): Limit {
    val result = legalDefaultSpeeds.getSpeedLimits(countryCode, tags) ?: return unknownLimit

    if (
      result.certitude != Certitude.Exact &&
        result.certitude != Certitude.FromMaxSpeed
    ) {
      return unknownLimit
    }

    val maxspeed =
      result.tags["maxspeed"]
        ?: roadTypesFor(countryCode).firstOrNull { it.name == result.roadTypeName }?.tags?.get("maxspeed")
        ?: return unknownLimit

    return when (val parsed = parseMaxSpeed(maxspeed)) {
      is MaxSpeed.Speed -> Limit(LimitSource.RoadType, parsed.tenthsKmh)
      MaxSpeed.NoLimit -> Limit(LimitSource.RoadType, NO_LIMIT)
      else -> unknownLimit
    }
  }

  private fun roadTypesFor(countryCode: String) =
    roadTypesByCountryCode[countryCode]
      ?: roadTypesByCountryCode[countryCode.substringBefore('-')]
      ?: emptyList()

  companion object {
    fun load(): DefaultSpeeds {
      val text =
        DefaultSpeeds::class.java.getResource("/legal_default_speeds.json")?.readText()
          ?: error("legal_default_speeds.json is missing from the builder's resources")
      val json = JSONObject(text)
      val filtersJson = json.getJSONObject("roadTypesByName")
      val filters =
        filtersJson.keySet().associateWith { name ->
          val filter = filtersJson.getJSONObject(name)
          object : RoadTypeFilter {
            override val filter = filter.optString("filter", null)
            override val fuzzyFilter = filter.optString("fuzzyFilter", null)
            override val relationFilter = filter.optString("relationFilter", null)
          }
        }
      val countriesJson = json.getJSONObject("speedLimitsByCountryCode")
      val roadTypes =
        countriesJson.keySet().associateWith { code ->
          val list = countriesJson.getJSONArray(code)
          (0 until list.length()).map { index ->
            val entry = list.getJSONObject(index)
            val tagsJson = entry.getJSONObject("tags")
            object : RoadType {
              override val name = entry.optString("name", null)
              override val tags = tagsJson.keySet().associateWith { tagsJson.getString(it) }
            }
          }
        }
      return DefaultSpeeds(LegalDefaultSpeeds(filters, roadTypes), roadTypes)
    }
  }
}

fun resolveRoad(tags: Map<String, String>, countryCode: String, defaults: DefaultSpeeds): RoadAttributes? {
  val roadClass = roadClassesByHighway[tags["highway"]] ?: return null

  if (tags["area"] == "yes" || (roadClass == RoadClass.Service && tags["service"] in excludedServices)) {
    return null
  }

  val oneway =
    when (tags["oneway"]) {
      "yes", "true", "1" -> Oneway.Forward
      "-1", "reverse" -> Oneway.Reverse
      "no", "false", "0" -> Oneway.No
      else ->
        if (roadClass in impliedOnewayClasses || tags["junction"] == "roundabout") Oneway.Forward
        else Oneway.No
    }

  val implicitType = tags["maxspeed:type"] ?: tags["source:maxspeed"]
  val limitFor = { value: String? ->
    val raw = value ?: implicitType?.takeIf { parseMaxSpeed(it) is MaxSpeed.Implicit }
    if (raw == null) {
      defaults.limitFor(countryCode, tags - "maxspeed")
    } else {
      when (val parsed = parseMaxSpeed(raw)) {
        is MaxSpeed.Speed -> Limit(LimitSource.Posted, parsed.tenthsKmh)
        MaxSpeed.NoLimit -> Limit(LimitSource.Posted, NO_LIMIT)
        is MaxSpeed.Implicit ->
          defaults.limitFor(
            countryCode,
            tags + ("maxspeed" to parsed.value) + ("maxspeed:type" to (implicitType ?: parsed.value)),
          )
        MaxSpeed.Invalid -> unknownLimit
      }
    }
  }
  val maxspeed = tags["maxspeed"]

  return RoadAttributes(
    roadClass = roadClass,
    oneway = oneway,
    forward = limitFor(tags["maxspeed:forward"] ?: maxspeed),
    backward = limitFor(tags["maxspeed:backward"] ?: maxspeed),
  )
}
