import type { Customer, VillageId } from '../types'

export const eastHarborCustomerGameOrder = [
  'galiana',
  'otilde',
  'ulrich',
  'alia',
  'leticia',
  'katrin',
  'viviana',
  'konrad',
  'jack',
  'nanette',
  'maximus',
  'fulbertus',
  'lizzy',
  'barti',
  'harry',
  'lizzie',
  'thomas',
  'pierre',
  'betsy',
  'ralph',
  'eric',
  'derrick',
  'william',
  'christian',
  'tricus',
  'yolanda',
  'ivo',
  'zenobia',
  'patricia',
] as const

export const tranquilFountainCustomerGameOrder = [
  'ingrid',
  'peter',
  'wilmetta',
  'solomon',
  'daniel',
  'lila',
  'avina',
  'hugo',
  'christina',
  'jacob',
  'betty',
  'ricon',
  'tacy',
  'nicholas',
  'emerys',
  'gavinus',
  'florida',
  'sarah',
  'pauline',
  'valerian',
  'octavius',
  'ulbert',
  'macarius',
] as const

export const ibexStatueCustomerGameOrder = [
  'milon',
  'thorsten',
  'julia',
  'martha',
  'charles',
  'tiffany',
  'harvey',
  'nantelma',
  'bernard',
  'dominic',
  'oliver',
  'heloise',
  'rolf',
  'ambrosia',
  'gisela',
  'frotga',
  'lismon',
  'isabel',
  'gonzalo',
  'savius',
  'petra',
] as const

export const observedCustomerGameOrderByVillage: Partial<
  Record<VillageId, readonly string[]>
> = {
  'east-harbor': eastHarborCustomerGameOrder,
  'tranquil-fountain': tranquilFountainCustomerGameOrder,
  'ibex-statue': ibexStatueCustomerGameOrder,
}

export function buildCustomerGameOrder(
  customerDefinitions: readonly Customer[],
): Map<string, number> {
  const sourceIndex = new Map(
    customerDefinitions.map((customer, index) => [customer.id, index]),
  )
  const explicitIndexByVillage = new Map<
    VillageId,
    Map<string, number>
  >(
    Object.entries(observedCustomerGameOrderByVillage).flatMap(
      ([villageId, customerIds]) =>
        customerIds
          ? [[
              villageId as VillageId,
              new Map(
                customerIds.map((customerId, index) => [
                  customerId,
                  index,
                ]),
              ),
            ] as const]
          : [],
    ),
  )

  const ordered = [...customerDefinitions].sort((left, right) => {
    const sourceDelta =
      (sourceIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (sourceIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)

    if (left.villageId !== right.villageId) return sourceDelta

    const explicitIndex = explicitIndexByVillage.get(left.villageId)
    if (!explicitIndex) return sourceDelta

    const leftRank =
      explicitIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
    const rightRank =
      explicitIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER

    return leftRank - rightRank || sourceDelta
  })

  return new Map(
    ordered.map((customer, index) => [customer.id, index]),
  )
}
