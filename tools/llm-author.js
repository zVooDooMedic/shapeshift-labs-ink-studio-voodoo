#!/usr/bin/env node
/* Ask a local model (any OpenAI-compatible endpoint, default: the Strata engine on :8002)
   to author an ink-studio scene, then check it here. No network beyond localhost.

   A small model truncates. So this loops: each round either continues the file where the model
   ran out, or hands the compiler error back and asks for the missing lines. Rounds stop as soon
   as `node --check` is happy.

   usage: node tools/llm-author.js [--out tools/generated/scene.js] [--rounds 4]
          [--endpoint URL] [--model ID] [--max-tokens N]
*/
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ENDPOINT = arg('--endpoint', 'http://127.0.0.1:8002/v1/chat/completions');
const MODEL = arg('--model', 'qwen3.8-flash-next-iq3_xxs');
const OUT = arg('--out', path.join(__dirname, 'generated', 'lantern-shrine.js'));
const ROUNDS = +arg('--rounds', 4);
const MAXTOK = +arg('--max-tokens', 6000);
const PROMPT = fs.readFileSync(path.join(__dirname, 'llm-author-prompt.md'), 'utf8');

async function ask(messages) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, temperature: 0.2, max_tokens: MAXTOK, messages })
  });
  if (!res.ok) throw new Error('model endpoint ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  const ch = (j.choices && j.choices[0]) || {};
  const text = (ch.message && ch.message.content) || ch.text || '';
  const u = j.usage || {};
  console.log(`  model answered in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
              `(${u.prompt_tokens ?? '?'} -> ${u.completion_tokens ?? '?'} tokens, finish=${ch.finish_reason || '?'})`);
  return text;
}

/* keep the fenced block that actually looks like a scene module */
function pick(text) {
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*([\s\S]*?)```/g)].map(m => m[1].trim());
  const all = blocks.length ? blocks : [text.trim()];
  return all.sort((a, b) => ((b.includes('module.exports') ? 1 : 0) - (a.includes('module.exports') ? 1 : 0)) || b.length - a.length)[0];
}

function check(file) {
  try { execFileSync('node', ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] }); return null; }
  catch (e) { return String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'); }
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let code = '', err = null;
  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`[round ${round}] asking ${MODEL}`);
    const messages = round === 1
      ? [{ role: 'user', content: PROMPT }]
      : [{ role: 'user', content: PROMPT },
         { role: 'assistant', content: '```js\n' + code + '\n```' },
         { role: 'user', content: 'That file is incomplete or broken:\n' + (err || 'it has no module.exports') +
             '\nContinue the SAME file from exactly where it stops, adding only the missing lines ' +
             '(close the open call, close build(), close the returned object, close the module.exports arrow). ' +
             'Do not repeat what is already there. Reply with only the remaining code, in one js fence.' }];
    const piece = pick(await ask(messages));
    if (round === 1) code = piece;
    else if (piece.length > code.length) code = piece;                       // model rewrote the whole thing
    else code = code.replace(/\s+$/, '') + '\n' + piece;                     // model continued it
    fs.writeFileSync(OUT, code + '\n');
    err = check(OUT);
    if (!err && /module\.exports\s*=/.test(code)) {
      console.log(`OK: ${OUT} compiles (${code.length} chars, ${round} round${round > 1 ? 's' : ''})`);
      return;
    }
    console.log('  not compilable yet:\n' + (err || 'no module.exports in the answer'));
  }
  console.log('WARN: still not compilable after ' + ROUNDS + ' rounds — see ' + OUT);
  process.exitCode = 2;
})();
