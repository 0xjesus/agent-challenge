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
  console.log(`🔍 [getFileContent] Attempting to fetch file: ${owner}/${repo}/${path}`);
  
  try {
    console.log(`📡 [getFileContent] Making API call to GitHub for ${path}`);
    const { data: fileData } = await octokit.repos.getContent({ owner, repo, path });
    
    console.log(`✅ [getFileContent] Successfully received data for ${path}. Type:`, typeof fileData);
    console.log(`📄 [getFileContent] File data keys:`, Object.keys(fileData));
    
    if ('content' in fileData) {
      console.log(`🔓 [getFileContent] File has content property, decoding base64 for ${path}`);
      const decodedContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
      console.log(`📝 [getFileContent] Content length for ${path}: ${decodedContent.length} characters`);
      console.log(`📋 [getFileContent] First 100 chars of ${path}:`, decodedContent.substring(0, 100));
      return decodedContent;
    } else {
      console.log(`❌ [getFileContent] File ${path} doesn't have content property`);
      console.log(`🔍 [getFileContent] Available properties:`, Object.keys(fileData));
    }
  } catch (error: any) {
    console.error(`💥 [getFileContent] Error fetching ${path}:`);
    console.error(`   Status: ${error.status}`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Full error:`, error);
    
    if (error.status === 404) {
      console.log(`🚫 [getFileContent] File ${path} not found (might be deleted)`);
    } else {
      console.error(`⚠️ [getFileContent] Unexpected error for ${path}:`, error.message);
    }
  }
  
  console.log(`❌ [getFileContent] Returning null for ${path}`);
  return null;
}

async function getRelevantChangedFiles(octokit: Octokit, owner: string, repo: string, changedFiles: string[]): Promise<string> {
  console.log(`🎯 [getRelevantChangedFiles] Starting with ${changedFiles.length} files:`, changedFiles);
  
  const relevantExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.php', '.rb', '.swift', '.kt', '.cs', '.vue', '.svelte', '.md', '.json', '.yaml', '.yml', '.toml', '.sql'];
  const excludePatterns = ['/node_modules/', '/dist/', '/build/', '/.git/', '/coverage/', '/temp/', '/tmp/'];
  
  console.log(`📝 [getRelevantChangedFiles] Relevant extensions:`, relevantExtensions);
  console.log(`🚫 [getRelevantChangedFiles] Exclude patterns:`, excludePatterns);
  
  const relevantFiles = changedFiles.filter(file => {
    console.log(`🔍 [getRelevantChangedFiles] Checking file: ${file}`);
    
    // Check if file has relevant extension
    const hasRelevantExtension = relevantExtensions.some(ext => file.endsWith(ext));
    console.log(`   Extension check: ${hasRelevantExtension}`);
    
    // Check if file is not in excluded directories
    const isNotExcluded = !excludePatterns.some(pattern => file.includes(pattern));
    console.log(`   Exclusion check: ${isNotExcluded}`);
    
    const isRelevant = hasRelevantExtension && isNotExcluded;
    console.log(`   Final result: ${isRelevant ? '✅ INCLUDED' : '❌ EXCLUDED'}`);
    
    return isRelevant;
  });

  console.log(`✅ [getRelevantChangedFiles] Filtered to ${relevantFiles.length} relevant files:`, relevantFiles);

  // Limit to most important files to avoid context overflow
  const priorityFiles = relevantFiles.slice(0, 10);
  console.log(`🎯 [getRelevantChangedFiles] Limited to ${priorityFiles.length} priority files:`, priorityFiles);
  
  let changedContent = '';
  
  for (let i = 0; i < priorityFiles.length; i++) {
    const filePath = priorityFiles[i];
    console.log(`📁 [getRelevantChangedFiles] Processing file ${i + 1}/${priorityFiles.length}: ${filePath}`);
    
    const content = await getFileContent(octokit, owner, repo, filePath);
    if (content) {
      console.log(`✅ [getRelevantChangedFiles] Got content for ${filePath}, adding to result`);
      changedContent += `\n--- ${filePath} ---\n${content}\n`;
    } else {
      console.log(`❌ [getRelevantChangedFiles] No content for ${filePath}, skipping`);
    }
  }

  console.log(`📊 [getRelevantChangedFiles] Final content length: ${changedContent.length} characters`);
  return changedContent;
}

export const mastra = new Mastra({
  agents: { readmeAgent },
  server: {
    port: 8383,
    middleware: [
      async (c, next) => {
        console.log(`🌐 [Middleware] ${c.req.method} ${c.req.path}`);
        
        if (c.req.method === 'POST' && c.req.path === '/api/github-webhook') {
          console.log('🎉 GitHub Push webhook received!');
          console.log(`🕒 [Webhook] Timestamp: ${new Date().toISOString()}`);
          
          try {
            console.log('📥 [Webhook] Parsing request body...');
            const payload = await c.req.json();
            console.log('✅ [Webhook] Request body parsed successfully');
            console.log('🔍 [Webhook] Payload keys:', Object.keys(payload));
            console.log('📋 [Webhook] Raw payload preview:', JSON.stringify(payload, null, 2).substring(0, 500));

            console.log('🔍 [Webhook] Validating payload schema...');
            const pushData = pushPayloadSchema.parse(payload);
            console.log('✅ [Webhook] Payload schema validation passed');
            console.log('📊 [Webhook] Parsed data:', {
              ref: pushData.ref,
              repository: pushData.repository.name,
              owner: pushData.repository.owner.login,
              default_branch: pushData.repository.default_branch,
              head_commit_exists: !!pushData.head_commit
            });

            if (!pushData.head_commit) {
                console.log('❌ [Webhook] No head_commit found, skipping');
                return c.json({ status: 'skipped', reason: 'No head_commit found' });
            }

            console.log('📝 [Webhook] Head commit message:', pushData.head_commit.message);
            if (pushData.head_commit.message.includes('[AI]')) {
              console.log('🤖 [Webhook] Push was from our AI bot. Skipping to prevent loop.');
              return c.json({ status: 'skipped', reason: 'AI commit' });
            }

            const defaultBranchRef = `heads/${pushData.repository.default_branch}`;
            console.log('🌿 [Webhook] Expected branch ref:', `refs/${defaultBranchRef}`);
            console.log('🌿 [Webhook] Actual branch ref:', pushData.ref);
            
            if (pushData.ref !== `refs/${defaultBranchRef}`) {
              console.log(`🚫 [Webhook] Push was to branch ${pushData.ref}, not default branch. Skipping.`);
              return c.json({ status: 'skipped', reason: 'Not default branch' });
            }

            const owner = pushData.repository.owner.login;
            const repo = pushData.repository.name;
            console.log(`🎯 [Webhook] Push to default branch detected. Generating README for ${owner}/${repo}`);

            console.log('🔑 [GitHub] Initializing Octokit...');
            console.log('🔑 [GitHub] GitHub token exists:', !!process.env.GITHUB_TOKEN);
            console.log('🔑 [GitHub] GitHub token length:', process.env.GITHUB_TOKEN?.length || 0);
            
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            console.log('✅ [GitHub] Octokit initialized successfully');
            
            // Get all changed files from the push
            const allChangedFiles = [
              ...pushData.head_commit.added,
              ...pushData.head_commit.modified,
              ...pushData.head_commit.removed
            ];

            console.log(`📁 [Files] Processing ${allChangedFiles.length} changed files:`);
            console.log('   Added:', pushData.head_commit.added);
            console.log('   Modified:', pushData.head_commit.modified);
            console.log('   Removed:', pushData.head_commit.removed);

            // Get package.json for project context
            console.log('📦 [Package] Attempting to fetch package.json...');
            let packageJsonContent = '';
            try {
              const { data: packageJsonData } = await octokit.repos.getContent({ owner, repo, path: 'package.json' });
              packageJsonContent = Buffer.from((packageJsonData as any).content, 'base64').toString('utf-8');
              console.log('✅ [Package] package.json found and decoded');
              console.log('📋 [Package] Content preview:', packageJsonContent.substring(0, 200));
            } catch (error: any) {
              console.log('❌ [Package] package.json not found, continuing without it');
              console.log('   Error:', error.message);
            }

            // Get existing README for context
            console.log('📖 [README] Attempting to fetch existing README.md...');
            let existingReadme = '';
            try {
              const { data: readmeData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingReadme = Buffer.from((readmeData as any).content, 'base64').toString('utf-8');
              console.log('✅ [README] Existing README.md found and decoded');
              console.log('📋 [README] Current length:', existingReadme.length);
              console.log('📋 [README] Preview:', existingReadme.substring(0, 200));
            } catch (error: any) {
              console.log('❌ [README] README.md not found, will create new one');
              console.log('   Error:', error.message);
            }

            // Get content of relevant changed files only
            console.log('🔄 [Content] Getting content of relevant changed files...');
            const changedFilesContent = await getRelevantChangedFiles(octokit, owner, repo, allChangedFiles);
            console.log('✅ [Content] Finished getting changed files content');

            // Build focused context for AI
            console.log('🧠 [AI] Building context for AI agent...');
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

            console.log('📏 [AI] Context length:', contentToAnalyze.length);
            console.log('📋 [AI] Context preview:', contentToAnalyze.substring(0, 300));

            console.log('🤖 [Agent] Getting readmeAgent...');
            const agent = mastra.getAgent('readmeAgent');
            console.log('✅ [Agent] readmeAgent retrieved successfully');
            
            console.log('🚀 [Agent] Calling agent.generate...');
            const response = await agent.generate([{ role: 'user', content: contentToAnalyze }]);
            console.log('✅ [Agent] Agent.generate completed');
            console.log('📝 [Agent] Response type:', typeof response);
            console.log('📝 [Agent] Response keys:', Object.keys(response));
            
            const readmeContent = response.text;
            console.log('📖 [Agent] Generated README length:', readmeContent?.length || 0);
            console.log('📋 [Agent] Generated README preview:', readmeContent?.substring(0, 200));

            console.log('--- 🎯 README.md content generated by AI ---');

            console.log('🔍 [Update] Checking if README.md already exists...');
            let existingFileSha: string | undefined;
            try {
              const { data: existingFileData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingFileSha = (existingFileData as any).sha;
              console.log('✅ [Update] Found existing README.md with SHA:', existingFileSha);
            } catch (error: any) {
              if (error.status !== 404) {
                console.error('💥 [Update] Unexpected error checking existing README:', error);
                throw error;
              }
              console.log('❌ [Update] README.md not found. Creating a new one.');
            }

            console.log('💾 [Commit] Creating/updating README.md...');
            console.log('📊 [Commit] Commit details:', {
              owner,
              repo,
              path: 'README.md',
              branch: pushData.repository.default_branch,
              hasSha: !!existingFileSha,
              contentLength: readmeContent?.length || 0
            });

            const commitResult = await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: 'README.md',
              message: 'docs: [AI] Update README.md based on recent changes',
              content: Buffer.from(readmeContent).toString('base64'),
              sha: existingFileSha,
              committer: { name: 'AI README Bot', email: 'bot@nosana.io' },
              branch: pushData.repository.default_branch
            });

            console.log('✅ [Commit] Successfully updated README.md');
            console.log('📊 [Commit] Commit result:', {
              commit_sha: commitResult.data.commit.sha,
              commit_url: commitResult.data.commit.html_url
            });

            const result = { 
              success: true, 
              message: "README updated",
              filesProcessed: allChangedFiles.length,
              relevantFiles: changedFilesContent ? 'Content analyzed' : 'No relevant files found',
              commit_sha: commitResult.data.commit.sha
            };

            console.log('🎉 [Success] Final result:', result);
            return c.json(result);

          } catch (error: any) {
            console.error('💥💥💥 [ERROR] Error processing push webhook:');
            console.error('   Name:', error.name);
            console.error('   Message:', error.message);
            console.error('   Stack:', error.stack);
            console.error('   Full error object:', error);
            
            if (error.response) {
              console.error('   Response status:', error.response.status);
              console.error('   Response data:', error.response.data);
            }
            
            return c.json({ success: false, error: 'Failed to process push', details: error.message }, 500);
          }
        }
        
        console.log('🔄 [Middleware] Calling next middleware...');
        await next();
      },
    ],
  },
});