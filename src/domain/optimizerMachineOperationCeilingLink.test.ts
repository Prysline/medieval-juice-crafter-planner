import { describe, expect, it } from 'vitest'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'

describe('machine operation exact ceiling link', () => {
  it('permits exactly ceil(quantity / stack capacity), including zero', () => {
    const maxQuantity = PROCESSING_STACK_CAPACITY * 3 + 2

    for (let quantity = 0; quantity <= maxQuantity; quantity += 1) {
      const expectedOperationCount = Math.ceil(
        quantity / PROCESSING_STACK_CAPACITY,
      )
      const feasibleOperationCounts = Array.from(
        { length: expectedOperationCount + 3 },
        (_, operationCount) => operationCount,
      ).filter(
        (operationCount) =>
          quantity <= PROCESSING_STACK_CAPACITY * operationCount &&
          PROCESSING_STACK_CAPACITY * operationCount - quantity <=
            PROCESSING_STACK_CAPACITY - 1,
      )

      expect(feasibleOperationCounts).toEqual([expectedOperationCount])
    }
  })
})
