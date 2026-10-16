-- Saves the event days list from the admin "Classes & days" tab.
-- Run this once in Supabase: Dashboard -> SQL Editor -> paste -> Run.

-- Replace the list of event days. Days left out are deleted along with their times.
create function public.ls_save_days(p_days jsonb)
returns void language plpgsql set search_path = public as $$
declare
  v_nums int[];
begin
  perform public.ls_require_admin();
  select array_agg((d ->> 'num')::int) into v_nums from jsonb_array_elements(p_days) d;
  if v_nums is null or array_length(v_nums, 1) = 0 then
    raise exception 'At least one day is required' using errcode = '22023';
  end if;
  if (select count(distinct n) from unnest(v_nums) n) <> array_length(v_nums, 1) then
    raise exception 'Day numbers must be unique' using errcode = '22023';
  end if;
  delete from public.ls_days where num <> all(v_nums);
  insert into public.ls_days (num, location, date)
  select (d ->> 'num')::int, trim(coalesce(d ->> 'location', '')), nullif(d ->> 'date', '')::date
    from jsonb_array_elements(p_days) d
  on conflict (num) do update set location = excluded.location, date = excluded.date;
  update public.ls_classes set waived_days = array(select x from unnest(waived_days) x where x = any(v_nums))
   where not (waived_days <@ v_nums);
end;
$$;

revoke execute on function public.ls_save_days(jsonb) from public, anon;
grant execute on function public.ls_save_days(jsonb) to authenticated;
