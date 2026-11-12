#!/usr/bin/env python3
import argparse
import math
import os
import platform
import shutil
import secrets
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
ROUTES = [
    ("stationary", 0, [(52.9225, -1.4746)]),
    ("walking", 3, [(52.9225, -1.4746), (52.9217, -1.4765), (52.9198, -1.4774), (52.9183, -1.4753), (52.9200, -1.4722), (52.9225, -1.4746)]),
    ("jogging", 6, [(52.9388, -1.4760), (52.9397, -1.4725), (52.9420, -1.4705), (52.9441, -1.4733), (52.9430, -1.4770), (52.9407, -1.4787), (52.9388, -1.4760)]),
    ("car", 70, [(52.8915, -1.4370), (52.8820, -1.4180), (52.8730, -1.3970), (52.8638, -1.3760)]),
]
ANDROID_VERSIONS = {24: ("7.0", 3072), 26: ("8.0", 3072), 28: ("9", 4096), 29: ("10", 4096), 30: ("11", 4096), 31: ("12", 6144), 33: ("13", 6144), 34: ("14", 8192), 35: ("15", 8192), 36: ("16", 8192)}


def position(points, mph, elapsed):
    if len(points) == 1:
        return points[0]
    segments = list(zip(points, points[1:]))
    if points[0] != points[-1]:
        segments += [(end, start) for start, end in reversed(segments)]
    lengths = []
    for (lat1, lon1), (lat2, lon2) in segments:
        x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
        y = math.radians(lat2 - lat1)
        lengths.append(math.hypot(x, y) * 6371000)
    distance = (elapsed * mph * 0.44704) % sum(lengths)
    for ((lat1, lon1), (lat2, lon2)), length in zip(segments, lengths):
        if distance <= length:
            fraction = distance / length
            return lat1 + (lat2 - lat1) * fraction, lon1 + (lon2 - lon1) * fraction
        distance -= length
    return points[0]


def select_android_sdk(configured, home):
    def usable(path):
        return path and (path / "ndk").is_dir() and any((path / "ndk").iterdir()) and (path / "licenses" / "android-sdk-license").is_file()

    if usable(configured):
        return configured
    if usable(home):
        return home
    return configured


def version_devices(api_levels, memory_mb):
    return [(f"OpenBeacon_API_{api}", f"Android {ANDROID_VERSIONS[api][0]} (API {api}) {ROUTES[index % len(ROUTES)][0]}", memory_mb or ANDROID_VERSIONS[api][1], ROUTES[index % len(ROUTES)]) for index, api in enumerate(api_levels)]


def available_memory_mb(system, meminfo=Path("/proc/meminfo")):
    try:
        if system == "Linux":
            for line in meminfo.read_text().splitlines():
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
            return None
        if system == "Darwin":
            output = subprocess.check_output(["vm_stat"], text=True)
            page_size = int(output.split("page size of ", 1)[1].split()[0])
            pages = {key.strip(): int(value.strip().rstrip(".")) for key, value in (line.split(":", 1) for line in output.splitlines()[1:] if ":" in line)}
            return sum(pages.get(key, 0) for key in ("Pages free", "Pages inactive", "Pages speculative")) * page_size // 1024 // 1024
    except (OSError, subprocess.CalledProcessError, ValueError, IndexError):
        return None
    return None


def memory_error(devices, available_mb, headroom_mb=2048):
    needed_mb = sum(memory_mb for _, _, memory_mb, _ in devices) + headroom_mb
    if available_mb is None or available_mb >= needed_mb:
        return None
    return f"{len(devices)} emulators need about {needed_mb} MiB of RAM including {headroom_mb} MiB headroom, but only {available_mb} MiB is available. Run fewer emulators with --android-versions, lower --memory-mb, or pass --skip-memory-check to start anyway."


def image_updates(listing, packages):
    tables = {"Installed packages:": {}, "Available Packages:": {}}
    table = None
    for line in listing.splitlines():
        if line.strip() in tables or line.strip() == "Available Updates:":
            table = tables.get(line.strip())
            continue
        cells = [cell.strip() for cell in line.split("|")]
        if table is not None and len(cells) > 1 and cells[0] in packages:
            try:
                table[cells[0]] = max(table.get(cells[0], ()), tuple(int(part) for part in cells[1].split(".")))
            except ValueError:
                pass
    installed, available = tables.values()
    return {package: (".".join(map(str, installed[package])), ".".join(map(str, available[package]))) for package in packages if package in installed and package in available and available[package] > installed[package]}


def create_version_avds(sdk, api_levels, abi):
    tools = sdk / "cmdline-tools" / "latest" / "bin"
    if not (tools / "sdkmanager").is_file() or not (tools / "avdmanager").is_file():
        raise RuntimeError("Install Android SDK Command-line Tools (latest) from Android Studio's SDK Manager to create an emulator for each Android version.")
    avd_home = Path(os.environ.get("ANDROID_AVD_HOME") or Path.home() / ".android" / "avd")
    avd_settings = "disk.dataPartition.size=6G\nhw.keyboard=yes\n"
    images = {f"system-images;android-{api};google_apis;{abi}": (api, sdk / "system-images" / f"android-{api}" / "google_apis" / abi) for api in dict.fromkeys(api_levels)}
    complete = [package for package, (_, image) in images.items() if all((image / file).is_file() for file in ("package.xml", "system.img"))]
    updates = {}
    if complete:
        print("Checking for system image updates", flush=True)
        try:
            listing = subprocess.run([str(tools / "sdkmanager"), "--list"], capture_output=True, text=True, timeout=120)
            updates = image_updates(listing.stdout, complete)
            if listing.returncode != 0:
                print("Could not check for system image updates; using the installed images.", flush=True)
        except (OSError, subprocess.TimeoutExpired):
            print("Could not check for system image updates; using the installed images.", flush=True)
    for package, (api, image) in images.items():
        name = f"OpenBeacon_API_{api}"
        if package not in complete:
            if image.exists():
                print(f"Removing incomplete {package}", flush=True)
                shutil.rmtree(image)
            print(f"Installing {package}", flush=True)
            subprocess.run([str(tools / "sdkmanager"), "--install", package], check=True)
        elif package in updates:
            print(f"Updating {package} from revision {updates[package][0]} to {updates[package][1]}", flush=True)
            subprocess.run([str(tools / "sdkmanager"), "--install", package], check=True)
        config = avd_home / f"{name}.avd" / "config.ini"
        if not config.is_file() or not config.read_text().endswith(avd_settings):
            print(f"Creating AVD {name}", flush=True)
            subprocess.run([str(tools / "avdmanager"), "create", "avd", "--force", "--name", name, "--package", package, "--device", "pixel_6"], input="no\n", text=True, check=True)
            with config.open("a") as file:
                file.write(avd_settings)


def wait_for_metro(process, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Metro exited before it was ready")
        try:
            with urlopen("http://127.0.0.1:8081/status", timeout=2) as response:
                if response.read().strip() == b"packager-status:running":
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError("Metro did not become ready on port 8081")


def app_running(serial):
    result = subprocess.run(["adb", "-s", serial, "shell", "pidof", "net.openbeacon.app"], capture_output=True, text=True, timeout=10)
    return result.returncode == 0 and bool(result.stdout.strip())


def launch_apps(ports, attempts=3, stable_seconds=15):
    remaining = set(ports)
    launch_counts = {port: 0 for port in ports}
    link = "exp+open-beacon://expo-development-client/?url=" + quote("http://127.0.0.1:8081", safe="")
    while remaining:
        for port in list(remaining):
            serial = f"emulator-{port}"
            if launch_counts[port] >= attempts:
                raise RuntimeError(f"OpenBeacon could not stay running on {serial} after {attempts} attempts. Check the emulator's available memory and Android logs.")
            launch_counts[port] += 1
            print(f"Launching OpenBeacon on {serial} (attempt {launch_counts[port]}/{attempts})", flush=True)
            result = subprocess.run(["adb", "-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", link, "net.openbeacon.app"], capture_output=True, text=True, timeout=60)
            if result.returncode != 0 or "Error" in result.stdout or "Exception" in result.stdout:
                print(f"Launch failed on {serial}: {result.stderr.strip() or result.stdout.strip()}", flush=True)
                continue
            deadline = time.monotonic() + stable_seconds
            while time.monotonic() < deadline:
                if not app_running(serial):
                    print(f"OpenBeacon stopped during startup on {serial}; retrying.", flush=True)
                    break
                time.sleep(1)
            else:
                remaining.remove(port)
        for port in ports:
            if port not in remaining and not app_running(f"emulator-{port}"):
                print(f"OpenBeacon stopped on emulator-{port}; retrying.", flush=True)
                remaining.add(port)


def main():
    parser = argparse.ArgumentParser(description="Run Android emulators with Derby GPS simulations.")
    devices_group = parser.add_mutually_exclusive_group()
    devices_group.add_argument("--avd", help="Existing Android Virtual Device name for four route emulators (defaults to the first available)")
    devices_group.add_argument("--android-versions", nargs="*", type=int, choices=list(ANDROID_VERSIONS), metavar="API", help=f"Run one emulator per listed API level, creating missing AVDs; repeat a level to run several emulators of it (default: {' '.join(map(str, ANDROID_VERSIONS))})")
    parser.add_argument("--memory-mb", type=int, help="RAM per emulator in MiB (default: 6144, or typical for each version with --android-versions)")
    parser.add_argument("--skip-memory-check", action="store_true", help="Start the emulators even if the machine does not appear to have enough free RAM")
    parser.add_argument("--api-url", default="http://10.0.2.2:3000", help="Existing backend URL reachable from Android; skips local backend startup")
    parser.add_argument("--external-backend", action="store_true", help="Use an already running backend, including at the default URL")
    parser.add_argument("--apk", type=Path, help="Use an existing Expo development APK instead of building one")
    args = parser.parse_args()
    if args.memory_mb is not None and args.memory_mb < 1:
        parser.error("--memory-mb must be a positive integer")
    api_levels = None if args.android_versions is None else args.android_versions or list(ANDROID_VERSIONS)
    url = urlparse(args.api_url)
    if url.scheme not in ("http", "https") or not url.netloc or url.path not in ("", "/") or url.query or url.fragment:
        parser.error("--api-url must be an HTTP(S) origin without a path, query or fragment")
    configured_sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    sdk = select_android_sdk(Path(configured_sdk) if configured_sdk else None, Path.home() / "Android/Sdk")
    if sdk:
        os.environ["ANDROID_HOME"] = str(sdk)
        os.environ["ANDROID_SDK_ROOT"] = str(sdk)
        os.environ["PATH"] = os.pathsep.join([str(sdk / "emulator"), str(sdk / "platform-tools"), os.environ.get("PATH", "")])
        if configured_sdk and sdk != Path(configured_sdk):
            print(f"Using Android SDK at {sdk}; {configured_sdk} has no installed NDK or accepted Android SDK licence.", flush=True)
    java17 = Path("/usr/lib/jvm/java-17-openjdk")
    if java17.joinpath("bin/java").is_file():
        current_java = Path(os.environ["JAVA_HOME"]) / "bin/java" if os.environ.get("JAVA_HOME") else shutil.which("java")
        version = subprocess.run([str(current_java), "-version"], capture_output=True, text=True) if current_java else None
        if not version or 'version "17.' not in version.stderr:
            os.environ["JAVA_HOME"] = str(java17)
            os.environ["PATH"] = os.pathsep.join([str(java17 / "bin"), os.environ.get("PATH", "")])
            print(f"Using Java 17 at {java17}.", flush=True)
    for command in ("adb", "emulator", "bun"):
        if not shutil.which(command):
            parser.error(f"{command} must be on PATH")
    if api_levels is None:
        avds = subprocess.check_output(["emulator", "-list-avds"], text=True).splitlines()
        if not avds:
            parser.error("no AVD found; create an Android Virtual Device in Android Studio first")
        args.avd = args.avd or avds[0]
        if args.avd not in avds:
            parser.error(f"AVD {args.avd!r} not found; available: {', '.join(avds) or 'none'}")
        devices = [(args.avd, route[0], args.memory_mb or 6144, route) for route in ROUTES]
    else:
        if not sdk:
            parser.error("set ANDROID_HOME to your Android SDK to create an emulator for each Android version")
        devices = version_devices(api_levels, args.memory_mb)
    if not args.skip_memory_check:
        available_mb = available_memory_mb(platform.system())
        if available_mb is None:
            print("Could not read available memory; skipping the RAM check.", flush=True)
        error = memory_error(devices, available_mb)
        if error:
            parser.error(error)
    existing = subprocess.check_output(["adb", "devices"], text=True)
    ports = [5554 + 2 * index for index in range(len(devices))]
    if any(f"emulator-{port}\t" in existing for port in ports):
        parser.error(f"emulator ports {ports[0]}–{ports[-1]} are in use; stop those emulators first")
    external_backend = args.external_backend or args.api_url != "http://10.0.2.2:3000"
    if not external_backend and not shutil.which("docker"):
        parser.error("docker and Docker Compose are required for the local backend")
    env_file = ROOT / ".env"
    if not external_backend:
        if not env_file.exists():
            template = (ROOT / ".env.example").read_text()
            env_file.write_text(template.replace("BETTER_AUTH_SECRET=                    # Min 32 chars, generate with: openssl rand -base64 32", f"BETTER_AUTH_SECRET={secrets.token_urlsafe(32)}"))
            env_file.chmod(0o600)
            print("Created .env with a generated authentication secret.", flush=True)
        values = {}
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.split(" #", 1)[0].strip().strip("\"'")
        required = ("BETTER_AUTH_SECRET", "S3_ACCESS_KEY_ID", "S3_ACCESS_KEY", "S3_BUCKET_NAME", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PM_TILES_KEY")
        missing = [key for key in required if not values.get(key)]
        if missing:
            parser.error(f"set these required values in {env_file}: {', '.join(missing)}")
    children = []
    emulator_logs = []
    log_directory = None
    previous_sigint = signal.getsignal(signal.SIGINT)

    def stop_simulation(signum, frame):
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, stop_simulation)
    try:
        if api_levels is not None:
            create_version_avds(sdk, api_levels, "arm64-v8a" if platform.machine().lower() in ("arm64", "aarch64") else "x86_64")
        subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=ROOT, check=True)
        if not external_backend:
            subprocess.run(["docker", "compose", "up", "-d", "--wait", "db", "redis"], cwd=ROOT, check=True)
            subprocess.run(["bun", "run", "db:generate"], cwd=ROOT / "packages/database", check=True)
            subprocess.run(["bun", "run", "db:migrate:deploy"], cwd=ROOT / "packages/database", check=True)
            backend_env = os.environ.copy()
            backend_env["BETTER_AUTH_URL"] = args.api_url.rstrip("/")
            backend_env["OPENBEACON_API_HOSTNAME"] = "127.0.0.1"
            children.append(subprocess.Popen(["bun", "run", "--env-file=.env", "--hot", "apps/backend/src/index.ts"], cwd=ROOT, env=backend_env, stdin=subprocess.DEVNULL, start_new_session=True))
        if args.apk is None:
            subprocess.run(["bun", "x", "expo", "prebuild", "--platform", "android"], cwd=ROOT / "apps/mobile", check=True)
            subprocess.run(["./gradlew", "assembleDebug"], cwd=ROOT / "apps/mobile/android", check=True)
            args.apk = ROOT / "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
        if not args.apk.is_file():
            parser.error(f"development build APK not found: {args.apk}")
        env = os.environ.copy()
        env["EXPO_PUBLIC_DEV_API_URL"] = args.api_url.rstrip("/")
        metro = subprocess.Popen(["bun", "x", "expo", "start", "--dev-client", "--port", "8081", "--clear"], cwd=ROOT / "apps/mobile", env=env, stdin=subprocess.DEVNULL, start_new_session=True)
        children.append(metro)
        log_directory = Path(tempfile.mkdtemp(prefix="openbeacon-emulators-"))
        print(f"Emulator logs: {log_directory}", flush=True)
        for port, (avd, label, memory_mb, _) in zip(ports, devices):
            print(f"Starting {label} on emulator-{port} with {memory_mb} MiB RAM", flush=True)
            log = (log_directory / f"emulator-{port}.log").open("w")
            emulator_logs.append(log)
            children.append(subprocess.Popen(["emulator", "-avd", avd, "-port", str(port), "-memory", str(memory_mb), "-read-only", "-no-snapshot-save", "-gpu", "host"], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
        for port in ports:
            serial = f"emulator-{port}"
            subprocess.run(["adb", "-s", serial, "wait-for-device"], check=True, timeout=300)
            deadline = time.monotonic() + 300
            while subprocess.run(["adb", "-s", serial, "shell", "getprop", "sys.boot_completed"], capture_output=True, text=True).stdout.strip() != "1":
                if time.monotonic() > deadline:
                    raise TimeoutError(f"{serial} did not finish booting")
                time.sleep(2)
            subprocess.run(["adb", "-s", serial, "install", "-r", str(args.apk)], check=True)
            subprocess.run(["adb", "-s", serial, "reverse", "tcp:8081", "tcp:8081"], check=True)
        started = time.monotonic()
        for port, (_, _, _, (_, _, points)) in zip(ports, devices):
            lat, lon = points[0]
            subprocess.run(["adb", "-s", f"emulator-{port}", "emu", "geo", "fix", str(lon), str(lat)], check=True, stdout=subprocess.DEVNULL)
        print("Waiting for Metro to become ready.", flush=True)
        wait_for_metro(metro)
        launch_apps(ports)
        print("Simulating locations every second. Press Ctrl+C to stop.", flush=True)
        while True:
            if any(child.poll() is not None for child in children):
                raise RuntimeError("Metro or an emulator exited unexpectedly")
            elapsed = time.monotonic() - started
            for port, (_, _, _, (_, mph, points)) in zip(ports, devices):
                lat, lon = position(points, mph, elapsed)
                subprocess.run(["adb", "-s", f"emulator-{port}", "emu", "geo", "fix", str(lon), str(lat)], check=True, stdout=subprocess.DEVNULL)
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping simulation.")
    except RuntimeError as error:
        print(str(error), flush=True)
        if log_directory:
            print(f"Emulator logs: {log_directory}", flush=True)
        raise SystemExit(1) from None
    except subprocess.CalledProcessError as error:
        if "assembleDebug" in error.cmd:
            print("Android build failed. If the NDK or its licence is missing, install the NDK and accept the SDK licences in Android Studio's SDK Manager, then retry. Check ANDROID_HOME and ANDROID_SDK_ROOT point to that SDK.", flush=True)
        else:
            print(f"Command failed: {error.cmd[0]} (exit {error.returncode})", flush=True)
        raise SystemExit(error.returncode) from None
    finally:
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
        for log in emulator_logs:
            log.close()
        signal.signal(signal.SIGINT, previous_sigint)


if __name__ == "__main__":
    main()
