# Security Policy

velox-scheduler holds an operator secret key and signs transactions that move
real funds on Stellar. Treat anything that could leak that key, forge a
transaction, or let the daemon execute a payment it should not, as a security
issue.

## Reporting a vulnerability

**Do not open a public issue or pull request describing the vulnerability.**
Instead, open an issue using the normal issue form with only a short note
asking for a private way to reach the maintainers — no details about the
vulnerability itself — and we will follow up to arrange a private channel.

Please include, once we are in touch privately:

- A description of the issue and its potential impact.
- Steps to reproduce it, or a proof of concept.
- The version or commit you tested against.

We will acknowledge your report, work with you to understand and fix the
issue, and credit you in the fix unless you ask us not to.

## Supported versions

Only the `main` branch is supported. There are no released versions yet; once
there are, security fixes will target the latest minor version.

## Scope

In scope:

- This repository's code (`src/`, `tests/`, build and CI configuration).
- How it interacts with the `velox-contracts` contracts it calls.

Out of scope:

- Vulnerabilities in `@stellar/stellar-sdk` or other third-party
  dependencies — report those to their own maintainers.
- Issues that require access to the operator's secret key or local
  environment to begin with.
