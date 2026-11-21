"""Episode dates and UK evidence for a single watchlisted series. Runs on the Mac."""
from contextlib import closing
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from store import Problem, SERVICES

LONDON = ZoneInfo("Europe/London")
TVMAZE = "https://api.tvmaze.com"
WATCHMODE = "https://api.watchmode.com/v1"
HISTORY_DAYS = 30
FUTURE_DAYS = 14
ALIASES = {
    "amazon prime": "Prime Video", "amazon prime video": "Prime Video",
    "prime video": "Prime Video", "apple tv+": "Apple TV", "apple tv plus": "Apple TV",
    "netflix with ads": "Netflix", "netflix standard with ads": "Netflix",
    "paramount plus": "Paramount+", "disney plus": "Disney+",
}
ALIASES.update({name.lower(): name for name in SERVICES})


def provider(name):
    return ALIASES.get((name or "").strip().lower())


def spelling(name):
    return "".join(c for c in unicodedata.normalize("NFKD", name.casefold()) if c.isalnum())


def request_json(url, key=None):
    headers = {"User-Agent": "SamsungTVDashboard-EpisodeGuide/1.0", "Accept": "application/json"}
    if key:
        headers["X-API-Key"] = key
    with urlopen(Request(url, headers=headers), timeout=6) as response:
        limit = 12 * 1024 * 1024
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Oversized catalogue response")
        return json.loads(data)


def uk_channel(channel, service):
    channel = channel or {}
    return ((channel.get("country") or {}).get("code") == "GB"
            and provider(channel.get("name")) == service)


def episode_row(item, source, status, url, now):
    season, number = item.get("season"), item.get("number")
    if type(season) is not int or type(number) is not int or min(season, number) < 1:
        return None
    try:
        day = date.fromisoformat(item["airdate"])
        stamp = item.get("airstamp")
        instant = datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None
        if instant and instant.tzinfo:
            day = instant.astimezone(LONDON).date()
        else:
            instant = None
    except (TypeError, ValueError, KeyError):
        return None
    today = now.date()
    if not today - timedelta(days=HISTORY_DAYS - 1) <= day <= today + timedelta(days=FUTURE_DAYS):
        return None
    return {"season": season, "episode": number, "date": day.isoformat(),
            "name": str(item.get("name") or "")[:150], "source": source, "url": url,
            "evidence": status, "upcoming": instant > now if instant else day > today}


class EpisodeGuide:
    def __init__(self, folder, fetch=request_json):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.fetch = fetch
        self.db = self.folder / "episodes-cache.sqlite3"
        self.lock = threading.Lock()
        self.keyfile = self.folder / "watchmode.key"
        self.bulletins = json.loads(Path(__file__).with_name("uk-release-notes.json").read_text())
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS lookups (id TEXT PRIMARY KEY, checked INTEGER, data TEXT)")

    def lookup(self, body):
        title, service, chosen = body.get("title"), body.get("service"), body.get("seriesId")
        if (not isinstance(title, str) or not title.strip() or len(title) > 80 or
            not isinstance(service,str) or service not in SERVICES or
            (chosen is not None and (type(chosen) is not int or not 0 < chosen < 10_000_000))):
            raise Problem(400, "Choose a saved series and one of the six guide services.")
        key = self.keyfile.read_text().strip() if self.keyfile.is_file() else ""
        cache_id = json.dumps([spelling(title), service, chosen, bool(key)])
        now = datetime.now(LONDON)
        stamp = int(now.timestamp())
        # Coalesce concurrent lookups and avoid racing upstream rate limits on the LAN.
        with self.lock, closing(sqlite3.connect(self.db)) as db:
            cached = db.execute("SELECT checked,data FROM lookups WHERE id=?", (cache_id,)).fetchone()
            if cached and stamp - cached[0] < 3600*4 and datetime.fromtimestamp(cached[0],LONDON).date()==now.date():
                return json.loads(cached[1])
            try:
                result = self.resolve(title.strip(), service, chosen, now, key)
            except (OSError, ValueError, KeyError, TypeError):
                if cached and stamp - cached[0] < 7*86400:
                    result = json.loads(cached[1])
                    result["stale"] = True
                    return result
                raise Problem(503, "Episode listings are unavailable. Try again later.") from None
            result["checked"] = now.isoformat(timespec="minutes")
            with db:
                db.execute("INSERT OR REPLACE INTO lookups VALUES(?,?,?)", (cache_id, stamp, json.dumps(result)))
                db.execute("DELETE FROM lookups WHERE checked < ?", (stamp-7*86400,))
            return result

    def resolve(self, title, service, chosen, now, key):
        if chosen:
            show = self.fetch(f"{TVMAZE}/shows/{chosen}")
        else:
            matches = [r["show"] for r in self.fetch(TVMAZE+"/search/shows?"+urlencode({"q":title}))]
            exact = [s for s in matches if spelling(s["name"]) == spelling(title)]
            if len(exact) != 1:
                return {"matches": [{"id":s["id"],"name":s["name"],"year":(s.get("premiered") or "")[:4],
                                     "channel":(s.get("webChannel") or s.get("network") or {}).get("name","")}
                                    for s in (exact or matches)[:6]]}
            show = exact[0]
        ident = int(show["id"])
        base = f"{TVMAZE}/shows/{ident}"
        source_url = show.get("url", "https://www.tvmaze.com")
        rows = {}
        def add(item, label, status, link):
            row = episode_row(item, label, status, link, now)
            if row:
                rows[row["season"], row["episode"]] = row
        original = self.fetch(base+"/episodes")
        status = "uk-release" if uk_channel(show.get("webChannel"),service) else "airdate"
        for item in original:
            add(item, "TVmaze", status, item.get("url") or source_url)
        # A global channel's original premiere is not proof of a UK release.
        for listing in self.fetch(base+"/alternatelists"):
            if not uk_channel(listing.get("webChannel"),service):
                continue
            for item in self.fetch(f"{TVMAZE}/alternatelists/{int(listing['id'])}/alternateepisodes"):
                add(item, "TVmaze UK", "uk-release", listing.get("url") or source_url)
        for bulletin in self.bulletins:
            if bulletin["id"] != ident or bulletin["service"] != service:
                continue
            for season, number, day in bulletin["episodes"]:
                item = {"season":season,"number":number,"airdate":day,
                        "name":rows.get((season,number),{}).get("name","")}
                add(item, bulletin["source"], "uk-release", bulletin["url"])
        note = ""
        imdb = (show.get("externals") or {}).get("imdb")
        if key and rows and isinstance(imdb,str) and re.fullmatch(r"tt\d+",imdb):
            try:
                for season in sorted({s for s,n in rows}):
                    params = urlencode({"regions":"GB","season":season,"include_sources":"true"})
                    for item in self.fetch(f"{WATCHMODE}/title/{imdb}/episodes?{params}",key):
                        row = rows.get((item.get("season_number"),item.get("episode_number")))
                        if not row or row["upcoming"] or row["evidence"] == "uk-release":
                            continue
                        for offer in item.get("sources") or []:
                            if (offer.get("region") == "GB" and offer.get("type") == "sub" and
                                provider(offer.get("name")) == service):
                                row.update(evidence="uk-catalogue",source="Watchmode GB + TVmaze",
                                           url=offer.get("web_url") or "https://www.watchmode.com/")
                                break
            except (OSError, ValueError, TypeError):
                note = "UK subscription catalogue unavailable. Showing the evidence available."
        episodes = sorted(rows.values(),key=lambda e:(e["date"],e["season"],e["episode"]),reverse=True)
        return {"seriesId":ident,"name":show["name"],"url":source_url,"episodes":episodes,"note":note}
