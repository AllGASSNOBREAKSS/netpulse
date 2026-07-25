const response = await fetch("http://127.0.0.1:8080/v1/health", { signal: AbortSignal.timeout(1500) });
if (!response.ok) process.exit(1);
const health = await response.json();
if (health.status !== "healthy" && health.status !== "degraded") process.exit(1);
