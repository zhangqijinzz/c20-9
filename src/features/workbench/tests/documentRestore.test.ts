import { describe, expect, it } from 'vitest'
import { createInitialDocument, createPlan, type WorkspacePlan } from '../../../shared/models'
import { restoreWorkspaceDocument } from '../documentRestore'

function serialize(document: unknown): string {
  return JSON.stringify(document)
}

describe('restoreWorkspaceDocument', () => {
  it('reports empty when nothing is stored', () => {
    expect(restoreWorkspaceDocument(null)).toEqual({ kind: 'empty' })
  })

  it('accepts a consistent document unchanged', () => {
    const document = createInitialDocument()
    expect(restoreWorkspaceDocument(serialize(document))).toEqual({ kind: 'ok', document })
  })

  it('points a dangling activePlanId back to the first available plan', () => {
    const first = createPlan('方案 A', false)
    const second = createPlan('方案 B', false)
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [first, second], activePlanId: 'plan-gone' }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.activePlanId).toBe(first.id)
    expect(result.document.plans).toEqual([first, second])
    expect(result.repairs.join()).toContain('已切换到「方案 A」')
  })

  it('rebuilds a blank plan when the plan list is empty', () => {
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [], activePlanId: 'plan-gone' }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.plans).toHaveLength(1)
    expect(result.document.plans[0].items).toHaveLength(0)
    expect(result.document.activePlanId).toBe(result.document.plans[0].id)
    expect(result.repairs.join()).toContain('方案列表为空')
  })

  it('repairs a missing activePlanId the same way as a dangling one', () => {
    const plan = createPlan('方案 A', false)
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [plan] }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.activePlanId).toBe(plan.id)
  })

  it('drops unreadable plans and keeps the readable ones', () => {
    const readable = createPlan('方案 A', false)
    const broken = { id: 42, name: null }
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [broken, readable], activePlanId: 'plan-gone' }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.plans).toEqual([readable])
    expect(result.document.activePlanId).toBe(readable.id)
    expect(result.repairs.join()).toContain('忽略了 1 条无法读取的方案记录')
  })

  it('rebuilds a blank plan when every stored plan is unreadable', () => {
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [{ id: 42 }], activePlanId: 'plan-gone' }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.plans).toHaveLength(1)
    expect(result.repairs.join()).toContain('没有可读取的方案')
  })

  it('drops unreadable items but keeps the plan they belong to', () => {
    const plan: WorkspacePlan = { ...createPlan('方案 A', false), items: [{ id: 'item-1' } as never] }
    const result = restoreWorkspaceDocument(serialize({ version: 1, plans: [plan], activePlanId: plan.id }))
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.plans[0].items).toHaveLength(0)
    expect(result.repairs.join()).toContain('忽略了 1 个无法读取的设备')
  })

  it('reports unrecoverable for damaged JSON', () => {
    const result = restoreWorkspaceDocument('{broken')
    expect(result.kind).toBe('unrecoverable')
    if (result.kind !== 'unrecoverable') return
    expect(result.reason).toContain('损坏')
  })

  it('reports unrecoverable for an incompatible version', () => {
    const result = restoreWorkspaceDocument(serialize({ version: 2, plans: [], activePlanId: 'x' }))
    expect(result.kind).toBe('unrecoverable')
    if (result.kind !== 'unrecoverable') return
    expect(result.reason).toContain('不兼容的版本')
  })

  it('reports unrecoverable when the plan list is missing', () => {
    const result = restoreWorkspaceDocument(serialize({ version: 1, activePlanId: 'x' }))
    expect(result.kind).toBe('unrecoverable')
    if (result.kind !== 'unrecoverable') return
    expect(result.reason).toContain('缺少方案列表')
  })
})
