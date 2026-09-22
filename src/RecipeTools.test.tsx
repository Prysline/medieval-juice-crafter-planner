import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import { evaluateRecipeSequence } from './domain/recipeEvaluator'
import {
  EvaluationPanel,
  RecipeTools,
  TargetCustomerPanel,
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
        onSavedRecipesChange={() => {
          savedRecipeChanges += 1
        }}
      />,
    )

    expect(html).toContain('配方模擬器')
    expect(html).toContain('酸味 4')
    expect(html).toContain('增強免疫 3')
    expect(html).toContain('目標顧客')
    expect(html).toContain('只供本次模擬參考，不會寫入玩家資料')
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
        onSavedRecipesChange={() => {}}
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

  it('routes target-customer changes only through the temporary selection callback', () => {
    const nanette = customers.find(
      (customer) => customer.id === 'nanette',
    )
    expect(nanette).toBeDefined()

    const evaluation = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )
    let selected = ''
    const element = TargetCustomerPanel({
      customers: [nanette!],
      selectedCustomer: null,
      selectedCustomerId: '',
      onSelect: (customerId) => {
        selected = customerId
      },
      evaluation,
    })

    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children]
    const label = children.find(
      (child: { type?: unknown }) => child?.type === 'label',
    )
    expect(label).toBeDefined()
    const labelChildren = Array.isArray(label.props.children)
      ? label.props.children
      : [label.props.children]
    const select = labelChildren.find(
      (child: { type?: unknown }) => child?.type === 'select',
    )
    expect(select).toBeDefined()

    select.props.onChange({
      target: { value: nanette!.id },
    })
    expect(selected).toBe('nanette')
  })

  it('shows customer preferences and the current recipe match level', () => {
    const nanette = customers.find(
      (customer) => customer.id === 'nanette',
    )
    expect(nanette).toBeDefined()

    const evaluation = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )
    expect(evaluation.valid).toBe(true)

    const html = renderToStaticMarkup(
      <TargetCustomerPanel
        customers={[nanette!]}
        selectedCustomer={nanette!}
        selectedCustomerId={nanette!.id}
        onSelect={() => {}}
        evaluation={evaluation}
      />,
    )

    expect(html).toContain('娜內特（魚販）')
    expect(html).toContain('原料：檸檬')
    expect(html).toContain('特性：增強免疫')
    expect(html).toContain('完全匹配')
  })
})
