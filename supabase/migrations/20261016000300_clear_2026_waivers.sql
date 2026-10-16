-- 2027 starts with no waived days (the 2026 day 3 waiver was a rain day). Already applied.
-- Waived days are now set from the daily spreadsheet: a day where a whole class says "Waiver".
update public.ls_classes set waived_days = '{}' where waived_days <> '{}';
