# Data provenance

MedFlow works fully offline. This build was produced in a sandbox without internet access, so **no real public dataset is bundled**.
`data/sample_ed_visits.csv` (400 rows) is **synthetic**, generated deterministically by `backend/data_ingest.ensure_sample()`
in the *shape* of public ED-triage datasets (age, sex, chief complaint, vitals, ESI-style triage level).

Ingestion pipeline: `CSV -> load_csv (validation: ranges, missing values, rejects counted) -> normalisation (column mapping,
complaint text -> symptom keywords) -> patient_from_row (expert system pathway) -> simulation`.
To use a real dataset (check its licence): download the CSV, call `load_csv(path, mapping={"complaint": ["Chief Complaint"], ...})`
or set `dataset: "<path>"` in a scenario dict. Rows failing validation are dropped and reported.

| Field | Source |
|---|---|
| age, sex, complaint text, vital signs, triage level | dataset row (real when a real CSV is used) |
| symptoms | derived by keyword match from the complaint |
| risk score, urgency (when no triage level), department, specialty, bed/nurse/equipment needs | expert system (rules) |
| nominal treatment minutes | assumption per pathway/category |
| arrival times | simulated (Poisson process from the scenario profile) |
| actual treatment duration | simulated (mean-preserving log-normal, department bias) |
| deterioration while waiting | simulated (exponential hazard by category) |
| consumables used | simulated (category profile x U(0.7,1.3)) |
| staff roster, beds, equipment, stock levels | seeded demo hospital in `backend/hospital.py` |
