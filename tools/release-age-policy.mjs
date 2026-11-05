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

/** The minimum release age in minutes; a zero window makes the list moot. */
const POSITIVE_INTEGER_PATTERN = /^\d+$/u

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
 * them. The block is the only place the repository configures early trust, so
 * a narrow reader is enough and a YAML parser would add a dependency here.
 */
function readPolicy(text) {
  const lines = text.split('\n')
  let window
  let entries = []
  for (const [index, line] of lines.entries()) {
    const windowMatch = /^minimumReleaseAge:\s*(\S+)\s*$/u.exec(line)
    if (windowMatch !== null) window = windowMatch[1]
    if (!/^minimumReleaseAgeExclude:\s*$/u.test(line)) continue
    entries = []
    for (const next of lines.slice(index + 1)) {
      const entryMatch = /^\s+-\s+(.+?)\s*$/u.exec(next)
      if (entryMatch !== null) {
        entries.push(entryMatch[1].replace(/^'(.*)'$/u, '$1'))
        continue
      }
      // Blank lines and the block's own comments belong to the list; the first
      // other line is the next top-level key.
      if (/^\s*(?:#.*)?$/u.test(next)) continue
      break
    }
  }
  return { window, entries }
}

/**
 * Every package at every version the lockfile resolves, as `name@version`.
 * Snapshot keys carry their peer suffixes in parentheses, and a key long
 * enough to wrap ends its line after the closing quote, so only the quoted key
 * itself is read.
 */
function readResolutions(lockfile) {
  const resolved = new Set()
  let inSnapshots = false
  for (const line of lockfile.split('\n')) {
    if (/^snapshots:/u.test(line)) {
      inSnapshots = true
      continue
    }
    if (!inSnapshots) continue
    const match = /^ {2}(?:\? )?'([^']+)'/u.exec(line)
    if (match === null) continue
    const key = match[1].split('(')[0]
    const at = key.lastIndexOf('@')
    if (at > 0) resolved.add(key)
  }
  return resolved
}

/** One line per entry that is not one package at one version the tree resolves. */
function checkPolicy(policy, resolved) {
  const problems = []
  const seen = new Set()
  if (policy.entries.length > 0) {
    if (policy.window === undefined || !POSITIVE_INTEGER_PATTERN.test(policy.window)) {
      problems.push('minimumReleaseAge must be a positive number of minutes')
    }
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
