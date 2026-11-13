const { withAppBuildGradle } = require("expo/config-plugins");

const credentialsLoader = `
def releaseCredentialsFile = file(findProperty('openbeaconCredentials') ?: "\${projectRoot}/credentials.json")
def releaseCredentials = releaseCredentialsFile.exists() ? new groovy.json.JsonSlurper().parse(releaseCredentialsFile) : null

gradle.taskGraph.whenReady { graph ->
    if (releaseCredentials == null && graph.allTasks.any { it.name.endsWith("Release") }) {
        throw new GradleException("Release builds are signed with the key in \${releaseCredentialsFile}, which does not exist. See docs/development/android-release-builds.md.")
    }
}
`;

const releaseSigningConfig = `
        release {
            if (releaseCredentials != null) {
                storeFile file(releaseCredentials.keystorePath)
                storePassword releaseCredentials.keystorePassword
                keyAlias releaseCredentials.keyAlias
                keyPassword releaseCredentials.keyPassword
            }
        }`;

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents;
    if (gradle.includes("releaseCredentialsFile")) return mod;

    const projectRootLine = /^def projectRoot = .*$/m;
    const signingConfigs = /signingConfigs \{\n/;
    const releaseBuildTypeSigning =
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (
      !projectRootLine.test(gradle) ||
      !signingConfigs.test(gradle) ||
      !releaseBuildTypeSigning.test(gradle)
    ) {
      throw new Error("withReleaseSigning could not find the signing setup in app/build.gradle");
    }

    mod.modResults.contents = gradle
      .replace(projectRootLine, (line) => `${line}\n${credentialsLoader}`)
      .replace(signingConfigs, (block) => `${block.trimEnd()}${releaseSigningConfig}\n`)
      .replace(releaseBuildTypeSigning, "$1signingConfig signingConfigs.release");
    return mod;
  });

module.exports = withReleaseSigning;
