# Changelog

All notable changes to `@sagmans/dsh-terse` are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the 0.x caveat
[RELEASE.md](RELEASE.md) states: while at 0.x, a minor bump may carry a breaking change, and a
patch carries only fixes.

## [Unreleased]

## [0.2.0] - 2026-09-30

### Added

- `tools/harness-matrix.mjs` guards the manifest's harness matrix, and `pnpm run check`
  runs it with the rest of the gates. It exists because the three places that state the
  window — the compatible range, the verified list, and the release the dev tree compiles
  against — drifted apart once already, and a profile reads that drift as a harness copy of
  its own beside the host's ([RELEASE.md](RELEASE.md#harness-matrix)).

- `.github/dependabot.yml` states this repository's update policy, because GitHub's
  defaults fought it: a three-day cooldown against the seven-day quarantine
  `pnpm-workspace.yaml` sets, and one group that mixed a direct dependency with the
  transitive one that had outrun its pin. The policy mirrors the quarantine, exempts the
  harness lines the workspace already exempts, and holds `@vitest/mocker` to the runner
  that pins it, so a bot pull request and `pnpm install` agree on what is old enough to
  land.

### Changed

- The harness window widens to `>=0.1.5-rc.1 <0.3.0`, and `0.2.0-rc.2` joins the verified
  list. A range reaches a prerelease only through a comparator naming that exact tuple, so the
  `<0.2.0` ceiling could never admit the 0.2.0 line, and a host on that line disables any row
  whose peer range does not admit its own version. The peers move with the range because
  `tools/harness-matrix.mjs` holds them equal to it, and the harness `devDependencies`
  compile against `0.2.0-rc.2` — every pinned package exists at that release.

- `@earendil-works/pi-ai` and `@earendil-works/pi-telemetry` join
  `minimumReleaseAgeExclude`: the 0.2.0 line's pi-ai provider resolves `0.87.1`, which was
  published inside the quarantine window, and the rest of the tree still waits it out.

- The declared `terse-nudge` message-source kind still holds on 0.2.0: `MessageSourceMap`
  remains a merge-extensible sum type that no shared `plugin` kind fills in, so the
  augmentation is what names this producer there as it did on 0.1.7.

- The earlier entry: the harness window widens to `>=0.1.5-rc.1 <0.2.0`, and `0.1.7-rc.2` joins the verified
  list. The former `<0.1.6` ceiling excluded a line the plugin composes on, and the peers
  carried the same narrow window, so a profile running a newer harness resolved a second
  copy of every harness module this plugin peers on. Every listed release passes
  `pnpm install`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build` in a tree
  whose harness packages are that release.

- The nudge declares its own message-source kind, because `0.1.7` dropped the shared
  `plugin` kind: a source that cannot name its producer leaves derived history unreadable,
  so every producer declares the kind it can be recognized by. The kind arrives through a
  module augmentation, which the 0.1.5 line merges without complaint, so one source literal
  typechecks on both lines.

- A range admits a prerelease only through a comparator naming its own `X.Y.Z` tuple, so
  the harness peers carry the whole range while the harness `devDependencies` name one
  verified release: `>=0.1.5-rc.1 <0.2.0` resolves `0.1.5-rc.3` and never `0.1.7-rc.2`.

- The `@types/node` line moves onto the engine line, and the update policy stops
  proposing Node majors. The pin named Node 22 while `engines.node` and the runner are
  Node 24, so typecheck resolved APIs the engine does not provide and nothing in the
  repository compared the two; an exact pin gives the bot no range to respect, so its
  target is always the newest major and every future one becomes a raise the engine
  cannot support.

- `vitest` moves to the patched `4.1.11` release, which closes a medium advisory in the
  mock loader's redirect handling. A transitive `@vitest/mocker` raise was refused
  instead: that package cannot cross a major line ahead of the runner that pins it, and
  the patched 4.1.x already closes the advisory.

- Every GitHub Actions pin names the release it resolves, and the harness
  `devDependencies` move together onto the release the lockfile already built. A bare SHA
  cannot be reviewed for whether it is the release it claims, which is how a supply-chain
  swap hides, and a manifest describing a tree the install does not build is drift no
  reviewer can see.

- The PTY the release helper opens answers npm's browser prompt as it appears. The
  wrapper had opened the terminal and never written to it, so the read stalled until the
  window closed and the operator was never asked to approve — the same defect that
  blocked trust configuration twice while bootstrapping a sibling package. That registry
  readback now lives in the shared helper as well: one implementation cannot receive a fix
  the other never sees.

- `AGENTS.md` is refreshed against the tree, and the README links a document that ships
  rather than one `.gitignore` excludes. The map had named a single writer where two paths
  write behind the same `CONFIRM` gate, which is the kind of drift a reader takes for
  policy.

[Unreleased]: https://github.com/sagmans/dsh-terse/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sagmans/dsh-terse/compare/v0.1.0...v0.2.0
