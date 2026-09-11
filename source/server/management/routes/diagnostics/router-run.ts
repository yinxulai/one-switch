import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runWorkflow } from '@render/source/pages/router/engine'
import { WorkflowGraphSchema, RouteContextInputSchema } from '@render/source/pages/router/schemas'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { createRouterCapabilities } from './router-capabilities'

const RouterRunRequestSchema = z.object({
  graph: WorkflowGraphSchema,
  inputPayload: RouteContextInputSchema,
})

export const routerRunRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/run', handleRouterRun)

async function handleRouterRun(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouterRunRequestSchema.parse(body)
  // 脚本节点与 LLM 节点的外部资源（沙箱 / 网络）由服务端注入。
  const result = await runWorkflow(input.graph, input.inputPayload, { capabilities: createRouterCapabilities() })
  sendSuccess(res, result)
}
