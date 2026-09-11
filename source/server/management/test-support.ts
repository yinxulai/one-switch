import type { ServerResponse } from 'node:http'
import { vi } from 'vitest'

/**
 * 构造管理路由单测使用的 `ServerResponse` 替身。
 *
 * 之前 13 个测试文件各自复制了一份实现，字段组合略有出入，导致
 * 某些路由在读取 `headersSent` / `writableEnded` 时拿到的是 `undefined`。
 * 这里统一提供可写状态字段的超集，并用 overrides 覆盖个别场景。
 */
export function mockResponse(overrides: Partial<ServerResponse> = {}): ServerResponse {
  return {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    destroy: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
    ...overrides,
  } as unknown as ServerResponse
}
