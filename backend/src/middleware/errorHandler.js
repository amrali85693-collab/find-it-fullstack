// Centralized error handler. Never leak stack traces or raw DB errors
// (which can reveal schema/query details) to the client.
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

function errorHandler(err, req, res, next) {
  console.error(err); // server-side log only

  if (err.code === '23505') { // unique_violation
    return res.status(409).json({ error: 'That record already exists.' });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'Related record not found.' });
  }

  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Something went wrong. Please try again.';
  res.status(status).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
