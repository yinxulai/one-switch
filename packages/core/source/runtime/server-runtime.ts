import type { Server } from 'node:http'
import type { RuntimeConfig } from '@common/runtime-config'
import type { SecretStore } from '@common/secret-store'
import type { TelemetryServiceFailureReason } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { configureSettingsDefaults, getSettings } from '@server/database/settings-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { configureCoreNetworkConnector, resetCoreNetworkConnector } from '../infrastructure/network/core-network'
import { configureOutboundConnector, createOutboundConnector, destroyOutboundConnector, type SystemProxyResolver } from '../infrastructure/network/outbound-connector'
import { installLogCapture } from '../management/infrastructure/log-buffer'
import { configureShutdownHandshake, type ShutdownHandshake } from '../management/core/shutdown-handshake'
import { startManagementServer, stopManagementServer } from '../management/server'
import { resetManualModels } from '../proxy/routing/manual-routing'
import { startProxyServer, stopProxyServer } from '../proxy/runtime/server'
import {
  reportTelemetryStartFailure,
  startTelemetry,
} from '../telemetry'
import {
  acquireInstanceLock,
  InstanceLockError,
  lockFilePath,
  startInstanceLockHeartbeat,
  type InstanceLock,
} from './instance-lock'

export interface ServerRuntimeOptions {
  runtimeConfig: RuntimeConfig
  secretStore: SecretStore
  systemProxyResolver?: SystemProxyResolver
  /**
   * 优雅退出握手。桌面形态不需要（进程自己说了算），CLI 需要——见
   * `../management/core/shutdown-handshake.ts`。
   */
  shutdown?: ShutdownHandshake | null
}

/** 启动完成后的实际监听结果，供宿主打印访问地址。 */
export interface ServerEndpoints {
  managementHost: string
  managementPort: number
  /** 实际生效的代理监听地址：来自设置，可能是用户改过的值而不是配置里的默认值。 */
  proxyHost: string
  proxyPort: number
  /** 托管控制台时的静态产物根目录；没托管为 `null`。 */
  webRoot: string | null
}

export class ServerRuntime {
  private state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' = 'created'
  private managementServer: Server | null = null
  private endpoints: ServerEndpoints | null = null
  private instanceLock: InstanceLock | null = null
  private stopLockHeartbeat: (() => void) | null = null
  private stopTelemetry: (() => void) | null = null

  constructor(private readonly options: ServerRuntimeOptions) {}

  get status(): string {
    return this.state
  }

  async start(): Promise<ServerEndpoints> {
    if (this.state === 'running') {
      if (!this.endpoints) throw new Error('Server runtime endpoints are missing')
      return this.endpoints
    }
    if (this.state === 'starting') throw new Error('Server runtime is already starting')
    if (this.state === 'stopping') throw new Error('Server runtime is stopping')

    const config = this.options.runtimeConfig
    const webRoot = config.serveWeb ? config.webRoot : null
    this.state = 'starting'
    console.info(`[runtime] start requested environment=${config.environment} proxyPort=${config.proxyPort} managementPort=${config.managementPort} serveWeb=${webRoot !== null}`)
    try {
      resetManualModels()
      configureSecretStore(this.options.secretStore)
      configureSettingsDefaults({ listenHost: config.proxyHost, listenPort: config.proxyPort })
      configureShutdownHandshake(this.options.shutdown ?? null)
      installLogCapture()
      // 单实例必须排在数据库之前：两个进程同时打开同一对 SQLite 文件是这套架构里
      // 最难查的一类损坏，而“谁先认领数据目录”跟启动方式无关，所以它是 core 的能力
      // 而不是某个宿主的（见 `./instance-lock.ts`）。
      await this.acquireInstanceLock(config.dataDir)
      await initDatabases(config.dataDir)
      const outboundConnector = createOutboundConnector(getSettings, this.options.systemProxyResolver)
      await outboundConnector.initialize()
      configureOutboundConnector(outboundConnector, this.options.systemProxyResolver)
      configureCoreNetworkConnector(outboundConnector)
      const settings = await getSettings()
      console.debug(`[runtime] proxy endpoint resolved host=${settings.listenHost} port=${settings.listenPort}`)
      console.info(`[runtime] starting management server host=${config.managementHost} port=${config.managementPort}`)
      this.managementServer = await startManagementServer({
        host: config.managementHost,
        port: config.managementPort,
        environment: config.environment,
        webRoot,
      })
      console.info(`[runtime] management server started listening=${this.managementServer.listening}`)
      console.info(`[runtime] starting proxy server host=${settings.listenHost} port=${settings.listenPort}`)
      await startProxyServer({ host: settings.listenHost, port: settings.listenPort })
      // 统计在**监听成功之后**才启动：它不该在启动流程里插一脚，「启动完成」这件事也是
      // 它要报的第一条事件（见 `../telemetry`）。
      this.stopTelemetry = startTelemetry(config)
      this.endpoints = {
        managementHost: config.managementHost,
        managementPort: config.managementPort,
        proxyHost: settings.listenHost,
        proxyPort: settings.listenPort,
        webRoot,
      }
      this.state = 'running'
      console.info(`[runtime] start completed state=${this.state}`)
      return this.endpoints
    } catch (error) {
      console.error(`[runtime] start failed state=${this.state}`, error)
      // 归因补发要在拆资源之前：数据库还开着，设置才读得出来。
      await reportTelemetryStartFailure(config, classifyStartFailure(error))
      try {
        await this.stopResources()
      } catch (cleanupError) {
        console.error('[runtime] start cleanup failed', cleanupError)
      }
      this.state = 'stopped'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'created') return
    if (this.state === 'starting') throw new Error('Server runtime is still starting')
    if (this.state === 'stopping') return

    this.state = 'stopping'
    console.info(`[runtime] stop requested state=${this.state}`)
    try {
      await this.stopResources()
    } finally {
      this.state = 'stopped'
      console.info(`[runtime] stop completed state=${this.state}`)
    }
  }

  private async stopResources(): Promise<void> {
    console.info('[runtime] stopping resources')
    this.stopTelemetry?.()
    this.stopTelemetry = null
    const names = ['proxy', 'management'] as const
    const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') console.debug(`[runtime] resource stopped name=${names[index]}`)
      else console.error(`[runtime] resource stop failed name=${names[index]}`, result.reason)
    })
    destroyOutboundConnector()
    resetCoreNetworkConnector()
    configureShutdownHandshake(null)
    await closeDatabases()
    this.managementServer = null
    this.endpoints = null
    await this.releaseInstanceLock()

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    console.info('[runtime] resources stopped')
  }

  private async acquireInstanceLock(dataDir: string): Promise<void> {
    const result = await acquireInstanceLock(dataDir)
    if (!result.ok) {
      console.error(`[runtime] instance lock refused reason=${result.reason} dataDir=${dataDir}`)
      throw result.reason === 'held'
        ? new InstanceLockError(result.holder, lockFilePath(dataDir))
        : new InstanceLockError(null, result.filePath)
    }
    this.instanceLock = result.lock
    this.stopLockHeartbeat = startInstanceLockHeartbeat(dataDir)
    console.info(`[runtime] instance lock acquired dataDir=${dataDir}`)
  }

  /**
   * 只释放**自己拿到**的锁。
   *
   * 不能无条件地“清掉锁文件”：启动失败可能是“别人正拿着锁”，那时删掉它等于人为
   * 打开双实例的口子（`releaseInstanceLock` 对“读不出持有者”的锁是会删的）。
   */
  private async releaseInstanceLock(): Promise<void> {
    this.stopLockHeartbeat?.()
    this.stopLockHeartbeat = null
    const lock = this.instanceLock
    this.instanceLock = null
    if (!lock) return
    try {
      await lock.release()
    } catch (error) {
      console.error('[runtime] failed to release the instance lock', error)
    }
  }
}

/**
 * 启动失败的归因分桶。
 *
 * 三条能**确定**的写死，剩下的落到 `other`：归因不是真相的替代品，猜出来的桶会让「启动失败」
 * 这张图失去意义。所以这里只认自己抛的类型与自己设的错误码，不做文本匹配。
 *
 * `ERR_SQLITE_ERROR` 是 `node:sqlite` 抛出的错误码（见 `../database`），不是从消息里抠出来的。
 */
function classifyStartFailure(error: unknown): TelemetryServiceFailureReason {
  if (error instanceof InstanceLockError) return 'instance_lock'
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EADDRINUSE') return 'port'
  if (typeof code === 'string' && code.startsWith('ERR_SQLITE')) return 'database'
  return 'other'
}
