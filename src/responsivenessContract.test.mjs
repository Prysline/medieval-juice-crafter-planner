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

  it('narrows structured ingredient-sequence search before recipe filters and sorting', () => {
    expect(appSource).toContain(
      'buildContiguousRecipeSequenceIndex(recipeListEntries)',
    )
    expect(appSource).toContain(
      'const recipeSequenceEntries = useMemo(',
    )
    expect(appSource).toMatch(
      /const recipeRows = useMemo\(\(\) => \{\s*const rows = recipeSequenceEntries/,
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
