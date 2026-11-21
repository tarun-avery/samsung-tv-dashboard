"""Private, local SQLite queues and short-lived pairing capabilities."""
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
import json
import os
import secrets
import sqlite3
import time
from uuid import UUID, uuid4

SERVICES = ("Netflix", "Paramount+", "Crunchyroll", "Prime Video", "Apple TV", "Disney+")
PAIR_TTL = 15 * 60
PHONE_TTL = 3600
ITEM_TTL = 7 * 86400


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def digest(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        return ""
    return sha256(value.encode()).hexdigest()


def number(value, label):
    if type(value) is not int or not 1 <= value <= 999:
        raise Problem(400, f"{label} must be a whole number from 1 to 999.")
    return value


def clean_item(data):
    title = data.get("title")
    if not isinstance(title, str) or not title.strip() or len(title.strip().encode("utf-16-le")) // 2 > 80:
        raise Problem(400, "Enter a title of up to 80 characters.")
    if any(not c.isprintable() for c in title.strip()):
        raise Problem(400, "Use a single line for the title.")
    kind, service = data.get("kind"), data.get("service")
    if kind not in ("film", "series") or service not in SERVICES:
        raise Problem(400, "Choose a film or series and a supported streaming service.")
    return {"title": title.strip(), "kind": kind, "service": service,
            "minutes": number(data.get("minutes"), "Running time"),
            "season": number(data.get("season", 1), "Season") if kind == "series" else 1,
            "episode": number(data.get("episode", 1), "Episode") if kind == "series" else 1}


class Queue:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        with self.transaction(clean=False) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS televisions(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, active INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS invites(tv TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS phones(token TEXT PRIMARY KEY, tv TEXT NOT NULL, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS entries(tv TEXT NOT NULL, id TEXT NOT NULL, payload TEXT, created INTEGER NOT NULL,
                    PRIMARY KEY(tv, id));
                CREATE TABLE IF NOT EXISTS limits(ip TEXT NOT NULL, bucket TEXT NOT NULL, start INTEGER NOT NULL, hits INTEGER NOT NULL,
                    PRIMARY KEY(ip, bucket));
            """)

    @contextmanager
    def transaction(self, clean=True):
        db = sqlite3.connect(self.path, timeout=6)
        try:
            with db:
                db.execute("BEGIN IMMEDIATE")
                if clean:
                    now = int(time.time())
                    db.execute("DELETE FROM invites WHERE expires <= ?", (now,))
                    db.execute("DELETE FROM phones WHERE expires <= ?", (now,))
                    db.execute("DELETE FROM entries WHERE created <= ?", (now - ITEM_TTL,))
                    db.execute("DELETE FROM limits WHERE start <= ?", (now - 3600,))
                    db.execute("DELETE FROM televisions WHERE active < ?", (now - 90 * 86400,))
                yield db
        finally:
            db.close()

    def limit(self, ip, group, maximum):
        with self.transaction() as db:
            now = int(time.time())
            db.execute("""INSERT INTO limits VALUES(?,?,?,1)
                ON CONFLICT(ip,bucket) DO UPDATE SET hits=hits+1""", (ip, group, now))
            hits, = db.execute("SELECT hits FROM limits WHERE ip=? AND bucket=?", (ip, group)).fetchone()
        if hits > maximum:
            raise Problem(429, "Too many attempts. Try again later.")

    def television(self, db, token):
        row = db.execute("SELECT id FROM televisions WHERE token=?", (digest(token),)).fetchone()
        if not row:
            raise Problem(401, "This TV pairing is no longer available. Pair the TV again.")
        db.execute("UPDATE televisions SET active=? WHERE id=?", (int(time.time()), row[0]))
        return row[0]

    def pair(self, tv_token, ip):
        self.limit(ip, "pair", 50)
        now = int(time.time())
        with self.transaction() as db:
            if tv_token is not None:
                tv = self.television(db, tv_token)
            else:
                tv, tv_token = str(uuid4()), secrets.token_urlsafe(32)
                db.execute("INSERT INTO televisions VALUES(?,?,?)", (tv, digest(tv_token), now))
            join_token = secrets.token_urlsafe(32)
            while True:
                code = f"{secrets.randbelow(100000000):08d}"
                if not db.execute("SELECT 1 FROM invites WHERE code=?", (digest(code),)).fetchone():
                    break
            db.execute("INSERT OR REPLACE INTO invites VALUES(?,?,?,?)",
                       (tv, digest(join_token), digest(code), now + PAIR_TTL))
        return tv_token, join_token, code, now + PAIR_TTL

    def join(self, body, ip):
        has_code = "code" in body
        if has_code:
            self.limit(ip, "code", 16)
            self.limit("*", "allcodes", 120)
        selector = "code" if has_code else "token"
        with self.transaction() as db:
            key = digest(body.get("code" if has_code else "joinToken"))
            row = db.execute(f"SELECT tv FROM invites WHERE {selector}=?", (key,)).fetchone()
            if not row:
                raise Problem(401, "This pairing has expired or was already used. Open a new code on the TV.")
            tv = row[0]
            db.execute("DELETE FROM invites WHERE tv=?", (tv,))
            token, expiry = secrets.token_urlsafe(32), int(time.time()) + PHONE_TTL
            db.execute("INSERT INTO phones VALUES(?,?,?)", (digest(token), tv, expiry))
        return {"phoneToken": token, "expiresAt": expiry}

    def add(self, phone_token, data):
        try:
            ident = str(UUID(str(data.get("id"))))
        except ValueError:
            raise Problem(400, "The request needs a valid item ID.") from None
        item = clean_item(data)
        with self.transaction() as db:
            row = db.execute("SELECT tv FROM phones WHERE token=?", (digest(phone_token),)).fetchone()
            if not row:
                raise Problem(401, "Your phone session ended. Open a new code on the TV.")
            tv = row[0]
            existing = db.execute("SELECT payload FROM entries WHERE tv=? AND id=?", (tv, ident)).fetchone()
            payload = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if existing:
                if existing[0] is not None and existing[0] != payload:
                    raise Problem(409, "This item ID was already used for a different title.")
                return {"id": ident, "state": "queued" if existing[0] else "saved"}
            count, = db.execute("SELECT COUNT(*) FROM entries WHERE tv=? AND payload IS NOT NULL", (tv,)).fetchone()
            if count >= 100:
                raise Problem(409, "The TV queue is full. Open Add from phone on the TV to collect titles.")
            db.execute("INSERT INTO entries VALUES(?,?,?,?)", (tv, ident, payload, int(time.time())))
        return {"id": ident, "state": "queued"}

    def status(self, phone_token, ident):
        with self.transaction() as db:
            phone = db.execute("SELECT tv FROM phones WHERE token=?", (digest(phone_token),)).fetchone()
            if not phone:
                raise Problem(401, "Your phone session ended. Open a new code on the TV.")
            row = db.execute("SELECT payload FROM entries WHERE tv=? AND id=?", (phone[0], ident)).fetchone()
            if not row:
                raise Problem(404, "This title is no longer in the import queue.")
            return {"state": "queued" if row[0] is not None else "saved"}

    def pending(self, token):
        with self.transaction() as db:
            tv = self.television(db, token)
            rows = db.execute("SELECT id,payload FROM entries WHERE tv=? AND payload IS NOT NULL ORDER BY rowid", (tv,))
            return {"items": [dict(json.loads(payload), id=ident) for ident, payload in rows]}

    def ack(self, token, ids):
        if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(i, str) or len(i) != 36 for i in ids):
            raise Problem(400, "Supply a list of imported IDs.")
        with self.transaction() as db:
            tv = self.television(db, token)
            db.executemany("UPDATE entries SET payload=NULL WHERE tv=? AND id=?", [(tv, i) for i in ids])
        return {"ok": True}
