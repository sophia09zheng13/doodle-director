import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const models = await ai.models.list();
for await (const model of models) {
  if (model.name.includes('veo') || model.name.includes('video')) {
    console.log(model.name, '|', model.supportedActions);
  }
}
