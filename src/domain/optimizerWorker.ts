import { optimizeBatchPlan } from './optimizer'
import {
  serializeOptimizerWorkerError,
  type OptimizerWorkerRequest,
  type OptimizerWorkerResponse,
  type OptimizerWorkerRuntimeDiagnostics,
} from './optimizerWorkerProtocol'

interface OptimizerWorkerScope {
  onmessage:
    | ((event: MessageEvent<OptimizerWorkerRequest>) => void)
    | null
  postMessage(message: OptimizerWorkerResponse): void
}

const workerScope = self as unknown as OptimizerWorkerScope

function installWasmFetchDiagnostics(): {
  diagnostics: OptimizerWorkerRuntimeDiagnostics
  restore(): void
} {
  const diagnostics: OptimizerWorkerRuntimeDiagnostics = {
    wasmResponses: [],
  }
  const fetchScope = globalThis as typeof globalThis & {
    fetch: typeof fetch
  }
  const originalFetch = fetchScope.fetch

  fetchScope.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await originalFetch.call(fetchScope, input, init)
    if (response.url.includes('.wasm')) {
      const clonedResponse = response.clone()
      const bytes = new Uint8Array(
        await clonedResponse.arrayBuffer(),
      )
      diagnostics.wasmResponses.push({
        url: response.url,
        status: response.status,
        contentType: response.headers.get('content-type'),
        magicBytes: Array.from(bytes.slice(0, 4)),
      })
    }
    return response
  }

  return {
    diagnostics,
    restore() {
      fetchScope.fetch = originalFetch
    },
  }
}

workerScope.onmessage = async (
  event: MessageEvent<OptimizerWorkerRequest>,
) => {
  const runtimeRecorder = event.data.collectRuntimeDiagnostics
    ? installWasmFetchDiagnostics()
    : null

  try {
    const result = await optimizeBatchPlan(
      event.data.request,
      { source: event.data.source },
    )
    workerScope.postMessage({
      ok: true,
      result,
      runtimeDiagnostics: runtimeRecorder?.diagnostics,
    })
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: serializeOptimizerWorkerError(error),
      runtimeDiagnostics: runtimeRecorder?.diagnostics,
    })
  } finally {
    runtimeRecorder?.restore()
  }
}
