import { describe, expect, it } from 'vitest'
import {
  OptimizerWorkerExecutionError,
  OptimizerWorkerRuntimeError,
  PlanningUserError,
  presentPlanningError,
} from './planningErrors'

describe('planning error presentation', () => {
  it('presents Worker runtime failure separately from planning infeasibility', () => {
    const result = presentPlanningError(
      new OptimizerWorkerRuntimeError(
        'worker-error-event',
        'Script error at optimizerWorker.js:42',
      ),
    )

    expect(result.title).toBe('背景規劃程序異常中止')
    expect(result.message).toContain('runtime／通訊異常')
    expect(result.message).toContain('找不到可行方案')
    expect(result.suggestions.join(' ')).not.toContain(
      '確認庫存與規劃設定後重新執行',
    )
    expect(result.suggestions.join(' ')).toContain(
      '不需要為了這個錯誤反覆修改庫存',
    )
    expect(result.technicalDetails).toContain(
      'Worker phase: worker-error-event',
    )
    expect(result.technicalDetails).toContain(
      'Script error at optimizerWorker.js:42',
    )
  })

  it('presents Worker execution exceptions as internal errors rather than user-fixable inventory failures', () => {
    const result = presentPlanningError(
      new OptimizerWorkerExecutionError(
        'unexpected optimizer invariant',
      ),
    )

    expect(result.title).toBe('背景規劃程序發生內部錯誤')
    expect(result.message).toContain('未分類錯誤')
    expect(result.message).toContain('PlanningUserError')
    expect(result.suggestions.join(' ')).not.toContain(
      '確認庫存與規劃設定後重新執行',
    )
    expect(result.technicalDetails).toBe(
      'unexpected optimizer invariant',
    )
  })

  it('attributes fixed-trip realization failure to the requested trip', () => {
    const presentation = presentPlanningError(
      new PlanningUserError(
        'fixed-trip-realization',
        { fixedTripNumber: 3 },
        'fixed trip mismatch',
      ),
    )

    expect(presentation.title).toBe(
      '自訂趟次無法依指定安排實現',
    )
    expect(presentation.message).toContain('第 3 趟')
    expect(presentation.technicalDetails).toBe(
      'fixed trip mismatch',
    )
  })

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
  it('treats an inventory-only raw shortfall after solving as an internal authority mismatch', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'optimizer-no-solution',
        {
          solverStatus: 'inventory-authority-mismatch',
          materialSourceMode: 'inventory-only',
          inventoryShortfalls: [
            { ingredientId: 'lemon', units: 1 },
          ],
        },
        'inventory-only result still requires a purchase',
      ),
    )

    expect(result.title).toBe('庫存模式無法安全完成這次規劃')
    expect(result.message).toContain('檸檬 ×1')
    expect(result.message).toContain('內部不一致')
    expect(result.message).toContain('不是因為部分顧客未被涵蓋')
  })

  it('does not describe an unexpected inventory-only solver failure as requiring all selected customers', () => {
    const result = presentPlanningError(
      new PlanningUserError(
        'optimizer-no-solution',
        {
          solverStatus: 'infeasible',
          materialSourceMode: 'inventory-only',
        },
        'unexpected inventory solve failure',
      ),
    )

    expect(result.title).toBe('庫存模式無法安全完成這次規劃')
    expect(result.message).toContain('已允許只規劃目前庫存能涵蓋的顧客')
    expect(result.message).not.toContain('完整顧客集合')
  })

})
