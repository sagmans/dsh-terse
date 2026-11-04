#!/usr/bin/env node
/**
 * Harness matrix guard.
 *
 * This plugin's peers accept the whole compatible range so a profile resolves
 * the harness copy it already runs, while its dev tree compiles against one
 * verified release: a tree whose peers, devDependencies, and verified list
 * disagree is how a profile ends up mounting a copy from a line the plugin was
 * never proven against. The default mode checks that matrix offline;
 * --check-registry also reads the registry's latest dist-tag and fails when the
 * harness has moved past the verified list.
 *
 * The range is read twice, because two readers apply it: the dsh plugin gate
 * (`evaluatePluginCompatibility` in `@deepseek-ai/dsh-app-boot`) admits
 * prereleases anywhere inside it, while npm's strict peer resolution admits a
 * prerelease only through a comparator naming its own `X.Y.Z` tuple. A verified
 * release has to pass both, and every upper bound has to refuse its own line's
 * prereleases under the first.
 *
 * --manifest checks a copy instead of this repository's manifest, so a matrix
 * that must fail can be checked without editing the real one.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The harness itself and its packages; the CLI's own name matches no dash. */
const HARNESS = /^@deepseek-ai\/dsh(-|$)/u

/** X.Y.Z with optional dot-separated prerelease identifiers, as semver spells them. */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/** A prerelease identifier semver orders as a number rather than as text. */
const NUMERIC_IDENTIFIER = /^\d+$/u

/** An aliased install, `npm:<name>@<version>`, read for the version it pins. */
const ALIAS_PATTERN = /^npm:(.+)@([^@]+)$/u

/** The registry document that names the harness's dist-tags. */
const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'

/** The one spelling a compatible-range alternative takes: an inclusive lower and an exclusive upper bound. */
const RANGE_ALTERNATIVE_PATTERN = /^>=(\S+) <(\S+)$/u

/** The separator semver reads between the alternatives of one range. */
const ALTERNATIVE_SEPARATOR = '||'

/**
 * The prerelease an upper bound carries so it also refuses the bound's own
 * prereleases: `<0.3.0` admits `0.3.0-rc.1` wherever prereleases are read,
 * `<0.3.0-0` does not, because `0` is the lowest prerelease semver orders.
 */
const LOWEST_PRERELEASE = '0'

const harnessEntries = (table) => Object.entries(table ?? {}).filter(([name]) => HARNESS.test(name))

/**
 * One version split into its release tuple and prerelease identifiers.
 * @throws Error when the value is not a plain semver version.
 */
function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value ?? '')
  if (match === null) throw new Error(`unsupported version: ${String(value)}`)
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease:
      match[4] === undefined
        ? []
        : match[4].split('.').map((part) => (NUMERIC_IDENTIFIER.test(part) ? Number(part) : part)),
  }
}

/** Orders two prerelease identifiers: numeric before alphanumeric, each by its own kind. */
function compareIdentifiers(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'number') return -1
  if (typeof right === 'number') return 1
  if (left === right) return 0
  if (left > right) return 1
  return -1
}

/** Orders two parsed versions with semver's rule that a prerelease precedes its release. */
function compareParsed(a, b) {
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index]
  }
  if (a.prerelease.length === 0) return b.prerelease.length === 0 ? 0 : 1
  if (b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    // A shorter identifier list that matches so far is the earlier prerelease.
    if (a.prerelease[index] === undefined) return -1
    if (b.prerelease[index] === undefined) return 1
    const order = compareIdentifiers(a.prerelease[index], b.prerelease[index])
    if (order !== 0) return order
  }
  return 0
}

/** Whether a parsed version is a prerelease of the other's own X.Y.Z tuple. */
function sameTuple(a, b) {
  return a.numbers.every((number, index) => number === b.numbers[index])
}

/**
 * The compatible range as bounded alternatives, or undefined when any
 * alternative is not spelled `>=lower <upper` or names an unreadable version.
 */
function parseRange(declared) {
  const alternatives = []
  for (const part of String(declared ?? '').split(ALTERNATIVE_SEPARATOR)) {
    const match = RANGE_ALTERNATIVE_PATTERN.exec(part.trim())
    if (match === null) return undefined
    try {
      alternatives.push({ lower: parseVersion(match[1]), upper: parseVersion(match[2]) })
    } catch {
      return undefined
    }
  }
  return alternatives
}

/**
 * Whether the range admits one version, the way node-semver's `satisfies`
 * answers it: with `includePrerelease`, as the dsh plugin gate reads it, any
 * version inside an alternative; without it, as npm's peer resolution reads it,
 * a prerelease only when a bound of that alternative names its own tuple.
 */
function satisfiesRange(alternatives, version, includePrerelease) {
  const parsed = parseVersion(version)
  return alternatives.some(
    ({ lower, upper }) =>
      compareParsed(parsed, lower) >= 0 &&
      compareParsed(parsed, upper) < 0 &&
      (parsed.prerelease.length === 0 ||
        includePrerelease ||
        [lower, upper].some((bound) => bound.prerelease.length > 0 && sameTuple(bound, parsed))),
  )
}

/** Spells a parsed version back the way the manifest writes it. */
function formatVersion(version) {
  return (
    version.numbers.join('.') +
    (version.prerelease.length === 0 ? '' : `-${version.prerelease.join('.')}`)
  )
}

const args = process.argv.slice(2)

/** How a long command-line flag is spelled. */
const FLAG_PREFIX = '--'

/** The value after a `--name` flag, or undefined when the flag is absent. */
function option(name) {
  const index = args.indexOf(FLAG_PREFIX + name)
  if (index < 0) return undefined
  return args[index + 1]
}

/**
 * The range's own spelling: every alternative bounded `>=lower <upper-0`.
 * @returns the parsed alternatives, or undefined when the range is unreadable.
 */
function checkRangeShape(compatibility, problems) {
  const alternatives = parseRange(compatibility)
  if (alternatives === undefined) {
    problems.push(
      'dsh.compatibility.dsh must declare ">=lower <upper" alternatives joined by "||", found ' +
        String(compatibility),
    )
    return undefined
  }
  // A bare upper bound admits the next line's release candidates to the dsh
  // plugin gate, which then mounts the plugin on a line no gate has seen.
  for (const { upper } of alternatives) {
    if (upper.prerelease.length !== 1 || upper.prerelease[0] !== Number(LOWEST_PRERELEASE)) {
      problems.push(
        'dsh.compatibility.dsh bounds a line at <' +
          formatVersion(upper) +
          ', which the dsh plugin gate reads as admitting the prereleases of that line; bound it at <' +
          upper.numbers.join('.') +
          '-' +
          LOWEST_PRERELEASE,
      )
    }
  }
  return alternatives
}

/** Every verified release has to pass both readers of the range. */
function checkVerifiedReleases(alternatives, compatibility, releases, problems) {
  if (releases.length === 0) {
    problems.push('dsh.compatibility.dshReleases must name at least one verified release')
  }
  if (alternatives === undefined) return
  for (const release of releases) {
    if (!satisfiesRange(alternatives, release, true)) {
      problems.push(
        `verified release ${release} lies outside the compatible range ${compatibility}`,
      )
    } else if (!satisfiesRange(alternatives, release, false)) {
      // npm reads the same range for the peers and would refuse the host's own
      // release, resolving a second framework copy beside it.
      problems.push(
        'verified release ' +
          release +
          ' is a prerelease npm peer resolution refuses under ' +
          compatibility +
          '; give its X.Y.Z tuple an alternative of its own',
      )
    }
  }
}

/**
 * A peer accepts the whole line rather than one release: the profile resolves a
 * single harness copy for the host and this plugin, and a peer narrower than the
 * range would resolve the private duplicate the range exists to prevent.
 */
function checkPeers(manifest, compatibility, problems) {
  for (const [name, declared] of harnessEntries(manifest.peerDependencies)) {
    if (declared !== compatibility) {
      problems.push(
        'peer ' +
          name +
          ' declares ' +
          declared +
          ', not the compatible range ' +
          String(compatibility),
      )
    }
  }
}

/**
 * A mounted package either accepts the whole compatible line or names one
 * verified release, the way the harness's own bundles pin; an aliased install
 * carries the release of the line no range can reach.
 */
function checkMounted(manifest, compatibility, releases, problems) {
  for (const [name, declared] of harnessEntries(manifest.dependencies)) {
    if (declared !== compatibility && !releases.includes(declared)) {
      problems.push(
        'mounted package ' +
          name +
          ' declares ' +
          declared +
          ', which is neither the compatible range ' +
          String(compatibility) +
          ' nor a verified release',
      )
    }
  }
  for (const [name, declared] of Object.entries(manifest.dependencies ?? {})) {
    if (!String(declared).startsWith('npm:')) continue
    const aliased = ALIAS_PATTERN.exec(String(declared))
    if (aliased === null || !releases.includes(aliased[2])) {
      problems.push(
        'aliased dependency ' +
          name +
          ' declares ' +
          declared +
          ', whose version is not a verified release',
      )
    }
  }
}

/**
 * The sources compile against exactly one verified release.
 * @returns the harness versions the devDependencies name.
 */
function checkCompiled(manifest, releases, problems) {
  const compiled = harnessEntries(manifest.devDependencies)
  if (compiled.length === 0) {
    problems.push('the manifest compiles against no harness package')
  }
  const compiledVersions = new Set(compiled.map(([, declared]) => declared))
  if (compiledVersions.size > 1) {
    problems.push(`the harness devDependencies name ${compiledVersions.size} versions, not one`)
  }
  for (const version of compiledVersions) {
    if (!releases.includes(version)) {
      problems.push(
        'the harness devDependencies compile against ' +
          version +
          ', which is not a verified release',
      )
    }
  }
  return compiledVersions
}

/** Fails when the registry's latest harness has moved past the verified list. */
async function checkRegistry(releases, problems) {
  const response = await fetch(REGISTRY_URL)
  if (!response.ok) {
    problems.push(`the registry read failed with HTTP ${response.status}`)
    return
  }
  const metadata = await response.json()
  const latest = metadata['dist-tags']?.latest
  if (typeof latest !== 'string') {
    problems.push('the registry answered no latest dist-tag')
  } else if (!releases.includes(latest)) {
    problems.push(`the harness publishes ${latest} as latest, which is not a verified release`)
    console.error(
      'harness-matrix: add it to dsh.compatibility.dshReleases, raise the harness devDependencies and mounted packages, then dogfood; RELEASE.md owns the procedure',
    )
  } else {
    console.log(`harness-matrix: registry latest ${latest} is verified`)
  }
}

/** Runs every check and exits non-zero with one line per problem. */
async function main() {
  const manifestPath = resolve(ROOT, option('manifest') ?? 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const compatibility = manifest.dsh?.compatibility?.dsh
  const releases = Object.keys(manifest.dsh?.compatibility?.dshReleases ?? {})
  const problems = []

  const alternatives = checkRangeShape(compatibility, problems)
  checkVerifiedReleases(alternatives, compatibility, releases, problems)
  checkPeers(manifest, compatibility, problems)
  checkMounted(manifest, compatibility, releases, problems)
  const compiledVersions = checkCompiled(manifest, releases, problems)
  if (args.includes('--check-registry')) await checkRegistry(releases, problems)

  if (problems.length > 0) {
    console.error('harness-matrix: the matrix is inconsistent')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(
    'harness-matrix: ok (' +
      releases.length +
      ' verified, compiled ' +
      [...compiledVersions].join(', ') +
      ', peers ' +
      String(compatibility) +
      ')',
  )
}

await main()
