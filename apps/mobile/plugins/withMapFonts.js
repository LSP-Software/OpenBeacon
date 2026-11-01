const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const withMapFonts = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const source = path.join(mod.modRequest.projectRoot, "assets/map/fonts");
      const destination = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/assets/map-fonts",
      );
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true });
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const source = "../assets/map/fonts";
    if (!project.hasFile(source)) {
      project.addResourceFile(source, { lastKnownFileType: "folder" });
    }
    return mod;
  });
};

module.exports = withMapFonts;
