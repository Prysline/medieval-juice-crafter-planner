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
  it('closes the exact Stage 2 machine and Stage 3 jar bounds for 49 serviceable customers', async () => {
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
    expect(stage1?.continuationDomain.recipes).toHaveLength(4986)

    const certificate =
      await solveMachineOperationCertificateForCostFix(
        stage1!.continuationDomain,
        604,
      )

    expect(certificate).not.toBeNull()
    expect(certificate?.lowerBounds).toEqual({
      throughSeasoning: 23,
      blending: 9,
      finalizing: 22,
    })
    expect(certificate?.optimum).toBe(54)
    expect(certificate?.verifiedAssignmentCount).toBe(49)
    expect(
      machineOperationBreakdownForSelection(
        stage1!.continuationDomain,
        certificate!.witnessRecipeUnits,
      ).total,
    ).toBe(54)

    const jarCertificate =
      await solveJarSwitchCertificateForCostAndMachineFix(
        stage1!.continuationDomain,
        604,
        certificate!,
      )

    expect(jarCertificate).not.toBeNull()
    expect(jarCertificate?.productionUnits).toBe(25)
    expect(
      jarCertificate?.extraProductionUnitCostLowerBound,
    ).toBe(613)
    expect(jarCertificate?.finalizingOperations).toBe(22)
    expect(jarCertificate?.distinctRecipeKindLowerBound).toBe(22)
    expect(jarCertificate?.jarLowerBound).toBe(20)
    expect(jarCertificate?.jarUpperBound).toBe(20)
    expect(jarCertificate?.optimum).toBe(20)
    expect(jarCertificate?.witnessRecipeUnits).toHaveLength(22)
    expect(jarCertificate?.verifiedAssignmentCount).toBe(49)
  }, 120000)
})
