const PORT = process.env.PORT || 5321
import express from 'express'
import fetch from 'node-fetch'
import {google} from 'googleapis'
import fs from 'fs/promises'
import bodyParser from 'body-parser'
import askNewToken from './getToken.js'
import {parseCookies} from './utils.js'
import animeSources from './animeSources/index.js'

const app = express()
const jsonParser = bodyParser.json()
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
let authCallback = (code) => null;

async function getToken(bittorrentUrl) {
  const data = await fetch(`${bittorrentUrl}/gui/token.html`);
  const body = await data.text();
  return {token: body.replace(/<.*?>/g, ''), cookie: parseCookies(data)};
}

async function fetchTorrent(magnet, options) {
  console.log(`Fetching ${magnet}`);
  await fetch(`${options.bittorrentUrl}/gui/?token=${options.token}&action=add-url&s=${encodeURIComponent(magnet)}`,
    {
      'headers': {
        'accept': '*/*',
        'cookie': options.cookie,
      }
    }
  );
}

async function getNewEpisode(url, current, options) {
  url = url.replace(/\?.*$/, '').replace(/\/$/, '');
  console.log(`Get anime ${url}`);

  let animeEps, animeResolver;

  for (let index in animeSources) {
    if (animeSources[index].match(url)) {
      const {eps, resolver} = await animeSources[index].fetchAnimeList(url);
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
    return fetchTorrent(magnetLink, options);
  }))

  return animeEps.length;
}


async function loadGoogleApi() {
  const clientSecretContent = await fs.readFile('client_secret.json');

  const credentials = JSON.parse(clientSecretContent)
  const {client_secret, client_id, redirect_uris} = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  const credentialsContent = await fs.readFile('credentials.json');
  const token = JSON.parse(credentialsContent);
  oAuth2Client.setCredentials(token)
  return oAuth2Client;
}

app.post('/fetch/:spreadsheetsId', jsonParser, async (req, res) => {
  try {
    const oAuth2Client = await loadGoogleApi();
    const bittorrentUrl = req.body.bittorrent_url;
    if (!bittorrentUrl) throw "bittorrent_url is required";

    const {token, cookie} = await getToken(bittorrentUrl);
    const sheets = google.sheets({version: 'v4', auth: oAuth2Client})
    const {data} = await sheets.spreadsheets.values.get({
      spreadsheetId: req.params.spreadsheetsId,
      range: 'Ongoing!A2:B',
    })

    const rows = data.values;

    if (rows.length == 0) return;

    const getAllEpisode = []
    rows.forEach((row) => {
      if (row.length < 2) return;

      getAllEpisode.push(getNewEpisode(row[0], row[1], {token, cookie, bittorrentUrl}).then((lastest) => {
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
  } catch(e) {
    console.error(e)
    res.send(e.toString())
  }
})

app.get('/login', async (_, res) => {
  const {authUrl, callback} = await askNewToken();
  authCallback = callback;
  res.send(`<form method="post"><label>Please go to this <a target="_blank" href="${authUrl}">link</a></label><br><input type="text" id="code" name="code" value=""> <input type="submit" value="Submit"></form>`);
})

app.use(bodyParser.urlencoded({ extended: true }));
app.post('/login', async (req, res) => {
  const oAuth2Client = await authCallback(req.body.code);
  if (oAuth2Client) res.send("Login done!");
  else res.send("Nothing to do");
})

app.listen(PORT,"0.0.0.0", () => console.log(`Server is running on http://localhost:${PORT}`))
