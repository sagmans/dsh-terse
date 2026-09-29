# Changelog

All notable changes to `@sagmans/dsh-terse` are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the 0.x caveat
[RELEASE.md](RELEASE.md) states: while at 0.x, a minor bump may carry a breaking change, and a
patch carries only fixes.

## [Unreleased]

### Added

- `tools/harness-matrix.mjs` guards the manifest's harness matrix, and `pnpm run check`
  runs it with the rest of the gates. It exists because the three places that state the
  window — the compatible range, the verified list, and the release the dev tree compiles
  against — drifted apart once already, and a profile reads that drift as a harness copy of
  its own beside the host's ([RELEASE.md](RELEASE.md#harness-matrix)).

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
