import { createBlankDocument, createInitialDocument, type WorkspaceDocument } from '../../shared/models'
import { BrowserStorageService, type StorageService } from './storageService'
import { ensureConsistentDocument, recoverWorkspace, type WorkspaceRecovery } from './workspaceRecovery'

export interface WorkspaceRepository {
  load(): Promise<WorkspaceDocument | null>
  loadWithRecovery(): Promise<WorkspaceRecovery>
  save(document: WorkspaceDocument): Promise<void>
}

export class LocalWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly storage: StorageService = new BrowserStorageService()) {}

  async load(): Promise<WorkspaceDocument | null> {
    const recovery = await this.loadWithRecovery()
    return recovery.outcome === 'clean' || recovery.outcome === 'repaired' || recovery.outcome === 'rebuilt'
      ? recovery.document
      : null
  }

  async loadWithRecovery(): Promise<WorkspaceRecovery> {
    let raw: string | null
    try {
      raw = await this.storage.read()
    } catch {
      // 读不出来的记录不能动：不做任何写回，避免把可能完好的数据覆盖掉
      return {
        document: createBlankDocument(),
        outcome: 'error',
        notices: ['本地数据读取失败，请检查浏览器存储权限；当前使用临时工作台，更改可能无法保存'],
        shouldPersist: false,
      }
    }

    const recovery = recoverWorkspace(raw)
    if (!recovery.shouldPersist) return recovery

    const notices = [...recovery.notices]
    if (raw !== null && (recovery.outcome === 'rebuilt' || recovery.outcome === 'unreadable') && this.storage.writeBackup) {
      try {
        await this.storage.writeBackup(raw)
        notices.push('损坏前的原始记录已另存为本地备份，可供排查恢复')
      } catch {
        // 备份失败不阻塞修复
      }
    }

    try {
      // 把修复/重建结果写回，避免下次打开再次撞到同一条坏记录
      await this.storage.write(JSON.stringify(recovery.document))
    } catch {
      // 写回失败时修复结果仍保留在内存中，之后的保存会再次写入自洽的文档
    }
    return { ...recovery, notices }
  }

  async save(document: WorkspaceDocument): Promise<void> {
    await this.storage.write(JSON.stringify(ensureConsistentDocument(document)))
  }
}

export function getInitialDocument(document: WorkspaceDocument | null): WorkspaceDocument {
  return document ?? createInitialDocument()
}
