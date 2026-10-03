-- Fixes: "deo" (and any other) account being forced to change its password
-- on every login instead of just the first time.
--
-- Root cause: guard_profile_privileged_columns() blocked ANY change to
-- must_change_password unless the caller had the users.edit/users.create
-- permission. change-password.html tries to clear that flag itself after
-- a successful password change (a normal user acting on their own row),
-- so the update was silently rejected every time, the flag stayed true
-- forever, and the user was asked to change their password again on
-- every subsequent login.
--
-- Fix: allow a signed-in user to flip must_change_password from
-- true -> false on their own row (id = auth.uid()) as a narrow exception,
-- while still blocking every other privileged field and still blocking
-- setting the flag to true (only admins with users.edit can force a
-- future password change).
--
-- Already applied directly to the KPS Supabase project on 2026-08-12.
-- This file documents that change for version control / future deploys.

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.has_permission('users.edit') or public.has_permission('users.create') then
    return new;
  end if;

  -- Allow a signed-in user to clear their own forced-password-change flag
  -- (e.g. after successfully changing their password on change-password.html)
  -- without needing the users.edit permission, as long as nothing else
  -- privileged is being changed in the same statement.
  if auth.uid() = old.id
     and old.must_change_password is true
     and new.must_change_password is false
     and new.role is not distinct from old.role
     and new.is_active is not distinct from old.is_active
     and new.status is not distinct from old.status
     and new.institution_id is not distinct from old.institution_id
     and new.dashboard_route is not distinct from old.dashboard_route
     and new.username is not distinct from old.username
     and new.student_id is not distinct from old.student_id
     and new.locked_at is not distinct from old.locked_at
     and new.locked_by is not distinct from old.locked_by
     and new.lock_reason is not distinct from old.lock_reason
  then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.status is distinct from old.status
     or new.institution_id is distinct from old.institution_id
     or new.dashboard_route is distinct from old.dashboard_route
     or new.must_change_password is distinct from old.must_change_password
     or new.username is distinct from old.username
     or new.student_id is distinct from old.student_id
     or new.locked_at is distinct from old.locked_at
     or new.locked_by is distinct from old.locked_by
     or new.lock_reason is distinct from old.lock_reason
  then
    raise exception 'not authorized to change privileged profile fields';
  end if;

  return new;
end;
$function$;
