const fetch = require('node-fetch');
const parser = require('rss-url-parser');
const fs = require('fs-extra');
const waitForThrowable = require('wait-for-throwable');

const EXIFTOOL_RSS = 'https://sourceforge.net/projects/exiftool/rss?path=/';

const retry = async (func) => await waitForThrowable(func, { interval: 1000, total: Infinity, count: 10 });

const fetchOk = async (url) => {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Wget/1.17.1'
    }
  });

  if (!res.ok) {
    throw new Error(`"${url}" failed with ${res.status} ${res.statusText}`);
  }

  return await res.buffer();
};

const fetchJson = async (url) => {
  const res = await fetch(url);
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`"${url}" failed with ${res.status} ${res.statusText}\n${body}`);
  }

  return JSON.parse(body);
};

const getRssFiles = async () => {
  const items = await parser(EXIFTOOL_RSS);
  const files = [];

  for (let { title, link } of items) {
    if (!title || !link) {
      continue;
    }

    const name = title.replace(/^\//, '');

    files.push({ name, link });
  }

  return files;
};

const getExistingReleaseFiles = async () => {
  const API_ROOT = 'https://api.github.com/repos/catdad-experiments/exiftool-release';

  const { id } = await fetchJson(`${API_ROOT}/releases/tags/all`);

  const assets = [];
  let page = 0;
  let fetchedAll = false;

  while (!fetchedAll) {
    const pageData = await fetchJson(`${API_ROOT}/releases/${id}/assets?page=${++page}&per_page=50`);

    if (pageData.length) {
      assets.push(...pageData);
    } else {
      fetchedAll = true;
    }
  }

  return assets.map(({ name }) => name);
};

const start = Date.now();

(async () => {
  const githubFiles = await getExistingReleaseFiles();
  const rssFiles = await retry(() => getRssFiles());

  const filesToUpload = rssFiles.filter(({ name }) => !githubFiles.includes(name));

  console.log(`found ${githubFiles.length} already mirrored in releases`);
  console.log(`found ${filesToUpload.length} new files:`, filesToUpload);

  await fs.ensureDir('./dist');

  for (const { name, link } of filesToUpload) {
    console.log(`getting "${name}" from ${link}`);

    const body = await retry(() => fetchOk(link));

    await fs.outputFile(`./dist/${name}`, body);
  }
})().then(() => {
  console.log(`finished in ${Date.now() - start}ms`);
}).catch(err => {
  process.exitCode = 1;
  console.error(err);
  console.error(`failed in ${Date.now() - start}ms`);
});

