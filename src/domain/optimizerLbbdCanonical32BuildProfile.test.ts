import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage: () => {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
}

const enabled = process.env.OPTIMIZER_PHASE_G_CANONICAL32_PROTOTYPE === '1'
const CUSTOMER_COUNT = 32

function currentWorldRequest(): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(0, CUSTOMER_COUNT)

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

function compactMemory() {
  const usage = process.memoryUsage()
  return {
    rssMb: usage.rss / 1024 / 1024,
    heapUsedMb: usage.heapUsed / 1024 / 1024,
    heapTotalMb: usage.heapTotal / 1024 / 1024,
    externalMb: usage.external / 1024 / 1024,
    arrayBuffersMb: usage.arrayBuffers / 1024 / 1024,
  }
}

describe.skipIf(!enabled)('Phase G canonical-32 build telemetry', () => {
  it('records candidate/domain build cost and structural dimensions', () => {
    const request = currentWorldRequest()
    const beforeCandidate = compactMemory()
    const candidateStartedAt = performance.now()
    const candidatePool = buildRecipeCandidatePool(request.currentProgress)
    const candidatePoolMs = performance.now() - candidateStartedAt
    const afterCandidate = compactMemory()

    const domainStartedAt = performance.now()
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const domainBuildMs = performance.now() - domainStartedAt
    const afterDomain = compactMemory()

    const serviceable = new Set(domain.serviceableCustomerIds)
    const assignmentEdges = domain.recipes.reduce(
      (total, recipe) =>
        total +
        recipe.eligibleCustomerIds.filter((customerId) =>
          serviceable.has(customerId),
        ).length,
      0,
    )
    const productionEdges = domain.recipes.reduce(
      (total, recipe) => total + recipe.productionPath.edges.length,
      0,
    )

    expect(domain.serviceableCustomerIds).toHaveLength(CUSTOMER_COUNT)
    expect(domain.recipes.length).toBeGreaterThan(0)
    expect(assignmentEdges).toBeGreaterThan(0)
    expect(productionEdges).toBeGreaterThan(0)

    console.info(
      '[phase-g-canonical32-build]',
      JSON.stringify({
        customers: domain.serviceableCustomerIds.length,
        recipes: domain.recipes.length,
        assignmentEdges,
        productionEdges,
        candidatePoolMs,
        domainBuildMs,
        memory: {
          beforeCandidate,
          afterCandidate,
          afterDomain,
        },
      }),
    )
  })
})
