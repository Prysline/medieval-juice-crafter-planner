export type PlanningUserErrorCode =
  | 'missing-physical-jar'
  | 'missing-physical-cup'
  | 'jar-storage-overflow'
  | 'missing-jar-slot'
  | 'trip-capacity'
  | 'leftover-storage'
  | 'retained-juice-conflict'
  | 'optimizer-no-solution'

export interface PlanningUserErrorContext {
  remainingServings?: number
  policy?: string
  solverStatus?: string
}

export class PlanningUserError extends Error {
  readonly code: PlanningUserErrorCode
  readonly context: PlanningUserErrorContext

  constructor(
    code: PlanningUserErrorCode,
    context: PlanningUserErrorContext = {},
    technicalMessage?: string,
  ) {
    super(technicalMessage ?? code)
    this.name = 'PlanningUserError'
    this.code = code
    this.context = context
  }
}

export interface PlanningErrorPresentation {
  title: string
  message: string
  suggestions: string[]
  technicalDetails?: string
}

function technicalDetails(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return undefined
}

export function presentPlanningError(
  error: unknown,
): PlanningErrorPresentation {
  if (error instanceof PlanningUserError) {
    const details = technicalDetails(error)

    switch (error.code) {
      case 'missing-physical-jar':
        return {
          title: '沒有可用的果汁罐',
          message: '目前沒有實際持有的果汁罐，無法安排販售。',
          suggestions: ['先在庫存中設定至少 1 個實體果汁罐。'],
          technicalDetails: details,
        }
      case 'missing-physical-cup':
        return {
          title: '沒有可用的杯子',
          message: '目前沒有任何乾淨或用過的實體杯，無法安排顧客服務。',
          suggestions: [
            '先在庫存中設定至少 1 個實體杯。',
            '若只有用過的杯子，規劃器會在可行時安排回家清洗。',
          ],
          technicalDetails: details,
        }
      case 'jar-storage-overflow':
        return {
          title: '果汁罐沒有合法存放位置',
          message:
            '目前持有的果汁罐數量超過果汁罐架與 10 格背包合計可容納的數量。',
          suggestions: [
            '增加果汁罐架容量。',
            '確認庫存中的實體果汁罐數量是否填寫正確。',
          ],
          technicalDetails: details,
        }
      case 'missing-jar-slot':
        return {
          title: '沒有可用的果汁罐格',
          message: '目前設定沒有留下任何可供販售使用的果汁罐格。',
          suggestions: [
            '改用「每趟自動計算」。',
            '或把固定果汁罐格數調成至少 1 格。',
          ],
          technicalDetails: details,
        }
      case 'trip-capacity':
        return {
          title: '這組杯具與背包空間排不出販售趟次',
          message:
            '目前的果汁罐格、杯子數量與用過杯處理方式，無法讓剩餘需求在 10 格背包內完成。',
          suggestions: [
            '若已有果汁罐架，可改用「每趟自動計算」或減少固定果汁罐格數。',
            '增加實體杯數，讓每趟可服務更多顧客。',
            '如果能接受杯子掉落，可開啟背包滿時允許掉落用過杯的選項。',
          ],
          technicalDetails: details,
        }
      case 'leftover-storage': {
        const remaining = error.context.remainingServings
        return {
          title: '剩餘果汁沒有足夠的實體罐可保留',
          message:
            remaining && remaining > 0
              ? `還有 ${remaining} 杯剩餘果汁需要保留，但目前的實體罐配置無法在不倒掉其他剩餘果汁的前提下保存。`
              : '剩餘果汁需要保留，但目前的實體罐配置無法在不倒掉其他剩餘果汁的前提下保存。',
          suggestions: [
            '增加實體果汁罐，或調整各罐的初始內容。',
            '已有果汁罐架時，可改用「每趟自動計算」或增加固定果汁罐格數。',
            '也可以改用較少果汁種類或較少剩餘量的規劃條件。',
          ],
          technicalDetails: details,
        }
      }
      case 'retained-juice-conflict':
        return {
          title: '現有果汁內容阻止了換裝',
          message:
            '目前需要保留的既有果汁尚未喝完，不能為了安排其他配方而自動倒掉或跨罐轉移。',
          suggestions: [
            '增加實體果汁罐。',
            '調整初始果汁罐內容，或減少需要同時使用的不同果汁種類。',
          ],
          technicalDetails: details,
        }
      case 'optimizer-no-solution':
        return {
          title: '目前條件找不到可行的批次規劃',
          message:
            '求解器無法在目前的顧客、候選配方與限制條件下找到完整可行方案。',
          suggestions: [
            '放寬最大果汁罐換裝次數等限制。',
            '確認目前主線進度、候選配方政策與庫存設定是否符合實際狀態。',
          ],
          technicalDetails: details,
        }
    }
  }

  return {
    title: '規劃資料發生不一致',
    message:
      '目前無法安全完成這次規劃。請重新產生規劃；若持續發生，可查看下方技術資訊協助除錯。',
    suggestions: ['確認庫存與規劃設定後重新執行。'],
    technicalDetails: technicalDetails(error),
  }
}
