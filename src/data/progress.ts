import type { ProgressMilestoneDefinition, ProgressMilestoneId } from '../types'

export const progressMilestones: ProgressMilestoneDefinition[] = [
  {
    id: 'opening',
    label: '開場｜基礎柑橘',
    summary: '基礎柑橘果汁設備與檸檬、橙子可用。',
  },
  {
    id: 'seasoner-unlocked',
    label: '階段二｜調味器已解鎖',
    summary: '爺爺回信後解鎖調味器、薄荷與糖。',
  },
  {
    id: 'juice-jar-unlocked',
    label: '階段三｜果汁罐已解鎖',
    summary: '爺爺回信後解鎖果汁罐購買。',
  },
  {
    id: 'juicer-unlocked',
    label: '階段四｜榨汁機已解鎖',
    summary: '爺爺回信後解鎖榨汁機、紅蘿蔔與梨；靜謐噴泉尚未開放。',
  },
  {
    id: 'tranquil-fountain-unlocked',
    label: '階段四｜靜謐噴泉已解鎖',
    summary: '完成階段四後半主線後解鎖靜謐噴泉、該區顧客、商店與原料。',
  },
  {
    id: 'juice-blender-unlocked',
    label: '階段五｜果汁調和器已解鎖',
    summary: '靜謐噴泉解鎖後寄信並隔天收信，解鎖果汁調和器。',
  },
]

export const progressMilestoneIds = progressMilestones.map(
  (milestone) => milestone.id,
) as ProgressMilestoneId[]

export const progressMilestoneIndex = new Map(
  progressMilestones.map((milestone, index) => [milestone.id, index]),
)

export const progressMilestoneLabels = Object.fromEntries(
  progressMilestones.map((milestone) => [milestone.id, milestone.label]),
) as Record<ProgressMilestoneId, string>
