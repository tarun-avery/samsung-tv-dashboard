from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from episode_guide import EpisodeGuide, LONDON
from store import Problem

NOW = datetime(2026, 11, 21, 12, tzinfo=LONDON)
SHOW = {"id": 99, "name":"Fixture", "webChannel":{"name":"Netflix","country":None},
        "externals":{"imdb":"tt1234567"}, "url":"https://www.tvmaze.com/shows/99"}
EPISODE = {"season":2,"number":1,"name":"New chapter","airdate":"2026-11-20"}
def make_fetch(alts=(), offers=(), matches=None):
    def fetch(url, key=None):
        if "search/shows" in url:
            return [{"show":s} for s in (matches if matches is not None else [SHOW])]
        if "watchmode.com" in url:
            return [{"season_number":2,"episode_number":1,"sources":list(offers)}]
        if url.endswith("/alternatelists"):
            return list(alts)
        if "/alternateepisodes" in url:
            return [dict(EPISODE,airdate="2026-11-21")]
        if url.endswith("/episodes"):
            return [EPISODE,dict(EPISODE,number=2,airdate="2026-11-27"),
                    dict(EPISODE,number=3,airdate="2026-11-21",airstamp="2026-11-21T21:00:00+00:00"),
                    dict(EPISODE,season=1,airdate="2025-11-21")]
        return SHOW
    return fetch

class EpisodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.guide = EpisodeGuide(Path(self.tmp.name),make_fetch())

    def resolve(self, api_key=""):
        return self.guide.resolve("Fixture","Netflix",None,NOW,api_key)

    def test_global_premiere_is_not_uk_rights_and_future_has_clock(self):
        rows = self.resolve()["episodes"]
        self.assertEqual(len(rows),3)
        self.assertTrue(all(r["evidence"]=="airdate" for r in rows))
        self.assertEqual({r["episode"] for r in rows if r["upcoming"]},{2,3})

    def test_only_uk_subscription_on_the_selected_service_verifies(self):
        for region,kind,name,expected in [("GB","sub","Netflix","uk-catalogue"),
                                         ("US","sub","Netflix","airdate"),("GB","rent","Netflix","airdate"),
                                         ("GB","sub","Netflix Channel via Another Service","airdate"),
                                         ("GB","sub","Disney+","airdate")]:
            with self.subTest(region=region,kind=kind,name=name):
                self.guide.fetch = make_fetch(offers=[dict(region=region,type=kind,name=name)])
                row = next(r for r in self.resolve("local-test")["episodes"] if r["episode"]==1)
                self.assertEqual(row["evidence"],expected)

    def test_regional_streaming_premiere_overrides_original_date(self):
        alt = {"id":501,"webChannel":{"name":"Netflix","country":{"code":"GB"}}}
        self.guide.fetch = make_fetch(alts=[alt])
        row = next(r for r in self.resolve()["episodes"] if r["episode"]==1)
        self.assertEqual((row["date"],row["evidence"]),("2026-11-21","uk-release"))

    def test_ambiguous_name_requires_a_choice(self):
        self.guide.fetch=make_fetch(matches=[SHOW,dict(SHOW,id=100,premiered="2001-12-02")])
        self.assertEqual([m["id"] for m in self.resolve()["matches"]],[99,100])

    def test_unsupported_provider_and_cached_outage(self):
        with self.assertRaises(Problem): self.guide.lookup({"title":"Fixture","service":"YouTube"})
        query = {"title":"Fixture","service":"Netflix"}
        self.guide.lookup(query)
        import sqlite3
        with sqlite3.connect(self.guide.db) as db:
            db.execute("UPDATE lookups SET checked=checked-86400")
        def fail(*args): raise OSError("offline")
        self.guide.fetch=fail
        self.assertTrue(self.guide.lookup(query)["stale"])

if __name__ == "__main__":
    unittest.main()
