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

describe('diagnosis-only P4 machine certificate solve timing', () => {
  it('profiles the existing exact certificate without changing production behavior', async () => {
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

    const originalSolve = Model.prototype.solve
    const solveDurationsMs: number[] = []
    Model.prototype.solve = async function (this: Model) {
      const startedAt = performance.now()
      try {
        return await originalSolve.call(this)
      } finally {
        solveDurationsMs.push(performance.now() - startedAt)
      }
    }

    try {
      const startedAt = performance.now()
      const certificate =
        await solveMachineOperationCertificateForCostFix(
          stage1!.continuationDomain,
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
      console.info(
        `[P4 machine certificate diagnosis] ${JSON.stringify({
          totalElapsedMs,
          solveDurationsMs: {
            throughSeasoning,
            blending,
            finalizing,
            verification,
          },
        })}`,
      )
    } finally {
      Model.prototype.solve = originalSolve
    }
  }, 120000)
})
