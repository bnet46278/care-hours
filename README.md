# Care Hours

A simple time clock for caregivers. Clock in and out, add missed shifts, see weekly hours, and download a timesheet (CSV).

It works two ways:

- **On this device only (default).** No sign-in. Shifts are saved in the phone's browser, and nobody else can see them.
- **With online sync (optional).** Sign in with an emailed code to back up shifts, use them on more than one device, and share a patient's shifts, read-only, with whoever pays for that patient's care.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app: screens, styles, and code |
| `config.js` | Your Supabase project settings. Empty means online sync is off |
| `setup.sql` | Creates the database tables and the access rules |
| `sw.js` | Lets the app open without internet. Bump `VERSION` whenever you change a file |
| `manifest.json`, `*.png` | The home-screen name and icon |

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
3. They open the same site, sign in with that email, and see a **Shared with me** tab with only that patient's shifts. They can't change anything.

## How the data is stored

- Every change is saved on the device first, then uploaded. If there's no internet, changes wait and upload later.
- Deleted shifts are kept as hidden markers, so the delete reaches every device.
- Every shift has a patient. Sharing is per patient: a payer sees only shifts whose patient name matches what you shared. Capitals and extra spaces don't matter ("Mom" and " mom" match), but spelling does.
- Access rules in the database (row-level security) make sure each person can change only their own shifts, and payers can read only the patients shared with them.
- Free Supabase projects pause after about a week with no use. Opening the dashboard wakes them.
- Notes may contain health details. Supabase's free plan isn't set up for HIPAA, so keep notes general if that matters for your situation.

## Updating the database

If you change `setup.sql` (or pull a new version of it), run the whole file again in the Supabase SQL Editor. It's safe to run more than once.

- **Version 2 (per-patient sharing):** shares made with version 1 covered all of a caregiver's hours. Running version 2 removes those shares, so share again by patient.
