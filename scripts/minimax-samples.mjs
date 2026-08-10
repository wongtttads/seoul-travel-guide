import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_SENTENCES = [
  { zh: '机场铁路在哪里？', en: 'Where is the Airport Railroad?' },
  { zh: '请说慢一点。', en: 'Could you speak more slowly, please?' },
  { zh: '请先给我做安全讲解。', en: 'Please give me a safety briefing first.' },
];

export const SAMPLE_VOICES = [
  {
    id: 'English_Graceful_Lady',
    slug: 'graceful-lady',
    label: '自然女声',
    description: '清晰、自然，适合学习旅行英语',
  },
  {
    id: 'English_Trustworthy_Man',
    slug: 'trustworthy-man',
    label: '稳重男声',
    description: '沉稳、清楚，长句辨识度较好',
  },
];

export function buildSampleJobs() {
  return SAMPLE_VOICES.flatMap((voice) =>
    SAMPLE_SENTENCES.map((sentence, index) => ({
      ...sentence,
      voiceId: voice.id,
      voiceLabel: voice.label,
      voiceDescription: voice.description,
      relativePath: `audio/minimax-samples/${voice.slug}-${String(index + 1).padStart(2, '0')}.mp3`,
    })),
  );
}

export async function requestMiniMaxAudio({ text, voiceId, apiKey }) {
  const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'speech-2.8-hd',
      text,
      stream: false,
      language_boost: 'English',
      voice_setting: {
        voice_id: voiceId,
        speed: 0.8,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.base_resp?.status_code) {
    const message = payload?.base_resp?.status_msg || `HTTP ${response.status}`;
    throw new Error(`MiniMax TTS request failed: ${message}`);
  }
  if (!payload?.data?.audio || !/^[0-9a-f]+$/i.test(payload.data.audio)) {
    throw new Error('MiniMax TTS response did not contain valid audio data.');
  }
  return Buffer.from(payload.data.audio, 'hex');
}

export async function generateSampleFiles({
  rootDir,
  apiKey,
  requestAudio = requestMiniMaxAudio,
}) {
  const jobs = buildSampleJobs();
  const results = [];

  for (const job of jobs) {
    const bytes = await requestAudio({ text: job.en, voiceId: job.voiceId, apiKey });
    const outputPath = path.join(rootDir, job.relativePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);
    results.push(job);
  }

  return results;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function samplePanelMarkup() {
  const voiceSections = SAMPLE_VOICES.map((voice) => {
    const jobs = buildSampleJobs().filter((job) => job.voiceId === voice.id);
    const rows = jobs.map((job) => `
        <div class="minimax-sample-row">
          <div><b>${escapeHtml(job.zh)}</b><span>${escapeHtml(job.en)}</span></div>
          <button type="button" data-minimax-sample="${escapeHtml(job.relativePath)}">▶ 试听</button>
        </div>`).join('');
    return `
      <section class="minimax-voice" data-voice-id="${voice.id}">
        <h3>${escapeHtml(voice.label)} <small>${voice.id}</small></h3>
        <p>${escapeHtml(voice.description)}</p>${rows}
      </section>`;
  }).join('');

  return `<!-- MINIMAX_SAMPLE_PANEL_START -->
  <section class="minimax-samples" aria-labelledby="minimax-samples-title">
    <div class="minimax-samples-head">
      <span>MiniMax · speech-2.8-hd · 0.8×</span>
      <h2 id="minimax-samples-title">选择英语音色</h2>
      <p>先试听女声和男声各3句，选定后再生成完整100句。</p>
    </div>
    <div class="minimax-voice-grid">${voiceSections}
    </div>
  </section>
  <script>
  (function(){
    var currentAudio = null;
    var currentButton = null;
    function resetButton(){
      if(currentButton){ currentButton.classList.remove('now'); currentButton.textContent='▶ 试听'; }
      currentButton = null;
    }
    document.addEventListener('click', function(event){
      var button = event.target.closest('[data-minimax-sample]');
      if(!button) return;
      if(currentAudio){ currentAudio.pause(); currentAudio.currentTime = 0; }
      resetButton();
      currentButton = button;
      currentAudio = new Audio(button.getAttribute('data-minimax-sample'));
      button.classList.add('now');
      button.textContent = '播放中…';
      currentAudio.onended = resetButton;
      currentAudio.onerror = function(){ button.textContent='加载失败'; setTimeout(resetButton, 1600); };
      currentAudio.play().catch(function(){ button.textContent='点击重试'; setTimeout(resetButton, 1600); });
    });
  })();
  <\/script>
  <!-- MINIMAX_SAMPLE_PANEL_END -->`;
}

const SAMPLE_STYLES = `<!-- MINIMAX_SAMPLE_STYLE_START -->
  .minimax-samples{margin:14px 0 22px;background:linear-gradient(145deg,#10253f,#183657);border-radius:18px;padding:14px;color:#fff;box-shadow:0 8px 24px rgba(16,37,63,.18)}
  .minimax-samples-head span{font-size:10px;font-weight:900;letter-spacing:.05em;color:#7fc1ff}.minimax-samples-head h2{font-size:18px;margin:4px 0}.minimax-samples-head p{font-size:12px;color:#cfe0f2;margin:0 0 12px}
  .minimax-voice-grid{display:grid;gap:10px}.minimax-voice{background:#fff;color:#1c2a3c;border-radius:14px;padding:12px}.minimax-voice h3{font-size:15px;margin:0}.minimax-voice h3 small{display:block;font-size:9px;color:#718096;margin-top:2px}.minimax-voice>p{font-size:11px;color:#718096;margin:5px 0 8px}
  .minimax-sample-row{display:flex;gap:8px;align-items:center;border-top:1px solid #e6e1d8;padding:9px 0}.minimax-sample-row>div{flex:1;min-width:0}.minimax-sample-row b{display:block;font-size:12px}.minimax-sample-row span{display:block;font-size:11px;color:#526273;margin-top:2px}.minimax-sample-row button{flex:0 0 66px;border:0;border-radius:10px;padding:8px 5px;background:#1475e1;color:#fff;font-size:11px;font-weight:900}.minimax-sample-row button.now{background:#287a5b}
  @media(min-width:700px){.minimax-voice-grid{grid-template-columns:1fr 1fr}}
  <!-- MINIMAX_SAMPLE_STYLE_END -->`;

export function patchPhrasebookHtml(source) {
  const panelPattern = /<!-- MINIMAX_SAMPLE_PANEL_START -->[\s\S]*?<!-- MINIMAX_SAMPLE_PANEL_END -->/g;
  const stylePattern = /<!-- MINIMAX_SAMPLE_STYLE_START -->[\s\S]*?<!-- MINIMAX_SAMPLE_STYLE_END -->/g;
  let styled = stylePattern.test(source)
    ? source.replace(stylePattern, SAMPLE_STYLES)
    : source.replace('</style>', `${SAMPLE_STYLES}\n</style>`);
  if (panelPattern.test(styled)) return styled.replace(panelPattern, samplePanelMarkup());
  const introPattern = /(<p class="phrase-intro">[\s\S]*?<\/p>)/;
  if (!introPattern.test(styled)) throw new Error('Phrasebook introduction marker was not found.');
  return styled.replace(introPattern, `$1\n${samplePanelMarkup()}`);
}

async function main() {
  const rootDir = process.cwd();
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY is required.');

  await generateSampleFiles({ rootDir, apiKey });
  const indexPath = path.join(rootDir, 'index.html');
  const source = await fs.readFile(indexPath, 'utf8');
  await fs.writeFile(indexPath, patchPhrasebookHtml(source));
  console.log('Generated 6 MiniMax audition clips and updated index.html.');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
