-- ==========================================================================
-- 007 — Continuous Assessment (CA) sheets for the Class / Grade Roster
-- --------------------------------------------------------------------------
-- Adds two small tables used by the new "Continuous Assessment" tab on
-- registrar/, principal/, super-admin/ and ict/ roster.html:
--
--   ca_scheme     the points each CA column is worth (must total 100).
--                 Read by every roster page so sheet headings always match
--                 the school's grading system; editable by Super Admin and
--                 Principal only.
--   ca_sheet_log  one row per sheet downloaded (who / which grade / period),
--                 so the school can see which sheets were handed to teachers.
--
-- Nothing existing is altered. Students, classes and sections are only READ.
-- ==========================================================================

create table if not exists public.ca_scheme (
  component   text primary key
              check (component in ('cp','att','quiz1','quiz2','homework','practical','test')),
  label       text        not null,
  max_points  numeric(5,1) not null check (max_points >= 0 and max_points <= 100),
  sort_order  smallint    not null,
  updated_by  uuid        default auth.uid(),
  updated_at  timestamptz not null default now()
);

insert into public.ca_scheme (component, label, max_points, sort_order) values
  ('cp',        'CP',        5, 1),
  ('att',       'ATT',       5, 2),
  ('quiz1',     'Quiz 1',   10, 3),
  ('quiz2',     'Quiz 2',   10, 4),
  ('homework',  'Home Work',10, 5),
  ('practical', 'Practical',30, 6),
  ('test',      'Test',     30, 7)
on conflict (component) do nothing;

create table if not exists public.ca_sheet_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  generated_by     uuid        default auth.uid(),
  generated_by_role text       default public.current_role_name(),
  class_id         uuid        references public.classes(id) on delete set null,
  class_name       text        not null,
  period           smallint    not null check (period between 0 and 6),   -- 0 = all six periods
  academic_year    text,
  subject          text,
  teacher_name     text,
  student_count    integer     not null default 0,
  male_count       integer     not null default 0,
  female_count     integer     not null default 0
);

create index if not exists ca_sheet_log_created_idx on public.ca_sheet_log (created_at desc);
create index if not exists ca_sheet_log_class_idx   on public.ca_sheet_log (class_id);

-- keep updated_at honest on scheme edits (set_updated_at() already exists)
drop trigger if exists ca_scheme_set_updated_at on public.ca_scheme;
create trigger ca_scheme_set_updated_at before update on public.ca_scheme
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.ca_scheme    enable row level security;
alter table public.ca_sheet_log enable row level security;

drop policy if exists ca_scheme_select on public.ca_scheme;
create policy ca_scheme_select on public.ca_scheme for select to authenticated
  using (public.current_role_name() <> 'student');

drop policy if exists ca_scheme_write on public.ca_scheme;
create policy ca_scheme_write on public.ca_scheme for all to authenticated
  using      (public.current_role_name() in ('super_admin','principal'))
  with check (public.current_role_name() in ('super_admin','principal'));

drop policy if exists ca_sheet_log_select on public.ca_sheet_log;
create policy ca_sheet_log_select on public.ca_sheet_log for select to authenticated
  using (public.current_role_name() in ('super_admin','principal','ict','registrar'));

drop policy if exists ca_sheet_log_insert on public.ca_sheet_log;
create policy ca_sheet_log_insert on public.ca_sheet_log for insert to authenticated
  with check (generated_by = auth.uid()
              and public.current_role_name() in ('super_admin','principal','ict','registrar'));

revoke all on public.ca_scheme    from anon;
revoke all on public.ca_sheet_log from anon;
grant select, insert, update, delete on public.ca_scheme    to authenticated;
grant select, insert                 on public.ca_sheet_log to authenticated;
