def calculate_priority(patient, current_time):
    return (10 * patient["urgency"]) + (current_time - patient["arrival_time"])


def resources_available(patient, available):
    return all(
        available.get(resource, 0) >= amount
        for resource, amount in patient["required_resources"].items()
    )


def allocate_resources(patient, available):
    for resource, amount in patient["required_resources"].items():
        available[resource] = available.get(resource, 0) - amount


def release_resources(patient, available):
    for resource, amount in patient["required_resources"].items():
        available[resource] += amount


def run_simulation(patients, resources):
    patients = [dict(p, required_resources=dict(p["required_resources"])) for p in patients]
    initial = dict(resources)
    available = dict(resources)

    completed = []
    active = []
    waiting = []
    impossible = []

    for p in patients:
        p.setdefault("status", "waiting")
        for resource, amount in p["required_resources"].items():
            if amount > initial.get(resource, 0):
                p["status"] = "unable_to_treat"
                p["reason"] = f"Requires {amount} {resource}, capacity is {initial.get(resource, 0)}."
                impossible.append(p)
                break

    patients = sorted(
        [p for p in patients if p["status"] != "unable_to_treat"],
        key=lambda p: (p["arrival_time"], p["id"])
    )

    current_time = 0
    busy_time = {r: 0 for r in initial}
    last_time = 0

    while patients or waiting or active:
        next_arrival = patients[0]["arrival_time"] if patients else None
        next_completion = min((p["end_time"] for p in active), default=None)

        events = [x for x in (next_arrival, next_completion) if x is not None]
        if not events:
            break
        current_time = max(current_time, min(events))

        # Resource occupancy is accumulated between event times.
        delta = current_time - last_time
        if delta > 0:
            for p in active:
                for resource, amount in p["required_resources"].items():
                    busy_time[resource] = busy_time.get(resource, 0) + amount * delta
        last_time = current_time

        while patients and patients[0]["arrival_time"] <= current_time:
            p = patients.pop(0)
            p["status"] = "waiting"
            waiting.append(p)

        for p in active[:]:
            if p["end_time"] <= current_time:
                release_resources(p, available)
                p["status"] = "treated"
                completed.append(p)
                active.remove(p)

        # Greedily fill every resource combination available at this event time.
        while True:
            eligible = [p for p in waiting if resources_available(p, available)]
            if not eligible:
                break
            selected = max(
                eligible,
                key=lambda p: (
                    calculate_priority(p, current_time),
                    p["urgency"],
                    -p["arrival_time"],
                    p["id"]
                )
            )
            waiting.remove(selected)
            selected["start_time"] = current_time
            selected["end_time"] = current_time + selected["treatment_time"]
            selected["wait_time"] = current_time - selected["arrival_time"]
            selected["status"] = "in_treatment"
            allocate_resources(selected, available)
            active.append(selected)

    # Finish occupancy through the last completion.
    final_time = last_time
    if active:
        final_time = max(p["end_time"] for p in active)
    if final_time > last_time:
        delta = final_time - last_time
        for p in active:
            for resource, amount in p["required_resources"].items():
                busy_time[resource] = busy_time.get(resource, 0) + amount * delta

    all_results = sorted(completed + impossible, key=lambda p: (p["arrival_time"], p["id"]))
    waits = [p["wait_time"] for p in completed]

    utilization = {}
    duration = max(final_time, 1)
    for resource, capacity in initial.items():
        utilization[resource] = round(
            min(1.0, busy_time.get(resource, 0) / (capacity * duration)),
            3
        )

    return {
        "patients": all_results,
        "statistics": {
            "patients_total": len(all_results),
            "patients_treated": len(completed),
            "patients_unable_to_treat": len(impossible),
            "average_wait": round(sum(waits) / len(waits), 2) if waits else 0,
            "maximum_wait": max(waits) if waits else 0,
            "simulation_duration": final_time,
            "resource_utilization": utilization
        }
    }
