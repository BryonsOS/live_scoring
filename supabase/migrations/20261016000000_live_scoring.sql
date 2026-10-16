-- Live scoring (ls_*) tables for drag-and-drive events.
-- Public: read-only standings. Writes: signed-in users whose email is in ls_admins.
--
-- This is the full schema in one file. It was applied to the Supabase project in pieces
-- (live_scoring_1_tables ... live_scoring_7_run_timestamps); ls_save_days is in
-- 20261016000100_ls_save_days.sql because it has to be run from the SQL editor.

-- ---------- tables ----------
create table public.ls_settings (
  id          int primary key default 1 check (id = 1),
  event_name  text not null default 'Sick Week 2027' check (length(trim(event_name)) > 0),
  penalty_rt  numeric(6,3) not null default 1.000,
  penalty_et  numeric(7,3) not null default 20.000 check (penalty_et > 0),
  penalty_mph numeric(7,2) not null default 50.00 check (penalty_mph > 0),
  updated_at  timestamptz not null default now()
);
comment on table public.ls_settings is 'Live scoring: single-row event settings.';

create table public.ls_days (
  num      int primary key check (num > 0),
  location text not null default '',
  date     date
);
comment on table public.ls_days is 'Live scoring: event days / tracks.';

create table public.ls_classes (
  code        text primary key check (code ~ '^[A-Z0-9]{1,4}$'),
  name        text not null check (length(trim(name)) > 0),
  waived_days int[] not null default '{}',
  sort        int not null default 0
);
comment on table public.ls_classes is 'Live scoring: classes; waived_days are left out of averages.';

create table public.ls_entrants (
  id         bigint generated always as identity primary key,
  car_number text not null unique check (length(trim(car_number)) > 0),
  class_code text not null references public.ls_classes(code) on update cascade,
  first_name text not null default '',
  last_name  text not null default '',
  year       text not null default '',
  make       text not null default '',
  model      text not null default '',
  color      text not null default '',
  out        boolean not null default false,
  created_at timestamptz not null default now()
);
create index ls_entrants_class_idx on public.ls_entrants(class_code);
comment on table public.ls_entrants is 'Live scoring: registered cars/drivers.';

create table public.ls_runs (
  entrant_id bigint not null references public.ls_entrants(id) on delete cascade,
  day        int not null references public.ls_days(num) on update cascade on delete cascade,
  rt         numeric(6,3),
  et         numeric(7,3) not null check (et > 0),
  mph        numeric(7,2) check (mph > 0),
  penalty    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (entrant_id, day)
);
create index ls_runs_day_idx on public.ls_runs(day);
create index ls_runs_updated_idx on public.ls_runs(updated_at desc);
comment on table public.ls_runs is 'Live scoring: one timed result per entrant per day.';

create table public.ls_admins (
  email    text primary key check (email = lower(email) and email like '%@%'),
  added_at timestamptz not null default now()
);
comment on table public.ls_admins is 'Live scoring: emails allowed to enter times and edit setup.';

create table public.ls_audit (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text not null,
  detail jsonb not null
);
create index ls_audit_at_idx on public.ls_audit(at desc);
comment on table public.ls_audit is 'Live scoring: change history (written by triggers).';

-- ---------- helpers ----------
create function public.ls_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.role() = 'authenticated'
     and exists (select 1 from public.ls_admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create function public.ls_require_admin() returns void
language plpgsql stable set search_path = public as $$
begin
  if not public.ls_is_admin() then
    raise exception 'Not authorized: sign in with an admin email' using errcode = '42501';
  end if;
end;
$$;

-- Stamp who/when on every result and refuse times on a waived day.
create function public.ls_runs_before() returns trigger
language plpgsql set search_path = public as $$
declare
  v_waived int[];
  v_code text;
begin
  select c.waived_days, c.code into v_waived, v_code
    from public.ls_entrants e join public.ls_classes c on c.code = e.class_code
   where e.id = new.entrant_id;
  if new.day = any(v_waived) then
    raise exception 'Class % waives day %', v_code, new.day using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := lower(auth.jwt() ->> 'email');
  return new;
end;
$$;
create trigger ls_runs_before before insert or update on public.ls_runs
  for each row execute function public.ls_runs_before();

create function public.ls_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ls_audit (actor, action, detail)
  values (
    lower(auth.jwt() ->> 'email'),
    tg_table_name || '.' || lower(tg_op),
    case tg_op
      when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return null;
end;
$$;
create trigger ls_audit after insert or update or delete on public.ls_runs for each row execute function public.ls_audit_row();
create trigger ls_audit after insert or update or delete on public.ls_entrants for each row execute function public.ls_audit_row();
create trigger ls_audit after insert or update or delete on public.ls_classes for each row execute function public.ls_audit_row();
create trigger ls_audit after insert or update or delete on public.ls_days for each row execute function public.ls_audit_row();
create trigger ls_audit after insert or update or delete on public.ls_settings for each row execute function public.ls_audit_row();
create trigger ls_audit after insert or update or delete on public.ls_admins for each row execute function public.ls_audit_row();

create function public.ls_settings_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger ls_settings_touch before update on public.ls_settings for each row execute function public.ls_settings_touch();

create function public.ls_keep_one_admin() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.ls_admins) then
    raise exception 'At least one admin is required' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger ls_keep_one_admin after delete on public.ls_admins
  deferrable initially immediate for each row execute function public.ls_keep_one_admin();

-- ---------- row level security ----------
alter table public.ls_settings enable row level security;
alter table public.ls_days     enable row level security;
alter table public.ls_classes  enable row level security;
alter table public.ls_entrants enable row level security;
alter table public.ls_runs     enable row level security;
alter table public.ls_admins   enable row level security;
alter table public.ls_audit    enable row level security;

create policy "public read" on public.ls_settings for select to anon, authenticated using (true);
create policy "public read" on public.ls_days     for select to anon, authenticated using (true);
create policy "public read" on public.ls_classes  for select to anon, authenticated using (true);
create policy "public read" on public.ls_entrants for select to anon, authenticated using (true);
create policy "public read" on public.ls_runs     for select to anon, authenticated using (true);

create policy "admin write" on public.ls_settings for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin write" on public.ls_days     for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin write" on public.ls_classes  for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin write" on public.ls_entrants for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin write" on public.ls_runs     for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin all"   on public.ls_admins   for all to authenticated using (public.ls_is_admin()) with check (public.ls_is_admin());
create policy "admin read"  on public.ls_audit    for select to authenticated using (public.ls_is_admin());

-- ---------- RPCs ----------
-- Everything the standings page needs in one call (avoids the 1000-row API page limit).
create function public.ls_snapshot() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('eventName', event_name, 'penaltyRt', penalty_rt, 'penaltyEt', penalty_et, 'penaltyMph', penalty_mph)
                   from public.ls_settings where id = 1),
    'days', coalesce((select jsonb_agg(jsonb_build_object('num', num, 'location', location, 'date', date) order by num) from public.ls_days), '[]'),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'waivedDays', to_jsonb(waived_days), 'sort', sort) order by sort, code)
                           from public.ls_classes), '[]'),
    'entrants', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'car_number', car_number, 'class_code', class_code, 'first_name', first_name,
                             'last_name', last_name, 'year', year, 'make', make, 'model', model, 'color', color, 'out', out))
                            from public.ls_entrants), '[]'),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('entrant_id', entrant_id, 'day', day, 'rt', rt, 'et', et, 'mph', mph,
                         'penalty', penalty, 'updated_at', updated_at) order by updated_at desc)
                        from public.ls_runs), '[]'),
    'serverTime', now()
  );
$$;

-- Save (or replace) one car's time for a day. p_penalty records the configured "no time" values.
create function public.ls_save_run(p_car text, p_day int, p_rt numeric, p_et numeric, p_mph numeric, p_penalty boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_id bigint;
  s public.ls_settings;
begin
  perform public.ls_require_admin();
  select id into v_id from public.ls_entrants where car_number = trim(p_car);
  if v_id is null then
    raise exception 'No entrant with car #%', trim(p_car) using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ls_days where num = p_day) then
    raise exception 'Day % is not an event day', p_day using errcode = '22023';
  end if;
  if p_penalty then
    select * into s from public.ls_settings where id = 1;
    p_rt := s.penalty_rt; p_et := s.penalty_et; p_mph := s.penalty_mph;
  elsif p_et is null or p_et <= 0 then
    raise exception 'ET is required and must be greater than 0' using errcode = '22023';
  elsif p_mph is not null and p_mph <= 0 then
    raise exception 'MPH must be greater than 0' using errcode = '22023';
  end if;

  insert into public.ls_runs (entrant_id, day, rt, et, mph, penalty)
  values (v_id, p_day, p_rt, p_et, p_mph, coalesce(p_penalty, false))
  on conflict (entrant_id, day) do update
    set rt = excluded.rt, et = excluded.et, mph = excluded.mph, penalty = excluded.penalty;
  return jsonb_build_object('entrantId', v_id, 'day', p_day);
end;
$$;

-- Bulk add/update entrants by car number. p_rows: [{car_number, class_code, first_name, ...}]
create function public.ls_import_entrants(p_rows jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  r jsonb;
  v_car text;
  v_class text;
  v_added int := 0;
  v_updated int := 0;
begin
  perform public.ls_require_admin();
  for r in select * from jsonb_array_elements(p_rows) loop
    v_car := trim(coalesce(r ->> 'car_number', ''));
    v_class := upper(trim(coalesce(r ->> 'class_code', '')));
    if v_car = '' then raise exception 'Every row needs a car number' using errcode = '22023'; end if;
    if not exists (select 1 from public.ls_classes where code = v_class) then
      raise exception 'Unknown class "%" for car %', v_class, v_car using errcode = '22023';
    end if;
    if exists (select 1 from public.ls_entrants where car_number = v_car) then
      update public.ls_entrants set
        class_code = v_class,
        first_name = trim(coalesce(r ->> 'first_name', '')), last_name = trim(coalesce(r ->> 'last_name', '')),
        year = trim(coalesce(r ->> 'year', '')), make = trim(coalesce(r ->> 'make', '')),
        model = trim(coalesce(r ->> 'model', '')), color = trim(coalesce(r ->> 'color', ''))
      where car_number = v_car;
      v_updated := v_updated + 1;
    else
      insert into public.ls_entrants (car_number, class_code, first_name, last_name, year, make, model, color)
      values (v_car, v_class, trim(coalesce(r ->> 'first_name', '')), trim(coalesce(r ->> 'last_name', '')),
              trim(coalesce(r ->> 'year', '')), trim(coalesce(r ->> 'make', '')),
              trim(coalesce(r ->> 'model', '')), trim(coalesce(r ->> 'color', '')));
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

revoke execute on function public.ls_save_run(text, int, numeric, numeric, numeric, boolean) from public, anon;
revoke execute on function public.ls_import_entrants(jsonb) from public, anon;
revoke execute on function public.ls_require_admin() from public, anon;
grant execute on function public.ls_save_run(text, int, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.ls_import_entrants(jsonb) to authenticated;
grant execute on function public.ls_require_admin() to authenticated;
grant execute on function public.ls_snapshot() to anon, authenticated;
grant execute on function public.ls_is_admin() to anon, authenticated;
revoke execute on function public.ls_audit_row() from public, anon, authenticated; -- trigger only

-- ---------- realtime ----------
alter publication supabase_realtime add table public.ls_settings, public.ls_days, public.ls_classes, public.ls_entrants, public.ls_runs;

-- ---------- starting data (Sick Week 2026 setup) ----------
insert into public.ls_settings (id) values (1);
insert into public.ls_days (num, location) values
  (1, 'Gainesville, FL'), (2, 'Adel, GA'), (3, 'Bradenton, FL'), (4, 'Orlando, FL'), (5, 'Gainesville, FL');
insert into public.ls_classes (code, name, waived_days, sort) values
  ('A', 'Unlimited', '{3}', 0),
  ('B', 'Unlimited Iron', '{3}', 1),
  ('C', 'Heavy Metal', '{3}', 2),
  ('D', 'Modified', '{3}', 3),
  ('E', 'Pro Street', '{3}', 4),
  ('F', 'Super Street', '{3}', 5),
  ('G', 'Stick Shift', '{3}', 6),
  ('H', 'Naturally Aspirated', '{3}', 7),
  ('I', 'Naturally Aspirated - Small Block', '{3}', 8),
  ('J', 'Rowdy Radials (1/8)', '{3}', 9),
  ('K', 'Sick Week Freaks', '{3}', 10),
  ('L', 'Gassers vs Hot Rods vs Beetles', '{3}', 11),
  ('M', 'Street Race 275', '{3}', 12),
  ('N', 'Sick Street Race', '{3}', 13),
  ('P', 'Pro DYO', '{3}', 14),
  ('R', 'DYO', '{}', 15),
  ('S', 'Sick Bulls Eye Challenge', '{}', 16);
insert into public.ls_admins (email) values ('rompabryon@gmail.com');
