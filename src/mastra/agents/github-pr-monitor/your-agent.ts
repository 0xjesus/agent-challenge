// src/mastra/agents/github-pr-monitor.ts

import { Agent } from '@mastra/core';
import { z } from 'zod';
import { model } from '../config'; // Importamos el modelo desde la configuración

// Definimos el nombre de nuestro agente
const name = 'github-pr-monitor';

// Estas son las instrucciones para la IA. Es la parte más importante.
// Le decimos qué hacer y CÓMO queremos la respuesta (en formato JSON).
const instructions = `
  You are an expert software engineering assistant. Your task is to analyze GitHub Pull Requests.
  Based on the provided title and body of the pull request, you must perform two actions:
  1.  **Classify the PR**: Categorize it into one of the following types: 'Feature', 'Bugfix', 'Documentation', 'Chore', 'Test', or 'Refactor'.
  2.  **Analyze Sentiment**: Determine the sentiment of the PR description. Is it 'Positive', 'Neutral', or 'Negative'?

  You MUST provide your response as a single, minified JSON object with no markdown formatting.
  The JSON object must have two keys: "category" and "sentiment".

  Example response for a new feature PR:
  {"category":"Feature","sentiment":"Positive"}
`;

// Creamos el agente con su configuración
export const githubAgent = new Agent({
  name,
  instructions,
  model,
});

// Definimos la estructura de datos que esperamos de GitHub (solo lo que necesitamos)
// Esto nos da seguridad y autocompletado en el código.
const pullRequestPayloadSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
  }),
  repository: z.object({
    name: z.string(),
    owner: z.object({
      login: z.string(),
    }),
  }),
});

// --- Aquí ocurre la magia ---
// El agente se suscribe al evento 'pull_request' de GitHub.
// Esto se ejecutará cada vez que se abra o edite un PR.
githubAgent.on('github:pull_request', async ({ payload, mastra }) => {
  // Validamos que el payload de GitHub tenga la estructura que esperamos
  const prData = pullRequestPayloadSchema.parse(payload);

  // Solo actuamos cuando un PR es abierto ('opened')
  if (prData.action !== 'opened') {
    console.log(`Action is '${prData.action}', not 'opened'. Skipping.`);
    return;
  }

  console.log(`Analyzing PR #${prData.pull_request.number}: "${prData.pull_request.title}"`);

  // Combinamos título y cuerpo para darle más contexto a la IA
  const contentToAnalyze = `Title: ${prData.pull_request.title}\n\nBody: ${prData.pull_request.body || 'No description provided.'}`;

  try {
    // 1. Llamamos a la IA con el contenido del PR
    const response = await mastra.ai.chat(contentToAnalyze);
    console.log('IA Response:', response);

    // 2. Interpretamos la respuesta JSON de la IA
    const analysis = JSON.parse(response);
    const { category, sentiment } = analysis;

    // 3. Preparamos el comentario para publicar en GitHub
    const commentBody = `
      🤖 **Análisis de IA por Agente Nosana**
      
      * **Clasificación:** \`${category}\`
      * **Sentimiento del Autor:** \`${sentiment}\`
      
      Este es un análisis automático para ayudar al equipo de mantenedores.
    `;

    // 4. Publicamos el comentario en el PR
    // (NOTA: Esto requiere configurar la integración con GitHub en Mastra/Nosana)
    // await mastra.github.addComment({
    //   owner: prData.repository.owner.login,
    //   repo: prData.repository.name,
    //   issue_number: prData.pull_request.number,
    //   body: commentBody,
    // });
    
    console.log('--- COMMENT TO POST ---');
    console.log(commentBody);
    console.log('--------------------');


    console.log(`Successfully analyzed and commented on PR #${prData.pull_request.number}.`);
  } catch (error) {
    console.error('Error processing PR with AI:', error);
  }
});