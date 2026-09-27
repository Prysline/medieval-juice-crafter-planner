import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

const DRIVER_PORT = 9519
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
    `document.querySelectorAll('.tabs button')[1]?.click(); return true`,
  )
  await waitFor(
    sessionId,
    `return document.querySelectorAll('.recipe-table > .table-row').length === 50`,
  )
  return recipeAuthorityCount
}

async function measureRecipeQuery(sessionId, value) {
  return executeAsync(
    sessionId,
    `
      const [value] = arguments
      const done = arguments[arguments.length - 1]
      const input = document.querySelector('input[aria-label="搜尋"]')
      const table = document.querySelector('.recipe-table')
      const summary = document.querySelector('.research-filter-summary')
      const pageInput = document.querySelector(
        '.recipe-pagination input[type="number"]',
      )
      if (
        !(input instanceof HTMLInputElement) ||
        !table ||
        !summary ||
        !(pageInput instanceof HTMLInputElement)
      ) {
        done({ error: 'recipe search instrumentation target missing' })
        return
      }

      const rowNames = () =>
        [...table.querySelectorAll(':scope > .table-row .primary-cell strong')]
          .map((node) => node.textContent?.trim() ?? '')
      const elementCount = () => table.querySelectorAll('*').length
      const beforeNames = rowNames()
      const beforeSet = new Set(beforeNames)
      const beforeSummary = summary.textContent ?? ''
      const beforePage = pageInput.value
      const beforeElements = elementCount()
      const startedAt = performance.now()
      let firstTableMutationMs = null
      let firstSummaryMutationMs = null
      let lastMutationMs = null
      let addedElements = 0
      let removedElements = 0
      let childListRecords = 0
      let attributeRecords = 0
      let frame = 0
      let stableFrames = 0
      let lastSignature = ''
      let finished = false

      const countElements = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return 0
        return 1 + node.querySelectorAll('*').length
      }

      const tableObserver = new MutationObserver((records) => {
        const now = performance.now() - startedAt
        if (firstTableMutationMs === null) firstTableMutationMs = now
        lastMutationMs = now
        for (const record of records) {
          if (record.type === 'childList') {
            childListRecords += 1
            for (const node of record.addedNodes) {
              addedElements += countElements(node)
            }
            for (const node of record.removedNodes) {
              removedElements += countElements(node)
            }
          } else if (record.type === 'attributes') {
            attributeRecords += 1
          }
        }
      })
      tableObserver.observe(table, {
        childList: true,
        subtree: true,
        attributes: true,
      })

      const summaryObserver = new MutationObserver(() => {
        const now = performance.now() - startedAt
        if (firstSummaryMutationMs === null) firstSummaryMutationMs = now
        lastMutationMs = now
      })
      summaryObserver.observe(summary, {
        childList: true,
        subtree: true,
        characterData: true,
      })

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        tableObserver.disconnect()
        summaryObserver.disconnect()
        const afterNames = rowNames()
        const overlap = afterNames.filter((name) => beforeSet.has(name)).length
        done({
          beforeNames,
          afterNames,
          beforeRows: beforeNames.length,
          afterRows: afterNames.length,
          overlap,
          replacedRows:
            Math.max(beforeNames.length, afterNames.length) - overlap,
          beforeElements,
          afterElements: elementCount(),
          addedElements,
          removedElements,
          childListRecords,
          attributeRecords,
          firstTableMutationMs,
          firstSummaryMutationMs,
          lastMutationMs,
          beforeSummary,
          afterSummary: summary.textContent ?? '',
          beforePage,
          afterPage: pageInput.value,
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const originalSignature = JSON.stringify([
        beforeSummary,
        beforePage,
        beforeNames,
      ])

      const check = () => {
        const signature = JSON.stringify([
          summary.textContent ?? '',
          pageInput.value,
          rowNames(),
        ])
        const changed = signature !== originalSignature
        if (changed && signature === lastSignature) {
          stableFrames += 1
        } else {
          stableFrames = 0
          lastSignature = signature
        }
        if (changed && stableFrames >= 1) {
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
    [value],
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
      let frame = 0
      let finished = false
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
          requestAnimationFrame(() => finish(false))
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
      let frame = 0
      let finished = false
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
          requestAnimationFrame(() => finish(false))
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

async function moveToRecipePage(sessionId, page) {
  await execute(
    sessionId,
    `
      const [page] = arguments
      const input = document.querySelector(
        '.recipe-pagination input[type="number"]',
      )
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('recipe page input missing')
      }
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, String(page))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    `,
    [page],
  )
  await new Promise((resolve) => setTimeout(resolve, 150))
  const actualPage = await execute(
    sessionId,
    `
      return document.querySelector(
        '.recipe-pagination input[type="number"]',
      )?.value ?? ''
    `,
  )
  if (actualPage !== String(page)) {
    throw new Error(
      `recipe page did not update: expected ${page}, got ${actualPage}`,
    )
  }
}

describe('recipe search result-commit profile', () => {
  profileIt(
    'measures row replacement and page-reset costs in real Chrome',
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
        const recipeAuthorityCount = await setProductionScaleState(sessionId)

        const pageOneSet = []
        const pageOneClear = []
        for (let index = 0; index < 3; index += 1) {
          pageOneSet.push(await measureRecipeQuery(sessionId, '檸檬'))
          pageOneClear.push(await measureRecipeQuery(sessionId, ''))
        }

        for (const item of [...pageOneSet, ...pageOneClear]) {
          expect(item.error).toBeUndefined()
          expect(item.timedOut).toBe(false)
        }

        await moveToRecipePage(sessionId, 2)
        const pageTwoSet = await measureRecipeQuery(sessionId, '檸檬')
        expect(pageTwoSet.error).toBeUndefined()
        expect(pageTwoSet.timedOut).toBe(false)

        const resetAfterPageTwo = await measureRecipeQuery(sessionId, '')
        expect(resetAfterPageTwo.error).toBeUndefined()
        expect(resetAfterPageTwo.timedOut).toBe(false)

        const priceFilter = []
        for (let index = 0; index < 3; index += 1) {
          priceFilter.push(await measurePriceFilter(sessionId, 'known'))
          priceFilter.push(await measurePriceFilter(sessionId, 'all'))
        }
        for (const item of priceFilter) {
          expect(item.error).toBeUndefined()
          expect(item.timedOut).toBe(false)
        }

        const salePriceSort = []
        for (let index = 0; index < 4; index += 1) {
          salePriceSort.push(await measureSalePriceSort(sessionId))
        }
        for (const item of salePriceSort) {
          expect(item.error).toBeUndefined()
          expect(item.timedOut).toBe(false)
        }

        const summarize = (items) => ({
          commitMedianMs: median(items.map((item) => item.resultCommitMs)),
          firstTableMutationMedianMs: median(
            items.map((item) => item.firstTableMutationMs ?? 0),
          ),
          firstSummaryMutationMedianMs: median(
            items.map((item) => item.firstSummaryMutationMs ?? 0),
          ),
          replacedRowsMedian: median(items.map((item) => item.replacedRows)),
          addedElementsMedian: median(items.map((item) => item.addedElements)),
          removedElementsMedian: median(
            items.map((item) => item.removedElements),
          ),
          childListRecordsMedian: median(
            items.map((item) => item.childListRecords),
          ),
          samples: items.map((item) => ({
            resultCommitMs: item.resultCommitMs,
            firstTableMutationMs: item.firstTableMutationMs,
            firstSummaryMutationMs: item.firstSummaryMutationMs,
            beforeRows: item.beforeRows,
            afterRows: item.afterRows,
            overlap: item.overlap,
            replacedRows: item.replacedRows,
            beforeElements: item.beforeElements,
            afterElements: item.afterElements,
            addedElements: item.addedElements,
            removedElements: item.removedElements,
            childListRecords: item.childListRecords,
            beforePage: item.beforePage,
            afterPage: item.afterPage,
          })),
        })

        console.log('[recipe-search-result-commit-profile]', {
          recipeAuthorityCount,
          pageOneSet: summarize(pageOneSet),
          pageOneClear: summarize(pageOneClear),
          pageTwoSet,
          priceFilterMedianMs: median(
            priceFilter.map((item) => item.resultCommitMs),
          ),
          priceFilterSamples: priceFilter.map(
            (item) => item.resultCommitMs,
          ),
          salePriceSortMedianMs: median(
            salePriceSort.map((item) => item.resultCommitMs),
          ),
          salePriceSortSamples: salePriceSort.map(
            (item) => item.resultCommitMs,
          ),
        })

        expect(recipeAuthorityCount).toBeGreaterThan(10_000)
        expect(pageTwoSet.beforePage).toBe('2')
        expect(pageTwoSet.afterPage).toBe('1')
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
