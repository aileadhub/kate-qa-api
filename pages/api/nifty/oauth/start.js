const NIFTY_AUTH_URL = 'https://app.niftypm.com/oauth/authorize';

export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.NIFTY_CLIENT_ID,
    redirect_uri: process.env.NIFTY_REDIRECT_URI,
    response_type: 'code',
    scope: 'project_management',
  });
  res.redirect(`${NIFTY_AUTH_URL}?${params}`);
}
