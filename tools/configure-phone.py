"""Allow the configured companion origin in a staged Tizen widget."""
import ipaddress
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

origin_file, stage = map(Path, sys.argv[1:])
url = urlsplit(origin_file.read_text().strip())
host = url.hostname or ""
try:
    address = ipaddress.IPv4Address(host)
    local = any(address in ipaddress.ip_network(network) for network in
                ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
except ipaddress.AddressValueError:
    local = re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.local", host) is not None
if not (url.scheme == "http" and local and url.port and not url.username and not url.password
        and url.path in ("", "/") and not url.query and not url.fragment):
    raise SystemExit("phone-origin.txt must contain an HTTP origin with a private IPv4 or .local name and a port.")
origin = f"http://{host}:{url.port}"
manifest = stage / "config.xml"
closing = "</widget>"
xml = manifest.read_text()
if xml.count(closing) != 1:
    raise SystemExit("Invalid staged widget manifest.")
manifest.write_text(xml.replace(closing, f'    <access origin="{origin}"/>\n{closing}'))
(stage / "phone-location.js").write_text("window.dashboardPhoneOrigin = " + json.dumps(origin) + ";\n")
