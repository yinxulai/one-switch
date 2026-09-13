import type { LocalEndpoint } from './local-endpoint'

/**
 * `GET /v1/models`：给客户端 SDK 一个可用的模型清单。
 *
 * 代理对外只暴露 `default` 这个逻辑模型，具体落到哪个 ProviderModel
 * 由路由策略（含手动路由）在每次请求时决定，所以这里不展开上游模型。
 */
export const modelsEndpoint: LocalEndpoint = {
  method: 'GET',
  path: '/v1/models',
  handle(input): void {
    const { response } = input
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({
      object: 'list',
      data: [{ id: 'default', object: 'model', created: 0, owned_by: 'one-switch' }],
    }))
  },
}
