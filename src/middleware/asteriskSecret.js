export function asteriskSecretRequired(req, res, next) {
  const secret = process.env.ASTERISK_WEBHOOK_SECRET
  if (!secret) return next()

  const header = req.headers['x-asterisk-secret']
  if (header !== secret) {
    return res.status(401).json({ error: 'Invalid asterisk secret' })
  }
  next()
}
