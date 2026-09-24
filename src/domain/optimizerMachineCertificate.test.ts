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
  it('reports the current Stage 2 machine and Stage 3 jar bounds', async () => {
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
        615,
      )

    expect(certificate).not.toBeNull()
    console.info(
      '[Octavius diagnostic] machine certificate',
      JSON.stringify({
        lowerBounds: certificate?.lowerBounds,
        optimum: certificate?.optimum,
        verifiedAssignmentCount: certificate?.verifiedAssignmentCount,
        witnessRecipeCount: certificate?.witnessRecipeUnits.length,
        witnessBreakdown: certificate
          ? machineOperationBreakdownForSelection(
              stage1!.continuationDomain,
              certificate.witnessRecipeUnits,
            )
          : null,
      }),
    )

    const jarCertificate =
      await solveJarSwitchCertificateForCostAndMachineFix(
        stage1!.continuationDomain,
        615,
        certificate!,
      )

    expect(jarCertificate).not.toBeNull()
    console.info(
      '[Octavius diagnostic] jar certificate',
      JSON.stringify(
        jarCertificate
          ? {
              productionUnits: jarCertificate.productionUnits,
              extraProductionUnitCostLowerBound:
                jarCertificate.extraProductionUnitCostLowerBound,
              finalizingOperations: jarCertificate.finalizingOperations,
              distinctRecipeKindLowerBound:
                jarCertificate.distinctRecipeKindLowerBound,
              jarLowerBound: jarCertificate.jarLowerBound,
              jarUpperBound: jarCertificate.jarUpperBound,
              optimum: jarCertificate.optimum,
              witnessRecipeCount: jarCertificate.witnessRecipeUnits.length,
              verifiedAssignmentCount:
                jarCertificate.verifiedAssignmentCount,
            }
          : null,
      ),
    )
  }, 120000)
})
