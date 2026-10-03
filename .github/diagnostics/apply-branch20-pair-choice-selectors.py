from pathlib import Path

path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one diagnosis selector anchor, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    """      const eligibleCostSums = sortedCostSums.filter(
        (value) => !skippedCostSums.includes(value),
      )
""",
    """      const requestedSecondIdentityGroupIndexes = (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_SECOND_IDENTITIES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
      const requestedPairCustomerChoiceGroupIndexes = (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_CUSTOMER_CHOICES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
      const eligibleCostSums = sortedCostSums.filter(
        (value) => !skippedCostSums.includes(value),
      )
""",
)

replace_once(
    """              expect(
                secondIdentityCandidates.length,
              ).toBeGreaterThan(0)
              secondIdentityUnresolved = []

              for (
                const secondIdentityGroupIndex of
                secondIdentityCandidates
              ) {
""",
    """              expect(
                secondIdentityCandidates.length,
              ).toBeGreaterThan(0)
              const selectedSecondIdentityCandidates =
                requestedSecondIdentityGroupIndexes.length > 0
                  ? secondIdentityCandidates.filter(
                      (candidateGroupIndex) =>
                        requestedSecondIdentityGroupIndexes.includes(
                          candidateGroupIndex,
                        ),
                    )
                  : secondIdentityCandidates
              if (requestedSecondIdentityGroupIndexes.length > 0) {
                expect(selectedSecondIdentityCandidates.length).toBe(
                  new Set(requestedSecondIdentityGroupIndexes).size,
                )
              }
              expect(selectedSecondIdentityCandidates.length).toBeGreaterThan(0)
              secondIdentityUnresolved = []

              for (
                const secondIdentityGroupIndex of
                selectedSecondIdentityCandidates
              ) {
""",
)

replace_once(
    """                  const pairSparse = pairSparseCustomers[0]
                  expect(pairSparse).toBeDefined()
                  if (pairSparse) {
                    const pairCustomerUnresolved: Array<{
                      choiceGroupIndex: number
                      status: string
                      supportCuts: number
                    }> = []

                    for (const choice of pairSparse.candidates) {
""",
    """                  const pairSparse = pairSparseCustomers[0]
                  expect(pairSparse).toBeDefined()
                  if (pairSparse) {
                    const selectedPairSparseCandidates =
                      requestedPairCustomerChoiceGroupIndexes.length > 0
                        ? pairSparse.candidates.filter((candidate) =>
                            requestedPairCustomerChoiceGroupIndexes.includes(
                              candidate.groupIndex,
                            ),
                          )
                        : pairSparse.candidates
                    if (requestedPairCustomerChoiceGroupIndexes.length > 0) {
                      expect(selectedPairSparseCandidates.length).toBe(
                        new Set(requestedPairCustomerChoiceGroupIndexes).size,
                      )
                    }
                    expect(selectedPairSparseCandidates.length).toBeGreaterThan(0)
                    const pairCustomerUnresolved: Array<{
                      choiceGroupIndex: number
                      status: string
                      supportCuts: number
                    }> = []

                    for (const choice of selectedPairSparseCandidates) {
""",
)

path.write_text(text, encoding='utf-8')
