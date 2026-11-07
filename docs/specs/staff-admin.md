# Staff admin panel

Status: draft for review, 7 November 2026.

Obiter staff need one place to run the service: let eligible people in, see who
is using what, read feedback and check that the system is healthy. Today each
of these needs a database shell on production. This spec describes a staff-only
area of the app that replaces that.

It is not the organisation admin area. Organisation admins manage their own
organisation (members, invites, update policy). Staff see across organisations,
but only what running the service needs.

## Who can open it

- Staff are all active members of one organisation: the Obiter organisation.
  The API reads its id from `OBITER_STAFF_ORGANISATION_ID`, which lives in the
  production secret store. The id never appears in source, tests, docs or
  responses. When the variable is unset, nobody is staff.
- The match is by id, never by name, so an organisation someone else names
  "Obiter" grants nothing. Knowing the id grants nothing either: being staff
  needs real membership, which only the Obiter organisation's admins can give.
- The API decides on every request. Every staff route checks the signed-in
  user's membership of that organisation and answers 404 to anyone else, so the
  area's existence is not revealed.
- `/api/me` gains `isStaff: boolean`. The app shows a "Staff" item at the bottom
  of the sidebar only when it is true. Hiding the item is convenience, not
  security.
- Membership of the Obiter organisation is managed like any other organisation,
  by its admins. Adding someone there makes them staff, so the organisation's
  invite screen says so.
- Staff accounts need a second factor (an authenticator app) before testers
  from outside Obiter arrive. Staff routes refuse a session that has not passed
  it. Staff sessions last at most 12 hours.

## Privacy rules

These hold on every screen and in every API response under `/api/staff`.

- Never matter content: no matter names, document names or text, comments,
  search queries, agent prompts or outputs, or redaction values.
- Counts and dates may be shown per organisation and per user.
- People's names and email addresses are shown only where a staff task needs
  them: access review, the user list and feedback.
- Verification stores the decision only, never evidence (the existing access
  rule). A reviewer's notes are not stored.
- Every staff action that changes something writes an audit record with action
  `staff.*`, the staff user, the target and the request id.

## Screens

The area lives at `/staff`, with its own left-hand list of sections. It is one
lazily loaded route, so it adds nothing to what other users download.

### 1. Overview

One screen to open each morning:

- people waiting for access review, and the oldest wait;
- unread feedback;
- new accounts and new organisations in the last 7 and 30 days;
- active users today, this week and this month (signed in and did something);
- the deployed build commit and when it was deployed;
- a link to the error tracker.

Each figure links to the screen behind it.

### 2. Access review

Requests in `pending_review`, grouped by email domain, oldest first. For each
domain:

- the organisation names applicants typed, how many people are waiting, their
  categories and countries, and when the first request arrived;
- links that open the public registers to check by hand: the SRA, the Bar
  Standards Board, the Law Society of Scotland, the Law Society of Northern
  Ireland and Companies House, pre-filled with the organisation name where the
  site allows.

Actions:

- **Approve organisation:** adds the domain to the verified organisations list,
  optionally linked to an existing Obiter organisation. It verifies every
  waiting request on that domain (method `manual_review`, verifier the staff
  user's id) and sends each person the "You're in" email with a fresh link to
  set up their account.
- **Decline:** declines the waiting requests on that domain and sends a short,
  neutral email. The domain is not blocked; a later request comes back to the
  queue.
- **Approve one person only,** without verifying the domain. This is for a
  barrister at a shared-domain chambers, or a sole practitioner.

When a request enters `pending_review`, the API emails the address in
`OBITER_STAFF_ALERT_TO` with the domain and the organisation name, at most once
an hour per domain. The confirmation page's "usually within one working day"
promise depends on this alert.

A **Decisions** tab lists past decisions: domain, decision, who made it and
when.

### 3. Organisations

A list of organisations with:

- verified domains;
- member count;
- when the organisation was created;
- when it was last active;
- matters and documents created, as counts only.

Its detail page shows:

- members (name, email, role, last active);
- verified domains;
- the update policy;
- recent staff actions on the organisation.

Actions:

- add or remove a verified domain;
- revoke a domain. People already verified through it keep access until their
  verification expires, unless they are suspended.

### 4. Users

Search by email or name. Each row shows:

- the organisation;
- the verification category, method and expiry;
- when the account was created and when the user was last active;
- the number of active sessions.

Actions:

- **Suspend:** signs the user out everywhere and blocks sign-in. This is how a
  licence breach is handled.
- **Restore** a suspended user.
- **Resend** the verification email.
- **Extend verification** by 12 months, recorded as a manual decision.

### 5. Usage

Aggregates only, computed from records the product already keeps. Nothing new
is tracked in the browser.

- Weekly active users, and new accounts per week, for the last 12 weeks.
- Feature use per week:
  - documents opened and saved;
  - matters created;
  - Redact runs;
  - Verify runs;
  - agent runs;
  - sources saved from search.
- The same figures per organisation, as a table sortable by any column.
- Retention: of the people who joined in a given week, how many were active in
  each later week.

### 6. Feedback

The in-app feedback messages:

- newest first, filterable by kind (problem, idea, question);
- each with the sender, the organisation, the path, the app version and the
  platform.

Actions: mark a message handled, or reopen it. Handled messages leave the
default view.

### 7. System

- Corpus:
  - the number of judgments and Acts;
  - the newest judgment date;
  - the last ingest run and its result.
- Search: the document count in each search index, and whether it matches the
  corpus.
- Background jobs: Redact detection and Verify runs that are queued, running or
  failed in the last 24 hours.
- Database: the latest applied migration.
- The deployed web, desktop and API versions.

### 8. Staff audit

All `staff.*` audit records, filterable by staff member and action. They are
read-only.

## Emails

All use the shared email layout.

- **You're in:** "Your access to Obiter is approved", with a button to set up
  the account. The link lasts 7 days.
- **Not approved:** a short, neutral explanation that Obiter is limited to
  legal professionals, law students and academic researchers in the UK, with a
  reply-to address.
- **Staff alert:** a new organisation is waiting for review, linking to the
  queue.

## Build order

1. **Access (unblocks testers):**
   - the staff check and `isStaff`;
   - the sidebar item and the `/staff` shell;
   - access review with approve, decline and approve one person;
   - the decisions list;
   - the three emails and the staff alert;
   - an authenticator-app second factor for staff, required by every staff
     route.
2. **Insight:** the overview, usage and feedback screens.
3. **Control:**
   - organisations and users, with suspend and restore, and domain revocation;
   - system;
   - staff audit.

Each step ships as one API change and one app change, with tests written first
and an end-to-end spec that signs in as staff and as a non-staff user. A
non-staff user must get 404 from every staff route.

## Decisions

Recorded 7 November 2026:

1. Every member of the Obiter organisation is staff, not only its admins.
2. A second factor is required for staff before testers from outside Obiter
   arrive.
3. Suspension is per person; it never affects an organisation's matters.
