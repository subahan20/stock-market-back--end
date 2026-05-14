import Groq from 'groq-sdk';
import { env } from '../config/env.js';

let groqClient = null;

export function getGroqClient() {
  if (!groqClient && env.groqApiKey) {
    groqClient = new Groq({ apiKey: env.groqApiKey });
  }
  return groqClient;
}

export async function analyzeLiveMarketWithGroq(marketData) {
  const client = getGroqClient();
  if (!client) {
    return { error: 'Groq API key not configured' };
  }

  const prompt = `You are an expert financial analyst. Analyze the following live market data and provide a concise, professional 2-3 sentence insight for the customer about the current market trend:
  
  Data: ${JSON.stringify(marketData, null, 2)}
  `;

  try {
    const chatCompletion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a highly skilled financial analyst. Provide professional, crisp insights. Do not use markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.5,
    });

    return { insight: chatCompletion.choices[0]?.message?.content || 'No insight generated.' };
  } catch (error) {
    console.error('[Groq API Error]', error);
    return { error: 'Failed to analyze market data using Groq' };
  }
}

export async function generateEmailDigestWithGroq(marketData) {
  const client = getGroqClient();
  if (!client) {
    return { error: 'Groq API key not configured' };
  }

  const prompt = `You are a professional financial advisor. Generate an email digest body summarizing the current live stock market data provided below. 

  CRITICAL INSTRUCTIONS:
  1. DO NOT include any greetings (like "Dear Client" or "Hello") and DO NOT include any sign-offs (like "Sincerely" or your name). The application template already handles the personalized header. Jump DIRECTLY to the market summary.
  2. IF the "nifty" or "sensex" keys are missing or null in the Data object below, DO NOT write about them and DO NOT use placeholders like "unavailable". Instead, start immediately by summarizing the performance of the individual active stock movers listed in topGainers and topLosers.

  The summary should have:
  1. An opening sentence summarizing the overall market mood today based on the available data.
  2. A brief breakdown of the market indicators (only if NIFTY/SENSEX data are provided).
  3. Highlights of the top gainers and losers.
  4. Your expert take or concluding thought for the day.
  Format it using clean HTML tags (like <p>, <ul>, <li>, <strong>) so it renders nicely in an email client. Do not use markdown backticks around the HTML.

  Data: ${JSON.stringify(marketData, null, 2)}
  `;

  try {
    const chatCompletion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are an expert financial advisor writing a direct email to a client. Return ONLY the HTML content body. DO NOT generate any greetings, salutations, or placeholders like "[Client Name]". Start immediately with the market analysis.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.4,
    });

    let htmlContent = chatCompletion.choices[0]?.message?.content || '<p>No insight generated.</p>';
    // Clean up markdown block if the model ignores the instruction
    htmlContent = htmlContent.replace(/```html/g, '').replace(/```/g, '').trim();

    return { htmlContent };
  } catch (error) {
    console.error('[Groq Email Error]', error);
    return { error: 'Failed to generate email content using Groq' };
  }
}
