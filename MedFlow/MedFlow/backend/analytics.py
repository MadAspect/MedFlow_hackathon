"""Analytics: live overview, chart series, KPIs, end-of-day report, inventory forecast,
strategy comparison.  Everything is computed from engine state/history - nothing is hardcoded."""
from __future__ import annotations
import math, statistics
from .engine import Engine, clock
from .config import urgency_category, STRATEGIES
from .models import ACTIVE


def _started(e):
    return [p for p in e.h.patients.values() if p.first_start_time is not None and p.first_start_time <= e.now]


def _stats(vals):
    if not vals:
        return dict(n=0, avg=0.0, median=0.0, max=0.0, p90=0.0)
    s = sorted(vals)
    return dict(n=len(s), avg=round(sum(s) / len(s), 1), median=round(statistics.median(s), 1), max=round(s[-1], 1),
                p90=round(s[min(len(s) - 1, int(0.9 * len(s)))], 1))


def waits(e, pred=lambda p: True):
    """Time-to-treatment (arrival -> treatment start) for started patients + current wait of those still waiting."""
    out = [p.wait_at_first_start(e.now) for p in _started(e) if pred(p)]
    out += [p.wait_so_far(e.now) for p in e.h.waiting() if pred(p)]
    return out


def inventory_forecast(e):
    h, cfg = e.h, e.cfg
    out = []
    for c in h.consumables.values():
        rate = c.consumed / max(1, e.now)                          # units / minute observed
        raw = c.quantity - rate * cfg.forecast_horizon_min         # stock after the next forecast horizon without resupply
        proj = raw
        target = c.min_threshold * (1 + cfg.restock_buffer_pct)
        need = max(0.0, target - raw)
        room = max(0.0, c.max_capacity - c.quantity)
        hrs = ((c.quantity - c.min_threshold) / (rate * 60)) if rate > 0 else None
        level = "critical" if c.quantity <= 0 else "shortage" if proj < c.min_threshold else "ok"
        if c.quantity < c.min_threshold:
            level = "below_threshold"
        out.append(dict(item=c.item, unit=c.unit, current=round(c.quantity), consumed=round(c.consumed), allocated=round(c.allocated),
                        usage_per_hour=round(rate * 60, 1), projected=round(max(0.0, raw)), projected_raw=round(raw), safety_threshold=c.min_threshold, max_capacity=c.max_capacity,
                        hours_to_threshold=None if hrs is None else round(max(0, hrs), 1), level=level,
                        restock=int(math.ceil(min(need, room))) if level != "ok" else 0,
                        restock_note=("exceeds storage capacity - split across deliveries" if need > room else ""),
                        message=(f"Projected {round(proj)} after {cfg.forecast_horizon_min // 60} h vs safety threshold {c.min_threshold:.0f}" if level != "ok" else "")))
    return out


def episodes(e):
    """Bottleneck episodes from the sampled timeline."""
    eps, cur = [], None
    for s in e.history:
        k = s.get("bottleneck")
        if k and (cur is None or cur["key"] != k):
            if cur:
                eps.append(cur)
            cur = dict(key=k, start=s["t"], end=s["t"], peak=s["bottleneck_score"], peak_blocked=s["bottleneck_blocked"], cause=s["bottleneck_cause"])
        elif k and cur:
            cur["end"] = s["t"]
            cur["peak"] = max(cur["peak"], s["bottleneck_score"])
            if s["bottleneck_blocked"] >= cur["peak_blocked"]:
                cur["peak_blocked"], cur["cause"] = s["bottleneck_blocked"], s["bottleneck_cause"]
        elif not k and cur:
            eps.append(cur)
            cur = None
    if cur:
        eps.append(cur)
    for x in eps:
        x["duration"] = x["end"] - x["start"] + e.cfg.sample_interval
        x["start_clock"], x["end_clock"] = clock(x["start"]), clock(x["end"])
        acts = [a["title"] for a in e.actions if x["start"] <= a["t"] <= x["end"] + 10]
        x["intervention"] = acts[0] if acts else None
    return [x for x in eps if x["duration"] >= 10]


def workload(e):
    def row(s):
        av = max(1.0, s.available_minutes)
        return dict(id=s.id, name=s.name, role=s.role, zone=s.home_zone, assignments=s.assignments, treat_minutes=round(s.treat_minutes),
                    travel_minutes=round(s.travel_minutes), idle_minutes=round(s.idle_minutes), available_minutes=round(s.available_minutes),
                    utilization=round((s.available_minutes - s.idle_minutes) / av, 3))
    return dict(doctors=[row(s) for s in e.h.doctors.values()], nurses=[row(s) for s in e.h.nurses.values()])


def resource_utilization(e):
    h = e.h
    def u(pool):
        av = sum(s.available_minutes for s in pool)
        return round((av - sum(s.idle_minutes for s in pool)) / av, 3) if av else 0.0
    def bu(f):
        bs = [b for b in h.beds.values() if f(b)]
        av = sum(b.available_minutes for b in bs)
        return round(sum(b.busy_minutes for b in bs) / av, 3) if av else 0.0
    eq = list(h.equipment.values())
    return dict(doctor=u(list(h.doctors.values())), nurse=u(list(h.nurses.values())), bed=bu(lambda b: True), icu=bu(lambda b: b.type == "icu"),
                emergency=bu(lambda b: b.type == "emergency"), operating_room=bu(lambda b: b.type == "operating_room"),
                monitored=bu(lambda b: b.type == "monitored"), general=bu(lambda b: b.type == "general"),
                equipment=round(sum(x.busy_minutes for x in eq) / max(1, e.now * len(eq)), 3))


def kpis(e):
    ps = list(e.h.patients.values())
    allw = waits(e)
    crit = waits(e, lambda p: p.urgency >= 8)
    high = waits(e, lambda p: p.urgency >= 6)
    served_crit = [p for p in _started(e) if p.urgency >= 8]
    within = sum(1 for p in served_crit if p.wait_at_first_start(e.now) <= e.cfg.target_wait["CRITICAL"] * 3)
    J = e.cfg.J
    wsum = sum(allw)
    cw = 0.0
    for p in ps:
        cat = urgency_category(p.urgency)
        if cat in e.cfg.critical_multiplier and (p.first_start_time is not None or p.status == "waiting"):
            w = p.wait_at_first_start(e.now) if p.first_start_time is not None else p.wait_so_far(e.now)
            cw += e.cfg.critical_multiplier[cat] * (w / e.cfg.target_wait[cat]) ** 2
    travel = sum(s.travel_minutes for s in e.h.all_staff())
    idle = sum(s.idle_minutes for s in e.h.all_staff())
    unserved = sum(1 for p in ps if p.status == "waiting")
    interr = sum(p.interruptions for p in ps)
    realized = J["alpha"] * wsum + J["beta"] * cw + J["gamma"] * idle + J["delta"] * travel + J["epsilon"] * unserved + J["zeta"] * interr
    util = resource_utilization(e)
    return dict(total=len(ps), completed=sum(1 for p in ps if p.status == "completed"), waiting=unserved,
                in_treatment=sum(1 for p in ps if p.status in ACTIVE), transferred=e.n_transfers,
                wait=_stats(allw), critical_wait=_stats(crit), high_wait=_stats(high),
                critical_within_3x_target=f"{within}/{len(served_crit)}", utilization=util,
                travel_minutes=round(travel), idle_staff_minutes=round(idle), deteriorations=sum(p.deteriorations for p in ps),
                interruptions=interr, emergency_minutes=e.mode_minutes["EMERGENCY"], reoptimizations=len(e.reopts),
                actions=len(e.actions), realized_J=round(realized), realized_J_terms=dict(wait=round(wsum), critical=round(J["beta"] * cw),
                idle=round(J["gamma"] * idle), travel=round(J["delta"] * travel), unserved=round(J["epsilon"] * unserved), reassign=round(J["zeta"] * interr)))


def overview(e):
    h = e.h
    ps = list(h.patients.values())
    waiting = h.waiting()
    crit_w = [p for p in waiting if p.urgency >= 8]
    started = _started(e)
    util = e.utilization()
    a = e.analysis or {}
    alerts = []
    if e.emergency.state == "EMERGENCY":
        alerts.append(dict(level="critical", text=f"EMERGENCY MODE: {e.emergency.trigger}"))
    elif e.emergency.state == "WARNING":
        alerts.append(dict(level="warning", text=f"WARNING: {e.emergency.trigger}"))
    if e.plan:
        for c in e.plan.conflicts[:4]:
            alerts.append(dict(level=c["severity"], text=c["text"]))
    for p in h.active():
        if p.overrun_flagged:
            alerts.append(dict(level="warning", text=f"{p.id} overrunning: expected {round(p.predicted_duration)} min, still in treatment"))
    for it in inventory_forecast(e):
        if it["level"] in ("critical", "below_threshold"):
            alerts.append(dict(level="warning", text=f"Inventory: {it['item']} at {it['current']} (threshold {it['safety_threshold']:.0f})"))
    bc = h.bed_counts()
    on = lambda pool: sum(1 for s in pool.values() if s.status not in ('off_shift', 'unavailable'))
    staff = dict(doctors_active=on(h.doctors), doctors_total=len(h.doctors), nurses_active=on(h.nurses), nurses_total=len(h.nurses),
                 doctors_unavailable=sum(1 for s in h.doctors.values() if s.status == 'unavailable'), nurses_unavailable=sum(1 for s in h.nurses.values() if s.status == 'unavailable'))
    return dict(t=e.now, staff=staff, clock=clock(e.now), duration=e.duration, finished=e.finished, mode=e.emergency.state,
                patients_total=len(ps), waiting=len(waiting), critical_waiting=len(crit_w),
                critical_total=sum(1 for p in ps if p.urgency >= 8), in_treatment=len(h.active()),
                completed=sum(1 for p in ps if p.status == "completed"), transferred=sum(1 for p in ps if p.status == "transferred"),
                avg_wait=round(sum(p.wait_at_first_start(e.now) for p in started) / len(started), 1) if started else 0.0,
                avg_wait_waiting_now=round(sum(p.wait_so_far(e.now) for p in waiting) / len(waiting), 1) if waiting else 0.0,
                critical_wait_max=round(max([p.wait_so_far(e.now) for p in crit_w], default=0), 1),
                utilization=util, beds=bc, bottleneck=a.get("primary"), secondary_bottleneck=a.get("secondary"),
                strategy=e.strategy["label"], alerts=alerts[:8], scenario=e.sc["label"])


def charts(e):
    hist = e.history
    ts = [s["t"] for s in hist]
    binsz = 30
    arr = [0] * (max(1, e.duration // binsz))
    for t in e.arrival_times:
        arr[min(len(arr) - 1, t // binsz)] += 1
    bydept = {}
    for p in _started(e):
        bydept.setdefault(p.department, []).append(p.wait_at_first_start(e.now))
    for p in e.h.waiting():
        bydept.setdefault(p.department, []).append(p.wait_so_far(e.now))
    w = workload(e)
    stock = {k: [s["stock"].get(k, 0) for s in hist] for k in e.h.consumables}
    return dict(
        t=ts, clock=[s["clock"] for s in hist],
        arrivals_bins=dict(labels=[clock(i * binsz) for i in range(len(arr))], values=arr),
        queue=dict(queue=[s["queue"] for s in hist], critical=[s["critical_queue"] for s in hist]),
        avg_wait=dict(cumulative=[s["avg_wait"] for s in hist], queue_now=[s["queue_wait"] for s in hist]),
        wait_by_dept={d: dict(avg=_stats(v)["avg"], max=_stats(v)["max"], n=len(v)) for d, v in bydept.items()},
        utilization={k: [s["util"][k] for s in hist] for k in ("doctor", "nurse", "bed", "icu", "emergency")},
        doctor_workload=[dict(name=r["name"], treat=r["treat_minutes"], travel=r["travel_minutes"], idle=r["idle_minutes"], assignments=r["assignments"]) for r in w["doctors"]],
        nurse_workload=[dict(name=r["name"], treat=r["treat_minutes"], travel=r["travel_minutes"], idle=r["idle_minutes"], assignments=r["assignments"]) for r in w["nurses"]],
        expected_vs_actual=[dict(id=r["id"], expected=r["expected"], actual=r["actual"], department=r["department"]) for r in e.completed_records],
        bed_occupancy={t: [s["beds"].get(t, {}).get("occupied", 0) for s in hist] for t in ("emergency", "icu", "monitored", "general", "operating_room")},
        bottleneck=[dict(t=s["t"], key=s["bottleneck"], score=s["bottleneck_score"]) for s in hist],
        mode=[s["mode"] for s in hist], stock=stock,
        stock_thresholds={k: c.min_threshold for k, c in e.h.consumables.items()},
        forecast=e.pred.demand.forecast(e.arrival_times, e.now, e.cfg.baseline_rate_per_hour),
        predictor=e.pred.accuracy())


def report(e, comparison=None):
    ps = list(e.h.patients.values())
    bydept = {}
    for p in ps:
        bydept.setdefault(p.department, []).append(p)
    dept = {}
    for d, lst in bydept.items():
        ws = [p.wait_at_first_start(e.now) if p.first_start_time is not None else p.wait_so_far(e.now) for p in lst]
        dept[d] = dict(patients=len(lst), completed=sum(1 for p in lst if p.status == "completed"), **_stats(ws))
    k = kpis(e)
    er = [r for r in e.completed_records]
    errs = [r["actual"] - r["expected"] for r in er]
    ov = [r for r in er if r["actual"] > r["expected"] * 1.25]
    inv = inventory_forecast(e)
    return dict(
        clock=clock(e.now), t=e.now, scenario=e.sc["label"], strategy=e.strategy["label"], seed=e.seed, finished=e.finished, kpis=k,
        patient_flow=dict(total=k["total"], completed=k["completed"], transferred=k["transferred"], waiting_at_end=k["waiting"], in_treatment=k["in_treatment"],
                          wait=k["wait"], critical_wait=k["critical_wait"], by_department=dept),
        utilization=k["utilization"], workload=workload(e), bottlenecks=episodes(e),
        emergency=dict(minutes=e.mode_minutes, transitions=e.emergency.history, actions=e.actions),
        inventory=dict(items=inv, below_threshold=[i["item"] for i in inv if i["level"] in ("critical", "below_threshold")],
                       projected_shortages=[i["item"] for i in inv if i["level"] == "shortage"],
                       restock=[dict(item=i["item"], quantity=i["restock"], unit=i["unit"], note=i["restock_note"]) for i in inv if i["restock"] > 0]),
        duration_uncertainty=dict(n=len(er), mean_error=round(sum(errs) / len(errs), 1) if errs else 0,
                                  overruns_over_25pct=len(ov), predictor=e.pred.accuracy()),
        optimization=dict(reoptimizations=len(e.reopts), triggers=_trigger_counts(e), recent=e.reopts[-8:]),
        disruptions=[x for x in e.events if x["type"] in ("resource", "surge", "overrun", "mode", "action", "transfer")][-40:],
        recommendations=_report_recos(e), comparison=comparison)


def _trigger_counts(e):
    c = {}
    for r in e.reopts:
        for part in r["reason"].split("; "):
            key = part.split(":")[0].split(" of ")[0]
            c[key] = c.get(key, 0) + 1
    return dict(sorted(c.items(), key=lambda kv: -kv[1])[:10])


def _report_recos(e):
    out = []
    for x in episodes(e)[:3]:
        out.append(f"{x['key']} was the bottleneck from {x['start_clock']} for {x['duration']} min (peak score {x['peak']}): {x['cause']}")
    for a in e.actions[-3:]:
        out.append(f"Applied at {a['clock']}: {a['title']} (predicted avg wait {a['predicted_impact']['avg_wait_before']} -> {a['predicted_impact']['avg_wait_after']} min)")
    for i in inventory_forecast(e):
        if i["restock"] > 0:
            out.append(f"Restock {i['item']}: about {i['restock']} {i['unit']} (projected {i['projected']} vs safety threshold {i['safety_threshold']:.0f})")
    return out


_cache = {}


def compare(scenario="demo_day", seed=None, strategies=("urgency_only", "urgency_wait", "optimized_static", "full")):
    """Run the same scenario (same arrivals, same hidden durations) under each strategy and report measured KPIs."""
    key = (scenario if isinstance(scenario, str) else id(scenario), seed, tuple(strategies))
    if key in _cache:
        return _cache[key]
    rows = []
    for s in strategies:
        e = Engine(scenario, s, seed=seed, recommendations=True).run_to_end()
        k = kpis(e)
        rows.append(dict(strategy=s, label=STRATEGIES[s]["label"], seed=e.seed, avg_wait=k["wait"]["avg"], median_wait=k["wait"]["median"], max_wait=k["wait"]["max"],
                         critical_avg_wait=k["critical_wait"]["avg"], critical_max_wait=k["critical_wait"]["max"], high_avg_wait=k["high_wait"]["avg"],
                         completed=k["completed"], waiting_at_end=k["waiting"], doctor_util=k["utilization"]["doctor"], nurse_util=k["utilization"]["nurse"],
                         bed_util=k["utilization"]["bed"], travel_minutes=k["travel_minutes"], interruptions=k["interruptions"],
                         deteriorations=k["deteriorations"], emergency_minutes=k["emergency_minutes"], realized_J=k["realized_J"]))
    out = dict(scenario=scenario if isinstance(scenario, str) else "custom", seed=rows[0]["seed"], rows=rows,
               note=("Measured on one simulated day with identical arrivals and identical hidden treatment durations for every strategy. "
                     "Results are scenario- and seed-dependent; no strategy is claimed to be universally optimal. 'Full optimization' also "
                     "includes emergency adaptation and staff redeployment, so compare it with 'Full optimizer, no emergency adaptation' to "
                     "separate the effect of the planner from the effect of adaptation."))
    _cache[key] = out
    return out
