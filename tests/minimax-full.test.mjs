import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FULL_VOICE,
  buildFullAudioJobs,
  extractPhrasebook,
  generateFullAudio,
  patchFullPhrasebook,
} from '../scripts/minimax-full.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

test('extractPhrasebook reads exactly 100 ordered English phrases from the live guide', async () => {
  const html = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  const phrases = extractPhrasebook(html);

  assert.equal(phrases.length, 100);
  assert.equal(phrases[0].en, 'Where is the check-in counter?');
  assert.equal(phrases[99].en, 'Is this item legal to take out of Korea?');
  assert.ok(phrases.every((phrase) => phrase.zh && phrase.en && phrase.ko));
});

test('buildFullAudioJobs gives every phrase a stable numbered MP3 path', () => {
  const phrases = Array.from({ length: 100 }, (_, index) => ({
    zh: `中文${index + 1}`,
    en: `English ${index + 1}`,
    ko: `한국어${index + 1}`,
  }));
  const jobs = buildFullAudioJobs(phrases);

  assert.equal(FULL_VOICE.id, 'English_Trustworthy_Man');
  assert.equal(jobs.length, 100);
  assert.equal(jobs[0].relativePath, 'audio/english/001.mp3');
  assert.equal(jobs[99].relativePath, 'audio/english/100.mp3');
});

test('generateFullAudio resumes existing MP3 files and writes a key-free manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minimax-full-'));
  const phrases = [
    { zh: '一', en: 'One', ko: '하나' },
    { zh: '二', en: 'Two', ko: '둘' },
  ];
  const existingPath = path.join(root, 'audio/english/001.mp3');
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(existingPath, Buffer.from('ID3 existing'));
  const calls = [];
  const secret = 'never-publish-this-secret';

  const result = await generateFullAudio({
    rootDir: root,
    apiKey: secret,
    phrases,
    requestAudio: async (input) => {
      calls.push(input);
      return Buffer.from('ID3 generated');
    },
  });

  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'Two');
  const manifest = await fs.readFile(path.join(root, 'audio/english/manifest.json'), 'utf8');
  assert.doesNotMatch(manifest, /never-publish-this-secret|sk-api-/);
  assert.match(manifest, /English_Trustworthy_Man/);
  assert.equal(JSON.parse(manifest).phrases.length, 2);
});

test('patchFullPhrasebook removes audition and browser speech, then wires static MP3 playback', async () => {
  const html = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  const patched = patchFullPhrasebook(html);
  const patchedAgain = patchFullPhrasebook(patched);

  assert.equal(patched, patchedAgain);
  assert.doesNotMatch(patched, /MINIMAX_SAMPLE_PANEL_START|MINIMAX_SAMPLE_STYLE_START/);
  assert.doesNotMatch(patched, /speechSynthesis|SpeechSynthesisUtterance|data-speak=/);
  assert.match(patched, /MINIMAX_FULL_AUDIO_STATUS_START/);
  assert.match(patched, /English_Trustworthy_Man/);
  assert.match(patched, /audio\/english\//);
  assert.match(patched, /data-phrase-audio=/);
  assert.match(patched, /function playPhraseAudio/);
  assert.doesNotMatch(patched, /MINIMAX_API_KEY|sk-api-/);
});
