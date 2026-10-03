import {
  createBlankDocument,
  DEVICE_DEFINITIONS,
  type DeskItem,
  type WorkspaceDocument,
  type WorkspacePlan,
} from '../../shared/models'

export type DocumentLoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; document: WorkspaceDocument }
  | { kind: 'repaired'; document: WorkspaceDocument; repairs: string[] }
  | { kind: 'unrecoverable'; reason: string }

const KNOWN_DEVICE_TYPES = new Set<string>(DEVICE_DEFINITIONS.map((definition) => definition.type))

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRestorableItem(value: unknown): value is DeskItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DeskItem>
  return (
    typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.type === 'string' && KNOWN_DEVICE_TYPES.has(item.type) &&
    isFiniteNumber(item.widthMm) && isFiniteNumber(item.heightMm) &&
    isFiniteNumber(item.x) && isFiniteNumber(item.y) && isFiniteNumber(item.rotation)
  )
}

function restorePlan(value: unknown): { plan: WorkspacePlan; droppedItems: number } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkspacePlan>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null
  if (typeof candidate.name !== 'string') return null
  if (!isFiniteNumber(candidate.deskWidthMm) || !isFiniteNumber(candidate.deskHeightMm)) return null
  if (!Array.isArray(candidate.items)) return null
  if (typeof candidate.updatedAt !== 'string') return null
  const items = candidate.items.filter(isRestorableItem)
  return {
    plan: {
      id: candidate.id,
      name: candidate.name,
      deskWidthMm: candidate.deskWidthMm,
      deskHeightMm: candidate.deskHeightMm,
      items,
      updatedAt: candidate.updatedAt,
    },
    droppedItems: candidate.items.length - items.length,
  }
}

/**
 * 打开应用时校验本地记录，能修的修，修不了的说明原因。
 * 可修复：当前方案悬空（指回第一个可用方案）、方案列表为空（重建空白方案）、个别方案/设备损坏（跳过）。
 * 不可修复：记录无法解析、版本不兼容、缺少方案列表。
 */
export function restoreWorkspaceDocument(raw: string | null): DocumentLoadResult {
  if (raw === null) return { kind: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unrecoverable', reason: '本地记录已损坏，保存的内容不是可解析的数据。' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unrecoverable', reason: '本地记录不是有效的工作台文档。' }
  }

  const candidate = parsed as Partial<WorkspaceDocument>
  if (candidate.version !== 1) {
    return { kind: 'unrecoverable', reason: '本地记录来自不兼容的版本，当前应用无法读取。' }
  }
  if (!Array.isArray(candidate.plans)) {
    return { kind: 'unrecoverable', reason: '本地记录中缺少方案列表，无法自动修复。' }
  }

  const repairs: string[] = []
  const plans: WorkspacePlan[] = []
  let droppedPlans = 0
  let droppedItems = 0
  for (const rawPlan of candidate.plans) {
    const restored = restorePlan(rawPlan)
    if (!restored) {
      droppedPlans += 1
      continue
    }
    droppedItems += restored.droppedItems
    plans.push(restored.plan)
  }
  if (droppedPlans > 0) repairs.push(`忽略了 ${droppedPlans} 条无法读取的方案记录`)
  if (droppedItems > 0) repairs.push(`忽略了 ${droppedItems} 个无法读取的设备`)

  if (plans.length === 0) {
    const blank = createBlankDocument()
    repairs.push(droppedPlans > 0 ? '没有可读取的方案，已重建一个空白方案' : '方案列表为空，已重建一个空白方案')
    return { kind: 'repaired', document: blank, repairs }
  }

  const activePlanId = typeof candidate.activePlanId === 'string' ? candidate.activePlanId : null
  if (!activePlanId || !plans.some((plan) => plan.id === activePlanId)) {
    const fallback = plans[0]
    repairs.push(`当前方案指向已不存在的方案，已切换到「${fallback.name}」`)
    return { kind: 'repaired', document: { version: 1, plans, activePlanId: fallback.id }, repairs }
  }

  const document: WorkspaceDocument = { version: 1, plans, activePlanId }
  return repairs.length > 0 ? { kind: 'repaired', document, repairs } : { kind: 'ok', document }
}
