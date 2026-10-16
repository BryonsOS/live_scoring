# Live Scoring

Live results for drag-and-drive events like Sick Week. Officials enter each driver's time on the
**admin page**, and the **public standings page** updates on every phone and screen within about a
second. There's no "close the event" step to get standings.

It's a static site (host it on Netlify) backed by **Supabase** (the `ls_*` tables in the main
Sick Town Hall project). No server of our own runs anywhere.

## Pages

- **Public** (`/`): standings for every class, a "latest results" strip, a class filter, car # and
  driver search, and a CSV download. It works on phones (tap a row to see each day).
  - The badge reads **LIVE** when updates are instant. It switches to **Auto-refresh** if live
    updates aren't available, for example when the Supabase free tier's ~200 simultaneous live
    connections are used up. The page then reloads standings every 15 seconds.
- **Admin** (`/admin`): sign in with an email on the admin list, using a password or an emailed link.
  - **Enter times**: pick the day, type the car #, check the driver card, then RT → ET → MPH with
    <kbd>Enter</kbd>. **No time (penalty)** records the penalty values (1.000 / 20.000 / 50.00 by
    default). Re-entering a car for the same day replaces its time. Recent entries can be edited or
    deleted.
  - **Upload spreadsheet**: upload the end-of-day Excel results sheet (.xlsx, .xls or CSV, same
    layout as the printed results). It previews drivers, times and anything odd, then adds or
    updates every driver and time in one go. It matches drivers by car number, deletes nothing,
    and skips "Waiver" cells. The public page updates the moment it's imported.
  - **Entrants**: add or edit drivers, mark them **Out**, or paste a spreadsheet/CSV to import them.
  - **Classes & days**: tracks per day, classes, and which days each class **waives**.
  - **Settings**: event name, penalty values, CSV export, and the **admin list**.

## Scoring rules

These match the published Sick Week 2026 results (checked against the day 5 PDF for classes A, N,
P, R and S). The logic is in `public/scoring.js`.

1. Each class counts every day except the days it waives. In 2026 most classes waived day 3; DYO
   (R) and Sick Bulls Eye Challenge (S) ran all five.
2. A driver's average RT / ET / MPH covers the counted days they have a time for.
3. **Lowest average ET** wins, with higher average MPH breaking ties. During the week, drivers with
   more counted days completed rank ahead of drivers with fewer.
4. Drivers marked **Out** go to the bottom of their class without a position.

## Supabase

The schema lives in `supabase/migrations/` and has already been applied to the project, **except
`20261016000100_ls_save_days.sql`**. Paste that file into **Dashboard → SQL Editor → Run** once.
Until then, the **Save days** button reports that a database update is needed. Everything else
works.

How it's secured:

- Anyone can **read** standings (`ls_settings`, `ls_days`, `ls_classes`, `ls_entrants`, `ls_runs`,
  and the `ls_snapshot()` function).
- Only signed-in users whose email is in **`ls_admins`** can **write**. Row level security enforces
  this, so the public key in `public/config.js` can't change anything. Admins are managed on the
  Settings tab, and the last admin can't be removed.
- Every change is written to `ls_audit` with the admin's email, and each time records who entered
  it (`ls_runs.updated_by`).

### Sign-in setup (one time)

- **Emailed links**: in **Authentication → URL Configuration**, add the site's address (for example
  `https://<your-site>.netlify.app/admin`) to **Redirect URLs**. Otherwise the link sends people to
  the project's default site.
- **Passwords**: people who already have a login in this Supabase project (dashboard, etc.) can
  use that password. Anyone else can use the emailed link, which creates their login the first
  time. They still need to be on the admin list.

## Deploying (Netlify)

Create a Netlify site from this repo. `netlify.toml` already says to publish `public/` with no
build step, and maps `/admin` to the admin page.

## Local preview

```bash
npm run dev    # http://localhost:8080 (uses the real Supabase project)
npm test       # scoring and CSV tests
```

## Importing entrants

On the **Entrants** tab, paste rows copied from Excel or Google Sheets, or choose a CSV file. The
header row needs **Car #** and **Class** (the class letter). It can also include First Name, Last
Name, Year, Make, Model and Color. An import updates car numbers that already exist and adds new
ones.

```
Car #,Class,First Name,Last Name,Year,Make,Model,Color
401,A,Joshua,Chechak,1972,Plymouth,Barracuda,Yellow
```
