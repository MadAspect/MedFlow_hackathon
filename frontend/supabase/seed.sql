-- MedFlow optional seed data (synthetic). Run AFTER schema.sql.
-- Inserts the default resource configuration and the 18 example patients that
-- the app's "Load Example Data" button creates. Safe to re-run.

insert into public.resource_configurations (doctors, nurses, beds, icu_beds, operating_rooms)
values (5, 10, 20, 5, 2);

insert into public.patients
  (patient_id, condition, arrival_time, urgency, treatment_time, required_resources, priority_score)
values
  ('P001', 'Cardiac event',       0,  5, 35, '{"doctor":1,"nurse":2,"icu_bed":1}',        20),
  ('P002', 'Fracture',            2,  3, 25, '{"doctor":1,"nurse":1,"bed":1}',            12),
  ('P003', 'Routine check',       5,  1, 15, '{"nurse":1,"bed":1}',                        4),
  ('P004', 'Stroke',              8,  5, 40, '{"doctor":1,"nurse":2,"icu_bed":1}',        20),
  ('P005', 'Minor illness',      10,  1, 10, '{"nurse":1,"bed":1}',                        4),
  ('P006', 'Abdominal emergency',12,  4, 45, '{"doctor":2,"nurse":2,"operating_room":1}', 16),
  ('P007', 'Laceration',         15,  2, 20, '{"doctor":1,"nurse":1,"bed":1}',             8),
  ('P008', 'Respiratory failure',18,  5, 50, '{"doctor":1,"nurse":2,"icu_bed":1}',        20),
  ('P009', 'Sepsis',             22,  4, 30, '{"doctor":1,"nurse":1,"icu_bed":1}',        16),
  ('P010', 'Head injury',        25,  4, 35, '{"doctor":1,"nurse":2,"bed":1}',            16),
  ('P011', 'Routine check',      28,  1, 12, '{"nurse":1,"bed":1}',                        4),
  ('P012', 'Multi-trauma',       30,  5, 60, '{"doctor":2,"nurse":3,"operating_room":1}', 20),
  ('P013', 'Fracture',           35,  2, 25, '{"doctor":1,"nurse":1,"bed":1}',             8),
  ('P014', 'Minor illness',      40,  1, 10, '{"nurse":1,"bed":1}',                        4),
  ('P015', 'Severe burns',       45,  4, 40, '{"doctor":1,"nurse":2,"icu_bed":1}',        16),
  ('P016', 'Laceration',         50,  3, 20, '{"doctor":1,"nurse":1,"bed":1}',            12),
  ('P017', 'Cardiac event',      60,  3, 30, '{"doctor":1,"nurse":1,"bed":1}',            12),
  ('P018', 'Stroke',             70,  4, 45, '{"doctor":1,"nurse":2,"operating_room":1}', 16)
on conflict do nothing;
