import fetch from 'node-fetch'

export async function fetchAnimeList(url) {
  const data = await fetch(`${url}/?sort=ep&dir=Ascending`);
  const body = await data.text();
  const eps = [...body.matchAll(/https?:\/\/(www\.)?tokyotosho\.info\/details\.php\?id=[0-9]+/g)].map(ep => ep[0]);

  return {eps, resolver};
}

export function match(url) {
  return url.indexOf("https://www.shanaproject.com/") == 0;
}

async function resolver(url) {
  const data = await fetch(url);
  const body = await data.text();
  const magnetLink = body.match(/magnet:[^"]+/)[0];

  if (!magnetLink) {
    throw `Can't fetch from ${tokyotoshoUrl}`;
  }

  return magnetLink;
}
