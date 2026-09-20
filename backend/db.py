"""SQLite persistence (system of record for runs, audit trail and metrics).

Live state is held in memory by the engine and flushed here after every API step batch; the schema is
plain relational so it can migrate to PostgreSQL.  Restoring a half-finished run from the DB is not implemented."""
from __future__ import annotations
import json, sqlite3, threading, time
from .hospital import DEPT_ZONE

SCHEMA = """
CREATE TABLE IF NOT EXISTS departments(name TEXT PRIMARY KEY, zone TEXT);
CREATE TABLE IF NOT EXISTS simulation_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, scenario TEXT, strategy TEXT, seed INTEGER, created REAL, sim_time INTEGER, status TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS patients(run_id INT, id TEXT, name TEXT, status TEXT, urgency INT, department TEXT, arrival INT, first_start INT, completed INT, data TEXT, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS doctors(run_id INT, id TEXT, name TEXT, specialty TEXT, status TEXT, data TEXT, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS nurses(run_id INT, id TEXT, name TEXT, status TEXT, data TEXT, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS beds(run_id INT, id TEXT, zone TEXT, type TEXT, status TEXT, patient_id TEXT, data TEXT, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS resources(run_id INT, kind TEXT, id TEXT, quantity REAL, data TEXT, PRIMARY KEY(run_id,kind,id));
CREATE TABLE IF NOT EXISTS assignments(run_id INT, seq INT, t INT, patient_id TEXT, data TEXT, PRIMARY KEY(run_id,seq));
CREATE TABLE IF NOT EXISTS events(run_id INT, seq INT, t INT, type TEXT, severity TEXT, message TEXT, data TEXT, PRIMARY KEY(run_id,seq));
CREATE TABLE IF NOT EXISTS schedules(run_id INT, seq INT, t INT, reason TEXT, data TEXT, PRIMARY KEY(run_id,seq));
CREATE TABLE IF NOT EXISTS metrics(run_id INT, t INT, data TEXT, PRIMARY KEY(run_id,t));
CREATE TABLE IF NOT EXISTS inventory_transactions(run_id INT, seq INT, t INT, item TEXT, delta REAL, reason TEXT, PRIMARY KEY(run_id,seq));
"""


class Store:
    def __init__(self, path="medflow.db"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(SCHEMA)
            self.db.executemany("INSERT OR REPLACE INTO departments VALUES(?,?)", list(DEPT_ZONE.items()))
            self.db.commit()

    def start_run(self, e):
        with self.lock:
            cur = self.db.execute("INSERT INTO simulation_runs(scenario,strategy,seed,created,sim_time,status,summary) VALUES(?,?,?,?,?,?,?)",
                                  (e.scenario_key, e.strategy_key, e.seed, time.time(), 0, "running", "{}"))
            self.db.commit()
        e.run_id = cur.lastrowid
        e._cur = dict(events=0, assign=0, reopt=0, hist=0, tx=0)
        return e.run_id

    def flush(self, e, summary=None):
        rid, c = getattr(e, "run_id", None), getattr(e, "_cur", None)
        if rid is None:
            return
        J = lambda o: json.dumps(o, default=str)
        with self.lock:
            d = self.db
            d.executemany("INSERT OR REPLACE INTO patients VALUES(?,?,?,?,?,?,?,?,?,?)",
                          [(rid, p.id, p.name, p.status, p.urgency, p.department, p.arrival_time, p.first_start_time, p.completed_time, J(p.to_dict())) for p in e.h.patients.values()])
            d.executemany("INSERT OR REPLACE INTO doctors VALUES(?,?,?,?,?,?)", [(rid, s.id, s.name, s.specialty, s.status, J(s.to_dict())) for s in e.h.doctors.values()])
            d.executemany("INSERT OR REPLACE INTO nurses VALUES(?,?,?,?,?)", [(rid, s.id, s.name, s.status, J(s.to_dict())) for s in e.h.nurses.values()])
            d.execute("DELETE FROM beds WHERE run_id=?", (rid,))
            d.executemany("INSERT OR REPLACE INTO beds VALUES(?,?,?,?,?,?,?)", [(rid, b.id, b.zone, b.type, b.status, b.patient_id, J(b.to_dict())) for b in e.h.beds.values()])
            d.execute("DELETE FROM resources WHERE run_id=?", (rid,))
            d.executemany("INSERT OR REPLACE INTO resources VALUES(?,?,?,?,?)",
                          [(rid, "equipment", u.id, 1, J(u.to_dict())) for u in e.h.equipment.values()] +
                          [(rid, "consumable", k.item, k.quantity, J(k.to_dict())) for k in e.h.consumables.values()])
            d.executemany("INSERT OR REPLACE INTO events VALUES(?,?,?,?,?,?,?)",
                          [(rid, ev["id"], ev["t"], ev["type"], ev["severity"], ev["message"], J(ev["data"])) for ev in e.events[c["events"]:]])
            c["events"] = len(e.events)
            new = e.assignments_log[c["assign"]:]
            d.executemany("INSERT OR REPLACE INTO assignments VALUES(?,?,?,?,?)", [(rid, c["assign"] + i + 1, a["t"], a["patient_id"], J(a)) for i, a in enumerate(new)])
            c["assign"] = len(e.assignments_log)
            d.executemany("INSERT OR REPLACE INTO schedules VALUES(?,?,?,?,?)", [(rid, r["seq"], r["t"], r["reason"], J(r)) for r in e.reopts if r["seq"] > c["reopt"]])
            c["reopt"] = e.n_reopts
            d.executemany("INSERT OR REPLACE INTO metrics VALUES(?,?,?)", [(rid, s["t"], J(s)) for s in e.history[c["hist"]:]])
            c["hist"] = len(e.history)
            d.executemany("INSERT OR REPLACE INTO inventory_transactions VALUES(?,?,?,?,?,?)",
                          [(rid, c["tx"] + i + 1, x["t"], x["item"], x["delta"], x["reason"]) for i, x in enumerate(e.inventory_tx[c["tx"]:])])
            c["tx"] = len(e.inventory_tx)
            d.execute("UPDATE simulation_runs SET sim_time=?, status=?, summary=? WHERE id=?",
                      (e.now, "finished" if e.finished else "running", J(summary or {}), rid))
            d.commit()

    def runs(self, limit=20):
        with self.lock:
            rows = self.db.execute("SELECT id,scenario,strategy,seed,created,sim_time,status,summary FROM simulation_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(id=r[0], scenario=r[1], strategy=r[2], seed=r[3], created=r[4], sim_time=r[5], status=r[6], summary=json.loads(r[7] or "{}")) for r in rows]

    def counts(self, rid):
        with self.lock:
            return {t: self.db.execute(f"SELECT COUNT(*) FROM {t} WHERE run_id=?", (rid,)).fetchone()[0]
                    for t in ("patients", "doctors", "nurses", "beds", "resources", "assignments", "events", "schedules", "metrics", "inventory_transactions")}
