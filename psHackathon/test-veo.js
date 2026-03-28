import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

console.log('Starting Veo 3.1 generation...');
const t0 = Date.now();

let operation = await ai.models.generateVideos({
  model: 'veo-3.1-fast-generate-001',
  prompt: 'A round purple cartoon creature with one wobbly antenna walks through a sunny meadow, hand-drawn doodle animation style, slow and gentle pacing',
  config: {
    aspectRatio: '16:9',
    durationSeconds: 8,
  },
});

console.log(`Job submitted in ${Date.now() - t0}ms`);
let polls = 0;
const TIMEOUT = 8 * 60 * 1000;

while (!operation.done) {
  if (Date.now() - t0 > TIMEOUT) {
    console.error('TIMEOUT after', Math.round((Date.now()-t0)/1000) + 's');
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 10000));
  polls++;
  operation = await ai.operations.getVideosOperation({ operation });
  console.log(`Poll #${polls} | done: ${operation.done} | ${Math.round((Date.now()-t0)/1000)}s elapsed`);
}

if (operation.error) {
  console.error('Veo error:', operation.error);
  process.exit(1);
}
if (!operation.response?.generatedVideos?.length) {
  console.error('Silent failure: done=true but no videos returned');
  process.exit(1);
}

const video = operation.response.generatedVideos[0];
await ai.files.download({ file: video.video, downloadPath: 'blobby-test.mp4' });
console.log(`Done in ${Math.round((Date.now()-t0)/1000)}s after ${polls} polls. Saved to blobby-test.mp4`);
