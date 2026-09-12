import type { Protocol } from '@common/schemas'
import type { ProtocolEndpointSpec } from '@server/proxy/contracts'
import type { ProtocolAdapter } from './shared/types'

/**
 * 协议描述符：一个协议对外声明的全部内容。
 *
 * 新增协议 = 新增一个 descriptor 文件 + 在 protocols/registry.ts 的描述符列表里登记一行，
 * 不需要再改动路径检测、模型读取、流式判定或任何调用方。
 *
 * 新增接口 = 在该协议下追加一个 `ProtocolEndpointSpec`，同样不改动调用方。
 *
 * 认证规则与转换能力不在这里重复声明：它们需要与渲染进程共用，声明在 @common/protocols。
 */
export interface ProtocolDescriptor {
  readonly id: Protocol
  /** 该协议对外暴露的全部接口。路径检测、模型读写、流式判定都从这里派生。 */
  readonly endpoints: readonly ProtocolEndpointSpec[]
  /** 构造该协议的全部适配器实例；注册表在构建时调用一次。 */
  createAdapters(): readonly ProtocolAdapter[]
}
