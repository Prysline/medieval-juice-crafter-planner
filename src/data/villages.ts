import type { VillageDefinition, VillageId } from '../types'

export const villages: VillageDefinition[] = [
  {
    id: 'east-harbor',
    name: '東港村',
    unlockedAt: 'opening',
  },
  {
    id: 'tranquil-fountain',
    name: '靜謐噴泉',
    unlockedAt: 'tranquil-fountain-unlocked',
  },
  {
    id: 'ibex-statue',
    name: '羱羊雕像',
    unlockedAt: 'ibex-statue-unlocked',
  },
]

export const villageNames = Object.fromEntries(
  villages.map((village) => [village.id, village.name]),
) as Record<VillageId, string>
