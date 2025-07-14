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
      const decodedContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
      console.log(`✅ [FileRead] ${path}: ${decodedContent.length} chars`);
      return decodedContent;
    }
  } catch (error: any) {
    if (error.status === 404) {
      console.log(`❌ [FileRead] ${path}: Not found`);
    } else {
      console.error(`💥 [FileRead] ${path}: Error - ${error.message}`);
    }
  }
  return null;
}

async function getProjectContext(octokit: Octokit, owner: string, repo: string, changedFiles: string[]): Promise<string> {
  console.log(`🔍 [Context] Analyzing ${changedFiles.length} changed files:`, changedFiles);
  
  const relevantExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.php', '.rb', '.swift', '.kt', '.cs', '.vue', '.svelte', '.md', '.json', '.yaml', '.yml', '.toml', '.sql'];
  const excludePatterns = ['/node_modules/', '/dist/', '/build/', '/.git/', '/coverage/', '/temp/', '/tmp/'];
  
  // Filter relevant files
  const relevantFiles = changedFiles.filter(file => {
    const hasRelevantExtension = relevantExtensions.some(ext => file.endsWith(ext));
    const isNotExcluded = !excludePatterns.some(pattern => file.includes(pattern));
    return hasRelevantExtension && isNotExcluded;
  });

  console.log(`📁 [Context] ${relevantFiles.length} relevant files found:`, relevantFiles);

  let projectContent = '';
  
  // If no relevant files from changes, scan repository for key files
  if (relevantFiles.length === 0) {
    console.log(`🔄 [Context] No relevant changed files, scanning repository...`);
    
    try {
      const { data: repoTree } = await octokit.git.getTree({ 
        owner, 
        repo, 
        tree_sha: 'HEAD',
        recursive: 'true'
      });
      
      const keyFiles = repoTree.tree
        .filter(item => 
          item.type === 'blob' && 
          item.path &&
          relevantExtensions.some(ext => item.path!.endsWith(ext)) &&
          !excludePatterns.some(pattern => item.path!.includes(pattern))
        )
        .slice(0, 8);
      
      console.log(`📂 [Context] Found ${keyFiles.length} key project files:`, keyFiles.map(f => f.path));
      
      for (const file of keyFiles) {
        if (file.path) {
          const content = await getFileContent(octokit, owner, repo, file.path);
          if (content && content.length > 0) {
            // Limit content to avoid overwhelming the AI
            const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '\n...[truncated]' : content;
            projectContent += `\n--- ${file.path} ---\n${truncatedContent}\n`;
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ [Context] Repository scan failed: ${error.message}`);
    }
  } else {
    // Process changed files
    const priorityFiles = relevantFiles.slice(0, 10);
    
    for (const filePath of priorityFiles) {
      const content = await getFileContent(octokit, owner, repo, filePath);
      if (content && content.length > 0) {
        // Limit content to avoid overwhelming the AI
        const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '\n...[truncated]' : content;
        projectContent += `\n--- ${filePath} ---\n${truncatedContent}\n`;
      }
    }
  }

  console.log(`📊 [Context] Total project content: ${projectContent.length} characters`);
  return projectContent;
}

export const mastra = new Mastra({
  agents: { readmeAgent },
  server: {
    port: 8383,
    middleware: [
      async (c, next) => {
        if (c.req.method === 'POST' && c.req.path === '/api/github-webhook') {
          console.log('🚀 [Webhook] GitHub push received');
          
          try {
            const payload = await c.req.json();
            const pushData = pushPayloadSchema.parse(payload);

            if (!pushData.head_commit) {
              console.log('❌ [Webhook] No head_commit, skipping');
              return c.json({ status: 'skipped', reason: 'No head_commit found' });
            }

            console.log(`📝 [Webhook] Commit: "${pushData.head_commit.message}"`);
            
            // REMOVE AI CHECK - Let it update its own README too!
            // This way it can improve the README based on its own updates

            const defaultBranchRef = `heads/${pushData.repository.default_branch}`;
            if (pushData.ref !== `refs/${defaultBranchRef}`) {
              console.log(`🚫 [Webhook] Not default branch, skipping`);
              return c.json({ status: 'skipped', reason: 'Not default branch' });
            }

            const owner = pushData.repository.owner.login;
            const repo = pushData.repository.name;
            console.log(`🎯 [Webhook] Processing ${owner}/${repo}`);

            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            
            // Get all changed files
            const allChangedFiles = [
              ...pushData.head_commit.added,
              ...pushData.head_commit.modified,
              ...pushData.head_commit.removed
            ];

            console.log(`📁 [Files] Changed: ${allChangedFiles.length} files`);
            console.log(`   Added: ${pushData.head_commit.added.length}`);
            console.log(`   Modified: ${pushData.head_commit.modified.length}`);
            console.log(`   Removed: ${pushData.head_commit.removed.length}`);

            // Get package.json for project context
            let packageJsonContent = '';
            const packageContent = await getFileContent(octokit, owner, repo, 'package.json');
            if (packageContent) {
              packageJsonContent = packageContent;
            }

            // Get existing README
            let existingReadme = '';
            const readmeContent = await getFileContent(octokit, owner, repo, 'README.md');
            if (readmeContent) {
              existingReadme = readmeContent;
            }

            // Get project context (changed files or repository scan)
            const projectContext = await getProjectContext(octokit, owner, repo, allChangedFiles);

            // Build AI prompt
            const aiPrompt = `
# README Update Task

## Project Information
- Repository: ${owner}/${repo}
- Recent changes: ${pushData.head_commit.message}
- Files changed: ${allChangedFiles.length} (${pushData.head_commit.added.length} added, ${pushData.head_commit.modified.length} modified, ${pushData.head_commit.removed.length} removed)

## Changed Files List
${allChangedFiles.map(file => `- ${file}`).join('\n')}

## Current Package.json
${packageJsonContent ? packageJsonContent : 'No package.json found'}

## Current README.md
${existingReadme ? existingReadme : 'No existing README found'}

## Project Code Context
${projectContext ? projectContext : 'No relevant code files found'}

## Instructions
Generate a comprehensive and accurate README.md that:
1. Reflects the current state of the project based on the code
2. Includes proper installation instructions if applicable
3. Explains what the project does clearly
4. Documents key features and usage
5. Updates any sections that need to reflect recent changes
6. Maintains a professional and informative tone

Please generate the complete README.md content.
            `.trim();

            console.log(`🧠 [AI] Sending ${aiPrompt.length} characters to agent`);
            console.log(`📋 [AI] Context includes: packageJson=${!!packageJsonContent}, existingReadme=${!!existingReadme}, projectCode=${!!projectContext}`);

            // Generate README with AI
            const agent = mastra.getAgent('readmeAgent');
            const response = await agent.generate([{ role: 'user', content: aiPrompt }]);
            const newReadmeContent = response.text;

            if (!newReadmeContent || newReadmeContent.length < 50) {
              console.error(`❌ [AI] Generated README too short: ${newReadmeContent?.length || 0} chars`);
              return c.json({ success: false, error: 'Generated README too short' }, 500);
            }

            console.log(`✅ [AI] Generated README: ${newReadmeContent.length} characters`);

            // Check if README already exists to get SHA
            let existingFileSha: string | undefined;
            try {
              const { data: existingFileData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingFileSha = (existingFileData as any).sha;
            } catch (error: any) {
              if (error.status !== 404) throw error;
              console.log('📝 [Update] Creating new README.md');
            }

            // Commit the new README
            const commitResult = await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: 'README.md',
              message: 'docs: [AI] Update README.md based on recent changes',
              content: Buffer.from(newReadmeContent).toString('base64'),
              sha: existingFileSha,
              committer: { name: 'AI README Bot', email: 'bot@nosana.io' },
              branch: pushData.repository.default_branch
            });

            console.log(`🎉 [Success] README updated successfully`);
            console.log(`🔗 [Success] Commit: ${commitResult.data.commit.html_url}`);

            return c.json({ 
              success: true, 
              message: "README updated successfully",
              filesProcessed: allChangedFiles.length,
              readmeLength: newReadmeContent.length,
              commit_sha: commitResult.data.commit.sha,
              commit_url: commitResult.data.commit.html_url
            });

          } catch (error: any) {
            console.error(`💥 [ERROR] Webhook processing failed:`);
            console.error(`   ${error.name}: ${error.message}`);
            
            if (error.response) {
              console.error(`   API Response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            }
            
            return c.json({ 
              success: false, 
              error: 'Failed to process webhook', 
              details: error.message 
            }, 500);
          }
        }
        
        await next();
      },
    ],
  },
});