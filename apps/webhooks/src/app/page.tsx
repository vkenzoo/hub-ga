export default function Page() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Hub Webhooks</h1>
      <p>Endpoints disponíveis:</p>
      <ul>
        <li><code>POST /api/webhooks/assiny</code></li>
        <li><code>POST /api/webhooks/hotmart</code></li>
        <li><code>GET /api/health</code></li>
      </ul>
    </main>
  );
}
