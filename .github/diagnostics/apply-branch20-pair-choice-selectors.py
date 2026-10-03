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
      const requestedNextPairCustomerChoiceGroupIndexes = (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_NEXT_CUSTOMER_CHOICES ??
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

replace_once(
    """                      if (
                        customerStatus !== 'infeasible'
                      ) {
                        pairCustomerUnresolved.push({
                          choiceGroupIndex:
                            choice.groupIndex,
                          status: customerStatus,
                          supportCuts:
                            customerSupportCuts.length,
                        })
                      }
                      if (globalWitness) break
""",
    """                      if (
                        customerStatus === 'timelimit' &&
                        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_NEXT_CUSTOMER ===
                          '1'
                      ) {
                        const nextAlreadyRequiredUsedGroupIndexes =
                          new Set([
                            ...alreadyRequiredUsedGroupIndexes,
                            choice.groupIndex,
                          ])
                        const nextSparseCustomers =
                          pairSparseCustomers
                            .filter(
                              (entry) =>
                                entry.customerId !==
                                  pairSparse.customerId,
                            )
                            .filter(
                              (entry) =>
                                entry.candidates.length > 0 &&
                                entry.candidates.every(
                                  (candidate) =>
                                    !nextAlreadyRequiredUsedGroupIndexes.has(
                                      candidate.groupIndex,
                                    ),
                                ),
                            )
                            .sort(
                              (left, right) =>
                                left.candidates.length -
                                right.candidates.length,
                            )
                        const nextSparse =
                          nextSparseCustomers[0]
                        expect(nextSparse).toBeDefined()
                        if (nextSparse) {
                          const selectedNextSparseCandidates =
                            requestedNextPairCustomerChoiceGroupIndexes.length >
                            0
                              ? nextSparse.candidates.filter(
                                  (candidate) =>
                                    requestedNextPairCustomerChoiceGroupIndexes.includes(
                                      candidate.groupIndex,
                                    ),
                                )
                              : nextSparse.candidates
                          if (
                            requestedNextPairCustomerChoiceGroupIndexes.length >
                            0
                          ) {
                            expect(
                              selectedNextSparseCandidates.length,
                            ).toBe(
                              new Set(
                                requestedNextPairCustomerChoiceGroupIndexes,
                              ).size,
                            )
                          }
                          expect(
                            selectedNextSparseCandidates.length,
                          ).toBeGreaterThan(0)
                          const nextCustomerUnresolved: Array<{
                            choiceGroupIndex: number
                            status: string
                            supportCuts: number
                          }> = []

                          for (const nextChoice of selectedNextSparseCandidates) {
                            const nextCustomerSupportCuts: number[][] = []
                            let nextCustomerStatus = 'round-limit'

                            for (
                              let nextCustomerRound = 0;
                              nextCustomerRound < 8;
                              nextCustomerRound += 1
                            ) {
                              const nextCustomerBuilt =
                                build311ExtraCostSumSupportMaster(
                                  domain,
                                  groupIndex,
                                  extraOneCostSum,
                                  {
                                    includeCustomerFlow: true,
                                    forcedCustomerIds:
                                      groups[groupIndex]
                                        .eligibleCustomerIds,
                                    requiredUsedGroupIndexes: [
                                      ...branch.requiredUsedGroupIndexes,
                                      choice.groupIndex,
                                      nextChoice.groupIndex,
                                    ],
                                    requiredSlackGroupIndexes: [
                                      ...requiredSlackGroupIndexes,
                                      ...(choice.slackOnly
                                        ? [choice.groupIndex]
                                        : []),
                                      ...(nextChoice.slackOnly
                                        ? [nextChoice.groupIndex]
                                        : []),
                                    ],
                                    forbiddenSlackGroupIndexes,
                                    requiredExtraOneGroupIndexes: [
                                      ...requiredExtraOneGroupIndexes,
                                      identityGroupIndex,
                                      secondIdentityGroupIndex,
                                    ],
                                    forbiddenExtraOneGroupIndexes:
                                      identityForbiddenExtraOneGroupIndexes,
                                    supportCuts:
                                      nextCustomerSupportCuts,
                                  },
                                )
                              const nextCustomerSolved =
                                await solveBounded(
                                  nextCustomerBuilt.model,
                                  0.5,
                                )
                              masterSolveMs +=
                                nextCustomerSolved.solveMs
                              if (
                                nextCustomerSolved.status ===
                                'infeasible'
                              ) {
                                nextCustomerStatus =
                                  'infeasible'
                                break
                              }
                              if (
                                nextCustomerSolved.status !==
                                  'optimal' ||
                                !nextCustomerSolved.namedSolution
                              ) {
                                nextCustomerStatus =
                                  nextCustomerSolved.status
                                break
                              }

                              const nextCustomerSupport =
                                groups.flatMap(
                                  (
                                    _group,
                                    supportGroupIndex,
                                  ) => {
                                    const raw =
                                      nextCustomerSolved.namedSolution!.get(
                                        `s31su_${supportGroupIndex}`,
                                      )
                                    return typeof raw ===
                                      'number' &&
                                      Number.isFinite(raw) &&
                                      raw > 0.5
                                      ? [supportGroupIndex]
                                      : []
                                  },
                                )
                              supportSize =
                                nextCustomerSupport.length
                              if (
                                nextCustomerSupport.length !== 30
                              ) {
                                throw new Error(
                                  `Expected 30 support groups for forced identity ${groupIndex} / branch ${requested.branchIndex} / cost sum ${extraOneCostSum} / extra-one pair ${identityGroupIndex}+${secondIdentityGroupIndex} / sparse customer ${pairSparse.customerId} / choice ${choice.groupIndex} / next sparse customer ${nextSparse.customerId} / choice ${nextChoice.groupIndex}, got ${nextCustomerSupport.length}`,
                                )
                              }

                              const nextCustomerExact =
                                buildFinalizing30MaskPartitionStage(
                                  domain,
                                  new Set<ProductionStepKind>([
                                    'juicing',
                                    'seasoning',
                                    'blending',
                                  ]),
                                  thresholdCounts,
                                  { max: 76 },
                                  0,
                                  new Set(nextCustomerSupport),
                                )
                              const nextCustomerExactSolved =
                                await solveBounded(
                                  nextCustomerExact.model,
                                  3,
                                )
                              exactSolveMs +=
                                nextCustomerExactSolved.solveMs
                              if (
                                nextCustomerExactSolved.status ===
                                'infeasible'
                              ) {
                                exactInfeasibleSupports += 1
                                nextCustomerSupportCuts.push(
                                  nextCustomerSupport,
                                )
                                continue
                              }
                              if (
                                nextCustomerExactSolved.status ===
                                'optimal'
                              ) {
                                nextCustomerStatus =
                                  'global-witness'
                                globalWitness = {
                                  branchIndex:
                                    requested.branchIndex,
                                  roleMask:
                                    requested.roleMask,
                                  slackCase:
                                    requested.slackCase,
                                  extraOneCostSum,
                                  support:
                                    nextCustomerSupport,
                                  objective:
                                    nextCustomerExactSolved.objective,
                                }
                                break
                              }
                              nextCustomerStatus =
                                `exact-${nextCustomerExactSolved.status}`
                              break
                            }

                            if (
                              nextCustomerStatus !==
                              'infeasible'
                            ) {
                              nextCustomerUnresolved.push({
                                choiceGroupIndex:
                                  nextChoice.groupIndex,
                                status:
                                  nextCustomerStatus,
                                supportCuts:
                                  nextCustomerSupportCuts.length,
                              })
                            }
                            if (globalWitness) break
                          }

                          console.info(
                            '[machine-forced-cost-role-pair-next-customer-summary]',
                            JSON.stringify({
                              groupIndex,
                              branchIndex:
                                requested.branchIndex,
                              extraOneCostSum,
                              firstIdentityGroupIndex:
                                identityGroupIndex,
                              secondIdentityGroupIndex,
                              sparseCustomer:
                                pairSparse.customerId,
                              choiceGroupIndex:
                                choice.groupIndex,
                              nextSparseCustomer:
                                nextSparse.customerId,
                              candidateCount:
                                nextSparse.candidates.length,
                              unresolved:
                                nextCustomerUnresolved,
                            }),
                          )

                          if (
                            !globalWitness &&
                            nextCustomerUnresolved.length ===
                              0
                          ) {
                            customerStatus = 'infeasible'
                          } else if (!globalWitness) {
                            customerStatus =
                              'next-customer-split-unresolved'
                          }
                        }
                      }

                      if (
                        customerStatus !== 'infeasible'
                      ) {
                        pairCustomerUnresolved.push({
                          choiceGroupIndex:
                            choice.groupIndex,
                          status: customerStatus,
                          supportCuts:
                            customerSupportCuts.length,
                        })
                      }
                      if (globalWitness) break
""",
)

path.write_text(text, encoding='utf-8')
