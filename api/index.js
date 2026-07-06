// Placeholder function — replaced at deploy time by the bundled CJS handler
// produced by apps/api/scripts/build-vercel.mjs (see vercel.json buildCommand).
module.exports = (req, res) => {
  res.statusCode = 500;
  res.end('EstimatorPro API: build step did not run.');
};
module.exports.config = { runtime: 'nodejs' };