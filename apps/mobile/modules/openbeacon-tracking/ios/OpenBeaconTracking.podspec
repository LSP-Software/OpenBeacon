Pod::Spec.new do |s|
  s.name           = 'OpenBeaconTracking'
  s.version        = '0.0.0'
  s.summary        = 'Encrypted location capture for OpenBeacon'
  s.license        = 'SEE LICENSE IN LICENSE.md'
  s.author         = 'OpenBeacon'
  s.homepage       = 'https://openbeacon.net'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/LSP-Software/OpenBeacon.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'BackgroundTasks', 'CoreLocation', 'CryptoKit', 'Network', 'UserNotifications'
  s.library = 'sqlite3'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
end
