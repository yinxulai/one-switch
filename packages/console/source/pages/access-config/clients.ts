/**
 * 接入配置页的客户端档案：一类客户端 = 一条 Base URL + 一组完整接口地址。
 *
 * 这里只放「路径怎么拼」的事实，不放文案；接口名（Chat Completions 等）是 OpenAI / Anthropic
 * 的专有名词，按仓库惯例直接硬编码，进不了文案表。
 *
 * 路径事实的出处是 `product/proxy.md` §协议识别：代理同时接受带 `/v1` 与不带 `/v1` 的路径，
 * 所以两类客户端的差别只在于「谁负责补 `/v1`」：
 * - OpenAI 兼容客户端把 `/v1` 当成 Base URL 的一部分（自己只拼 `/chat/completions`），所以 Base URL 必须带 `/v1`；
 * - Anthropic 客户端自己就拼 `/v1/messages`，Base URL 到端口为止；带上 `/v1` 会拼成
 *   `/v1/v1/messages`，代理认不出这条路径，客户端只能拿到 404。
 *
 * 曾经把 `/v1/messages` 当成 Anthropic 的「接入地址」列出来，正是上面这个 404 的来源。
 */
export type AccessClientId = 'openai' | 'anthropic'

export interface AccessEndpoint {
  /** 复制回执用的 key，与 Base URL 的 key 区分开。 */
  key: string
  /** 接口专有名词，只用于展示。 */
  name: string
  /** 服务根地址之后的完整路径。 */
  path: string
}

export interface AccessClientProfile {
  id: AccessClientId
  /** Base URL 在服务根地址之后要追加的路径；Anthropic 客户端不需要追加。 */
  basePath: string
  /**
   * 该客户端可能会用到的完整接口地址。
   * `/v1/models` 是代理的本地接口（模型列表 / 测试连接），不是转发给上游的路径。
   */
  endpoints: AccessEndpoint[]
}

export const ACCESS_CLIENT_PROFILES: Record<AccessClientId, AccessClientProfile> = {
  openai: {
    id: 'openai',
    basePath: '/v1',
    endpoints: [
      { key: 'openai-chat-completions', name: 'Chat Completions', path: '/v1/chat/completions' },
      { key: 'openai-responses', name: 'Responses', path: '/v1/responses' },
      { key: 'openai-models', name: 'Models', path: '/v1/models' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    basePath: '',
    endpoints: [
      { key: 'anthropic-messages', name: 'Messages', path: '/v1/messages' },
      { key: 'anthropic-models', name: 'Models', path: '/v1/models' },
    ],
  },
}

/** 只用于遍历与测试；页面按 id 直接取 `ACCESS_CLIENT_PROFILES[id]`。 */
export const ACCESS_CLIENT_PROFILE_LIST: AccessClientProfile[] = Object.values(ACCESS_CLIENT_PROFILES)

/**
 * 根地址 + 路径。
 * 根地址还没拼出来（服务没跑、或监听主机/端口不全）时统一给空串，
 * 调用方据此把地址显示成占位符并禁用复制按钮，布局不跟着数据有无变形。
 */
export function buildEndpointUrl(origin: string, path: string): string {
  return origin ? `${origin}${path}` : ''
}

/** 要填进客户端 Base URL 输入框的那一条地址。 */
export function buildBaseUrl(origin: string, profile: AccessClientProfile): string {
  return buildEndpointUrl(origin, profile.basePath)
}
