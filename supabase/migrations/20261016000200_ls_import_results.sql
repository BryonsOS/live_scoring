-- Daily results spreadsheet import (admin "Upload spreadsheet" tab). Already applied to the project.
-- p_rows: [{car_number, class_code, class_name, first_name, last_name, year, make, model, color, out,
--           runs: [{day, rt, et, mph}]}]
-- Adds or updates only; nothing is removed. Columns missing from the sheet keep their stored values.
-- Times on days that aren't event days, or that the driver's class waives, are skipped and reported.
create or replace function public.ls_import_results(p_rows jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  r jsonb;
  run jsonb;
  v_car text;
  v_class text;
  v_id bigint;
  v_day int;
  v_et numeric;
  v_waived int[];
  v_pen_et numeric;
  v_classes_added int := 0;
  v_added int := 0;
  v_updated int := 0;
  v_runs int := 0;
  v_skipped jsonb := '[]';
begin
  perform public.ls_require_admin();
  select penalty_et into v_pen_et from public.ls_settings where id = 1;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_car := trim(coalesce(r ->> 'car_number', ''));
    v_class := upper(trim(coalesce(r ->> 'class_code', '')));
    if v_car = '' or v_class = '' then
      raise exception 'Every row needs a car number and class' using errcode = '22023';
    end if;

    if not exists (select 1 from public.ls_classes where code = v_class) then
      insert into public.ls_classes (code, name, sort)
      values (v_class, coalesce(nullif(trim(r ->> 'class_name'), ''), 'Class ' || v_class),
              (select coalesce(max(sort), -1) + 1 from public.ls_classes));
      v_classes_added := v_classes_added + 1;
    end if;

    select id into v_id from public.ls_entrants where car_number = v_car;
    if v_id is null then
      insert into public.ls_entrants (car_number, class_code, first_name, last_name, year, make, model, color, out)
      values (v_car, v_class, trim(coalesce(r ->> 'first_name', '')), trim(coalesce(r ->> 'last_name', '')),
              trim(coalesce(r ->> 'year', '')), trim(coalesce(r ->> 'make', '')), trim(coalesce(r ->> 'model', '')),
              trim(coalesce(r ->> 'color', '')), coalesce((r ->> 'out')::boolean, false))
      returning id into v_id;
      v_added := v_added + 1;
    else
      update public.ls_entrants e set
        class_code = v_class,
        first_name = coalesce(trim(r ->> 'first_name'), e.first_name),
        last_name  = coalesce(trim(r ->> 'last_name'), e.last_name),
        year       = coalesce(trim(r ->> 'year'), e.year),
        make       = coalesce(trim(r ->> 'make'), e.make),
        model      = coalesce(trim(r ->> 'model'), e.model),
        color      = coalesce(trim(r ->> 'color'), e.color),
        out        = coalesce((r ->> 'out')::boolean, e.out)
      where e.id = v_id;
      v_updated := v_updated + 1;
    end if;

    select waived_days into v_waived from public.ls_classes where code = v_class;

    for run in select * from jsonb_array_elements(coalesce(r -> 'runs', '[]')) loop
      v_day := (run ->> 'day')::int;
      v_et := nullif(run ->> 'et', '')::numeric;
      if v_et is null or v_et <= 0 then
        v_skipped := v_skipped || jsonb_build_object('car', v_car, 'day', v_day, 'reason', 'no ET');
      elsif not exists (select 1 from public.ls_days where num = v_day) then
        v_skipped := v_skipped || jsonb_build_object('car', v_car, 'day', v_day, 'reason', 'not an event day');
      elsif v_day = any(v_waived) then
        v_skipped := v_skipped || jsonb_build_object('car', v_car, 'day', v_day, 'reason', 'class waives this day');
      else
        insert into public.ls_runs (entrant_id, day, rt, et, mph, penalty)
        values (v_id, v_day, nullif(run ->> 'rt', '')::numeric, v_et, nullif(nullif(run ->> 'mph', '')::numeric, 0),
                v_et >= v_pen_et)
        on conflict (entrant_id, day) do update
          set rt = excluded.rt, et = excluded.et, mph = excluded.mph, penalty = excluded.penalty;
        v_runs := v_runs + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('classesAdded', v_classes_added, 'added', v_added, 'updated', v_updated,
                            'runs', v_runs, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.ls_import_results(jsonb) from public, anon;
grant execute on function public.ls_import_results(jsonb) to authenticated;
