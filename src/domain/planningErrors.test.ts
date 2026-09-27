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

  it('presents jar type-transition mismatch as an internal planning error', () => {
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
    expect(result.message).toContain('最佳化預期 1 次內容種類切換')
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
  it('lists selected customers that have no reliable full match independently of inventory', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'optimizer-no-solution',
        {
          solverStatus: 'unresolved-customers',
          materialSourceMode: 'inventory-only',
          unresolvedCustomerIds: ['missing-a', 'missing-b'],
        },
        'unresolved customer fixture',
      ),
    )

    expect(result.title).toBe('有選定顧客沒有可用的完整匹配配方')
    expect(result.message).toContain('missing-a、missing-b')
    expect(result.message).toContain('這不是庫存不足造成的')
    expect(result.message).toContain('一般規劃')
  })

  it('shows which customers are left out by a maximum-cardinality inventory diagnostic', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'optimizer-no-solution',
        {
          solverStatus: 'infeasible',
          materialSourceMode: 'inventory-only',
          inventoryShortfalls: [
            { ingredientId: 'lemon', units: 1 },
          ],
          inventorySatisfiableCustomerCount: 1,
          inventoryUnfulfilledCustomerIds: ['blocked-customer'],
        },
        'inventory constrained solve infeasible',
      ),
    )

    expect(result.title).toBe('現有庫存無法完成這批顧客')
    expect(result.message).toContain('最多可完成 1 / 2 位')
    expect(result.message).toContain('blocked-customer')
    expect(result.message).toContain('檸檬 ×1')
    expect(result.message).toContain('只用於診斷')
  })

  it('explains the minimum raw shortfall for inventory-only infeasibility', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'optimizer-no-solution',
        {
          solverStatus: 'infeasible',
          materialSourceMode: 'inventory-only',
          inventoryShortfalls: [
            { ingredientId: 'lemon', units: 1 },
          ],
        },
        'inventory constrained solve infeasible',
      ),
    )

    expect(result.title).toBe('現有庫存無法完成這批顧客')
    expect(result.message).toContain('檸檬 ×1')
    expect(result.message).toContain('不會自動購買')
    expect(result.suggestions.join(' ')).toContain('一般規劃')
  })


})
