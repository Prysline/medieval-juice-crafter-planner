import { describe, expect, it } from 'vitest'
import { planMinimumJarTypeSwitchSequences } from './jarSwitches'

describe('terminal-aware minimum jar-switch sequence planner', () => {
  it('keeps matching terminal recipes dedicated when possible', () => {
    const plan = planMinimumJarTypeSwitchSequences(
      [
        { physicalJarId: 'jar-a', currentRecipeId: 'a' },
        { physicalJarId: 'jar-b', currentRecipeId: 'b' },
      ],
      ['a', 'b', 'c'],
      ['a', 'b'],
    )

    expect(plan.minimumSwitches).toBe(2)
    expect(plan.sequences).toEqual([
      {
        physicalJarId: 'jar-a',
        recipeIds: ['c', 'a'],
      },
      {
        physicalJarId: 'jar-b',
        recipeIds: ['b'],
      },
    ])
  })

  it('uses an empty jar as a free non-terminal start before ending on a terminal recipe', () => {
    const plan = planMinimumJarTypeSwitchSequences(
      [
        { physicalJarId: 'jar-a', currentRecipeId: null },
        { physicalJarId: 'jar-b', currentRecipeId: null },
      ],
      ['a', 'b', 'c'],
      ['a', 'b'],
    )

    expect(plan.minimumSwitches).toBe(1)
    expect(
      plan.sequences.flatMap((sequence) => sequence.recipeIds),
    ).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(
      plan.sequences.every((sequence) => {
        const terminalIndex = sequence.recipeIds.findIndex(
          (recipeId) => recipeId === 'a' || recipeId === 'b',
        )
        return (
          terminalIndex < 0 ||
          terminalIndex === sequence.recipeIds.length - 1
        )
      }),
    ).toBe(true)
  })

  it('preserves current matching starts for non-terminal recipes', () => {
    const plan = planMinimumJarTypeSwitchSequences(
      [
        { physicalJarId: 'jar-a', currentRecipeId: 'a' },
        { physicalJarId: 'jar-empty', currentRecipeId: null },
      ],
      ['a', 'c', 'd'],
      ['d'],
    )

    expect(plan.minimumSwitches).toBe(1)
    expect(plan.sequences).toEqual([
      {
        physicalJarId: 'jar-a',
        recipeIds: ['a'],
      },
      {
        physicalJarId: 'jar-empty',
        recipeIds: ['c', 'd'],
      },
    ])
  })
})
