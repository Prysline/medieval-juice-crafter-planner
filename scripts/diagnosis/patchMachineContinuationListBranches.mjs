import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/domain/optimizerMachineContinuationProfile.test.ts'
let source = readFileSync(path, 'utf8')

const oldText = `    const requestedCases =\n      (\n        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_CASES ??`
const newText = `    if (\n      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_LIST_BRANCHES ===\n        '1'\n    ) {\n      throw new Error(\n        'MACHINE_FORCED_COST_ROLE_BRANCHES ' +\n          JSON.stringify({\n            groupIndex,\n            branchCustomers: branchCustomers.map((entry) => ({\n              customerId: entry.customerId,\n              candidateGroupIndexes: entry.candidates.map(\n                (candidate) => candidate.groupIndex,\n              ),\n            })),\n            branches: branches.map((branch, branchIndex) => ({\n              branchIndex,\n              requiredUsedGroupIndexes: branch.requiredUsedGroupIndexes,\n              requiredSlackGroupIndexes: branch.requiredSlackGroupIndexes,\n            })),\n          }),\n      )\n    }\n\n    const requestedCases =\n      (\n        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_CASES ??`

const first = source.indexOf(oldText)
if (first < 0) throw new Error('Missing branch enumeration anchor')
if (source.indexOf(oldText, first + oldText.length) >= 0) {
  throw new Error('Non-unique branch enumeration anchor')
}
source = source.replace(oldText, newText)
writeFileSync(path, source)
