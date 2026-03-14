export const exampleFiles = [
  {
    name: "Cloudflare Q2 2024 Earnings Call",
    fileName: "Cloudflare Q2 2024 Earnings Call.pdf",
    sessionId: "test_cloudflare_earnings",
    questions: [
      "What was the revenue growth rate in Q2?",
      "What are the example questions that the document answers?",
      "What were the key performance indicators for the quarter?",
      "What are the key outcomes from this call?",
    ],
  },
  {
    name: "EU Artificial Intelligence Act",
    fileName: "TA-9-2024-0138_EN.pdf",
    sessionId: "b7c8ce3e-da8e-4067-93c5-824de5fbec58",
    questions: [
      "What is the purpose of the Artificial Intelligence Act?",
      "What are the key requirements for AI systems?",
      "How will the Act be enforced?",
      "What are the potential benefits and challenges of the Act?",
    ],
  },
];

export interface ChatSession {
  id: string;
  name: string;
  systemPrompt: string;
  sessionId: string;
  documentIds: string[];
  messages: { content: string; role: string; isHidden?: boolean }[];
  model: string;
  provider: string;
  createdAt: number;
}

export interface DocumentGroup {
  id: string;
  name: string;
  documentIds: string[];
}

export const defaultSystemPrompt = `You are a helpful assistant that answers questions based on the provided context. When giving a response, always include the source of the information in the format [1], [2], [3] etc. Be concise, accurate, and helpful.`;

export const MODEL_OPTIONS = [
  {
    provider: "groq",
    providerLabel: "Groq",
    providerIcon: "https://media.licdn.com/dms/image/v2/C560BAQH-yCK5i0E6jA/company-logo_200_200/company-logo_200_200/0/1654720696784/groq_logo?e=2147483647&v=beta&t=pp0y5xYtKp1Msznqp_Xu562bpUUpr1puC6GcHue56Zk",
    models: [
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", description: "Fast and efficient", badge: "Fast" },
      { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B", description: "More capable, versatile", badge: "Balanced" },
    ],
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    providerIcon: "https://logosandtypes.com/wp-content/uploads/2022/07/OpenAI.png",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Cost-effective and fast", badge: "Popular" },
      { id: "gpt-4o", name: "GPT-4o", description: "Most capable OpenAI model", badge: "Premium" },
    ],
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    providerIcon: "https://www.finsmes.com/wp-content/uploads/2021/05/anthropic.jpg",
    models: [
      { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet", description: "Best for analysis", badge: "Premium" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Fast and affordable", badge: "Fast" },
    ],
  },
];
