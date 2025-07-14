# Agent Challenge

## About The Project
This project is an agent framework built using Mastra, designed to facilitate the development and deployment of various agents. It includes agents for monitoring GitHub pull requests and a weather agent, leveraging AI capabilities through dependencies like OpenAI and Ollama. The project is structured to support easy deployment and management of these agents in a cloud environment, utilizing Nosana for job posting and deployment.

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
For building the project, you can use:
```
pnpm run build
```
To start the application, execute:
```
pnpm run start
```
You can also deploy the agents using the following commands:
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

This project also includes development dependencies such as `@biomejs/biome`, `@nosana/cli`, and `typescript` for an enhanced development experience.