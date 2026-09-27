import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

const DRIVER_PORT = 9516
const BASE = '/medieval-juice-crafter-planner/'
const profileIt = process.env.CI ? it : it.skip

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('ChromeDriver did not start')
}

async function webdriver(pathname, method = 'GET', body) {
  const response = await fetch(
    `http://127.0.0.1:${DRIVER_PORT}${pathname}`,
    {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  )
  const payload = await response.json()
  if (!response.ok || payload.value?.error) {
    throw new Error(
      `WebDriver ${method} ${pathname} failed: ${JSON.stringify(payload)}`,
    )
  }
  return payload.value
}

function execute(sessionId, script, args = []) {
  return webdriver(
    `/session/${sessionId}/execute/sync`,
    'POST',
    { script, args },
  )
}

function executeAsync(sessionId, script, args = []) {
  return webdriver(
    `/session/${sessionId}/execute/async`,
    'POST',
    { script, args },
  )
}

async function waitFor(sessionId, script, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await execute(sessionId, script)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Browser condition timed out: ${script}`)
}

async function setProductionScaleState(sessionId) {
  await execute(
    sessionId,
    `
      const select = document.querySelector('.progress-settings select')
      if (!select) throw new Error('progress select missing')
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(select, 'juice-blender-unlocked')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    `,
  )

  const recipeAuthorityCount = await waitFor(
    sessionId,
    `
      const text = document.querySelectorAll('.tabs button')[1]
        ?.querySelector('span')?.textContent ?? ''
      const count = Number(text.replace(/[^0-9]/g, ''))
      return count > 10000 ? count : 0
    `,
    30_000,
  )

  await execute(
    sessionId,
    `
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      for (const input of document.querySelectorAll(
        '.progress-settings input[type="number"]',
      )) {
        setter.call(input, '9999')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return true
    `,
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
  return recipeAuthorityCount
}

async function measureInputCommit(
  sessionId,
  inputSelector,
  value,
  resultSelector,
  resultMode = 'text',
) {
  return executeAsync(
    sessionId,
    `
      const [inputSelector, value, resultSelector, resultMode] = arguments
      const done = arguments[arguments.length - 1]
      const input = document.querySelector(inputSelector)
      const result = document.querySelector(resultSelector)
      if (!(input instanceof HTMLInputElement) || !result) {
        done({ error: 'missing input/result', inputSelector, resultSelector })
        return
      }

      const readResult = () =>
        resultMode === 'childCount'
          ? result.querySelectorAll('.optimizer-target-option').length
          : result.textContent ?? ''
      const before = readResult()
      const startedAt = performance.now()
      let firstPaintMs = null
      let finished = false
      let frame = 0

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        done({
          before,
          after: readResult(),
          inputValue: input.value,
          firstPaintMs,
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        if (firstPaintMs === null) {
          firstPaintMs = performance.now() - startedAt
        }
        if (readResult() !== before) {
          finish(false)
          return
        }
        frame = requestAnimationFrame(check)
      }

      const timeout = setTimeout(() => finish(true), 5000)
      frame = requestAnimationFrame(check)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, value)
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: value ? 'insertText' : 'deleteContentBackward',
          data: value || null,
        }),
      )
    `,
    [inputSelector, value, resultSelector, resultMode],
  )
}

async function measurePriceFilter(sessionId, value) {
  return executeAsync(
    sessionId,
    `
      const [value] = arguments
      const done = arguments[arguments.length - 1]
      const label = [...document.querySelectorAll(
        '.recipe-research-filters label',
      )].find(
        (item) => item.querySelector('span')?.textContent?.trim() === '售價',
      )
      const select = label?.querySelector('select')
      const summary = document.querySelector('.research-filter-summary')
      if (!(select instanceof HTMLSelectElement) || !summary) {
        done({ error: 'recipe price filter missing' })
        return
      }

      const before = summary.textContent ?? ''
      const startedAt = performance.now()
      let finished = false
      let frame = 0

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        done({
          before,
          after: summary.textContent ?? '',
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        if ((summary.textContent ?? '') !== before) {
          finish(false)
          return
        }
        frame = requestAnimationFrame(check)
      }

      const timeout = setTimeout(() => finish(true), 5000)
      frame = requestAnimationFrame(check)
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    `,
    [value],
  )
}

async function measureSalePriceSort(sessionId) {
  return executeAsync(
    sessionId,
    `
      const done = arguments[arguments.length - 1]
      const button = [...document.querySelectorAll(
        '.recipe-table .table-head button',
      )].find((item) =>
        item.getAttribute('aria-label')?.startsWith('售價'),
      )
      const readFirst = () =>
        document.querySelector(
          '.recipe-table .table-row .primary-cell strong',
        )?.textContent ?? ''
      if (!(button instanceof HTMLButtonElement)) {
        done({ error: 'sale-price sort missing' })
        return
      }

      const before = readFirst()
      const startedAt = performance.now()
      let finished = false
      let frame = 0

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        done({
          before,
          after: readFirst(),
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        if (readFirst() !== before) {
          finish(false)
          return
        }
        frame = requestAnimationFrame(check)
      }

      const timeout = setTimeout(() => finish(true), 5000)
      frame = requestAnimationFrame(check)
      button.click()
    `,
  )
}

function assertMeasurements(results, label) {
  for (const result of results) {
    expect(result.error, `${label}: ${JSON.stringify(result)}`).toBeUndefined()
    expect(result.timedOut, `${label}: ${JSON.stringify(result)}`).toBe(false)
    expect(result.after, `${label}: result did not change`).not.toEqual(
      result.before,
    )
  }
}

function summarizeInput(results) {
  return {
    firstPaintMedianMs: median(results.map((item) => item.firstPaintMs)),
    resultCommitMedianMs: median(
      results.map((item) => item.resultCommitMs),
    ),
    samples: results.map((item) => ({
      firstPaintMs: item.firstPaintMs,
      resultCommitMs: item.resultCommitMs,
    })),
  }
}

function summarizeCommit(results) {
  return {
    resultCommitMedianMs: median(
      results.map((item) => item.resultCommitMs),
    ),
    samples: results.map((item) => item.resultCommitMs),
  }
}

describe('browser interaction responsiveness profile', () => {
  profileIt(
    'measures customer/recipe/filter/sort/optimizer result commits in Chrome',
    async () => {
      const server = await createServer({
        ...viteConfig,
        configFile: false,
        logLevel: 'silent',
        server: {
          ...viteConfig.server,
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
        },
      })
      const driver = spawn(
        'chromedriver',
        [`--port=${DRIVER_PORT}`, '--silent'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let driverStderr = ''
      driver.stderr.on('data', (chunk) => {
        driverStderr += chunk.toString()
      })
      let sessionId

      try {
        await server.listen()
        const address = server.httpServer?.address()
        if (!address || typeof address === 'string') {
          throw new Error('Vite server did not expose a TCP port')
        }

        await waitForDriver()
        const session = await webdriver('/session', 'POST', {
          capabilities: {
            alwaysMatch: {
              browserName: 'chrome',
              'goog:chromeOptions': {
                args: [
                  '--headless=new',
                  '--no-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-background-networking',
                ],
              },
            },
          },
        })
        sessionId = session.sessionId

        await webdriver(`/session/${sessionId}/url`, 'POST', {
          url: `http://127.0.0.1:${address.port}${BASE}`,
        })
        await waitFor(
          sessionId,
          `return Boolean(document.querySelector('input[aria-label="搜尋"]'))`,
        )
        const recipeAuthorityCount =
          await setProductionScaleState(sessionId)

        const customerSet = []
        const customerClear = []
        for (let index = 0; index < 3; index += 1) {
          customerSet.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋"]',
              '奧克塔維烏斯',
              '.research-filter-summary',
            ),
          )
          customerClear.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋"]',
              '',
              '.research-filter-summary',
            ),
          )
        }
        assertMeasurements(customerSet, 'customer search set')
        assertMeasurements(customerClear, 'customer search clear')

        await execute(
          sessionId,
          `document.querySelectorAll('.tabs button')[1]?.click(); return true`,
        )
        await waitFor(
          sessionId,
          `return Boolean(document.querySelector('.recipe-table'))`,
        )

        const recipeSet = []
        const recipeClear = []
        for (let index = 0; index < 3; index += 1) {
          recipeSet.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋"]',
              '檸檬',
              '.research-filter-summary',
            ),
          )
          recipeClear.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋"]',
              '',
              '.research-filter-summary',
            ),
          )
        }
        assertMeasurements(recipeSet, 'recipe search set')
        assertMeasurements(recipeClear, 'recipe search clear')

        const recipeFilter = []
        for (let index = 0; index < 3; index += 1) {
          recipeFilter.push(await measurePriceFilter(sessionId, 'known'))
          recipeFilter.push(await measurePriceFilter(sessionId, 'all'))
        }
        assertMeasurements(recipeFilter, 'recipe price filter')

        const recipeSort = []
        for (let index = 0; index < 4; index += 1) {
          recipeSort.push(await measureSalePriceSort(sessionId))
        }
        assertMeasurements(recipeSort, 'recipe sale-price sort')

        await execute(
          sessionId,
          `document.querySelectorAll('.tabs button')[3]?.click(); return true`,
        )
        await waitFor(
          sessionId,
          `return Boolean(document.querySelector('.optimizer-tools'))`,
          30_000,
        )
        await execute(
          sessionId,
          `
            const button = [...document.querySelectorAll(
              '.optimizer-controls button',
            )].find((item) => item.textContent?.trim() === '自選顧客')
            if (!button) throw new Error('自選顧客 button missing')
            button.click()
            return true
          `,
        )
        await waitFor(
          sessionId,
          `return Boolean(document.querySelector('input[aria-label="搜尋規劃顧客"]'))`,
        )
        const targetQuery = await execute(
          sessionId,
          `
            const strong = document.querySelector(
              '.optimizer-customer-target-list .optimizer-target-option strong',
            )
            return strong?.textContent?.split('（')[0]?.trim() || ''
          `,
        )
        expect(targetQuery).not.toBe('')

        const optimizerSet = []
        const optimizerClear = []
        for (let index = 0; index < 3; index += 1) {
          optimizerSet.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋規劃顧客"]',
              targetQuery,
              '.optimizer-customer-target-list',
              'childCount',
            ),
          )
          optimizerClear.push(
            await measureInputCommit(
              sessionId,
              'input[aria-label="搜尋規劃顧客"]',
              '',
              '.optimizer-customer-target-list',
              'childCount',
            ),
          )
        }
        assertMeasurements(optimizerSet, 'optimizer customer search set')
        assertMeasurements(optimizerClear, 'optimizer customer search clear')

        console.log('[browser-responsiveness-profile]', {
          recipeAuthorityCount,
          customerSearchSet: summarizeInput(customerSet),
          customerSearchClear: summarizeInput(customerClear),
          recipeSearchSet: summarizeInput(recipeSet),
          recipeSearchClear: summarizeInput(recipeClear),
          recipePriceFilter: summarizeCommit(recipeFilter),
          recipeSalePriceSort: summarizeCommit(recipeSort),
          optimizerCustomerSearchSet: summarizeInput(optimizerSet),
          optimizerCustomerSearchClear: summarizeInput(optimizerClear),
        })

        expect(recipeAuthorityCount).toBeGreaterThan(10_000)
      } finally {
        if (sessionId) {
          try {
            await webdriver(`/session/${sessionId}`, 'DELETE')
          } catch {}
        }
        driver.kill('SIGTERM')
        await server.close()
        if (driver.exitCode && driver.exitCode !== 0) {
          console.error(driverStderr)
        }
      }
    },
    90_000,
  )
})
