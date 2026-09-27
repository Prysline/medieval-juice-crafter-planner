import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const recipeToolsSource = readFileSync(
  new URL('./RecipeTools.tsx', import.meta.url),
  'utf8',
)
const optimizerToolsSource = readFileSync(
  new URL('./OptimizerTools.tsx', import.meta.url),
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

  it('memoizes customer rows with stable id-based toggle handlers', () => {
    expect(appSource).toContain('const MemoizedCustomerRow = memo(CustomerRow)')
    expect(appSource).toContain('<MemoizedCustomerRow')
    expect(appSource).toContain('onToggleFormal={toggleFormalCustomer}')
    expect(appSource).toContain('onToggleSupplied={toggleSuppliedToday}')
    expect(appSource).toContain(
      'onToggleComparison={toggleComparisonCustomer}',
    )
    expect(appSource).toContain(
      'const toggleSuppliedToday = useCallback((customerId: string) => {',
    )
    expect(appSource).toContain(
      'const toggleFormalCustomer = useCallback((customerId: string) => {',
    )
    expect(appSource).toContain(
      'const toggleComparisonCustomer = useCallback((customerId: string) => {',
    )
    expect(appSource).not.toContain(
      'onToggleSupplied={() => toggleSuppliedToday(customer.id)}',
    )
  })

  it('keeps customer text-query visibility outside memoized row props', () => {
    expect(appSource).toContain(
      'const visibleCustomerIds = useMemo(',
    )
    expect(appSource).toContain(
      '{sortedCustomerResearchRows.map(',
    )
    expect(appSource).toContain(
      "'customer-row-shell last-visible'",
    )
    expect(appSource).toContain(
      'hidden={!visibleCustomerIds.has(customer.id)}',
    )
    expect(appSource).toContain(
      'customer.id === lastVisibleCustomerId',
    )

    const rowStart = appSource.indexOf('<MemoizedCustomerRow')
    const rowEnd = appSource.indexOf('/>', rowStart)
    const rowProps = appSource.slice(rowStart, rowEnd)

    expect(rowStart).toBeGreaterThanOrEqual(0)
    expect(rowEnd).toBeGreaterThan(rowStart)
    expect(rowProps).not.toContain('normalizedCustomerQuery')
    expect(rowProps).not.toContain('visibleCustomerIds')
    expect(rowProps).not.toContain('hidden=')
  })

  it('does not mount heavy customer details until the row is expanded', () => {
    expect(appSource).toContain('const [expanded, setExpanded] = useState(false)')
    expect(appSource).toContain(
      'onToggle={(event) => setExpanded(event.currentTarget.open)}',
    )
    expect(appSource).toMatch(
      /\{expanded && \(\s*<div className="row-details">/,
    )
  })

  it('does not mount recipe details or compute customer matches until the row is expanded', () => {
    const recipeRowSource = appSource.slice(
      appSource.indexOf('export function RecipeRow'),
      appSource.indexOf('function TagGroup'),
    )

    expect(recipeRowSource).toContain(
      'const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null)',
    )
    expect(recipeRowSource).toContain(
      'const expanded = expandedRecipeId === entry.id',
    )
    expect(recipeRowSource).toContain(
      'open={expanded}',
    )
    expect(recipeRowSource).toContain(
      'setExpandedRecipeId(event.currentTarget.open ? entry.id : null)',
    )
    expect(recipeRowSource).toMatch(
      /const matchingCustomers = expanded\s*\?\s*customers/,
    )
    expect(recipeRowSource).toMatch(
      /:\s*\[\]\s*\n\n  return/,
    )
    expect(recipeRowSource).toMatch(
      /\{expanded && \(\s*<div className="row-details">/,
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

  it('keeps recipe search page reset in the query transition and reuses positional row slots', () => {
    expect(appSource).toContain(
      "if (tab === 'recipes') setRecipePage(1)",
    )
    expect(appSource).toContain(
      '{pagedRecipeRows.map((entry, slotIndex) => (',
    )
    expect(appSource).toContain('key={slotIndex}')
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

  it('keeps optimizer customer search query local to the target panel', () => {
    const panelStart = optimizerToolsSource.indexOf(
      'function OptimizerCustomerTargetPanel',
    )
    const optimizerStart = optimizerToolsSource.indexOf(
      'function OptimizerTools',
    )
    const panelSource = optimizerToolsSource.slice(
      panelStart,
      optimizerStart,
    )
    const optimizerSource = optimizerToolsSource.slice(optimizerStart)

    expect(panelStart).toBeGreaterThanOrEqual(0)
    expect(optimizerStart).toBeGreaterThan(panelStart)
    expect(panelSource).toContain("const [query, setQuery] = useState('')")
    expect(panelSource).toContain('const filteredCustomers = useMemo')
    expect(panelSource).toContain(
      'onChange={(event) => setQuery(event.target.value)}',
    )
    expect(panelSource).toContain('if (!active) return null')
    expect(optimizerSource).toContain(
      "active={targetMode === 'customers'}",
    )
    expect(optimizerSource).not.toContain('customerTargetQuery')
    expect(panelSource).toContain(
      'onSelectedCustomerIdsChange((current) => [',
    )
    expect(panelSource).toContain(
      'onSelectedCustomerIdsChange((current) =>',
    )
  })

  it('defers optimizer search-index construction until the optimizer tab is active', () => {
    expect(appSource).toContain("active={tab === 'optimizer'}")
    expect(optimizerToolsSource).toMatch(
      /active\s*\?\s*buildInventoryRecipeSearchIndex\(inventoryRecipeEntries\)\s*:\s*EMPTY_INVENTORY_RECIPE_SEARCH_INDEX/,
    )
    expect(optimizerToolsSource).toMatch(
      /active\s*\?\s*buildIntermediateJuiceSearchIndex\([\s\S]*?intermediateInventoryEntries[\s\S]*?\)\s*:\s*EMPTY_INTERMEDIATE_JUICE_SEARCH_INDEX/,
    )
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
