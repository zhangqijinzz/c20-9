// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspaceViewModel, type WorkspaceViewModel } from '../workbenchViewModel'
import { LocalWorkspaceRepository, type WorkspaceRepository } from '../workspaceRepository'
import type { StorageService } from '../storageService'
import { createPlan, type WorkspaceDocument } from '../../../shared/models'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function memoryStorage(initial: string | null = null): StorageService {
  let value = initial
  return { read: async () => value, write: async (next) => { value = next } }
}

function renderViewModel(repository: WorkspaceRepository) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: WorkspaceViewModel | null = null
  function Probe() {
    latest = useWorkspaceViewModel(repository)
    return null
  }
  act(() => { root.render(<Probe />) })
  return {
    current: () => {
      if (!latest) throw new Error('view model not rendered')
      return latest
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

async function flushLoad() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function mountWith(raw: string | null) {
  const repository = new LocalWorkspaceRepository(memoryStorage(raw))
  const mounted = renderViewModel(repository)
  cleanups.push(mounted.unmount)
  return mounted
}

describe('workspace view model startup recovery', () => {
  it('opens the first available plan instead of staying on the loading screen when activePlanId dangles', async () => {
    const first = createPlan('方案 A', false)
    const second = createPlan('方案 B', false)
    const broken: WorkspaceDocument = { version: 1, plans: [first, second], activePlanId: 'plan-deleted' }
    const mounted = mountWith(JSON.stringify(broken))

    expect(mounted.current().status).toBe('loading')
    await flushLoad()

    const viewModel = mounted.current()
    expect(viewModel.status).toBe('ready')
    expect(viewModel.activePlan?.id).toBe(first.id)
    expect(viewModel.document?.plans).toHaveLength(2)
    expect(viewModel.recoveryNotices.join('')).toContain('已切换到第一个可用方案')
  })

  it('rebuilds a blank plan instead of staying on the loading screen when the plan list is empty', async () => {
    const mounted = mountWith(JSON.stringify({ version: 1, plans: [], activePlanId: 'plan-gone' }))
    await flushLoad()

    const viewModel = mounted.current()
    expect(viewModel.status).toBe('ready')
    expect(viewModel.activePlan).not.toBeNull()
    expect(viewModel.activePlan?.items).toEqual([])
    expect(viewModel.document?.activePlanId).toBe(viewModel.activePlan?.id)
    expect(viewModel.recoveryNotices.join('')).toContain('方案列表为空')
  })

  it('shows a blank workspace with an explanation instead of a spinner when the record is unreadable', async () => {
    const mounted = mountWith('{broken')
    await flushLoad()

    const viewModel = mounted.current()
    expect(viewModel.status).toBe('ready')
    expect(viewModel.activePlan).not.toBeNull()
    expect(viewModel.recoveryNotices.join('')).toContain('无法解析')
  })

  it('keeps the first-run demo experience when no record exists', async () => {
    const mounted = mountWith(null)
    await flushLoad()

    const viewModel = mounted.current()
    expect(viewModel.status).toBe('ready')
    expect(viewModel.activePlan?.items.length).toBeGreaterThan(0)
    expect(viewModel.recoveryNotices).toEqual([])
  })

  it('keeps a repaired document consistent when a later save carries a stale activePlanId', async () => {
    const plan = createPlan('方案 A', false)
    const storage = memoryStorage(JSON.stringify({ version: 1, plans: [plan], activePlanId: 'plan-stale' }))
    const repository = new LocalWorkspaceRepository(storage)
    const mounted = renderViewModel(repository)
    cleanups.push(mounted.unmount)
    await flushLoad()

    expect(mounted.current().activePlan?.id).toBe(plan.id)
    await act(async () => { await repository.save({ version: 1, plans: [plan], activePlanId: 'plan-stale' }) })

    const persisted = JSON.parse(await storage.read() ?? '{}') as WorkspaceDocument
    expect(persisted.activePlanId).toBe(plan.id)
  })
})
