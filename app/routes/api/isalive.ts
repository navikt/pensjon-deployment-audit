export async function loader() {
  // Simple liveness check - just return 200
  return new Response('OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
