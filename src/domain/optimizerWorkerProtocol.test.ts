import { describe, expect, it } from 'vitest'
import {
  PlanningUserError,
} from './planningErrors'
import {
  deserializeOptimizerWorkerError,
  serializeOptimizerWorkerError,
} from './optimizerWorkerProtocol'

describe('optimizer worker error protocol', () => {
  it('round-trips structured planning errors', () => {
    const serialized = serializeOptimizerWorkerError(
      new PlanningUserError(
        'optimizer-no-solution',
        { solverStatus: 'infeasible' },
        'solver stopped',
      ),
    )
    const restored = deserializeOptimizerWorkerError(serialized)

    expect(restored).toBeInstanceOf(PlanningUserError)
    expect((restored as PlanningUserError).code).toBe(
      'optimizer-no-solution',
    )
    expect((restored as PlanningUserError).context).toEqual({
      solverStatus: 'infeasible',
    })
    expect(restored.message).toBe('solver stopped')
  })

  it('keeps unknown worker errors readable', () => {
    const restored = deserializeOptimizerWorkerError(
      serializeOptimizerWorkerError(new Error('boom')),
    )

    expect(restored).toBeInstanceOf(Error)
    expect(restored.message).toBe('boom')
  })
})
