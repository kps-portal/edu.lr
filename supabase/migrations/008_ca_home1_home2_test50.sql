-- ==========================================================================
-- 008 — CA scheme: Test = 50, Home Work split into Home 1 / Home 2
-- --------------------------------------------------------------------------
-- New Continuous Assessment points (per period, out of 100):
--
--   CP 5 · ATT 5 · Quiz 1 10 · Quiz 2 10 · Home 1 10 · Test 50
--   + ONE of:  Practical 10   (science / lab subjects)
--              Home 2     10   (subjects with no practical, e.g. History)
--
--   5+5+10+10+10+50+10 = 100   (with Practical)
--   5+5+10+10+10+50+10 = 100   (with Home 2)
--
-- Run AFTER 007_continuous_assessment.sql. Safe to run more than once.
-- Only public.ca_scheme is touched; students, classes and sections are not.
-- ==========================================================================

-- 1) Allow the two new component keys.
alter table public.ca_scheme drop constraint if exists ca_scheme_component_check;
alter table public.ca_scheme
  add constraint ca_scheme_component_check
  check (component in ('cp','att','quiz1','quiz2','homework1','homework2','practical','test'));

-- 2) The old single "homework" row becomes Home 1.
update public.ca_scheme
   set component = 'homework1', label = 'Home 1', max_points = 10, sort_order = 5
 where component = 'homework'
   and not exists (select 1 from public.ca_scheme where component = 'homework1');

delete from public.ca_scheme where component = 'homework';

-- 3) Write the new scheme (inserts what is missing, resets the rest).
insert into public.ca_scheme (component, label, max_points, sort_order) values
  ('cp',        'CP',        5, 1),
  ('att',       'ATT',       5, 2),
  ('quiz1',     'Quiz 1',   10, 3),
  ('quiz2',     'Quiz 2',   10, 4),
  ('homework1', 'Home 1',   10, 5),
  ('homework2', 'Home 2',   10, 6),
  ('practical', 'Practical',10, 7),
  ('test',      'Test',     50, 8)
on conflict (component) do update
  set label = excluded.label,
      max_points = excluded.max_points,
      sort_order = excluded.sort_order;
