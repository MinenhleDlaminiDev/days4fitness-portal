# Critical End-To-End Test Checklist

Run these before a production release.

## Authentication

- Sign up with a Gmail account.
- Sign out.
- Sign in with Google.
- Sign in with local fallback credentials in development.
- Confirm private pages redirect to login when signed out.

## Client And Package Flow

- Add a new client.
- Select preferred training days and times.
- Create a package.
- Add a payment.
- Reverse a payment.

## Booking And Schedule Flow

- Approve a preferred session.
- Reject a preferred session.
- Confirm approved sessions appear on the schedule.
- Book a manual session.
- Reschedule a session.
- Cancel a session.
- Book a replacement session.

## Outcome Flow

- Mark a session complete.
- Mark a session no-show.
- Confirm package credits update correctly.

## Dashboard Flow

- Confirm today's sessions display.
- Confirm active credits exclude expired packages.
- Confirm payments this month excludes future-dated payments.
- Confirm unpaid and expiring package cards link to the correct client.
