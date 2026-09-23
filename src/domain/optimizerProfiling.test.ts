import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import {
  buildOptimizationModel,
  normalizedOptimizationPriorities,
  type OptimizationRequest,
} from './optimizerModel'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
} from './recipeCandidatePool'
import { calculateRecipeIngredientCost } from './recipeCost'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { productionPathForCandidate } from './productionPlan'

it(
  'profiles the production-scale Blender computed optimizer workload',
  async () => {
    const request: OptimizationRequest = {
      customerIds: canonicalCustomers.map((customer) => customer.id),
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
      },
      formalCustomerIds: canonicalCustomers.map(
        (customer) => customer.id,
      ),
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
        'minimum-jar-switches',
      ],
      availableJuiceJarCount: 2,
    }

    const candidateGenerationStartedAt = performance.now()
    const candidatePool = buildRecipeCandidatePool(
      request.currentProgress,
    )
    const candidateGenerationMs =
      performance.now() - candidateGenerationStartedAt
    const generatedCurrentCandidates =
      recipeCandidatesInCurrentSearchScope(candidatePool)
    const optimizerBaseEligibleCandidates =
      generatedCurrentCandidates.filter((candidate) => {
        if (candidate.effectAmbiguity) return false
        if (
          calculateRecipeIngredientCost(candidate).batchIngredientCost ===
          null
        ) {
          return false
        }
        return productionPathForCandidate(candidate) !== null
      })
    const knownSalePriceBaseEligibleCandidates =
      optimizerBaseEligibleCandidates.filter(
        (candidate) => candidate.salePrice !== null,
      )

    const modelBuildStartedAt = performance.now()
    const model = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const modelBuildMs = performance.now() - modelBuildStartedAt

    const assignmentEligibilityCount = model.recipes.reduce(
      (total, recipe) => total + recipe.eligibleCustomerIds.length,
      0,
    )

    const eligibleRecipeIdsByCustomer = new Map(
      model.serviceableCustomerIds.map((customerId) => [
        customerId,
        model.recipes
          .filter((recipe) => recipe.eligibleCustomerIds.includes(customerId))
          .map((recipe) => recipe.candidate.id)
          .sort(),
      ]),
    )
    const customerGroupsByEligibility = new Map<
      string,
      string[]
    >()
    for (const customerId of model.serviceableCustomerIds) {
      const signature = (
        eligibleRecipeIdsByCustomer.get(customerId) ?? []
      ).join('\u001e')
      const group = customerGroupsByEligibility.get(signature)
      if (group) {
        group.push(customerId)
      } else {
        customerGroupsByEligibility.set(signature, [customerId])
      }
    }
    const groupedAssignmentVariableUpperBound = [
      ...customerGroupsByEligibility.entries(),
    ].reduce((total, [signature]) => {
      if (!signature) return total
      return total + signature.split('\u001e').length
    }, 0)
    const customerEligibilityGroupSizes = [
      ...customerGroupsByEligibility.values(),
    ]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const productionEdgeCount = new Set(
      model.recipes.flatMap((recipe) =>
        recipe.productionPath.edges.map((edge) => edge.key),
      ),
    ).size

    const customerBitById = new Map(
      model.serviceableCustomerIds.map(
        (customerId, index) => [customerId, 1n << BigInt(index)],
      ),
    )
    const recipeServiceMask = (recipe: (typeof model.recipes)[number]) =>
      recipe.eligibleCustomerIds.reduce(
        (mask, customerId) =>
          mask | (customerBitById.get(customerId) ?? 0n),
        0n,
      )

    const recipesByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of model.recipes) {
      const mask = recipeServiceMask(recipe)
      const group = recipesByServiceMask.get(mask)
      if (group) {
        group.push(recipe)
      } else {
        recipesByServiceMask.set(mask, [recipe])
      }
    }

    const recipeServiceGroupSizes = [...recipesByServiceMask.values()]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const exactServiceSetCheaperDominatedRecipeIds = new Set<string>()
    for (const group of recipesByServiceMask.values()) {
      const minimumCost = Math.min(
        ...group.map((recipe) => recipe.juiceUnitIngredientCost),
      )
      for (const recipe of group) {
        if (recipe.juiceUnitIngredientCost > minimumCost) {
          exactServiceSetCheaperDominatedRecipeIds.add(
            recipe.candidate.id,
          )
        }
      }
    }

    const serviceGroups = [...recipesByServiceMask.entries()].map(
      ([mask, recipes]) => ({
        mask,
        minimumCost: Math.min(
          ...recipes.map((recipe) => recipe.juiceUnitIngredientCost),
        ),
        recipeIds: recipes.map((recipe) => recipe.candidate.id),
      }),
    )
    const strictlyCheaperOtherSupersetDominatedRecipeIds =
      new Set<string>()
    const strictCostSupersetDominatedRecipeIds = new Set<string>()
    let nondominatedServiceSetCount = 0

    for (const dominatedGroup of serviceGroups) {
      let bestSupersetCost = Infinity
      let bestOtherSupersetCost = Infinity

      for (const candidateGroup of serviceGroups) {
        if (
          (candidateGroup.mask & dominatedGroup.mask) !==
          dominatedGroup.mask
        ) {
          continue
        }

        bestSupersetCost = Math.min(
          bestSupersetCost,
          candidateGroup.minimumCost,
        )
        if (candidateGroup.mask !== dominatedGroup.mask) {
          bestOtherSupersetCost = Math.min(
            bestOtherSupersetCost,
            candidateGroup.minimumCost,
          )
        }
      }

      if (bestSupersetCost >= dominatedGroup.minimumCost) {
        nondominatedServiceSetCount += 1
      }

      for (const recipeId of dominatedGroup.recipeIds) {
        const recipe = model.recipes.find(
          (entry) => entry.candidate.id === recipeId,
        )
        if (!recipe) continue

        if (recipe.juiceUnitIngredientCost > bestSupersetCost) {
          strictCostSupersetDominatedRecipeIds.add(recipeId)
        }
        if (
          recipe.juiceUnitIngredientCost > bestOtherSupersetCost
        ) {
          strictlyCheaperOtherSupersetDominatedRecipeIds.add(recipeId)
        }
      }
    }

    const strictCostPrunedRecipes = model.recipes.filter(
      (recipe) =>
        !strictCostSupersetDominatedRecipeIds.has(recipe.candidate.id),
    )
    const strictCostPrunedAssignmentEligibility =
      strictCostPrunedRecipes.reduce(
        (total, recipe) => total + recipe.eligibleCustomerIds.length,
        0,
      )
    const strictCostPrunedModel = {
      ...model,
      recipes: strictCostPrunedRecipes,
    }

    const representativeByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const mask = recipeServiceMask(recipe)
      const current = representativeByServiceMask.get(mask)
      if (
        !current ||
        recipe.juiceUnitIngredientCost <
          current.juiceUnitIngredientCost
      ) {
        representativeByServiceMask.set(mask, recipe)
      }
    }
    const costStageCompressedRecipes = [
      ...representativeByServiceMask.values(),
    ]
    const costStageCompressedAssignmentEligibility =
      costStageCompressedRecipes.reduce(
        (total, recipe) => total + recipe.eligibleCustomerIds.length,
        0,
      )
    const costStageCompressedModel = {
      ...model,
      recipes: costStageCompressedRecipes,
    }

    const productionEdgeMultiplicitySignature = (
      recipe: (typeof model.recipes)[number],
    ) => {
      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      return [...multiplicityByEdgeKey.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([edgeKey, multiplicity]) => `${edgeKey}×${multiplicity}`)
        .join('\u001d')
    }

    const machineEquivalenceGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const signature = [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        productionEdgeMultiplicitySignature(recipe),
      ].join('\u001c')
      const group = machineEquivalenceGroups.get(signature)
      if (group) {
        group.push(recipe)
      } else {
        machineEquivalenceGroups.set(signature, [recipe])
      }
    }
    const machineEquivalenceGroupSizes = [
      ...machineEquivalenceGroups.values(),
    ]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const machineEquivalenceReducibleRecipeCount =
      strictCostPrunedRecipes.length - machineEquivalenceGroups.size
    const machineEquivalenceAssignmentEligibility =
      [...machineEquivalenceGroups.values()].reduce(
        (total, group) =>
          total + (group[0]?.eligibleCustomerIds.length ?? 0),
        0,
      )

    const stage2EdgeUsage = new Map<
      string,
      {
        kind:
          (typeof strictCostPrunedRecipes)[number]['productionPath']['edges'][number]['kind']
        recipeIds: Set<string>
        totalMultiplicity: number
      }
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const multiplicityByEdgeKey = new Map<string, number>()
      const kindByEdgeKey = new Map<
        string,
        (typeof recipe.productionPath.edges)[number]['kind']
      >()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }

      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const current = stage2EdgeUsage.get(edgeKey) ?? {
          kind: kindByEdgeKey.get(edgeKey)!,
          recipeIds: new Set<string>(),
          totalMultiplicity: 0,
        }
        current.recipeIds.add(recipe.candidate.id)
        current.totalMultiplicity += multiplicity
        stage2EdgeUsage.set(edgeKey, current)
      }
    }

    const edgeKindStats = {
      juicing: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      seasoning: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      blending: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      finalizing: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
    }
    const edgeRecipeUsageCounts: number[] = []
    for (const usage of stage2EdgeUsage.values()) {
      const recipeCount = usage.recipeIds.size
      edgeRecipeUsageCounts.push(recipeCount)
      const stats = edgeKindStats[usage.kind]
      stats.uniqueEdges += 1
      stats.recipeIncidences += recipeCount
      if (recipeCount === 1) {
        stats.singletonEdges += 1
      }
    }
    edgeRecipeUsageCounts.sort((a, b) => b - a)
    const stage2SingletonEdgeCount = edgeRecipeUsageCounts.filter(
      (count) => count === 1,
    ).length
    const stage2SharedEdgeCount =
      edgeRecipeUsageCounts.length - stage2SingletonEdgeCount

    const normalizedMachineSignature = (
      recipe: (typeof model.recipes)[number],
      options: {
        preserveSingletonKind: boolean
      },
    ) => {
      const multiplicityByEdgeKey = new Map<string, number>()
      const kindByEdgeKey = new Map<
        string,
        (typeof recipe.productionPath.edges)[number]['kind']
      >()

      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }

      const sharedTerms: string[] = []
      const singletonTerms: string[] = []

      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const usage = stage2EdgeUsage.get(edgeKey)
        if ((usage?.recipeIds.size ?? 0) > 1) {
          sharedTerms.push(`${edgeKey}×${multiplicity}`)
          continue
        }

        singletonTerms.push(
          options.preserveSingletonKind
            ? `${kindByEdgeKey.get(edgeKey)}×${multiplicity}`
            : `${multiplicity}`,
        )
      }

      sharedTerms.sort()
      singletonTerms.sort()

      return [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        sharedTerms.join('\u001d'),
        singletonTerms.join('\u001d'),
      ].join('\u001c')
    }

    const conservativeNormalizedMachineGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()
    const totalOnlyNormalizedMachineGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()

    for (const recipe of strictCostPrunedRecipes) {
      const conservativeSignature = normalizedMachineSignature(
        recipe,
        { preserveSingletonKind: true },
      )
      const conservativeGroup =
        conservativeNormalizedMachineGroups.get(
          conservativeSignature,
        )
      if (conservativeGroup) {
        conservativeGroup.push(recipe)
      } else {
        conservativeNormalizedMachineGroups.set(
          conservativeSignature,
          [recipe],
        )
      }

      const totalOnlySignature = normalizedMachineSignature(
        recipe,
        { preserveSingletonKind: false },
      )
      const totalOnlyGroup =
        totalOnlyNormalizedMachineGroups.get(totalOnlySignature)
      if (totalOnlyGroup) {
        totalOnlyGroup.push(recipe)
      } else {
        totalOnlyNormalizedMachineGroups.set(
          totalOnlySignature,
          [recipe],
        )
      }
    }

    const normalizedGroupStats = (
      groups: Map<
        string,
        (typeof model.recipes)[number][]
      >,
    ) => {
      const sizes = [...groups.values()]
        .map((group) => group.length)
        .sort((a, b) => b - a)
      return {
        groupCount: groups.size,
        reducibleRecipeCount:
          strictCostPrunedRecipes.length - groups.size,
        assignmentEligibility: [...groups.values()].reduce(
          (total, group) =>
            total + (group[0]?.eligibleCustomerIds.length ?? 0),
          0,
        ),
        largestGroupSizes: sizes.slice(0, 20),
      }
    }

    const conservativeNormalizedMachineStats =
      normalizedGroupStats(conservativeNormalizedMachineGroups)
    const totalOnlyNormalizedMachineStats =
      normalizedGroupStats(totalOnlyNormalizedMachineGroups)

    const sharedKindsSignature = (
      recipe: (typeof model.recipes)[number],
      includedKinds: Set<
        (typeof recipe.productionPath.edges)[number]['kind']
      >,
    ) => {
      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!includedKinds.has(edge.kind)) continue
        const usage = stage2EdgeUsage.get(edge.key)
        if ((usage?.recipeIds.size ?? 0) <= 1) continue

        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }

      return [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        [...multiplicityByEdgeKey.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([edgeKey, multiplicity]) => `${edgeKey}×${multiplicity}`)
          .join('\u001d'),
      ].join('\u001c')
    }

    const sharedKindGroupingStats = (
      includedKinds: Set<
        (typeof strictCostPrunedRecipes)[number]['productionPath']['edges'][number]['kind']
      >,
    ) => {
      const groups = new Map<
        string,
        (typeof model.recipes)[number][]
      >()
      for (const recipe of strictCostPrunedRecipes) {
        const signature = sharedKindsSignature(
          recipe,
          includedKinds,
        )
        const group = groups.get(signature)
        if (group) {
          group.push(recipe)
        } else {
          groups.set(signature, [recipe])
        }
      }
      return normalizedGroupStats(groups)
    }

    const stage2SharedJuicingGrouping =
      sharedKindGroupingStats(new Set(['juicing']))
    const stage2SharedJuicingSeasoningGrouping =
      sharedKindGroupingStats(
        new Set(['juicing', 'seasoning']),
      )
    const stage2SharedJuicingSeasoningBlendingGrouping =
      sharedKindGroupingStats(
        new Set(['juicing', 'seasoning', 'blending']),
      )

    const singletonEdgeCountsByRecipe: number[] = []
    const singletonMultiplicityPatterns = new Map<string, number>()
    let recipesWithSingletonEdges = 0
    let recipesWithAllSingletonMultiplicityOne = 0
    let singletonEdgesWithMultiplicityGreaterThanOne = 0
    let localOperationVariableCountByDistinctMultiplicity = 0

    for (const recipe of strictCostPrunedRecipes) {
      const singletonMultiplicityByEdgeKey = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        const usage = stage2EdgeUsage.get(edge.key)
        if ((usage?.recipeIds.size ?? 0) !== 1) continue

        singletonMultiplicityByEdgeKey.set(
          edge.key,
          (singletonMultiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }

      const multiplicities = [
        ...singletonMultiplicityByEdgeKey.values(),
      ].sort((a, b) => a - b)

      singletonEdgeCountsByRecipe.push(multiplicities.length)
      if (multiplicities.length > 0) {
        recipesWithSingletonEdges += 1

        const distinctMultiplicities = new Set(multiplicities)
        localOperationVariableCountByDistinctMultiplicity +=
          distinctMultiplicities.size

        if (multiplicities.every((value) => value === 1)) {
          recipesWithAllSingletonMultiplicityOne += 1
        }

        singletonEdgesWithMultiplicityGreaterThanOne +=
          multiplicities.filter((value) => value > 1).length

        const pattern = multiplicities.join(',')
        singletonMultiplicityPatterns.set(
          pattern,
          (singletonMultiplicityPatterns.get(pattern) ?? 0) + 1,
        )
      }
    }

    singletonEdgeCountsByRecipe.sort((a, b) => b - a)
    const singletonMultiplicityPatternCounts = [
      ...singletonMultiplicityPatterns.entries(),
    ]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((left, right) => right.count - left.count)

    const operationVariableCountAfterLocalMultiplicityCompression =
      stage2SharedEdgeCount +
      localOperationVariableCountByDistinctMultiplicity
    const operationVariableReductionFromLocalCompression =
      stage2EdgeUsage.size -
      operationVariableCountAfterLocalMultiplicityCompression
    const projectedStage2VariableCountAfterLocalCompression =
      strictCostPrunedRecipes.length +
      strictCostPrunedAssignmentEligibility +
      operationVariableCountAfterLocalMultiplicityCompression
    const projectedStage2ConstraintCountAfterLocalCompression =
      strictCostPrunedRecipes.length +
      model.serviceableCustomerIds.length +
      operationVariableCountAfterLocalMultiplicityCompression * 2 +
      1

    const solverImportStartedAt = performance.now()
    const { profileHighsOptimization } = await import(
      './optimizerHighsSolver'
    )
    const solverModuleImportMs =
      performance.now() - solverImportStartedAt

    const disabledHighsProfile = (): Awaited<
      ReturnType<typeof profileHighsOptimization>
    > | null => null

    const priorities = normalizedOptimizationPriorities(request)
    const binaryHighs = await profileHighsOptimization(
      model,
      priorities,
      {
        stageTimeLimitSeconds: 0.25,
        maxStages: 1,
      },
    )
    const relaxedHighs = await profileHighsOptimization(
      model,
      priorities,
      {
        stageTimeLimitSeconds: 0.25,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const prunedRelaxedHighs = await profileHighsOptimization(
      strictCostPrunedModel,
      priorities,
      {
        stageTimeLimitSeconds: 0.25,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const compressedRelaxedHighs = await profileHighsOptimization(
      costStageCompressedModel,
      priorities,
      {
        stageTimeLimitSeconds: 10.5,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const compressedCostStage = compressedRelaxedHighs.stages[0]
    const compressedRecipeById = new Map(
      costStageCompressedRecipes.map((recipe) => [
        recipe.candidate.id,
        recipe,
      ]),
    )
    const compressedIncumbentEdgeQuantity = new Map<string, number>()
    let compressedIncumbentCost = 0
    let compressedIncumbentProductionUnits = 0

    for (
      const selection of compressedCostStage?.selectedRecipeUnits ?? []
    ) {
      const recipe = compressedRecipeById.get(selection.recipeId)
      if (!recipe) continue
      const units = Math.round(selection.units)
      compressedIncumbentProductionUnits += units
      compressedIncumbentCost +=
        units * recipe.juiceUnitIngredientCost

      for (const edge of recipe.productionPath.edges) {
        compressedIncumbentEdgeQuantity.set(
          edge.key,
          (compressedIncumbentEdgeQuantity.get(edge.key) ?? 0) + units,
        )
      }
    }

    const compressedIncumbentMachineOperations = [
      ...compressedIncumbentEdgeQuantity.values(),
    ].reduce(
      (total, quantity) =>
        total + Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
      0,
    )

    const fixedMinimumCost =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? Math.round(compressedCostStage.objectiveValue)
        : null
    const maxJuiceUnitsPerRecipe = Math.max(
      1,
      Math.ceil(model.serviceableCustomerIds.length / 2),
    )
    const minimumRequiredProductionUnits = Math.ceil(
      model.serviceableCustomerIds.length / 2,
    )
    const strictCostRecipeCosts = strictCostPrunedRecipes.map(
      (recipe) => recipe.juiceUnitIngredientCost,
    )
    const strictCostDistinctCosts = [
      ...new Set(strictCostRecipeCosts),
    ].sort((a, b) => a - b)
    const strictCostNonIntegerCostCount =
      strictCostRecipeCosts.filter(
        (cost) => !Number.isInteger(cost) || cost < 0,
      ).length
    const recipeCountByCost = new Map<number, number>()
    for (const cost of strictCostRecipeCosts) {
      recipeCountByCost.set(
        cost,
        (recipeCountByCost.get(cost) ?? 0) + 1,
      )
    }

    const costFixFeasibleRecipeCosts = new Set<number>()
    const exactCostReachableRecipeCosts = new Set<number>()

    if (
      fixedMinimumCost !== null &&
      strictCostNonIntegerCostCount === 0
    ) {
      for (const selectedCost of strictCostDistinctCosts) {
        if (selectedCost > fixedMinimumCost) continue

        const targetCost = fixedMinimumCost - selectedCost
        const requiredRemainingUnits = Math.max(
          0,
          minimumRequiredProductionUnits - 1,
        )
        const reachable = Array.from(
          { length: targetCost + 1 },
          () =>
            Array.from(
              { length: requiredRemainingUnits + 1 },
              () => false,
            ),
        )
        reachable[0][0] = true

        for (const cost of strictCostDistinctCosts) {
          let availableUnits =
            (recipeCountByCost.get(cost) ?? 0) *
            maxJuiceUnitsPerRecipe
          if (cost === selectedCost) {
            availableUnits -= 1
          }
          if (availableUnits <= 0) continue

          let chunk = 1
          let remaining = availableUnits
          while (remaining > 0) {
            const take = Math.min(chunk, remaining)
            const chunkCost = cost * take
            const chunkUnits = take

            for (
              let currentCost = targetCost - chunkCost;
              currentCost >= 0;
              currentCost -= 1
            ) {
              for (
                let currentUnits = requiredRemainingUnits;
                currentUnits >= 0;
                currentUnits -= 1
              ) {
                if (!reachable[currentCost][currentUnits]) {
                  continue
                }
                const nextCost = currentCost + chunkCost
                const nextUnits = Math.min(
                  requiredRemainingUnits,
                  currentUnits + chunkUnits,
                )
                reachable[nextCost][nextUnits] = true
              }
            }

            remaining -= take
            chunk *= 2
          }
        }

        if (
          reachable[targetCost]?.some((value) => value)
        ) {
          exactCostReachableRecipeCosts.add(selectedCost)
        }
        if (
          reachable[targetCost]?.[requiredRemainingUnits]
        ) {
          costFixFeasibleRecipeCosts.add(selectedCost)
        }
      }
    }

    const recipesRejectedByExactCostFix =
      strictCostPrunedRecipes.filter(
        (recipe) =>
          fixedMinimumCost !== null &&
          !exactCostReachableRecipeCosts.has(
            recipe.juiceUnitIngredientCost,
          ),
      )
    const recipesRejectedByCostFixAndMinimumUnits =
      strictCostPrunedRecipes.filter(
        (recipe) =>
          fixedMinimumCost !== null &&
          !costFixFeasibleRecipeCosts.has(
            recipe.juiceUnitIngredientCost,
          ),
      )
    const recipesRemainingAfterCostFixNecessaryConditions =
      strictCostPrunedRecipes.length -
      recipesRejectedByCostFixAndMinimumUnits.length

    const stage2RecipesByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const mask = recipeServiceMask(recipe)
      const group = stage2RecipesByServiceMask.get(mask)
      if (group) {
        group.push(recipe)
      } else {
        stage2RecipesByServiceMask.set(mask, [recipe])
      }
    }

    let stage2NonUniformCostServiceGroupCount = 0
    for (const group of stage2RecipesByServiceMask.values()) {
      const costs = new Set(
        group.map((recipe) => recipe.juiceUnitIngredientCost),
      )
      if (costs.size !== 1) {
        stage2NonUniformCostServiceGroupCount += 1
      }
    }

    const stage2GroupAssignmentEligibility =
      [...stage2RecipesByServiceMask.values()].reduce(
        (total, group) =>
          total + (group[0]?.eligibleCustomerIds.length ?? 0),
        0,
      )
    const stage2ProjectedVariablesWithGroupAssignments =
      strictCostPrunedRecipes.length +
      stage2GroupAssignmentEligibility +
      stage2EdgeUsage.size
    const stage2ProjectedConstraintsWithGroupAssignments =
      model.serviceableCustomerIds.length +
      stage2RecipesByServiceMask.size +
      stage2EdgeUsage.size * 2 +
      1
    const stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps =
      strictCostPrunedRecipes.length +
      stage2GroupAssignmentEligibility +
      operationVariableCountAfterLocalMultiplicityCompression
    const stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps =
      model.serviceableCustomerIds.length +
      stage2RecipesByServiceMask.size +
      operationVariableCountAfterLocalMultiplicityCompression * 2 +
      1

    const tightenedXUpperBounds = strictCostPrunedRecipes.map(
      (recipe) => {
        const customerCapacityBound = Math.max(
          1,
          Math.ceil(recipe.eligibleCustomerIds.length / 2),
        )
        const costBound =
          fixedMinimumCost === null
            ? maxJuiceUnitsPerRecipe
            : Math.floor(
                fixedMinimumCost /
                  recipe.juiceUnitIngredientCost,
              )
        return Math.max(
          0,
          Math.min(
            maxJuiceUnitsPerRecipe,
            customerCapacityBound,
            costBound,
          ),
        )
      },
    )
    const xUpperBoundHistogram = new Map<number, number>()
    for (const upperBound of tightenedXUpperBounds) {
      xUpperBoundHistogram.set(
        upperBound,
        (xUpperBoundHistogram.get(upperBound) ?? 0) + 1,
      )
    }
    const stage2XUpperBoundHistogram = [
      ...xUpperBoundHistogram.entries(),
    ]
      .map(([upperBound, count]) => ({ upperBound, count }))
      .sort(
        (left, right) => left.upperBound - right.upperBound,
      )
    const stage2RecipesWithTightenedXUpperBound =
      tightenedXUpperBounds.filter(
        (upperBound) => upperBound < maxJuiceUnitsPerRecipe,
      ).length
    const stage2RecipesWithXUpperBoundOne =
      tightenedXUpperBounds.filter(
        (upperBound) => upperBound === 1,
      ).length
    const stage2RecipesWithXUpperBoundAtMostTwo =
      tightenedXUpperBounds.filter(
        (upperBound) => upperBound <= 2,
      ).length
    const stage2AverageTightenedXUpperBound =
      tightenedXUpperBounds.reduce(
        (total, upperBound) => total + upperBound,
        0,
      ) / Math.max(1, tightenedXUpperBounds.length)

    const tightenedXUpperBoundByRecipeId = new Map(
      strictCostPrunedRecipes.map((recipe, index) => [
        recipe.candidate.id,
        tightenedXUpperBounds[index],
      ]),
    )
    const machineSignatureByRecipeId = new Map<
      string,
      {
        sharedMultiplicity: Map<string, number>
        localMultiplicities: number[]
      }
    >()

    for (const recipe of strictCostPrunedRecipes) {
      const edgeMultiplicityByKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        edgeMultiplicityByKey.set(
          edge.key,
          (edgeMultiplicityByKey.get(edge.key) ?? 0) + 1,
        )
      }

      const sharedMultiplicity = new Map<string, number>()
      const localMultiplicities: number[] = []
      for (const [edgeKey, multiplicity] of edgeMultiplicityByKey) {
        const usage = stage2EdgeUsage.get(edgeKey)
        if ((usage?.recipeIds.size ?? 0) > 1) {
          sharedMultiplicity.set(edgeKey, multiplicity)
        } else {
          localMultiplicities.push(multiplicity)
        }
      }
      localMultiplicities.sort((a, b) => a - b)
      machineSignatureByRecipeId.set(recipe.candidate.id, {
        sharedMultiplicity,
        localMultiplicities,
      })
    }

    const projectedOperationUpperBounds: number[] = []
    const projectedSharedQuantityUpperByEdge = new Map<
      string,
      number
    >()

    for (const recipe of strictCostPrunedRecipes) {
      const recipeUpperBound =
        tightenedXUpperBoundByRecipeId.get(recipe.candidate.id) ?? 0
      const signature = machineSignatureByRecipeId.get(
        recipe.candidate.id,
      )
      if (!signature) continue

      for (const multiplicity of new Set(
        signature.localMultiplicities,
      )) {
        projectedOperationUpperBounds.push(
          Math.ceil(
            (multiplicity * recipeUpperBound) /
              PROCESSING_STACK_CAPACITY,
          ),
        )
      }

      for (const [edgeKey, multiplicity] of
        signature.sharedMultiplicity) {
        projectedSharedQuantityUpperByEdge.set(
          edgeKey,
          (projectedSharedQuantityUpperByEdge.get(edgeKey) ?? 0) +
            multiplicity * recipeUpperBound,
        )
      }
    }

    for (const quantityUpperBound of
      projectedSharedQuantityUpperByEdge.values()) {
      projectedOperationUpperBounds.push(
        Math.ceil(
          quantityUpperBound / PROCESSING_STACK_CAPACITY,
        ),
      )
    }

    const projectedOperationUpperBoundHistogramMap =
      new Map<number, number>()
    for (const upperBound of projectedOperationUpperBounds) {
      projectedOperationUpperBoundHistogramMap.set(
        upperBound,
        (projectedOperationUpperBoundHistogramMap.get(upperBound) ?? 0) +
          1,
      )
    }
    const stage2ProjectedOperationUpperBoundHistogram = [
      ...projectedOperationUpperBoundHistogramMap.entries(),
    ]
      .map(([upperBound, count]) => ({ upperBound, count }))
      .sort(
        (left, right) => left.upperBound - right.upperBound,
      )
    const stage2OperationVarsWithUpperBoundOne =
      projectedOperationUpperBounds.filter(
        (upperBound) => upperBound <= 1,
      ).length
    const stage2OperationVarsWithUpperBoundAtMostTwo =
      projectedOperationUpperBounds.filter(
        (upperBound) => upperBound <= 2,
      ).length
    const stage2MaxProjectedOperationUpperBound = Math.max(
      0,
      ...projectedOperationUpperBounds,
    )
    const stage2AverageProjectedOperationUpperBound =
      projectedOperationUpperBounds.reduce(
        (total, upperBound) => total + upperBound,
        0,
      ) / Math.max(1, projectedOperationUpperBounds.length)

    const machineDominatedRecipeIds = new Set<string>()
    for (const group of stage2RecipesByServiceMask.values()) {
      for (const dominated of group) {
        const dominatedSignature = machineSignatureByRecipeId.get(
          dominated.candidate.id,
        )
        if (!dominatedSignature) continue
        const dominatedUpperBound =
          tightenedXUpperBoundByRecipeId.get(
            dominated.candidate.id,
          ) ?? maxJuiceUnitsPerRecipe

        for (const candidate of group) {
          if (candidate.candidate.id === dominated.candidate.id) {
            continue
          }
          const candidateSignature = machineSignatureByRecipeId.get(
            candidate.candidate.id,
          )
          if (!candidateSignature) continue
          const candidateUpperBound =
            tightenedXUpperBoundByRecipeId.get(
              candidate.candidate.id,
            ) ?? maxJuiceUnitsPerRecipe
          if (candidateUpperBound < dominatedUpperBound) continue

          let dominates = true
          let strict = false
          const sharedKeys = new Set([
            ...candidateSignature.sharedMultiplicity.keys(),
            ...dominatedSignature.sharedMultiplicity.keys(),
          ])
          for (const edgeKey of sharedKeys) {
            const candidateMultiplicity =
              candidateSignature.sharedMultiplicity.get(edgeKey) ?? 0
            const dominatedMultiplicity =
              dominatedSignature.sharedMultiplicity.get(edgeKey) ?? 0
            if (candidateMultiplicity > dominatedMultiplicity) {
              dominates = false
              break
            }
            if (candidateMultiplicity < dominatedMultiplicity) {
              strict = true
            }
          }
          if (!dominates) continue

          for (let units = 1; units <= dominatedUpperBound; units += 1) {
            const candidateLocalOperations =
              candidateSignature.localMultiplicities.reduce(
                (total, multiplicity) =>
                  total +
                  Math.ceil(
                    (multiplicity * units) /
                      PROCESSING_STACK_CAPACITY,
                  ),
                0,
              )
            const dominatedLocalOperations =
              dominatedSignature.localMultiplicities.reduce(
                (total, multiplicity) =>
                  total +
                  Math.ceil(
                    (multiplicity * units) /
                      PROCESSING_STACK_CAPACITY,
                  ),
                0,
              )
            if (candidateLocalOperations > dominatedLocalOperations) {
              dominates = false
              break
            }
            if (candidateLocalOperations < dominatedLocalOperations) {
              strict = true
            }
          }
          if (!dominates) continue

          if (
            strict ||
            candidate.candidate.id < dominated.candidate.id
          ) {
            machineDominatedRecipeIds.add(
              dominated.candidate.id,
            )
            break
          }
        }
      }
    }

    const stage2MachineFrontierRecipes =
      strictCostPrunedRecipes.filter(
        (recipe) =>
          !machineDominatedRecipeIds.has(recipe.candidate.id),
      )
    const stage2MachineFrontierGroupSizes = [
      ...stage2RecipesByServiceMask.values(),
    ]
      .map(
        (group) =>
          group.filter(
            (recipe) =>
              !machineDominatedRecipeIds.has(recipe.candidate.id),
          ).length,
      )
      .sort((a, b) => b - a)

    const expandedCostFeasibilityHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-cost'],
            {
              stageTimeLimitSeconds: 5.5,
              relaxAssignmentVariables: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const expandedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const localCompressedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const groupedAssignmentMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const tightBoundMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              captureMps: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const juicingOnlyMachineHighs = disabledHighsProfile()
    const seasoningOnlyMachineHighs = disabledHighsProfile()

    const throughSeasoningMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 5.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationKinds: ['juicing', 'seasoning'],
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const throughBlendingMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationKinds: [
                'juicing',
                'seasoning',
                'blending',
              ],
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const sharedBlendingMachineHighs = disabledHighsProfile()
    const singletonBlendingMachineHighs = disabledHighsProfile()

    const finalizingOnlyMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 5.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationKinds: ['finalizing'],
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const blendingOnlyMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 15.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationKinds: ['blending'],
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const sharedPrefixMachineHighs = disabledHighsProfile()
    const localTailMachineHighs = disabledHighsProfile()

    const twoWayMachineOperationStages = [
      sharedPrefixMachineHighs?.stages[0],
      localTailMachineHighs?.stages[0],
    ]
    const twoWayMachineOperationLowerBound =
      twoWayMachineOperationStages.every(
        (stage) =>
          stage?.status === 'optimal' &&
          stage.objectiveValue !== null,
      )
        ? twoWayMachineOperationStages.reduce(
            (total, stage) =>
              total + Math.round(stage?.objectiveValue ?? 0),
            0,
          )
        : null

    const combinedMachineOperationStages = [
      throughSeasoningMachineHighs?.stages[0],
      blendingOnlyMachineHighs?.stages[0],
      finalizingOnlyMachineHighs?.stages[0],
    ]
    const combinedMachineOperationLowerBound =
      combinedMachineOperationStages.every(
        (stage) =>
          stage?.status === 'optimal' &&
          stage.objectiveValue !== null,
      )
        ? combinedMachineOperationStages.reduce(
            (total, stage) =>
              total + Math.round(stage?.objectiveValue ?? 0),
            0,
          )
        : null

    const disjointMachineOperationStages = [
      juicingOnlyMachineHighs?.stages[0],
      seasoningOnlyMachineHighs?.stages[0],
      sharedBlendingMachineHighs?.stages[0],
      singletonBlendingMachineHighs?.stages[0],
      finalizingOnlyMachineHighs?.stages[0],
    ]
    const decomposedMachineOperationLowerBound =
      disjointMachineOperationStages.every(
        (stage) =>
          stage?.status === 'optimal' &&
          stage.objectiveValue !== null,
      )
        ? disjointMachineOperationStages.reduce(
            (total, stage) =>
              total + Math.round(stage?.objectiveValue ?? 0),
            0,
          )
        : null

    const decomposedBoundMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null &&
      decomposedMachineOperationLowerBound !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationsLowerBound:
                decomposedMachineOperationLowerBound,
              captureMps: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const exactFiftyMachineHighs = disabledHighsProfile()
    const atMostFiftyOneMachineHighs = disabledHighsProfile()
    const partitionBoundExactFiftyMachineHighs = disabledHighsProfile()

    const exactFiftyOneMachineHighs = disabledHighsProfile()

    const tightOperationBoundMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              captureMps: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const binaryEncodedMachineHighs:
      | Awaited<ReturnType<typeof profileHighsOptimization>>
      | null = null
    const fixedBinaryEncodedMachineHighs:
      | Awaited<ReturnType<typeof profileHighsOptimization>>
      | null = null

    const belowFiftyMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              machineOperationsUpperBound: 49,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const recipeRelaxedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              relaxRecipeVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const operationRelaxedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              relaxOperationVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const incumbentBoundMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null &&
      compressedIncumbentMachineOperations > 0
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 0.25,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              machineOperationsUpperBound:
                compressedIncumbentMachineOperations,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const fixedIncumbentMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null &&
      compressedCostStage.selectedRecipeUnits.length > 0
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 2.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              fixedRecipeUnits:
                compressedCostStage.selectedRecipeUnits,
              captureSolutionValues: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const binaryFirstStage = binaryHighs.stages[0]
    const relaxedFirstStage = relaxedHighs.stages[0]
    const prunedRelaxedFirstStage = prunedRelaxedHighs.stages[0]
    const compressedRelaxedFirstStage =
      compressedRelaxedHighs.stages[0]
    const expandedCostFeasibilityFirstStage =
      expandedCostFeasibilityHighs?.stages[0]
    const expandedMachineFirstStage =
      expandedMachineHighs?.stages[0]
    const localCompressedMachineFirstStage =
      localCompressedMachineHighs?.stages[0]
    const groupedAssignmentMachineFirstStage =
      groupedAssignmentMachineHighs?.stages[0]
    const tightBoundMachineFirstStage =
      tightBoundMachineHighs?.stages[0]
    const juicingOnlyMachineFirstStage =
      juicingOnlyMachineHighs?.stages[0]
    const seasoningOnlyMachineFirstStage =
      seasoningOnlyMachineHighs?.stages[0]
    const throughSeasoningMachineFirstStage =
      throughSeasoningMachineHighs?.stages[0]
    const throughBlendingMachineFirstStage =
      throughBlendingMachineHighs?.stages[0]
    const sharedBlendingMachineFirstStage =
      sharedBlendingMachineHighs?.stages[0]
    const singletonBlendingMachineFirstStage =
      singletonBlendingMachineHighs?.stages[0]
    const finalizingOnlyMachineFirstStage =
      finalizingOnlyMachineHighs?.stages[0]
    const blendingOnlyMachineFirstStage =
      blendingOnlyMachineHighs?.stages[0]
    const sharedPrefixMachineFirstStage =
      sharedPrefixMachineHighs?.stages[0]
    const localTailMachineFirstStage =
      localTailMachineHighs?.stages[0]
    const decomposedBoundMachineFirstStage =
      decomposedBoundMachineHighs?.stages[0]
    const exactFiftyMachineFirstStage =
      exactFiftyMachineHighs?.stages[0]
    const atMostFiftyOneMachineFirstStage =
      atMostFiftyOneMachineHighs?.stages[0]
    const partitionBoundExactFiftyMachineFirstStage =
      partitionBoundExactFiftyMachineHighs?.stages[0]
    const exactFiftyOneMachineFirstStage =
      exactFiftyOneMachineHighs?.stages[0]
    const tightOperationBoundMachineFirstStage =
      tightOperationBoundMachineHighs?.stages[0]
    const binaryEncodedMachineFirstStage = null
    const fixedBinaryEncodedMachineFirstStage = null
    const belowFiftyMachineFirstStage =
      belowFiftyMachineHighs?.stages[0]
    const recipeRelaxedMachineFirstStage =
      recipeRelaxedMachineHighs?.stages[0]
    const operationRelaxedMachineFirstStage =
      operationRelaxedMachineHighs?.stages[0]
    const incumbentBoundMachineFirstStage =
      incumbentBoundMachineHighs?.stages[0]
    const fixedIncumbentMachineFirstStage =
      fixedIncumbentMachineHighs?.stages[0]

    const machineOperationBreakdownForSelection = (
      selections: Array<{ recipeId: string; units: number }>,
    ) => {
      const recipeById = new Map(
        strictCostPrunedRecipes.map((recipe) => [
          recipe.candidate.id,
          recipe,
        ]),
      )
      const edgeQuantityByKey = new Map<string, number>()
      let productionUnits = 0

      for (const selection of selections) {
        const recipe = recipeById.get(selection.recipeId)
        if (!recipe) continue
        const units = Math.round(selection.units)
        productionUnits += units
        for (const edge of recipe.productionPath.edges) {
          edgeQuantityByKey.set(
            edge.key,
            (edgeQuantityByKey.get(edge.key) ?? 0) + units,
          )
        }
      }

      const breakdown = {
        juicing: 0,
        seasoning: 0,
        sharedBlending: 0,
        singletonBlending: 0,
        blending: 0,
        finalizing: 0,
        throughSeasoning: 0,
        total: 0,
        productionUnits,
      }

      for (const [edgeKey, quantity] of edgeQuantityByKey) {
        const usage = stage2EdgeUsage.get(edgeKey)
        if (!usage || quantity <= 0) continue
        const operations = Math.ceil(
          quantity / PROCESSING_STACK_CAPACITY,
        )
        if (usage.kind === 'juicing') {
          breakdown.juicing += operations
        } else if (usage.kind === 'seasoning') {
          breakdown.seasoning += operations
        } else if (usage.kind === 'blending') {
          breakdown.blending += operations
          if (usage.recipeIds.size > 1) {
            breakdown.sharedBlending += operations
          } else {
            breakdown.singletonBlending += operations
          }
        } else if (usage.kind === 'finalizing') {
          breakdown.finalizing += operations
        }
        breakdown.total += operations
      }
      breakdown.throughSeasoning =
        breakdown.juicing + breakdown.seasoning
      return breakdown
    }

    const searchOneServiceEquivalentTransfer = (
      rawSelections: Array<{
        recipeId: string
        units: number
      }>,
    ) => {
      const baseSelections = rawSelections.map((selection) => ({
        recipeId: selection.recipeId,
        units: Math.round(selection.units),
      }))
      const baseBreakdown =
        machineOperationBreakdownForSelection(baseSelections)
      const unitsByRecipeId = new Map(
        baseSelections.map((selection) => [
          selection.recipeId,
          selection.units,
        ]),
      )
      const recipeById = new Map(
        strictCostPrunedRecipes.map((recipe) => [
          recipe.candidate.id,
          recipe,
        ]),
      )
      const edgeMultiplicityByRecipeId = new Map<
        string,
        Map<string, number>
      >()
      const edgeQuantityByKey = new Map<string, number>()

      const multiplicityForRecipe = (
        recipe: (typeof strictCostPrunedRecipes)[number],
      ) => {
        const existing = edgeMultiplicityByRecipeId.get(
          recipe.candidate.id,
        )
        if (existing) return existing
        const multiplicity = new Map<string, number>()
        for (const edge of recipe.productionPath.edges) {
          multiplicity.set(
            edge.key,
            (multiplicity.get(edge.key) ?? 0) + 1,
          )
        }
        edgeMultiplicityByRecipeId.set(
          recipe.candidate.id,
          multiplicity,
        )
        return multiplicity
      }

      for (const selection of baseSelections) {
        const recipe = recipeById.get(selection.recipeId)
        if (!recipe) continue
        const multiplicity = multiplicityForRecipe(recipe)
        for (const [edgeKey, edgeMultiplicity] of multiplicity) {
          edgeQuantityByKey.set(
            edgeKey,
            (edgeQuantityByKey.get(edgeKey) ?? 0) +
              selection.units * edgeMultiplicity,
          )
        }
      }

      let bestMachineOperations = baseBreakdown.total
      let bestMove:
        | {
            sourceRecipeId: string
            targetRecipeId: string
            transferredUnits: number
          }
        | null = null
      let evaluatedMoves = 0

      for (const sourceSelection of baseSelections) {
        const sourceRecipe = recipeById.get(
          sourceSelection.recipeId,
        )
        if (!sourceRecipe) continue
        const serviceGroup =
          stage2RecipesByServiceMask.get(
            recipeServiceMask(sourceRecipe),
          ) ?? []
        const sourceMultiplicity =
          multiplicityForRecipe(sourceRecipe)

        for (const targetRecipe of serviceGroup) {
          if (
            targetRecipe.candidate.id ===
            sourceRecipe.candidate.id
          ) {
            continue
          }
          if (
            targetRecipe.juiceUnitIngredientCost !==
            sourceRecipe.juiceUnitIngredientCost
          ) {
            continue
          }

          const targetCurrentUnits =
            unitsByRecipeId.get(targetRecipe.candidate.id) ?? 0
          const targetUpperBound =
            tightenedXUpperBoundByRecipeId.get(
              targetRecipe.candidate.id,
            ) ?? 0
          const maxTransfer = Math.min(
            sourceSelection.units,
            Math.max(0, targetUpperBound - targetCurrentUnits),
          )
          if (maxTransfer <= 0) continue

          const targetMultiplicity =
            multiplicityForRecipe(targetRecipe)
          const affectedEdgeKeys = new Set([
            ...sourceMultiplicity.keys(),
            ...targetMultiplicity.keys(),
          ])

          for (
            let transferredUnits = 1;
            transferredUnits <= maxTransfer;
            transferredUnits += 1
          ) {
            evaluatedMoves += 1
            let operationDelta = 0

            for (const edgeKey of affectedEdgeKeys) {
              const oldQuantity =
                edgeQuantityByKey.get(edgeKey) ?? 0
              const newQuantity =
                oldQuantity +
                transferredUnits *
                  (
                    (targetMultiplicity.get(edgeKey) ?? 0) -
                    (sourceMultiplicity.get(edgeKey) ?? 0)
                  )
              operationDelta +=
                Math.ceil(
                  Math.max(0, newQuantity) /
                    PROCESSING_STACK_CAPACITY,
                ) -
                Math.ceil(
                  oldQuantity / PROCESSING_STACK_CAPACITY,
                )
            }

            const candidateMachineOperations =
              baseBreakdown.total + operationDelta
            if (
              candidateMachineOperations <
              bestMachineOperations
            ) {
              bestMachineOperations =
                candidateMachineOperations
              bestMove = {
                sourceRecipeId: sourceRecipe.candidate.id,
                targetRecipeId: targetRecipe.candidate.id,
                transferredUnits,
              }
            }
          }
        }
      }

      let bestRecipeUnits:
        | Array<{ recipeId: string; units: number }>
        | null = null
      if (bestMove) {
        const candidateUnits = new Map(unitsByRecipeId)
        candidateUnits.set(
          bestMove.sourceRecipeId,
          (candidateUnits.get(bestMove.sourceRecipeId) ?? 0) -
            bestMove.transferredUnits,
        )
        candidateUnits.set(
          bestMove.targetRecipeId,
          (candidateUnits.get(bestMove.targetRecipeId) ?? 0) +
            bestMove.transferredUnits,
        )
        bestRecipeUnits = [...candidateUnits.entries()]
          .filter(([, units]) => units > 0)
          .map(([recipeId, units]) => ({ recipeId, units }))
      }

      return {
        baseMachineOperations: baseBreakdown.total,
        bestMachineOperations,
        sourceRecipeId: bestMove?.sourceRecipeId ?? null,
        targetRecipeId: bestMove?.targetRecipeId ?? null,
        transferredUnits: bestMove?.transferredUnits ?? 0,
        evaluatedMoves,
        baseBreakdown,
        bestRecipeUnits,
      }
    }

    const descendServiceEquivalentSelection = (
      initialSelections: Array<{
        recipeId: string
        units: number
      }>,
    ) => {
      const steps: Array<{
        from: number
        to: number
        sourceRecipeId: string | null
        targetRecipeId: string | null
        transferredUnits: number
        evaluatedMoves: number
      }> = []
      let recipeUnits = initialSelections.map((selection) => ({
        recipeId: selection.recipeId,
        units: Math.round(selection.units),
      }))

      for (
        let stepIndex = 0;
        stepIndex < 4 && recipeUnits.length > 0;
        stepIndex += 1
      ) {
        const step =
          searchOneServiceEquivalentTransfer(recipeUnits)
        if (
          !step.bestRecipeUnits ||
          step.bestMachineOperations >=
            step.baseMachineOperations
        ) {
          break
        }
        steps.push({
          from: step.baseMachineOperations,
          to: step.bestMachineOperations,
          sourceRecipeId: step.sourceRecipeId,
          targetRecipeId: step.targetRecipeId,
          transferredUnits: step.transferredUnits,
          evaluatedMoves: step.evaluatedMoves,
        })
        recipeUnits = step.bestRecipeUnits
        if (
          combinedMachineOperationLowerBound !== null &&
          step.bestMachineOperations <=
            combinedMachineOperationLowerBound
        ) {
          break
        }
      }

      return {
        steps,
        recipeUnits,
        breakdown:
          machineOperationBreakdownForSelection(recipeUnits),
      }
    }

    const enumerateServiceEquivalentTransferCandidates = (
      rawSelections: Array<{
        recipeId: string
        units: number
      }>,
    ) => {
      const baseSelections = rawSelections.map((selection) => ({
        recipeId: selection.recipeId,
        units: Math.round(selection.units),
      }))
      const unitsByRecipeId = new Map(
        baseSelections.map((selection) => [
          selection.recipeId,
          selection.units,
        ]),
      )
      const recipeById = new Map(
        strictCostPrunedRecipes.map((recipe) => [
          recipe.candidate.id,
          recipe,
        ]),
      )
      const candidates: Array<{
        machineOperations: number
        sourceRecipeId: string
        targetRecipeId: string
        transferredUnits: number
        recipeUnits: Array<{
          recipeId: string
          units: number
        }>
      }> = []

      for (const sourceSelection of baseSelections) {
        const sourceRecipe = recipeById.get(
          sourceSelection.recipeId,
        )
        if (!sourceRecipe) continue
        const serviceGroup =
          stage2RecipesByServiceMask.get(
            recipeServiceMask(sourceRecipe),
          ) ?? []

        for (const targetRecipe of serviceGroup) {
          if (
            targetRecipe.candidate.id ===
            sourceRecipe.candidate.id
          ) {
            continue
          }
          if (
            targetRecipe.juiceUnitIngredientCost !==
            sourceRecipe.juiceUnitIngredientCost
          ) {
            continue
          }

          const targetCurrentUnits =
            unitsByRecipeId.get(targetRecipe.candidate.id) ?? 0
          const targetUpperBound =
            tightenedXUpperBoundByRecipeId.get(
              targetRecipe.candidate.id,
            ) ?? 0
          const maxTransfer = Math.min(
            sourceSelection.units,
            Math.max(0, targetUpperBound - targetCurrentUnits),
          )

          for (
            let transferredUnits = 1;
            transferredUnits <= maxTransfer;
            transferredUnits += 1
          ) {
            const candidateUnits = new Map(unitsByRecipeId)
            candidateUnits.set(
              sourceRecipe.candidate.id,
              (candidateUnits.get(sourceRecipe.candidate.id) ?? 0) -
                transferredUnits,
            )
            candidateUnits.set(
              targetRecipe.candidate.id,
              targetCurrentUnits + transferredUnits,
            )
            const recipeUnits = [...candidateUnits.entries()]
              .filter(([, units]) => units > 0)
              .map(([recipeId, units]) => ({
                recipeId,
                units,
              }))
            candidates.push({
              machineOperations:
                machineOperationBreakdownForSelection(
                  recipeUnits,
                ).total,
              sourceRecipeId: sourceRecipe.candidate.id,
              targetRecipeId: targetRecipe.candidate.id,
              transferredUnits,
              recipeUnits,
            })
          }
        }
      }

      return candidates
    }

    const lowerBoundWitnessSearches = {
      throughSeasoning:
        throughSeasoningMachineFirstStage?.status === 'optimal'
          ? descendServiceEquivalentSelection(
              throughSeasoningMachineFirstStage.selectedRecipeUnits,
            )
          : null,
      blending:
        blendingOnlyMachineFirstStage?.status === 'optimal'
          ? descendServiceEquivalentSelection(
              blendingOnlyMachineFirstStage.selectedRecipeUnits,
            )
          : null,
      finalizing:
        finalizingOnlyMachineFirstStage?.status === 'optimal'
          ? descendServiceEquivalentSelection(
              finalizingOnlyMachineFirstStage.selectedRecipeUnits,
            )
          : null,
    }

    const certifiedLowerBoundWitnessEntry =
      combinedMachineOperationLowerBound === null
        ? undefined
        : Object.entries(lowerBoundWitnessSearches).find(
            ([, search]) =>
              search?.breakdown.total ===
              combinedMachineOperationLowerBound,
          )
    const certifiedLowerBoundWitness =
      certifiedLowerBoundWitnessEntry?.[1]
        ? {
            source: certifiedLowerBoundWitnessEntry[0],
            search: certifiedLowerBoundWitnessEntry[1],
          }
        : null

    const lowerBoundWitnessFixedVerification =
      certifiedLowerBoundWitness &&
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 2.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              fixedRecipeUnits:
                certifiedLowerBoundWitness.search.recipeUnits,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const postCertificateJarHighs =
      lowerBoundWitnessFixedVerification?.stages[0]?.status ===
        'optimal' &&
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null &&
      combinedMachineOperationLowerBound !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-jar-switches'],
            {
              stageTimeLimitSeconds: 10.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
                {
                  criterion: 'minimum-machine-operations',
                  value: combinedMachineOperationLowerBound,
                },
              ],
            },
          )
        : null

    const stage1LocalDescentSteps: Array<{
      from: number
      to: number
      sourceRecipeId: string | null
      targetRecipeId: string | null
      transferredUnits: number
      evaluatedMoves: number
    }> = []
    let stage1LocalDescentRecipeUnits =
      compressedCostStage?.selectedRecipeUnits.map((selection) => ({
        recipeId: selection.recipeId,
        units: Math.round(selection.units),
      })) ?? []

    for (
      let stepIndex = 0;
      stepIndex < 4 &&
      stage1LocalDescentRecipeUnits.length > 0;
      stepIndex += 1
    ) {
      const step = searchOneServiceEquivalentTransfer(
        stage1LocalDescentRecipeUnits,
      )
      if (
        !step.bestRecipeUnits ||
        step.bestMachineOperations >= step.baseMachineOperations
      ) {
        break
      }
      stage1LocalDescentSteps.push({
        from: step.baseMachineOperations,
        to: step.bestMachineOperations,
        sourceRecipeId: step.sourceRecipeId,
        targetRecipeId: step.targetRecipeId,
        transferredUnits: step.transferredUnits,
        evaluatedMoves: step.evaluatedMoves,
      })
      stage1LocalDescentRecipeUnits = step.bestRecipeUnits
      if (
        combinedMachineOperationLowerBound !== null &&
        step.bestMachineOperations <=
          combinedMachineOperationLowerBound
      ) {
        break
      }
    }

    const stage1LocalDescentBreakdown =
      stage1LocalDescentRecipeUnits.length > 0
        ? machineOperationBreakdownForSelection(
            stage1LocalDescentRecipeUnits,
          )
        : null

    const stage1DepthTwoSearch = (() => {
      if (
        !stage1LocalDescentBreakdown ||
        stage1LocalDescentRecipeUnits.length === 0 ||
        combinedMachineOperationLowerBound === null ||
        stage1LocalDescentBreakdown.total <=
          combinedMachineOperationLowerBound
      ) {
        return null
      }

      let bestMachineOperations =
        stage1LocalDescentBreakdown.total
      let bestRecipeUnits: Array<{
        recipeId: string
        units: number
      }> | null = null
      let bestMoves:
        | Array<{
            sourceRecipeId: string
            targetRecipeId: string
            transferredUnits: number
          }>
        | null = null
      let evaluatedFirstMoves = 0
      let evaluatedSecondMoves = 0

      const firstCandidates =
        enumerateServiceEquivalentTransferCandidates(
          stage1LocalDescentRecipeUnits,
        )

      for (const first of firstCandidates) {
        evaluatedFirstMoves += 1
        if (
          first.machineOperations >
          stage1LocalDescentBreakdown.total + 1
        ) {
          continue
        }

        const secondCandidates =
          enumerateServiceEquivalentTransferCandidates(
            first.recipeUnits,
          )
        for (const second of secondCandidates) {
          evaluatedSecondMoves += 1
          if (
            second.machineOperations <
            bestMachineOperations
          ) {
            bestMachineOperations =
              second.machineOperations
            bestRecipeUnits = second.recipeUnits
            bestMoves = [
              {
                sourceRecipeId: first.sourceRecipeId,
                targetRecipeId: first.targetRecipeId,
                transferredUnits: first.transferredUnits,
              },
              {
                sourceRecipeId: second.sourceRecipeId,
                targetRecipeId: second.targetRecipeId,
                transferredUnits: second.transferredUnits,
              },
            ]
            if (
              bestMachineOperations <=
              combinedMachineOperationLowerBound
            ) {
              return {
                baseMachineOperations:
                  stage1LocalDescentBreakdown.total,
                bestMachineOperations,
                bestMoves,
                bestRecipeUnits,
                evaluatedFirstMoves,
                evaluatedSecondMoves,
                bestBreakdown:
                  machineOperationBreakdownForSelection(
                    bestRecipeUnits,
                  ),
              }
            }
          }
        }
      }

      return {
        baseMachineOperations:
          stage1LocalDescentBreakdown.total,
        bestMachineOperations,
        bestMoves,
        bestRecipeUnits,
        evaluatedFirstMoves,
        evaluatedSecondMoves,
        bestBreakdown: bestRecipeUnits
          ? machineOperationBreakdownForSelection(
              bestRecipeUnits,
            )
          : null,
      }
    })()

    const stage1DepthTwoFixedVerification =
      stage1DepthTwoSearch?.bestMachineOperations ===
        combinedMachineOperationLowerBound &&
      stage1DepthTwoSearch.bestRecipeUnits &&
      compressedCostStage?.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 2.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              fixedRecipeUnits:
                stage1DepthTwoSearch.bestRecipeUnits,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    const stage1LocalDescentFixedVerification =
      stage1LocalDescentBreakdown?.total ===
        combinedMachineOperationLowerBound &&
      stage1LocalDescentRecipeUnits.length > 0 &&
      compressedCostStage?.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 2.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              fixedRecipeUnits: stage1LocalDescentRecipeUnits,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    let oneTransferMachineSearch:
      | {
          baseMachineOperations: number
          bestMachineOperations: number
          sourceRecipeId: string | null
          targetRecipeId: string | null
          transferredUnits: number
          evaluatedMoves: number
          baseBreakdown: ReturnType<
            typeof machineOperationBreakdownForSelection
          >
          bestRecipeUnits: Array<{
            recipeId: string
            units: number
          }> | null
        }
      | null = null

    if (
      exactFiftyOneMachineFirstStage?.objectiveValue !== null &&
      exactFiftyOneMachineFirstStage?.selectedRecipeUnits.length
    ) {
      const baseSelections =
        exactFiftyOneMachineFirstStage.selectedRecipeUnits.map(
          (selection) => ({
            recipeId: selection.recipeId,
            units: Math.round(selection.units),
          }),
        )
      const baseBreakdown =
        machineOperationBreakdownForSelection(baseSelections)
      const unitsByRecipeId = new Map(
        baseSelections.map((selection) => [
          selection.recipeId,
          selection.units,
        ]),
      )
      const recipeById = new Map(
        strictCostPrunedRecipes.map((recipe) => [
          recipe.candidate.id,
          recipe,
        ]),
      )
      const edgeMultiplicityByRecipeId = new Map<
        string,
        Map<string, number>
      >()
      const edgeQuantityByKey = new Map<string, number>()

      for (const selection of baseSelections) {
        const recipe = recipeById.get(selection.recipeId)
        if (!recipe) continue
        const multiplicityByEdgeKey = new Map<string, number>()
        for (const edge of recipe.productionPath.edges) {
          multiplicityByEdgeKey.set(
            edge.key,
            (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
          )
          edgeQuantityByKey.set(
            edge.key,
            (edgeQuantityByKey.get(edge.key) ?? 0) +
              selection.units,
          )
        }
        edgeMultiplicityByRecipeId.set(
          selection.recipeId,
          multiplicityByEdgeKey,
        )
      }

      const multiplicityForRecipe = (
        recipe: (typeof strictCostPrunedRecipes)[number],
      ) => {
        const existing = edgeMultiplicityByRecipeId.get(
          recipe.candidate.id,
        )
        if (existing) return existing
        const multiplicity = new Map<string, number>()
        for (const edge of recipe.productionPath.edges) {
          multiplicity.set(
            edge.key,
            (multiplicity.get(edge.key) ?? 0) + 1,
          )
        }
        edgeMultiplicityByRecipeId.set(
          recipe.candidate.id,
          multiplicity,
        )
        return multiplicity
      }

      let bestMachineOperations = baseBreakdown.total
      let bestMove:
        | {
            sourceRecipeId: string
            targetRecipeId: string
            transferredUnits: number
          }
        | null = null
      let evaluatedMoves = 0

      for (const sourceSelection of baseSelections) {
        const sourceRecipe = recipeById.get(
          sourceSelection.recipeId,
        )
        if (!sourceRecipe) continue
        const serviceGroup =
          stage2RecipesByServiceMask.get(
            recipeServiceMask(sourceRecipe),
          ) ?? []
        const sourceMultiplicity =
          multiplicityForRecipe(sourceRecipe)

        for (const targetRecipe of serviceGroup) {
          if (
            targetRecipe.candidate.id ===
            sourceRecipe.candidate.id
          ) {
            continue
          }
          if (
            targetRecipe.juiceUnitIngredientCost !==
            sourceRecipe.juiceUnitIngredientCost
          ) {
            continue
          }

          const targetCurrentUnits =
            unitsByRecipeId.get(targetRecipe.candidate.id) ?? 0
          const targetUpperBound =
            tightenedXUpperBoundByRecipeId.get(
              targetRecipe.candidate.id,
            ) ?? 0
          const maxTransfer = Math.min(
            sourceSelection.units,
            Math.max(0, targetUpperBound - targetCurrentUnits),
          )
          if (maxTransfer <= 0) continue

          const targetMultiplicity =
            multiplicityForRecipe(targetRecipe)
          const affectedEdgeKeys = new Set([
            ...sourceMultiplicity.keys(),
            ...targetMultiplicity.keys(),
          ])

          for (
            let transferredUnits = 1;
            transferredUnits <= maxTransfer;
            transferredUnits += 1
          ) {
            evaluatedMoves += 1
            let operationDelta = 0

            for (const edgeKey of affectedEdgeKeys) {
              const oldQuantity =
                edgeQuantityByKey.get(edgeKey) ?? 0
              const newQuantity =
                oldQuantity +
                transferredUnits *
                  (
                    (targetMultiplicity.get(edgeKey) ?? 0) -
                    (sourceMultiplicity.get(edgeKey) ?? 0)
                  )
              operationDelta +=
                Math.ceil(
                  Math.max(0, newQuantity) /
                    PROCESSING_STACK_CAPACITY,
                ) -
                Math.ceil(
                  oldQuantity / PROCESSING_STACK_CAPACITY,
                )
            }

            const candidateMachineOperations =
              baseBreakdown.total + operationDelta
            if (
              candidateMachineOperations <
              bestMachineOperations
            ) {
              bestMachineOperations =
                candidateMachineOperations
              bestMove = {
                sourceRecipeId: sourceRecipe.candidate.id,
                targetRecipeId: targetRecipe.candidate.id,
                transferredUnits,
              }
            }
          }
        }
      }

      let bestRecipeUnits:
        | Array<{ recipeId: string; units: number }>
        | null = null
      if (bestMove) {
        const candidateUnits = new Map(unitsByRecipeId)
        candidateUnits.set(
          bestMove.sourceRecipeId,
          (candidateUnits.get(bestMove.sourceRecipeId) ?? 0) -
            bestMove.transferredUnits,
        )
        candidateUnits.set(
          bestMove.targetRecipeId,
          (candidateUnits.get(bestMove.targetRecipeId) ?? 0) +
            bestMove.transferredUnits,
        )
        bestRecipeUnits = [...candidateUnits.entries()]
          .filter(([, units]) => units > 0)
          .map(([recipeId, units]) => ({ recipeId, units }))
      }

      oneTransferMachineSearch = {
        baseMachineOperations: baseBreakdown.total,
        bestMachineOperations,
        sourceRecipeId: bestMove?.sourceRecipeId ?? null,
        targetRecipeId: bestMove?.targetRecipeId ?? null,
        transferredUnits: bestMove?.transferredUnits ?? 0,
        evaluatedMoves,
        baseBreakdown,
        bestRecipeUnits,
      }
    }

    const oneTransferFixedVerification =
      oneTransferMachineSearch?.bestMachineOperations === 50 &&
      oneTransferMachineSearch.bestRecipeUnits &&
      compressedCostStage?.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 2.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
              tightenRecipeBoundsFromMinimumCostFix: true,
              tightenOperationBoundsFromRecipeBounds: true,
              fixedRecipeUnits:
                oneTransferMachineSearch.bestRecipeUnits,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null

    type WarmStartComparison = {
      wrapperVersion: string
      incumbentMachineOperations: number
      cold: {
        solveMs: number
        modelStatus: number
        primalSolutionStatus: number
        hasFeasiblePrimal: boolean
        objectiveValue: number | null
        mipDualBound: number
        mipGap: number
        mipNodeCount: number
      }
      warm: {
        solveMs: number
        modelStatus: number
        primalSolutionStatus: number
        hasFeasiblePrimal: boolean
        objectiveValue: number | null
        mipDualBound: number
        mipGap: number
        mipNodeCount: number
        seedStatus: number
        mappedSeedColumnCount: number
        expectedSeedColumnCount: number
      }
    }

    let warmStartHighsComparison: WarmStartComparison | null = null
    let binaryEncodedWarmStartComparison:
      | WarmStartComparison
      | null = null
    let decomposedBoundWarmStartComparison:
      | WarmStartComparison['warm']
      | null = null

    const baselineWarmStartMps: string | undefined = undefined
    const baselineWarmStartSolutionValues =
      fixedIncumbentMachineFirstStage?.capturedSolutionValues
    const decomposedBoundWarmStartMps =
      decomposedBoundMachineFirstStage?.capturedMps

    if (
      (
        baselineWarmStartMps &&
        baselineWarmStartSolutionValues?.length
      ) ||
      (
        decomposedBoundWarmStartMps &&
        baselineWarmStartSolutionValues?.length
      )
    ) {
      const { default: loadHighs } = await import('highs')
      const highs = await loadHighs()

      const runComparison = (
        mps: string,
        solutionValues: Array<{
          name: string
          value: number
        }>,
      ): WarmStartComparison => {
        const encodedMps = new TextEncoder().encode(mps)

        const readProfile = (
          profileModel: ReturnType<typeof highs.createModel>,
          solveMs: number,
        ) => {
          const primalSolutionStatus = Number(
            profileModel.info.get('primal_solution_status'),
          )
          const hasFeasiblePrimal =
            primalSolutionStatus ===
            highs.constants.solutionStatus.feasible

          return {
            solveMs,
            modelStatus: profileModel.getModelStatus(),
            primalSolutionStatus,
            hasFeasiblePrimal,
            objectiveValue: hasFeasiblePrimal
              ? profileModel.getObjectiveValue()
              : null,
            mipDualBound: Number(
              profileModel.info.get('mip_dual_bound'),
            ),
            mipGap: Number(profileModel.info.get('mip_gap')),
            mipNodeCount: Number(
              profileModel.info.get('mip_node_count'),
            ),
          }
        }

        const coldModel = highs.createModel({
          format: 'mps',
          data: encodedMps,
        })
        let coldProfile
        try {
          coldModel.options.set({
            output_flag: false,
            time_limit: 5.5,
            mip_rel_gap: 0,
          })
          const coldStartedAt = performance.now()
          coldModel.run()
          coldProfile = readProfile(
            coldModel,
            performance.now() - coldStartedAt,
          )
        } finally {
          coldModel.dispose()
        }

        const warmModel = highs.createModel({
          format: 'mps',
          data: encodedMps,
        })
        try {
          warmModel.options.set({
            output_flag: false,
            time_limit: 5.5,
            mip_rel_gap: 0,
          })
          const dimensions = warmModel.getDimensions()
          const colValue = new Float64Array(dimensions.numCols)
          let mappedSeedColumnCount = 0

          for (const entry of solutionValues) {
            const columnIndex = warmModel.getColByName(entry.name)
            colValue[columnIndex] = entry.value
            mappedSeedColumnCount += 1
          }

          const seedResult = warmModel.setSolution({ colValue })
          const warmStartedAt = performance.now()
          warmModel.run()
          const warmProfile = readProfile(
            warmModel,
            performance.now() - warmStartedAt,
          )

          return {
            wrapperVersion: highs.version.string,
            incumbentMachineOperations:
              compressedIncumbentMachineOperations,
            cold: coldProfile,
            warm: {
              ...warmProfile,
              seedStatus: seedResult.status,
              mappedSeedColumnCount,
              expectedSeedColumnCount: solutionValues.length,
            },
          }
        } finally {
          warmModel.dispose()
        }
      }

      const runWarmOnly = (
        mps: string,
        solutionValues: Array<{
          name: string
          value: number
        }>,
      ): WarmStartComparison['warm'] => {
        const encodedMps = new TextEncoder().encode(mps)
        const warmModel = highs.createModel({
          format: 'mps',
          data: encodedMps,
        })
        try {
          warmModel.options.set({
            output_flag: false,
            time_limit: 5.5,
            mip_rel_gap: 0,
          })
          const dimensions = warmModel.getDimensions()
          const colValue = new Float64Array(dimensions.numCols)
          let mappedSeedColumnCount = 0

          for (const entry of solutionValues) {
            const columnIndex = warmModel.getColByName(entry.name)
            colValue[columnIndex] = entry.value
            mappedSeedColumnCount += 1
          }

          const seedResult = warmModel.setSolution({ colValue })
          const warmStartedAt = performance.now()
          warmModel.run()
          const solveMs = performance.now() - warmStartedAt
          const primalSolutionStatus = Number(
            warmModel.info.get('primal_solution_status'),
          )
          const hasFeasiblePrimal =
            primalSolutionStatus ===
            highs.constants.solutionStatus.feasible

          return {
            solveMs,
            modelStatus: warmModel.getModelStatus(),
            primalSolutionStatus,
            hasFeasiblePrimal,
            objectiveValue: hasFeasiblePrimal
              ? warmModel.getObjectiveValue()
              : null,
            mipDualBound: Number(
              warmModel.info.get('mip_dual_bound'),
            ),
            mipGap: Number(warmModel.info.get('mip_gap')),
            mipNodeCount: Number(
              warmModel.info.get('mip_node_count'),
            ),
            seedStatus: seedResult.status,
            mappedSeedColumnCount,
            expectedSeedColumnCount: solutionValues.length,
          }
        } finally {
          warmModel.dispose()
        }
      }

      if (
        baselineWarmStartMps &&
        baselineWarmStartSolutionValues?.length &&
        fixedIncumbentMachineFirstStage?.status === 'optimal'
      ) {
        warmStartHighsComparison = runComparison(
          baselineWarmStartMps,
          baselineWarmStartSolutionValues,
        )
      }

      if (
        decomposedBoundWarmStartMps &&
        baselineWarmStartSolutionValues?.length &&
        fixedIncumbentMachineFirstStage?.status === 'optimal'
      ) {
        decomposedBoundWarmStartComparison = runWarmOnly(
          decomposedBoundWarmStartMps,
          baselineWarmStartSolutionValues,
        )
      }
    }

    const report = {
      progress: request.currentProgress,
      candidatePolicy: request.candidatePolicy,
      canonicalCustomerCount: canonicalCustomers.length,
      serviceableCustomerCount: model.serviceableCustomerIds.length,
      unresolvedCustomerCount: model.unresolvedCustomerIds.length,
      candidatePoolEntries: candidatePool.entries.length,
      generatedCurrentCandidates: generatedCurrentCandidates.length,
      optimizerBaseEligibleRecipes:
        optimizerBaseEligibleCandidates.length,
      knownSalePriceBaseEligibleRecipes:
        knownSalePriceBaseEligibleCandidates.length,
      customerMatchedOptimizerRecipes: model.recipes.length,
      customerRecipeAssignmentEligibility: assignmentEligibilityCount,
      yVariables: assignmentEligibilityCount,
      customerEligibilityGroupCount: customerGroupsByEligibility.size,
      customerEligibilityGroupSizes,
      groupedAssignmentVariableUpperBound,
      xVariables: model.recipes.length,
      zVariables: model.recipes.length,
      productionEdgeVariables: productionEdgeCount,
      recipeServiceSetCount: recipesByServiceMask.size,
      recipeServiceGroupSizes: recipeServiceGroupSizes.slice(0, 20),
      exactServiceSetCheaperDominatedRecipeCount:
        exactServiceSetCheaperDominatedRecipeIds.size,
      strictlyCheaperOtherSupersetDominatedRecipeCount:
        strictlyCheaperOtherSupersetDominatedRecipeIds.size,
      strictCostSupersetDominatedRecipeCount:
        strictCostSupersetDominatedRecipeIds.size,
      nondominatedServiceSetCount,
      recipesRemainingAfterStrictCostSupersetDominance:
        strictCostPrunedRecipes.length,
      assignmentEligibilityRemainingAfterStrictCostSupersetDominance:
        strictCostPrunedAssignmentEligibility,
      costStageCompressedRecipeCount:
        costStageCompressedRecipes.length,
      costStageCompressedAssignmentEligibility:
        costStageCompressedAssignmentEligibility,
      stage2MachineEquivalenceGroupCount:
        machineEquivalenceGroups.size,
      stage2MachineEquivalenceGroupSizes:
        machineEquivalenceGroupSizes.slice(0, 20),
      stage2MachineEquivalenceReducibleRecipeCount:
        machineEquivalenceReducibleRecipeCount,
      stage2MachineEquivalenceAssignmentEligibility:
        machineEquivalenceAssignmentEligibility,
      stage2UniqueProductionEdgeCount: stage2EdgeUsage.size,
      stage2SingletonProductionEdgeCount:
        stage2SingletonEdgeCount,
      stage2SharedProductionEdgeCount:
        stage2SharedEdgeCount,
      stage2TopProductionEdgeRecipeUsageCounts:
        edgeRecipeUsageCounts.slice(0, 20),
      stage2ProductionEdgeKindStats: edgeKindStats,
      stage2ConservativeNormalizedMachineEquivalence:
        conservativeNormalizedMachineStats,
      stage2TotalOnlyNormalizedMachineEquivalence:
        totalOnlyNormalizedMachineStats,
      stage2SharedJuicingGrouping,
      stage2SharedJuicingSeasoningGrouping,
      stage2SharedJuicingSeasoningBlendingGrouping,
      stage2SingletonEdgeCountsByRecipe:
        singletonEdgeCountsByRecipe.slice(0, 20),
      stage2RecipesWithSingletonEdges: recipesWithSingletonEdges,
      stage2RecipesWithAllSingletonMultiplicityOne:
        recipesWithAllSingletonMultiplicityOne,
      stage2SingletonEdgesWithMultiplicityGreaterThanOne:
        singletonEdgesWithMultiplicityGreaterThanOne,
      stage2SingletonMultiplicityPatterns:
        singletonMultiplicityPatternCounts.slice(0, 20),
      stage2LocalOperationVariableCountByDistinctMultiplicity:
        localOperationVariableCountByDistinctMultiplicity,
      stage2OperationVariableCountAfterLocalMultiplicityCompression:
        operationVariableCountAfterLocalMultiplicityCompression,
      stage2OperationVariableReductionFromLocalCompression:
        operationVariableReductionFromLocalCompression,
      stage2ProjectedVariableCountAfterLocalCompression:
        projectedStage2VariableCountAfterLocalCompression,
      stage2ProjectedConstraintCountAfterLocalCompression:
        projectedStage2ConstraintCountAfterLocalCompression,
      stage2FixedMinimumCost: fixedMinimumCost,
      stage1CompressedIncumbent: {
        selectedRecipeCount:
          compressedCostStage?.selectedRecipeUnits.length ?? 0,
        productionUnits: compressedIncumbentProductionUnits,
        cost: compressedIncumbentCost,
        machineOperations:
          compressedIncumbentMachineOperations,
      },
      stage2DistinctRecipeCostCount:
        strictCostDistinctCosts.length,
      stage2RecipeCostRange: {
        min: strictCostDistinctCosts.at(0) ?? null,
        max: strictCostDistinctCosts.at(-1) ?? null,
      },
      stage2NonIntegerOrNegativeRecipeCostCount:
        strictCostNonIntegerCostCount,
      stage2ExactCostReachableCostCount:
        exactCostReachableRecipeCosts.size,
      stage2CostFixFeasibleCostCount:
        costFixFeasibleRecipeCosts.size,
      stage2RecipesRejectedByExactCostFix:
        recipesRejectedByExactCostFix.length,
      stage2RecipesRejectedByCostFixAndMinimumUnits:
        recipesRejectedByCostFixAndMinimumUnits.length,
      stage2RecipesRemainingAfterCostFixNecessaryConditions:
        recipesRemainingAfterCostFixNecessaryConditions,
      stage2ServiceGroupCountAfterStrictCostPruning:
        stage2RecipesByServiceMask.size,
      stage2NonUniformCostServiceGroupCount:
        stage2NonUniformCostServiceGroupCount,
      stage2GroupAssignmentEligibility:
        stage2GroupAssignmentEligibility,
      stage2ProjectedVariablesWithGroupAssignments:
        stage2ProjectedVariablesWithGroupAssignments,
      stage2ProjectedConstraintsWithGroupAssignments:
        stage2ProjectedConstraintsWithGroupAssignments,
      stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps:
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps:
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps,
      stage2DefaultXUpperBound: maxJuiceUnitsPerRecipe,
      stage2RecipesWithTightenedXUpperBound:
        stage2RecipesWithTightenedXUpperBound,
      stage2RecipesWithXUpperBoundOne:
        stage2RecipesWithXUpperBoundOne,
      stage2RecipesWithXUpperBoundAtMostTwo:
        stage2RecipesWithXUpperBoundAtMostTwo,
      stage2AverageTightenedXUpperBound:
        stage2AverageTightenedXUpperBound,
      stage2XUpperBoundHistogram:
        stage2XUpperBoundHistogram,
      stage2ProjectedOperationUpperBoundHistogram,
      stage2OperationVarsWithUpperBoundOne,
      stage2OperationVarsWithUpperBoundAtMostTwo,
      stage2MaxProjectedOperationUpperBound,
      stage2AverageProjectedOperationUpperBound,
      stage2MachineDominatedRecipeCount:
        machineDominatedRecipeIds.size,
      stage2MachineFrontierRecipeCount:
        stage2MachineFrontierRecipes.length,
      stage2MachineFrontierGroupSizes:
        stage2MachineFrontierGroupSizes.slice(0, 20),
      finalHighsVariables: binaryHighs.finalVariableCount,
      finalHighsConstraints: binaryHighs.finalConstraintCount,
      candidateGenerationMs,
      optimizerModelBuildMs: modelBuildMs,
      solverModuleImportMs,
      binaryAssignment: {
        solveMs: binaryFirstStage?.solveMs ?? 0,
        status: binaryFirstStage?.status ?? 'missing',
        objectiveValue: binaryFirstStage?.objectiveValue ?? null,
        variableCount: binaryFirstStage?.variableCount ?? 0,
        constraintCount: binaryFirstStage?.constraintCount ?? 0,
        totalMs: binaryHighs.totalMs,
      },
      relaxedAssignment: {
        solveMs: relaxedFirstStage?.solveMs ?? 0,
        status: relaxedFirstStage?.status ?? 'missing',
        objectiveValue: relaxedFirstStage?.objectiveValue ?? null,
        variableCount: relaxedFirstStage?.variableCount ?? 0,
        constraintCount: relaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          relaxedFirstStage?.fractionalAssignmentVariableCount ?? 0,
        maxAssignmentIntegralityError:
          relaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          relaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          relaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: relaxedHighs.totalMs,
      },
      prunedRelaxedAssignment: {
        solveMs: prunedRelaxedFirstStage?.solveMs ?? 0,
        status: prunedRelaxedFirstStage?.status ?? 'missing',
        objectiveValue: prunedRelaxedFirstStage?.objectiveValue ?? null,
        variableCount: prunedRelaxedFirstStage?.variableCount ?? 0,
        constraintCount: prunedRelaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          prunedRelaxedFirstStage?.fractionalAssignmentVariableCount ?? 0,
        maxAssignmentIntegralityError:
          prunedRelaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          prunedRelaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          prunedRelaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: prunedRelaxedHighs.totalMs,
      },
      compressedRelaxedAssignment: {
        solveMs: compressedRelaxedFirstStage?.solveMs ?? 0,
        status: compressedRelaxedFirstStage?.status ?? 'missing',
        objectiveValue:
          compressedRelaxedFirstStage?.objectiveValue ?? null,
        variableCount:
          compressedRelaxedFirstStage?.variableCount ?? 0,
        constraintCount:
          compressedRelaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          compressedRelaxedFirstStage?.fractionalAssignmentVariableCount ??
          0,
        maxAssignmentIntegralityError:
          compressedRelaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          compressedRelaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          compressedRelaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: compressedRelaxedHighs.totalMs,
      },
      expandedCostFeasibilityStage:
        expandedCostFeasibilityFirstStage
          ? {
              solveMs: expandedCostFeasibilityFirstStage.solveMs,
              status: expandedCostFeasibilityFirstStage.status,
              objectiveValue:
                expandedCostFeasibilityFirstStage.objectiveValue,
              fixCount:
                expandedCostFeasibilityFirstStage.fixCount,
              variableCount:
                expandedCostFeasibilityFirstStage.variableCount,
              constraintCount:
                expandedCostFeasibilityFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                expandedCostFeasibilityFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                expandedCostFeasibilityFirstStage.reconstructedAssignmentCount,
              totalMs:
                expandedCostFeasibilityHighs?.totalMs ?? 0,
            }
          : null,
      expandedMachineStage: expandedMachineFirstStage
        ? {
            solveMs: expandedMachineFirstStage.solveMs,
            status: expandedMachineFirstStage.status,
            objectiveValue:
              expandedMachineFirstStage.objectiveValue,
            fixCount: expandedMachineFirstStage.fixCount,
            variableCount: expandedMachineFirstStage.variableCount,
            constraintCount:
              expandedMachineFirstStage.constraintCount,
            fractionalAssignmentVariableCount:
              expandedMachineFirstStage.fractionalAssignmentVariableCount,
            maxAssignmentIntegralityError:
              expandedMachineFirstStage.maxAssignmentIntegralityError,
            integralAssignmentReconstructionFeasible:
              expandedMachineFirstStage.integralAssignmentReconstructionFeasible,
            reconstructedAssignmentCount:
              expandedMachineFirstStage.reconstructedAssignmentCount,
            totalMs: expandedMachineHighs?.totalMs ?? 0,
          }
        : null,
      localCompressedMachineStage:
        localCompressedMachineFirstStage
          ? {
              solveMs: localCompressedMachineFirstStage.solveMs,
              status: localCompressedMachineFirstStage.status,
              objectiveValue:
                localCompressedMachineFirstStage.objectiveValue,
              fixCount:
                localCompressedMachineFirstStage.fixCount,
              variableCount:
                localCompressedMachineFirstStage.variableCount,
              constraintCount:
                localCompressedMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                localCompressedMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                localCompressedMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                localCompressedMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                localCompressedMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                localCompressedMachineHighs?.totalMs ?? 0,
            }
          : null,
      groupedAssignmentMachineStage:
        groupedAssignmentMachineFirstStage
          ? {
              solveMs: groupedAssignmentMachineFirstStage.solveMs,
              status: groupedAssignmentMachineFirstStage.status,
              objectiveValue:
                groupedAssignmentMachineFirstStage.objectiveValue,
              fixCount:
                groupedAssignmentMachineFirstStage.fixCount,
              variableCount:
                groupedAssignmentMachineFirstStage.variableCount,
              constraintCount:
                groupedAssignmentMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                groupedAssignmentMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                groupedAssignmentMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                groupedAssignmentMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                groupedAssignmentMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                groupedAssignmentMachineHighs?.totalMs ?? 0,
            }
          : null,
      tightBoundMachineStage:
        tightBoundMachineFirstStage
          ? {
              solveMs: tightBoundMachineFirstStage.solveMs,
              status: tightBoundMachineFirstStage.status,
              objectiveValue:
                tightBoundMachineFirstStage.objectiveValue,
              fixCount: tightBoundMachineFirstStage.fixCount,
              variableCount:
                tightBoundMachineFirstStage.variableCount,
              constraintCount:
                tightBoundMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                tightBoundMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                tightBoundMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                tightBoundMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                tightBoundMachineFirstStage.reconstructedAssignmentCount,
              totalMs: tightBoundMachineHighs?.totalMs ?? 0,
            }
          : null,
      juicingOnlyMachineStage:
        juicingOnlyMachineFirstStage
          ? {
              solveMs: juicingOnlyMachineFirstStage.solveMs,
              status: juicingOnlyMachineFirstStage.status,
              objectiveValue: juicingOnlyMachineFirstStage.objectiveValue,
              variableCount: juicingOnlyMachineFirstStage.variableCount,
              constraintCount: juicingOnlyMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                juicingOnlyMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                juicingOnlyMachineFirstStage.reconstructedAssignmentCount,
              totalMs: juicingOnlyMachineHighs?.totalMs ?? 0,
            }
          : null,
      throughSeasoningMachineStage:
        throughSeasoningMachineFirstStage
          ? {
              solveMs: throughSeasoningMachineFirstStage.solveMs,
              status: throughSeasoningMachineFirstStage.status,
              objectiveValue: throughSeasoningMachineFirstStage.objectiveValue,
              variableCount: throughSeasoningMachineFirstStage.variableCount,
              constraintCount: throughSeasoningMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                throughSeasoningMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                throughSeasoningMachineFirstStage.reconstructedAssignmentCount,
              totalMs: throughSeasoningMachineHighs?.totalMs ?? 0,
            }
          : null,
      blendingOnlyMachineStage:
        blendingOnlyMachineFirstStage
          ? {
              solveMs: blendingOnlyMachineFirstStage.solveMs,
              status: blendingOnlyMachineFirstStage.status,
              objectiveValue: blendingOnlyMachineFirstStage.objectiveValue,
              variableCount: blendingOnlyMachineFirstStage.variableCount,
              constraintCount: blendingOnlyMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                blendingOnlyMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                blendingOnlyMachineFirstStage.reconstructedAssignmentCount,
              totalMs: blendingOnlyMachineHighs?.totalMs ?? 0,
            }
          : null,
      throughBlendingMachineStage:
        throughBlendingMachineFirstStage
          ? {
              solveMs: throughBlendingMachineFirstStage.solveMs,
              status: throughBlendingMachineFirstStage.status,
              objectiveValue: throughBlendingMachineFirstStage.objectiveValue,
              variableCount: throughBlendingMachineFirstStage.variableCount,
              constraintCount: throughBlendingMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                throughBlendingMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                throughBlendingMachineFirstStage.reconstructedAssignmentCount,
              totalMs: throughBlendingMachineHighs?.totalMs ?? 0,
            }
          : null,
      sharedBlendingMachineStage:
        sharedBlendingMachineFirstStage
          ? {
              solveMs: sharedBlendingMachineFirstStage.solveMs,
              status: sharedBlendingMachineFirstStage.status,
              objectiveValue: sharedBlendingMachineFirstStage.objectiveValue,
              variableCount: sharedBlendingMachineFirstStage.variableCount,
              constraintCount: sharedBlendingMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                sharedBlendingMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                sharedBlendingMachineFirstStage.reconstructedAssignmentCount,
              totalMs: sharedBlendingMachineHighs?.totalMs ?? 0,
            }
          : null,
      singletonBlendingMachineStage:
        singletonBlendingMachineFirstStage
          ? {
              solveMs: singletonBlendingMachineFirstStage.solveMs,
              status: singletonBlendingMachineFirstStage.status,
              objectiveValue: singletonBlendingMachineFirstStage.objectiveValue,
              variableCount: singletonBlendingMachineFirstStage.variableCount,
              constraintCount: singletonBlendingMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                singletonBlendingMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                singletonBlendingMachineFirstStage.reconstructedAssignmentCount,
              totalMs: singletonBlendingMachineHighs?.totalMs ?? 0,
            }
          : null,
      tightOperationBoundMachineStage:
        tightOperationBoundMachineFirstStage
          ? {
              solveMs: tightOperationBoundMachineFirstStage.solveMs,
              status: tightOperationBoundMachineFirstStage.status,
              objectiveValue:
                tightOperationBoundMachineFirstStage.objectiveValue,
              variableCount:
                tightOperationBoundMachineFirstStage.variableCount,
              constraintCount:
                tightOperationBoundMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                tightOperationBoundMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                tightOperationBoundMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                tightOperationBoundMachineHighs?.totalMs ?? 0,
            }
          : null,
      belowFiftyMachineStage:
        belowFiftyMachineFirstStage
          ? {
              solveMs: belowFiftyMachineFirstStage.solveMs,
              status: belowFiftyMachineFirstStage.status,
              objectiveValue:
                belowFiftyMachineFirstStage.objectiveValue,
              variableCount:
                belowFiftyMachineFirstStage.variableCount,
              constraintCount:
                belowFiftyMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                belowFiftyMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                belowFiftyMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                belowFiftyMachineHighs?.totalMs ?? 0,
            }
          : null,
      recipeRelaxedMachineStage:
        recipeRelaxedMachineFirstStage
          ? {
              solveMs: recipeRelaxedMachineFirstStage.solveMs,
              status: recipeRelaxedMachineFirstStage.status,
              objectiveValue:
                recipeRelaxedMachineFirstStage.objectiveValue,
              variableCount:
                recipeRelaxedMachineFirstStage.variableCount,
              constraintCount:
                recipeRelaxedMachineFirstStage.constraintCount,
              fractionalRecipeVariableCount:
                recipeRelaxedMachineFirstStage.fractionalRecipeVariableCount,
              maxRecipeIntegralityError:
                recipeRelaxedMachineFirstStage.maxRecipeIntegralityError,
              fractionalOperationVariableCount:
                recipeRelaxedMachineFirstStage.fractionalOperationVariableCount,
              maxOperationIntegralityError:
                recipeRelaxedMachineFirstStage.maxOperationIntegralityError,
              totalMs:
                recipeRelaxedMachineHighs?.totalMs ?? 0,
            }
          : null,
      operationRelaxedMachineStage:
        operationRelaxedMachineFirstStage
          ? {
              solveMs: operationRelaxedMachineFirstStage.solveMs,
              status: operationRelaxedMachineFirstStage.status,
              objectiveValue:
                operationRelaxedMachineFirstStage.objectiveValue,
              variableCount:
                operationRelaxedMachineFirstStage.variableCount,
              constraintCount:
                operationRelaxedMachineFirstStage.constraintCount,
              fractionalRecipeVariableCount:
                operationRelaxedMachineFirstStage.fractionalRecipeVariableCount,
              maxRecipeIntegralityError:
                operationRelaxedMachineFirstStage.maxRecipeIntegralityError,
              fractionalOperationVariableCount:
                operationRelaxedMachineFirstStage.fractionalOperationVariableCount,
              maxOperationIntegralityError:
                operationRelaxedMachineFirstStage.maxOperationIntegralityError,
              totalMs:
                operationRelaxedMachineHighs?.totalMs ?? 0,
            }
          : null,
      incumbentBoundMachineStage:
        incumbentBoundMachineFirstStage
          ? {
              solveMs: incumbentBoundMachineFirstStage.solveMs,
              status: incumbentBoundMachineFirstStage.status,
              objectiveValue:
                incumbentBoundMachineFirstStage.objectiveValue,
              fixCount: incumbentBoundMachineFirstStage.fixCount,
              variableCount:
                incumbentBoundMachineFirstStage.variableCount,
              constraintCount:
                incumbentBoundMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                incumbentBoundMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                incumbentBoundMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                incumbentBoundMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                incumbentBoundMachineFirstStage.reconstructedAssignmentCount,
              totalMs: incumbentBoundMachineHighs?.totalMs ?? 0,
            }
          : null,
      twoWayMachineOperationLowerBound,
      twoWayMachineOperationLowerBounds: {
        sharedPrefix: {
          status:
            sharedPrefixMachineHighs?.stages[0]?.status ?? null,
          objectiveValue:
            sharedPrefixMachineHighs?.stages[0]?.objectiveValue ??
            null,
          solveMs:
            sharedPrefixMachineHighs?.stages[0]?.solveMs ?? null,
        },
        localTail: {
          status:
            localTailMachineHighs?.stages[0]?.status ?? null,
          objectiveValue:
            localTailMachineHighs?.stages[0]?.objectiveValue ??
            null,
          solveMs:
            localTailMachineHighs?.stages[0]?.solveMs ?? null,
        },
      },
      decomposedMachineOperationLowerBound,
      combinedMachineOperationLowerBound,
      combinedMachineOperationLowerBounds: {
        throughSeasoning:
          throughSeasoningMachineFirstStage?.objectiveValue ?? null,
        blending:
          blendingOnlyMachineFirstStage?.objectiveValue ?? null,
        finalizing:
          finalizingOnlyMachineFirstStage?.objectiveValue ?? null,
      },
      disjointMachineOperationLowerBounds: {
        juicing:
          juicingOnlyMachineFirstStage?.objectiveValue ?? null,
        seasoning:
          seasoningOnlyMachineFirstStage?.objectiveValue ?? null,
        sharedBlending:
          sharedBlendingMachineFirstStage?.objectiveValue ?? null,
        singletonBlending:
          singletonBlendingMachineFirstStage?.objectiveValue ?? null,
        finalizing:
          finalizingOnlyMachineFirstStage?.objectiveValue ?? null,
      },
      decomposedBoundMachineStage:
        decomposedBoundMachineFirstStage
          ? {
              solveMs: decomposedBoundMachineFirstStage.solveMs,
              status: decomposedBoundMachineFirstStage.status,
              objectiveValue:
                decomposedBoundMachineFirstStage.objectiveValue,
              variableCount:
                decomposedBoundMachineFirstStage.variableCount,
              constraintCount:
                decomposedBoundMachineFirstStage.constraintCount,
              totalMs:
                decomposedBoundMachineHighs?.totalMs ?? 0,
            }
          : null,
      decomposedBoundWarmStartComparison,
      lowerBoundWitnessSearches,
      certifiedLowerBoundWitness:
        certifiedLowerBoundWitness?.source ?? null,
      postCertificateJarStage:
        postCertificateJarHighs?.stages[0]
          ? {
              status: postCertificateJarHighs.stages[0].status,
              objectiveValue:
                postCertificateJarHighs.stages[0].objectiveValue,
              solveMs: postCertificateJarHighs.stages[0].solveMs,
              variableCount:
                postCertificateJarHighs.stages[0].variableCount,
              constraintCount:
                postCertificateJarHighs.stages[0].constraintCount,
              integralAssignmentReconstructionFeasible:
                postCertificateJarHighs.stages[0].integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                postCertificateJarHighs.stages[0].reconstructedAssignmentCount,
              totalMs: postCertificateJarHighs.totalMs,
            }
          : null,
      lowerBoundWitnessFixedVerification:
        lowerBoundWitnessFixedVerification?.stages[0]
          ? {
              status:
                lowerBoundWitnessFixedVerification.stages[0].status,
              objectiveValue:
                lowerBoundWitnessFixedVerification.stages[0].objectiveValue,
              integralAssignmentReconstructionFeasible:
                lowerBoundWitnessFixedVerification.stages[0].integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                lowerBoundWitnessFixedVerification.stages[0].reconstructedAssignmentCount,
              totalMs:
                lowerBoundWitnessFixedVerification.totalMs,
            }
          : null,
      stage1LocalDescentSteps,
      stage1LocalDescentBreakdown,
      stage1DepthTwoSearch,
      stage1DepthTwoFixedVerification:
        stage1DepthTwoFixedVerification?.stages[0]
          ? {
              status:
                stage1DepthTwoFixedVerification.stages[0].status,
              objectiveValue:
                stage1DepthTwoFixedVerification.stages[0].objectiveValue,
              integralAssignmentReconstructionFeasible:
                stage1DepthTwoFixedVerification.stages[0].integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                stage1DepthTwoFixedVerification.stages[0].reconstructedAssignmentCount,
              totalMs:
                stage1DepthTwoFixedVerification.totalMs,
            }
          : null,
      stage1LocalDescentFixedVerification:
        stage1LocalDescentFixedVerification?.stages[0]
          ? {
              status:
                stage1LocalDescentFixedVerification.stages[0].status,
              objectiveValue:
                stage1LocalDescentFixedVerification.stages[0].objectiveValue,
              integralAssignmentReconstructionFeasible:
                stage1LocalDescentFixedVerification.stages[0].integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                stage1LocalDescentFixedVerification.stages[0].reconstructedAssignmentCount,
              totalMs:
                stage1LocalDescentFixedVerification.totalMs,
            }
          : null,
      exactFiftyOneMachineStage:
        exactFiftyOneMachineFirstStage
          ? {
              solveMs: exactFiftyOneMachineFirstStage.solveMs,
              status: exactFiftyOneMachineFirstStage.status,
              objectiveValue:
                exactFiftyOneMachineFirstStage.objectiveValue,
              selectedRecipeCount:
                exactFiftyOneMachineFirstStage.selectedRecipeUnits.length,
              integralAssignmentReconstructionFeasible:
                exactFiftyOneMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                exactFiftyOneMachineFirstStage.reconstructedAssignmentCount,
              totalMs: exactFiftyOneMachineHighs?.totalMs ?? 0,
            }
          : null,
      oneTransferMachineSearch,
      oneTransferFixedVerification:
        oneTransferFixedVerification?.stages[0]
          ? {
              status:
                oneTransferFixedVerification.stages[0].status,
              objectiveValue:
                oneTransferFixedVerification.stages[0].objectiveValue,
              integralAssignmentReconstructionFeasible:
                oneTransferFixedVerification.stages[0].integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                oneTransferFixedVerification.stages[0].reconstructedAssignmentCount,
              totalMs: oneTransferFixedVerification.totalMs,
            }
          : null,
      exactFiftyMachineStage: exactFiftyMachineFirstStage
        ? {
            solveMs: exactFiftyMachineFirstStage.solveMs,
            status: exactFiftyMachineFirstStage.status,
            objectiveValue: exactFiftyMachineFirstStage.objectiveValue,
            variableCount: exactFiftyMachineFirstStage.variableCount,
            constraintCount: exactFiftyMachineFirstStage.constraintCount,
            integralAssignmentReconstructionFeasible:
              exactFiftyMachineFirstStage.integralAssignmentReconstructionFeasible,
            reconstructedAssignmentCount:
              exactFiftyMachineFirstStage.reconstructedAssignmentCount,
            totalMs: exactFiftyMachineHighs?.totalMs ?? 0,
          }
        : null,
      atMostFiftyOneMachineStage: atMostFiftyOneMachineFirstStage
        ? {
            solveMs: atMostFiftyOneMachineFirstStage.solveMs,
            status: atMostFiftyOneMachineFirstStage.status,
            objectiveValue:
              atMostFiftyOneMachineFirstStage.objectiveValue,
            variableCount:
              atMostFiftyOneMachineFirstStage.variableCount,
            constraintCount:
              atMostFiftyOneMachineFirstStage.constraintCount,
            integralAssignmentReconstructionFeasible:
              atMostFiftyOneMachineFirstStage.integralAssignmentReconstructionFeasible,
            reconstructedAssignmentCount:
              atMostFiftyOneMachineFirstStage.reconstructedAssignmentCount,
            totalMs: atMostFiftyOneMachineHighs?.totalMs ?? 0,
          }
        : null,
      partitionBoundExactFiftyMachineStage:
        partitionBoundExactFiftyMachineFirstStage
          ? {
              solveMs:
                partitionBoundExactFiftyMachineFirstStage.solveMs,
              status:
                partitionBoundExactFiftyMachineFirstStage.status,
              objectiveValue:
                partitionBoundExactFiftyMachineFirstStage.objectiveValue,
              variableCount:
                partitionBoundExactFiftyMachineFirstStage.variableCount,
              constraintCount:
                partitionBoundExactFiftyMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                partitionBoundExactFiftyMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                partitionBoundExactFiftyMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                partitionBoundExactFiftyMachineHighs?.totalMs ?? 0,
            }
          : null,
      warmStartHighsComparison,
      binaryEncodedWarmStartComparison,
      binaryEncodedMachineStage: null,
      fixedBinaryEncodedMachineStage: null,
      fixedIncumbentMachineStage:
        fixedIncumbentMachineFirstStage
          ? {
              solveMs: fixedIncumbentMachineFirstStage.solveMs,
              status: fixedIncumbentMachineFirstStage.status,
              objectiveValue:
                fixedIncumbentMachineFirstStage.objectiveValue,
              fixCount: fixedIncumbentMachineFirstStage.fixCount,
              variableCount:
                fixedIncumbentMachineFirstStage.variableCount,
              constraintCount:
                fixedIncumbentMachineFirstStage.constraintCount,
              integralAssignmentReconstructionFeasible:
                fixedIncumbentMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                fixedIncumbentMachineFirstStage.reconstructedAssignmentCount,
              totalMs: fixedIncumbentMachineHighs?.totalMs ?? 0,
            }
          : null,
      binaryStages: binaryHighs.stages,
      relaxedStages: relaxedHighs.stages,
    }

    console.info(
      `[Debug-D1 optimizer profile] ${JSON.stringify(report)}`,
    )

    expect(candidatePool.entries.length).toBeGreaterThan(0)
    expect(generatedCurrentCandidates.length).toBeGreaterThan(0)
    expect(model.serviceableCustomerIds.length).toBeGreaterThan(0)
    expect(optimizerBaseEligibleCandidates.length).toBeGreaterThan(0)
    expect(model.recipes.length).toBeGreaterThan(0)
    expect(assignmentEligibilityCount).toBeGreaterThan(0)
    expect(productionEdgeCount).toBeGreaterThan(0)
    expect(Object.keys(edgeKindStats).sort()).toEqual([
      'blending',
      'finalizing',
      'juicing',
      'seasoning',
    ])
    expect(binaryHighs.stages).toHaveLength(1)
    expect(relaxedHighs.stages).toHaveLength(1)
    expect(binaryHighs.finalVariableCount).toBeGreaterThan(0)
    expect(binaryHighs.finalConstraintCount).toBeGreaterThan(0)
    expect(relaxedHighs.finalVariableCount).toBe(
      binaryHighs.finalVariableCount,
    )
    expect(relaxedHighs.finalConstraintCount).toBe(
      binaryHighs.finalConstraintCount,
    )
    expect(prunedRelaxedHighs.stages).toHaveLength(1)
    expect(compressedRelaxedHighs.stages).toHaveLength(1)
    expect(strictCostPrunedRecipes.length).toBeGreaterThan(0)
    expect(strictCostPrunedRecipes.length).toBeLessThan(model.recipes.length)
    expect(costStageCompressedRecipes.length).toBeGreaterThan(0)
    expect(costStageCompressedRecipes.length).toBeLessThan(
      strictCostPrunedRecipes.length,
    )
    if (
      relaxedFirstStage?.status === 'optimal' &&
      prunedRelaxedFirstStage?.status === 'optimal'
    ) {
      expect(prunedRelaxedFirstStage.objectiveValue).toBeCloseTo(
        relaxedFirstStage.objectiveValue ?? 0,
        9,
      )
    }
    if (
      prunedRelaxedFirstStage?.status === 'optimal' &&
      compressedRelaxedFirstStage?.status === 'optimal'
    ) {
      expect(compressedRelaxedFirstStage.objectiveValue).toBeCloseTo(
        prunedRelaxedFirstStage.objectiveValue ?? 0,
        9,
      )
    }
    if (expandedCostFeasibilityFirstStage) {
      expect(expandedCostFeasibilityFirstStage.objective).toBe('cost')
      expect(expandedCostFeasibilityFirstStage.fixCount).toBe(1)
      if (expandedCostFeasibilityFirstStage.objectiveValue !== null) {
        expect(
          expandedCostFeasibilityFirstStage.objectiveValue,
        ).toBeCloseTo(fixedMinimumCost ?? 0, 9)
        expect(
          expandedCostFeasibilityFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          expandedCostFeasibilityFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
    }

    if (fixedIncumbentMachineFirstStage) {
      expect(fixedIncumbentMachineFirstStage.status).toBe('optimal')
      expect(fixedIncumbentMachineFirstStage.objectiveValue).toBeCloseTo(
        compressedIncumbentMachineOperations,
        9,
      )
      expect(
        fixedIncumbentMachineFirstStage.integralAssignmentReconstructionFeasible,
      ).toBe(true)
      expect(
        fixedIncumbentMachineFirstStage.reconstructedAssignmentCount,
      ).toBe(model.serviceableCustomerIds.length)
    }

    if (twoWayMachineOperationLowerBound !== null) {
      expect(
        twoWayMachineOperationLowerBound,
      ).toBeLessThanOrEqual(
        compressedIncumbentMachineOperations,
      )
    }

    if (decomposedMachineOperationLowerBound !== null) {
      expect(
        decomposedMachineOperationLowerBound,
      ).toBeLessThanOrEqual(
        compressedIncumbentMachineOperations,
      )
    }

    if (decomposedBoundWarmStartComparison) {
      expect(
        decomposedBoundWarmStartComparison.mappedSeedColumnCount,
      ).toBe(
        decomposedBoundWarmStartComparison.expectedSeedColumnCount,
      )
      expect(
        decomposedBoundWarmStartComparison.hasFeasiblePrimal,
      ).toBe(true)
      expect(
        decomposedBoundWarmStartComparison.objectiveValue,
      ).not.toBeNull()
      expect(
        decomposedBoundWarmStartComparison.objectiveValue ??
          Infinity,
      ).toBeLessThanOrEqual(
        compressedIncumbentMachineOperations + 1e-7,
      )
      expect(
        decomposedBoundWarmStartComparison.mipDualBound,
      ).toBeGreaterThanOrEqual(
        (decomposedMachineOperationLowerBound ?? 0) - 1e-7,
      )
    }

    if (warmStartHighsComparison) {
      expect(
        warmStartHighsComparison.warm.mappedSeedColumnCount,
      ).toBe(
        warmStartHighsComparison.warm.expectedSeedColumnCount,
      )
      expect(
        warmStartHighsComparison.warm.hasFeasiblePrimal,
      ).toBe(true)
      expect(
        warmStartHighsComparison.warm.objectiveValue,
      ).not.toBeNull()
      expect(
        warmStartHighsComparison.warm.objectiveValue ?? Infinity,
      ).toBeLessThanOrEqual(
        compressedIncumbentMachineOperations + 1e-7,
      )
    }

    if (expandedMachineFirstStage) {
      expect(expandedMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(expandedMachineFirstStage.fixCount).toBe(1)
      if (expandedMachineFirstStage.objectiveValue !== null) {
        expect(
          expandedMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(expandedMachineFirstStage.reconstructedAssignmentCount).toBe(
          model.serviceableCustomerIds.length,
        )
      }
    }
    if (localCompressedMachineFirstStage) {
      expect(localCompressedMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(localCompressedMachineFirstStage.fixCount).toBe(1)
      expect(localCompressedMachineFirstStage.variableCount).toBe(
        projectedStage2VariableCountAfterLocalCompression,
      )
      expect(localCompressedMachineFirstStage.constraintCount).toBe(
        projectedStage2ConstraintCountAfterLocalCompression,
      )
      if (localCompressedMachineFirstStage.objectiveValue !== null) {
        expect(
          localCompressedMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          localCompressedMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
      if (
        expandedMachineFirstStage?.status === 'optimal' &&
        localCompressedMachineFirstStage.status === 'optimal'
      ) {
        expect(
          localCompressedMachineFirstStage.objectiveValue,
        ).toBeCloseTo(
          expandedMachineFirstStage.objectiveValue ?? 0,
          9,
        )
      }
    }
    if (groupedAssignmentMachineFirstStage) {
      expect(groupedAssignmentMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(groupedAssignmentMachineFirstStage.fixCount).toBe(1)
      expect(groupedAssignmentMachineFirstStage.variableCount).toBe(
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      )
      expect(groupedAssignmentMachineFirstStage.constraintCount).toBe(
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps,
      )
      if (groupedAssignmentMachineFirstStage.objectiveValue !== null) {
        expect(
          groupedAssignmentMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          groupedAssignmentMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
      if (
        localCompressedMachineFirstStage?.status === 'optimal' &&
        groupedAssignmentMachineFirstStage.status === 'optimal'
      ) {
        expect(
          groupedAssignmentMachineFirstStage.objectiveValue,
        ).toBeCloseTo(
          localCompressedMachineFirstStage.objectiveValue ?? 0,
          9,
        )
      }
    }
    if (tightBoundMachineFirstStage) {
      expect(tightBoundMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(tightBoundMachineFirstStage.fixCount).toBe(1)
      expect(tightBoundMachineFirstStage.variableCount).toBe(
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      )
      expect(tightBoundMachineFirstStage.constraintCount).toBe(
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps,
      )
      if (tightBoundMachineFirstStage.objectiveValue !== null) {
        expect(
          tightBoundMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          tightBoundMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
      if (
        groupedAssignmentMachineFirstStage?.status === 'optimal' &&
        tightBoundMachineFirstStage.status === 'optimal'
      ) {
        expect(
          tightBoundMachineFirstStage.objectiveValue,
        ).toBeCloseTo(
          groupedAssignmentMachineFirstStage.objectiveValue ?? 0,
          9,
        )
      }
    }
    expect(compressedIncumbentCost).toBe(fixedMinimumCost)
    expect(compressedIncumbentMachineOperations).toBeGreaterThan(0)
    if (incumbentBoundMachineFirstStage) {
      expect(incumbentBoundMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(incumbentBoundMachineFirstStage.fixCount).toBe(1)
      expect(incumbentBoundMachineFirstStage.variableCount).toBe(
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      )
      expect(incumbentBoundMachineFirstStage.constraintCount).toBe(
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps + 1,
      )
      if (incumbentBoundMachineFirstStage.objectiveValue !== null) {
        expect(
          incumbentBoundMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          incumbentBoundMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
        expect(
          incumbentBoundMachineFirstStage.objectiveValue,
        ).toBeLessThanOrEqual(compressedIncumbentMachineOperations)
      }
    }
  },
  // The profiler gives each HiGHS stage its own short diagnostic solver
  // limit. This larger test-only timeout lets the stage-build diagnostics
  // finish; production solver semantics and existing smoke-test timeout
  // remain unchanged.
  90_000,
)
