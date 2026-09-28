import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

const DRIVER_PORT = 9521
const BASE = '/medieval-juice-crafter-planner/'
const interactionIt = process.env.CI ? it : it.skip

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

async function waitFor(sessionId, script, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await execute(sessionId, script)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Browser condition timed out: ${script}`)
}

async function setProductionScaleRecipeState(sessionId) {
  await execute(
    sessionId,
    `
      const select = document.querySelector('.progress-settings select')
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('progress select missing')
      }
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(select, 'liquid-blender-unlocked')
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
      return count > 10_000 ? count : 0
    `,
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

  await waitFor(
    sessionId,
    `
      const input = document.querySelector(
        '.recipe-pagination input[type="number"]',
      )
      return input?.value === '${page}'
    `,
  )
}

async function openNonMatchingRecipeRow(sessionId, queryText) {
  return execute(
    sessionId,
    `
      const [queryText] = arguments
      const row = [...document.querySelectorAll('.recipe-table > .table-row')]
        .find((item) => {
          const name = item.querySelector('.primary-cell strong')
            ?.textContent?.trim() ?? ''
          return name && !name.includes(queryText)
        })
      if (!(row instanceof HTMLDetailsElement)) return ''
      const name = row.querySelector('.primary-cell strong')
        ?.textContent?.trim() ?? ''
      row.querySelector('summary')?.click()
      return name
    `,
    [queryText],
  )
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
        done({ error: 'recipe search target missing' })
        return
      }

      const rowNames = () =>
        [...table.querySelectorAll(':scope > .table-row .primary-cell strong')]
          .map((node) => node.textContent?.trim() ?? '')
      const beforePage = pageInput.value
      const beforeSummary = summary.textContent ?? ''
      const startedAt = performance.now()
      const tableMutationPages = []
      let childListRecords = 0
      let frame = 0
      let stableFrames = 0
      let lastSignature = ''
      let finished = false

      const observer = new MutationObserver((records) => {
        const relevant = records.filter((record) => record.type === 'childList')
        if (!relevant.length) return
        childListRecords += relevant.length
        tableMutationPages.push(pageInput.value)
      })
      observer.observe(table, { childList: true, subtree: true })

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        observer.disconnect()
        done({
          beforePage,
          afterPage: pageInput.value,
          beforeSummary,
          afterSummary: summary.textContent ?? '',
          afterNames: rowNames(),
          openNames: [
            ...table.querySelectorAll(':scope > details.table-row[open] .primary-cell strong'),
          ].map((node) => node.textContent?.trim() ?? ''),
          tableMutationPages,
          childListRecords,
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        const signature = [
          pageInput.value,
          summary.textContent ?? '',
          rowNames().join('|'),
        ].join('::')
        const ready =
          pageInput.value === '1' &&
          (summary.textContent ?? '') !== beforeSummary
        if (ready && signature === lastSignature) {
          stableFrames += 1
        } else {
          stableFrames = 0
          lastSignature = signature
        }
        if (ready && stableFrames >= 2) {
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

async function waitForSummaryChange(sessionId, actionScript) {
  return executeAsync(
    sessionId,
    `
      const [actionScript] = arguments
      const done = arguments[arguments.length - 1]
      const summary = document.querySelector('.research-filter-summary')
      if (!summary) {
        done({ error: 'recipe summary missing' })
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
      Function(actionScript)()
    `,
    [actionScript],
  )
}

async function measurePriceFilter(sessionId, value) {
  return waitForSummaryChange(
    sessionId,
    `
      const label = [...document.querySelectorAll('.recipe-research-filters label')]
        .find((item) => item.querySelector('span')?.textContent?.trim() === '售價')
      const select = label?.querySelector('select')
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('recipe price filter missing')
      }
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(select, '${value}')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    `,
  )
}

async function measureSalePriceSort(sessionId) {
  return executeAsync(
    sessionId,
    `
      const done = arguments[arguments.length - 1]
      const button = [...document.querySelectorAll('.recipe-table .table-head button')]
        .find((item) => item.getAttribute('aria-label')?.startsWith('售價'))
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

describe('recipe search pagination interaction', () => {
  interactionIt(
    'resets page 2 search to page 1 before recipe-table replacement',
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
          await setProductionScaleRecipeState(sessionId)

        await moveToRecipePage(sessionId, 2)
        const openedRecipe = await openNonMatchingRecipeRow(sessionId, '檸檬')
        expect(openedRecipe).not.toBe('')

        const pageTwoSearch = await measureRecipeQuery(sessionId, '檸檬')
        expect(pageTwoSearch.error).toBeUndefined()
        expect(pageTwoSearch.timedOut).toBe(false)
        expect(pageTwoSearch.beforePage).toBe('2')
        expect(pageTwoSearch.afterPage).toBe('1')
        expect(pageTwoSearch.tableMutationPages.length).toBeGreaterThan(0)
        expect(pageTwoSearch.tableMutationPages).not.toContain('2')
        if (!pageTwoSearch.afterNames.includes(openedRecipe)) {
          expect(pageTwoSearch.openNames).not.toContain(openedRecipe)
          expect(pageTwoSearch.openNames).toHaveLength(0)
        }

        const pageOneClear = await measureRecipeQuery(sessionId, '')
        expect(pageOneClear.error).toBeUndefined()
        expect(pageOneClear.timedOut).toBe(false)
        expect(pageOneClear.beforePage).toBe('1')
        expect(pageOneClear.afterPage).toBe('1')
        expect(pageOneClear.tableMutationPages).not.toContain('2')

        const pageOneSearch = await measureRecipeQuery(sessionId, '檸檬')
        expect(pageOneSearch.error).toBeUndefined()
        expect(pageOneSearch.timedOut).toBe(false)
        expect(pageOneSearch.beforePage).toBe('1')
        expect(pageOneSearch.afterPage).toBe('1')
        expect(pageOneSearch.tableMutationPages).not.toContain('2')

        const clearForControls = await measureRecipeQuery(sessionId, '')
        expect(clearForControls.error).toBeUndefined()
        expect(clearForControls.timedOut).toBe(false)

        const priceKnown = await measurePriceFilter(sessionId, 'known')
        expect(priceKnown.error).toBeUndefined()
        expect(priceKnown.timedOut).toBe(false)
        const priceAll = await measurePriceFilter(sessionId, 'all')
        expect(priceAll.error).toBeUndefined()
        expect(priceAll.timedOut).toBe(false)

        const salePriceSort = await measureSalePriceSort(sessionId)
        expect(salePriceSort.error).toBeUndefined()
        expect(salePriceSort.timedOut).toBe(false)
        expect(salePriceSort.after).not.toBe(salePriceSort.before)

        console.log('[recipe-search-pagination-interaction]', {
          recipeAuthorityCount,
          pageTwoSearch: {
            resultCommitMs: pageTwoSearch.resultCommitMs,
            childListRecords: pageTwoSearch.childListRecords,
            tableMutationPages: pageTwoSearch.tableMutationPages,
          },
          pageOneSearchMs: pageOneSearch.resultCommitMs,
          pageOneClearMs: pageOneClear.resultCommitMs,
          priceFilterMs: [priceKnown.resultCommitMs, priceAll.resultCommitMs],
          salePriceSortMs: salePriceSort.resultCommitMs,
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
