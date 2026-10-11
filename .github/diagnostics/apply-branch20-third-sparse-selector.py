from pathlib import Path

path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one third-level diagnosis anchor, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    """      const eligibleCostSums = sortedCostSums.filter(
        (value) => !skippedCostSums.includes(value),
      )
""",
    """      const requestedThirdPairCustomerChoiceGroupIndexes = (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_THIRD_CUSTOMER_CHOICES ??
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
    """                            if (
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
""",
    """                            if (
                              nextCustomerStatus === 'timelimit' &&
                              machineContinuationEnv.MACHINE_CONTINUATION_FORCED_COST_ROLE_PAIR_THIRD_CUSTOMER ===
                                '1'
                            ) {
                              const thirdAlreadyRequiredUsedGroupIndexes =
                                new Set([
                                  ...nextAlreadyRequiredUsedGroupIndexes,
                                  nextChoice.groupIndex,
                                ])
                              const thirdSparseCustomers =
                                nextSparseCustomers
                                  .filter(
                                    (entry) =>
                                      entry.customerId !==
                                        nextSparse.customerId,
                                  )
                                  .filter(
                                    (entry) =>
                                      entry.candidates.length > 0 &&
                                      entry.candidates.every(
                                        (candidate) =>
                                          !thirdAlreadyRequiredUsedGroupIndexes.has(
                                            candidate.groupIndex,
                                          ),
                                      ),
                                  )
                                  .sort(
                                    (left, right) =>
                                      left.candidates.length -
                                      right.candidates.length,
                                  )
                              const thirdSparse =
                                thirdSparseCustomers[0]
                              expect(thirdSparse).toBeDefined()
                              if (thirdSparse) {
                                const selectedThirdSparseCandidates =
                                  requestedThirdPairCustomerChoiceGroupIndexes.length >
                                  0
                                    ? thirdSparse.candidates.filter(
                                        (candidate) =>
                                          requestedThirdPairCustomerChoiceGroupIndexes.includes(
                                            candidate.groupIndex,
                                          ),
                                      )
                                    : thirdSparse.candidates
                                if (
                                  requestedThirdPairCustomerChoiceGroupIndexes.length >
                                  0
                                ) {
                                  expect(
                                    selectedThirdSparseCandidates.length,
                                  ).toBe(
                                    new Set(
                                      requestedThirdPairCustomerChoiceGroupIndexes,
                                    ).size,
                                  )
                                }
                                expect(
                                  selectedThirdSparseCandidates.length,
                                ).toBeGreaterThan(0)
                                const thirdCustomerUnresolved: Array<{
                                  choiceGroupIndex: number
                                  status: string
                                  supportCuts: number
                                }> = []

                                for (
                                  const thirdChoice of
                                  selectedThirdSparseCandidates
                                ) {
                                  const thirdCustomerSupportCuts: number[][] = []
                                  let thirdCustomerStatus =
                                    'round-limit'

                                  for (
                                    let thirdCustomerRound = 0;
                                    thirdCustomerRound < 8;
                                    thirdCustomerRound += 1
                                  ) {
                                    const thirdCustomerBuilt =
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
                                            thirdChoice.groupIndex,
                                          ],
                                          requiredSlackGroupIndexes: [
                                            ...requiredSlackGroupIndexes,
                                            ...(choice.slackOnly
                                              ? [choice.groupIndex]
                                              : []),
                                            ...(nextChoice.slackOnly
                                              ? [nextChoice.groupIndex]
                                              : []),
                                            ...(thirdChoice.slackOnly
                                              ? [thirdChoice.groupIndex]
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
                                            thirdCustomerSupportCuts,
                                        },
                                      )
                                    const thirdCustomerSolved =
                                      await solveBounded(
                                        thirdCustomerBuilt.model,
                                        0.5,
                                      )
                                    masterSolveMs +=
                                      thirdCustomerSolved.solveMs
                                    if (
                                      thirdCustomerSolved.status ===
                                      'infeasible'
                                    ) {
                                      thirdCustomerStatus =
                                        'infeasible'
                                      break
                                    }
                                    if (
                                      thirdCustomerSolved.status !==
                                        'optimal' ||
                                      !thirdCustomerSolved.namedSolution
                                    ) {
                                      thirdCustomerStatus =
                                        thirdCustomerSolved.status
                                      break
                                    }

                                    const thirdCustomerSupport =
                                      groups.flatMap(
                                        (
                                          _group,
                                          supportGroupIndex,
                                        ) => {
                                          const raw =
                                            thirdCustomerSolved.namedSolution!.get(
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
                                      thirdCustomerSupport.length
                                    if (
                                      thirdCustomerSupport.length !== 30
                                    ) {
                                      throw new Error(
                                        `Expected 30 support groups for forced identity ${groupIndex} / branch ${requested.branchIndex} / cost sum ${extraOneCostSum} / extra-one pair ${identityGroupIndex}+${secondIdentityGroupIndex} / sparse customer ${pairSparse.customerId} / choice ${choice.groupIndex} / next sparse customer ${nextSparse.customerId} / choice ${nextChoice.groupIndex} / third sparse customer ${thirdSparse.customerId} / choice ${thirdChoice.groupIndex}, got ${thirdCustomerSupport.length}`,
                                      )
                                    }

                                    const thirdCustomerExact =
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
                                        new Set(thirdCustomerSupport),
                                      )
                                    const thirdCustomerExactSolved =
                                      await solveBounded(
                                        thirdCustomerExact.model,
                                        3,
                                      )
                                    exactSolveMs +=
                                      thirdCustomerExactSolved.solveMs
                                    if (
                                      thirdCustomerExactSolved.status ===
                                      'infeasible'
                                    ) {
                                      exactInfeasibleSupports += 1
                                      thirdCustomerSupportCuts.push(
                                        thirdCustomerSupport,
                                      )
                                      continue
                                    }
                                    if (
                                      thirdCustomerExactSolved.status ===
                                      'optimal'
                                    ) {
                                      thirdCustomerStatus =
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
                                          thirdCustomerSupport,
                                        objective:
                                          thirdCustomerExactSolved.objective,
                                      }
                                      break
                                    }
                                    thirdCustomerStatus =
                                      `exact-${thirdCustomerExactSolved.status}`
                                    break
                                  }

                                  if (
                                    thirdCustomerStatus !==
                                    'infeasible'
                                  ) {
                                    thirdCustomerUnresolved.push({
                                      choiceGroupIndex:
                                        thirdChoice.groupIndex,
                                      status:
                                        thirdCustomerStatus,
                                      supportCuts:
                                        thirdCustomerSupportCuts.length,
                                    })
                                  }
                                  if (globalWitness) break
                                }

                                console.info(
                                  '[machine-forced-cost-role-pair-third-customer-summary]',
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
                                    nextChoiceGroupIndex:
                                      nextChoice.groupIndex,
                                    thirdSparseCustomer:
                                      thirdSparse.customerId,
                                    candidateCount:
                                      thirdSparse.candidates.length,
                                    unresolved:
                                      thirdCustomerUnresolved,
                                  }),
                                )

                                if (
                                  !globalWitness &&
                                  thirdCustomerUnresolved.length ===
                                    0
                                ) {
                                  nextCustomerStatus =
                                    'infeasible'
                                } else if (!globalWitness) {
                                  nextCustomerStatus =
                                    'third-customer-split-unresolved'
                                }
                              }
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
""",
)

path.write_text(text, encoding='utf-8')
