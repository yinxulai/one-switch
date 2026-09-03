import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runWorkflow } from '@render/source/pages/router/engine'
import { WorkflowNodeModelSchema, RouteContextInputSchema } from '@render/source/pages/router/schemas'
import { listLogicalModels } from '@server/database/logical-model-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

const RouterRunRequestSchema = z.object({
  nodes: z.array(WorkflowNodeModelSchema),
  inputPayload: RouteContextInputSchema,
})

export const routerRunRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/run', handleRouterRun)

async function handleRouterRun(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouterRunRequestSchema.parse(body)
  const logicalModels = await listLogicalModels()
  const result = runWorkflow(input.nodes, input.inputPayload, {
    logicalModels: logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })),
  })
  sendSuccess(res, result)
}
