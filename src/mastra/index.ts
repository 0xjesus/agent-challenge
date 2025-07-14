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
      return decodedContent;
    }
  } catch (error: any) {
    // File doesn't exist or can't be read
    return null;
  }
  return null;
}

async function getProjectStructure(octokit: Octokit, owner: string, repo: string): Promise<string> {
  console.log(`📂 [Structure] Scanning project structure for ${owner}/${repo}`);
  
  try {
    // Get the complete repository tree
    const { data: repoTree } = await octokit.git.getTree({ 
      owner, 
      repo, 
      tree_sha: 'HEAD',
      recursive: 'true'
    });
    
    console.log(`📊 [Structure] Found ${repoTree.tree.length} total items in repository`);
    
    // Create a directory structure representation
    const structure = {
      files: [] as string[],
      directories: [] as string[],
      keyFiles: [] as { path: string; content: string }[]
    };
    
    // Categorize items
    repoTree.tree.forEach(item => {
      if (item.path) {
        if (item.type === 'tree') {
          structure.directories.push(item.path);
        } else if (item.type === 'blob') {
          structure.files.push(item.path);
        }
      }
    });
    
    console.log(`📁 [Structure] ${structure.files.length} files, ${structure.directories.length} directories`);
    
    // Identify key files to read content from
    const keyFilePatterns = [
      'package.json',
      'README.md',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      '.env.example',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'tsconfig.json',
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts'
    ];
    
    const importantExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c'];
    const excludePatterns = ['node_modules/', 'dist/', 'build/', '.git/', 'coverage/', '__pycache__/', 'target/'];
    
    // Get key configuration files
    for (const pattern of keyFilePatterns) {
      const foundFile = structure.files.find(f => f === pattern || f.endsWith(`/${pattern}`));
      if (foundFile) {
        const content = await getFileContent(octokit, owner, repo, foundFile);
        if (content) {
          structure.keyFiles.push({ path: foundFile, content });
          console.log(`📄 [Structure] Read key file: ${foundFile} (${content.length} chars)`);
        }
      }
    }
    
    // Get main source files (limit to avoid overwhelming)
    const sourceFiles = structure.files
      .filter(f => {
        const hasImportantExtension = importantExtensions.some(ext => f.endsWith(ext));
        const isNotExcluded = !excludePatterns.some(pattern => f.includes(pattern));
        const isInSrcOrRoot = f.startsWith('src/') || !f.includes('/');
        return hasImportantExtension && isNotExcluded && isInSrcOrRoot;
      })
      .slice(0, 10); // Limit to prevent context overflow
    
    console.log(`💻 [Structure] Reading ${sourceFiles.length} source files:`, sourceFiles);
    
    for (const filePath of sourceFiles) {
      const content = await getFileContent(octokit, owner, repo, filePath);
      if (content) {
        // Truncate large files
        const truncatedContent = content.length > 1500 ? 
          content.substring(0, 1500) + '\n... [truncated for brevity]' : content;
        structure.keyFiles.push({ path: filePath, content: truncatedContent });
      }
    }
    
    // Build structure summary
    let structureSummary = `# Project Structure\n\n`;
    
    // Root files
    const rootFiles = structure.files.filter(f => !f.includes('/'));
    if (rootFiles.length > 0) {
      structureSummary += `## Root Files\n${rootFiles.map(f => `- ${f}`).join('\n')}\n\n`;
    }
    
    // Main directories
    const mainDirs = structure.directories.filter(d => !d.includes('/'));
    if (mainDirs.length > 0) {
      structureSummary += `## Main Directories\n${mainDirs.map(d => `- ${d}/`).join('\n')}\n\n`;
    }
    
    // Source files in src/
    const srcFiles = structure.files.filter(f => f.startsWith('src/'));
    if (srcFiles.length > 0) {
      structureSummary += `## Source Files (src/)\n${srcFiles.slice(0, 20).map(f => `- ${f}`).join('\n')}\n\n`;
    }
    
    // File contents
    if (structure.keyFiles.length > 0) {
      structureSummary += `## File Contents\n\n`;
      for (const { path, content } of structure.keyFiles) {
        structureSummary += `### ${path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }
    }
    
    console.log(`✅ [Structure] Generated structure summary: ${structureSummary.length} characters`);
    return structureSummary;
    
  } catch (error: any) {
    console.error(`❌ [Structure] Failed to get project structure: ${error.message}`);
    return 'Unable to analyze project structure.';
  }
}

export const mastra = new Mastra({
  agents: { readmeAgent },
  server: {
    port: 8383,
    middleware: [
      async (c, next) => {
        if (c.req.method === 'POST' && c.req.path === '/api/github-webhook') {
          console.log('🚀 [Webhook] Received GitHub push webhook');
          
          try {
            const payload = await c.req.json();
            const pushData = pushPayloadSchema.parse(payload);

            if (!pushData.head_commit) {
              console.log('❌ [Webhook] No head_commit found, skipping');
              return c.json({ status: 'skipped', reason: 'No head_commit found' });
            }

            const commitMessage = pushData.head_commit.message;
            console.log(`📝 [Webhook] Commit message: "${commitMessage}"`);
            
            // PREVENT INFINITE LOOPS - Skip bot commits
            if (commitMessage.includes('[AI]') || commitMessage.includes('AI README Bot')) {
              console.log('🤖 [Webhook] Skipping AI bot commit to prevent loops');
              return c.json({ status: 'skipped', reason: 'AI bot commit detected' });
            }

            // Only process default branch
            const defaultBranchRef = `heads/${pushData.repository.default_branch}`;
            if (pushData.ref !== `refs/${defaultBranchRef}`) {
              console.log(`🚫 [Webhook] Not default branch (${pushData.ref}), skipping`);
              return c.json({ status: 'skipped', reason: 'Not default branch' });
            }

            const owner = pushData.repository.owner.login;
            const repo = pushData.repository.name;
            console.log(`🎯 [Webhook] Processing ${owner}/${repo} on default branch`);

            // Initialize GitHub API
            if (!process.env.GITHUB_TOKEN) {
              console.error('❌ [GitHub] GITHUB_TOKEN not found in environment');
              return c.json({ success: false, error: 'GitHub token not configured' }, 500);
            }

            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            
            // Get changed files info
            const allChangedFiles = [
              ...pushData.head_commit.added,
              ...pushData.head_commit.modified,
              ...pushData.head_commit.removed
            ];

            console.log(`📁 [Files] Changed files summary:`);
            console.log(`   Added: ${pushData.head_commit.added.length} files`);
            console.log(`   Modified: ${pushData.head_commit.modified.length} files`);
            console.log(`   Removed: ${pushData.head_commit.removed.length} files`);
            if (allChangedFiles.length > 0) {
              console.log(`   Files: ${allChangedFiles.join(', ')}`);
            }

            // Get complete project structure and content
            const projectStructure = await getProjectStructure(octokit, owner, repo);

            // Build comprehensive prompt for AI
            const aiPrompt = `
You are tasked with creating a comprehensive README.md for this project.

# Repository Information
- **Repository:** ${owner}/${repo}
- **Recent commit:** ${commitMessage}
- **Changed files:** ${allChangedFiles.length} files (${pushData.head_commit.added.length} added, ${pushData.head_commit.modified.length} modified, ${pushData.head_commit.removed.length} removed)

# Recent Changes
${allChangedFiles.length > 0 ? allChangedFiles.map(file => `- ${file}`).join('\n') : 'No specific files changed in this commit'}

# Complete Project Analysis
${projectStructure}

# Task
Generate a professional, comprehensive README.md that includes:

1. **Project Title and Description** - Clear explanation of what this project does
2. **Installation Instructions** - How to set up and run the project
3. **Usage Examples** - Basic usage or getting started guide
4. **Project Structure** - Brief overview of main directories/files
5. **Dependencies** - Key technologies and frameworks used
6. **Contributing** - Basic contribution guidelines if applicable
7. **License** - If license information is available

Make sure the README accurately reflects the current state of the project based on the code and files you can see. Be specific about the technology stack and actual functionality you can identify from the code.

Generate the complete README.md content:
            `.trim();

            console.log(`🧠 [AI] Sending prompt to agent (${aiPrompt.length} characters)`);

            // Generate README with AI
            const agent = mastra.getAgent('readmeAgent');
            const response = await agent.generate([{ role: 'user', content: aiPrompt }]);
            const newReadmeContent = response.text;

            if (!newReadmeContent || newReadmeContent.length < 100) {
              console.error(`❌ [AI] Generated README too short: ${newReadmeContent?.length || 0} chars`);
              return c.json({ success: false, error: 'Generated README too short or empty' }, 500);
            }

            console.log(`✅ [AI] Generated README: ${newReadmeContent.length} characters`);

            // Get existing README SHA if it exists
            let existingFileSha: string | undefined;
            try {
              const { data: existingFileData } = await octokit.repos.getContent({ owner, repo, path: 'README.md' });
              existingFileSha = (existingFileData as any).sha;
              console.log(`📖 [Update] Found existing README.md with SHA: ${existingFileSha}`);
            } catch (error: any) {
              if (error.status === 404) {
                console.log('📝 [Update] No existing README.md found, will create new one');
              } else {
                throw error;
              }
            }

            // Commit the updated README
            const commitResult = await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: 'README.md',
              message: 'docs: [AI] Update README.md based on project analysis',
              content: Buffer.from(newReadmeContent).toString('base64'),
              sha: existingFileSha,
              committer: { 
                name: 'AI README Bot', 
                email: 'bot@nosana.io' 
              },
              branch: pushData.repository.default_branch
            });

            console.log(`🎉 [Success] README.md updated successfully!`);
            console.log(`🔗 [Success] Commit URL: ${commitResult.data.commit.html_url}`);

            return c.json({ 
              success: true, 
              message: "README.md updated based on project analysis",
              repository: `${owner}/${repo}`,
              filesAnalyzed: allChangedFiles.length,
              readmeLength: newReadmeContent.length,
              commit_sha: commitResult.data.commit.sha,
              commit_url: commitResult.data.commit.html_url
            });

          } catch (error: any) {
            console.error(`💥 [ERROR] Webhook processing failed:`);
            console.error(`   Error: ${error.name}: ${error.message}`);
            
            if (error.response?.data) {
              console.error(`   GitHub API Error:`, error.response.data);
            }
            
            return c.json({ 
              success: false, 
              error: 'Webhook processing failed', 
              details: error.message 
            }, 500);
          }
        }
        
        await next();
      },
    ],
  },
});