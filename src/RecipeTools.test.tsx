import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import { evaluateRecipeSequence } from './domain/recipeEvaluator'
import {
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
