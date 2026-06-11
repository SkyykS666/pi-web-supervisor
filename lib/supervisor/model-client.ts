/**
 * model-client.ts — Web版LLM调用逻辑
 * 
 * 基于pi-supervisor的model-client.ts重写
 * 使用OpenAI兼容的API格式
 */

import type { SteeringDecision } from "./types.js";

// 存储API密钥的变量
let apiKey: string | null = null;
let apiEndpoint: string | null = null;

/**
 * 设置API配置
 */
export function setApiConfig(endpoint: string, key: string): void {
  apiEndpoint = endpoint;
  apiKey = key;
  // 保存到localStorage
  try {
    localStorage.setItem('supervisor-api-config', JSON.stringify({ endpoint, key }));
  } catch (e) {
    console.error('Failed to save API config:', e);
  }
}

/**
 * 获取API配置
 */
export function getApiConfig(): { endpoint: string | null; key: string | null } {
  return { endpoint: apiEndpoint, key: apiKey };
}

/**
 * 从localStorage加载API配置
 */
export function loadApiConfig(): { endpoint: string | null; key: string | null } {
  try {
    const saved = localStorage.getItem('supervisor-api-config');
    if (saved) {
      const config = JSON.parse(saved);
      apiEndpoint = config.endpoint;
      apiKey = config.key;
      return { endpoint: apiEndpoint, key: apiKey };
    }
  } catch (e) {
    console.error('Failed to load API config:', e);
  }
  return { endpoint: null, key: null };
}

/**
 * 获取API endpoint（根据provider自动选择）
 */
function getApiEndpoint(provider: string): string {
  // 如果用户配置了自定义endpoint，使用它
  if (apiEndpoint) {
    return apiEndpoint;
  }
  
  // 根据provider返回默认endpoint
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'anthropic':
      // Anthropic需要特殊的API格式，这里简化处理
      return 'https://api.anthropic.com/v1/messages';
    case 'deepseek':
      return 'https://api.deepseek.com/v1/chat/completions';
    case 'moonshot':
      return 'https://api.moonshot.cn/v1/chat/completions';
    default:
      // 默认使用OpenAI兼容格式
      return 'https://api.openai.com/v1/chat/completions';
  }
}

/**
 * 调用LLM API
 * 使用fetch调用配置的API（OpenAI兼容格式）
 */
export async function callModel(
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<string | null> {
  console.log(`Supervisor: 调用LLM ${provider}/${modelId}`);
  
  // 如果没有配置API，使用模拟响应
  if (!apiKey) {
    console.log('Supervisor: 未配置API密钥，使用模拟响应');
    const mockResponse = JSON.stringify({
      action: "continue",
      reasoning: "模拟响应 - 需要配置API密钥",
      confidence: 0.5
    });
    
    if (onDelta) {
      onDelta(mockResponse);
    }
    
    return mockResponse;
  }
  
  const endpoint = getApiEndpoint(provider);
  
  try {
    // 构建请求（OpenAI兼容格式）
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    if (onDelta) {
      onDelta(content);
    }
    
    return content;
  } catch (error) {
    console.error('Supervisor: LLM调用失败:', error);
    return null;
  }
}

/**
 * 调用监督模型并解析响应
 * 返回SteeringDecision对象
 */
export async function callSupervisorModel(
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  try {
    const response = await callModel(
      provider,
      modelId,
      systemPrompt,
      userPrompt,
      signal,
      onDelta
    );
    
    if (!response) {
      throw new Error("No response from model");
    }
    
    // 尝试解析JSON响应
    try {
      const decision = JSON.parse(response) as SteeringDecision;
      return decision;
    } catch (parseError) {
      console.error("Failed to parse model response:", parseError);
      return {
        action: "continue",
        reasoning: "Failed to parse model response",
        confidence: 0
      };
    }
  } catch (error) {
    console.error("Supervisor model call failed:", error);
    return {
      action: "continue",
      reasoning: "Model call failed",
      confidence: 0
    };
  }
}