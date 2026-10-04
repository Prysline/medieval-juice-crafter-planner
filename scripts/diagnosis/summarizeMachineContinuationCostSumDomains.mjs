import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) throw new Error('Usage: node summarizeMachineContinuationCostSumDomains.mjs <log>')

const text = readFileSync(path, 'utf8')
const marker = 'MACHINE_FORCED_COST_ROLE_SUMS '
const entries = text
  .split(/\r?\n/)
  .flatMap((line) => {
    const index = line.indexOf(marker)
    if (index < 0) return []
    const json = line.slice(index + marker.length).trim()
    try {
      const parsed = JSON.parse(json)
      return [parsed]
    } catch {
      return []
    }
  })

if (entries.length === 0) {
  throw new Error('No MACHINE_FORCED_COST_ROLE_SUMS entries found')
}

const groups = new Map()
for (const entry of entries) {
  const key = JSON.stringify(entry.sortedCostSums)
  const group = groups.get(key) ?? {
    sortedCostSums: entry.sortedCostSums,
    cases: [],
  }
  group.cases.push(`${entry.branchIndex}:${entry.roleMask}:${entry.slackCase}`)
  groups.set(key, group)
}

const grouped = [...groups.values()]
  .map((group) => ({
    ...group,
    caseCount: group.cases.length,
  }))
  .sort((left, right) =>
    right.caseCount - left.caseCount ||
    left.sortedCostSums.length - right.sortedCostSums.length,
  )

console.log(
  'MACHINE_FORCED_COST_ROLE_DOMAIN_GROUPS ' +
    JSON.stringify({
      entryCount: entries.length,
      groupCount: grouped.length,
      groups: grouped,
    }),
)
