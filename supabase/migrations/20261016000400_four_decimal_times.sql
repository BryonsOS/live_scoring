-- Timing systems report ET to 4 decimals (e.g. 6.2314); keep them exact. Already applied.
alter table public.ls_runs
  alter column rt  type numeric(8,4),
  alter column et  type numeric(8,4),
  alter column mph type numeric(8,3);
alter table public.ls_settings
  alter column penalty_rt  type numeric(8,4),
  alter column penalty_et  type numeric(8,4),
  alter column penalty_mph type numeric(8,3);
