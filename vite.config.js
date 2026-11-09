import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { processRoadMilesRequest } from './api/road-miles.js'
import { processDatRateRequest, getDatConfig } from './api/dat-rate.js'
import { handleParamountEmail } from './api/_lib/gmailThread.js'
import { getServiceClient } from './api/_lib/server.js'
import { extractProspects, isBlockedProspect } from './src/lib/prospects.js'

// The TMS account that owns imported prospects, looked up once per server run.
let prospectOwnerId = null

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
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the bot from the TMS only works on Windows.' })
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
              const result = await handleParamountEmail(JSON.parse(body || '{}'))
              reply(result.status, result.body)
            } catch (error) {
              console.error('Paramount email request failed:', error.message)
              reply(502, { error: error.message || 'The Gmail request failed.' })
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
              ).select('id')
              if (error) throw error
              reply(200, { saved: (data || []).length, skipped: found.length - (data || []).length })
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