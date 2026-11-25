plugins {
  kotlin("jvm") version "2.3.0"
  application
}

repositories {
  mavenCentral()
}

dependencies {
  implementation("de.westnordost:osm-legal-default-speeds-jvm:1.5")
  implementation("org.openstreetmap.pbf:osmpbf:1.8.0")
  implementation("org.json:json:20250517")
  testImplementation(kotlin("test"))
  testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.3.0")
}

kotlin {
  jvmToolchain(17)
}

application {
  mainClass.set("net.openbeacon.speedlimits.MainKt")
  applicationDefaultJvmArgs = listOf("-Xmx6g")
}

sourceSets {
  test {
    resources {
      srcDir("../testVectors")
    }
  }
}

tasks.test {
  useJUnit()
}
