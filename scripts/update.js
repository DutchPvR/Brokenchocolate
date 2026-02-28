#!/usr/bin/env node
/**
 * Auto-update script for brokenchocolate.com
 *
 * Fetches the latest hot posts from r/Epstein, Epstein news, and
 * Trump impeachment news, then writes them into index.html and
 * updates the "Last updated" timestamp.
 *
 * Usage:
 *   node scripts/update.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'brokenchocolate-updater/1.0 (https://github.com/DutchPvR/Brokenchocolate)',
        ...headers,
      },
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Request timed out')));
  });
}

// ---------------------------------------------------------------------------
// HTML encoding helpers
// ---------------------------------------------------------------------------

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function encodeText(str) {
  return decodeEntities(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function encodeAttr(str) {
  return decodeEntities(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Feed parsers
// ---------------------------------------------------------------------------

// Parses Reddit's Atom feed (uses <entry> + <link href="..."/>).
function parseAtomEntries(xml, maxItems) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const titleMatch =
      block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
    const url = linkMatch ? linkMatch[1].trim() : '';
    if (title && url) {
      items.push({ title, url });
    }
  }
  return items;
}

function parseRSSItems(xml, maxItems) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];

    const titleMatch =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
    const link = linkMatch ? linkMatch[1].trim() : '';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const source = sourceMatch ? decodeEntities(sourceMatch[1].trim()) : '';

    if (title && link) {
      items.push({ title, link, pubDate, source });
    }
  }
  return items;
}

function formatDate(pubDate) {
  if (!pubDate) return '';
  try {
    return new Date(pubDate).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------------

function normalizeTitle(title) {
  return title.trim().toLowerCase();
}

// Read the anchor text of every matching element already on the page.
function getExistingTitles(root, itemSelector) {
  return new Set(
    root.querySelectorAll(`${itemSelector} a`)
      .map((el) => normalizeTitle(el.text))
      .filter(Boolean)
  );
}

// Remove duplicate titles within a single batch of items.
function deduplicateWithinBatch(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchRedditPosts() {
  const rss = await get('https://www.reddit.com/r/Epstein/hot.rss');
  return parseAtomEntries(rss, 5);
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const rss = await get(url);
  // Fetch more than needed so deduplication has room to filter.
  return parseRSSItems(rss, 15);
}

// ---------------------------------------------------------------------------
// HTML renderers
// ---------------------------------------------------------------------------

function renderRedditPost(post) {
  return `
            <div class="reddit-post">
                <a href="${encodeAttr(post.url)}" target="_blank" rel="noopener">
                    <span class="post-title">${encodeText(post.title)}</span>
                </a>
            </div>`;
}

function renderNewsItem(item, cssClass = 'news-item') {
  const dateStr = formatDate(item.pubDate);
  const source = item.source ? encodeText(item.source) : '';
  const meta = [source, dateStr].filter(Boolean).join(' • ');
  return `
            <div class="${cssClass}">
                <a href="${encodeAttr(item.link)}" target="_blank" rel="noopener">
                    ${encodeText(item.title)}
                </a>
                <div class="news-source">${meta}</div>
            </div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const htmlPath = path.resolve(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const root = parse(html, { comment: true });

  let anyUpdate = false;

  // Reddit posts
  try {
    process.stdout.write('Fetching r/Epstein hot posts... ');
    const posts = await fetchRedditPosts();
    const container = root.querySelector('.reddit-posts');
    if (container && posts.length > 0) {
      container.innerHTML = posts.map(renderRedditPost).join('') + '\n        ';
      anyUpdate = true;
      console.log(`${posts.length} posts fetched.`);
    }
  } catch (err) {
    console.log(`SKIPPED (${err.message})`);
  }

  // Epstein news
  try {
    process.stdout.write('Fetching Epstein news... ');
    const fetched = await fetchGoogleNews('Epstein');
    const existingTitles = getExistingTitles(root, '.news-item');
    const items = deduplicateWithinBatch(fetched)
      .filter((i) => !existingTitles.has(normalizeTitle(i.title)))
      .slice(0, 5);
    const container = root.querySelector('.news-items');
    if (container && items.length > 0) {
      container.innerHTML = items.map((i) => renderNewsItem(i, 'news-item')).join('') + '\n            ';
      anyUpdate = true;
      console.log(`${items.length} new articles (${fetched.length - items.length} duplicates skipped).`);
    } else {
      console.log('SKIPPED (no new articles).');
    }
  } catch (err) {
    console.log(`SKIPPED (${err.message})`);
  }

  // Impeachment news
  try {
    process.stdout.write('Fetching impeachment news... ');
    const fetched = await fetchGoogleNews('Trump impeachment');
    const existingTitles = getExistingTitles(root, '.impeachment-item');
    const items = deduplicateWithinBatch(fetched)
      .filter((i) => !existingTitles.has(normalizeTitle(i.title)))
      .slice(0, 2);
    const section = root.querySelector('.impeachment-section');
    if (section && items.length > 0) {
      const h2 = section.querySelector('h2');
      section.innerHTML =
        '\n            ' + h2.outerHTML + '\n' +
        items.map((i) => renderNewsItem(i, 'impeachment-item')).join('') + '\n        ';
      anyUpdate = true;
      console.log(`${items.length} new articles (${fetched.length - items.length} duplicates skipped).`);
    } else {
      console.log('SKIPPED (no new articles).');
    }
  } catch (err) {
    console.log(`SKIPPED (${err.message})`);
  }

  // Timestamp
  if (anyUpdate) {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    const time = now.toISOString().slice(11, 16);
    const lastUpdated = root.querySelector('.last-updated');
    if (lastUpdated) {
      lastUpdated.innerHTML = `Last updated: ${date} • ${time} UTC`;
    }
    fs.writeFileSync(htmlPath, root.toString());
    console.log('index.html written.');
  } else {
    console.log('No updates applied — index.html unchanged.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
