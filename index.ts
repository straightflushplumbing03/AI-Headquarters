import { existsSync } from 'node:fs';
import { generateText } from 'ai';

// Load local secrets only when running this example on your own machine.
// Never print or log the key. .env.local is already excluded by .gitignore.
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Missing AI_GATEWAY_API_KEY. Add it to your local .env.local file; do not paste it into chat or commit it.');
  process.exitCode = 1;
} else {
  try {
    const result = await generateText({
      model: 'moonshotai/kimi-k3',
      prompt:
        'Invent a delightful new holiday. Give it a memorable name, explain what it celebrates, and describe three fun traditions people could practice each year.',
    });

    // Only print generated text, never credentials or environment variables.
    console.log(result.text);
  } catch {
    console.error('AI Gateway request failed. Check your local key, network connection, and Vercel AI Gateway access.');
    process.exitCode = 1;
  }
}
