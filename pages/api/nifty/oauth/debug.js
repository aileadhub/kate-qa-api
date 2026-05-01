export default function handler(req, res) {
  res.status(200).send(`
    <h2>Nifty OAuth Debug</h2>
    <pre>${JSON.stringify(req.query, null, 2)}</pre>
    <p>If you see a "code" above, the OAuth flow worked and Nifty called back successfully.</p>
  `);
}
