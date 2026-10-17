from pathlib import Path

EXPECTED_EXTRA_PARTITIONS = {
    (4, 1),
    (3, 2),
    (3, 1, 1),
    (2, 2, 1),
    (2, 1, 1, 1),
    (1, 1, 1, 1, 1),
}


def integer_partitions(total: int, maximum: int | None = None) -> set[tuple[int, ...]]:
    if total == 0:
        return {()}
    upper = total if maximum is None else min(total, maximum)
    result: set[tuple[int, ...]] = set()
    for first in range(upper, 0, -1):
        for rest in integer_partitions(total - first, first):
            result.add((first, *rest))
    return result


actual_partitions = integer_partitions(5)
if actual_partitions != EXPECTED_EXTRA_PARTITIONS:
    raise SystemExit(
        'Phase H five-extra partition drift: '
        f'expected {sorted(EXPECTED_EXTRA_PARTITIONS, reverse=True)}, '
        f'got {sorted(actual_partitions, reverse=True)}'
    )

path = Path('src/domain/optimizerLbbdCanonical69QuotientPrototype.test.ts')
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f'{label} target not found exactly once')
    text = text.replace(old, new, 1)


replace_once(
    "      declaredCap,\n      7,\n",
    "      declaredCap,\n      5,\n",
    'Phase H five-extra unit cap',
)

model_target = '        model.minimize(positiveKinds)'
model_replacement = """        model.addConstraint(
          positiveKinds.eq(29),
          'q_recipe_kinds_case',
        )

        if (
          groups.length !== domain.recipes.length ||
          groups.some((group) => group.recipeIds.length !== 1)
        ) {
          throw new Error(
            'Phase H five-extra proof requires one quotient group per original recipe identity',
          )
        }

        const extraCase = process.env.OPTIMIZER_PHASE_H_EXTRA_PARTITION
        const extraCaseSpecs: Record<
          string,
          {
            bonusKinds: number
            extraUpper?: number
            highUnits?: number
          }
        > = {
          '4-1': { bonusKinds: 2, highUnits: 5 },
          '3-2': { bonusKinds: 2, extraUpper: 3 },
          '3-1-1': { bonusKinds: 3, highUnits: 4 },
          '2-2-1': { bonusKinds: 3, extraUpper: 2 },
          '2-1-1-1': { bonusKinds: 4 },
          '1-1-1-1-1': { bonusKinds: 5 },
        }
        const extraCaseSpec = extraCase
          ? extraCaseSpecs[extraCase]
          : undefined
        if (!extraCaseSpec) {
          throw new Error(`Unknown Phase H five-extra case ${extraCase}`)
        }

        const bonusIdentityVars: BoolVariable[] = []
        const highIdentityVars: BoolVariable[] = []
        for (const [groupIndex, group] of groups.entries()) {
          const variables = varsByGroup.get(group.key)!
          if (variables.sixPlusIdentities) {
            throw new Error(
              `Phase H five-extra cap drift for ${group.recipeIds[0]}`,
            )
          }
          if (group.normalUnitCap <= 1) continue

          const bonus = model.boolVar(`q_bonus_${groupIndex}`)
          bonusIdentityVars.push(bonus)
          model.addConstraint(
            bonus.minus(variables.normalIdentities).leq(0),
            `q_bonus_used_${groupIndex}`,
          )
          model.addConstraint(
            sum(variables.normalIdentities, bonus)
              .minus(variables.units)
              .leq(0),
            `q_bonus_lower_${groupIndex}`,
          )
          model.addConstraint(
            variables.units
              .minus(variables.normalIdentities)
              .minus(bonus.times(group.normalUnitCap - 1))
              .leq(0),
            `q_bonus_upper_${groupIndex}`,
          )

          if (extraCaseSpec.extraUpper !== undefined) {
            model.addConstraint(
              variables.units
                .minus(variables.normalIdentities)
                .minus(bonus.times(extraCaseSpec.extraUpper))
                .leq(0),
              `q_case_extra_upper_${groupIndex}`,
            )
          }

          if (
            extraCaseSpec.highUnits !== undefined &&
            group.normalUnitCap >= extraCaseSpec.highUnits
          ) {
            const high = model.boolVar(`q_high_${groupIndex}`)
            highIdentityVars.push(high)
            model.addConstraint(
              high.minus(bonus).leq(0),
              `q_high_bonus_${groupIndex}`,
            )
            model.addConstraint(
              high
                .times(extraCaseSpec.highUnits)
                .minus(variables.units)
                .leq(0),
              `q_high_units_${groupIndex}`,
            )
          }
        }

        model.addConstraint(
          sum(...bonusIdentityVars).eq(extraCaseSpec.bonusKinds),
          'q_bonus_kind_count',
        )
        if (extraCaseSpec.highUnits !== undefined) {
          if (highIdentityVars.length === 0) {
            throw new Error(
              `Phase H five-extra case ${extraCase} has no eligible high-unit identity`,
            )
          }
          model.addConstraint(
            sum(...highIdentityVars).eq(1),
            'q_high_kind_count',
          )
        }

        console.info(
          '[phase-h-canonical69-five-extra-case-model]',
          JSON.stringify({
            extraCase,
            bonusKinds: extraCaseSpec.bonusKinds,
            extraUpper: extraCaseSpec.extraUpper ?? null,
            highUnits: extraCaseSpec.highUnits ?? null,
            bonusIdentityVars: bonusIdentityVars.length,
            highIdentityVars: highIdentityVars.length,
          }),
        )
        model.minimize(positiveKinds)"""
replace_once(
    model_target,
    model_replacement,
    'Phase H five-extra partition injection',
)

result_target = """        expect(
          state,
          state === 'exact-infeasible-at-102'
            ? 'Exact quotient proves no original-domain 102 witness exists'
            : 'Limit/unknown remains performance evidence only',
        ).toBe('witness-ready')
        if (state !== 'witness-ready') return

        const witness: RecipeUnitSelection[] = []"""
result_replacement = """        console.info(
          '[phase-h-canonical69-five-extra-case-result]',
          JSON.stringify({
            extraCase: process.env.OPTIMIZER_PHASE_H_EXTRA_PARTITION,
            status: solution.status,
            disposition: state,
            objective:
              typeof solution.objective === 'number'
                ? solution.objective
                : null,
          }),
        )
        if (state === 'exact-infeasible-at-102') return
        expect(
          state,
          'Limit/unknown remains performance evidence only',
        ).toBe('witness-ready')
        if (state !== 'witness-ready') return

        const witness: RecipeUnitSelection[] = []"""
replace_once(
    result_target,
    result_replacement,
    'Phase H five-extra result handling',
)

path.write_text(text)
