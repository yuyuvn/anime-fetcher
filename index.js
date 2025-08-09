// Environment Variables:
// PORT - Server port (default: 5321)
// DOMAIN - Base domain for OAuth redirects (default: http://localhost:${PORT})
// TOKEN_PATH - Path to store OAuth token (default: data/token.json)

// BitTorrent Client: Uses qBittorrent Web API v2
// Requires qBittorrent with Web UI enabled
// Default qBittorrent WebUI: http://localhost:8080
import express from 'express'
import { google } from 'googleapis'
import fs from 'fs/promises'
import bodyParser from 'body-parser'
import askNewToken, { getTokenPath } from './getToken.js'
import animeSources from './animeSources/index.js'
import sslRootCas from 'ssl-root-cas'
import { QBittorrent } from '@ctrl/qbittorrent';
import { PORT, DOMAIN, CLIENT_SECRET_PATH } from './config.js'

sslRootCas.inject();

const app = express()
const jsonParser = bodyParser.json()
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
let authCallback = (code) => null;

/**
 * Login to qBittorrent using the Web API v2
 * This replaces the old uTorrent token-based authentication
 * @param {string} qbittorrentUrl - Base URL of qBittorrent WebUI (e.g., http://localhost:8080)
 * @param {string} auth - Username:password format
 * @returns {Promise<{cookie: string}>} Session cookie for authenticated requests
 */
async function loginToBitTorrent(qbittorrentUrl, auth) {
  const [username, password] = auth.split(':');
  
  console.log(`Logging in to qBittorrent: ${qbittorrentUrl} with username: ${username}`);
  const client = new QBittorrent({
    baseUrl: qbittorrentUrl,
    username: username,
    password: password,
  });

  return client;
}

/**
 * Add a torrent to qBittorrent using magnet URL
 * This replaces the old uTorrent add-url action
 * @param {string} magnet - Magnet URL of the torrent
 * @param {Object} options - Options containing cookie and qBittorrent URL
 * @returns {Promise<void>}
 */
async function addTorrent(magnet, options) {
  console.log(`Adding torrent: ${magnet}`);
  
  const client = options.client;
  await client.normalizedAddTorrent(magnet);

  console.log(`Torrent added successfully: ${magnet}`);
}

async function getNewEpisode(url, current, options) {
  url = url.replace(/\?.*$/, '').replace(/\/$/, '');
  console.log(`Get anime ${url}`);

  let animeEps, animeResolver;

  for (let index in animeSources) {
    if (animeSources[index].match(url)) {
      const { eps, resolver } = await animeSources[index].fetchAnimeList(url);
      animeEps = eps;
      animeResolver = resolver;
      break;
    }
  }

  if (!animeEps) {
    throw `This source is not supported! ${url}`
  }

  console.log(`Found ${animeEps.length} episodes for ${url}`)

  await Promise.all(animeEps.map(async (episodeData, episode) => {
    if (episode < current) return Promise.resolve();

    const magnetLink = await animeResolver(episodeData);
    return addTorrent(magnetLink, options);
  }))

  return animeEps.length;
}


async function loadGoogleApi() {
  const clientSecretContent = await fs.readFile(CLIENT_SECRET_PATH);

  const credentials = JSON.parse(clientSecretContent)
  // Support both 'web' and 'installed' OAuth2 client types
  const clientInfo = credentials.web;
  if (!clientInfo) {
    throw new Error('Invalid client_secret.json: missing "web"');
  }
  const { client_secret, client_id, redirect_uris } = clientInfo
  const redirectUri = `${DOMAIN}/auth/callback`;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  const tokenPath = getTokenPath();
  const credentialsContent = await fs.readFile(tokenPath);
  const token = JSON.parse(credentialsContent);
  oAuth2Client.setCredentials(token)
  return oAuth2Client;
}

app.post('/fetch/:spreadsheetsId', jsonParser, async (req, res) => {
  try {
    const oAuth2Client = await loadGoogleApi();
    const qbittorrentUrl = req.body.qbittorrent_url || req.body.bittorrent_url; // Support both for backward compatibility
    const auth = req.body.auth;
    if (!qbittorrentUrl) throw "qbittorrent_url (or bittorrent_url) is required";
    if (!auth) throw "auth is required. Format: username:password";

    const client = await loginToBitTorrent(qbittorrentUrl, auth)
    const sheets = google.sheets({ version: 'v4', auth: oAuth2Client })
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: req.params.spreadsheetsId,
      range: 'Ongoing!A2:B',
    })

    const rows = data.values;

    if (rows.length == 0) return;

    const getAllEpisode = []
    rows.forEach((row) => {
      if (row.length < 2) return;

      getAllEpisode.push(getNewEpisode(row[0], row[1], { bittorrentUrl: qbittorrentUrl, client }).then((lastest) => {
        row[1] = lastest
      }))
    })

    await Promise.all(getAllEpisode);

    await sheets.spreadsheets.values.update({
      spreadsheetId: req.params.spreadsheetsId,
      range: 'Ongoing!A2:B',
      valueInputOption: 'RAW',
      resource: {
        values: rows
      }
    })
    res.send("OK!")
  } catch (e) {
    console.error(e)
    res.send(e.toString())
  }
})

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Anime Fetcher</title></head>
      <body>
        <h1>Welcome to Anime Fetcher</h1>
        <p>
          To get started, please <a href="/login">login with Google</a> to authorize access to your Google Sheets.
        </p>
        <p>
          <strong>First time setup?</strong><br>
          You must create a Google OAuth 2.0 Web Client and set the correct redirect URI.<br>
          Go to <a href="https://console.cloud.google.com/auth/clients" target="_blank">https://console.cloud.google.com/auth/clients</a> and create a <b>Web application</b> OAuth client.<br>
          Add the following as an authorized redirect URI:<br>
          <code>${DOMAIN}/auth/callback</code><br>
          Download the <code>client_secret.json</code> and place it in <code>${CLIENT_SECRET_PATH}</code> folder.
        </p>
      </body>
    </html>
  `);
})

// OAuth callback route that Google will redirect to
app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Authorization code not provided');
    }

    if (authCallback) {
      const oAuth2Client = await authCallback(code);
      if (oAuth2Client) {
        const tokenPath = getTokenPath();
        res.send(`
          <html>
            <head><title>Authorization Successful</title></head>
            <body>
              <h1>✅ Authorization successful!</h1>
              <p>The Google OAuth token has been stored to <code>${tokenPath}</code></p>
              <p>You can now close this window and use the application.</p>
            </body>
          </html>
        `);
      } else {
        res.status(500).send('Failed to process authorization');
      }
    } else {
      res.status(400).send('No active authorization request. Please start the login process first.');
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`Authorization failed: ${error.message}`);
  }
});

app.get('/login', async (_, res) => {
  try {
    const redirectUri = `${DOMAIN}/auth/callback`;
    console.log(`Using redirect URI: ${redirectUri}`);
    
    // Validate redirect URI against client_secret.json to prevent OOB issues
    const clientSecretContent = await fs.readFile(CLIENT_SECRET_PATH);
    const credentials = JSON.parse(clientSecretContent);
    const clientInfo = credentials.web || credentials.installed;
    const configuredRedirectUris = clientInfo?.redirect_uris || [];
    
    if (!configuredRedirectUris.includes(redirectUri)) {
      console.warn(`Warning: Redirect URI ${redirectUri} not found in ${CLIENT_SECRET_PATH}`);
      console.warn(`Configured redirect URIs: ${configuredRedirectUris.join(', ')}`);
      return res.status(500).send(`
        <html>
          <head><title>OAuth Configuration Error</title></head>
          <body>
            <h1>❌ OAuth Configuration Mismatch</h1>
            <p><strong>Error:</strong> The redirect URI doesn't match your Google OAuth configuration.</p>
            <p><strong>Current redirect URI:</strong> <code>${redirectUri}</code></p>
            <p><strong>Configured redirect URIs in client_secret.json:</strong></p>
            <ul>
              ${configuredRedirectUris.map(uri => `<li><code>${uri}</code></li>`).join('')}
            </ul>
            <p><strong>Solution:</strong> Either:</p>
            <ol>
              <li>Update your Google OAuth client configuration to include <code>${redirectUri}</code>, or</li>
              <li>Set the DOMAIN environment variable to match one of the configured URIs</li>
            </ol>
            <p>See <a href="https://developers.google.com/identity/protocols/oauth2/resources/oob-migration" target="_blank">Google's OOB migration guide</a> for more details.</p>
          </body>
        </html>
      `);
    }
    
    const { authUrl, callback } = await askNewToken(redirectUri);
    authCallback = callback;
    res.send(`
      <html>
        <head><title>Google OAuth Login</title></head>
        <body>
          <h1>Google OAuth Authorization</h1>
          <p>Click the link below to authorize this application:</p>
          <p><a href="${authUrl}" target="_blank">🔗 Authorize with Google</a></p>
          <p><strong>Note:</strong> Make sure your Google OAuth app is configured with the redirect URI: <code>${redirectUri}</code></p>
          <hr>
          <h3>Manual Code Entry (if redirect doesn't work):</h3>
          <form method="post">
            <label>If the automatic redirect doesn't work, you can manually enter the authorization code here:</label><br>
            <input type="text" id="code" name="code" placeholder="Enter authorization code" style="width: 400px; margin: 10px 0;">
            <br>
            <input type="submit" value="Submit Code">
          </form>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send(`Login failed: ${error.message}`);
  }
})

app.use(bodyParser.urlencoded({ extended: true }));
app.post('/login', async (req, res) => {
  const oAuth2Client = await authCallback(req.body.code);
  if (oAuth2Client) res.send("Login done!");
  else res.send("Nothing to do");
})

app.listen(PORT, "0.0.0.0", () => console.log(`Server is running on http://localhost:${PORT}`))
