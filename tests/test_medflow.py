import json, threading, unittest, urllib.request
from backend.engine import Engine
from backend.config import Config, STRATEGIES
from backend import expert, priority, analytics, views
from backend.allocation import Planner
from backend.emergency import EmergencyController
from backend.db import Store
from backend import scenarios as scn

EMPTY = dict(label="test", seed=1, duration=400, baseline=6, profile=[], events=[])
CARD = dict(symptoms=["chest pain", "shortness of breath", "high heart rate"], vitals={"heart_rate": 128, "spo2": 92}, age=58)   # ICU-level
FRACT = dict(symptoms=["fracture"], age=30)
COLD = dict(symptoms=["fever", "cough"], age=30)
STROKE = dict(symptoms=["slurred speech", "facial droop", "sudden weakness"], age=66)
TRAUMA = dict(symptoms=["major trauma"], vitals={"heart_rate": 100}, age=30)


def mk(strategy="full", **kw):
    return Engine(dict(EMPTY, **kw), strategy, debug=True)


def ok(e):
    errs = e.h.check_invariants()
    assert not errs, errs


class TestPriority(unittest.TestCase):
    def setUp(self):
        self.e = mk()
        self.cfg, self.risk = self.e.cfg, self.e.pred.risk

    def test_urgency_orders_priority(self):
        a, b = scn.make_patient(1, 0, 1, self.cfg, template=scn.T[14]), scn.make_patient(2, 0, 1, self.cfg, template=scn.T[12])
        w = self.cfg.weights_normal
        ca, cb = priority.components(a, 0, self.cfg, self.risk), priority.components(b, 0, self.cfg, self.risk)
        self.assertGreater(priority.score(ca, w), priority.score(cb, w))

    def test_components_normalised(self):
        for t in scn.T:
            p = scn.make_patient(1, 0, 3, self.cfg, template=t)
            c = priority.components(p, 500, self.cfg, self.risk, 0.5)
            for k in "UWDRC":
                self.assertTrue(0 <= c[k] <= 1, (k, c))

    def test_waiting_time_escalation(self):
        p = scn.make_patient(1, 0, 1, self.cfg, template=scn.T[12])
        w = self.cfg.weights_normal
        s0 = priority.score(priority.components(p, 0, self.cfg, self.risk), w)
        s1 = priority.score(priority.components(p, 60, self.cfg, self.risk), w)
        self.assertGreater(s1, s0)

    def test_low_urgency_ages_up(self):
        low = scn.make_patient(1, 0, 1, self.cfg, template=scn.T[12])
        w = self.cfg.weights_normal
        self.assertGreater(priority.score(priority.components(low, 300, self.cfg, self.risk), w),
                           priority.score(priority.components(low, 0, self.cfg, self.risk), w) + 0.2)

    def test_expert_chest_pain(self):
        ev = expert.evaluate(CARD["symptoms"], CARD["vitals"], 58)
        self.assertIn(ev["risk_category"], ("HIGH", "CRITICAL"))
        self.assertIn("Cardiology", ev["suggested_department"])
        self.assertIn("Not a medical diagnosis", ev["disclaimer"])
        self.assertEqual(expert.evaluate(["minor cut"])["risk_category"], "LOW")


class TestAllocation(unittest.TestCase):
    def test_arrival_assignment_and_completion(self):
        e = mk()
        p = e.add_patient(COLD)
        self.assertIn(p.status, ("assigned", "in_treatment"))
        ok(e)
        e.step(120)
        self.assertEqual(p.status, "completed")
        self.assertIsNotNone(p.treatment_time_actual)
        ok(e)

    def test_icu_patient_never_in_ordinary_bed(self):
        e = mk("optimized_static")      # no auto-redeployment: isolates the hard constraint
        for b in list(e.h.beds.values()):
            if b.type == "icu":
                e.apply_change(dict(type="bed_unavailable", id=b.id, reason="test"))
        p = e.add_patient(CARD)
        e.step(30)
        self.assertEqual(p.status, "waiting")
        self.assertIsNone(p.current_bed)
        self.assertIn("No operational bed", p.conflict)
        self.assertTrue(any("bed" in c["text"].lower() for c in e.plan.conflicts))
        ok(e)

    def test_icu_capacity_message(self):
        e = mk("optimized_static")
        for b in [b for b in e.h.beds.values() if b.type == "icu"][:5]:
            e.apply_change(dict(type="bed_unavailable", id=b.id, reason="test"))
        for _ in range(3):
            e.add_patient(CARD)
        msgs = " ".join(c["text"] for c in e.plan.conflicts)
        self.assertIn("ICU capacity constrained", msgs)
        ok(e)

    def test_no_qualified_doctor_fails_safely(self):
        e = mk("optimized_static")
        for d in list(e.h.doctors.values()):
            if "critical_care" in d.skills:
                e.apply_change(dict(type="staff_unavailable", id=d.id, reason="test"))
        p = e.add_patient(CARD)
        e.step(5)
        self.assertEqual(p.status, "waiting")
        self.assertIn("No qualified doctor", p.conflict)
        ok(e)

    def test_no_qualified_nurse_fails_safely(self):
        e = mk("optimized_static")
        for n in list(e.h.nurses.values()):
            if "icu" in n.skills:
                e.apply_change(dict(type="staff_unavailable", id=n.id, reason="test"))
        p = e.add_patient(CARD)
        e.step(5)
        self.assertEqual(p.status, "waiting")
        self.assertIn("nurse", p.conflict)
        ok(e)

    def test_capacity_and_queue_when_resources_exhausted(self):
        e = mk()
        for _ in range(7):
            e.add_patient(FRACT)
        ok(e)
        busy = sum(1 for b in e.h.beds.values() if b.status in ("occupied", "reserved"))
        self.assertLessEqual(busy, len(e.h.beds))
        self.assertGreater(len(e.h.waiting()), 0)
        for _ in range(360):
            e.step(1)
        self.assertEqual(len(e.h.waiting()), 0)
        ok(e)

    def test_simultaneous_criticals_no_conflict(self):
        e = mk()
        for _ in range(6):
            e.add_patient(CARD)
        for _ in range(3):
            e.add_patient(STROKE)
        for _ in range(90):
            e.step(1)
            ok(e)
        self.assertGreaterEqual(sum(1 for p in e.h.patients.values() if p.status == "completed"), 2)

    def test_plan_has_no_double_booking(self):
        e = Engine("demo_day", "full")
        e.step(215)
        plan = Planner(e.h, e.cfg, e.strategy, e.pred, e.emergency.state).plan(e.now)
        use = {}
        for it in plan.items:
            for rid in [it.doctor_id, it.bed_id] + it.nurse_ids + it.equipment_ids:
                for (a, b) in use.get(rid, []):
                    self.assertFalse(a < it.end_time and it.dispatch_time < b, (rid, it))
                use.setdefault(rid, []).append((it.dispatch_time, it.end_time))

    def test_full_days_all_invariants(self):
        for sc in ("demo_day", "staff_shortage", "icu_failure", "surge_test"):
            e = Engine(sc, "full", debug=True)
            e.run_to_end()
            ok(e)

    def test_all_strategies_feasible(self):
        for s in STRATEGIES:
            Engine("surge_test", s, debug=True).run_to_end()


class TestDynamics(unittest.TestCase):
    def test_delayed_treatment_detected_and_reoptimised(self):
        e = mk()
        p = e.add_patient(COLD)
        e.step(1)
        n_before = len(e.reopts)
        exp_end = p.pred_end
        e.inject(dict(type="overrun", factor=3.0, patient_id=p.id))
        e.step(int(p.predicted_duration) + 2)
        self.assertTrue(p.overrun_flagged)
        self.assertGreater(p.pred_end, exp_end)
        self.assertTrue(any(x["type"] == "overrun" for x in e.events))
        self.assertGreater(len(e.reopts), n_before)
        ok(e)

    def test_overrun_pushes_downstream_plan(self):
        e = mk()
        a = e.add_patient(FRACT)
        b = e.add_patient(FRACT)              # only one orthopaedic doctor -> b waits for a
        self.assertEqual(b.status, "waiting")
        planned = b.planned_start
        e.inject(dict(type="overrun", factor=2.5, patient_id=a.id))
        e.step(int(a.predicted_duration) + 3)
        self.assertIsNotNone(b.planned_start)
        self.assertGreater(b.planned_start, planned)

    def test_early_completion_frees_resources(self):
        e = mk()
        p = e.add_patient(COLD)
        e.step(2)
        p.end_time = e.now + 1
        e.step(3)
        self.assertEqual(p.status, "completed")
        self.assertTrue(all(s.current_patient is None for s in e.h.all_staff()))
        ok(e)

    def test_duration_uncertainty_is_mean_preserving(self):
        cfg = Config()
        cfg.duration_bias = {}
        pts = [scn.make_patient(i, 0, 5, cfg, template=scn.T[10]) for i in range(1, 1500)]
        ratio = sum(p.actual_total / p.nominal_duration for p in pts) / len(pts)
        self.assertAlmostEqual(ratio, 1.0, delta=0.05)
        self.assertTrue(any(p.actual_total > 1.4 * p.nominal_duration for p in pts))

    def test_staff_unavailable_substitutes_or_requeues(self):
        e = mk()
        p = e.add_patient(TRAUMA)
        e.step(2)
        nid = p.assigned_nurses[0]
        imp = e.apply_change(dict(type="staff_unavailable", id=nid, reason="test"))
        self.assertEqual(e.h.nurses[nid].status, "unavailable")
        self.assertNotIn(nid, p.assigned_nurses)
        self.assertTrue(imp["affected"])
        self.assertTrue(imp["affected"][0]["explanation"])
        ok(e)
        e.step(5)
        ok(e)

    def test_staff_unavailable_no_replacement_interrupts(self):
        e = mk()
        p = e.add_patient(dict(symptoms=["severe bleeding", "major trauma"], vitals={"heart_rate": 125, "systolic_bp": 80}, age=30))
        e.step(2)
        self.assertEqual(p.bed_type_required, "operating_room")
        for n in [n for n in e.h.nurses.values() if "theatre" in n.skills and n.id not in p.assigned_nurses]:
            e.apply_change(dict(type="staff_unavailable", id=n.id, reason="test"))
        e.apply_change(dict(type="staff_unavailable", id=p.assigned_nurses[0], reason="test"))
        self.assertEqual(p.status, "waiting")
        self.assertEqual(p.interruptions, 1)
        ok(e)

    def test_bed_failure_relocates(self):
        e = mk()
        p = e.add_patient(TRAUMA)
        e.step(2)
        bed = p.current_bed
        e.apply_change(dict(type="bed_unavailable", id=bed, reason="fault"))
        self.assertEqual(e.h.beds[bed].status, "unavailable")
        self.assertNotEqual(p.current_bed, bed)
        ok(e)
        e.step(120)
        self.assertEqual(p.status, "completed")

    def test_equipment_failure(self):
        e = mk()
        p = e.add_patient(dict(symptoms=["shortness of breath", "low oxygen saturation", "cough"], vitals={"spo2": 85}, age=50))
        e.step(2)
        self.assertIn("ventilator", p.equipment_required)
        for u in list(e.h.equipment.values()):
            if u.kind == "ventilator":
                e.apply_change(dict(type="equipment_unavailable", id=u.id, reason="fault"))
        self.assertEqual(p.status, "waiting")
        self.assertIn("ventilator", p.conflict)
        ok(e)

    def test_rolling_reoptimisation_records_reasons(self):
        e = Engine("demo_day", "full")
        e.step(260)
        reasons = " ".join(r["reason"] for r in e.reopts)
        for k in ("arrival", "completion", "overrun"):
            self.assertIn(k, reasons)
        self.assertGreater(len(e.reopts), 100)

    def test_deterministic(self):
        a = Engine("demo_day", "full").run_to_end()
        b = Engine("demo_day", "full").run_to_end()
        self.assertEqual(analytics.kpis(a), analytics.kpis(b))


class TestEmergencyAndBottleneck(unittest.TestCase):
    def test_state_machine_transitions_and_hysteresis(self):
        cfg = Config()
        c = EmergencyController(cfg)
        calm = {k: 0 for k in cfg.emergency}
        calm["icu_slack"] = 5
        for t in range(5):
            self.assertIsNone(c.update(t, calm))
        hot = dict(calm, critical_queue=6)
        for t in range(5, 12):
            c.update(t, hot)
        self.assertEqual(c.state, "EMERGENCY")
        self.assertIn("Critical-patient queue", c.trigger)
        for t in range(12, 12 + cfg.em_recovery_min + 2):
            c.update(t, calm)
        self.assertEqual(c.state, "RECOVERY")
        for t in range(40, 40 + cfg.em_recovery_hold_min + 2):
            c.update(t, calm)
        self.assertEqual(c.state, "NORMAL")

    def test_surge_triggers_emergency_mode(self):
        e = Engine("surge_test", "full").run_to_end()
        self.assertTrue(any(h["to_state"] == "EMERGENCY" for h in e.emergency.history))

    def test_normal_day_stays_out_of_emergency(self):
        e = Engine("normal_day", "full").run_to_end()
        self.assertLess(e.mode_minutes["EMERGENCY"], 60)

    def test_resource_modification_triggers_warning_or_emergency(self):
        e = mk()
        for n in [n for n in e.h.nurses.values() if n.status == "available"][:7]:
            e.apply_change(dict(type="staff_unavailable", id=n.id, reason="mass sickness"))
        e.step(6)
        self.assertIn(e.mode(), ("WARNING", "EMERGENCY"))
        self.assertIn("Staff unavailable", e.emergency.trigger)

    def test_bottleneck_detected_with_attribution(self):
        e = mk()
        for _ in range(8):
            e.add_patient(FRACT)
        e.step(3)
        a = e.analysis
        self.assertIsNotNone(a["primary"])
        self.assertTrue(a["primary"]["blocked"])
        self.assertIn("orthopedics", a["primary"]["key"])
        self.assertTrue(a["primary"]["cause"])

    def test_recommendation_is_counterfactual(self):
        e = Engine("demo_day", "full")
        e.step(212)
        recs = e.refresh_recommendations(force=True)
        for r in recs:
            self.assertLessEqual(r["impact"]["avg_wait_after"], r["impact"]["avg_wait_before"] + 1e-6)
            self.assertTrue(r["why"])

    def test_emergency_auto_action_logged(self):
        e = Engine("demo_day", "full", debug=True).run_to_end()
        self.assertTrue(e.actions)
        self.assertTrue(e.actions[0]["why"] and e.actions[0]["trigger"])

    def test_adaptive_predictor_reduces_error(self):
        bias = {d: 1.4 for d in ("Emergency", "ICU", "Orthopedics", "General Medicine", "Cardiology", "Surgery", "Neurology")}
        res = {}
        for name, ad in (("rule", False), ("adaptive", True)):
            e = Engine("normal_day", "full", adaptive_predictor=ad, overrides=dict(duration_bias=bias)).run_to_end()
            res[name] = e.pred.accuracy()["mae"]
        self.assertLess(res["adaptive"], res["rule"])


class TestAnalytics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Engine("demo_day", "full").run_to_end()

    def test_report_sections(self):
        r = analytics.report(self.e)
        for k in ("patient_flow", "utilization", "workload", "bottlenecks", "inventory", "optimization", "emergency", "duration_uncertainty"):
            self.assertIn(k, r)
        pf = r["patient_flow"]
        self.assertEqual(pf["total"], pf["completed"] + pf["waiting_at_end"] + pf["in_treatment"] + pf["transferred"])
        self.assertTrue(r["bottlenecks"])

    def test_charts_from_simulation_data(self):
        c = analytics.charts(self.e)
        self.assertEqual(len(c["t"]), len(c["queue"]["queue"]))
        self.assertEqual(sum(c["arrivals_bins"]["values"]), len(self.e.arrival_times))
        self.assertTrue(c["expected_vs_actual"])

    def test_inventory_alert_and_restock(self):
        e = mk()
        e.apply_change(dict(type="adjust_consumable", item="iv_sets", set=90))
        inv = {i["item"]: i for i in analytics.inventory_forecast(e)}
        self.assertEqual(inv["iv_sets"]["level"], "below_threshold")
        self.assertGreater(inv["iv_sets"]["restock"], 0)
        self.assertEqual(inv["gloves"]["level"], "ok")

    def test_utilization_bounds(self):
        for v in analytics.resource_utilization(self.e).values():
            self.assertTrue(0 <= v <= 1.0001)

    def test_compare_strategies_measured(self):
        out = analytics.compare("normal_day", strategies=("urgency_only", "full"))
        self.assertEqual(len(out["rows"]), 2)
        self.assertIn("universally", out["note"])


class TestPlatform(unittest.TestCase):
    def test_persistence(self):
        s = Store(":memory:")
        e = Engine("demo_day", "full")
        s.start_run(e)
        e.step(120)
        s.flush(e)
        c = s.counts(e.run_id)
        self.assertEqual(c["patients"], len(e.h.patients))
        self.assertEqual(c["beds"], len(e.h.beds))
        self.assertGreater(c["events"], 10)

    def test_views(self):
        e = Engine("demo_day", "full")
        e.step(200)
        busy = [s for s in e.h.nurses.values() if s.current_patient][0]
        v = views.staff_view(e, busy.id)
        self.assertEqual(v["current"]["due"], "NOW")

    def test_ingest(self):
        from backend import data_ingest
        rows, rep = data_ingest.load_csv()
        self.assertGreater(rep["accepted"], 100)
        p = data_ingest.patient_from_row(rows[0], 1, 0, 1, Config())
        self.assertEqual(p.source, "dataset")

    def test_http_api_and_legacy(self):
        import app
        from http.server import ThreadingHTTPServer
        app.S = app.Session(":memory:")
        srv = ThreadingHTTPServer(("localhost", 0), app.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://localhost:{srv.server_address[1]}"
        get = lambda p: json.load(urllib.request.urlopen(base + p))
        post = lambda p, b: json.load(urllib.request.urlopen(urllib.request.Request(base + p, json.dumps(b).encode(), {"Content-Type": "application/json"})))
        self.assertIn("overview", get("/api/state"))
        post("/api/simulation/step", dict(minutes=30))
        self.assertGreater(get("/api/state")["sim"]["t"], 25)
        r = post("/api/resources/modify", dict(type="staff_unavailable", id="N01", reason="test"))
        self.assertIn("change", r)
        self.assertIn(post("/api/diagnosis/evaluate", CARD)["risk_category"], ("HIGH", "CRITICAL"))
        self.assertIn("optimization", post("/api/simulate", dict(scenario="8 urgent patients")))
        self.assertIn("kpis", get("/api/report"))
        self.assertIn("MedFlow", urllib.request.urlopen(base + "/legacy/").read().decode())
        srv.shutdown()


if __name__ == "__main__":
    unittest.main()
