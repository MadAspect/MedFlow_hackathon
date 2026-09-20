"""MedFlow HTTP server (stdlib only).  `python app.py`  ->  http://localhost:8000

Serves the single-page frontend and a JSON API over one shared hospital simulation
(so a Head Nurse tab, a Nurse tab and a Doctor tab all see the same live state)."""
import json, mimetypes, os, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from backend.scenario import parse_scenario            # legacy MVP
from backend.simulation import run_simulation          # legacy MVP
from backend.optimizer import optimize_resources       # legacy MVP
from backend.engine import Engine, clock
from backend.config import Config, STRATEGIES, PARAM_DOCS
from backend.scenarios import SCENARIOS
from backend.db import Store
from backend.hospital import DEPT_ZONE, ZONES
from backend.allocation import rank_doctors
from backend import analytics, views, expert, data_ingest

ROOT = Path(__file__).parent
FRONT = ROOT / "frontend"


class Session:
    """One shared live simulation + background ticker."""

    def __init__(self, db_path="medflow.db"):
        self.lock = threading.RLock()
        self.store = Store(db_path)
        self.running, self.speed, self._acc, self._last_flush = False, 5, 0.0, 0.0
        self.engine = None
        self.reset("demo_day", "full")
        threading.Thread(target=self._loop, daemon=True).start()

    def reset(self, scenario="demo_day", strategy="full", seed=None, adaptive=False):
        with self.lock:
            if self.engine is not None:
                self.store.flush(self.engine)
            self.engine = Engine(scenario, strategy, seed=seed, adaptive_predictor=adaptive)
            self.store.start_run(self.engine)
            self.running, self._acc = False, 0.0
            self.store.flush(self.engine)

    def _loop(self):
        while True:
            time.sleep(0.25)
            with self.lock:
                e = self.engine
                if not self.running or e.finished:
                    continue
                self._acc += self.speed * 0.25
                n = int(self._acc)
                self._acc -= n
                if n:
                    e.step(n)
                if e.finished:
                    self.running = False
                    self.store.flush(e, analytics.kpis(e))
                elif time.time() - self._last_flush > 4:
                    self.store.flush(e)
                    self._last_flush = time.time()

    def status(self):
        e = self.engine
        return dict(running=self.running, speed=self.speed, finished=e.finished, t=e.now, clock=clock(e.now), duration=e.duration,
                    scenario=e.scenario_key, strategy=e.strategy_key, seed=e.seed, run_id=getattr(e, "run_id", None))


S = None


def J(o, status=200):
    return status, json.dumps(o, default=str)


# ------------------------------------------------------------------ GET routes
def state():
    e = S.engine
    a = e.analysis or {}
    return dict(sim=S.status(), overview=analytics.overview(e), emergency=e.emergency.to_dict(e.now),
                bottlenecks=dict(primary=a.get("primary"), secondary=a.get("secondary"), classes=a.get("classes", []), peak_score=a.get("peak_score", 0)),
                recommendations=e.recos, conflicts=[c["text"] for c in (e.plan.conflicts if e.plan else [])],
                events=e.events[-40:][::-1], impacts=e.impacts[-4:][::-1], actions=e.actions[-4:][::-1], reopts=e.reopts[-6:][::-1],
                forecast=e.pred.demand.forecast(e.arrival_times, e.now, e.cfg.baseline_rate_per_hour),
                prediction_accuracy=e.pred.accuracy(), plan_J=e.plan.J if e.plan else {})


def resources():
    e = S.engine
    h = e.h
    on = lambda pool: [s for s in pool.values() if s.status not in ("off_shift", "unavailable")]
    eq = {}
    for u in h.equipment.values():
        k = eq.setdefault(u.kind, dict(kind=u.kind, total=0, available=0, in_use=0, unavailable=0, units=[]))
        k["total"] += 1
        k[{"available": "available", "in_use": "in_use", "unavailable": "unavailable"}[u.status]] += 1
        k["units"].append(u.to_dict())
    return dict(beds=h.bed_counts(), bed_list=[b.to_dict() for b in sorted(h.beds.values(), key=lambda b: b.id)],
                staff=dict(doctors=dict(active=len(on(h.doctors)), total=len(h.doctors), busy=sum(1 for s in h.doctors.values() if s.status in views.BUSY)),
                           nurses=dict(active=len(on(h.nurses)), total=len(h.nurses), busy=sum(1 for s in h.nurses.values() if s.status in views.BUSY))),
                equipment=list(eq.values()), consumables=[c.to_dict() for c in h.consumables.values()], forecast=analytics.inventory_forecast(e),
                utilization=e.utilization(), transactions=e.inventory_tx[-15:][::-1])


def config_payload():
    c = Config()
    return dict(config=c.to_dict(), docs=PARAM_DOCS, strategies={k: dict(v) for k, v in STRATEGIES.items()},
                scenarios={k: dict(label=v["label"], description=v["description"], duration=v["duration"], baseline=v["baseline"], seed=v["seed"]) for k, v in SCENARIOS.items()},
                zones=ZONES, dept_zone=DEPT_ZONE, provenance=data_ingest.provenance())


def roster():
    h = S.engine.h
    return dict(doctors=[dict(id=d.id, name=d.name, specialty=d.specialty, zone=d.home_zone, shift=d.shift_label) for d in h.doctors.values()],
                nurses=[dict(id=n.id, name=n.name, skills=n.skills, zone=n.home_zone, shift=n.shift_label) for n in h.nurses.values()])


GET = [
    (r"^/api/state$", lambda m, q: state()),
    (r"^/api/roster$", lambda m, q: roster()),
    (r"^/api/patients$", lambda m, q: views.patients_view(S.engine, (q.get("status") or [None])[0])),
    (r"^/api/patients/(\w+)$", lambda m, q: views.patient_row(S.engine, S.engine.h.patients[m[0]]) | dict(timeline=S.engine.h.patients[m[0]].timeline)),
    (r"^/api/doctors$", lambda m, q: views.staff_rows(S.engine, "doctor")),
    (r"^/api/nurses$", lambda m, q: views.staff_rows(S.engine, "nurse")),
    (r"^/api/beds$", lambda m, q: [b.to_dict() for b in S.engine.h.beds.values()]),
    (r"^/api/map$", lambda m, q: views.map_view(S.engine)),
    (r"^/api/resources$", lambda m, q: resources()),
    (r"^/api/assignments$", lambda m, q: views.assignments_view(S.engine)),
    (r"^/api/analytics$", lambda m, q: analytics.charts(S.engine)),
    (r"^/api/bottlenecks$", lambda m, q: dict(analysis=S.engine.analysis, recommendations=S.engine.recos)),
    (r"^/api/emergency$", lambda m, q: S.engine.emergency.to_dict(S.engine.now)),
    (r"^/api/plan$", lambda m, q: S.engine.plan.to_dict() if S.engine.plan else {}),
    (r"^/api/events$", lambda m, q: [x for x in S.engine.events if x["id"] > int((q.get("since") or [0])[0])][-200:]),
    (r"^/api/report$", lambda m, q: analytics.report(S.engine)),
    (r"^/api/config$", lambda m, q: config_payload()),
    (r"^/api/scenarios$", lambda m, q: config_payload()["scenarios"]),
    (r"^/api/nurse/(\w+)$", lambda m, q: views.staff_view(S.engine, m[0])),
    (r"^/api/doctor/(\w+)$", lambda m, q: views.staff_view(S.engine, m[0])),
    (r"^/api/runs$", lambda m, q: S.store.runs()),
    (r"^/api/data/sample$", lambda m, q: data_ingest.load_csv()[1]),
]


# ------------------------------------------------------------------ POST routes
def p_simulation(action, b):
    e = S.engine
    if action == "start" or action == "resume":
        if e.finished:
            return dict(error="simulation finished - reset to run again")
        S.running = True
    elif action == "pause":
        S.running = False
    elif action == "reset":
        S.reset(b.get("scenario", e.scenario_key), b.get("strategy", e.strategy_key), b.get("seed"), bool(b.get("adaptive")))
    elif action == "speed":
        S.speed = max(1, min(120, float(b.get("speed", 5))))
    elif action == "step":
        S.running = False
        e.step(int(b.get("minutes", 5)))
        S.store.flush(e)
    return S.status()


def p_patient(b):
    p = S.engine.add_patient(b)
    return views.patient_row(S.engine, p)


def p_diagnosis(b):
    e = S.engine
    ev = expert.evaluate(b.get("symptoms", []), b.get("vitals", {}), int(b.get("age", 40)), e.cfg)
    zone = DEPT_ZONE.get(ev["department"], "EMERGENCY")
    ev["recommended_doctors"] = rank_doctors(e.h, ev["required_specialty"], zone, e.now)[:5]
    ev["bed_availability"] = e.h.bed_counts().get(ev["bed_type"], {})
    return ev


def p_inject(b):
    return S.engine.inject(b, source="head_nurse")


def p_modify(b):
    b = dict(b)
    b.pop("verification", None)      # prototype: verification is displayed but auto-approved
    r = S.engine.apply_change(b, source="head_nurse (prototype verification bypassed)")
    S.store.flush(S.engine)
    return r


def p_apply(b):
    return S.engine.apply_recommendation(b.get("rank") or b.get("action"))


def p_compare(b):
    return analytics.compare(b.get("scenario", S.engine.scenario_key), b.get("seed"))


def p_optimize(b):
    e = S.engine
    rec = e.optimize("manual re-optimisation")
    e.refresh_recommendations(force=bool(b.get("recommendations", True)))
    return dict(reoptimization=rec, recommendations=e.recos)


def p_legacy(b):
    scenario = parse_scenario(b.get("scenario", ""))
    result = run_simulation(scenario["patients"], scenario["resources"])
    opt = optimize_resources(scenario["patients"], scenario["resources"], scenario.get("optimize", True))
    result["scenario"] = dict(name=scenario["name"], patient_count=len(scenario["patients"]), resources=scenario["resources"], parameters=scenario["parameters"])
    result["optimization"] = opt
    return result


POST = [
    (r"^/api/simulation/(start|pause|resume|reset|speed|step)$", lambda m, b: p_simulation(m[0], b)),
    (r"^/api/patients$", lambda m, b: p_patient(b)),
    (r"^/api/diagnosis/evaluate$", lambda m, b: p_diagnosis(b)),
    (r"^/api/events/inject$", lambda m, b: p_inject(b)),
    (r"^/api/resources/modify$", lambda m, b: p_modify(b)),
    (r"^/api/interventions/apply$", lambda m, b: p_apply(b)),
    (r"^/api/optimization/run$", lambda m, b: p_optimize(b)),
    (r"^/api/compare$", lambda m, b: p_compare(b)),
    (r"^/api/simulate$", lambda m, b: p_legacy(b)),
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, data, ctype="application/json"):
        body = data if isinstance(data, bytes) else data.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        if rel in ("legacy", "legacy/"):
            rel = "legacy/index.html"
        f = (FRONT / rel).resolve()
        if FRONT.resolve() not in f.parents or not f.is_file():
            return self._send(404, json.dumps({"error": "Not found"}))
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        self._send(200, f.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text") or "javascript" in ctype else ""))

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return self._static(u.path)
        q = parse_qs(u.query)
        for rx, fn in GET:
            m = re.match(rx, u.path)
            if m:
                try:
                    with S.lock:
                        return self._send(*J(fn(m.groups(), q)))
                except KeyError as ex:
                    return self._send(*J({"error": f"not found: {ex}"}, 404))
                except Exception as ex:
                    return self._send(*J({"error": str(ex)}, 400))
        self._send(*J({"error": "Not found"}, 404))

    def do_POST(self):
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(*J({"error": "invalid JSON"}, 400))
        for rx, fn in POST:
            m = re.match(rx, u.path)
            if m:
                try:
                    if u.path == "/api/compare":            # long-running: do not hold the live-sim lock
                        return self._send(*J(fn(m.groups(), body)))
                    with S.lock:
                        return self._send(*J(fn(m.groups(), body)))
                except Exception as ex:
                    return self._send(*J({"error": f"{type(ex).__name__}: {ex}"}, 400))
        self._send(*J({"error": "Not found"}, 404))


def main(port=8000, db="medflow.db"):
    global S
    S = Session(db)
    print(f"MedFlow running at http://localhost:{port}   (legacy MVP: /legacy/)")
    ThreadingHTTPServer(("localhost", port), Handler).serve_forever()


if __name__ == "__main__":
    import sys
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
