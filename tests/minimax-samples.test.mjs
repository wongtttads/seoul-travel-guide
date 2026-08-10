import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  SAMPLE_SENTENCES,
  SAMPLE_VOICES,
  buildSampleJobs,
  generateSampleFiles,
  patchPhrasebookHtml,
} from '../scripts/minimax-samples.mjs';

test('buildSampleJobs creates three phrases for each of two voices', () => {
  const jobs = buildSampleJobs();

  assert.equal(SAMPLE_SENTENCES.length, 3);
  assert.equal(SAMPLE_VOICES.length, 2);
  assert.equal(jobs.length, 6);
  assert.deepEqual(
    jobs.map((job) => job.relativePath),
    [
      'audio/minimax-samples/graceful-lady-01.mp3',
      'audio/minimax-samples/graceful-lady-02.mp3',
      'audio/minimax-samples/graceful-lady-03.mp3',
      'audio/minimax-samples/trustworthy-man-01.mp3',
      'audio/minimax-samples/trustworthy-man-02.mp3',
      'audio/minimax-samples/trustworthy-man-03.mp3',
    ],
  );
});

test('generateSampleFiles writes decoded MP3 bytes without exposing the API key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minimax-samples-'));
  const seen = [];
  const secret = 'test-secret-that-must-not-leak';
  const requestAudio = async ({ text, voiceId, apiKey }) => {
    seen.push({ text, voiceId, apiKey });
    return Buffer.from('ID3 sample audio');
  };

  const result = await generateSampleFiles({ rootDir: root, apiKey: secret, requestAudio });

  assert.equal(result.length, 6);
  assert.equal(seen.length, 6);
  assert.ok(seen.every((call) => call.apiKey === secret));
  for (const job of result) {
    const bytes = await fs.readFile(path.join(root, job.relativePath));
    assert.equal(bytes.toString(), 'ID3 sample audio');
  }
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('patchPhrasebookHtml inserts one six-button audition panel and is idempotent', () => {
  const source = `<!doctype html><html><head><style>.phrase-intro{}</style></head><body>
    <p class="phrase-intro">现有说明</p>
  </body></html>`;

  const once = patchPhrasebookHtml(source);
  const twice = patchPhrasebookHtml(once);

  assert.equal(once, twice);
  assert.equal((once.match(/data-minimax-sample=/g) || []).length, 6);
  assert.equal((once.match(/MINIMAX_SAMPLE_PANEL_START/g) || []).length, 1);
  assert.equal((once.match(/MINIMAX_SAMPLE_STYLE_START/g) || []).length, 1);
  assert.match(once, /English_Graceful_Lady/);
  assert.match(once, /English_Trustworthy_Man/);
  assert.doesNotMatch(once, /MINIMAX_API_KEY|sk-api-/);
});
