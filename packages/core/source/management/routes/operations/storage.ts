import type { IncomingMessage, ServerResponse } from 'node:http'
import { readDataStorageBytes } from '@server/database'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { HttpRouter } from '@server/http-router'

/**
 * 存储占用。只读、幂等、不需要 body。
 *
 * 它跟设置页放一起而不是并进 `/api/settings/get`：设置是用户写进去的东西（可以对比、
 * 可以回滚），而占用是随每次请求变化的运行时读数，混进设置响应会让「保存设置」这个
 * 动作看起来像是在写一个每秒都在变的字段。
 */
export const storageRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/storage/usage', handleStorageUsage)

function handleStorageUsage(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { dataBytes: readDataStorageBytes() })
}
