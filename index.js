const PORT = process.env.PORT || 5321
const SPREADSHEETS_ID = process.env.SPREADSHEETS_ID
const BITTORRENT_URL = process.env.BITTORRENT_URL
const express = require('express')
const app = express()
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const request = require('request-promise').defaults({jar: true})
const HorribleSubsApi = require('horriblesubs-api')
const {google} = require('googleapis')
const fs = require('fs')

const horriblesubs = new HorribleSubsApi({})

async function getToken() {
  return request(`${BITTORRENT_URL}/gui/token.html`).then(data => Promise.resolve(data.replace(/<.*?>/g, '')))
}

async function fetchTorrent(magnet, token) {
  return request(`${BITTORRENT_URL}/gui/?token=${token}&action=add-url&s=${encodeURIComponent(magnet)}`)
}

async function getNewEpisode(url, current, token) {
  const animeSluck = url.match(/[^\/]+$/)[0]
  const res = await horriblesubs.getAnimeData({link: `/shows/${animeSluck}`, slug: animeSluck, title: 'hogehoge'})
  const eps = res.episodes['1']
  Object.keys(eps).forEach(episode => {
    let marget = eps[episode]['1080p'] && eps[episode]['1080p'].url
    marget = marget || (eps[episode]['720p'] && eps[episode]['720p'].url)
    if (marget && parseFloat(episode) > current) fetchTorrent(marget, token)
  })
  return Promise.resolve(parseFloat(Object.keys(eps).unshift()))
}

async function loadGoogleApi() {
  return new Promise((resolve, reject) => {
    fs.readFile('client_secret.json', (err, content) => {
      if (err) return reject('Error loading client secret file:', err)
      credentials = JSON.parse(content)
      const {client_secret, client_id, redirect_uris} = credentials.installed
      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])
      oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
      });
      fs.readFile('credentials.json', (err, content) => {
        if (err) return reject('Error loading client secret file:', err)
        token = JSON.parse(content)
        oAuth2Client.setCredentials(token)
        resolve(oAuth2Client)
      })
    })
  })
}

app.post('/fetch', async (req, res) => {
  try {
    const oAuth2Client = await loadGoogleApi()
    const token = await getToken()
    const sheets = google.sheets({version: 'v4', auth: oAuth2Client})
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEETS_ID,
      range: 'Ongoing!A2:B',
    }, (err, {data}) => {
      if (err) return console.log('The API returned an error: ' + err)
      const rows = data.values
      if (rows.length) {
        const getAllEpisode = []
        rows.forEach((row) => {
          getAllEpisode.push(getNewEpisode(row[0], row[1], token).then((lastest) => {
            row[1] = lastest
          }))
        })
        Promise.all(getAllEpisode).then(() => {
          sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEETS_ID,
            range: 'Ongoing!A2:B',
            valueInputOption: 'RAW',
            resource: {
              values: rows
            }
          }, (err, response) => {
            if (err) return console.log('The API returned an error: ' + err)
            res.send("Done!")
          })
        })
      } else {
        console.log('No data found.')
      }
    })
  } catch {(e) => {
    console.error(e)
  }}
})

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`))
