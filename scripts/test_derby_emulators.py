import importlib.util
import signal
import unittest
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
        devices = simulation.version_devices([24, 26, 28, 29, 30])
        self.assertEqual([avd for avd, _, _ in devices], ["OpenBeacon_API_24", "OpenBeacon_API_26", "OpenBeacon_API_28", "OpenBeacon_API_29", "OpenBeacon_API_30"])
        self.assertEqual([route[0] for _, _, route in devices], ["stationary", "walking", "jogging", "car", "stationary"])
        self.assertEqual(devices[0][1], "Android 7.0 (API 24) stationary")

    def test_versions_cover_minimum_to_target_sdk(self):
        self.assertEqual(min(simulation.ANDROID_VERSIONS), 24)
        self.assertEqual(max(simulation.ANDROID_VERSIONS), 36)

    def test_installs_and_creates_only_missing_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sdk = root / "sdk"
            tools = sdk / "cmdline-tools" / "latest" / "bin"
            tools.mkdir(parents=True)
            (tools / "sdkmanager").touch()
            (tools / "avdmanager").touch()
            (sdk / "system-images" / "android-24" / "google_apis" / "x86_64").mkdir(parents=True)
            (root / "avd" / "OpenBeacon_API_30.avd").mkdir(parents=True)
            with patch.dict(simulation.os.environ, {"ANDROID_AVD_HOME": str(root / "avd")}), patch.object(simulation.subprocess, "check_output", return_value="OpenBeacon_API_24\n"), patch.object(simulation.subprocess, "run") as run, patch("builtins.print"):
                simulation.create_version_avds(sdk, [24, 30], "x86_64")
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(commands, [
                [str(tools / "sdkmanager"), "--install", "system-images;android-30;google_apis;x86_64"],
                [str(tools / "avdmanager"), "create", "avd", "--name", "OpenBeacon_API_30", "--package", "system-images;android-30;google_apis;x86_64", "--device", "pixel_6"],
            ])
            self.assertIn("disk.dataPartition.size=6G", (root / "avd" / "OpenBeacon_API_30.avd" / "config.ini").read_text())

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
