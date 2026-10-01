# AGENTS.md

`@sagmans/dsh-terse` is a Cordis plugin for DeepSeek Harness that makes agent output
maximally terse without costing quality. It is always-on and append-only: it contributes a
prompt section, a durable context snapshot, and two `tools/post-execute` behaviours, and it
never touches the deployment's own system prompt. ESM TypeScript (strict), Node ^24, pnpm
11.21.0, and the harness window `>=0.1.5-rc.1 <0.3.0` (`dsh.compatibility` in
`package.json`), whose verified releases live in `dsh.compatibility.dshReleases`: an API
outside that line is not available here. Behaviour, install, and the benchmark that backs
the claims: [README.md](README.md) and [benchmark/README.md](benchmark/README.md). Release
policy: [RELEASE.md](RELEASE.md).

## Contributing

**`main` is PR-only. Never commit or push to it, not even a one-line fix.** Work in a
worktree on a feature branch, open a pull request, and let it merge there. A fix small enough
to feel exempt is the one most likely to skip review, so there is no size that makes a direct
push acceptable.

Commits are signed and carry DCO:

```sh
git commit -s -S -m "<conventional-commit message>"
```

## Commands

| Task | Command |
| --- | --- |
| Typecheck `src` and `tests` | `pnpm run typecheck` |
| Unit tests | `pnpm test` |
| One unit test | `pnpm vitest run tests/unit/drift.spec.ts -t "<name>"` |
| Build `src` into `dist` | `pnpm run build` |
| Built-artifact tests (imports `dist/`) | `pnpm run test:build` |
| Release-guard tests (synthetic CLIs, no writes) | `pnpm test:release` |
| Packed-tarball smoke test | `pnpm run pack-smoke` |
| Harness-matrix guard | `pnpm run harness-matrix` |
| All of the above | `pnpm run check` |
| Dogfood on the real tui profile | `./scripts/dogfood/run-terse-from-worktree.sh` (`--profile <name>`, `--status`, `--clean`, `--no-launch`) |

`pnpm run check` is the completion bar for a change. Anything touching the prompt strings, the
nudge, or shaping also needs the dogfood run: the unit specs never load the real harness.

## Map

- `src/index.ts` is the composition root: it wires L1..L6 onto the harness extension
  points and holds the per-session state. Layers are documented by name there.
- `src/instructions.ts` holds every model-facing string. These cost input on every request,
  so they live together and carry a size guard in the specs.
- `src/drift.ts` is the pure decision core for the nudge. It imports neither Cordis nor the
  harness, so it is testable and inspectable in isolation.
- `src/shaping.ts` is the pure input-shaping core (run collapse + middle elision).
- `cordis.patch.yml` is the shipped bundle row the manifest's `dsh.bundle.patch` points at: one
  insert that mounts the plugin and carries the shipped thresholds. Mounting that row is the
  only enabling act; there is no off switch.
- `tests/unit/*.spec.ts` are the focused specs.
- `tests/build/*.test.mjs` exercise the built `dist/` artefact, not the sources.
- `tests/release/*.py` exercise `scripts/npm/release.py` through synthetic `npm`/`gh`/`git`
  CLIs, so the guards are covered with zero registry or GitHub writes.
- `scripts/npm/execution.py` is the shared provider boundary: the `CONFIRM=<action>`/`DRY_RUN`
  gate, the pty that answers npm's browser prompt, and the read-retry window live there.
- `scripts/npm/release.py` runs the release actions against `scripts/npm/target.env`, the static
  release identity; every mutation goes through `execution.mutate`, so each write needs its own
  `CONFIRM=<action>`. `scripts/npm/github_release.py` adds the create-only GitHub controls
  behind the same gate, and `tools/pack-smoke.mjs` proves the tarball ships what the manifest
  points at.
- `.github/workflows/check.yml` gates every change; `release.yml` publishes on a `v*` tag
  through npm OIDC trusted publishing behind the `npm-release` approval environment.
- `docs/` holds research and planning notes and is gitignored on purpose; nothing there ships
  or gets committed. `dist/` is build output and is not edited by hand.

## Sharp edges

**`dist/` is both the loaded artefact and the only code that ships.** A linked profile loads
`dist/`, not `src/`, so a source edit stays invisible to `dsh --profile <name>` until
`pnpm run build` runs; and the tarball carries only what `files` names — `dist`,
`cordis.patch.yml`, `README.md` — plus the license and manifest npm always adds, so a runtime
file the build does not emit never reaches an install.

**A published version is immutable and the first one can only be bootstrapped by hand.** npm
needs the package to exist before trusted publishing can be configured, so `release.yml`
skips the publish job for `v0.1.0`; follow [RELEASE.md](RELEASE.md) for that one.

**The harness matrix names releases, and ranges only what a range can reach.** The peers
and `dsh.compatibility.dsh` accept the whole compatible line, while the harness
`devDependencies` and `dsh.compatibility.dshReleases` name the releases that passed the
gates: npm resolves a prerelease only through a comparator naming its own `X.Y.Z` tuple, so
`>=0.1.5-rc.1 <0.3.0` reaches `0.1.5-rc.3` and `0.2.0-rc.2` and never `0.1.7-rc.2`. The
harness's own row preflight reads the peers instead, with prereleases participating, so the
peers have to admit every listed release. `node
tools/harness-matrix.mjs` guards the matrix and [RELEASE.md](RELEASE.md#harness-matrix) owns
the bump; moving one side alone is the drift the guard exists to catch.

**Dependencies resolve under quarantine.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080`
with the harness lines, the publisher's cordis, schemastery, and cordis-plugin names those
lines resolve, and the 0.2.0 line's `@earendil-works/pi-ai` runtime excluded, and a package whose install runs a build step stays blocked
until it is listed in `allowBuilds`. `.github/dependabot.yml` repeats that window as a 7-day
cooldown and ignores the transitive `@vitest/mocker` major and minor raises the runner cannot
take. CI adds `npm audit signatures` and `pnpm audit --audit-level high` on top of
`pnpm run check`.

**The constitution is size-guarded on purpose.** It is input cost on every call; a spec fails
if it grows past 360 estimated tokens (a crude estimate that overcounts real prose by roughly
10-20%). Trim wording before raising the ceiling.

**The nudge must never be able to loop.** It is capped per turn and skipped on a
`concludesTurn` result. Removing either guard can make a long turn spin.

**Code is never drift.** `minJudgeableProseRatio` exists so a long implementation is exempt;
without it the nudge would train the model to shorten the output that must not be shortened.

**Tool output elision must stay reversible.** Every elision keeps a locator, and errors are
never shaped. A lossy cut here would cost a whole debugging loop.

## Release and publication

Read [RELEASE.md](RELEASE.md) before preparing a version, pushing a release tag,
publishing, or repairing a release record. Shipping a documentation or code PR
is not approval to publish. Require explicit maintainer approval for publication
and each remote release action; never publish on your own initiative.

1. Land the candidate through a reviewed PR to `main`. Match `package.json`
   `version`, the `vX.Y.Z` tag, and the versioned `CHANGELOG.md` entry.
   Pass the release gates in `RELEASE.md` on the exact merged commit.
2. Create an annotated, signed tag on that commit:
   `git tag -s -a "vX.Y.Z" -m "vX.Y.Z" <merged-sha>`.
   Verify it with `git verify-tag "vX.Y.Z"`. Never use a lightweight or unsigned
   release tag; require GitHub to verify the signature after the approved push.
3. Push only that tag with `git push origin "vX.Y.Z"` after approval.
   `.github/workflows/release.yml` verifies the tag and publishes through npm
   OIDC trusted publishing after the `npm-release` environment approval.
   Wait for success; never substitute a local `npm publish`. The documented
   first-publication bootstrap is a maintainer-only exception, not a retry path.
4. After publication succeeds, create the GitHub release from the existing tag:
   `gh release create "vX.Y.Z" --verify-tag --title "vX.Y.Z" --notes-file <notes-file>`.
   Use that version's changelog entry as notes. Set `--latest=false` when filling
   an older release so it does not replace the current latest release.
5. Read back the npm version, tarball integrity and available provenance, the
   remote tag's verified signature and source commit, and the published GitHub
   release for the same version. A green workflow alone is not completion:
   every npm version requires its own signed tag and GitHub release record.

Published versions and tags are immutable. Never delete, move, or re-sign an
existing release tag, and never republish or unpublish an existing npm version.
For a missing GitHub release, verify the existing signed tag and create only its
release record with `--verify-tag`; do not push another tag or retry publication.
If a tag or signature is missing or invalid, stop and ask the maintainer; do not
invent a source commit from current `main`. Forward-fix broken packages as
`RELEASE.md` directs. Helper mutations require `CONFIRM=<action>`; preview
with `DRY_RUN=1`.
