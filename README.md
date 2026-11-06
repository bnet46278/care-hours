# Care Hours

A simple time clock and schedule for caregivers. Clock in and out, add missed shifts, plan repeating shifts and time off, see scheduled vs worked hours, and download a timesheet (CSV).

It works two ways:

- **On this device only (default).** No sign-in. Shifts are saved in the phone's browser, and nobody else can see them.
- **With online sync (optional).** Sign in with an emailed code to back up shifts, use them on more than one device, and share a patient's shifts, read-only, with whoever pays for that patient's care.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page layout. Loads everything else |
| `styles.css` | Colors, fonts and spacing, with a dark theme |
| `js/util.js` | Small helpers: dates, times, formatting |
| `js/state.js` | What the app knows right now: shifts, schedule, who's signed in, which screen is showing |
| `js/schedule.js` | Schedule math: turns repeating shifts and time off into real hours (no screen code) |
| `js/storage.js` | Saving on the device and syncing with the online database |
| `js/sharing.js` | Signing in, sharing patients, loading what's shared with you |
| `js/messages.js` | The Messages tab and the Text button |
| `js/shifts-view.js` | The Shifts screen: clock, week summary, shift list, CSV |
| `js/schedule-view.js` | The Schedule screen and the schedule payers see |
| `js/app.js` | Tabs, drawing the page, and starting the app (loaded last) |
| `config.js` | Your Supabase project settings. Empty means online sync is off |
| `setup.sql` | Creates the database tables and the access rules |
| `sw.js` | Lets the app open without internet. Bump `VERSION` whenever you change a file, and list any new file in `FILES` |
| `manifest.json`, `*.png` | The home-screen name and icon |
| `tests/` | Automated Playwright tests. See `tests/README.md` |

The scripts are plain browser scripts with no build step. They share one set of names, so the order they're listed in `index.html` matters: helpers first, `app.js` last.

## Turning on online sync (one time, about 20 minutes)

### 1. Create the database
1. Sign up at [supabase.com](https://supabase.com) (free) and click **New project**. Pick a region near you and save the database password somewhere safe. The app never needs it.
2. When the project is ready, open **SQL Editor**, click **New query**, paste in everything from `setup.sql`, and click **Run**. You should see "Success. No rows returned."

### 2. Set up sign-in emails
1. Go to **Authentication → URL Configuration** and set **Site URL** to your GitHub Pages address, for example `https://yourname.github.io/care-hours/`.
2. Go to **Authentication → Emails → Templates** (or Email Templates). In both the **Magic Link** and **Confirm signup** templates, add this line so the email includes the code people type into the app:
   `<p>Your Care Hours code is: <strong>{{ .Token }}</strong></p>`
3. **Before anyone else can sign in**, connect your own email service under **Authentication → Emails → SMTP Settings**. Supabase's built-in email only sends to members of your Supabase team, and only about 2 an hour, so it's fine for testing with your own email and nothing more. Free options include Brevo, or Gmail with an app password.

### 3. Connect the app
1. Go to **Project Settings → API Keys** (or **API**). Copy the **Project URL** and the **anon public** or **publishable** key.
2. Paste them into `config.js`. Both are meant to be public and are safe on GitHub. **Never** use the `service_role` or secret key.
3. In `sw.js`, bump `VERSION` (for example `care-hours-v3`), then commit and push.

### 4. Try it
1. Open your site, scroll to **Back up, sync and share**, and sign in with your email.
2. Under **Share a patient**, enter the patient's name and the payer's email.
3. They open the same site and sign in with that email. Their **Shifts** tab shows only that patient's shifts, and the **Caregivers** tab lets them pick a caregiver. They can't change anything.

## Tabs

- **Caregivers:** **Shifts** (clock in and out, log missed shifts) and **Schedule** (repeating shifts, one-time shifts, time off).
- **Payers:** **Shifts** (every shift shared with them, from all caregivers) and **Schedule** (what's scheduled), with a picker at the top for all caregivers or one. Payers can't change anything.
- **Messages** (both sides, once a patient is shared): a conversation with each person you share with, or who shares with you. New messages appear right away while the app is open, and the tab shows how many are unread. Messages need a connection; one that can't be sent stays in the box. A payer who hasn't signed in to Care Hours yet is listed but can't get messages until they do.
- **Text button:** anyone can add a mobile number on their account card. The people they share with then get a **Text** button in Messages that opens the phone's own Messages app, addressed to them.
- **Time off wins.** A scheduled shift during the caregiver's time off is skipped and doesn't count as scheduled. **Skip this day** on a repeating shift adds time off for just that shift. Payers see time off only as "unavailable".

## Testing

The `tests` folder has automated Playwright tests that use the app like a caregiver and a payer would, against a fake database (never your real one). See `tests/README.md` for setup. Short version: install Node.js, then in the `tests` folder run `npm install`, `npx playwright install chromium webkit`, and `npm test`.

## How the data is stored

- Every change is saved on the device first, then uploaded. If there's no internet, changes wait and upload later.
- Deleted shifts are kept as hidden markers, so the delete reaches every device.
- Every shift has a patient. Sharing is per patient: a payer sees only shifts whose patient name matches what you shared. Capitals and extra spaces don't matter ("Mom" and " mom" match), but spelling does.
- Access rules in the database (row-level security) make sure each person can change only their own shifts, and payers can read only the patients shared with them.
- Free Supabase projects pause after about a week with no use. Opening the dashboard wakes them.
- Only the sender and the recipient can read a message. Messages can't be edited or deleted, and only the recipient can mark one read. A mobile number is seen only by the people you share with (or who share with you).
- Notes and messages may contain health details. Supabase's free plan isn't set up for HIPAA, so keep notes general if that matters for your situation.

## Updating the database

If you change `setup.sql` (or pull a new version of it), run the whole file again in the Supabase SQL Editor. It's safe to run more than once.

Version 4 of `setup.sql` adds messages and mobile numbers. Until you run it, the app works as before and the Messages tab stays hidden.

- **Version 3 (schedule):** adds the schedule table. Run the whole file again; nothing existing is changed.
- **Version 2 (per-patient sharing):** shares made with version 1 covered all of a caregiver's hours. Running version 2 removes those shares, so share again by patient.
