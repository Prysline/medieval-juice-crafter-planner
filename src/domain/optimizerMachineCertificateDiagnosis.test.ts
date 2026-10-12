import { Model } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'
import { solveMachineOperationCertificateForCostFix } from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

const diagnosisEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}

const diagnosisIt =
  diagnosisEnv.P4_MACHINE_CERTIFICATE_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

interface TimedCertificateRun {
  totalElapsedMs: number
  solveDurationsMs: {
    throughSeasoning: number
    blending: number
    finalizing: number
    verification: number[]
  }
  omittedOperationUsageConstraintCount: number
}

async function runTimedCertificate(
  domain: CertificateDomain,
  omitThroughSeasoningOperationUsage: boolean,
): Promise<TimedCertificateRun> {
  const originalSolve = Model.prototype.solve
  const originalAddConstraint = Model.prototype.addConstraint
  const solveDurationsMs: number[] = []
  let startedSolveCount = 0
  let omittedOperationUsageConstraintCount = 0

  Model.prototype.addConstraint = function (
    this: Model,
    ...args: Parameters<Model['addConstraint']>
  ): ReturnType<Model['addConstraint']> {
    const constraintName = args[1]
    if (
      omitThroughSeasoningOperationUsage &&
      startedSolveCount === 0 &&
      typeof constraintName === 'string' &&
      constraintName.startsWith('operation_usage_')
    ) {
      omittedOperationUsageConstraintCount += 1
      return undefined as ReturnType<Model['addConstraint']>
    }
    return originalAddConstraint.apply(this, args)
  }

  Model.prototype.solve = async function (this: Model) {
    startedSolveCount += 1
    const startedAt = performance.now()
    try {
      return await originalSolve.call(this)
    } finally {
      solveDurationsMs.push(performance.now() - startedAt)
    }
  }

  try {
    const startedAt = performance.now()
    const certificate = await solveMachineOperationCertificateForCostFix(
      domain,
      604,
    )
    const totalElapsedMs = performance.now() - startedAt

    expect(certificate).not.toBeNull()
    expect(certificate?.lowerBounds).toEqual({
      throughSeasoning: 23,
      blending: 9,
      finalizing: 22,
    })
    expect(certificate?.optimum).toBe(54)
    expect(certificate?.verifiedAssignmentCount).toBe(49)
    expect(solveDurationsMs.length).toBeGreaterThanOrEqual(4)

    const [throughSeasoning, blending, finalizing, ...verification] =
      solveDurationsMs
    return {
      totalElapsedMs,
      solveDurationsMs: {
        throughSeasoning,
        blending,
        finalizing,
        verification,
      },
      omittedOperationUsageConstraintCount,
    }
  } finally {
    Model.prototype.solve = originalSolve
    Model.prototype.addConstraint = originalAddConstraint
  }
}

describe('diagnosis-only P4 machine certificate solve timing', () => {
  diagnosisIt('compares the throughSeasoning operation-usage constraint A/B on one runner', async () => {
    const customerIds = canonicalCustomers.map((customer) => customer.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 0,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
      ],
      availableJuiceJarCount: 2,
    }
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(request.currentProgress),
    })
    const stage1 = prepareMinimumCostStageCertificate(domain)

    expect(stage1).not.toBeNull()

    const baseline = await runTimedCertificate(
      stage1!.continuationDomain,
      false,
    )
    const variant = await runTimedCertificate(
      stage1!.continuationDomain,
      true,
    )

    expect(baseline.omittedOperationUsageConstraintCount).toBe(0)
    expect(variant.omittedOperationUsageConstraintCount).toBeGreaterThan(0)

    console.info(
      `[P4 machine certificate operation-usage A/B] ${JSON.stringify({
        baseline,
        variant,
        throughSeasoningDeltaMs:
          variant.solveDurationsMs.throughSeasoning -
          baseline.solveDurationsMs.throughSeasoning,
        throughSeasoningRatio:
          variant.solveDurationsMs.throughSeasoning /
          baseline.solveDurationsMs.throughSeasoning,
        totalDeltaMs: variant.totalElapsedMs - baseline.totalElapsedMs,
        totalRatio: variant.totalElapsedMs / baseline.totalElapsedMs,
      })}`,
    )
  }, 180000)
})
