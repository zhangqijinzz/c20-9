import type { WorkspaceDocument } from '../../shared/models'
import { restoreWorkspaceDocument, type DocumentLoadResult } from './documentRestore'
import { BrowserStorageService, type StorageService } from './storageService'

export interface WorkspaceRepository {
  load(): Promise<DocumentLoadResult>
  save(document: WorkspaceDocument): Promise<void>
}

export class LocalWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly storage: StorageService = new BrowserStorageService()) {}

  async load(): Promise<DocumentLoadResult> {
    let raw: string | null
    try {
      raw = await this.storage.read()
    } catch {
      return { kind: 'unrecoverable', reason: '浏览器本地存储读取失败，无法打开工作台记录。' }
    }
    const result = restoreWorkspaceDocument(raw)
    if (result.kind === 'repaired') {
      // 先归档原始记录，再立刻把修复结果写回，避免坏记录留在存储里、之后的保存又把它写回去
      await this.archive(raw)
      try {
        await this.save(result.document)
      } catch {
        // 修复结果仍保留在内存中，下一次编辑会再次尝试保存
      }
    } else if (result.kind === 'unrecoverable' && raw !== null) {
      // 原始记录转存到备份键，界面只展示说明，不会用示例数据覆盖它
      await this.archive(raw)
    }
    return result
  }

  async save(document: WorkspaceDocument): Promise<void> {
    await this.storage.write(JSON.stringify(document))
  }

  private async archive(raw: string | null): Promise<void> {
    if (!raw || !this.storage.archive) return
    try {
      await this.storage.archive(raw)
    } catch {
      // 归档只是兜底，失败不阻塞主流程
    }
  }
}
