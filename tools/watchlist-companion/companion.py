#!/usr/bin/env python3
"""Serve a private watchlist pairing and queue on the Mac's local network."""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit

from episode_guide import EpisodeGuide
from store import Problem, Queue

HERE = Path(__file__).resolve().parent
PORT = 47831
LAN = tuple(map(ipaddress.ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8")))


def local_ip(value):
    try:
        address = ipaddress.IPv4Address(value)
        return any(address in network for network in LAN)
    except ipaddress.AddressValueError:
        return False


def mac_lan():
    # Prefer the interface used by the default route; allow a physical LAN alongside a VPN.
    route = subprocess.run(["/sbin/route", "-n", "get", "default"], capture_output=True, text=True)
    first = [line.split()[-1] for line in route.stdout.splitlines() if line.strip().startswith("interface:")]
    names = first + [name for _, name in socket.if_nameindex()]
    for name in dict.fromkeys(names):
        if not name.startswith("en"):
            continue
        reply = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", name], capture_output=True, text=True)
        ip = reply.stdout.strip()
        if local_ip(ip):
            return ip
    raise OSError("No private IPv4 LAN address is available.")


def render_qr(link):
    png = subprocess.run([str(HERE / "watchlist-qr")], input=link.encode(), capture_output=True, timeout=8, check=True)
    return "data:image/png;base64," + base64.b64encode(png.stdout).decode("ascii")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log pairing links, request bodies or bearer credentials.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, status, data=None, mime="application/json"):
        content = json.dumps(data).encode() if data is not None and mime == "application/json" else (data or b"")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if self.path in ("/api/pair", "/api/queue", "/api/ack", "/api/episodes"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if content:
            self.wfile.write(content)

    def handle_request(self):
        if not local_ip(self.client_address[0]) or self.headers.get("Host", "").lower() not in self.server.hosts:
            raise Problem(403, "Open the local address shown on the TV.")
        if self.command == "OPTIONS":
            self.reply(204)
            return
        auth = self.headers.get("Authorization")
        token = None
        if auth is not None:
            if not auth.startswith("Bearer ") or len(auth) > 160:
                raise Problem(401, "The pairing credential was not recognised.")
            token = auth[7:]
        if self.command == "GET":
            if self.path == "/api/queue":
                self.reply(200, self.server.store.pending(token))
                return
            if self.path.startswith("/api/items/"):
                self.reply(200, self.server.store.status(token, self.path[len("/api/items/"):]))
                return
            files = {"/": ("index.html", "text/html; charset=utf-8"),
                     "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                     "/style.css": ("style.css", "text/css; charset=utf-8")}
            if self.path in files:
                name, mime = files[self.path]
                self.reply(200, (HERE / "public" / name).read_bytes(), mime)
                return
            raise Problem(404, "Page not found.")
        if self.headers.get_content_type() != "application/json":
            raise Problem(415, "Send JSON for this action.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= 12000:
            raise Problem(400, "Invalid request size.")
        try:
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError()
        except (UnicodeError, ValueError):
            raise Problem(400, "Invalid request body.") from None
        ip = self.client_address[0]
        if self.path == "/api/episodes":
            origin = self.headers.get("Origin", "")
            if origin not in ("", "null", "file://") and not origin.startswith("widget://"):
                host = urlsplit(origin).hostname or ""
                if not (local_ip(host) or host == "localhost" or host.endswith(".local")):
                    raise Problem(403, "Open the episode guide on the TV.")
            self.server.store.limit(ip, "episodes", 360)
            self.reply(200, self.server.episodes.lookup(body))
        elif self.path == "/api/pair":
            tv, invite, code, expiry = self.server.store.pair(token, ip)
            link = self.server.origin + "/#join=" + invite
            self.reply(201, {"tvToken": tv, "phoneUrl": link, "phoneBaseUrl": self.server.origin,
                             "phoneCode": code, "qrDataUrl": self.server.qr(link), "expiresAt": expiry})
        elif self.path == "/api/ack":
            self.reply(200, self.server.store.ack(token, body.get("ids")))
        elif self.path in ("/api/join", "/api/items"):
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + self.headers["Host"]:
                raise Problem(403, "Open the phone page directly.")
            if self.path.endswith("/join"):
                self.reply(200, self.server.store.join(body, ip))
            else:
                self.reply(201, self.server.store.add(token, body))
        else:
            raise Problem(404, "Page not found.")

    def dispatch(self):
        try:
            self.handle_request()
        except Problem as exc:
            self.reply(exc.status, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            # Keep private payloads out of background service logs.
            self.reply(503, {"error": "The companion could not complete this request. Try again."})

    do_OPTIONS = do_GET = do_POST = dispatch


def make_server(bind, port, data, qr=render_qr):
    if not local_ip(bind):
        raise ValueError("Bind to a private IPv4 address or loopback.")
    server = ThreadingHTTPServer((bind, port), Handler)
    port = server.server_address[1]
    server.origin = f"http://{bind}:{port}"
    names = {bind, socket.gethostname().lower(), socket.gethostname().lower().split(".")[0] + ".local"}
    if bind.startswith("127."):
        names.add("localhost")
    server.hosts = {f"{name}:{port}" for name in names}
    server.store = Queue(data / "watchlist.sqlite3")
    server.episodes = EpisodeGuide(data)
    server.qr = qr
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="auto", help="private LAN IPv4 or auto")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--data", type=Path, default=Path.home() / "Library/Application Support/Watchlist Companion")
    args = parser.parse_args()
    os.umask(0o077)
    if not (HERE / "watchlist-qr").is_file():
        parser.error("Build the QR helper with install.py first.")
    automatic = args.bind == "auto"
    while True:
        bind = mac_lan() if automatic else args.bind
        with make_server(bind, args.port, args.data) as server:
            if sys.stdout.isatty():
                print(f"Watching for TV pairings at {server.origin}", flush=True)
            if not automatic:
                server.serve_forever()
                return
            server.timeout = 1
            check = time.monotonic() + 30
            while time.monotonic() < check or mac_lan() == bind:
                if time.monotonic() >= check:
                    check = time.monotonic() + 30
                server.handle_request()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
