import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import { auditCandidateBOperationBounds } from './optimizerDevOperationBoundAudit'

const profilingEnabled =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.OPTIMIZER_DEV_72_STRUCTURE === '1'

describe('Candidate B operation upper-bound audit (diagnosis-only)', () => {
  it('counts repeated and shared edges without merging recipe identities', () => {
    const audit = auditCandidateBOperationBounds({
      serviceableCustomerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      recipes: [
        {
          eligibleCustomerIds: ['a', 'b'], // x_upper = 1
          productionPath: { edges: [
            { key: 'unique', kind: 'finalizing' },
            { key: 'shared', kind: 'juicing' },
            { key: 'shared', kind: 'juicing' },
          ] },
        },
        {
          eligibleCustomerIds: ['a', 'b', 'c', 'd', 'e', 'f'], // x_upper = 3
          productionPath: { edges: [
            { key: 'shared', kind: 'juicing' },
            { key: 'big', kind: 'blending' },
            { key: 'big', kind: 'blending' },
          ] },
        },
        {
          eligibleCustomerIds: ['a', 'b'],
          maxProductionUnits: 0,
          productionPath: { edges: [
            { key: 'zero', kind: 'seasoning' },
          ] },
        },
      ],
    }, 5)
    // shared upper bound = 2*1 + 1*3 = 5; not replaceable with op=q.
    expect(audit.operationEdges).toBe(4)
    expect(audit.quantityUpperBoundBuckets).toEqual({
      zero: 1, one: 1, twoToStackCapacity: 1, overStackCapacity: 1,
    })
    expect(audit.structurallySubstitutableEdges).toBe(2)
    expect(audit.nontrivialSubstitutionCandidates).toBe(1)
    expect(audit.substitutableEdgesByKind).toEqual({
      juicing: 0, seasoning: 1, blending: 0, finalizing: 1,
    })
    expect(audit.unchangedOperationVariables).toBe(4)
    expect(audit.maxEdgeQuantityUpperBound).toBe(6)
  })

  it('rejects corrupt stack capacity and conflicting edge identities', () => {
    const empty = { serviceableCustomerIds: [] as string[], recipes: [] }
    expect(() => auditCandidateBOperationBounds(empty, 0)).toThrow()
    expect(() => auditCandidateBOperationBounds({
      serviceableCustomerIds: ['a', 'b'],
      recipes: [
        { eligibleCustomerIds: ['a'], productionPath: { edges: [
          { key: 'collision', kind: 'juicing' as const },
        ] } },
        { eligibleCustomerIds: ['b'], productionPath: { edges: [
          { key: 'collision', kind: 'finalizing' as const },
        ] } },
      ],
    }, 5)).toThrow('changed kind')
  })

  it('only treats q<=1 as uniquely equal to integer op under original capacity/usage constraints', () => {
    const feasibleOperations = (q: number) =>
      [0, 1, 2, 3, 4, 5].filter((op) => q <= 5 * op && op <= q)
    expect(feasibleOperations(0)).toEqual([0])
    expect(feasibleOperations(1)).toEqual([1])
    expect(feasibleOperations(2)).toEqual([1, 2])
  })

  it.skipIf(!profilingEnabled)(
    'profiles the 72-selected proxy machine edge upper bounds without solving',
    () => {
      const customerIds = canonicalCustomers.map((item) => item.id).sort().slice(0, 72)
      expect(customerIds).toHaveLength(72)
      const request: OptimizationRequest = {
        customerIds,
        currentProgress: 'liquid-blender-unlocked',
        suppliedCustomerIds: [],
        satisfactionByVillage: {
          'east-harbor': 9999,
          'tranquil-fountain': 9999,
          'ibex-statue': 9999,
        },
        formalCustomerIds: customerIds,
        candidatePolicy: 'allow-unambiguous-computed',
        objective: 'minimum-waste',
        priorities: [
          'minimum-waste',
          'maximum-ingredient-cost',
          'minimum-machine-operations',
        ],
        materialSourceMode: 'normal',
        availableJuiceJarCount: 5,
      }
      const domain = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool: buildRecipeCandidatePool(request.currentProgress),
      })
      const audit = auditCandidateBOperationBounds(domain, PROCESSING_STACK_CAPACITY)
      console.info('[optimizer-dev-72-structure] audit', JSON.stringify({
        fixture: 'canonical-selected-72-proxy-not-player-request',
        ...audit,
      }))
      expect(audit.serviceableCustomers).toBeGreaterThan(0)
      expect(audit.operationEdges).toBeGreaterThan(0)
      expect(Object.values(audit.operationEdgesByKind).reduce((a, b) => a + b, 0))
        .toBe(audit.operationEdges)
      expect(Object.values(audit.quantityUpperBoundBuckets).reduce((a, b) => a + b, 0))
        .toBe(audit.operationEdges)
      // This is a static structure audit, not an optimal/feasible witness.
    },
  )
})
