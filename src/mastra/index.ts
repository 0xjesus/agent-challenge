// src/mastra/index.ts

import { Mastra } from "@mastra/core";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { readmeAgent } from "./agents/github-pr-monitor";

const pushPayloadSchema = z.object({
  ref: z.string(),
  head_commit: z.object({
    message: z.string(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    modified: z.array(z.string()),
  }).nullable(),
  repository: z.object({
    name: z.string(),
    owner: z.object({
      login: z.string(),
    }),
    default_branch: z.string(),
  }),
});

async function getFileContent(octokit: Octokit, owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const { data: fileData } = await octokit.repos.getContent({ owner, repo, path });
    if ('content' in fileData) {
      return Buffer.from(fileData.content, 'base64').toString('utf-8');
    }
  } catch (error: any) {
    if (error.status === 404) {
      console.log(`File ${path} not found (might be deleted)`);
    } else {
      console.error(`Error fetching ${path}:`, error.message);
    }
  }
  return null;
}

async function getRelevantChangedFiles(octokit: Octokit, owner: string, repo: string, changedFiles: string[]): Promise<string> {
  const relevantExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.php', '.rb', '.swift', '.kt', '.cs', '.vue', '.svelte', '.md', '.json', '.yaml', '.yml', '.toml', '.sql'];
  const excludePatterns = ['/node_modules/', '/dist/', '/build/', '/.git/', '/coverage/', '/temp/', '/tmp/'];
  
  const relevantFiles = changedFiles.filter(file => {
    // Check if file has relevant extension
    const hasRelevantExtension = relevantExtensions.some(ext => file.endsWith(ext));
    // Check if file is not in excluded directories
    const isNotExcluded = !excludePatterns.some(pattern => file.includes(pattern));
    
    return hasRelevantExtension && isNotExcluded;
  });

  // Limit to most important files to avoid context overflow
  const priorityFiles = relevantFiles.slice(0, 10);
  
  let changedContent = '';
  
  for (const filePath of priorityFiles) {
    const content = await getFileContent(octokit, owner, repo, filePath);
    if (content) {
      changedContent += `\n--- ${filePath} ---\n${content}\n`;
    }
  }

  return changedContent;
}

export const mastra = new Mastra({
  agents: { readmeAgent },
  server: {
    port: 8383,
    middleware: [
      async (c, next) => {
        if (c.req.method === 'POST' && c.req.path === '/api/github-webhook') {
          console.log('GitHub Push webhook received!');
          
          try {
            const payload = await c.req.json();
            const pushData = pushPayloadSchema.parse(payload);

            if (!pushData.head_commit) {
                return c.json({ status: 'skipped', reason: 'No head_commit found' });
            }

            if (pushData.head_commit.message.includes('[AI]')) {
              console.log('Push was from our AI bot. Skipping to prevent loop.');
              return c.json({ status: 'skipped', reason: 'AI commit' });
            }

            const defaultBranchRef = `heads/${pushData.repository.default_branch}`;
            if (pushData.ref !== `refs/${defaultBranchRef}`) {
              console.log(`Push was to branch ${pushData.ref}, not default branch. Skipping.`);
              return c.json({ status: 'skipped', reason: 'Not default branch' });
            }

            const owner = pushData.repository.owner.login;
            const repo = pushData.repository.name;
            console.log(`Push to default branch detected. Generating README for ${owner}/${repo}`);

            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            
            // Get all changed files from the push
            const allChangedFiles = [
              ...pushData.head_commit.added,
              ...pushData.head_commit.modified,
              ...pushData.head_commit.removed
            ];

            console.log(`Processing ${allChangedFiles.length} changed files:`, allChangedFiles);

            // Get package.json for project context
            let packageJsonContent = '';
            try {
              const { data: packageJsonData } = await octokit.repos.getContent({ owner, repo, path: 'package.json' });
              packageJsonContent = Buffer.from((packageJsonData as any).content, 'base64').toString('utf-8');
            } catch (error) {
              console.log('package.json not found, continuing without it');
            }

            // Get existing README for context
            let existingReadme = '';
            try {
              const { data: readmeData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingReadme = Buffer.from((readmeData as any).content, 'base64').toString('utf-8');
            } catch (error) {
              console.log('README.md not found, will create new one');
            }

            // Get content of relevant changed files only
            const changedFilesContent = await getRelevantChangedFiles(octokit, owner, repo, allChangedFiles);

            // Build focused context for AI
            const contentToAnalyze = `
Project: ${repo}
Recent changes summary: ${pushData.head_commit.message}

Files changed in this push:
${allChangedFiles.map(file => `- ${file}`).join('\n')}

${packageJsonContent ? `Package.json:\n${packageJsonContent}\n` : ''}

${existingReadme ? `Current README.md:\n${existingReadme}\n` : ''}

Content of changed files:
${changedFilesContent}

Please update the README.md based on these recent changes. Keep the existing structure but update relevant sections to reflect the new changes.
            `.trim();

            const agent = mastra.getAgent('readmeAgent');
            const response = await agent.generate([{ role: 'user', content: contentToAnalyze }]);
            const readmeContent = response.text;

            console.log('--- README.md content generated by AI ---');

            let existingFileSha: string | undefined;
            try {
              const { data: existingFileData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingFileSha = (existingFileData as any).sha;
            } catch (error: any) {
              if (error.status !== 404) throw error;
              console.log('README.md not found. Creating a new one.');
            }

            await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: 'README.md',
              message: 'docs: [AI] Update README.md based on recent changes',
              content: Buffer.from(readmeContent).toString('base64'),
              sha: existingFileSha,
              committer: { name: 'AI README Bot', email: 'bot@nosana.io' },
              branch: pushData.repository.default_branch
            });

            console.log(`Successfully updated README.md in ${repo}.`);
            return c.json({ 
              success: true, 
              message: "README updated",
              filesProcessed: allChangedFiles.length,
              relevantFiles: changedFilesContent ? 'Content analyzed' : 'No relevant files found'
            });

          } catch (error) {
            console.error('Error processing push webhook:', error);
            return c.json({ success: false, error: 'Failed to process push' }, 500);
          }
        }
        await next();
      },
    ],
  },
});