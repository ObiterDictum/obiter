# Review Score Calibration

Use the score to communicate merge readiness and residual risk. It does not replace the verdict.

## Scale

- **95-100**: Approve. Fully verified, no material findings.
- **90-94**: Approve. Only low/nit issues or tiny cleanup.
- **80-89**: Comment or approve. No high-risk issue, but some medium concern or test gap.
- **70-79**: Not ready. Medium correctness/architecture gaps or meaningful uncertainty.
- **60-69**: Request changes. One contained high issue or serious missing verification.
- **50-59**: Request changes. Multiple high issues, risky data/security behavior, or broad uncertainty.
- **30-49**: Blocked. Blocker-class issue: data loss, isolation break, broken build, bad migration, secret/privacy risk, or legal-critical incorrectness.
- **0-29**: Severe. Active leak/exposure, destructive migration, or fundamentally unsafe design.

## Caps

- Any Blocker caps the score at **49**.
- Any High finding caps the score at **69** unless the high issue is purely missing evidence and inspected code is otherwise sound.
- Missing key verification caps the score at **89**.
- Unmapped sensitive internal flow caps the score at **79**.
- Uncertain security/data/isolation gate for sensitive code caps the score at **69** and prevents `Approve`.
- Broken build, typecheck, or test suite caused by the PR caps the score at **59** unless the failure is unrelated and proven.

## Decision Alignment

- `Approve`: normally 90-100, or 80-89 only when residual issues are explicitly non-blocking and verification is adequate.
- `Comment`: normally 80-89 when the change may be mergeable but evidence or minor fixes should be considered.
- `Not ready`: normally 70-79 when uncertainty or medium issues prevent approval but no high/blocker issue is established.
- `Request changes`: normally 0-69 when blockers, high findings, broken verification, or sensitive uncertainty exists.

When a verdict and score seem to disagree, revise the score or explain the exceptional reason.
