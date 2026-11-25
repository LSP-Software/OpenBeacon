package net.openbeacon.speedlimits

import kotlin.test.Test
import kotlin.test.assertEquals

class RegionPlanTest {
  private fun region(
    id: String,
    parent: String?,
    iso1: List<String> = emptyList(),
    iso2: List<String> = emptyList(),
  ) = GeofabrikRegion(id, id.replaceFirstChar { it.uppercase() }, parent, iso1, iso2, "https://example.org/$id.osm.pbf")

  private val index =
    listOf(
      region("europe", null),
      region("north-america", null),
      region("russia", null, iso1 = listOf("RU")),
      region("russia/central", "russia"),
      region("germany", "europe", iso1 = listOf("DE")),
      region("bayern", "germany"),
      region("berlin", "germany"),
      region("oberbayern", "bayern"),
      region("united-kingdom", "europe", iso1 = listOf("GB")),
      region("england", "united-kingdom"),
      region("scotland", "united-kingdom"),
      region("wales", "united-kingdom"),
      region("bermuda", "united-kingdom"),
      region("isle-of-man", "europe"),
      region("alps", "europe"),
      region("dach", "europe"),
      region("kosovo", "europe", iso2 = listOf("RS-KM")),
      region("us", "north-america", iso1 = listOf("US")),
      region("us-west", "us"),
      region("us/alabama", "us", iso2 = listOf("US-AL")),
      region("us/puerto-rico", "us", iso1 = listOf("PR"), iso2 = listOf("US-PR")),
    )

  private fun ids(regions: List<PlannedRegion>) = regions.map { it.region.id to it.countryCode }

  @Test
  fun eachContinentPlansOnePackPerCountry() {
    assertEquals(
      listOf(
        "germany" to "DE",
        "united-kingdom" to "GB",
        "bermuda" to "BM",
        "isle-of-man" to "IM",
        "kosovo" to "RS-KM",
      ),
      ids(countriesIn(index, "europe")),
    )
    assertEquals(listOf("us" to "US"), ids(countriesIn(index, "north-america")))
  }

  @Test
  fun aContinentThatIsACountryIsItsOwnPack() {
    assertEquals(listOf("russia" to "RU"), ids(countriesIn(index, "russia")))
  }

  @Test
  fun splittingUsesSubdivisionsWhereGeofabrikHasThem() {
    val us = countriesIn(index, "north-america").single()
    assertEquals(listOf("us/alabama" to "US-AL", "us/puerto-rico" to "US-PR"), ids(splitRegion(index, us)))
  }

  @Test
  fun splittingOtherwiseUsesEveryContainedChildWithTheParentsCountry() {
    val germany = countriesIn(index, "europe").first()
    assertEquals(listOf("bayern" to "DE", "berlin" to "DE"), ids(splitRegion(index, germany)))

    val uk = countriesIn(index, "europe")[1]
    assertEquals(
      listOf("england" to "GB", "scotland" to "GB", "wales" to "GB"),
      ids(splitRegion(index, uk)),
    )
  }

  @Test
  fun aPackOverTheSplitSizeIsSplitWhenItHasChildren() {
    val germany = countriesIn(index, "europe").first()
    val isleOfMan = countriesIn(index, "europe")[3]

    assertEquals(false, shouldSplit(index, germany, packBytes = SPLIT_BYTES))
    assertEquals(true, shouldSplit(index, germany, packBytes = SPLIT_BYTES + 1))
    assertEquals(false, shouldSplit(index, isleOfMan, packBytes = SPLIT_BYTES * 3))
  }

  @Test
  fun anExtractTooBigForOneRunnerIsSplitWithoutBuildingIt() {
    val us = countriesIn(index, "north-america").single()
    val isleOfMan = countriesIn(index, "europe")[3]

    assertEquals(false, shouldSplitBeforeBuilding(index, us, extractBytes = PRESPLIT_EXTRACT_BYTES))
    assertEquals(true, shouldSplitBeforeBuilding(index, us, extractBytes = PRESPLIT_EXTRACT_BYTES + 1))
    assertEquals(false, shouldSplitBeforeBuilding(index, isleOfMan, extractBytes = PRESPLIT_EXTRACT_BYTES * 2))
  }

  @Test
  fun readsTheGeofabrikIndex() {
    val json =
      """{"features":[{"properties":{"id":"us/alabama","name":"Alabama","parent":"us","iso3166-2":["US-AL"],"urls":{"pbf":"https://download.geofabrik.de/north-america/us/alabama-latest.osm.pbf"}}},
      {"properties":{"id":"europe","name":"Europe","urls":{"pbf":"https://download.geofabrik.de/europe-latest.osm.pbf"}}}]}"""

    assertEquals(
      listOf(
        GeofabrikRegion(
          "us/alabama",
          "Alabama",
          "us",
          emptyList(),
          listOf("US-AL"),
          "https://download.geofabrik.de/north-america/us/alabama-latest.osm.pbf",
        ),
        GeofabrikRegion("europe", "Europe", null, emptyList(), emptyList(), "https://download.geofabrik.de/europe-latest.osm.pbf"),
      ),
      parseGeofabrikIndex(json),
    )
  }
}
