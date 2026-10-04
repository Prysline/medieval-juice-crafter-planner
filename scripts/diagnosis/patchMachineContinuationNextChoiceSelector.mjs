import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/domain/optimizerMachineContinuationProfile.test.ts'
let source = readFileSync(path, 'utf8')

const oldText = `                          for (const nextChoice of nextSparse.candidates) {`
const newText = `                          const requestedNextCustomerChoiceGroupIndexes = (\n                            machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_CUSTOMER_NEXT_CHOICES ??\n                            ''\n                          )\n                            .split(',')\n                            .map((value) => value.trim())\n                            .filter(Boolean)\n                            .map((value) => Number(value))\n                            .filter(\n                              (value) => Number.isInteger(value) && value >= 0,\n                            )\n                          const selectedNextCustomerChoices =\n                            requestedNextCustomerChoiceGroupIndexes.length > 0\n                              ? nextSparse.candidates.filter((nextChoice) =>\n                                  requestedNextCustomerChoiceGroupIndexes.includes(\n                                    nextChoice.groupIndex,\n                                  ),\n                                )\n                              : nextSparse.candidates\n                          expect(\n                            selectedNextCustomerChoices.length,\n                          ).toBeGreaterThan(0)\n\n                          for (const nextChoice of selectedNextCustomerChoices) {`

const first = source.indexOf(oldText)
if (first < 0) {
  throw new Error('Missing next-customer choice selector anchor')
}
if (source.indexOf(oldText, first + oldText.length) >= 0) {
  throw new Error('Non-unique next-customer choice selector anchor')
}

source = source.replace(oldText, newText)
writeFileSync(path, source)
