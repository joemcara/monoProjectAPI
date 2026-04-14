function serviceAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const serviceToken = process.env.SERVICE_TOKEN;

  if (!authHeader || authHeader !== `Bearer ${serviceToken}`) {
    return res.status(401).json({ error: 'Invalid service token' });
  }
  next();
}

module.exports = serviceAuthMiddleware;
