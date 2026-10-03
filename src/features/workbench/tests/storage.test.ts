import { describe, expect, it } from 'vitest'
import { LocalWorkspaceRepository } from '../workspaceRepository'
import type { StorageService } from '../storageService'
import { createInitialDocument, createPlan } from '../../../shared/models'

function memoryStorage(initial: string | null = null) {
  let value = initial
  let backup: string | null = null
  const storage: StorageService = {
    read: async () => value,
    write: async (next) => { value = next },
    archive: async (next) => { backup = next },
  }
  return { storage, raw: () => value, backup: () => backup }
}

describe('local workspace repository', () => {
  it('round trips a document', async () => {
    const { storage } = memoryStorage()
    const repository = new LocalWorkspaceRepository(storage)
    const document = createInitialDocument()
    await repository.save(document)
    await expect(repository.load()).resolves.toEqual({ kind: 'ok', document })
  })

  it('reports empty when nothing is stored', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage().storage)
    await expect(repository.load()).resolves.toEqual({ kind: 'empty' })
  })

  it('repairs a dangling activePlanId and persists the repair so later saves cannot bring the broken record back', async () => {
    const plan = createPlan('方案 A', false)
    const broken = JSON.stringify({ version: 1, plans: [plan], activePlanId: 'plan-gone' })
    const { storage, raw, backup } = memoryStorage(broken)
    const repository = new LocalWorkspaceRepository(storage)

    const result = await repository.load()
    expect(result.kind).toBe('repaired')
    if (result.kind !== 'repaired') return
    expect(result.document.activePlanId).toBe(plan.id)

    // 修复结果已经写回存储，再次加载直接可用；原始记录留在备份里
    expect(raw()).toBe(JSON.stringify(result.document))
    await expect(repository.load()).resolves.toEqual({ kind: 'ok', document: result.document })
    expect(backup()).toBe(broken)
  })

  it('keeps the original record untouched and archived when it cannot be repaired', async () => {
    const broken = '{broken'
    const { storage, raw, backup } = memoryStorage(broken)
    const repository = new LocalWorkspaceRepository(storage)

    const result = await repository.load()
    expect(result.kind).toBe('unrecoverable')
    expect(raw()).toBe(broken)
    expect(backup()).toBe(broken)
  })
})
