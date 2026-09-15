# Symptom Tracker

A private, local symptom and medication tracker for autoimmune conditions — brain fog, migraines, numbness, and anything else you want to track — plus dose reminders for your medications.

## Run it

Service workers (needed for install + notifications) require the app to be served over `http://` or `https://`, not opened as a plain file. From this folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Install as an app

On your phone or desktop browser, use "Add to Home Screen" / "Install App" from the browser menu once the page is open. This lets it run in its own window and improves how reliably reminders fire in the background.

## Reminders — what to expect

There's no backend server here — everything is local to your device, on purpose, since this is health data. That means reminders work by checking your medication schedule while the app is open or running in the background as an installed app. If your phone fully closes the app for a long stretch, the OS may pause the checks; reopening the app immediately shows anything overdue on the dashboard as a fallback. For a fully closed-app guarantee (true push notifications), you'd need a small backend server — happy to add that later if this isn't reliable enough for you.

## Your data

Stored only in this browser's local storage. Nothing is sent to any server. Use **Settings → Export backup** regularly, and especially before clearing browser data, switching browsers, or switching devices. **Import backup** restores from that file.

Photos attached to symptom entries are stored separately, in this browser's IndexedDB, and are **not** included in the exported backup yet — clearing browser data will lose them.

## What you can track

- **Symptoms** — type, severity (1–10), possible triggers, notes, and an optional photo (rash, swelling, anything visible).
- **Daily check-in** (from the Symptoms tab) — fatigue, morning stiffness duration, sleep, mood, and a short function/impact questionnaire (dressing, gripping, stairs, getting through the day).
- **Flares** (from the Symptoms tab) — mark onset, track peak severity and notes while it's ongoing, and close it out with a recovery date once it's over.
- **Medications** — flexible day/week/month/year schedules with reminders.
- **Insights** — 30-day symptom and trigger charts, an 8-week severity trend, and a flare calendar.
