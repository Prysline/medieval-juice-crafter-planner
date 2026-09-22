import { describe, expect, it } from 'vitest'
import {
  PlanningUserError,
  presentPlanningError,
} from './planningErrors'

describe('planning error presentation', () => {
  it('states how many terminal jars are required and how many more are needed', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'leftover-storage',
        {
          remainingServings: 1,
          requiredTerminalJarCount: 5,
          reusableTerminalJarCount: 4,
          retainedJarCount: 1,
        },
        'Not enough terminal sales-jar capacity',
      ),
    )

    expect(result.title).toBe('剩餘果汁沒有足夠的實體罐可保留')
    expect(result.message).toContain('需要至少 5 個')
    expect(result.message).toContain('目前只有 4 個')
    expect(result.message).toContain('還需要至少 1 個')
    expect(result.message).toContain('另有 1 個果汁罐因既有內容必須保留')
    expect(result.message).toContain('1 杯')
    expect(result.technicalDetails).toBe(
      'Not enough terminal sales-jar capacity',
    )
  })

  it('presents jar schedule mismatch as an internal planning error', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'jar-schedule-inconsistency',
        {
          expectedJarTypeSwitches: 1,
          actualJarTypeSwitches: 2,
        },
        'Physical jar schedule realized 2 switch(es), expected 1',
      ),
    )

    expect(result.title).toBe('果汁罐排程發生內部不一致')
    expect(result.message).toContain('最佳化預期 1 次換裝')
    expect(result.message).toContain('實體排程產生 2 次')
    expect(result.message).toContain('網站內部規劃錯誤')
    expect(result.suggestions.join(' ')).not.toContain(
      '確認庫存與規劃設定後重新執行',
    )
    expect(result.technicalDetails).toContain(
      'Physical jar schedule realized 2',
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
