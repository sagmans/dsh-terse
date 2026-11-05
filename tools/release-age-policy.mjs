#!/usr/bin/env node
/**
 * Release-age policy guard.
 *
 * `minimumReleaseAge` quarantines every registry release younger than the
 * window, so an exemption is the one place that trust is granted early. A bare
 * name spends that exemption on every later release of the package, and pnpm
 * refuses a version on a name pattern (`ERR_PNPM_INVALID_MINIMUM_RELEASE_AGE_EXCLUDE`),
 * so one `<package>@<version>` row per package is the only narrow spelling.
 * The lockfile is the other half: an exemption for a version the tree no longer
 * resolves grants nothing and hides that the list went stale, and the whole
 * block is time-limited, so a stale row must fail here rather than wait for
 * the next install to expose it.
 *
 * The reader fails closed on purpose. A value after the key, a flow list, or a
 * row indented in a shape it does not parse could leave this guard reporting
 * zero exemptions while pnpm still applies them, so each of those forms is a
 * problem instead of an empty block.
 *
 * --workspace checks a copy instead of this repository, so a policy that must
 * fail is proven without editing the real one.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The separator pnpm reads between the versions of one exemption row. */
const UNION_SEPARATOR = '||'

/** A package name an exemption may name: an optional scope, then the name. */
const NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/** X.Y.Z with optional prerelease and build identifiers, as semver spells it. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

/** The minimum release age in minutes; a window of zero quarantines nothing. */
const POSITIVE_MINUTES_PATTERN = /^[1-9]\d*$/u

/** A comment that trails a value on the same line. */
const INLINE_COMMENT_PATTERN = /\s+#.*$/u

/** A block-list row of the exemption list. */
const ROW_PATTERN = /^\s*-\s+(.+?)\s*$/u

/** A line that carries no policy: a blank line or a comment. */
const BLANK_OR_COMMENT_PATTERN = /^\s*(?:#.*)?$/u

const args = process.argv.slice(2)

/** How a long command-line flag is spelled. */
const FLAG_PREFIX = '--'

/** The value after a `--name` flag, or undefined when the flag is absent. */
function option(name) {
  const index = args.indexOf(FLAG_PREFIX + name)
  if (index < 0) return undefined
  return args[index + 1]
}

/** Splits an exemption row into its package name and its versions. */
function splitEntry(entry) {
  const at = entry.lastIndexOf('@')
  if (at <= 0) return { name: entry, versions: [] }
  return { name: entry.slice(0, at), versions: entry.slice(at + 1).split(UNION_SEPARATOR) }
}

/**
 * The quarantine window and its exemptions, as the workspace file declares
 * them. A YAML parser would add a dependency to a guard that runs on every
 * push, so the block is read narrowly and every form it does not read becomes
 * a problem.
 */
function readPolicy(text) {
  // A CRLF checkout once made the key line unmatchable, so the reader normalises
  // the line ending instead of depending on how git checked the file out.
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const problems = []
  let window
  const entries = []
  let excludeSeen = false
  for (const [index, line] of lines.entries()) {
    // An explicit YAML key (`? name`) puts the key and its value on separate
    // lines; this reader cannot follow that, and ignoring it would report an
    // empty policy while pnpm applies the rows.
    if (/^\s*\?\s/u.test(line)) {
      problems.push('cannot read an explicit YAML key in the release-age policy')
      continue
    }
    const windowMatch = /^['"]?minimumReleaseAge['"]?\s*:(.*)$/u.exec(line)
    if (windowMatch !== null) {
      if (window !== undefined) problems.push('minimumReleaseAge appears more than once')
      window = windowMatch[1].replace(INLINE_COMMENT_PATTERN, '').trim()
      continue
    }
    const keyMatch = /^['"]?minimumReleaseAgeExclude['"]?\s*:(.*)$/u.exec(line)
    if (keyMatch === null) continue
    if (excludeSeen) {
      problems.push('minimumReleaseAgeExclude appears more than once; keep one block')
      continue
    }
    excludeSeen = true
    if (keyMatch[1].replace(INLINE_COMMENT_PATTERN, '').trim() !== '') {
      problems.push(
        'minimumReleaseAgeExclude must be a block list: remove the value after the colon',
      )
      continue
    }
    for (const next of lines.slice(index + 1)) {
      const entryMatch = ROW_PATTERN.exec(next)
      if (entryMatch !== null) {
        entries.push(entryMatch[1].replace(/^'(.*)'$/u, '$1'))
        continue
      }
      if (BLANK_OR_COMMENT_PATTERN.test(next)) continue
      // An indented line that is not a row is a form this reader cannot judge.
      // Reading it as "no rows" would let pnpm apply what the guard never saw.
      if (/^\s/u.test(next)) {
        problems.push(`cannot read '${next.trim()}' inside minimumReleaseAgeExclude`)
        continue
      }
      break
    }
  }
  return { window, entries, problems }
}

/**
 * The snapshot key on a line of the lockfile. The key is written plainly when
 * it is short and quoted when it is long, and a long one wraps before its
 * colon, so only the key text itself is read.
 */
function snapshotKey(line) {
  // Exactly two spaces: a deeper line is a dependency of a snapshot, and
  // reading it as a key would add names that no exemption can ever name.
  const match = /^ {2}(?! )(?:\? )?(.+)$/u.exec(line)
  if (match === null) return undefined
  const rest = match[1]
  if (rest.startsWith("'")) return /^'([^']+)'/u.exec(rest)?.[1]
  const end = rest.search(/[:(]/u)
  return end < 0 ? undefined : rest.slice(0, end).trim()
}

/** Every package at every version the lockfile resolves, as `name@version`. */
function readResolutions(lockfile) {
  const resolved = new Set()
  let inSnapshots = false
  for (const line of lockfile.split('\n')) {
    if (/^snapshots:/u.test(line)) {
      inSnapshots = true
      continue
    }
    if (!inSnapshots) continue
    const key = snapshotKey(line)
    if (key === undefined) continue
    const name = key.split('(')[0]
    const at = name.lastIndexOf('@')
    if (at > 0) resolved.add(name)
  }
  return resolved
}

/** One line per entry that is not one package at one version the tree resolves. */
function checkPolicy(policy, resolved) {
  const problems = [...policy.problems]
  const seen = new Set()
  if (policy.window === undefined || !POSITIVE_MINUTES_PATTERN.test(policy.window)) {
    problems.push(
      `minimumReleaseAge must be a number of minutes above zero, found '${
        policy.window ?? 'nothing'
      }'`,
    )
  }
  for (const entry of policy.entries) {
    const { name, versions } = splitEntry(entry)
    if (versions.length === 0) {
      problems.push(`'${entry}' names no version, so it exempts every release of ${name}`)
      continue
    }
    if (name.includes('*')) {
      problems.push(
        `'${entry}' is a name pattern; pnpm refuses a version on a pattern, so list each package`,
      )
      continue
    }
    if (!NAME_PATTERN.test(name)) {
      problems.push(`'${entry}' is not a package name followed by an exact version`)
      continue
    }
    if (versions.length > 1) {
      problems.push(`'${entry}' unions ${versions.length} versions; write one row per version`)
      continue
    }
    if (!VERSION_PATTERN.test(versions[0])) {
      problems.push(`'${entry}' does not name an exact version`)
      continue
    }
    if (seen.has(entry)) {
      problems.push(`'${entry}' repeats an earlier row`)
      continue
    }
    seen.add(entry)
    if (!resolved.has(entry)) {
      problems.push(`'${entry}' resolves nowhere in pnpm-lock.yaml; remove the row`)
    }
  }
  return problems
}

/** Runs the guard and exits non-zero with one line per problem. */
function main() {
  const workspace = resolve(ROOT, option('workspace') ?? '.')
  const policy = readPolicy(readFileSync(resolve(workspace, 'pnpm-workspace.yaml'), 'utf8'))
  const resolved = readResolutions(readFileSync(resolve(workspace, 'pnpm-lock.yaml'), 'utf8'))
  const problems = checkPolicy(policy, resolved)
  if (problems.length > 0) {
    console.error('release-age-policy: the quarantine exemptions are not exact')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(
    `release-age-policy: ok (${policy.entries.length} exemptions, each one exact version the lockfile resolves)`,
  )
}

main()
