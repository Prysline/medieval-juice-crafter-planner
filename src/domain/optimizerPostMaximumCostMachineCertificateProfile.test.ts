import { Model } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
} from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage(): {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
  }
}

interface SolveEvent {
  index: number
  solveMs: number
  status: string
  objective: number | null
  lpChars: number
  variables: number
  constraints: number
  memoryBeforeRss: number
  memoryAfterRss: number
}

const enabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_CUSTOMERS ?? '12',
)

function currentWorldRequest(customerCount: number): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(0, customerCount)

  return {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 9999,
      'tranquil-fountain': 9999,
      'ibex-statue': 9999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }
}

function dimensions(domain: BatchOptimizationModel) {
  const productionEdges = new Set<string>()
  let assignmentEdges = 0
  for (const recipe of domain.recipes) {
    assignmentEdges += recipe.eligibleCustomerIds.length
    for (const edge of recipe.productionPath.edges) {
      productionEdges.add(edge.key)
    }
  }
  return {
    serviceableCustomers: domain.serviceableCustomerIds.length,
    unresolvedCustomers: domain.unresolvedCustomerIds.length,
    recipes: domain.recipes.length,
    assignmentEdges,
    productionEdges: productionEdges.size,
  }
}

function installSolveProbe(events: SolveEvent[]): () => void {
  const prototype = Model.prototype as unknown as {
    solve: (
      this: Model,
      ...args: unknown[]
    ) => Promise<{ status: string; objective?: number }>
  }
  const originalSolve = prototype.solve

  prototype.solve = async function (
    this: Model,
    ...args: unknown[]
  ) {
    let lp = ''
    try {
      lp = this.print()
    } catch {
      lp = ''
    }
    const variables = new Set(
      lp.match(
        /\b(?:x_group|x|y|z|op|pair|single)(?:_[A-Za-z0-9]+)*\b/g,
      ) ?? [],
    )
    const subjectTo =
      lp.match(
        /Subject To([\s\S]*?)(?:\nBounds|\nGenerals|\nBinaries|\nEnd)/i,
      )?.[1] ?? ''
    const constraints =
      subjectTo.match(/^\s*[A-Za-z0-9_]+:/gm)?.length ?? 0
    const memoryBeforeRss = process.memoryUsage().rss
    const startedAt = performance.now()
    const solution = await originalSolve.apply(this, args)
    const event: SolveEvent = {
      index: events.length + 1,
      solveMs: performance.now() - startedAt,
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      lpChars: lp.length,
      variables: variables.size,
      constraints,
      memoryBeforeRss,
      memoryAfterRss: process.memoryUsage().rss,
    }
    events.push(event)
    console.info(
      '[post-max-cost-machine-certificate-stage]',
      JSON.stringify(event),
    )
    return solution
  }

  return () => {
    prototype.solve = originalSolve
  }
}

const expectedByRequestedCustomers = new Map([
  [
    12,
    {
      prefix: {
        productionUnits: 6,
        assignedIngredientCost: 678,
        productionCost: 339,
      },
      machineOperations: 24,
      recipeKinds: 6,
      solveCount: 6,
    },
  ],
  [
    32,
    {
      prefix: {
        productionUnits: 16,
        assignedIngredientCost: 1798,
        productionCost: 899,
      },
      machineOperations: 55,
      recipeKinds: 15,
      solveCount: 6,
    },
  ],
])

describe.skipIf(!enabled)(
  'post-maximum-ingredient-cost machine certificate diagnosis',
  () => {
    it(
      `profiles canonical current-world ${requestedCustomerCount}-customer slice`,
      async () => {
        const request = currentWorldRequest(requestedCustomerCount)
        const candidatePool = buildRecipeCandidatePool(
          request.currentProgress,
        )
        const domain = buildOptimizationModel(request, {
          customers: canonicalCustomers,
          candidatePool,
        })
        const events: SolveEvent[] = []
        const restore = installSolveProbe(events)
        const startedAt = performance.now()
        let diagnosis
        try {
          diagnosis =
            await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
              domain,
            )
        } finally {
          restore()
        }
        const wallMs = performance.now() - startedAt

        console.info(
          '[post-max-cost-machine-certificate-summary]',
          JSON.stringify({
            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),
            wallMs,
            diagnosis,
            solveEvents: events,
            memoryAfter: process.memoryUsage(),
          }),
        )

        expect(diagnosis).not.toBeNull()
        const expected =
          expectedByRequestedCustomers.get(requestedCustomerCount)
        const exactCertificate =
          diagnosis?.certificate ?? diagnosis?.combinedCertificate ?? null
        if (expected) {
          expect(diagnosis!.prefix).toEqual(expected.prefix)
          expect(exactCertificate).not.toBeNull()
          expect(exactCertificate!.optimum).toBe(
            expected.machineOperations,
          )
          expect(diagnosis!.combinedCertificate?.recipeKindsOptimum).toBe(
            expected.recipeKinds,
          )
          expect(events).toHaveLength(expected.solveCount)
        }
        if (exactCertificate) {
          expect(exactCertificate.verifiedAssignmentCount).toBe(
            domain.serviceableCustomerIds.length,
          )
        }
      },
      1_200_000,
    )
  },
)
