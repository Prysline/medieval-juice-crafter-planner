import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import {
  machineOperationBreakdownForSelection,
  prepareMinimumCostStageCertificate,
} from './optimizerCertificates'
import { solveMachineOperationCertificateForCostFix } from './optimizerHighsSolver'

describe('production-scale machine-operation certificate', () => {
  it('closes the exact 50-operation lower and upper bounds', async () => {
    const customerIds = canonicalCustomers.map((customer) => customer.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
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
      candidatePool: buildRecipeCandidatePool(
        request.currentProgress,
      ),
    })
    const stage1 = prepareMinimumCostStageCertificate(domain)

    expect(stage1).not.toBeNull()
    expect(stage1?.continuationDomain.recipes).toHaveLength(4996)

    const certificate =
      await solveMachineOperationCertificateForCostFix(
        stage1!.continuationDomain,
        572,
      )

    expect(certificate).not.toBeNull()
    expect(certificate?.lowerBounds).toEqual({
      throughSeasoning: 20,
      blending: 9,
      finalizing: 21,
    })
    expect(certificate?.optimum).toBe(50)
    expect(certificate?.verifiedAssignmentCount).toBe(48)
    expect(
      machineOperationBreakdownForSelection(
        stage1!.continuationDomain,
        certificate!.witnessRecipeUnits,
      ).total,
    ).toBe(50)
  }, 30000)
})
