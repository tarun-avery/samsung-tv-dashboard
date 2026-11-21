"""Install the local Mac watchlist helper and register its user LaunchAgent."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener

from companion import PORT, mac_lan

LABEL = "local.watchlist-companion"
SOURCE = Path(__file__).resolve().parent
DEST = Path.home() / "Library/Application Support/Watchlist Companion"


def install_file(source, target, mode):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
        with source.open("rb") as contents:
            shutil.copyfileobj(contents, tmp)
    temp = Path(tmp.name)
    try:
        temp.chmod(mode)
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    launchctl = "/bin/launchctl"
    domain = f"gui/{os.getuid()}"
    service = domain + "/" + LABEL
    agent = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
    with tempfile.TemporaryDirectory() as tmp:
        staging = Path(tmp)
        binary = staging / "watchlist-qr"
        subprocess.run(["/usr/bin/xcrun", "swiftc", "-O", str(SOURCE / "qr.swift"), "-o", str(binary)], check=True)
        install_file(binary, DEST / "watchlist-qr", 0o700)
        for name in ("store.py", "companion.py", "episode_guide.py", "uk-release-notes.json", "public/index.html", "public/app.js", "public/style.css"):
            install_file(SOURCE / name, DEST / name, 0o600)
        plist = staging / "agent.plist"
        plist.write_bytes(plistlib.dumps({
            "Label": LABEL, "ProgramArguments": [sys.executable, "-EsB", str(DEST / "companion.py")],
            "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 20,
            "ProcessType": "Background", "Umask": 0o077,
            "StandardErrorPath": str(DEST / "service.log")
        }))
        install_file(plist, agent, 0o600)
    if subprocess.run([launchctl, "print", service], capture_output=True).returncode == 0:
        subprocess.run([launchctl, "bootout", service], check=True)
    subprocess.run([launchctl, "enable", service], check=True)
    subprocess.run([launchctl, "bootstrap", domain, str(agent)], check=True)
    try:
        host = mac_lan()
    except OSError:
        print("Phone companion installed. Connect your Mac to a private LAN to start accepting pairings.")
        return
    origin = f"http://{host}:{PORT}"
    opener = build_opener(ProxyHandler({}))
    for _ in range(30):
        try:
            with opener.open(origin, timeout=1) as response:
                if b'id="code-form"' in response.read():
                    print(f"Phone companion is ready. TV and phone address: {origin}")
                    return
        except OSError:
            pass
        time.sleep(0.5)
    raise SystemExit(f"LaunchAgent was registered but the companion did not answer. See {DEST / 'service.log'}.")


if __name__ == "__main__":
    main()
