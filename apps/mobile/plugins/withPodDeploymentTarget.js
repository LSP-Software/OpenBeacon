const { withPodfile } = require("expo/config-plugins");

const raiseDeploymentTargets = `
    app_deployment_target = podfile_properties['ios.deploymentTarget'] || '15.1'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        deployment_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && Gem::Version.new(deployment_target) < Gem::Version.new(app_deployment_target)
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_deployment_target
        end
      end
    end`;

const withPodDeploymentTarget = (config) =>
  withPodfile(config, (mod) => {
    if (!mod.modResults.contents.includes(raiseDeploymentTargets)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        "post_install do |installer|",
        `post_install do |installer|${raiseDeploymentTargets}`,
      );
    }
    return mod;
  });

module.exports = withPodDeploymentTarget;
