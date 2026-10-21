"""Tests for growth-engine/citation_engine.py (stdlib unittest, no network)."""
import importlib.util, json, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("citation_engine", os.path.join(HERE, "..", "citation_engine.py"))
ce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ce)


def obs(**kw):
    o = {"ts": "2026-10-19T14:00:00Z", "engine": "claude_web_search", "query": "best slab leak detection in Dana Point, CA",
         "city": "Dana Point", "service": "slab-leak", "sf_status": "absent",
         "businesses_named": ["Evans Leak Detection"], "cited_urls": [], "note": ""}
    o.update(kw)
    return o


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._saved = (ce.DATA, ce.OBS, ce.ACTIONS, ce.REPORTS)
        ce.DATA = self.tmp
        ce.OBS = os.path.join(self.tmp, "citation_observations.jsonl")
        ce.ACTIONS = os.path.join(self.tmp, "citation_actions.json")
        ce.REPORTS = os.path.join(self.tmp, "reports")

    def tearDown(self):
        ce.DATA, ce.OBS, ce.ACTIONS, ce.REPORTS = self._saved


class TestValidate(Base):
    def test_good_row(self):
        self.assertEqual(ce.validate(obs()), [])

    def test_unknown_engine_and_status(self):
        errs = ce.validate(obs(engine="bing_organic", sf_status="ranked"))
        self.assertTrue(any("engine" in e for e in errs))
        self.assertTrue(any("sf_status" in e for e in errs))

    def test_absent_but_named_us_is_rejected(self):
        errs = ce.validate(obs(businesses_named=["Straight Flush Plumbing & Leak Detection"]))
        self.assertTrue(any("absent" in e for e in errs))


class TestClassify(Base):
    def test_classes(self):
        comps = {"evansleakdetection.com"}
        self.assertEqual(ce.classify("https://www.yelp.com/search?x", comps), "directory")
        self.assertEqual(ce.classify("https://www.expertise.com/ca/dana-point/plumbers", comps), "listicle")
        self.assertEqual(ce.classify("https://www.reddit.com/r/orangecounty/x", comps), "forum")
        self.assertEqual(ce.classify("https://evansleakdetection.com/slab", comps), "competitor")
        self.assertEqual(ce.classify("https://someplumbingco.com/", set()), "competitor")
        self.assertEqual(ce.classify("https://straightflushplumbingoc.com/x", comps), "ours")
        # 'bing.com' must not match inside 'benjaminfranklinplumbing.com'
        self.assertEqual(ce.classify("https://www.benjaminfranklinplumbing.com/mv", set()), "competitor")
        self.assertEqual(ce.classify("https://pro.porch.com/laguna-niguel-ca/plumbers/cp", set()), "directory")
        self.assertEqual(ce.classify("https://homeservice.ignitionlabs.com/near-me/x", set()), "lead_gen")


class TestPlan(Base):
    def test_untested_first_and_rotation(self):
        first = ce.plan(5)
        self.assertEqual(len(first), 5)
        self.assertTrue(all(q["tier"] == 1 for q in first))
        ce.append([obs(query=q["query"], ts="2026-10-19T14:00:00Z") for q in first])
        second = ce.plan(5)
        self.assertFalse({q["query"] for q in first} & {q["query"] for q in second})

    def test_inconclusive_does_not_count_as_tested(self):
        q = ce.plan(1)[0]
        ce.append([obs(query=q["query"], sf_status="inconclusive")])
        self.assertEqual(ce.plan(1)[0]["query"], q["query"])


class TestAnalyze(Base):
    def test_gap_actions_and_status_preserved(self):
        recent = ce.now().strftime("%Y-%m-%dT%H:%M:%SZ")
        ce.append([
            obs(ts=recent, cited_urls=["https://www.expertise.com/ca/dana-point/plumbers",
                                       "https://www.yelp.com/search?find_desc=slab+leak"]),
            obs(ts=recent, query="who does leak detection in San Clemente?", service="leak-detection",
                cited_urls=["https://www.expertise.com/ca/san-clemente/plumbers"]),
            obs(ts=recent, query="best plumber in Laguna Niguel, CA", sf_status="recommended",
                businesses_named=["Straight Flush Plumbing & Leak Detection"],
                cited_urls=["https://straightflushplumbingoc.com/cities/laguna-niguel",
                            "https://www.bbb.org/x"]),
            obs(ts=recent, query="x", sf_status="inconclusive", cited_urls=["https://ignored.com"]),
        ])
        path, actions = ce.analyze()
        domains = [a["domain"] for a in actions]
        self.assertEqual(domains[0], "expertise.com")          # cited twice in lost answers, listicle boost
        self.assertIn("yelp.com", domains)
        self.assertNotIn("bbb.org", domains)                    # only cited where we WON
        self.assertNotIn("ignored.com", domains)                # inconclusive excluded
        with open(path, encoding="utf-8") as fh:
            report = fh.read()
        self.assertIn("straightflushplumbingoc.com/cities/laguna-niguel", report)

        with open(ce.ACTIONS) as fh:
            data = json.load(fh)
        data["actions"][0]["status"] = "done"
        with open(ce.ACTIONS, "w") as fh:
            json.dump(data, fh)
        _, again = ce.analyze()
        self.assertEqual({a["domain"]: a["status"] for a in again}["expertise.com"], "done")


class TestImportCsv(Base):
    def test_manual_rows(self):
        p = os.path.join(self.tmp, "t.csv")
        with open(p, "w", encoding="utf-8") as f:
            f.write("Date,Engine,Prompt,Mentioned? (Y/N),Position (1=first),Competitors named,Sources it cited,Notes\n")
            f.write("2026-10-20,ChatGPT,best plumber in Dana Point,N,,Evans; Roto-Rooter,yelp.com expertise.com,\n")
            f.write("2026-10-20,Perplexity,best plumber in Laguna Niguel,Y,1,,,\n")
            f.write(",Gemini,not tested yet,,,,,\n")
        n, skipped = ce.import_csv(p)
        self.assertEqual((n, skipped), (2, 1))
        rows = ce.load_obs()
        self.assertEqual(rows[0]["engine"], "chatgpt")
        self.assertEqual(rows[0]["sf_status"], "absent")
        self.assertEqual(rows[1]["sf_status"], "recommended")


if __name__ == "__main__":
    unittest.main()
