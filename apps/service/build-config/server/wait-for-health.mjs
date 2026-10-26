export const waitForHealth = async(origin, { timeoutMs = 30_000, intervalMs = 100 } = {}) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/v1/health`)).ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw lastError ?? new Error(`Service did not become healthy within ${timeoutMs}ms`)
}
