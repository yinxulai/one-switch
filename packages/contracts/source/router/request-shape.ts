import type { Protocol } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { SchemaValueType, WorkflowProtocol } from './types'

/**
 * 请求体在图上呈现的**格式**。
 *
 * 这是**协议层**的事实。入口节点不解析请求体，所以它既不知道体里有什么字段，
 * 也不知道体是什么格式（JSON 对象？字节流？）—— 要它知道，就得让它兼容所有协议。
 * 格式与字段都从这里按「这次请求实际命中的协议」发给下游。
 */
export type RequestBodyFormat = 'json' | 'binary'

/**
 * 引擎自己要读的两种请求体字段。
 *
 * 只列引擎真的用得上的角色：多一个角色就等于多一条「引擎假装知道协议内容」的口子。
 * 下游节点要什么路径，看的是 `fields` 全表，与本类型无关。
 */
export type RequestBodyFieldRole = 'model' | 'messages'

export interface RequestBodyField {
  /** 图上可直接读取的路径。**就是请求体里真实的位置**，不另存一份副本。 */
  readonly path: string
  readonly valueType: SchemaValueType
  /**
   * 这个字段在路由里扮演的角色。
   *
   * 有角色的字段是**引擎自己要读**的那几条：协议发现节点要报出这次请求的模型名，
   * 归一化视图要把模型名与消息列表摆出来。角色让引擎不必再猜路径 ——
   * 「消息在 `messages` 里还是在 `input` 里」这种协议细节只写在这张表里一处。
   *
   * 没有角色的字段是纯给下游节点用的候选路径（工具、增量开关、消息里的 `role`…）。
   */
  readonly role?: RequestBodyFieldRole
  /** 说明文案的目录 key（在 `ui.*` 里定义）。 */
  readonly noteKey?: UiCatalogKey
}

export interface ProtocolRequestShape {
  /** 请求体格式：`binary` 的协议在图上取不到字段（`fields` 就该是空）。 */
  readonly format: RequestBodyFormat
  /**
   * 路由做判断时用得到的请求体字段。
   *
   * 这不是协议的完整 schema（那是各家 SDK 的事），而是**按协议解析后**路由真正会读的那一层：
   * 模型名、消息列表、工具、增量开关。少写了就取不到，多写了就是噪音。
   * 拿不准的写法宁可**不写**：写上去等于声称有，读出来却是 `undefined`。
   */
  readonly fields: readonly RequestBodyField[]
}

/**
 * 三种协议的请求体形状。
 *
 * `unknown` 不在表里：认不出协议时**一个字段都保证不了**，这正是「不确定就别声称」。
 * 谁想加一种协议，就在词表（`@common/schemas` 的 `ProtocolSchema`）、
 * `ALL_WORKFLOW_PROTOCOLS` 之外，把这一层也补上。
 */
export const PROTOCOL_REQUEST_SHAPES: Readonly<Record<Protocol, ProtocolRequestShape>> = {
  'openai-completions': {
    format: 'json',
    fields: [
      { path: 'request.body.model', valueType: 'string', role: 'model', noteKey: 'router.fieldNote.protocolModel' },
      { path: 'request.body.messages', valueType: 'array', role: 'messages', noteKey: 'router.fieldNote.protocolMessages' },
      { path: 'request.body.messages[*].role', valueType: 'string' },
      { path: 'request.body.messages[*].content', valueType: 'string' },
      { path: 'request.body.tools', valueType: 'array', noteKey: 'router.fieldNote.protocolTools' },
      { path: 'request.body.stream', valueType: 'boolean', noteKey: 'router.fieldNote.protocolStream' },
    ],
  },
  'openai-responses': {
    format: 'json',
    fields: [
      { path: 'request.body.model', valueType: 'string', role: 'model', noteKey: 'router.fieldNote.protocolModel' },
      { path: 'request.body.instructions', valueType: 'string', noteKey: 'router.fieldNote.protocolSystem' },
      // `input` 的元素既可以是纯字符串、也可以是消息对象，所以只给整体，不给 `[*].role` 这类投影。
      { path: 'request.body.input', valueType: 'array', role: 'messages', noteKey: 'router.fieldNote.protocolMessages' },
      { path: 'request.body.tools', valueType: 'array', noteKey: 'router.fieldNote.protocolTools' },
      { path: 'request.body.stream', valueType: 'boolean', noteKey: 'router.fieldNote.protocolStream' },
    ],
  },
  'anthropic-messages': {
    format: 'json',
    fields: [
      { path: 'request.body.model', valueType: 'string', role: 'model', noteKey: 'router.fieldNote.protocolModel' },
      { path: 'request.body.system', valueType: 'string', noteKey: 'router.fieldNote.protocolSystem' },
      { path: 'request.body.messages', valueType: 'array', role: 'messages', noteKey: 'router.fieldNote.protocolMessages' },
      { path: 'request.body.messages[*].role', valueType: 'string' },
      { path: 'request.body.messages[*].content', valueType: 'string' },
      { path: 'request.body.tools', valueType: 'array', noteKey: 'router.fieldNote.protocolTools' },
      { path: 'request.body.stream', valueType: 'boolean', noteKey: 'router.fieldNote.protocolStream' },
    ],
  },
}

/**
 * 取某个工作流协议的请求体形状。
 *
 * `unknown` 没有声明，返回 `null` —— 调用方据此**不产出任何请求体字段**，
 * 而不是退回「按某一种协议猜一个」。
 */
export function requestShapeOf(protocol: WorkflowProtocol): ProtocolRequestShape | null {
  if (protocol === 'unknown') return null
  return PROTOCOL_REQUEST_SHAPES[protocol]
}

/**
 * 取某个协议下扮演某个角色的请求体字段。
 *
 * 引擎只通过这个函数读请求体里的模型名与消息列表：路径**只写在声明表里那一处**，
 * 引擎不再写「先找 `messages`，找不到再找 `input`」这种第二份副本 ——
 * 那种写法今天恰好对，换个协议就会静默跑偏。
 * 协议没有声明这个角色（`unknown`，或某种协议确实没有）时返回 `null`，
 * 调用方据此**如实给出空值**，而不是按别的协议猜一个。
 */
export function requestBodyField(protocol: WorkflowProtocol, role: RequestBodyFieldRole): RequestBodyField | null {
  const shape = requestShapeOf(protocol)
  return shape?.fields.find(field => field.role === role) ?? null
}
