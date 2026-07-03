import express from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import { signToken, authRequired } from '../middleware/auth.js'
import { toJSON } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

function publicUser(user) {
  const u = toJSON(user)
  delete u.password
  return u
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const normalized = email.trim().toLowerCase()
    let user = await User.findOne({
      $or: [{ email: normalized }, { email: normalized === 'demo' ? 'demo@tellimon.com' : normalized }],
    })

    if (!user && normalized === 'demo') {
      user = await User.findOne({ email: 'demo@tellimon.com' })
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = signToken(user._id)

    await logActivity(user._id, {
      action: 'login',
      category: 'auth',
      description: `${user.name || user.email} signed in`,
      actorName: user.name || user.email,
    })

    res.json({ token, user: publicUser(user) })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.authUserId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ user: publicUser(user) })
  } catch (err) {
    console.error('Me error:', err)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

export default router
