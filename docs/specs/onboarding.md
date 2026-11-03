# Access requests and onboarding

Status: draft for review, 3 November 2026.

Obiter serves Find Case Law judgments under a licence that limits who may use them. Every account must belong to a verified **law student**, **legal practitioner** or **academic researcher**. Open self-service sign-up cannot meet that, so access starts with an enquiry that Obiter reviews.

This spec covers the whole route from first visit to a working account: the enquiry, Obiter's review, account set-up, first-run onboarding for organisation admins and for individual users, inviting colleagues, and re-verification.

## Principles

- **No account without a decision.** Nobody gets a session until Obiter has approved their eligibility. Until then the API stores the enquiry and nothing else.
- **Evidence, not trust.** Every approval records what was checked and who checked it, so the licence position can be shown later.
- **Fast for real lawyers.** A practitioner with a regulator number should be approved within one working day. The form asks only for what the check needs.
- **One account per person.** People are verified individually, including members of a firm.
- **Data minimisation.** Verification data is kept only as long as the licence needs it, and never used for anything else.

## Who is eligible, and how we check

| Applicant                                                                          | They give                                                                                                                    | We check                                                                                                             | Re-verify                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Solicitor, barrister, chartered legal executive, or another regulated practitioner | Name, work email, regulator and number (SRA, BSB, CILEx Regulation, or a Scottish or Northern Irish regulator), organisation | The number against the regulator's public register; the name matches; the work email domain matches the organisation | Every 12 months, against the register             |
| Trainee, paralegal or other legal staff at a firm                                  | As above, plus the supervising practitioner's name                                                                           | Organisation verified; the supervising practitioner confirms by email or is the organisation's verified admin        | Every 12 months                                   |
| Law student                                                                        | Name, university email, institution, course, expected end date                                                               | The university email (by a confirmation link) and that the institution teaches law                                   | Every academic year, and at the expected end date |
| Academic researcher                                                                | Name, institutional email, institution, role, a public staff page or ORCID                                                   | The institutional email and the public staff page or ORCID                                                           | Every 12 months                                   |

**Open question:** confirm against the licence wording whether trainees, paralegals and other legal staff count as "legal practitioners". If they don't, that row is removed and those people can't be invited.

## 1. The enquiry (public, no account)

**Route:** `/request-access` replaces `/sign-up`. `/sign-up` redirects to it, and every "Sign up" link becomes "Request access".

**UI:**

- A short page that says why: "Obiter is available to legal practitioners, law students and academic researchers. Tell us who you are and we'll confirm your access, usually within one working day."
- Step 1: choose one of four cards: _Practitioner_, _Legal staff at a firm_, _Law student_, _Academic researcher_.
- Step 2: only the fields for that choice (see the table). Regulator number fields validate their format inline.
- Step 3: an **organisation** choice:
  - _Just me_: an individual account.
  - _My organisation_: the applicant asks to set up an organisation and becomes its admin. This asks for the organisation's name, its SRA or other firm number if it has one, and its email domain(s).
- Tick boxes: accept the tester terms and the privacy notice, and confirm the details are true.
- After submit: a confirmation page ("We've received your request. We'll email you at …"), plus an email with the same message. A second request from the same email address doesn't duplicate; it says one is already pending.

**Abuse controls:** rate-limit by IP and by email, use a bot check (Cloudflare Turnstile or a honeypot field), and check the email domain has MX records.

## 2. Obiter's review queue (internal)

**Who:** Obiter staff with a new **platform reviewer** role. It is separate from organisation roles, and no customer can hold it.

**Route:** `/admin/access-requests`, shown only to platform reviewers.

**UI:**

- **The list:** tabs _New_, _Waiting on applicant_, _Approved_, _Declined_. Columns: name, category, organisation, submitted, waiting time. Oldest first. The tab badges show counts.
- **The detail view:**
  - the applicant's answers;
  - **check helpers**: a link that opens the regulator's register search pre-filled with the number, the domain's MX and website, and the staff page link;
  - a **checklist** the reviewer ticks: identity matches the register, email domain matches the organisation, and so on;
  - a notes field.
- **Actions:**
  - **Approve**: creates the account, plus the organisation if one was requested, and sends the welcome email.
  - **Ask for more**: sends the applicant a templated email with one free-text line and moves the request to _Waiting on applicant_. The applicant replies through a link back to their request.
  - **Decline**: requires a reason chosen from a list (not eligible, could not verify, duplicate, other) and sends a polite email that says how to appeal.
- Every action writes an audit row (`access_request.approved` and so on) with the reviewer, the checklist state and the evidence links. This is the licence record.

## 3. Account set-up (after approval)

- The welcome email carries a single-use set-up link, valid for 7 days, to `/welcome?token=…`.
- `/welcome`:
  - the applicant's name and email, prefilled and locked;
  - a password, or a magic link only (which matches today's sign-in);
  - display name and initials, which are used on comments and tracked changes;
  - optionally, the jurisdiction and practice areas they work in, which set the default search filters.
- An expired link shows "Ask for a new link", which sends one. It doesn't need a new review.
- Signing in lands on the first-run checklist below.

## 4. First-run onboarding

A **Getting started** card on Home is the checklist. It shows a progress ring, and each item opens the place where the step happens. The user can dismiss it, but it reopens from the Help menu. It is stored per user, so it persists across devices.

### Individual users (practitioner, student, researcher, or an invited member)

1. **Complete your profile**: display name and initials, used on comments and tracked changes.
2. **Run your first search**: opens Search with a sample query that suits their jurisdiction.
3. **Create a matter**: one click creates a sample matter called "Getting started", marked as sample data.
4. **Open or upload a document**: a synthetic sample is provided. It never contains real client data.
5. **Check a document's citations with Verify**: runs on the sample.
6. **Redact a document**: on the sample, ending with the secure PDF.
7. **Install the desktop app** (optional): only shown on the web.
8. **Tell us how it went**: opens the feedback channel.

Students see Search, Verify and the editor first, and Redact last.

### Organisation admins

The individual checklist, then:

1. **Check your organisation details**: the name, the email domains that limit who can be invited, and the regulator number.
2. **Invite colleagues**: see section 5.
3. **Set organisation settings**: S10 (whether former members are named on review records), and the default matter sharing.
4. **Read how access works**: a short page covering who can see what, how matters are shared, what happens when someone leaves (S9), and where the audit trail is.

The admin's card also shows **pending invites** and **members needing re-verification**.

## 5. Inviting colleagues

- Settings → Members → **Invite** takes the email address, role and category (practitioner, legal staff, student or researcher).
  - **Practitioners** must give a regulator number, which is checked the same way as in section 1.
  - **Legal staff** are attested by the inviting admin, who must themselves be a verified practitioner.
  - The email must be at one of the organisation's domains. Any other domain needs Obiter review.
- **Who reviews:** an invite for a practitioner whose number matches the register, at an organisation domain, is approved **automatically**. Anything else goes to Obiter's review queue, and the invitee sees "Your access is being confirmed".
- The invite email links to `/welcome` as in section 3. The invitee completes set-up and gets the individual checklist.
- **Seats:** for testers, no limit. Billing comes later.

## 6. Re-verification

- Thirty days before a person's verification expires, both they and their admin get an email and see a banner: "Confirm your access by …".
- **Practitioners** are re-checked against the register automatically where possible. Otherwise they re-enter their number.
- **Students** confirm their university email again. After their expected end date they can move to _Practitioner_ or _Researcher_, or lose access.
- **If verification lapses:** the account becomes **read-only**. They can sign in, see and export their own matters, and request re-verification. They can't search or use judgments. Their matters stay with the organisation (S9).

## 7. Data and records

- Verification data (category, regulator number, institution, the evidence links and the reviewer's checklist) is kept for the account's life plus [period, which the licence and the privacy notice set]. It is then deleted, and the audit row keeps only the decision.
- The privacy notice and the DPIA list this processing and its legal basis: compliance with the licence and legitimate interests.
- Declined requests are deleted after 90 days.

## Build order

1. **Close open sign-up:** `/sign-up` redirects to `/request-access`, and the API refuses account creation without an approved request or an invite. This ships first, before the tester launch, even if the review queue is basic.
2. The enquiry form and Obiter's review queue with approve, ask for more and decline, with audit.
3. `/welcome` set-up and the welcome email.
4. The first-run checklist (individual, then admin) and the sample matter and document.
5. Invites with category checks and automatic approval for practitioners.
6. Re-verification and the lapsed read-only state.

## Open questions

1. Does the licence count trainees, paralegals and other legal staff as practitioners? (This decides section 5.)
2. How long must verification evidence be kept? (Section 7.)
3. Are non-UK practitioners and students eligible, for example those regulated in Ireland or the EU?
4. Who reviews requests at first, and who covers when they are away?
