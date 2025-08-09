import fs from 'fs'
import path from 'path'
import readline from 'readline'
import {google} from  'googleapis'
import { TOKEN_PATH, CLIENT_SECRET_PATH, SCOPES } from './config.js'

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.dirname(TOKEN_PATH);
  try {
    await fs.promises.access(dataDir);
  } catch (err) {
    await fs.promises.mkdir(dataDir, { recursive: true });
  }
}

// Load client secrets from a local file.
// fs.readFile('client_secret.json', (err, content) => {
//   if (err) return console.log('Error loading client secret file:', err);
//   authorize(JSON.parse(content), showAuth);
// });

async function getCredentials(customRedirectUri = null) {
  const content = await fs.promises.readFile(CLIENT_SECRET_PATH);
  const credentials = JSON.parse(content);
  // Support both 'web' and 'installed' OAuth2 client types
  const clientInfo = credentials.web || credentials.installed;
  if (!clientInfo) {
    throw new Error('Invalid client_secret.json: missing "web" or "installed" property');
  }
  const {client_secret, client_id, redirect_uris} = clientInfo;
  // Use custom redirect URI if provided, otherwise use first configured URI
  // This prevents OOB flow issues as per Google's migration guide
  const redirectUri = customRedirectUri || redirect_uris[0];
  if (!redirectUri) {
    throw new Error('No redirect URI available. Check client_secret.json configuration.');
  }
  return new google.auth.OAuth2(
    client_id, client_secret, redirectUri);
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  // Support both 'web' and 'installed' OAuth2 client types
  const clientInfo = credentials.web || credentials.installed;
  const {client_secret, client_id, redirect_uris} = clientInfo;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, async (err, token) => {
      if (err) return callback(err);
      oAuth2Client.setCredentials(token.tokens);
      // Store the token to disk for later program executions
      try {
        await ensureDataDirectory();
        await fs.promises.writeFile(TOKEN_PATH, JSON.stringify(token));
        console.log('Token stored to', TOKEN_PATH);
      } catch (writeErr) {
        console.error(writeErr);
      }
      callback(oAuth2Client);
    });
  });
}

function showAuth(auth) {
  // console.log(auth)
}

export function getTokenPath() {
  return TOKEN_PATH;
}

export default async function askNewToken(redirectUri = null) {
  const oAuth2Client = await getCredentials(redirectUri);
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  return {
    authUrl,
    callback: async (code) => {
      const token = (await oAuth2Client.getToken(code)).tokens;
      oAuth2Client.setCredentials(token);
      await ensureDataDirectory();
      await fs.promises.writeFile(TOKEN_PATH, JSON.stringify(token));
      return oAuth2Client;
    }
  }
}
