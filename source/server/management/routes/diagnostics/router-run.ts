import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runWorkflow } from '@render/source/pages/router/engine'
import { WorkflowGraphSchema, RouteContextInputSchema } from '@render/source/pages/router/schemas'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

const RouterRunRequestSchema = z.object({
  graph: WorkflowGraphSchema,
  inputPayload: RouteContextInputSchema,
})

export const routerRunRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/run', handleRouterRun)

async function handleRouterRun(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouterRunRequestSchema.parse(body)
  const result = runWorkflow(input.graph, input.inputPayload)
  sendSuccess(res, result)
}
