// Pure standings calculation. No database access here, so the same rules can be
// reused by tests, exports, or a different backend later.
//
// Rules (matching how Sick Week results have been published):
//   - Each class counts every event day except the days it waives.
//   - A driver's averages are taken over the counted days they have a result for.
//   - Ranking: most counted days completed first, then lowest average ET,
//     then highest average MPH. Drivers marked "out" are listed after everyone
//     still in competition and are not given a rank.

const round = (n, places) => (n == null ? null : Number(n.toFixed(places)));

function average(values) {
  const present = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

function compareRows(a, b) {
  if (a.out !== b.out) return a.out ? 1 : -1;
  if (a.completed !== b.completed) return b.completed - a.completed;
  if (a.avgEt == null || b.avgEt == null) {
    if (a.avgEt != null) return -1;
    if (b.avgEt != null) return 1;
  } else if (a.avgEt !== b.avgEt) {
    return a.avgEt - b.avgEt;
  }
  if ((a.avgMph ?? 0) !== (b.avgMph ?? 0)) return (b.avgMph ?? 0) - (a.avgMph ?? 0);
  return String(a.carNumber).localeCompare(String(b.carNumber), undefined, { numeric: true });
}

export function computeStandings({ days, classes, entrants, runs }) {
  const dayNums = days.map((d) => d.num).sort((a, b) => a - b);
  const runsByEntrant = new Map();
  for (const run of runs) {
    if (!runsByEntrant.has(run.entrant_id)) runsByEntrant.set(run.entrant_id, new Map());
    runsByEntrant.get(run.entrant_id).set(run.day, run);
  }

  const byClass = new Map(classes.map((c) => [c.code, []]));

  for (const e of entrants) {
    const cls = classes.find((c) => c.code === e.class_code);
    if (!cls) continue;
    const waived = new Set(cls.waivedDays);
    const myRuns = runsByEntrant.get(e.id) ?? new Map();
    const results = {};
    const counted = [];
    for (const day of dayNums) {
      if (waived.has(day)) {
        results[day] = { waived: true };
        continue;
      }
      const r = myRuns.get(day);
      if (r) {
        results[day] = { rt: r.rt, et: r.et, mph: r.mph, penalty: !!r.penalty };
        counted.push(r);
      } else {
        results[day] = null;
      }
    }

    byClass.get(cls.code).push({
      entrantId: e.id,
      carNumber: e.car_number,
      firstName: e.first_name,
      lastName: e.last_name,
      year: e.year,
      make: e.make,
      model: e.model,
      color: e.color,
      out: !!e.out,
      results,
      completed: counted.length,
      required: dayNums.filter((d) => !waived.has(d)).length,
      avgRt: round(average(counted.map((r) => r.rt)), 5),
      avgEt: round(average(counted.map((r) => r.et)), 5),
      avgMph: round(average(counted.map((r) => r.mph)), 4),
    });
  }

  return classes.map((cls) => {
    const rows = byClass.get(cls.code).sort(compareRows);
    let rank = 0;
    for (const row of rows) row.rank = !row.out && row.completed > 0 ? ++rank : null;
    return { code: cls.code, name: cls.name, waivedDays: cls.waivedDays, rows };
  });
}
