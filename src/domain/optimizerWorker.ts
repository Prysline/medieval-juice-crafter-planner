import { optimizeBatchPlan } from './optimizer'
import {
  serializeOptimizerWorkerError,
  type OptimizerWorkerRequest,
  type OptimizerWorkerResponse,
} from './optimizerWorkerProtocol'

interface OptimizerWorkerScope {
  onmessage:
    | ((event: MessageEvent<OptimizerWorkerRequest>) => void)
    | null
  postMessage(message: OptimizerWorkerResponse): void
}

const workerScope = self as unknown as OptimizerWorkerScope

workerScope.onmessage = async (
  event: MessageEvent<OptimizerWorkerRequest>,
) => {
  try {
    const result = await optimizeBatchPlan(
      event.data.request,
      { source: event.data.source },
    )
    workerScope.postMessage({ ok: true, result })
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: serializeOptimizerWorkerError(error),
    })
  }
}
