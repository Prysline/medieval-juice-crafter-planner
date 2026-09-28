import type { VillageId } from '../types'

export interface CustomerResidenceDefinition {
  id: string
  villageId: VillageId
  number: number
  customerIds: readonly string[]
}

/**
 * Confirmed home-residence / delivery-stop identity from direct game door-list
 * observations. Residence numbers are local to each Region, so stable IDs always
 * include the Region namespace. This data does not imply route distance or
 * current-time NPC location.
 */
export const customerResidences: readonly CustomerResidenceDefinition[] = [
  {
    id: 'east-harbor-residence-1',
    villageId: 'east-harbor',
    number: 1,
    customerIds: ['eric'],
  },
  {
    id: 'east-harbor-residence-2',
    villageId: 'east-harbor',
    number: 2,
    customerIds: ['derrick', 'katrin', 'ulrich', 'viviana', 'barti'],
  },
  {
    id: 'east-harbor-residence-3',
    villageId: 'east-harbor',
    number: 3,
    customerIds: ['konrad', 'yolanda'],
  },
  {
    id: 'east-harbor-residence-4',
    villageId: 'east-harbor',
    number: 4,
    customerIds: ['fulbertus', 'galiana', 'ivo'],
  },
  {
    id: 'east-harbor-residence-5',
    villageId: 'east-harbor',
    number: 5,
    customerIds: ['thomas', 'alia', 'nanette'],
  },
  {
    id: 'east-harbor-residence-6',
    villageId: 'east-harbor',
    number: 6,
    customerIds: ['maximus', 'christian', 'lizzy', 'tricus'],
  },
  {
    id: 'east-harbor-residence-7',
    villageId: 'east-harbor',
    number: 7,
    customerIds: ['jack', 'patricia', 'leticia'],
  },
  {
    id: 'east-harbor-residence-8',
    villageId: 'east-harbor',
    number: 8,
    customerIds: ['harry', 'lizzie', 'zenobia'],
  },
  {
    id: 'east-harbor-residence-9',
    villageId: 'east-harbor',
    number: 9,
    customerIds: ['betsy', 'otilde', 'william', 'ralph', 'pierre'],
  },
  {
    id: 'tranquil-fountain-residence-1',
    villageId: 'tranquil-fountain',
    number: 1,
    customerIds: ['ricon', 'betty'],
  },
  {
    id: 'tranquil-fountain-residence-2',
    villageId: 'tranquil-fountain',
    number: 2,
    customerIds: ['peter', 'wilmetta', 'pauline'],
  },
  {
    id: 'tranquil-fountain-residence-3',
    villageId: 'tranquil-fountain',
    number: 3,
    customerIds: ['jacob', 'christina', 'florida'],
  },
  {
    id: 'tranquil-fountain-residence-4',
    villageId: 'tranquil-fountain',
    number: 4,
    customerIds: ['daniel', 'gavinus', 'avina', 'lila', 'hugo', 'ulbert', 'macarius'],
  },
  {
    id: 'tranquil-fountain-residence-5',
    villageId: 'tranquil-fountain',
    number: 5,
    customerIds: ['nicholas', 'tacy', 'valerian'],
  },
  {
    id: 'tranquil-fountain-residence-6',
    villageId: 'tranquil-fountain',
    number: 6,
    customerIds: ['solomon', 'octavius', 'ingrid', 'emerys', 'sarah'],
  },
  {
    id: 'ibex-statue-residence-1',
    villageId: 'ibex-statue',
    number: 1,
    customerIds: ['charles', 'tiffany'],
  },
  {
    id: 'ibex-statue-residence-2',
    villageId: 'ibex-statue',
    number: 2,
    customerIds: ['milon', 'julia'],
  },
  {
    id: 'ibex-statue-residence-3',
    villageId: 'ibex-statue',
    number: 3,
    customerIds: ['rolf', 'ambrosia'],
  },
  {
    id: 'ibex-statue-residence-4',
    villageId: 'ibex-statue',
    number: 4,
    customerIds: ['savius', 'petra'],
  },
  {
    id: 'ibex-statue-residence-5',
    villageId: 'ibex-statue',
    number: 5,
    customerIds: ['harvey', 'nantelma'],
  },
  {
    id: 'ibex-statue-residence-6',
    villageId: 'ibex-statue',
    number: 6,
    customerIds: ['thorsten', 'gisela', 'frotga', 'lismon', 'isabel'],
  },
  {
    id: 'ibex-statue-residence-7',
    villageId: 'ibex-statue',
    number: 7,
    customerIds: ['bernard', 'dominic', 'martha'],
  },
  {
    id: 'ibex-statue-residence-8',
    villageId: 'ibex-statue',
    number: 8,
    customerIds: ['oliver', 'heloise', 'gonzalo'],
  },
]

export const customerResidenceByCustomerId: Readonly<Record<string, string>> =
  Object.fromEntries(
    customerResidences.flatMap((residence) =>
      residence.customerIds.map(
        (customerId) => [customerId, residence.id] as const,
      ),
    ),
  )
