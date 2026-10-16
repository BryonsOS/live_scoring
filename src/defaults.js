// Starting setup for a fresh database, based on the Sick Week 2026 results.
// Everything here can be changed from the admin page.

export const DEFAULT_SETTINGS = {
  event_name: 'Sick Week 2027',
  // Values recorded when a driver fails to make a timed pass on a counted day.
  penalty_rt: '1.000',
  penalty_et: '20.000',
  penalty_mph: '50.00',
};

export const DEFAULT_DAYS = [
  { num: 1, location: 'Gainesville, FL' },
  { num: 2, location: 'Adel, GA' },
  { num: 3, location: 'Bradenton, FL' },
  { num: 4, location: 'Orlando, FL' },
  { num: 5, location: 'Gainesville, FL' },
];

// In 2026 most classes waived day 3; DYO and Bulls Eye ran all five days.
const WAIVE_3 = [3];

export const DEFAULT_CLASSES = [
  { code: 'A', name: 'Unlimited', waivedDays: WAIVE_3 },
  { code: 'B', name: 'Unlimited Iron', waivedDays: WAIVE_3 },
  { code: 'C', name: 'Heavy Metal', waivedDays: WAIVE_3 },
  { code: 'D', name: 'Modified', waivedDays: WAIVE_3 },
  { code: 'E', name: 'Pro Street', waivedDays: WAIVE_3 },
  { code: 'F', name: 'Super Street', waivedDays: WAIVE_3 },
  { code: 'G', name: 'Stick Shift', waivedDays: WAIVE_3 },
  { code: 'H', name: 'Naturally Aspirated', waivedDays: WAIVE_3 },
  { code: 'I', name: 'Naturally Aspirated - Small Block', waivedDays: WAIVE_3 },
  { code: 'J', name: 'Rowdy Radials (1/8)', waivedDays: WAIVE_3 },
  { code: 'K', name: 'Sick Week Freaks', waivedDays: WAIVE_3 },
  { code: 'L', name: 'Gassers vs Hot Rods vs Beetles', waivedDays: WAIVE_3 },
  { code: 'M', name: 'Street Race 275', waivedDays: WAIVE_3 },
  { code: 'N', name: 'Sick Street Race', waivedDays: WAIVE_3 },
  { code: 'P', name: 'Pro DYO', waivedDays: WAIVE_3 },
  { code: 'R', name: 'DYO', waivedDays: [] },
  { code: 'S', name: 'Sick Bulls Eye Challenge', waivedDays: [] },
];
