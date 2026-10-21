# Contributing to velox-scheduler

Thanks for helping. This repo is the off-chain daemon that reads Velox schedules from the chain and submits due payments. It signs transactions with a real key, so changes get careful review.

## Finding work

Pick an open issue labeled [`good first issue`](https://github.com/Velox-lab/velox-scheduler/labels/good%20first%20issue) or [`help wanted`](https://github.com/Velox-lab/velox-scheduler/labels/help%20wanted). Comment on the issue to say you are taking it, so two people do not build the same thing. For anything not covered by an issue, open one first and describe the change.

## Setup

You need Node.js **22.12 or newer** (required by `@stellar/stellar-sdk` 17).
If you use `nvm`, `nvm use` picks up the version in `.nvmrc`.

```bash
git clone https://github.com/Velox-lab/velox-scheduler.git
cd velox-scheduler
npm ci
cp .env.example .env   # only needed to run the daemon, not the tests
```

Never commit `.env` or a real secret key.

## Checks to run before opening a PR

CI runs exactly these commands:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Coverage thresholds are enforced by `npm test -- --coverage`; keep new code covered.

## Branches and commits

- Branch from `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`, `test/short-name`.
- Commit messages follow the existing style: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, then a short imperative summary. Explain the why in the body when it is not obvious.
- One concern per PR.
- If you change dependencies, commit the updated `package-lock.json`.

## Code conventions

- **Tests first**, in `tests/`, mirroring the `src/` layout. Jest only; nothing in the unit tests touches the network.
- **Inject dependencies.** Modules receive what they need through their constructor (for example the Soroban RPC server), so tests pass a mock. Follow that pattern rather than constructing clients inside a class.
- **Assert values.** Check the outcome (the logged record, the metric, the returned object), not only that a function was called.
- **One responsibility per module**, as described in [ARCHITECTURE.md](ARCHITECTURE.md). Update that file and the README when behaviour, configuration or environment variables change.
- **Errors:** a failure on one schedule must never stop the polling loop or block other schedules.

## Documentation must match the code

Docs are held to the same standard as code. Before submitting a docs PR, check that every file, command, environment variable and setting you mention exists on `main`, and that any commands you give actually run. If something is planned but not built yet, say so or link the issue instead of describing it as available.

## Pull requests

- Link the issue with `Closes #N` in the description.
- Fill in the PR template.
- Wait for the CI check to pass. If it shows "waiting for approval" because this is your first contribution, a maintainer needs to approve the run.
- Expect review comments; small follow-up commits on the same branch are fine.

## Reporting security problems

See [SECURITY.md](SECURITY.md).
