import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './config/db.js'
import { ensureSeedData } from './utils/seedData.js'
import authRoutes from './routes/auth.js'
import buyerRoutes from './routes/buyers.js'
import campaignRoutes from './routes/campaigns.js'
import blockedRoutes from './routes/blockedContacts.js'
import dashboardRoutes from './routes/dashboard.js'
import callRoutes from './routes/calls.js'
import activityLogRoutes from './routes/activityLogs.js'
import didRoutes from './routes/dids.js'
import customerRoutes from './routes/customers.js'

const app = express()
const PORT = process.env.PORT || 5000

const corsOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(cors({ origin: corsOrigins, credentials: true }))
app.use(express.json())

let ready = connectDB().then(async () => {
  await ensureSeedData()
})

app.use(async (_req, _res, next) => {
  try {
    await ready
    next()
  } catch (err) {
    next(err)
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tellimon-backend' })
})

app.use('/api/auth', authRoutes)
app.use('/api/buyers', buyerRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/blocked-contacts', blockedRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/calls', callRoutes)
app.use('/api/activity-logs', activityLogRoutes)
app.use('/api/dids', didRoutes)
app.use('/api/customers', customerRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

if (!process.env.VERCEL) {
  ready.then(() => {
    app.listen(PORT, () => {
      console.log(`Tellimon API running on http://localhost:${PORT}`)
    })
  })
}

export default app
