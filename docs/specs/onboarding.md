# Access requests and onboarding

Status: draft for review, 3 November 2026.

Obiter serves Find Case Law judgments under a licence that limits use to **verified legal professionals, academic researchers and law students**. Find Case Law covers England and Wales, so access is limited to people in those professions **in the United Kingdom**: England and Wales, Scotland, or Northern Ireland. Scotland and Northern Ireland are included because their lawyers appear in the UK Supreme Court. Open self-service sign-up cannot meet this, so access starts with an enquiry that Obiter verifies, automatically wherever possible.

This spec covers the whole route from first visit to a working account: the enquiry, automatic verification with a small manual fallback, account set-up, first-run onboarding for organisation admins and for individual users, inviting colleagues, and re-verification.

## Principles

- **No account without a verification decision.** Nobody gets a session until they are verified.
- **Verify, don't collect.** Obiter records the decision, never the evidence. It doesn't keep regulator numbers, staff-page links, documents or reviewers' notes. A verification record holds only the category, the method, when it was verified, when it expires, and who verified it ("automatic" or a reviewer).
- **Automatic by default.** Most applicants are verified by proving control of an institutional email address. A person reviews only the cases that can't be.
- **Verify a firm once.** After one person at a firm or chambers is verified, colleagues on the same email domain are verified automatically.
- **One account per person.**

## Who is eligible

| Category            | Who                                                                                                                                                            | Must be                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Legal professional  | Solicitors, barristers, advocates, chartered legal executives, licensed conveyancers, trainees, pupils, paralegals and other legal staff, and in-house lawyers | Working in legal services in the UK |
| Law student         | Undergraduate, postgraduate, LPC, SQE, BPTC/BTC or diploma students                                                                                            | Enrolled at a UK institution        |
| Academic researcher | Academic staff and research students working on law                                                                                                            | At a UK institution                 |

People outside the UK are not eligible.

## How verification works

Every route starts with a **confirmation link sent to the address the applicant gives**. Clicking it proves they control that address. What the address shows decides the rest:

| Applicant's email                                                                                                                           | Result                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A UK university domain (`.ac.uk`, plus a maintained list of UK universities using other domains), and the category is student or researcher | **Verified automatically**                                                                    |
| A domain on Obiter's **verified organisations** list (a firm, chambers or legal department already verified)                                | **Verified automatically**, as a legal professional at that organisation                      |
| A domain we don't know, but plausibly a UK legal organisation (not a free webmail provider, has MX records)                                 | **Manual check**, see below. Approving it adds the domain to the verified organisations list. |
| Free webmail (Gmail, Outlook.com, iCloud and so on)                                                                                         | Refused: "Please use your work or university email address"                                   |
| Not UK                                                                                                                                      | Refused: "Obiter is available to legal professionals, researchers and students in the UK"     |

A verified organisation's domain also covers its non-legal staff, so every applicant on such a domain declares that they work in a legal role. An admin makes the same attestation for each colleague they invite.

Students and researchers both use university addresses, so the category they choose is a self-declaration: "I am studying law" or "I research law". The confirmation link goes to that address, and the terms make a false declaration grounds to close the account.

### The manual check (the only part a person does)

The manual check happens **once per new organisation, not once per person**. A reviewer looks at the organisation's public footprint: its website and, where it applies, its entry on the SRA, BSB, Law Society of Scotland, Faculty of Advocates, Law Society of Northern Ireland, Bar of Northern Ireland or CILEx public register. They then decide in one click whether this is a UK legal organisation and the applicant plausibly works there.

- Approving adds the domain to the **verified organisations** list, so everyone after them at that firm is verified automatically.
- The reviewer opens the public register in a separate tab and types nothing back into Obiter. Only the decision is stored.
- Expect a handful of these a week at most. A firm with 50 users costs one check.

## 1. The enquiry (public, no account)

**Route:** `/request-access` replaces `/sign-up`. `/sign-up` redirects to it, and every "Sign up" link becomes "Request access".

**UI:**

- One short page: "Obiter is available to legal professionals, law students and academic researchers in the UK. Use your work or university email and we'll confirm your access, usually straight away."
- Fields: name, **work or university email**, category (three cards), country (England and Wales, Scotland, or Northern Ireland), and organisation name. It doesn't ask for regulator numbers.
- An option to **set up an organisation**: the applicant becomes its admin, and the organisation's email domain is the one they verified with.
- Tick boxes: accept the tester terms and the privacy notice, and confirm the details are true.
- After submit: "Check your inbox: we've sent a link to …". Clicking the link verifies the applicant automatically and goes straight to set-up, or, for an unknown organisation, shows "Thanks, we're confirming your organisation. We'll email you, usually within one working day."
- Inline errors for webmail and non-UK addresses, before submitting.

**Abuse controls:** rate-limit by IP and by email, use a bot check (Cloudflare Turnstile or a honeypot field), and check the domain has MX records.

## 2. Verified organisations and the review screen (internal)

- A new **platform reviewer** role, held by Obiter staff only, never by a customer.
- `/admin/organisations`:
  - **Pending**: unknown domains waiting for a check, each with links to its website and to a search of each public register.
  - **Verified**: the domains, the organisation name and the date verified.
  - **Blocked**: domains refused, with a reason category.
- Actions: **Verify organisation** (adds the domain and lets every waiting applicant from it through), **Decline**, and **Revoke**. Revoking moves everyone on that domain to re-verification.
- Every decision writes an audit row (`organisation_domain.verified` and so on) with the reviewer and the reason category. No evidence is stored.
- The UK university domain list is shipped data, refreshed from a public list of UK higher-education institutions. It is reviewed in PRs like any other data change.

## 3. Account set-up

- After the confirmation link, the applicant lands on `/welcome` to set a password or choose magic links, a display name and initials (used on comments and tracked changes), and optionally the jurisdiction and practice areas that set their default search filters.
- Applicants waiting on a manual check get the same link by email once the check is approved. The link is valid for 7 days, and an expired link offers a new one without another review.

## 4. First-run onboarding

A **Getting started** card on Home is the checklist. It shows a progress ring, and each item opens the place where the step happens. The user can dismiss it, but it reopens from the Help menu. It is stored per user.

### Individual users

1. **Complete your profile**: display name and initials.
2. **Run your first search**: opens Search with a sample query.
3. **Create a matter**: one click creates a sample matter called "Getting started", marked as sample data.
4. **Open or upload a document**: a synthetic sample is provided. It never contains real client data.
5. **Check a document's citations with Verify**: runs on the sample.
6. **Redact a document**: on the sample, ending with the secure PDF.
7. **Install the desktop app** (optional): shown on the web only.
8. **Tell us how it went**: opens the feedback channel.

Students see Search, Verify and the editor first, and Redact last.

### Organisation admins

The individual checklist, then:

1. **Check your organisation details**: the name, and its verified email domain(s). An extra domain needs another check.
2. **Invite colleagues**: see section 5.
3. **Set organisation settings**: S10 (whether former members are named on review records), and the default matter sharing.
4. **Read how access works**: who can see what, how matters are shared, what happens when someone leaves (S9), and where the audit trail is.

The admin's card also shows pending invites and members due for re-verification.

## 5. Inviting colleagues

- Settings → Members → **Invite** takes the email address and role.
- The inviting admin confirms the invitee works in a legal role (legal professional, trainee, pupil, paralegal or other legal staff).
- An address on one of the organisation's **verified domains** is verified automatically when the invitee clicks the link. That is the same rule as section 1.
- An address on any other domain follows section 1. Webmail is refused, and an unknown domain gets a manual organisation check.
- Seats: for testers, no limit. Billing comes later.

## 6. Re-verification

- Every **12 months**, and for students at each academic year start (1 October), Obiter sends a new confirmation link to the person's institutional address. Clicking it re-verifies them, automatically.
- If the link isn't clicked within 30 days, for example because they left the firm or graduated and lost the address, the account becomes **read-only**. They can sign in, see and export their own matters, and change to a new work or university email to re-verify. They can't search or use judgments. Matters stay with the organisation (S9).
- Revoking a verified organisation sends every member on that domain to this flow straight away.

## 7. Data

- Stored per person: category, country, method (`university_domain`, `verified_organisation`, `organisation_check`), verified at, expires at, and verifier (`automatic` or a reviewer). Nothing else.
- Stored per organisation domain: domain, organisation name, status, decided at, and decided by.
- Requests that are never confirmed are deleted after 30 days. Declined requests are deleted after 30 days; the domain's blocked status keeps only the reason category.
- The privacy notice and the DPIA describe this processing; its legal basis is compliance with the licence.

## Build order

1. **Close open sign-up.** `/sign-up` redirects to `/request-access`, and the API refuses to create an account without a verified request or an invite to a verified domain. This ships before the tester launch.
2. The enquiry form, the confirmation link, automatic verification (the UK university list plus verified organisation domains), and webmail and non-UK refusal.
3. `/welcome` account set-up.
4. The `/admin/organisations` review screen for unknown domains, with audit.
5. The "Getting started" checklists, with the sample matter and document.
6. Invites tied to verified domains.
7. Re-verification and the read-only lapsed state.

## Open question

1. Should people verified in Scotland or Northern Ireland see **all** judgments, or only UK Supreme Court judgments? This draft gives them everything, which is the simplest. Limiting them would mean filtering by court for each user in Search and Verify.
