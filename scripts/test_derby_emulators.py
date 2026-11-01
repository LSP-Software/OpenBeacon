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
