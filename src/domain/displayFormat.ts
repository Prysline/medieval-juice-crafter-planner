export function formatMoney(
  value: number | null,
): string {
  if (value === null) return '未知'
  const amount = Number.isInteger(value)
    ? String(value)
    : value.toFixed(1)
  return `${amount} 金幣`
}

export function formatRecipeSequence(
  values: string[],
): string {
  return values.join('▸')
}

export function formatRecipeDisplayName(
  name: string,
): string {
  return name
    .replace(/\s*→\s*/g, '▸')
    .replace(/\s+-\s+/g, '▸')
}

export function formatRecipeIngredientCost(
  batchIngredientCost: number | null,
  unitIngredientCost: number | null,
): string {
  if (
    batchIngredientCost === null ||
    unitIngredientCost === null
  ) {
    return '未知'
  }

  return (
    `${formatMoney(batchIngredientCost)}／批 · ` +
    `${formatMoney(unitIngredientCost)}／杯`
  )
}
