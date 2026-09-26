import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const recipeToolsSource = readFileSync(
  new URL('./RecipeTools.tsx', import.meta.url),
  'utf8',
)

describe('responsiveness wiring regression', () => {
  it('keeps bounded customer recipe search independent from query keystrokes', () => {
    expect(appSource).toMatch(
      /const customerSearchesByCustomerId = useMemo\([\s\S]*?\[recipeCandidatePool, currentProgress\],[\s\S]*?\n\s*\)/,
    )
    expect(appSource).toContain(
      "tab === 'customers' ? normalizedQuery : ''",
    )
    expect(appSource).toContain(
      "tab === 'recipes' ? normalizedQuery : ''",
    )
  })

  it('keeps customer indexing, research filters, and sorting off text-query keystrokes', () => {
    const searchTextMemo = appSource.match(
      /const customerSearchTextById = useMemo\([\s\S]*?\n  \)\n\n  const sortedCustomerResearchRows/,
    )?.[0]
    const sortedMemo = appSource.match(
      /const sortedCustomerResearchRows = useMemo\([\s\S]*?\n  \]\)\n\n  const customerRows/,
    )?.[0]

    expect(searchTextMemo).toBeDefined()
    expect(sortedMemo).toBeDefined()
    expect(searchTextMemo).not.toContain('normalizedCustomerQuery')
    expect(sortedMemo).not.toContain('normalizedCustomerQuery')
    expect(appSource).toMatch(
      /const customerRows = useMemo\(\(\) => \{[\s\S]*?sortedCustomerResearchRows\.filter/,
    )
    expect(appSource).toContain(
      'customerSearchTextById\n          .get(customer.id)\n          ?.includes(normalizedCustomerQuery)',
    )
  })

  it('narrows structured ingredient-sequence search before recipe filtering', () => {
    expect(appSource).toContain(
      'buildRecipeIngredientEntryIndex(recipeListEntries)',
    )
    expect(appSource).toContain(
      'const recipeSequenceEntries = useMemo(',
    )
    expect(appSource).toContain(
      'const sortedRecipeSequenceEntries = useMemo(',
    )
  })

  it('keeps recipe sorting and research filters off text-query keystrokes', () => {
    const sortedMemo = appSource.match(
      /const sortedRecipeSequenceEntries = useMemo\([\s\S]*?\n  \]\)\n\n  const researchFilteredRecipeEntries/,
    )?.[0]
    const researchMemo = appSource.match(
      /const researchFilteredRecipeEntries = useMemo\([\s\S]*?\n  \)\n\n  const recipeRows/,
    )?.[0]

    expect(sortedMemo).toBeDefined()
    expect(researchMemo).toBeDefined()
    expect(sortedMemo).not.toContain('normalizedRecipeQuery')
    expect(researchMemo).not.toContain('normalizedRecipeQuery')
    expect(appSource).toMatch(
      /const recipeRows = useMemo\(\(\) => \{[\s\S]*?researchFilteredRecipeEntries\.filter/,
    )
  })

  it('keeps urgent search typing local and the hidden optimizer memoized', () => {
    expect(appSource).toContain('const MemoizedOptimizerTools = memo(OptimizerTools)')
    expect(appSource).toContain('<MemoizedOptimizerTools')
    expect(appSource).toContain('startTransition(() => {')
    expect(appSource).toContain('setInputValue(value)')
    expect(appSource).toContain('useDeferredValue(satisfactionByVillage)')
  })

  it('commits saved recipe name and note only after the local draft is finished', () => {
    expect(recipeToolsSource).toContain(
      'onChange={(event) => setDraftName(event.target.value)}',
    )
    expect(recipeToolsSource).toContain('onBlur={commitName}')
    expect(recipeToolsSource).toContain(
      'onChange={(event) => setDraftNote(event.target.value)}',
    )
    expect(recipeToolsSource).toContain('onBlur={commitNote}')
    expect(recipeToolsSource).not.toMatch(
      /onChange=\{\(event\) =>\s*onUpdate\(\{ name:/,
    )
    expect(recipeToolsSource).not.toMatch(
      /onChange=\{\(event\) =>\s*onUpdate\(\{ note:/,
    )
  })
})
