# MedFlow

> **Web app:** the dashboard lives in [`frontend/`](frontend/README.md) (Next.js + TypeScript). It includes a working TypeScript simulation engine that uses the data shapes below, so the UI does not depend on the Python `run_simulation` being finished.

## Simulation Interface

The MedFlow simulation accepts patients and hospital resources.

### Function

```python
result = run_simulation(patients, resources)
```

## Resources

The MVP hospital has:

```python
resources = {
    "doctor": 5,
    "nurse": 10,
    "bed": 20,
    "icu_bed": 5,
    "operating_room": 2
}
```

All resource values represent the available capacity.

## Patient Input

Each patient follows this structure:

```python
{
    "id": "P001",
    "arrival_time": 15,
    "urgency": 5,
    "treatment_time": 30,
    "required_resources": {
        "doctor": 1,
        "nurse": 1,
        "bed": 1
    }
}
```

### Patient fields

* `id`: Unique patient identifier.
* `arrival_time`: Arrival time in minutes from the beginning of the simulation.
* `urgency`: Integer representing the patient's urgency.
* `treatment_time`: Treatment duration in minutes.
* `required_resources`: Resources required while the patient is being treated.

## Simulation Output

The simulation returns:

```python
{
    "patients": [
        {
            "id": "P001",
            "arrival_time": 15,
            "urgency": 5,
            "treatment_time": 30,
            "start_time": 15,
            "end_time": 45,
            "wait_time": 0,
            "status": "treated"
        }
    ],
    "statistics": {
        "patients_treated": 1,
        "average_wait": 0,
        "maximum_wait": 0,
        "resource_utilization": {
            "doctor": 0.50,
            "nurse": 0.25,
            "bed": 0.20,
            "icu_bed": 0.00,
            "operating_room": 0.00
        }
    }
}
```

## Time Convention

All simulation times are integers representing minutes from the beginning of the simulation.

For example:

```text
arrival_time = 15
```

means the patient arrived 15 minutes after the simulation started.

```text
treatment_time = 30
```

means treatment takes 30 minutes.

## Team Interface

Dharansh is responsible for implementing:

```python
run_simulation(patients, resources)
```

Dhimant can build the frontend using the output format above without waiting for the simulation to be completed.

The interface should remain stable once frontend development begins.
