import base64
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
from threading import Thread
import time
import unittest
from uuid import uuid4

from companion import make_server


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.server = make_server("127.0.0.1", 0, Path(self.folder.name),
                                  qr=lambda link: "test:" + base64.b64encode(link.encode()).decode())
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.folder.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def api(self, method, path, data=None, token=None, host=None):
        client = HTTPConnection(*self.server.server_address, timeout=3)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if host:
            headers["Host"] = host
        try:
            client.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def pair(self):
        status, pair = self.api("POST", "/api/pair", {})
        self.assertEqual(status, 201)
        return pair

    def test_one_time_join_queue_retry_ack_and_status(self):
        pair = self.pair()
        _, phone = self.api("POST", "/api/join", {"joinToken": pair["phoneUrl"].split("#join=")[1]})
        self.assertIn("phoneToken", phone)
        self.assertEqual(self.api("POST", "/api/join", {"code":pair["phoneCode"]})[0],401)
        entry = dict(id=str(uuid4()), title="A fictional episode", service="Apple TV", kind="series", minutes=41, season=2, episode=5)
        for _ in range(2):
            self.assertEqual(self.api("POST", "/api/items", entry, phone["phoneToken"])[1]["state"], "queued")
        self.assertEqual(self.api("GET", "/api/queue", token=pair["tvToken"])[1]["items"], [entry])
        self.assertEqual(self.api("GET", "/api/items/"+entry["id"], token=phone["phoneToken"])[1]["state"], "queued")
        for _ in range(2):
            self.assertEqual(self.api("POST", "/api/ack", {"ids":[entry["id"]]}, pair["tvToken"])[0], 200)
        self.assertEqual(self.api("POST", "/api/items", entry, phone["phoneToken"])[1]["state"], "saved")
        self.assertEqual(self.api("GET", "/api/queue", token=pair["tvToken"])[1]["items"], [])
        self.assertEqual(self.api("GET", "/api/items/"+entry["id"], token=phone["phoneToken"])[1]["state"], "saved")

    def test_distinct_tvs_repair_and_input_rules(self):
        original, other = self.pair(), self.pair()
        status, renewed = self.api("POST", "/api/pair", {}, original["tvToken"])
        self.assertEqual((status, renewed["tvToken"]), (201, original["tvToken"]))
        self.assertEqual(self.api("POST", "/api/join", {"code":original["phoneCode"]})[0],401)
        _, phone = self.api("POST", "/api/join", {"code":renewed["phoneCode"]})
        self.assertEqual(self.api("GET", "/api/queue", token=phone["phoneToken"])[0],401)
        entry = dict(id=str(uuid4()),title="Museum film",kind="film",minutes=88,service="Netflix")
        for patch in ({"kind":"short"}, {"service":"Unknown"}, {"minutes":True}, {"title":"  "}, {"minutes":1000}):
            self.assertEqual(self.api("POST", "/api/items", dict(entry,**patch), phone["phoneToken"])[0],400)
        self.assertEqual(self.api("POST", "/api/items", entry, phone["phoneToken"])[0],201)
        self.assertEqual(self.api("GET", "/api/queue", token=other["tvToken"])[1], {"items":[]})
        self.assertEqual(self.api("POST", "/api/ack", {"ids":[entry["id"]]}, other["tvToken"])[0],200)
        self.assertEqual(len(self.api("GET", "/api/queue", token=original["tvToken"])[1]["items"]),1)
        self.assertEqual(self.api("POST", "/api/pair", {}, host="example.invalid")[0],403)

    def test_expiry_and_guess_limit(self):
        pair = self.pair()
        with self.server.store.transaction() as db:
            db.execute("UPDATE invites SET expires=?", (int(time.time()) - 1,))
        self.assertEqual(self.api("POST", "/api/join", {"code":pair["phoneCode"]})[0],401)
        for _ in range(15):
            self.assertEqual(self.api("POST", "/api/join", {"code":"wrong"})[0],401)
        self.assertEqual(self.api("POST", "/api/join", {"code":"wrong"})[0],429)


if __name__ == "__main__":
    unittest.main()
