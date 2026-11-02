const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const withMapFonts = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const source = path.join(mod.modRequest.projectRoot, "assets/map");
      const destination = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/assets/map-assets",
      );
      fs.rmSync(path.join(mod.modRequest.platformProjectRoot, "app/src/main/assets/map-fonts"), {
        recursive: true,
        force: true,
      });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true });
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    if (!project.pbxGroupByName("Resources")) {
      const group = project.addPbxGroup([], "Resources");
      project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    }
    if (project.hasFile("../assets/map/fonts")) {
      project.removeResourceFile("../assets/map/fonts");
    }
    const source = "../assets/map";
    if (!project.hasFile(source)) {
      project.addResourceFile(source, { lastKnownFileType: "folder" });
    }
    return mod;
  });
};

module.exports = withMapFonts;
