import { describe, expect, it } from 'vitest'
import { ensureConsistentDocument, recoverWorkspace } from '../workspaceRecovery'
import { createInitialDocument, createPlan, type WorkspaceDocument } from '../../../shared/models'

function rawOf(value: unknown): string {
  return JSON.stringify(value)
}

describe('recoverWorkspace', () => {
  it('creates the demo document for a first run without any stored record', () => {
    const recovery = recoverWorkspace(null)
    expect(recovery.outcome).toBe('empty')
    expect(recovery.shouldPersist).toBe(false)
    expect(recovery.notices).toEqual([])
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.document.plans[0].items.length).toBeGreaterThan(0)
  })

  it('returns a consistent record untouched', () => {
    const document = createInitialDocument()
    const recovery = recoverWorkspace(rawOf(document))
    expect(recovery.outcome).toBe('clean')
    expect(recovery.shouldPersist).toBe(false)
    expect(recovery.notices).toEqual([])
    expect(recovery.document).toEqual(document)
  })

  it('repoints a dangling activePlanId to the first available plan', () => {
    const first = createPlan('方案 A', false)
    const second = createPlan('方案 B', false)
    const stored: WorkspaceDocument = { version: 1, plans: [first, second], activePlanId: 'plan-no-longer-exists' }
    const recovery = recoverWorkspace(rawOf(stored))
    expect(recovery.outcome).toBe('repaired')
    expect(recovery.shouldPersist).toBe(true)
    expect(recovery.document.activePlanId).toBe(first.id)
    expect(recovery.document.plans).toEqual([first, second])
    expect(recovery.notices.join('')).toContain('已切换到第一个可用方案')
  })

  it('rebuilds a blank plan when the stored plan list is empty', () => {
    const recovery = recoverWorkspace(rawOf({ version: 1, plans: [], activePlanId: 'plan-gone' }))
    expect(recovery.outcome).toBe('rebuilt')
    expect(recovery.shouldPersist).toBe(true)
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.document.plans[0].items).toEqual([])
    expect(recovery.document.activePlanId).toBe(recovery.document.plans[0].id)
    expect(recovery.notices.join('')).toContain('方案列表为空')
  })

  it('rebuilds a blank plan when every stored plan is damaged', () => {
    const recovery = recoverWorkspace(rawOf({ version: 1, plans: [null, 42, 'junk'], activePlanId: 'plan-gone' }))
    expect(recovery.outcome).toBe('rebuilt')
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.notices.join('')).toContain('全部损坏')
  })

  it('keeps usable plans and reports the damaged ones', () => {
    const keeper = createPlan('保留方案', false)
    const recovery = recoverWorkspace(rawOf({ version: 1, plans: [keeper, null], activePlanId: keeper.id }))
    expect(recovery.outcome).toBe('repaired')
    expect(recovery.document.plans).toEqual([keeper])
    expect(recovery.document.activePlanId).toBe(keeper.id)
    expect(recovery.notices.join('')).toContain('1 个方案已损坏')
  })

  it('rebuilds a blank plan when the record cannot be parsed', () => {
    const recovery = recoverWorkspace('{broken')
    expect(recovery.outcome).toBe('unreadable')
    expect(recovery.shouldPersist).toBe(true)
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.document.plans[0].items).toEqual([])
    expect(recovery.notices.join('')).toContain('无法解析')
  })

  it('rebuilds a blank plan when the record has no plan list at all', () => {
    const recovery = recoverWorkspace(rawOf({ version: 1, activePlanId: 'plan-x' }))
    expect(recovery.outcome).toBe('unreadable')
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.notices.join('')).toContain('缺少方案列表')
  })
})

describe('ensureConsistentDocument', () => {
  it('passes a consistent document through unchanged', () => {
    const document = createInitialDocument()
    expect(ensureConsistentDocument(document)).toBe(document)
  })

  it('repoints a dangling activePlanId instead of persisting it', () => {
    const plan = createPlan('方案 A', false)
    const fixed = ensureConsistentDocument({ version: 1, plans: [plan], activePlanId: 'plan-stale' })
    expect(fixed.activePlanId).toBe(plan.id)
    expect(fixed.plans).toEqual([plan])
  })

  it('rebuilds a blank plan when asked to save an empty plan list', () => {
    const fixed = ensureConsistentDocument({ version: 1, plans: [], activePlanId: 'plan-stale' })
    expect(fixed.plans).toHaveLength(1)
    expect(fixed.activePlanId).toBe(fixed.plans[0].id)
  })
})
