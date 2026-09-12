import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runWorkflow } from '@common/router/engine'
import { RouteContextInputSchema, WorkflowGraphSchema } from '@common/router/schemas'
import { createRouteCapabilities } from '@server/proxy/capabilities/route-capabilities'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 路由图的试跑接口：画布上的「试运行」走这里，而不是在渲染进程里跑。
 *
 * 引擎在渲染进程里跑得动（它是纯计算），但脚本沙箱与提示词调用需要主进程的资源：
 * 在画布上试跑却拿到「能力未注入」，用户会以为自己的图写错了。因此试跑一律交给服务端。
 */

const RouterRunRequestSchema = z.object({
  graph: WorkflowGraphSchema,
  inputPayload: RouteContextInputSchema,
})

export const routerRunRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/run', handleRouterRun)

async function handleRouterRun(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouterRunRequestSchema.parse(body)
  const result = await runWorkflow(input.graph, input.inputPayload, { capabilities: createRouteCapabilities() })
  sendSuccess(res, result)
}
