import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { processRoadMilesRequest } from './api/road-miles.js'
import { processDatRateRequest, getDatConfig } from './api/dat-rate.js'
import { createDatPostingService, createDatRequest, getDatPostingConfig, DAT_REPOST_MINUTES } from './api/_lib/datPosting.js'
import { handleParamountEmail } from './api/_lib/gmailThread.js'
import { getServiceClient } from './api/_lib/server.js'
import { processInviteRequest } from './api/invite-user.js'
import { describeSaveResult, extractProspects, isBlockedProspect } from './src/lib/prospects.js'

// The TMS account that owns imported prospects, looked up once per server run.
let prospectOwnerId = null
const { readRatesStatus, readHelperStatus, readRemovalStatus } = createRequire(import.meta.url)('./bot/status-server.js')
const { buildHealthReport, readWatchdogStatus, readEmailBotStatus, postingBotFromStatus } = createRequire(import.meta.url)('./bot/health.js')
const { sendOnce, SEND_ACTIONS, markEmailSkipped, settleUnknownEmail, listUnknownEmails } = createRequire(import.meta.url)('./bot/email-record.js')
const { readBotControl, writeBotControl } = createRequire(import.meta.url)('./bot/local-bot-control.js')
const chatInbox = createRequire(import.meta.url)('./bot/chat-inbox.js')
// bot/today.js is read fresh on every request (its changes apply without restarting the TMS).
const requireLocal = createRequire(import.meta.url)
const readToday = options => {
  const file = requireLocal.resolve('./bot/today.js')
  delete requireLocal.cache[file]
  return requireLocal(file).readToday(options)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_MAPS_API_KEY', 'DAT_USERNAME', 'DAT_PASSWORD', 'DAT_USER_USERNAME', 'DAT_AUTH_BASE', 'DAT_RATECAST_URL', 'DAT_FREIGHT_BASE', 'DAT_PARTNER_ID',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key]
    }
  }

  return {
    server: {
      host: '127.0.0.1',
      watch: {
        // The bots write status files, logs, inbox files and exports every few seconds; watching
        // them kept the TMS server busy (Daniel 2026-11-27: pages took 30 s, "signal timed out").
        // Only the bot files the TMS imports (automation-policy.json) are still watched.
        ignored: (file) => {
          const name = String(file).replace(/\\/g, '/');
          if (name.includes('browser-profile') || name.includes('/teammate-setup/out/')) return true;
          if (!name.includes('/bot/')) return false;
          return !name.endsWith('/bot/automation-policy.json') && /\/bot\/(logs|chat-inbox|refresh-exports|node_modules)\/|\.(json|log|tmp|png|xlsx|lock)$/.test(name);
        }
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
          // Google Chat inbox (bot/chat-bot.js): pictures and spreadsheets from Daniel's chats.
          //   GET  /api/chat-inbox              waiting items
          //   GET  /api/chat-inbox/file?name=   one item's file
          //   POST /api/chat-inbox/done {name}  imported or cancelled: move it out of the inbox
          server.middlewares.use('/api/chat-inbox', (req, res) => {
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can read the chat inbox.' }))
            }
            const url = new URL(req.url, 'http://x')
            try {
              if (req.method === 'GET' && url.pathname === '/file') {
                const name = url.searchParams.get('name')
                const bytes = readFileSync(chatInbox.inboxFilePath(name))
                res.setHeader('Content-Type', chatInbox.contentTypeOf(name))
                return res.end(bytes)
              }
              res.setHeader('Content-Type', 'application/json')
              if (req.method === 'GET') return res.end(JSON.stringify({ items: chatInbox.listInbox(), bot: chatInbox.readChatStatus() }))
              if (req.method === 'POST' && url.pathname === '/done') {
                let body = ''
                req.on('data', chunk => {
                  body += chunk
                  if (body.length > 1024) req.destroy()
                })
                req.on('end', () => {
                  try {
                    res.end(JSON.stringify({ done: chatInbox.markInboxDone(JSON.parse(body).name) }))
                  } catch (error) {
                    res.statusCode = 400
                    res.end(JSON.stringify({ error: error.message }))
                  }
                })
                return
              }
              res.statusCode = 405
              res.end(JSON.stringify({ error: 'Use GET, or POST /done.' }))
            } catch (error) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: error.message }))
            }
          })
          // Today panel and the red problem banner (bot/today.js): what the bots did today and
          // what needs Daniel now, with the system check's rows folded in.
          server.middlewares.use('/api/today', async (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can read today\'s activity.' }))
            }
            let health = null
            try {
              const port = server.config.server.port || 5173
              const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) })
              if (response.ok) health = await response.json()
            } catch { /* no system check this time */ }
            let chatBot = null
            try { if (chatInbox.readChatConfig().enabled) chatBot = chatInbox.readChatStatus() } catch { /* off */ }
            try {
              res.end(JSON.stringify(readToday({ health, chatBot })))
            } catch (error) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: error.message }))
            }
          })
          // Problem banner click (Daniel 2026-11-27: "take me to exactly where the error is"):
          // POST /api/go { target } brings that bot's window to the front, opens the
          // upload-review folder, or starts the watchdog. Only these fixed targets.
          const goTargets = {
            upload: { profile: 'browser-profile', title: 'Landstar Bot' },
            helper: { profile: 'browser-profile-helper', title: 'Landstar Helper Bot' },
            removal: { profile: 'browser-profile-removal', title: 'Landstar Removal Bot' },
            rates: { profile: 'browser-profile-rates', title: 'Landstar Rate Worker' },
            refresh: { profile: 'browser-profile-refresh', title: 'Landstar Refresh Bot' },
            emailbot: { title: 'Landstar Email Bot' },
            chatbot: { profile: 'browser-profile-chat', title: 'Landstar Google Chat Bot' }
          }
          server.middlewares.use('/api/go', (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'Only the local TMS can open bot windows.' }))
            }
            if (req.method !== 'POST') {
              res.statusCode = 405
              return res.end(JSON.stringify({ error: 'Use POST.' }))
            }
            let body = ''
            req.on('data', chunk => {
              body += chunk
              if (body.length > 512) req.destroy()
            })
            req.on('end', () => {
              let target = ''
              try { target = String(JSON.parse(body).target || '') } catch { /* bad request below */ }
              const done = (status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)) }
              const run = (command, args, onExit) => {
                const child = spawn(command, args, { windowsHide: true })
                let out = ''
                child.stdout?.on('data', chunk => { out += chunk })
                child.on('error', error => done(500, { error: error.message }))
                child.on('exit', () => onExit(out.trim()))
              }
              if (target === 'review-folder') {
                const folder = path.join(os.homedir(), 'Downloads', 'landstar-upload-review')
                spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref()
                return done(200, { opened: 'folder' })
              }
              if (target === 'watchdog') {
                return run('schtasks.exe', ['/Run', '/TN', 'Landstar Watchdog Keeper'], () => done(200, { opened: 'watchdog' }))
              }
              const window = goTargets[target]
              if (!window) return done(400, { error: 'Unknown target' })
              run('powershell.exe', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(process.cwd(), 'bot', 'focus-window.ps1'),
                '-Profile', window.profile || '', '-Title', window.title || ''
              ], out => done(200, { opened: out === 'found' ? 'window' : '', found: out === 'found' }))
            })
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
              // Only the posting bot itself counts (another program can hold its address).
              upload: withSignIn('upload', postingBotFromStatus(upload)),
              helper: withSignIn('helper', readHelperStatus()),
              removal: withSignIn('removal', readRemovalStatus()),
              rates: withSignIn('rates', readRatesStatus()),
              emailBot: readEmailBotStatus(),
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

          // "Add teammate" (⚙ My Settings): the same handler as the website's /api/invite-user.
          server.middlewares.use('/api/invite-user', async (req, res) => {
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 4096) break
            }
            let parsed = {}
            try { parsed = JSON.parse(body || '{}') } catch { /* invalid JSON -> empty */ }
            try {
              const result = await processInviteRequest({
                method: req.method, authorization: req.headers.authorization, body: parsed, origin: req.headers.origin
              })
              res.statusCode = result.status
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(JSON.stringify(result.body))
            } catch (error) {
              console.error('Invite failed:', error.message)
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'The invite could not be sent.' }))
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

          // DAT load-board posting (api/_lib/datPosting.js). Local TMS only: it posts under
          // your DAT account. GET lists live postings; POST { action: 'post', postings } or
          // { action: 'remove', postingIds }. While this server runs, every posting is
          // reposted every DAT_REPOST_MINUTES and taken down when its pickup has passed.
          const datConfig = getDatPostingConfig()
          const datPostings = createDatPostingService({
            request: createDatRequest(datConfig),
            storePath: path.resolve(process.cwd(), 'bot', 'dat-postings.json')
          })
          const datConfigured = Boolean(datConfig.username && datConfig.password && datConfig.userUsername)
          if (globalThis.__datRefreshTimer) clearInterval(globalThis.__datRefreshTimer)
          if (datConfigured) {
            let reposting = false
            globalThis.__datRefreshTimer = setInterval(async () => {
              if (reposting) return
              reposting = true
              try {
                const summary = await datPostings.repostDue()
                if (summary.reposted || summary.removed || summary.failed.length) {
                  console.log(`DAT postings: ${summary.reposted} reposted, ${summary.removed} taken down${summary.failed.length ? `; failed: ${summary.failed.join('; ')}` : ''}`)
                }
              } catch (error) {
                console.error('DAT repost pass failed:', error.message)
              } finally {
                reposting = false
              }
            }, 30_000)
          }
          server.middlewares.use('/api/dat-post', async (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return send(403, { error: 'Only the local TMS can post to DAT.' })
            }
            if (!datConfigured) {
              return send(503, { error: 'DAT is not configured. Add DAT_USERNAME, DAT_PASSWORD and DAT_USER_USERNAME to .env.' })
            }
            if (req.method === 'GET') return send(200, { postings: datPostings.list(), repostMinutes: DAT_REPOST_MINUTES })
            if (req.method !== 'POST') return send(405, { error: 'Use GET or POST.' })
            let raw = ''
            for await (const chunk of req) {
              raw += chunk
              if (raw.length > 512_000) return send(413, { error: 'Too many loads in one DAT request.' })
            }
            let body
            try { body = JSON.parse(raw || '{}') } catch { return send(400, { error: 'The DAT request must be JSON.' }) }
            try {
              if (body.action === 'post' && Array.isArray(body.postings)) {
                const results = []
                for (const posting of body.postings.slice(0, 200)) results.push(await datPostings.post(posting))
                return send(200, { results })
              }
              if (body.action === 'remove' && Array.isArray(body.postingIds)) {
                const results = []
                for (const postingId of body.postingIds.slice(0, 200)) results.push(await datPostings.remove(postingId))
                return send(200, { results })
              }
              return send(400, { error: 'Unknown DAT action.' })
            } catch (error) {
              console.error('DAT posting request failed:', error)
              return send(502, { error: error.message || 'Could not reach DAT.' })
            }
          })
        }
      }
    ]
  }
})