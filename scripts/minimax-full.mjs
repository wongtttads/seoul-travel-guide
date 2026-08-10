import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { requestMiniMaxAudio } from './minimax-samples.mjs';

export const FULL_VOICE = {
  id: 'English_Trustworthy_Man',
  label: '稳重男声',
  model: 'speech-2.8-hd',
  speed: 0.8,
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function extractPhrasebook(html) {
  const match = html.match(/var PHRASE_GROUPS\s*=\s*(\[[\s\S]*?\n\s*\]);\n\n\s*function renderPhrasebook/);
  if (!match) throw new Error('PHRASE_GROUPS could not be found in index.html.');
  const groups = vm.runInNewContext(match[1], Object.create(null), { timeout: 1000 });
  return groups.flatMap((group) => group.items.map((item) => ({
    category: group.title,
    zh: item[0],
    en: item[1],
    ko: item[2],
  })));
}

export function buildFullAudioJobs(phrases) {
  return phrases.map((phrase, index) => ({
    ...phrase,
    number: index + 1,
    voiceId: FULL_VOICE.id,
    relativePath: `audio/english/${String(index + 1).padStart(3, '0')}.mp3`,
  }));
}

async function isUsableMp3(filePath) {
  try {
    const file = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(3);
      const { bytesRead } = await file.read(header, 0, 3, 0);
      return bytesRead === 3 && (
        header.toString('ascii') === 'ID3'
        || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

async function requestWithRetry(input, requestAudio) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await requestAudio(input);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(1000 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export async function generateFullAudio({
  rootDir,
  apiKey,
  phrases,
  requestAudio = requestMiniMaxAudio,
  throttleMs = 0,
}) {
  const jobs = buildFullAudioJobs(phrases);
  let generated = 0;
  let skipped = 0;

  for (const job of jobs) {
    const outputPath = path.join(rootDir, job.relativePath);
    if (await isUsableMp3(outputPath)) {
      skipped += 1;
      continue;
    }
    const bytes = await requestWithRetry({
      text: job.en,
      voiceId: FULL_VOICE.id,
      apiKey,
    }, requestAudio);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);
    generated += 1;
    if (throttleMs > 0) await sleep(throttleMs);
  }

  const manifest = {
    model: FULL_VOICE.model,
    voiceId: FULL_VOICE.id,
    speed: FULL_VOICE.speed,
    phraseCount: jobs.length,
    phrases: jobs.map(({ number, category, zh, en, ko, relativePath }) => ({
      number, category, zh, en, ko, relativePath,
    })),
  };
  const manifestPath = path.join(rootDir, 'audio/english/manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { generated, skipped, jobs };
}

const FULL_AUDIO_STYLES = `<!-- MINIMAX_FULL_AUDIO_STYLE_START -->
  .phrase-audio-status{display:flex;gap:10px;align-items:center;margin:12px 0 18px;padding:12px 14px;border:1px solid #c6e5d2;border-radius:14px;background:var(--green-soft);color:#285b46}
  .phrase-audio-status .audio-icon{flex:0 0 34px;width:34px;height:34px;border-radius:11px;background:var(--green);color:#fff;display:grid;place-items:center;font-size:17px}
  .phrase-audio-status b{display:block;font-size:13px}.phrase-audio-status span{display:block;font-size:10px;color:#52705f;margin-top:2px;word-break:break-word}
  <!-- MINIMAX_FULL_AUDIO_STYLE_END -->`;

const FULL_AUDIO_STATUS = `<!-- MINIMAX_FULL_AUDIO_STATUS_START -->
  <div class="phrase-audio-status">
    <div class="audio-icon">🔊</div>
    <div><b>MiniMax 稳重男声 · 100句已生成</b><span>English_Trustworthy_Man · speech-2.8-hd · 0.8倍速 · 点击每句右侧“播放”</span></div>
  </div>
  <!-- MINIMAX_FULL_AUDIO_STATUS_END -->`;

const RENDER_FUNCTION = `function renderPhrasebook(){
    var root = document.getElementById('phrase-groups');
    if(!root) return;
    var phraseAudioNumber = 0;
    root.innerHTML = PHRASE_GROUPS.map(function(group){
      return '<section class="phrase-category"><h2 class="phrase-title">'+esc(group.icon)+' '+esc(group.title)+' <span>'+esc(group.sub)+'</span></h2><div class="phrase-card">'
        + group.items.map(function(item){
          phraseAudioNumber += 1;
          var audioPath = 'audio/english/'+String(phraseAudioNumber).padStart(3,'0')+'.mp3';
          return '<div class="phrase-row"><div class="phrase-text"><div class="phrase-zh">'+esc(item[0])+'</div><div class="phrase-en">'+esc(item[1])+'</div><div class="phrase-ko" lang="ko">'+esc(item[2])+'</div></div>'
            +'<div class="phrase-actions"><button type="button" class="phrase-copy" data-copy="'+esc(item[1])+'" aria-label="复制英文：'+esc(item[0])+'">复制</button>'
            +'<button type="button" class="phrase-speak" data-phrase-audio="'+audioPath+'" aria-label="播放英文：'+esc(item[0])+'">🔊 播放</button></div></div>';
        }).join('')+'</div></section>';
    }).join('');
  }`;

const PLAYER_FUNCTION = `// MINIMAX_FULL_PLAYER_START
  var phraseAudioPlayer = null;
  var phraseAudioButton = null;
  function resetPhraseAudioButton(){
    if(phraseAudioButton){ phraseAudioButton.classList.remove('now'); phraseAudioButton.textContent='🔊 播放'; }
    phraseAudioButton = null;
  }
  function playPhraseAudio(src, btn){
    if(phraseAudioPlayer){ phraseAudioPlayer.pause(); phraseAudioPlayer.currentTime=0; }
    resetPhraseAudioButton();
    phraseAudioButton = btn;
    phraseAudioPlayer = new Audio(src);
    btn.classList.add('now');
    btn.textContent = '播放中…';
    phraseAudioPlayer.onended = resetPhraseAudioButton;
    phraseAudioPlayer.onerror = function(){ btn.textContent='加载失败'; setTimeout(resetPhraseAudioButton,1600); };
    phraseAudioPlayer.play().catch(function(){ btn.textContent='点击重试'; setTimeout(resetPhraseAudioButton,1600); });
  }
  // MINIMAX_FULL_PLAYER_END`;

export function patchFullPhrasebook(source) {
  let html = source
    .replace(/<!-- MINIMAX_SAMPLE_PANEL_START -->[\s\S]*?<!-- MINIMAX_SAMPLE_PANEL_END -->\s*/g, '')
    .replace(/<!-- MINIMAX_SAMPLE_STYLE_START -->[\s\S]*?<!-- MINIMAX_SAMPLE_STYLE_END -->\s*/g, '');

  const fullStylePattern = /<!-- MINIMAX_FULL_AUDIO_STYLE_START -->[\s\S]*?<!-- MINIMAX_FULL_AUDIO_STYLE_END -->/g;
  html = fullStylePattern.test(html)
    ? html.replace(fullStylePattern, FULL_AUDIO_STYLES)
    : html.replace('</style>', `${FULL_AUDIO_STYLES}\n</style>`);

  const fullStatusPattern = /<!-- MINIMAX_FULL_AUDIO_STATUS_START -->[\s\S]*?<!-- MINIMAX_FULL_AUDIO_STATUS_END -->/g;
  if (fullStatusPattern.test(html)) {
    html = html.replace(fullStatusPattern, FULL_AUDIO_STATUS);
  } else {
    const intro = /(<p class="phrase-intro">[\s\S]*?<\/p>)/;
    if (!intro.test(html)) throw new Error('Phrasebook introduction marker was not found.');
    html = html.replace(intro, `$1\n${FULL_AUDIO_STATUS}`);
  }

  const renderPattern = /function renderPhrasebook\(\)\{[\s\S]*?\n\s*\}\n\n\s*\/\/ ====== 景点地图/;
  if (!renderPattern.test(html)) throw new Error('renderPhrasebook function could not be found.');
  html = html.replace(renderPattern, `${RENDER_FUNCTION}\n\n  // ====== 景点地图`);

  const fullPlayerPattern = /\/\/ MINIMAX_FULL_PLAYER_START[\s\S]*?\/\/ MINIMAX_FULL_PLAYER_END/g;
  const browserVoicePattern = /function chooseEnglishVoice\(synth\)\{[\s\S]*?\n\s*\}\n\n\s*var mapsLaunched/;
  if (fullPlayerPattern.test(html)) {
    html = html.replace(fullPlayerPattern, PLAYER_FUNCTION);
  } else {
    if (!browserVoicePattern.test(html)) throw new Error('Browser speech player could not be found.');
    html = html.replace(browserVoicePattern, `${PLAYER_FUNCTION}\n\n  var mapsLaunched`);
  }

  const oldClickHandler = /var s = e\.target\.closest\('\[data-speak\]'\);\n\s*if \(s\) speakEnglish\(s\.getAttribute\('data-speak'\), s\);/;
  const newClickHandlerPattern = /var s = e\.target\.closest\('\[data-phrase-audio\]'\);\n\s*if \(s\) playPhraseAudio\(s\.getAttribute\('data-phrase-audio'\), s\);/;
  const newClickHandler = `var s = e.target.closest('[data-phrase-audio]');\n    if (s) playPhraseAudio(s.getAttribute('data-phrase-audio'), s);`;
  if (oldClickHandler.test(html)) html = html.replace(oldClickHandler, newClickHandler);
  else if (newClickHandlerPattern.test(html)) html = html.replace(newClickHandlerPattern, newClickHandler);
  else throw new Error('Phrase audio click handler could not be found.');

  return html;
}

async function main() {
  const rootDir = process.cwd();
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY is required.');
  const indexPath = path.join(rootDir, 'index.html');
  const source = await fs.readFile(indexPath, 'utf8');
  const phrases = extractPhrasebook(source);
  if (phrases.length !== 100) throw new Error(`Expected 100 phrases, found ${phrases.length}.`);

  const result = await generateFullAudio({
    rootDir,
    apiKey,
    phrases,
    throttleMs: 1100,
  });
  await fs.writeFile(indexPath, patchFullPhrasebook(source));
  console.log(`MiniMax audio complete: ${result.generated} generated, ${result.skipped} reused.`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
