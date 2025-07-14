// src/mastra/agents/github-pr-monitor/index.ts

import { Agent } from '@mastra/core';
import { model } from '../../config';

const name = 'readme-assistant';

const instructions = `
  You are an expert technical writer. Your task is to generate a professional README.md file for a software project.
  You will be given the project's file structure and the content of its 'package.json' file.
  
  Based on this information, create a complete README.md in well-formatted Markdown.

  The README must include the following sections:
  1.  A project title.
  2.  A brief "About The Project" section explaining what the project likely does based on its dependencies (e.g., "This is a Mastra agent for a hackathon...").
  3.  An "Installation" section with the exact commands needed (e.g., 'pnpm install').
  4.  A "Usage" section explaining how to run the project (e.g., 'pnpm run dev').
  5.  A "Key Dependencies" section listing the main dependencies from package.json.

  You MUST respond with ONLY the raw Markdown content for the README.md file. Do not include any other text, explanations, or markdown formatting like \`\`\`.
`;

// --- ¡LA LÍNEA CLAVE! ---
// Nos aseguramos de que la variable que exportamos se llame 'readmeAgent'
export const readmeAgent = new Agent({
  name,
  instructions,
  model,
});