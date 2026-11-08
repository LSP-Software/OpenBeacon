import importlib.util
import signal
import unittest
from contextlib import contextmanager
import tempfile
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("derby_emulators", Path(__file__).with_name("derby-emulators.py"))
simulation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulation)


class PositionTest(unittest.TestCase):
    def test_stationary_remains_in_place(self):
        self.assertEqual(simulation.position([(52.9225, -1.4746)], 0, 1000), (52.9225, -1.4746))

    def test_car_moves_at_70_mph_and_returns(self):
        points = [(0, 0), (0, 0.01)]
        distance = 6371000 * simulation.math.radians(0.01)
        travel_time = distance / (70 * 0.44704)
        self.assertAlmostEqual(simulation.position(points, 70, travel_time / 2)[1], 0.005)
        self.assertAlmostEqual(simulation.position(points, 70, travel_time * 1.5)[1], 0.005)
        self.assertAlmostEqual(simulation.position(points, 70, travel_time * 2)[1], 0)

    def test_closed_route_repeats(self):
        points = [(0, 0), (0, 0.01), (0, 0)]
        duration = 2 * 6371000 * simulation.math.radians(0.01) / (3 * 0.44704)
        self.assertAlmostEqual(simulation.position(points, 3, duration)[1], 0)


class AndroidSdkTest(unittest.TestCase):
    def test_uses_complete_home_sdk_when_configured_sdk_is_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configured = root / "configured"
            home = root / "home"
            configured.mkdir()
            (home / "ndk" / "installed").mkdir(parents=True)
            (home / "licenses").mkdir()
            (home / "licenses" / "android-sdk-license").touch()
            self.assertEqual(simulation.select_android_sdk(configured, home), home)
            self.assertEqual(simulation.select_android_sdk(home, configured), home)


class AndroidVersionsTest(unittest.TestCase):
    def test_each_version_gets_its_own_avd_and_routes_repeat(self):
        devices = simulation.version_devices([24, 26, 28, 29, 30], None)
        self.assertEqual([avd for avd, _, _, _ in devices], ["OpenBeacon_API_24", "OpenBeacon_API_26", "OpenBeacon_API_28", "OpenBeacon_API_29", "OpenBeacon_API_30"])
        self.assertEqual([route[0] for _, _, _, route in devices], ["stationary", "walking", "jogging", "car", "stationary"])
        self.assertEqual(devices[0][1], "Android 7.0 (API 24) stationary")

    def test_newer_versions_get_more_memory_unless_overridden(self):
        memory = [memory_mb for _, _, memory_mb, _ in simulation.version_devices(list(simulation.ANDROID_VERSIONS), None)]
        self.assertEqual(memory, sorted(memory))
        self.assertLess(memory[0], memory[-1])
        self.assertEqual({memory_mb for _, _, memory_mb, _ in simulation.version_devices([24, 36], 2048)}, {2048})

    def test_versions_cover_minimum_to_target_sdk(self):
        self.assertEqual(min(simulation.ANDROID_VERSIONS), 24)
        self.assertEqual(max(simulation.ANDROID_VERSIONS), 36)

    def test_installs_and_creates_only_missing_versions(self):
        with self.android_sdk() as (sdk, tools, avd_home):
            self.install_image(sdk, 24)
            self.create_avd(avd_home, 24)
            (avd_home / "OpenBeacon_API_30.avd").mkdir()
            commands = self.create_version_avds(sdk, avd_home, [24, 30])
            self.assertEqual(commands, [
                [str(tools / "sdkmanager"), "--install", "system-images;android-30;google_apis;x86_64"],
                [str(tools / "avdmanager"), "create", "avd", "--force", "--name", "OpenBeacon_API_30", "--package", "system-images;android-30;google_apis;x86_64", "--device", "pixel_6"],
            ])
            self.assertTrue((avd_home / "OpenBeacon_API_30.avd" / "config.ini").read_text().endswith("disk.dataPartition.size=6G\nhw.keyboard=yes\n"))

    def test_reinstalls_interrupted_image_download(self):
        with self.android_sdk() as (sdk, tools, avd_home):
            image = sdk / "system-images" / "android-30" / "google_apis" / "x86_64"
            image.mkdir(parents=True)
            (image / "package.xml").touch()
            (image / "system.img").touch()
            self.create_avd(avd_home, 30)
            commands = self.create_version_avds(sdk, avd_home, [30])
            self.assertFalse(image.exists())
            self.assertEqual(commands, [[str(tools / "sdkmanager"), "--install", "system-images;android-30;google_apis;x86_64"]])

    def test_recreates_avd_left_by_failed_creation(self):
        with self.android_sdk() as (sdk, tools, avd_home):
            self.install_image(sdk, 30)
            (avd_home / "OpenBeacon_API_30.avd").mkdir(parents=True)
            (avd_home / "OpenBeacon_API_30.avd" / "config.ini").write_text("hw.keyboard=no\n")
            commands = self.create_version_avds(sdk, avd_home, [30])
            self.assertEqual(commands, [[str(tools / "avdmanager"), "create", "avd", "--force", "--name", "OpenBeacon_API_30", "--package", "system-images;android-30;google_apis;x86_64", "--device", "pixel_6"]])

    @contextmanager
    def android_sdk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "sdk" / "cmdline-tools" / "latest" / "bin"
            tools.mkdir(parents=True)
            (tools / "sdkmanager").touch()
            (tools / "avdmanager").touch()
            (root / "avd").mkdir()
            yield root / "sdk", tools, root / "avd"

    def install_image(self, sdk, api):
        image = sdk / "system-images" / f"android-{api}" / "google_apis" / "x86_64"
        image.mkdir(parents=True)
        for file in ("package.xml", "system.img", "userdata.img"):
            (image / file).touch()

    def create_avd(self, avd_home, api):
        (avd_home / f"OpenBeacon_API_{api}.avd").mkdir()
        (avd_home / f"OpenBeacon_API_{api}.avd" / "config.ini").write_text("hw.keyboard=no\ndisk.dataPartition.size=6G\nhw.keyboard=yes\n")

    def create_version_avds(self, sdk, avd_home, api_levels):
        with patch.dict(simulation.os.environ, {"ANDROID_AVD_HOME": str(avd_home)}), patch.object(simulation.subprocess, "run") as run, patch("builtins.print"):
            simulation.create_version_avds(sdk, api_levels, "x86_64")
        return [call.args[0] for call in run.call_args_list]

    def test_requires_command_line_tools(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(RuntimeError, "Command-line Tools"):
            simulation.create_version_avds(Path(directory), [24], "x86_64")


class LaunchTest(unittest.TestCase):
    @patch.object(simulation, "app_running", side_effect=[False, True])
    @patch.object(simulation.subprocess, "run")
    def test_retries_when_app_dies_after_launch(self, run, running):
        run.return_value = SimpleNamespace(returncode=0, stdout="Status: ok", stderr="")
        simulation.launch_apps([5554], stable_seconds=0)
        self.assertEqual(run.call_count, 2)

    @patch.object(simulation, "app_running", return_value=False)
    @patch.object(simulation.subprocess, "run")
    def test_reports_failure_when_retries_are_exhausted(self, run, running):
        run.return_value = SimpleNamespace(returncode=0, stdout="Status: ok", stderr="")
        with self.assertRaisesRegex(RuntimeError, "emulator-5554.*after 2 attempts"):
            simulation.launch_apps([5554], attempts=2, stable_seconds=0)
        self.assertEqual(run.call_count, 2)

    @patch.object(simulation, "app_running", return_value=True)
    @patch.object(simulation.subprocess, "run")
    def test_retries_when_android_reports_launch_error(self, run, running):
        run.side_effect = [SimpleNamespace(returncode=0, stdout="Error: Activity not started", stderr=""), SimpleNamespace(returncode=0, stdout="Status: ok", stderr="")]
        simulation.launch_apps([5554], stable_seconds=0)
        self.assertEqual(run.call_count, 2)


class ShutdownTest(unittest.TestCase):
    def test_repeated_interrupt_does_not_interrupt_shutdown(self):
        previous_sigint = signal.getsignal(signal.SIGINT)
        with patch("sys.argv", ["derby-emulators.py", "--external-backend"]), patch.object(simulation.shutil, "which", return_value="/bin/true"), patch.object(simulation.subprocess, "check_output", side_effect=["test-avd\n", "List of devices attached\n"]), patch.object(simulation.subprocess, "run", side_effect=lambda *args, **kwargs: signal.raise_signal(signal.SIGINT)), patch.object(Path, "is_file", return_value=False), patch("builtins.print", side_effect=lambda *args, **kwargs: signal.raise_signal(signal.SIGINT)):
            simulation.main()
        self.assertEqual(signal.getsignal(signal.SIGINT), previous_sigint)


if __name__ == "__main__":
    unittest.main()
