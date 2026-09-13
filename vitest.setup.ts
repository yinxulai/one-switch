import { afterEach } from 'vitest'

// Vitest 未开启 `globals`，Testing Library 依赖全局 `afterEach` 注册的自动 cleanup
// 不会生效，导致上一个用例渲染的 DOM 残留并污染后续用例（例如「空状态」文本）。
// 这里显式清理，仅在 jsdom 环境下执行，node 环境直接跳过。
afterEach(async () => {
  if (typeof document === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
