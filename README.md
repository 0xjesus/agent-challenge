# Agent Challenge

## About The Project
This project is an agent framework built using Mastra, designed to facilitate the development and deployment of various agents, including a GitHub Pull Request monitor and a weather agent. It leverages several AI and logging libraries to enhance functionality and performance, making it suitable for hackathons and other collaborative coding events.

## Installation
To install the necessary dependencies, run the following command:
```
pnpm install
```

## Usage
To run the project in development mode, use the following command:
```
pnpm run dev
```
You can also build and start the project using:
```
pnpm run build
pnpm run start
```
For deploying agents, you can use:
```
pnpm run deploy:agent
pnpm run deploy:qwen
```

## Key Dependencies
- `@ai-sdk/openai`: ^1.3.22
- `@mastra/core`: ^0.10.5
- `@mastra/libsql`: ^0.10.2
- `@mastra/loggers`: ^0.10.2
- `@mastra/memory`: ^0.10.3
- `@octokit/rest`: ^22.0.0
- `dotenv`: ^16.5.0
- `ollama-ai-provider`: ^1.2.0
- `zod`: ^3.25.67

## Development Dependencies
- `@biomejs/biome`: 2.0.4
- `@nosana/cli`: ^1.0.52
- `@types/node`: ^24.0.3
- `mastra`: ^0.10.5
- `typescript`: ^5.8.3