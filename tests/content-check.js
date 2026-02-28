#!/usr/bin/env node
/**
 * Content completeness check for index.html
 *
 * Guards against auto-update scripts accidentally leaving sections empty
 * or removing required metadata. Exits with code 1 on any failure.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const root = parse(html);

let failures = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.error(`  ✗ ${description}`);
    failures++;
  }
}

// --- Metadata ---
console.log('\nMetadata:');
const title = root.querySelector('title');
check('<title> is present and non-empty', title && title.text.trim().length > 0);

const metaDesc = root.querySelector('meta[name="description"]');
check('<meta name="description"> has a non-empty content attribute',
  metaDesc && (metaDesc.getAttribute('content') || '').trim().length > 0);

const lang = root.querySelector('html[lang]');
check('<html> has a lang attribute', lang !== null);

// --- Jail status ---
console.log('\nJail Status section:');
const jailAnswer = root.querySelector('.jail-answer');
check('.jail-answer element exists', jailAnswer !== null);
check('.jail-answer text is non-empty', jailAnswer && jailAnswer.text.trim().length > 0);

// --- Impeachment Watch ---
console.log('\nImpeachment Watch section:');
const impeachmentSection = root.querySelector('.impeachment-section');
check('.impeachment-section exists', impeachmentSection !== null);
const impeachmentItems = root.querySelectorAll('.impeachment-item');
check('at least 1 .impeachment-item present', impeachmentItems.length >= 1);
impeachmentItems.forEach((item, i) => {
  const link = item.querySelector('a');
  check(`  impeachment-item[${i}] has a non-empty link`, link && link.text.trim().length > 0);
  check(`  impeachment-item[${i}] link has href`, link && (link.getAttribute('href') || '').trim().length > 0);
});

// --- Reddit posts ---
console.log('\nReddit section:');
const redditPosts = root.querySelectorAll('.reddit-post');
check('at least 1 .reddit-post present', redditPosts.length >= 1);
redditPosts.forEach((post, i) => {
  const link = post.querySelector('a');
  check(`  reddit-post[${i}] has a non-empty link`, link && link.text.trim().length > 0);
  check(`  reddit-post[${i}] link has href`, link && (link.getAttribute('href') || '').trim().length > 0);
});

// --- News items ---
console.log('\nLatest News section:');
const newsItems = root.querySelectorAll('.news-item');
check('at least 1 .news-item present', newsItems.length >= 1);
newsItems.forEach((item, i) => {
  const link = item.querySelector('a');
  check(`  news-item[${i}] has a non-empty link`, link && link.text.trim().length > 0);
  check(`  news-item[${i}] link has href`, link && (link.getAttribute('href') || '').trim().length > 0);
});

// --- Deep Dive links ---
console.log('\nDeep Dive section:');
const deepdiveLinks = root.querySelectorAll('.deepdive-link');
check('at least 1 .deepdive-link present', deepdiveLinks.length >= 1);
deepdiveLinks.forEach((link, i) => {
  check(`  deepdive-link[${i}] has href`, (link.getAttribute('href') || '').trim().length > 0);
  check(`  deepdive-link[${i}] has non-empty text`, link.text.trim().length > 0);
});

// --- Footer ---
console.log('\nFooter:');
const lastUpdated = root.querySelector('.last-updated');
check('.last-updated element exists and is non-empty', lastUpdated && lastUpdated.text.trim().length > 0);

const githubLink = root.querySelector('footer a[href*="github.com"]');
check('GitHub link present in footer', githubLink !== null);

// --- Summary ---
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures > 0 ? 1 : 0);
