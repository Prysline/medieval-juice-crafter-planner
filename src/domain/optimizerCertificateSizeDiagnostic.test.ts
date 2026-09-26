import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'

describe('temporary optimizer certificate size diagnostic', () => {
  it('prints production-scale recipe counts without solving HiGHS', () => {
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
        'minimum-jar-switches',
      ],
      availableJuiceJarCount: 2,
    }
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(request.currentProgress),
    })
    const certificate = prepareMinimumCostStageCertificate(domain)

    expect(certificate).not.toBeNull()
    console.info(
      `[optimizer size diagnostic] domain=${domain.recipes.length} original=${certificate!.originalRecipeCount} frontier=${certificate!.frontierRecipeCount} representative=${certificate!.representativeRecipeCount}`,
    )
  })
})
