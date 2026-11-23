import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { processRoadMilesRequest } from './api/road-miles.js'
import { processDatRateRequest, getDatConfig } from './api/dat-rate.js'
import { handleParamountEmail } from './api/_lib/gmailThread.js'
import { getServiceClient } from './api/_lib/server.js'
import { describeSaveResult, extractProspects, isBlockedProspect } from './src/lib/prospects.js'

// The TMS account that owns imported prospects, looked up once per server run.
let prospectOwnerId = null
const { readRatesStatus, readHelperStatus, readRemovalStatus } = createRequire(import.meta.url)('./bot/status-server.js')
const { buildHealthReport, readWatchdogStatus } = createRequire(import.meta.url)('./bot/health.js')
const { sendOnce, SEND_ACTIONS, markEmailSkipped, settleUnknownEmail, listUnknownEmails } = createRequire(import.meta.url)('./bot/email-record.js')
const { readBotControl, writeBotControl } = createRequire(import.meta.url)('./bot/local-bot-control.js')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_MAPS_API_KEY', 'DAT_USERNAME', 'DAT_PASSWORD', 'DAT_USER_USERNAME', 'DAT_AUTH_BASE', 'DAT_RATECAST_URL',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key]
    }
  }

  return {
    server: {
      host: '127.0.0.1',
      watch: {
        ignored: (file) => file.includes('browser-profile')
      }
    },
    plugins: [
      react(),
      {
        name: 'road-miles-api',
        configureServer(server) {
          // "Bot off" light in the TMS header -> starts the upload bot in its own window.
          // Only this computer's TMS can call it (the dev server listens on 127.0.0.1 and
          // requests from other web pages are refused by the Origin check).
          let lastBotStart = 0
          let lastRatesStart = 0
          server.middlewares.use('/api/local-bots', (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can control these bots.' }))
            }
            if (req.method === 'GET') {
              try { return res.end(JSON.stringify({ enabled: readBotControl() })) } catch (error) {
                res.statusCode = 500
                return res.end(JSON.stringify({ error: `Cannot read bot control: ${error.message}` }))
              }
            }
            if (req.method !== 'POST') {
              res.statusCode = 405
              return res.end(JSON.stringify({ error: 'Use GET or POST.' }))
            }
            let body = ''
            req.on('data', chunk => {
              body += chunk
              if (body.length > 1024) req.destroy()
            })
            req.on('end', () => {
              try {
                const { enabled } = JSON.parse(body)
                writeBotControl(enabled)
                res.end(JSON.stringify({ enabled }))
              } catch (error) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: `Cannot change bot control: ${error.message}` }))
              }
            })
          })
          const requireBotsEnabled = res => {
            try {
              if (readBotControl()) return true
              res.statusCode = 409
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Local bots are paused. Turn them on first.' }))
            } catch (error) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Cannot read bot control: ${error.message}` }))
            }
            return false
          }
          server.middlewares.use('/api/rates/status', (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can read rate-worker status.' }))
            }
            if (req.method !== 'GET') {
              res.statusCode = 405
              return res.end(JSON.stringify({ error: 'Use GET.' }))
            }
            res.end(JSON.stringify(readRatesStatus()))
          })
          // Morning system check (header "System check"): every local piece in one answer.
          const signingInSince = {}
          server.middlewares.use('/api/health', async (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can read the system check.' }))
            }
            if (req.method !== 'GET') {
              res.statusCode = 405
              return res.end(JSON.stringify({ error: 'Use GET.' }))
            }
            const now = Date.now()
            let upload = null
            try {
              const response = await fetch('http://127.0.0.1:47615/status', { signal: AbortSignal.timeout(2500) })
              if (response.ok) upload = await response.json()
            } catch { /* not running */ }
            let postingEnabled = true
            try {
              postingEnabled = JSON.parse(readFileSync(path.join(process.cwd(), 'bot', 'automation-policy.json'), 'utf8')).automaticPostingEnabled !== false
            } catch { /* default on */ }
            let botsEnabled = true
            try { botsEnabled = readBotControl() } catch { /* default on */ }
            // How long each bot has been signing in (a long wait means it needs Daniel's sign-in).
            const withSignIn = (key, status) => {
              if (status && ['signing-in', 'starting'].includes(status.state)) signingInSince[key] = signingInSince[key] || now
              else delete signingInSince[key]
              return status ? { ...status, signingInSince: signingInSince[key] } : null
            }
            res.end(JSON.stringify(buildHealthReport({
              now, bootedAt: now - os.uptime() * 1000, botsEnabled, postingEnabled,
              watchdog: readWatchdogStatus(now),
              upload: withSignIn('upload', upload && { state: upload.state, message: upload.message }),
              helper: withSignIn('helper', readHelperStatus()),
              removal: withSignIn('removal', readRemovalStatus()),
              rates: withSignIn('rates', readRatesStatus()),
              unknownEmails: (() => { try { return listUnknownEmails() } catch { return [] } })()
            })))
          })
          server.middlewares.use('/api/rates/start', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the local TMS can start the rate worker.' })
            }
            if (!requireBotsEnabled(res)) return
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the rate worker from the TMS only works on Windows.' })
            const status = readRatesStatus()
            if (status.state !== 'off' && status.pid) {
              try {
                process.kill(status.pid, 0)
                return reply(200, { ok: true, alreadyRunning: true })
              } catch (error) {
                if (error.code !== 'ESRCH') return reply(500, { error: `Cannot verify the rate worker: ${error.message}` })
              }
            }
            if (Date.now() - lastRatesStart < 30_000) return reply(200, { ok: true, starting: true })
            lastRatesStart = Date.now()
            const botDir = path.resolve(process.cwd(), 'bot')
            const launcher = path.join(botDir, 'Start Rate Worker.bat')
            try {
              const child = spawn('cmd.exe', ['/c', `start "Landstar Rate Worker" "${launcher}"`], {
                cwd: botDir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
              })
              await new Promise((resolve, reject) => {
                child.once('spawn', resolve)
                child.once('error', reject)
              })
              child.unref()
              reply(200, { ok: true, starting: true })
            } catch (error) {
              lastRatesStart = 0
              console.error('Could not start the rate worker:', error)
              reply(500, { error: 'Could not start the rate worker. Double-click Start Rate Worker.bat in the bot folder.' })
            }
          })
          // "Helper off" light -> starts the helper bot (bot/helper.js) in its own window.
          let lastHelperStart = 0
          server.middlewares.use('/api/helper/start', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can start the helper bot.' })
            }
            if (!requireBotsEnabled(res)) return
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the helper bot only works on Windows.' })
            if (Date.now() - lastHelperStart < 30_000) return reply(200, { ok: true, starting: true })
            lastHelperStart = Date.now()
            const botDir = path.resolve(process.cwd(), 'bot')
            const launcher = path.join(botDir, 'Start Helper Bot.bat')
            try {
              const child = spawn('cmd.exe', ['/c', `start "Landstar Helper Bot" "${launcher}"`], {
                cwd: botDir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
              })
              child.on('error', error => console.error('Could not start the helper bot:', error))
              child.unref()
              reply(200, { ok: true, started: true })
            } catch (error) {
              console.error('Could not start the helper bot:', error)
              lastHelperStart = 0
              reply(500, { error: 'The helper bot could not be started. Double-click Start Helper Bot.bat in the bot folder.' })
            }
          })

          server.middlewares.use('/api/bot/start', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can start the bot.' })
            }
            if (!requireBotsEnabled(res)) return
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the bot from the TMS only works on Windows.' })
            try {
              const policy = JSON.parse(readFileSync(path.resolve(process.cwd(), 'bot', 'automation-policy.json'), 'utf8'))
              if (policy.automaticPostingEnabled === false) {
                return reply(409, { error: 'Automatic posting is paused after the bulk takedown request. Starting the posting bot is disabled until posting is explicitly re-enabled.' })
              }
            } catch (error) {
              console.error('Could not verify posting policy:', error)
              return reply(503, { error: 'Cannot verify whether posting is allowed. The bot was not started.' })
            }
            try {
              const running = await fetch('http://127.0.0.1:47615/status', { signal: AbortSignal.timeout(1000) })
              if (running.ok) return reply(200, { ok: true, alreadyRunning: true })
            } catch { /* not running */ }
            if (Date.now() - lastBotStart < 30_000) return reply(200, { ok: true, starting: true })
            lastBotStart = Date.now()
            const botDir = path.resolve(process.cwd(), 'bot')
            const launcher = path.join(botDir, 'Start Landstar Bot.bat')
            try {
              const child = spawn('cmd.exe', ['/c', `start "Landstar Bot" "${launcher}"`], {
                cwd: botDir,
                detached: true,
                stdio: 'ignore',
                windowsVerbatimArguments: true
              })
              child.on('error', error => console.error('Could not start the Landstar bot:', error))
              child.unref()
              reply(200, { ok: true, started: true })
            } catch (error) {
              console.error('Could not start the Landstar bot:', error)
              lastBotStart = 0
              reply(500, { error: 'The bot could not be started. Double-click Start Landstar Bot.bat in the bot folder.' })
            }
          })

          // Paramount tracking emails (reply-all on the rate confirmation thread, and
          // replies to watch for). Only this computer's TMS can call it.
          server.middlewares.use('/api/paramount-email', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can send these emails.' })
            }
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 65_536) return reply(413, { error: 'The email is too large.' })
            }
            try {
              const request = JSON.parse(body || '{}')
              const { emailKey, emailMeta, ...rest } = request
              // Sends with a record key go through the email record (bot/email-record.js):
              // the same email is never sent twice, whichever process sends it.
              const result = emailKey && SEND_ACTIONS.has(rest.action)
                ? await sendOnce(String(emailKey), emailMeta || {}, () => handleParamountEmail(rest))
                : await handleParamountEmail(rest)
              reply(result.status, result.body)
            } catch (error) {
              console.error('Paramount email request failed:', error.message)
              reply(502, { error: error.message || 'The Gmail request failed.' })
            }
          })

          // Email record: "Don't send" clicks, and settling sends that never finished.
          server.middlewares.use('/api/email-record', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(JSON.stringify(body))
            }
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can change the email record.' })
            }
            try {
              if (req.method === 'GET') return reply(200, { unknown: listUnknownEmails() })
              if (req.method !== 'POST') return reply(405, { error: 'Use GET or POST.' })
              let body = ''
              for await (const chunk of req) {
                body += chunk
                if (body.length > 4096) return reply(413, { error: 'Too large.' })
              }
              const { action, key, meta, wentOut } = JSON.parse(body || '{}')
              if (!key) return reply(400, { error: 'An email key is required.' })
              if (action === 'skip') markEmailSkipped(String(key), meta || {})
              else if (action === 'settle') settleUnknownEmail(String(key), Boolean(wentOut))
              else return reply(400, { error: 'Unknown action.' })
              reply(200, { ok: true })
            } catch (error) {
              reply(500, { error: error.message })
            }
          })

          // "Save to TMS" bookmarklet on DAT: receives the DAT page text, pulls out the broker
          // contacts (src/lib/prospects.js) and saves them as prospects in Supabase. The browser
          // sends a preflight for https://one.dat.com -> http://127.0.0.1, so CORS answers too.
          server.middlewares.use('/api/prospects-import', async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'content-type')
            res.setHeader('Access-Control-Allow-Private-Network', 'true')
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 2_000_000) return reply(413, { error: 'The page text is too large.' })
            }
            try {
              const supabase = getServiceClient()
              if (!supabase) return reply(503, { error: 'Supabase is not set up in .env.' })
              // Prospects belong to the office's main account: the user whose email matches
              // the connected Gmail (gmail_connection), not whichever account lists first.
              if (!prospectOwnerId) {
                const { data: connection } = await supabase.from('gmail_connection').select('email').eq('id', 1).maybeSingle()
                const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 })
                if (error) throw error
                const ownerEmail = String(connection?.email || '').toLowerCase()
                const match = (data?.users || []).find(user => String(user.email || '').toLowerCase() === ownerEmail)
                prospectOwnerId = match?.id || data?.users?.[0]?.id
                if (!prospectOwnerId) return reply(503, { error: 'No TMS user account found.' })
              }
              const found = extractProspects(body)
                .filter(item => !isBlockedProspect(item)
                  && !/@dat\.com$/i.test(item.email) && item.email !== 'trucks1224@gmail.com')
              if (!found.length) {
                return reply(200, { saved: 0, skipped: 0, error: 'No broker emails on this DAT page. Open the posting so the contact email shows, then click the bookmark again.' })
              }
              const { data, error } = await supabase.from('prospects').upsert(
                found.map(item => ({
                  owner_id: prospectOwnerId, company: item.company || '', contact: item.contact || '',
                  email: item.email, phone: item.phone || '', lane: item.lane || ''
                })),
                { onConflict: 'owner_id,email', ignoreDuplicates: true }
              ).select('company, email')
              if (error) throw error
              // Who was already in the list (same email), with where they stand, for the pop-up.
              const added = new Set((data || []).map(row => row.email.toLowerCase()))
              const skippedEmails = [...new Set(found.map(item => item.email.toLowerCase()).filter(email => !added.has(email)))]
              const { data: existing } = skippedEmails.length
                ? await supabase.from('prospects').select('company, email, status, created_at')
                  .eq('owner_id', prospectOwnerId).in('email', skippedEmails)
                : { data: [] }
              reply(200, {
                saved: (data || []).length, skipped: skippedEmails.length,
                message: describeSaveResult(data || [], existing || [])
              })
            } catch (error) {
              console.error('Prospects import failed:', error.message)
              reply(502, { error: error.message || 'The prospects import failed.' })
            }
          })

          server.middlewares.use('/api/road-miles', async (req, res) => {
            let body = ''
            try {
              for await (const chunk of req) {
                body += chunk
                if (body.length > 16_384) {
                  res.statusCode = 413
                  res.end(JSON.stringify({ error: 'The road-miles request is too large.' }))
                  return
                }
              }

              const result = await processRoadMilesRequest({
                method: req.method,
                body: body || null
              }, process.env.GOOGLE_MAPS_API_KEY)
              res.statusCode = result.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result.body))
            } catch (error) {
              console.error('Local road-miles request failed:', error)
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'The road-miles request could not be processed.' }))
            }
          })

          server.middlewares.use('/api/dat-rate', async (req, res) => {
            let body = ''
            try {
              for await (const chunk of req) {
                body += chunk
                if (body.length > 16_384) {
                  res.statusCode = 413
                  res.end(JSON.stringify({ error: 'The DAT rate request is too large.' }))
                  return
                }
              }

              const result = await processDatRateRequest({
                method: req.method,
                body: body || null
              }, getDatConfig())
              res.statusCode = result.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result.body))
            } catch (error) {
              console.error('Local DAT rate request failed:', error)
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'The DAT rate request could not be processed.' }))
            }
          })
        }
      }
    ]
  }
})