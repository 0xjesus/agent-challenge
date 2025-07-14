// src/mastra/config.ts
import { openai } from "@ai-sdk/openai";

// Definimos el modelo que usará nuestro agente.
// 'gpt-4o-mini' es rápido, barato e inteligente, ideal para este hackathon.
export const model = openai("gpt-4o-mini");