import { describe, expect, it } from 'vitest'
import { LocalWorkspaceRepository } from '../workspaceRepository'
import type { StorageService } from '../storageService'
import { createInitialDocument, createPlan, type WorkspaceDocument } from '../../../shared/models'

function memoryStorage(initial: string | null = null): StorageService {
  let value = initial
  return { read: async () => value, write: async (next) => { value = next } }
}

function trackedStorage(initial: string | null = null) {
  let value = initial
  let backup: string | null = null
  const storage: StorageService = {
    read: async () => value,
    write: async (next) => { value = next },
    writeBackup: async (raw) => { backup = raw },
  }
  return { storage, readValue: () => value, readBackup: () => backup }
}

describe('local workspace repository', () => {
  it('round trips a document', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage())
    const document = createInitialDocument()
    await repository.save(document)
    await expect(repository.load()).resolves.toEqual(document)
  })

  it('falls back when stored JSON is damaged', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage('{broken'))
    await expect(repository.load()).resolves.toBeNull()
  })
})

describe('workspace recovery on load', () => {
  it('repoints a dangling activePlanId and persists the repair', async () => {
    const first = createPlan('方案 A', false)
    const second = createPlan('方案 B', false)
    const broken: WorkspaceDocument = { version: 1, plans: [first, second], activePlanId: 'plan-deleted' }
    const { storage, readValue } = trackedStorage(JSON.stringify(broken))
    const repository = new LocalWorkspaceRepository(storage)

    const recovery = await repository.loadWithRecovery()
    expect(recovery.outcome).toBe('repaired')
    expect(recovery.document.activePlanId).toBe(first.id)
    expect(recovery.document.plans).toEqual([first, second])
    expect(recovery.notices.length).toBeGreaterThan(0)

    const persisted = JSON.parse(readValue() ?? '{}') as WorkspaceDocument
    expect(persisted.activePlanId).toBe(first.id)
    await expect(repository.load()).resolves.toEqual(recovery.document)
  })

  it('rebuilds a blank plan when the stored plan list is empty and persists it', async () => {
    const { storage, readValue } = trackedStorage(JSON.stringify({ version: 1, plans: [], activePlanId: 'plan-gone' }))
    const repository = new LocalWorkspaceRepository(storage)

    const recovery = await repository.loadWithRecovery()
    expect(recovery.outcome).toBe('rebuilt')
    expect(recovery.document.plans).toHaveLength(1)
    expect(recovery.document.plans[0].items).toEqual([])
    expect(recovery.document.activePlanId).toBe(recovery.document.plans[0].id)

    const persisted = JSON.parse(readValue() ?? '{}') as WorkspaceDocument
    expect(persisted.plans).toHaveLength(1)
    expect(persisted.activePlanId).toBe(persisted.plans[0].id)
  })

  it('backs up the raw record before overwriting an unrecoverable one', async () => {
    const raw = '{broken'
    const { storage, readValue, readBackup } = trackedStorage(raw)
    const repository = new LocalWorkspaceRepository(storage)

    const recovery = await repository.loadWithRecovery()
    expect(recovery.outcome).toBe('unreadable')
    expect(readBackup()).toBe(raw)
    expect(recovery.notices.join('')).toContain('备份')
    expect(JSON.parse(readValue() ?? '{}')).toEqual(recovery.document)
  })

  it('does not touch the storage when the record cannot be read', async () => {
    let writes = 0
    const failing: StorageService = {
      read: async () => { throw new Error('denied') },
      write: async () => { writes += 1 },
    }
    const repository = new LocalWorkspaceRepository(failing)

    const recovery = await repository.loadWithRecovery()
    expect(recovery.outcome).toBe('error')
    expect(recovery.shouldPersist).toBe(false)
    expect(recovery.notices.length).toBeGreaterThan(0)
    expect(writes).toBe(0)
  })
})

describe('save consistency guard', () => {
  it('never persists a dangling activePlanId, so a later save cannot overwrite the repair', async () => {
    const plan = createPlan('方案 A', false)
    const { storage, readValue } = trackedStorage(JSON.stringify({ version: 1, plans: [plan], activePlanId: 'plan-stale' }))
    const repository = new LocalWorkspaceRepository(storage)

    await repository.loadWithRecovery()
    await repository.save({ version: 1, plans: [plan], activePlanId: 'plan-stale' })

    const persisted = JSON.parse(readValue() ?? '{}') as WorkspaceDocument
    expect(persisted.activePlanId).toBe(plan.id)
  })

  it('never persists an empty plan list', async () => {
    const { storage, readValue } = trackedStorage()
    const repository = new LocalWorkspaceRepository(storage)

    await repository.save({ version: 1, plans: [], activePlanId: 'plan-stale' })

    const persisted = JSON.parse(readValue() ?? '{}') as WorkspaceDocument
    expect(persisted.plans).toHaveLength(1)
    expect(persisted.activePlanId).toBe(persisted.plans[0].id)
  })
})
