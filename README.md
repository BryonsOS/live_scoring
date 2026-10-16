# Live Scoring

Live results for drag-and-drive events like Sick Week. Officials type each driver's time into the
**admin page**, and the **public standings page** updates on every phone and screen within about a
second. There's no "close the event" step to get standings.

- **Public page** (`/`): standings for every class, a "latest results" strip, a class filter and a
  car #/driver search. It works on phones (tap a row to see each day). The live indicator turns amber
  if the connection drops, and the page reconnects on its own.
- **Admin page** (`/admin`, password protected):
  - **Enter times**: pick the day, type the car #, check the driver card, then RT → ET → MPH with
    <kbd>Enter</kbd>. **No time (penalty)** records the penalty values (1.000 / 20.000 / 50.00 by
    default). Re-entering a car for the same day replaces its time. Recent entries can be edited or
    deleted.
  - **Entrants**: add or edit drivers, mark them **Out**, or paste a spreadsheet/CSV to import them.
  - **Classes & days**: tracks/locations per day, classes, and which days each class **waives**.
  - **Settings**: event name and penalty values. You can also download a CSV of the standings.

## Scoring rules

These match the published Sick Week 2026 results (checked against the day 5 PDF for classes A, N,
P, R and S):

1. Each class counts every day except the days it waives. In 2026 most classes waived day 3; DYO
   (R) and Sick Bulls Eye Challenge (S) ran all five.
2. A driver's average RT / ET / MPH covers the counted days they have a time for.
3. Ranking: **lowest average ET** wins, with higher average MPH breaking ties. During the week,
   drivers with more counted days completed rank ahead of drivers with fewer, so a driver who has
   run one fast day can't jump someone who has run three.
4. Drivers marked **Out** go to the bottom of their class without a position.

The rules live in `src/scoring.js` if they need to change, for example to score a class on dial-in
accuracy instead of ET.

## Running it

You need Node.js 22.13 or newer. There are no packages to install, because it uses Node's built-in
SQLite.

```bash
ADMIN_PASSWORD=choose-something npm start
# public:  http://localhost:3000/
# admin:   http://localhost:3000/admin
```

To try it with made-up drivers (admin password `demo`):

```bash
npm run demo
```

Run the tests with `npm test`.

### Settings (environment variables)

| Variable          | Default                  | Purpose                                          |
| ----------------- | ------------------------ | ------------------------------------------------ |
| `ADMIN_PASSWORD`  | random, printed at start | Password for `/admin`                            |
| `PORT`            | `3000`                   | HTTP port                                        |
| `DB_PATH`         | `data/live_scoring.db`   | SQLite file. Keep it on persistent storage       |
| `SECURE_COOKIES`  | off                      | Set to `1` when served over HTTPS                |

### Deploying

The app is one small Node process with one SQLite file. Any host that runs a long-lived Node or
Docker app with a persistent disk will work, such as Render, Railway, Fly.io or a small VPS. Mount
the disk where `DB_PATH` points (the Dockerfile uses `/data`), set `ADMIN_PASSWORD`, and set
`SECURE_COOKIES=1` behind HTTPS.

```bash
docker build -t live-scoring .
docker run -p 3000:3000 -v live-scoring-data:/data -e ADMIN_PASSWORD=choose-something live-scoring
```

Netlify-style static hosting **won't** work for this, because the server has to stay running to
push updates to viewers.

## Importing entrants

On the **Entrants** tab, paste rows copied from Excel or Google Sheets, or choose a CSV file. The
header row needs **Car #** and **Class** (the class letter). It can also include First Name, Last
Name, Year, Make, Model and Color. An import updates car numbers that already exist and adds new
ones.

```
Car #,Class,First Name,Last Name,Year,Make,Model,Color
401,A,Joshua,Chechak,1972,Plymouth,Barracuda,Yellow
```

## API

| Method | Path                         | Notes                                               |
| ------ | ---------------------------- | --------------------------------------------------- |
| GET    | `/api/standings`             | Full standings JSON                                 |
| GET    | `/api/stream`                | Server-Sent Events, sends a `standings` event on every change |
| GET    | `/api/standings.csv`         | Standings export                                    |
| POST   | `/api/login`                 | `{ "password": "…" }` sets the admin cookie         |
| PUT    | `/api/admin/runs`            | `{ carNumber, day, rt, et, mph }` or `{ carNumber, day, penalty: true }` |
| …      | `/api/admin/*`               | Entrants, classes, days, settings (see `src/app.js`) |

Every change is also written to an `audit` table in the database, so there's a record of which time
was changed and when.
