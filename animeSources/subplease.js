import fetch from 'node-fetch'

export async function fetchAnimeList(url) {
  const animePage = await fetch(url);
  const animePageBody = await animePage.text();
  const animeId = animePageBody.match(/ sid="([0-9]+)"/)[1];

  const apiPage = await fetch(`https://subsplease.org/api/?f=show&tz=Asia/Tokyo&sid=${animeId}`);
  const apiData = await apiPage.json();

  const eps = Object.keys(apiData.episode).map((ep) => apiData.episode[ep].downloads[apiData.episode[ep].downloads.length - 1]["magnet"]).reverse();

  return {eps, resolver};
}

export function match(url) {
  return url.indexOf("https://subsplease.org") == 0;
}

async function resolver(url) {
  return url;
}
