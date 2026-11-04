import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The harness matrix, read from the manifest the tarball ships.
 *
 * These are the release policy's rules, which `tools/harness-matrix.mjs` guards
 * in the pre-push hook: the peers accept the whole compatible range, and the harness
 * devDependencies name one verified release, because npm reaches a prerelease
 * only through a range comparator naming its own `X.Y.Z` tuple — no single
 * range spans two prerelease lines.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const compatibility: string = manifest.dsh.compatibility.dsh
const releases: string[] = Object.keys(manifest.dsh.compatibility.dshReleases)

/** Harness packages in one manifest field, by the scope every one of them shares. */
const harnessIn = (field: string): Array<[string, string]> =>
  Object.entries((manifest[field] ?? {}) as Record<string, string>).filter(([name]) =>
    name.startsWith('@deepseek-ai/dsh-'),
  )

/** The numeric tuple a release or a range bound names, which is how npm compares prereleases. */
const tuple = (version: string): number[] => version.split('-')[0]!.split('.').map(Number)

/** Lexicographic tuple order; prerelease suffixes only ever vary inside one tuple. */
const compare = (left: number[], right: number[]): number => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return 0
}

describe('harness matrix', () => {
  it('peers on the whole compatible range', () => {
    const peers = harnessIn('peerDependencies')
    expect(peers.length).toBeGreaterThan(0)
    for (const [name, declared] of peers) {
      expect(`${name} declares ${declared}`).toBe(`${name} declares ${compatibility}`)
    }
  })

  it('compiles against exactly one verified release', () => {
    const compiled = new Set(harnessIn('devDependencies').map(([, declared]) => declared))
    expect(compiled.size).toBe(1)
    for (const version of compiled) expect(releases).toContain(version)
  })

  it('lists only verified releases inside the compatible range', () => {
    // One `>=lower <upper` alternative per prerelease line, joined by `||`, so
    // npm reaches each line through a bound that names its own tuple.
    const alternatives = compatibility.split('||').map((part) => {
      const bounds = /^>=(\S+) <(\S+)$/u.exec(part.trim())
      expect(bounds, `${part.trim()} is not a >=lower <upper alternative`).not.toBeNull()
      return { lower: bounds![1]!, upper: bounds![2]! }
    })
    expect(releases.length).toBeGreaterThan(0)
    for (const release of releases) {
      const inside = alternatives.some(
        ({ lower, upper }) =>
          compare(tuple(release), tuple(lower)) >= 0 &&
          compare(tuple(release), tuple(upper)) < 0 &&
          // npm admits a prerelease only through a bound on its own tuple.
          (!release.includes('-') || compare(tuple(release), tuple(lower)) === 0),
      )
      expect(inside, `${release} is outside ${compatibility}`).toBe(true)
    }
  })

  it('passes the offline guard', () => {
    const output = execFileSync(process.execPath, [join(ROOT, 'tools/harness-matrix.mjs')], {
      encoding: 'utf8',
    })
    expect(output).toContain('harness-matrix: ok')
  })
})
