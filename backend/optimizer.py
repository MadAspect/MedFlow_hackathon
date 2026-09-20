from copy import deepcopy
from .simulation import run_simulation

def optimize_resources(patients, resources, enabled=True):
    if not enabled:
        return {"enabled": False}

    baseline = run_simulation(deepcopy(patients), dict(resources))
    base_wait = baseline["statistics"]["average_wait"]
    base_unable = baseline["statistics"]["patients_unable_to_treat"]

    best = None
    resource_order = ["doctor", "nurse", "bed", "icu_bed", "operating_room"]

    for resource in resource_order:
        if resource not in resources:
            continue
        candidate = dict(resources)
        candidate[resource] += 1
        result = run_simulation(deepcopy(patients), candidate)
        stats = result["statistics"]

        # Optimize for fewer untreated patients first, then lower wait,
        # then avoid unnecessary resource additions.
        score = (
            stats["patients_unable_to_treat"],
            stats["average_wait"],
            stats["maximum_wait"]
        )
        if best is None or score < best["score"]:
            best = {
                "resource": resource,
                "added": 1,
                "resources": candidate,
                "result": result,
                "score": score
            }

    if best is None or best["score"] >= (base_unable, base_wait, baseline["statistics"]["maximum_wait"]):
        return {
            "enabled": True,
            "changed": False,
            "message": "Current resource plan is already optimal within the one-unit search.",
            "baseline": baseline["statistics"],
            "recommended_resources": resources
        }

    return {
        "enabled": True,
        "changed": True,
        "recommendation": f"Add 1 {best['resource'].replace('_', ' ')}",
        "recommended_resources": best["resources"],
        "baseline": baseline["statistics"],
        "optimized": best["result"]["statistics"]
    }
