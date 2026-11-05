# Care Hours tests

Automated tests that open Care Hours in a real browser and use it the way a caregiver or a payer would.

**Your real data is never touched.** The tests replace Supabase with a fake database in memory that follows the same access rules as `setup.sql`, and they block any request to your real Supabase project. Each test starts with an empty database.

**The date is frozen** at Wednesday, Nov 4, 2026, 8:00 PM New York time, so "this week" is always Mon Nov 2 to Sun Nov 8, whatever day you run them.

## One-time setup (Windows)

1. Install **Node.js** (the LTS version) from [nodejs.org](https://nodejs.org). Accept the defaults.
2. Open a terminal in this folder. In VS Code: **File → Open Folder** → `care-hours`, then **Terminal → New Terminal**, and type `cd tests`.
3. Install Playwright and its browsers:
   ```
   npm install
   npx playwright install chromium webkit
   ```

## Running the tests

| Command | What it does |
| --- | --- |
| `npm test` | All tests in Chrome's engine, at a phone-sized window |
| `npm run test:iphone` | All tests in Safari's engine with an iPhone screen |
| `npm run test:all` | Both |
| `npm run test:ui` | Opens Playwright's test window, where you can run one test and watch each step |
| `npm run report` | Opens the report from the last run, with screenshots and traces of anything that failed |

To run one file or one test: `npx playwright test specs/schedule.spec.js`, or `npx playwright test -g "time off wins"`.

## What's covered

| File | What it checks |
| --- | --- |
| `specs/shifts.spec.js` | Clocking in and out, required patient, overnight and missed shifts, edit/delete, CSV, old saved data |
| `specs/sync.spec.js` | Emailed-code sign-in, uploading, two devices, deletes reaching every device, offline changes, sign out |
| `specs/sharing.spec.js` | Sharing a patient, the payer's Shifts and Caregivers views, hours by caregiver, removing a share, payers can't edit |
| `specs/schedule.spec.js` | Repeating and one-time shifts, time off, Skip this day, clock in from the schedule, sync, what payers see |
| `specs/offline.spec.js` | The app opens and works with no connection |
| `unit/schedule-math.spec.js` | The schedule math on its own, including the night the clocks fall back |

## How it fits together

| File | What it is |
| --- | --- |
| `playwright.config.js` | Settings: browsers, time zone, and the small web server below |
| `serve.js` | Serves the app folder at http://localhost:4173 while the tests run |
| `support/fixtures.js` | `openApp()` opens the app like a separate phone, plus helpers such as `signIn`, `addShift`, `share`, `addToSchedule` |
| `support/fake-db.js` | The fake database and its access rules |
| `support/supabase-fake-client.js` | Loaded into the app instead of the real Supabase library. Sign-in code `123456` always works |

**When you change the app:** if a test fails, the report shows a screenshot and a step-by-step trace. Either the app has a bug, or the app changed on purpose and the test needs updating to match.

**When you change `setup.sql`:** make the same rule change in `support/fake-db.js`, so the tests keep matching the real database.
