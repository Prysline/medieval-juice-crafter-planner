import { describe, expect, it } from 'vitest'
import {
  PlanningUserError,
  presentPlanningError,
} from './planningErrors'

describe('planning error presentation', () => {
  it('turns leftover capacity into a Chinese actionable message', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'leftover-storage',
        { remainingServings: 3 },
        'Not enough terminal sales-jar capacity',
      ),
    )

    expect(result.title).toBe('剩餘果汁沒有足夠的實體罐可保留')
    expect(result.message).toContain('3 杯')
    expect(result.suggestions.join(' ')).toContain('果汁罐架')
    expect(result.technicalDetails).toBe(
      'Not enough terminal sales-jar capacity',
    )
  })

  it('keeps unknown invariant details secondary to a Chinese summary', () => {
    const result = presentPlanningError(
      new Error('Physical jar timeline drifted'),
    )

    expect(result.title).toBe('規劃處理發生問題')
    expect(result.message).not.toContain('Physical jar')
    expect(result.technicalDetails).toBe(
      'Physical jar timeline drifted',
    )
  })

  it('provides a concrete fix for fixed-slot failures', () => {
    const result = presentPlanningError(
      new PlanningUserError('missing-jar-slot'),
    )

    expect(result.suggestions.join(' ')).toContain('每趟自動計算')
    expect(result.suggestions.join(' ')).toContain('至少 1 格')
  })
})
