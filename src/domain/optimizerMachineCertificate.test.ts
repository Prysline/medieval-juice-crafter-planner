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
import {
  solveJarSwitchCertificateForCostAndMachineFix,
  solveMachineOperationCertificateForCostFix,
} from './optimizerHighsSolver'

describe('production-scale optimizer certificates', () => {
  it('closes the exact Stage 2 machine and Stage 3 jar bounds', async () => {
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

    const jarCertificate =
      await solveJarSwitchCertificateForCostAndMachineFix(
        stage1!.continuationDomain,
        572,
        certificate!,
      )

    expect(jarCertificate).not.toBeNull()
    expect(jarCertificate?.productionUnits).toBe(24)
    expect(
      jarCertificate?.extraProductionUnitCostLowerBound,
    ).toBe(581)
    expect(jarCertificate?.finalizingOperations).toBe(21)
    expect(jarCertificate?.distinctRecipeKindLowerBound).toBe(21)
    expect(jarCertificate?.jarLowerBound).toBe(19)
    expect(jarCertificate?.jarUpperBound).toBe(19)
    expect(jarCertificate?.optimum).toBe(19)
    expect(jarCertificate?.witnessRecipeUnits).toHaveLength(21)
    expect(jarCertificate?.verifiedAssignmentCount).toBe(48)
  }, 45000)
})
