import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/domain/optimizerMachineContinuationProfile.test.ts'
let source = readFileSync(path, 'utf8')

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText)
  if (first < 0) {
    throw new Error(`Missing ${label} anchor`)
  }
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Non-unique ${label} anchor`)
  }
  source = source.replace(oldText, newText)
}

replaceOnce(
  `              expect(\n                secondIdentityCandidates.length,\n              ).toBeGreaterThan(0)\n              secondIdentityUnresolved = []\n\n              for (\n                const secondIdentityGroupIndex of\n                secondIdentityCandidates\n              ) {`,
  `              const requestedSecondIdentityGroupIndexes = (\n                machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_SECOND_IDENTITIES ??\n                ''\n              )\n                .split(',')\n                .map((value) => value.trim())\n                .filter(Boolean)\n                .map((value) => Number(value))\n                .filter((value) => Number.isInteger(value) && value >= 0)\n              const selectedSecondIdentityCandidates =\n                requestedSecondIdentityGroupIndexes.length > 0\n                  ? secondIdentityCandidates.filter((candidateGroupIndex) =>\n                      requestedSecondIdentityGroupIndexes.includes(\n                        candidateGroupIndex,\n                      ),\n                    )\n                  : secondIdentityCandidates\n              expect(\n                selectedSecondIdentityCandidates.length,\n              ).toBeGreaterThan(0)\n              secondIdentityUnresolved = []\n\n              for (\n                const secondIdentityGroupIndex of\n                selectedSecondIdentityCandidates\n              ) {`,
  'second-identity selector',
)

replaceOnce(
  `                  const pairSparse = pairSparseCustomers[0]\n                  expect(pairSparse).toBeDefined()\n                  if (pairSparse) {\n                    const pairCustomerUnresolved: Array<{`,
  `                  const pairSparse = pairSparseCustomers[0]\n                  expect(pairSparse).toBeDefined()\n                  if (pairSparse) {\n                    const requestedPairCustomerChoiceGroupIndexes = (\n                      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_CUSTOMER_CHOICES ??\n                      ''\n                    )\n                      .split(',')\n                      .map((value) => value.trim())\n                      .filter(Boolean)\n                      .map((value) => Number(value))\n                      .filter(\n                        (value) => Number.isInteger(value) && value >= 0,\n                      )\n                    const selectedPairCustomerChoices =\n                      requestedPairCustomerChoiceGroupIndexes.length > 0\n                        ? pairSparse.candidates.filter((choice) =>\n                            requestedPairCustomerChoiceGroupIndexes.includes(\n                              choice.groupIndex,\n                            ),\n                          )\n                        : pairSparse.candidates\n                    expect(\n                      selectedPairCustomerChoices.length,\n                    ).toBeGreaterThan(0)\n                    const pairCustomerUnresolved: Array<{`,
  'pair-customer selector',
)

replaceOnce(
  `                    for (const choice of pairSparse.candidates) {`,
  `                    for (const choice of selectedPairCustomerChoices) {`,
  'pair-customer loop',
)

writeFileSync(path, source)
