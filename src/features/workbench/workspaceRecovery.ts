import {
  createBlankDocument,
  createId,
  createInitialDocument,
  DEVICE_DEFINITIONS,
  DEFAULT_DESK,
  getDeviceDefinition,
  type DeskItem,
  type DeviceType,
  type WorkspaceDocument,
  type WorkspacePlan,
} from '../../shared/models'
import { clampDeskSize, clampItemDimension } from '../../shared/layoutRules'

export type RecoveryOutcome =
  | 'empty' // 没有任何本地记录（新用户）
  | 'clean' // 记录完整自洽，直接使用
  | 'repaired' // 记录不自洽但可修复（当前方案悬空、部分数据损坏被剔除）
  | 'rebuilt' // 记录存在但没有任何可用方案，已重建空白方案
  | 'unreadable' // 记录无法解析或结构不符，已重建空白方案
  | 'error' // 存储读取失败，未对记录做任何改动

export interface WorkspaceRecovery {
  document: WorkspaceDocument
  outcome: RecoveryOutcome
  notices: string[]
  /** 为 true 时表示修复/重建结果需要写回存储，覆盖原来的坏记录 */
  shouldPersist: boolean
}

const DEVICE_TYPES = new Set<string>(DEVICE_DEFINITIONS.map((device) => device.type))

/**
 * 识别并修复不自洽的本地记录：当前方案指向不存在的方案、方案列表为空、
 * 部分方案/设备损坏等。能修的修（指回第一个可用方案、剔除损坏数据），
 * 修不了的重建一个空白方案，并通过 notices 说明发生了什么、原内容还剩什么。
 */
export function recoverWorkspace(raw: string | null): WorkspaceRecovery {
  if (raw === null) {
    return { document: createInitialDocument(), outcome: 'empty', notices: [], shouldPersist: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      document: createBlankDocument(),
      outcome: 'unreadable',
      notices: ['本地记录已损坏、无法解析，原有内容无法从记录中恢复，已重建一个空白方案'],
      shouldPersist: true,
    }
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Partial<WorkspaceDocument>).plans)) {
    return {
      document: createBlankDocument(),
      outcome: 'unreadable',
      notices: ['本地记录格式不完整（缺少方案列表），原有内容无法从记录中恢复，已重建一个空白方案'],
      shouldPersist: true,
    }
  }

  const stored = parsed as Partial<WorkspaceDocument> & { plans: unknown[] }
  const notices: string[] = []
  const plans: WorkspacePlan[] = []
  let droppedPlans = 0
  let droppedItems = 0
  let changed = stored.version !== 1

  stored.plans.forEach((value) => {
    const result = sanitizePlan(value)
    if (!result) {
      droppedPlans += 1
      return
    }
    plans.push(result.plan)
    changed = changed || result.changed
    droppedItems += result.droppedItems
  })

  if (droppedPlans > 0 || droppedItems > 0) changed = true

  if (plans.length === 0) {
    return {
      document: createBlankDocument(),
      outcome: 'rebuilt',
      notices: [
        droppedPlans > 0
          ? `本地记录中的 ${droppedPlans} 个方案已全部损坏，没有可恢复的内容，已重建一个空白方案`
          : '本地记录中的方案列表为空，没有可恢复的方案，已重建一个空白方案',
      ],
      shouldPersist: true,
    }
  }

  if (droppedPlans > 0) notices.push(`${droppedPlans} 个方案已损坏未能恢复，其余 ${plans.length} 个方案已保留`)
  if (droppedItems > 0) notices.push(`${droppedItems} 件设备数据已损坏，未能恢复`)

  const activePlanId = typeof stored.activePlanId === 'string' ? stored.activePlanId : ''
  if (plans.some((plan) => plan.id === activePlanId)) {
    if (!changed) return { document: parsed as WorkspaceDocument, outcome: 'clean', notices: [], shouldPersist: false }
    return { document: { version: 1, plans, activePlanId }, outcome: 'repaired', notices, shouldPersist: true }
  }

  notices.unshift(`记录中的当前方案已不存在，已切换到第一个可用方案「${plans[0].name}」`)
  return { document: { version: 1, plans, activePlanId: plans[0].id }, outcome: 'repaired', notices, shouldPersist: true }
}

/**
 * 保存前的自洽性兜底：保证写出的文档一定有可用方案、且当前方案指向存在的方案。
 * 这样修复结果不会被随后任何一次保存重新覆盖成不自洽的记录。
 */
export function ensureConsistentDocument(document: WorkspaceDocument): WorkspaceDocument {
  const plans = Array.isArray(document.plans)
    ? document.plans.filter((plan) => plan && typeof plan.id === 'string' && plan.id.length > 0)
    : []
  if (plans.length === 0) return createBlankDocument()
  const activePlanId = plans.some((plan) => plan.id === document.activePlanId) ? document.activePlanId : plans[0].id
  if (activePlanId === document.activePlanId && plans.length === document.plans.length) return document
  return { ...document, plans, activePlanId }
}

interface PlanSanitizeResult {
  plan: WorkspacePlan
  changed: boolean
  droppedItems: number
}

function sanitizePlan(value: unknown): PlanSanitizeResult | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkspacePlan>
  let changed = false

  const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('plan')
  if (id !== candidate.id) changed = true
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : '未命名方案'
  if (name !== candidate.name) changed = true
  const deskWidthMm = clampDeskSize(candidate.deskWidthMm as number, DEFAULT_DESK.widthMm)
  if (deskWidthMm !== candidate.deskWidthMm) changed = true
  const deskHeightMm = clampDeskSize(candidate.deskHeightMm as number, DEFAULT_DESK.heightMm)
  if (deskHeightMm !== candidate.deskHeightMm) changed = true

  if (!Array.isArray(candidate.items)) changed = true
  const items: DeskItem[] = []
  let droppedItems = 0
  ;(Array.isArray(candidate.items) ? candidate.items : []).forEach((itemValue) => {
    const result = sanitizeItem(itemValue)
    if (!result) {
      droppedItems += 1
      return
    }
    items.push(result.item)
    changed = changed || result.changed
  })

  const updatedAt = typeof candidate.updatedAt === 'string' && candidate.updatedAt ? candidate.updatedAt : new Date(0).toISOString()
  if (updatedAt !== candidate.updatedAt) changed = true

  return { plan: { id, name, deskWidthMm, deskHeightMm, items, updatedAt }, changed, droppedItems }
}

function sanitizeItem(value: unknown): { item: DeskItem; changed: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DeskItem>
  if (typeof candidate.type !== 'string' || !DEVICE_TYPES.has(candidate.type)) return null
  const type = candidate.type as DeviceType
  const definition = getDeviceDefinition(type)
  let changed = false

  const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('item')
  if (id !== candidate.id) changed = true
  const widthMm = clampItemDimension(candidate.widthMm as number, definition.widthMm)
  if (widthMm !== candidate.widthMm) changed = true
  const heightMm = clampItemDimension(candidate.heightMm as number, definition.heightMm)
  if (heightMm !== candidate.heightMm) changed = true
  const x = typeof candidate.x === 'number' && Number.isFinite(candidate.x) ? candidate.x : 0
  if (x !== candidate.x) changed = true
  const y = typeof candidate.y === 'number' && Number.isFinite(candidate.y) ? candidate.y : 0
  if (y !== candidate.y) changed = true
  const rotation = typeof candidate.rotation === 'number' && Number.isFinite(candidate.rotation) ? candidate.rotation : 0
  if (rotation !== candidate.rotation) changed = true

  return { item: { id, type, widthMm, heightMm, x, y, rotation }, changed }
}
