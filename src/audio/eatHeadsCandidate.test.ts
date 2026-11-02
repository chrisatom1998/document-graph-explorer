import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The EAT heads in scripts/eat-heads/ are an offline candidate (docs/evaluations/eat-heads-2026-11-01).
// They must not change production tagging: nothing the app bundles may read them until they are promoted on purpose.
const CANDIDATE = 'scripts/eat-heads/candidate/eat-heads-2026-11-01.json'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('EAT heads candidate', () => {
  const spec = JSON.parse(readFileSync(CANDIDATE, 'utf8')) as {
    status: string
    tags: { tag: string; display_key: string; head: { weights: string; bias: number } | null; rule: { op: string; eat_min: number | null } }[]
  }

  it('is marked as a candidate and covers the 46 judged tags with valid rules', () => {
    expect(spec.status).toMatch(/^candidate/)
    expect(spec.tags).toHaveLength(46)
    for (const t of spec.tags) {
      expect(['keep', 'or', 'and', 'replace']).toContain(t.rule.op)
      if (t.rule.op === 'keep') continue
      expect(t.head).not.toBeNull()
      expect(t.rule.eat_min).toBeGreaterThanOrEqual(0)
      expect(Buffer.from(t.head!.weights, 'base64').length).toBe(1536 * 4)
    }
  })

  it('is not read by app code or shipped model packs', () => {
    const shipped = [...files('src'), ...files('public').filter((f) => /\.(json|md|txt)$/.test(f))]
      .filter((f) => !f.endsWith('eatHeadsCandidate.test.ts'))
    const hits = shipped.filter((f) => /eat-heads/i.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
