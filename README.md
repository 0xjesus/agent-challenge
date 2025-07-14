# Agent Challenge

## About The Project
This project is an agent framework built using Mastra, designed to facilitate the development and deployment of various agents, including a GitHub Pull Request Monitor and a Weather Agent. It leverages several dependencies to interact with APIs, manage workflows, and handle data efficiently.

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
- `@ai-sdk/openai`: For integrating OpenAI functionalities.
- `@mastra/core`: Core functionalities of the Mastra framework.
- `@mastra/libsql`: Library for SQL database interactions.
- `@mastra/loggers`: Logging utilities for the Mastra framework.
- `@mastra/memory`: Memory management for agents.
- `@octokit/rest`: GitHub API client for interacting with repositories.
- `dotenv`: For loading environment variables from a .env file.
- `ollama-ai-provider`: AI provider integration.
- `zod`: Schema validation for TypeScript.

This README provides a concise overview of the project, its installation, usage, and key dependencies to help you get started quickly.