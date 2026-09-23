import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import { evaluateRecipeSequence } from './domain/recipeEvaluator'
import {
  CustomerComparisonPanel,
  EvaluationPanel,
  RecipeTools,
} from './RecipeTools'

const satisfaction = {
  'east-harbor': 0,
  'tranquil-fountain': 0,
} as const

describe('recipe simulator UX', () => {
  it('shows ingredient effects and a temporary target-customer control without persisting on render', () => {
    let savedRecipeChanges = 0
    const html = renderToStaticMarkup(
      <RecipeTools
        currentProgress="opening"
        satisfactionByVillage={satisfaction}
        savedRecipes={[]}
        comparisonCustomerIds={[]}
        onAddComparisonCustomer={() => {}}
        onRemoveComparisonCustomer={() => {}}
        onClearComparisonCustomers={() => {}}
        onSavedRecipesChange={() => {
          savedRecipeChanges += 1
        }}
      />,
    )

    expect(html).toContain('配方模擬器')
    expect(html).toContain('酸味 4')
    expect(html).toContain('增強免疫 3')
    expect(html).toContain('比較顧客')
    expect(html).toContain('同一頁面工作階段保留，不會寫入玩家持久資料')
    expect(html).toContain('加莉安娜（麵包師）')
    expect(savedRecipeChanges).toBe(0)
  })

  it('shows full pre-cutoff effect totals without treating them as final product effects', () => {
    const evaluation = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )
    expect(evaluation.valid).toBe(true)
    if (!evaluation.valid) return

    const html = renderToStaticMarkup(
      <EvaluationPanel
        evaluation={evaluation}
        matchingCustomers={[]}
      />,
    )

    expect(html).toContain('成品特性（實測）')
    expect(html).toContain('完整特性累計（截斷前）')
    expect(html).toContain('保護心臟（1）')
    expect(html).toContain('輔助瘦身（1）')
    expect(html).toContain('不代表每項都會出現在最終成品欄位')
  })

  it('shows concrete saved-recipe effects and keeps ambiguous effects visibly separate', () => {
    const html = renderToStaticMarkup(
      <RecipeTools
        currentProgress="tranquil-fountain-unlocked"
        satisfactionByVillage={satisfaction}
        savedRecipes={[
          {
            id: 'saved-lemon',
            name: '我的檸檬汁',
            ingredientIds: ['lemon'],
            createdAt: '2026-09-22T00:00:00.000Z',
          },
          {
            id: 'saved-ambiguous',
            name: '待研究配方',
            ingredientIds: ['lemon', 'cinnamon', 'mint'],
            createdAt: '2026-09-22T00:00:00.000Z',
          },
        ]}
        comparisonCustomerIds={[]}
        onSavedRecipesChange={() => {}}
        onAddComparisonCustomer={() => {}}
        onRemoveComparisonCustomer={() => {}}
        onClearComparisonCustomers={() => {}}
      />,
    )

    expect(html).toContain('我的檸檬汁')
    expect(html).toContain('成品特性（實測）')
    expect(html).toContain('酸味（4）')
    expect(html).toContain('增強免疫（3）')
    expect(html).toContain('待研究配方')
    expect(html).toContain('確定成品特性（預測）')
    expect(html).toContain('可能特性：剩')
    expect(html).toContain('可能特性不視為確定成品特性')
  })

  it('shows confirmed personal evidence separately from predictions', () => {
    const html = renderToStaticMarkup(
      <RecipeTools
        currentProgress="tranquil-fountain-unlocked"
        satisfactionByVillage={satisfaction}
        savedRecipes={[
          {
            id: 'confirmed-personal',
            name: '我的可靠配方',
            ingredientIds: ['banana', 'sugar'],
            createdAt: '2026-09-24T00:00:00.000Z',
            confirmedResult: {
              effects: [
                { name: '玩家確認特性', value: 9 },
                { name: '甜味', value: 4 },
              ],
              salePrice: null,
              confirmedAt: '2026-09-24T00:00:00.000Z',
            },
          },
        ]}
        comparisonCustomerIds={[]}
        onSavedRecipesChange={() => {}}
        onAddComparisonCustomer={() => {}}
        onRemoveComparisonCustomer={() => {}}
        onClearComparisonCustomers={() => {}}
      />,
    )

    expect(html).toContain('我的可靠配方')
    expect(html).toContain('個人已確認')
    expect(html).toContain('成品特性（個人已確認）')
    expect(html).toContain('玩家確認特性（9）')
    expect(html).toContain('取消個人實測確認')
    expect(html).toContain(
      '我已在遊戲中核對上方成品特性，可供批次規劃使用',
    )
  })

  it('shows multiple comparison customers and their independent match states', () => {
    const nanette = customers.find(
      (customer) => customer.id === 'nanette',
    )
    const jack = customers.find(
      (customer) => customer.id === 'jack',
    )
    expect(nanette).toBeDefined()
    expect(jack).toBeDefined()

    const evaluation = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )
    expect(evaluation.valid).toBe(true)

    const html = renderToStaticMarkup(
      <CustomerComparisonPanel
        availableCustomers={[nanette!, jack!]}
        comparisonCustomerIds={[nanette!.id, jack!.id]}
        evaluation={evaluation}
        onAdd={() => {}}
        onRemove={() => {}}
        onClear={() => {}}
      />,
    )

    expect(html).toContain('娜內特（魚販）')
    expect(html).toContain('傑克（帽匠）')
    expect(html).toContain('原料：檸檬')
    expect(html).toContain('特性：增強免疫')
    expect(html).toContain('完全匹配')
    expect(html).toContain('未匹配')
    expect(html).toContain('全部清除')
    expect(html).toContain('移除 娜內特 比較')
    expect(html).toContain('移除 傑克 比較')
  })

  it('does not re-offer customers already in the comparison list', () => {
    const nanette = customers.find(
      (customer) => customer.id === 'nanette',
    )
    const jack = customers.find(
      (customer) => customer.id === 'jack',
    )
    expect(nanette).toBeDefined()
    expect(jack).toBeDefined()

    const evaluation = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )

    const html = renderToStaticMarkup(
      <CustomerComparisonPanel
        availableCustomers={[nanette!, jack!]}
        comparisonCustomerIds={[nanette!.id]}
        evaluation={evaluation}
        onAdd={() => {}}
        onRemove={() => {}}
        onClear={() => {}}
      />,
    )

    expect(html).toContain('<option value="jack">傑克（帽匠）</option>')
    expect(html).not.toContain('<option value="nanette">娜內特（魚販）</option>')
  })

})
