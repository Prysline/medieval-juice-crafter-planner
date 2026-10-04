import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/domain/optimizerMachineContinuationProfile.test.ts'
let source = readFileSync(path, 'utf8')

const oldText = `      if (\n        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_LIST_SUMS ===\n        '1'\n      ) {\n        throw new Error(\n          \`MACHINE_FORCED_COST_ROLE_SUMS \${JSON.stringify({\n            groupIndex,\n            branchIndex: requested.branchIndex,\n            roleMask: requested.roleMask,\n            slackCase: requested.slackCase,\n            sortedCostSums,\n          })}\`,\n        )\n      }`
const newText = `      if (\n        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_LIST_SUMS ===\n        '1'\n      ) {\n        console.info(\n          'MACHINE_FORCED_COST_ROLE_SUMS',\n          JSON.stringify({\n            groupIndex,\n            branchIndex: requested.branchIndex,\n            roleMask: requested.roleMask,\n            slackCase: requested.slackCase,\n            sortedCostSums,\n          }),\n        )\n        continue\n      }`

const first = source.indexOf(oldText)
if (first < 0) throw new Error('Missing cost-sum enumeration anchor')
if (source.indexOf(oldText, first + oldText.length) >= 0) {
  throw new Error('Non-unique cost-sum enumeration anchor')
}
source = source.replace(oldText, newText)
writeFileSync(path, source)
