import 'dotenv/config';
import { randomUUID } from 'crypto';
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');
import { createServer } from 'http';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import sql from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(__dirname, 'public', 'generated'), { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });

// Create/migrate tables on startup
async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS world_state (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      show_id uuid NOT NULL,
      key text NOT NULL,
      value jsonb,
      last_updated timestamptz DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS characters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      show_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      doodle_url text,
      styled_frame_url text,
      created_at timestamptz DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS episodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      show_id uuid NOT NULL,
      episode_number int NOT NULL,
      title text,
      story_prompt text,
      veo_clip_url text,
      lyria_track_url text,
      created_at timestamptz DEFAULT now()
    )
  `;
  // world_state already exists from Sam's schema — add key/value columns if missing
  await sql`ALTER TABLE world_state ADD COLUMN IF NOT EXISTS key text`;
  await sql`ALTER TABLE world_state ADD COLUMN IF NOT EXISTS value jsonb`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS world_state_show_key ON world_state(show_id, key)
  `;
  console.log('DB ready');
}

// Rename a story (updates all episodes' show record via world_state)
app.patch('/api/story/:showId', async (req, res, next) => { try {
  const { showId } = req.params;
  const { story_name } = req.body;
  await sql`
    INSERT INTO world_state (show_id, key, value, last_updated)
    VALUES (${showId}, 'story_name', ${JSON.stringify(story_name)}, now())
    ON CONFLICT (show_id, key) DO UPDATE SET value = EXCLUDED.value, last_updated = now()
  `;
  res.json({ ok: true });
} catch (e) { next(e); } });

// Delete a story and all its episodes/characters
app.delete('/api/story/:showId', async (req, res, next) => { try {
  const { showId } = req.params;
  await sql`DELETE FROM episodes WHERE show_id = ${showId}`;
  await sql`DELETE FROM characters WHERE show_id = ${showId}`;
  await sql`DELETE FROM world_state WHERE show_id = ${showId}`;
  res.json({ ok: true });
} catch (e) { next(e); } });

// P3 calls this to load the show bible sidebar
app.get('/api/show-bible', async (req, res) => {
  const { show_id } = req.query;
  if (!show_id) return res.json({ characters: [], episodes: [] });
  const characters = await sql`
    SELECT * FROM characters WHERE show_id = ${show_id}
  `;
  const episodes = await sql`
    SELECT * FROM episodes WHERE show_id = ${show_id}
    ORDER BY episode_number ASC
  `;
  res.json({ characters, episodes });
});

// P3 calls this after a new episode generates
app.post('/api/episode', async (req, res) => {
  const { show_id, title, story_prompt, veo_clip_url, lyria_track_url } = req.body;
  const [latest] = await sql`
    SELECT episode_number FROM episodes
    WHERE show_id = ${show_id}
    ORDER BY episode_number DESC LIMIT 1
  `;
  const nextNumber = (latest?.episode_number ?? 0) + 1;
  const [episode] = await sql`
    INSERT INTO episodes (show_id, episode_number, title, story_prompt, veo_clip_url, lyria_track_url)
    VALUES (${show_id}, ${nextNumber}, ${title}, ${story_prompt}, ${veo_clip_url}, ${lyria_track_url})
    RETURNING *
  `;
  res.json(episode);
});

// P1 calls this after character assets are ready
app.post('/api/character', async (req, res) => {
  const { show_id, name, description, doodle_url, styled_frame_url } = req.body;
  const [character] = await sql`
    INSERT INTO characters (show_id, name, description, doodle_url, styled_frame_url)
    VALUES (${show_id}, ${name}, ${description}, ${doodle_url}, ${styled_frame_url})
    RETURNING *
  `;
  res.json(character);
});

// World state read
app.get('/api/world-state', async (req, res) => {
  const { show_id } = req.query;
  if (!show_id) return res.json({});
  const rows = await sql`
    SELECT key, value FROM world_state WHERE show_id = ${show_id}
  `;
  const state = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(state);
});

// World state write
app.post('/api/world-state', async (req, res) => {
  const { show_id, key, value } = req.body;
  const [row] = await sql`
    INSERT INTO world_state (show_id, key, value, last_updated)
    VALUES (${show_id}, ${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (show_id, key)
    DO UPDATE SET value = EXCLUDED.value, last_updated = now()
    RETURNING *
  `;
  res.json(row);
});

// P4 orchestration: Live API transcript → Veo + Lyria prompts
// P3 calls this after voice session produces a transcript
app.post('/api/orchestrate', async (req, res) => {
  const { show_id, transcript } = req.body;

  // Load existing characters for context
  const existingCharacters = await sql`
    SELECT name, description FROM characters WHERE show_id = ${show_id}
  `;

  const characterContext = existingCharacters.length
    ? `Existing characters: ${existingCharacters.map(c => `${c.name} (${c.description})`).join(', ')}.`
    : 'No existing characters yet.';

  // Use Gemini Flash to parse creative intent from transcript
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{ text: `You are a pipeline assistant for a children's animated show generator.
${characterContext}

Parse this creative director voice transcript and extract structured generation prompts.

Transcript: "${transcript}"

Respond with ONLY valid JSON in this exact shape:
{
  "veo_prompt": "A detailed scene description for Veo 3 video generation. Cinematic, slow-paced, hand-drawn animation style, long scene holds, calm cuts, 8 seconds.",
  "lyria_prompt": "A music generation prompt for Lyria 2. Calm gentle instrumental, slow-media pacing, children's animated show tone.",
  "characters_mentioned": ["name1", "name2"],
  "episode_title": "Short episode title"
}` }]
    }],
    config: { responseMimeType: 'application/json' }
  });

  const parsed = JSON.parse(result.text);

  // Persist the latest prompts to world state
  await sql`
    INSERT INTO world_state (show_id, key, value, last_updated)
    VALUES (${show_id}, 'latest_prompts', ${JSON.stringify(parsed)}, now())
    ON CONFLICT (show_id, key)
    DO UPDATE SET value = EXCLUDED.value, last_updated = now()
  `;

  res.json(parsed);
});

// Accepts base64 canvas PNG, styles it, describes it with Gemini Vision, saves to DB
// Call this while Veo is loading — the character will appear in the next scene
app.post('/api/add-character', async (req, res, next) => {
  try {
    const { show_id, name, image_data } = req.body;
    if (!show_id || !name || !image_data) {
      return res.status(400).json({ error: 'show_id, name, and image_data required' });
    }

    // Save doodle to disk
    const doodleFilename = `${show_id}-doodle-${Date.now()}.png`;
    const doodlePath = join(__dirname, 'public', 'generated', doodleFilename);
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
    writeFileSync(doodlePath, base64Data, 'base64');
    const doodle_url = `/generated/${doodleFilename}`;

    // Style the doodle with Gemini image generation (Nano Banana)
    const styleResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'image/png', data: base64Data } },
        { text: `This is a child's drawing of a character named "${name}". Redraw it as a FULLY COLORED cartoon character with bright solid colors filling every part of the body — no outlines-only, no sketchy look, every region must be filled with vivid color. Preserve every quirky proportion EXACTLY as drawn: lopsided eyes stay lopsided, oversized head stays oversized, uneven limbs stay uneven. White background. Fun children's animation style. The character must look like a brightly colored cartoon sticker.` }
      ]}],
      config: { responseModalities: ['IMAGE', 'TEXT'] }
    });
    const imagePart = styleResult.candidates[0].content.parts.find(p => p.inlineData?.mimeType?.startsWith('image'));
    const styledFilename = `${show_id}-styled-${Date.now()}.png`;
    writeFileSync(join(__dirname, 'public', 'generated', styledFilename), Buffer.from(imagePart.inlineData.data, 'base64'));
    const styled_frame_url = `/generated/${styledFilename}`;

    // Use Gemini Vision to describe the styled character for use in future Veo prompts
    const visionResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64Data } },
          { text: `This is a child's drawing of a character named "${name}" for a story. Describe this character in 1-2 vivid sentences that could be used in a video generation prompt. Focus on appearance, colors, and personality suggested by the drawing. If the character appears human or human-like, use they/them pronouns — do not assume gender.` }
        ]
      }]
    });
    const description = visionResult.text.trim();

    // Save to DB
    const [character] = await sql`
      INSERT INTO characters (show_id, name, description, doodle_url, styled_frame_url)
      VALUES (${show_id}, ${name}, ${description}, ${doodle_url}, ${styled_frame_url})
      RETURNING *
    `;

    res.json({ character, styled_frame_url, description });
  } catch (e) { next(e); }
});

// Convert raw PCM L16 to WAV buffer so browsers can play it
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const dataSize = pcmBuffer.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  wav.writeUInt16LE(channels * bitsPerSample / 8, 32); wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  return wav;
}

// TTS narrator — returns a WAV audio stream
app.post('/api/narrate', async (req, res, next) => { try {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } }
    }
  });
  const part = result.candidates[0].content.parts.find(p => p.inlineData?.mimeType?.startsWith('audio'));
  if (!part) return res.status(500).json({ error: 'No audio returned' });
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const wav = pcmToWav(pcm);
  res.set('Content-Type', 'audio/wav');
  res.send(wav);
} catch (e) { next(e); } });

// Instruction added to every prompt that produces child-facing text
const CHILD_VOCAB = `VOCABULARY RULE: Every word you write must be understood by a 6–10 year old. Use short, everyday words. If you want to describe something glowing, say "glowing" or "bright" — not "iridescent" or "luminescent". If something moves, say "bouncing" or "shaking" — not "pulsing" or "oscillating". No fancy adjectives, no unusual nouns. Write like you're talking to a child, not describing a painting.`;

// Shared helper: generate a challenge/encounter for the given scene
async function buildChallenge(scene_number, { characterContext, traitContext, storyHistory, story_name, show_id }) {
  const sceneLabel = scene_number >= 3
    ? 'Scene 3, the grand finale — make this feel like a big satisfying conclusion encounter'
    : `Scene ${scene_number} of 3${scene_number > 1 ? ' — raise the stakes a little from the previous scene' : ''}`;

  // Step 1: generate challenge text
  const textResult = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: `You are a master storyteller for a children's interactive story app (ages 4–10).

Story name: "${story_name || 'Our Story'}"
${characterContext}
${traitContext}
${storyHistory}

Generate an exciting, age-appropriate CHALLENGE or ENCOUNTER for ${sceneLabel}.

Rules:
- Match the genre/setting already established (fantasy → magic problems, school → social/creative challenges, adventure → physical obstacles, etc.)
- Pose ONE simple, clear problem the child must solve — a blocked path, a creature that needs help, a locked door, a friend who is sad, something that's lost, etc.
- The challenge should follow naturally from the story so far
- Address the child directly in second-person ("You and [name] are walking when suddenly...")
- 1–2 short sentences only — keep it simple and easy to read aloud
- End with a direct question: "What do you do?" or "How do you help?"
- The child's creative answer will decide what happens in the scene
- IMPORTANT: Refer to the main character by their name (e.g. "Blobby finds a door" not "they find a door"). Never use gendered pronouns (he/she/him/her). For unnamed supporting characters, use "they/them".
- ${CHILD_VOCAB}

Respond with ONLY valid JSON:
{
  "challenge_text": "The challenge sentence(s) addressed to the child",
  "challenge_short": "5–8 word dramatic summary (e.g. 'A giant spider guards the bridge!')"
}` }] }],
    config: { responseMimeType: 'application/json' }
  });

  const challenge = JSON.parse(textResult.text);

  // Step 2: generate illustration using the exact challenge text so it matches
  if (show_id) {
    try {
      const imageResult = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ role: 'user', parts: [{ text: `Draw a simple, colorful children's storybook illustration for this story moment: "${challenge.challenge_text}" — hand-drawn cartoon style, warm bright colors, expressive and fun, clear focal point, no text in the image.` }] }],
        config: { responseModalities: ['IMAGE', 'TEXT'] }
      });
      const imgPart = imageResult.candidates[0].content.parts.find(p => p.inlineData?.mimeType?.startsWith('image'));
      if (imgPart) {
        const imgFilename = `${show_id}-challenge-${scene_number}-${Date.now()}.png`;
        writeFileSync(join(__dirname, 'public', 'generated', imgFilename), Buffer.from(imgPart.inlineData.data, 'base64'));
        challenge.challenge_image_url = `/generated/${imgFilename}`;
      }
    } catch (_) {}
  }

  return challenge;
}

// Called after character questions to get the first scene's challenge
app.post('/api/generate-challenge', async (req, res, next) => { try {
  const { show_id, scene_number = 1, story_name = '', character_traits } = req.body;
  const chars = await sql`SELECT name, description FROM characters WHERE show_id = ${show_id}`;
  const episodes = await sql`SELECT episode_number, title, story_prompt FROM episodes WHERE show_id = ${show_id} ORDER BY episode_number ASC`;
  const characterContext = chars.length
    ? `Characters: ${chars.map(c => `${c.name} (${c.description})`).join(', ')}.`
    : 'No characters yet.';
  const traitContext = character_traits && Object.keys(character_traits).length
    ? `Character traits: ${Object.entries(character_traits).map(([k, v]) => `${k}: "${v}"`).join('; ')}.`
    : '';
  const storyHistory = episodes.length
    ? `Previous scenes: ${episodes.map(e => `Scene ${e.episode_number}: ${e.title} — ${e.story_prompt}`).join(' | ')}`
    : 'This is the very first scene.';
  const challenge = await buildChallenge(scene_number, { characterContext, traitContext, storyHistory, story_name, show_id });
  res.json(challenge);
} catch (e) { next(e); } });

// Quick call: returns a fun character-specific voice prompt for the child
app.post('/api/scene-voice-prompt', async (req, res, next) => { try {
  const { show_id, user_input } = req.body;
  const chars = await sql`SELECT name, description FROM characters WHERE show_id = ${show_id}`;
  const charList = chars.map(c => `${c.name} (${c.description})`).join(', ') || 'a character';
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: `You are making a children's story app. The child's characters are: ${charList}. The scene they described: "${user_input}".

Generate ONE short, playful, specific voice prompt asking the child to make a sound or say something as their character. It should be tied to the specific character and scene (e.g. if they have a dinosaur, ask them to roar; if they have a wizard, ask what spell they'd cast). Keep it to one sentence, fun, and low-pressure. Use the character's name instead of pronouns. Never use he/she/him/her. ${CHILD_VOCAB}

Respond with ONLY valid JSON: { "voice_prompt": "...", "sound_label": "a short label for the sound e.g. 'your roar' or 'what Blobby says'" }` }] }],
    config: { responseMimeType: 'application/json' }
  });
  res.json(JSON.parse(result.text));
} catch (e) { next(e); } });

// ── Job-based scene pipeline ────────────────────────────────────────────────
const jobs = new Map();
// Clean up jobs older than 30 minutes to avoid memory leaks
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) { if (job.started_at < cutoff) jobs.delete(id); }
}, 5 * 60 * 1000);

async function runScenePipeline(jobId, params) {
  const { show_id, scene_number, solution, challenge_text, story_name, parent_approved, voice_response, character_traits } = params;
  const t0 = Date.now();
  const log = (step, label, extra = {}) => {
    const elapsed_ms = Date.now() - t0;
    jobs.set(jobId, { status: 'running', step, label, elapsed_ms, started_at: jobs.get(jobId)?.started_at ?? t0, ...extra });
    console.log(`[job:${jobId.slice(0,8)}] +${elapsed_ms}ms  ${step}: ${label}`);
  };

  try {
    log('moderation', 'Checking story content...');
    if (!parent_approved) {
      const modResult = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: `You are a content moderator for a children's storytelling app for ages 3-10. Assess whether the following story input is appropriate for young children. Flag it if it contains any violence, scary themes, adult content, strong language, or anything PG-13 or above.\n\nInput: "${solution}"\n\nRespond with ONLY valid JSON: { "flagged": true/false, "reason": "brief reason if flagged, otherwise null" }` }] }],
        config: { responseMimeType: 'application/json' }
      });
      const mod = JSON.parse(modResult.text);
      if (mod.flagged) {
        jobs.set(jobId, { status: 'needs_approval', reason: mod.reason, elapsed_ms: Date.now() - t0, started_at: t0 });
        console.log(`[job:${jobId.slice(0,8)}] +${Date.now()-t0}ms  needs_approval: ${mod.reason}`);
        return;
      }
    }

    log('loading_context', 'Loading story context...');
    const [existingCharacters, prevEpisodes] = await Promise.all([
      sql`SELECT name, description, styled_frame_url FROM characters WHERE show_id = ${show_id}`,
      sql`SELECT episode_number, title, story_prompt FROM episodes WHERE show_id = ${show_id} ORDER BY episode_number ASC`
    ]);
    const characterContext = existingCharacters.length
      ? `Characters in this story: ${existingCharacters.map(c => `${c.name} (${c.description})`).join(', ')}.`
      : 'No characters yet.';
    const traitContext = character_traits && Object.keys(character_traits).length
      ? `Character traits the child revealed: ${Object.entries(character_traits).map(([k, v]) => `${k}: "${v}"`).join('; ')}.`
      : '';
    const storyHistory = prevEpisodes.length
      ? `Previous scenes: ${prevEpisodes.map(e => `Scene ${e.episode_number}: ${e.title} — ${e.story_prompt}`).join(' | ')}`
      : 'This is the first scene.';

    log('building_prompts', 'Writing scene script...');
    const challengeContext = challenge_text
      ? `The challenge the child was given: "${challenge_text}"\nThe child's creative solution: "${solution}"`
      : `The child's idea for the scene: "${solution}"`;
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `You are a creative director for a gentle children's animated story app.
Story name: "${story_name || 'Our Story'}"
${characterContext}
${traitContext}
${storyHistory}

${challengeContext}

This is scene ${scene_number} of 3. The child's solution must be shown WORKING — their idea succeeds in a satisfying, fun way. The animation celebrates their creativity.

IMPORTANT: Refer to the main character by their name throughout (e.g. "Blobby jumps over the rock" not "they jump over the rock"). Never use gendered pronouns (he/she/him/her). For unnamed supporting characters use "they/them".

${CHILD_VOCAB}

Respond with ONLY valid JSON:
{
  "veo_prompt": "Detailed cinematic scene description for Veo 3. Richly colored hand-drawn animation style with vibrant fully-painted backgrounds, warm and slow-paced, 8 seconds. Show the child's solution working triumphantly. Include the character visually. In the very last half-second, red velvet theatrical curtains snap shut quickly from both sides, ending frozen on closed curtains with 'Scene End' in a warm storybook font — this must be the very last frame.",
  "lyria_prompt": "Music prompt for Lyria. Warm, gentle, children's animated tone that matches the emotional beat of the solution succeeding.",
  "episode_title": "Short fun title for this scene",
  "story_prompt_summary": "One sentence describing what happened (for story continuity context in future scenes)",
  "closing_line": ${scene_number >= 3 ? '"The End! What a [pick ONE vivid adjective perfectly matching the mood and events of this specific story — e.g. magical, daring, silly, heartwarming, adventurous] story!"' : 'null'}
}` }] }],
      config: { responseMimeType: 'application/json' }
    });
    const prompts = JSON.parse(result.text);

    // Start Lyria immediately — we have the prompt and don't need voice_response for music
    log('lyria_starting', 'Starting Lyria music in background...');
    let lyriaRes;
    const lyriaPromise = ai.models.generateContent({
      model: 'lyria-3-clip-preview',
      contents: [{ role: 'user', parts: [{ text: prompts.lyria_prompt }] }],
      config: { responseModalities: ['AUDIO'] },
    }).then(r => { lyriaRes = r; log('lyria_done', `Lyria music ready (+${Date.now()-t0}ms)`); return r; });

    // Pause here and wait for the voice moment result from the frontend.
    // The frontend sends it via POST /api/scene-voice-response/:jobId.
    // If the child already responded before we got here, pendingVoiceResponse is set.
    log('awaiting_voice', 'Prompts ready — waiting for voice moment...');
    const resolvedVoice = await new Promise((resolve) => {
      const job = jobs.get(jobId);
      if (Object.prototype.hasOwnProperty.call(job, 'pendingVoiceResponse')) {
        resolve(job.pendingVoiceResponse);
      } else {
        job.resolveVoice = resolve;
      }
    });
    console.log(`[job:${jobId.slice(0,8)}] voice_response received: ${resolvedVoice ? `"${resolvedVoice}"` : 'skipped'}`);

    const finalVeoPrompt = resolvedVoice
      ? `${prompts.veo_prompt} At one point the character opens their mouth and the words "${resolvedVoice}" appear in a fun speech bubble above them.`
      : prompts.veo_prompt;

    log('starting_veo', 'Starting Veo video generation...');
    const veoOp0 = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-001',
      prompt: finalVeoPrompt,
      config: { aspectRatio: '16:9', durationSeconds: 8 },
    });
    log('veo_queued', 'Veo job submitted, waiting for generation...', { veo_poll: 0 });

    // Poll Veo — 10s interval, 8-minute hard timeout
    const VEO_TIMEOUT_MS = 8 * 60 * 1000;
    const veoStart = Date.now();
    let veoOp = veoOp0;
    let pollCount = 0;
    while (!veoOp.done) {
      if (Date.now() - veoStart > VEO_TIMEOUT_MS) {
        throw new Error(`Veo timed out after ${Math.round((Date.now()-veoStart)/1000)}s (${pollCount} polls). Try again.`);
      }
      await new Promise(r => setTimeout(r, 10000));
      pollCount++;
      veoOp = await ai.operations.getVideosOperation({ operation: veoOp });
      log('veo_polling', `Veo generating... (poll #${pollCount}, ${Math.round((Date.now()-t0)/1000)}s elapsed)`, { veo_poll: pollCount });
    }

    // done=true — check for error or silent failure before proceeding
    if (veoOp.error) {
      throw new Error(`Veo generation failed: ${veoOp.error.message || JSON.stringify(veoOp.error)}`);
    }
    if (!veoOp.response?.generatedVideos?.length) {
      throw new Error('Veo returned no video (silent failure — likely a content policy block or quota issue). Try rephrasing your scene.');
    }
    log('veo_done', `Veo finished after ${pollCount} polls (+${Date.now()-t0}ms)`);

    // Make sure Lyria is also done
    await lyriaPromise;

    log('saving', 'Saving video and audio files...');
    const filename = `${show_id}-scene-${scene_number}.mp4`;
    await ai.files.download({ file: veoOp.response.generatedVideos[0].video, downloadPath: join(__dirname, 'public', 'generated', filename) });
    const video_url = `/generated/${filename}`;

    const audioPart = lyriaRes.candidates[0].content.parts.find(p => p.inlineData?.mimeType?.startsWith('audio'));
    const audioFilename = `${show_id}-scene-${scene_number}.mp3`;
    writeFileSync(join(__dirname, 'public', 'generated', audioFilename), Buffer.from(audioPart.inlineData.data, 'base64'));
    const audio_url = `/generated/${audioFilename}`;

    log('saving_db', 'Saving to database...');
    await sql`
      INSERT INTO episodes (show_id, episode_number, title, story_prompt, veo_clip_url, lyria_track_url)
      VALUES (${show_id}, ${scene_number}, ${prompts.episode_title}, ${prompts.story_prompt_summary || solution}, ${video_url}, ${audio_url})
      ON CONFLICT DO NOTHING
    `;

    let next_challenge = null;
    if (scene_number < 3) {
      log('next_challenge', 'Generating next challenge...');
      const updatedEpisodes = await sql`SELECT episode_number, title, story_prompt FROM episodes WHERE show_id = ${show_id} ORDER BY episode_number ASC`;
      const updatedHistory = updatedEpisodes.map(e => `Scene ${e.episode_number}: ${e.title} — ${e.story_prompt}`).join(' | ');
      next_challenge = await buildChallenge(scene_number + 1, { characterContext, traitContext, storyHistory: updatedHistory, story_name: story_name || '', show_id });
    }

    const total_ms = Date.now() - t0;
    console.log(`[job:${jobId.slice(0,8)}] DONE in ${total_ms}ms (${Math.round(total_ms/1000)}s)`);
    jobs.set(jobId, {
      status: 'done',
      result: { video_url, audio_url, episode_title: prompts.episode_title, next_challenge, closing_line: prompts.closing_line || null },
      elapsed_ms: total_ms,
      started_at: t0
    });
  } catch (e) {
    const elapsed_ms = Date.now() - t0;
    console.error(`[job:${jobId.slice(0,8)}] ERROR at +${elapsed_ms}ms:`, e.message);
    jobs.set(jobId, { status: 'error', error: e.message, elapsed_ms, started_at: t0 });
  }
}

// Start scene generation job, return job_id immediately
app.post('/api/generate-scene', (req, res) => {
  const { show_id, solution } = req.body;
  if (!show_id || !solution) return res.status(400).json({ error: 'show_id and solution required' });
  const jobId = randomUUID();
  jobs.set(jobId, { status: 'running', step: 'queued', label: 'Starting...', elapsed_ms: 0, started_at: Date.now() });
  runScenePipeline(jobId, req.body);
  res.json({ job_id: jobId });
});

// Poll job progress
app.get('/api/scene-progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Deliver voice moment result to a waiting pipeline job.
// The job may already be at the voice barrier, or it may arrive later —
// both orderings are handled.
app.post('/api/scene-voice-response/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const voice_response = req.body.voice_response ?? null;
  if (job.resolveVoice) {
    // Pipeline is already waiting — unblock it immediately
    job.resolveVoice(voice_response);
    delete job.resolveVoice;
  } else {
    // Pipeline hasn't reached the barrier yet — store for when it arrives
    job.pendingVoiceResponse = voice_response;
  }
  res.json({ ok: true });
});

// Return JSON for any unhandled errors instead of Express HTML
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// WebSocket: browser voice session proxied to Gemini Live
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });

wss.on('connection', async (ws) => {
  let session;
  try {
    session = await ai.live.connect({
      model: 'gemini-2.0-flash-live-001',
      config: {
        responseModalities: ['AUDIO'],
        systemInstruction: {
          parts: [{ text: 'You are a gentle, curious creative director for a children\'s animated show. You help kids describe characters and stories in a warm, age-appropriate way. Keep responses short and encouraging.' }]
        },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
        }
      },
      callbacks: {
        onopen: () => ws.send(JSON.stringify({ type: 'ready' })),
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                ws.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
              }
              if (part.text) {
                ws.send(JSON.stringify({ type: 'transcript', text: part.text }));
              }
            }
          }
        },
        onerror: (e) => ws.send(JSON.stringify({ type: 'error', message: String(e) })),
        onclose: () => { if (ws.readyState === ws.OPEN) ws.close(); }
      }
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: String(e) }));
    ws.close();
    return;
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'audio') {
        session.sendRealtimeInput({
          audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' }
        });
      }
    } catch (_) {}
  });

  ws.on('close', () => { try { session.close(); } catch (_) {} });
});

initDb().then(() => {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
});
