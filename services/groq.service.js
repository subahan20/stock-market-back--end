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
      model: 'llama3-8b-8192',
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

  const prompt = `You are a professional financial advisor. Generate an email digest summarizing the current live stock market data provided below. 
  The email should have:
  1. A warm, professional greeting.
  2. A brief summary of the overall market performance (NIFTY/SENSEX).
  3. Highlights of top gainers and losers.
  4. Your expert take or concluding thought for the day.
  Format it using clean HTML tags (like <p>, <ul>, <li>, <strong>) so it renders nicely in an email client. Do not use markdown backticks around the HTML.

  Data: ${JSON.stringify(marketData, null, 2)}
  `;

  try {
    const chatCompletion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are an expert financial advisor writing a direct email to a client. Return ONLY the HTML content, without any markdown formatting wrappers or explanations.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'llama3-8b-8192',
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
