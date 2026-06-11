/**
 * supervisor-config.ts — 监督配置管理
 * 
 * 支持从pi-web的models.json读取模型配置
 * 支持从文件加载监督目标
 * 支持预设监督规则
 */

export interface SupervisorConfig {
  models: Array<{
    provider: string;
    modelId: string;
    name?: string;
  }>;
  defaultSensitivity: 'low' | 'medium' | 'high';
  maxIdleSteers: number;
  presetGoals: Array<{
    name: string;
    goal: string;
    description?: string;
  }>;
}

const DEFAULT_CONFIG: SupervisorConfig = {
  models: [], // 将从pi-web的models.json动态加载
  defaultSensitivity: "medium",
  maxIdleSteers: 5,
  presetGoals: [
    {
      name: "严格执行AGENTS.md规范",
      goal: "严格执行AGENTS.md中的所有规范，包括：搜索规范、决策规范、禁止编造信息、核心文件保护、PPT制作规范",
      description: "监督AI助手严格遵守AGENTS.md中的工作规范"
    },
    {
      name: "确保代码质量",
      goal: "确保生成的代码符合最佳实践，包括错误处理、性能优化、可读性",
      description: "监督代码质量，确保符合开发规范"
    },
    {
      name: "保护核心文件",
      goal: "绝对禁止删除核心文件：MEMORY.md、SCRATCHPAD.md、AGENTS.md、PPT经验.md",
      description: "确保AI助手不会误删重要文件"
    }
  ],
};

let config: SupervisorConfig | null = null;

/**
 * 从pi-web的models API读取模型配置
 * 注意：pi-web使用的是 /api/models，而不是 /api/models-config
 */
async function loadPiWebModels(): Promise<Array<{ provider: string; modelId: string; name: string }>> {
  console.log('Supervisor: 开始加载pi-web模型...');
  try {
    console.log('Supervisor: 请求 /api/models...');
    const response = await fetch('/api/models');
    console.log('Supervisor: 响应状态:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Supervisor: 收到数据:', data);
      
      const models: Array<{ provider: string; modelId: string; name: string }> = [];
      
      // 解析pi-web的 /api/models 格式
      // data.modelList 是模型数组
      if (data.modelList && Array.isArray(data.modelList)) {
        console.log('Supervisor: 找到modelList，长度:', data.modelList.length);
        for (const model of data.modelList) {
          if (model && typeof model === 'object') {
            models.push({
              provider: model.provider || 'unknown',
              modelId: model.id || 'unknown',
              name: model.name || model.id || `${model.provider}/unknown`,
            });
          }
        }
      } else {
        console.log('Supervisor: 没有找到modelList或格式不对');
      }
      
      console.log('Supervisor: 解析完成，模型数量:', models.length);
      return models;
    } else {
      console.log('Supervisor: API请求失败:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Supervisor: 加载模型失败:', error);
  }
  
  console.log('Supervisor: 返回空模型列表');
  return [];
}

/**
 * 加载配置（异步版本，总是重新加载模型）
 */
export async function loadConfigAsync(): Promise<SupervisorConfig> {
  console.log('Supervisor: loadConfigAsync 被调用');
  
  // 总是重新加载配置，不使用缓存
  const baseConfig = config ? { ...config } : { ...DEFAULT_CONFIG };
  
  // 尝试从localStorage加载保存的配置
  try {
    const saved = localStorage.getItem('supervisor-config');
    if (saved) {
      const savedConfig = JSON.parse(saved);
      Object.assign(baseConfig, savedConfig);
    }
  } catch (error) {
    console.error('Failed to load supervisor config from localStorage:', error);
  }
  
  // 从pi-web加载模型配置
  console.log('Supervisor: 调用 loadPiWebModels...');
  const piWebModels = await loadPiWebModels();
  console.log('Supervisor: loadPiWebModels 返回:', piWebModels.length, '个模型');
  
  if (piWebModels.length > 0) {
    baseConfig.models = piWebModels;
  } else if (baseConfig.models.length === 0) {
    // 如果没有模型配置，使用默认模型
    baseConfig.models = [
      { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", name: "Claude Haiku" },
      { provider: "openai", modelId: "gpt-4o-mini", name: "GPT-4o Mini" },
    ];
  }
  
  // 更新全局config
  config = baseConfig;
  
  console.log('Supervisor: 最终模型列表:', config.models.map(m => m.name));
  return config;
}

/**
 * 同步版本的加载配置（用于初始化）
 */
export function loadConfig(): SupervisorConfig {
  if (config) return config;
  
  // 先加载默认配置
  config = { ...DEFAULT_CONFIG };
  
  // 尝试从localStorage加载保存的配置
  try {
    const saved = localStorage.getItem('supervisor-config');
    if (saved) {
      const savedConfig = JSON.parse(saved);
      config = { ...config, ...savedConfig };
    }
  } catch (error) {
    console.error('Failed to load supervisor config from localStorage:', error);
  }
  
  // 如果没有模型配置，使用默认模型
  if (config.models.length === 0) {
    config.models = [
      { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", name: "Claude Haiku" },
      { provider: "openai", modelId: "gpt-4o-mini", name: "GPT-4o Mini" },
    ];
  }
  
  return config;
}

/**
 * 保存配置
 */
export function saveConfig(newConfig: Partial<SupervisorConfig>): void {
  config = { ...loadConfig(), ...newConfig };
  try {
    localStorage.setItem('supervisor-config', JSON.stringify(config));
  } catch (error) {
    console.error('Failed to save supervisor config:', error);
  }
}

/**
 * 获取可用模型列表
 */
export function getAvailableModels(): Array<{ provider: string; modelId: string; name: string }> {
  const cfg = loadConfig();
  return cfg.models.map(m => ({
    provider: m.provider,
    modelId: m.modelId,
    name: m.name || `${m.provider}/${m.modelId}`,
  }));
}

/**
 * 获取预设监督目标
 */
export function getPresetGoals(): Array<{ name: string; goal: string; description?: string }> {
  const cfg = loadConfig();
  console.log('Supervisor: getPresetGoals被调用, cfg.presetGoals:', cfg.presetGoals);
  // 确保返回有效的预设目标
  if (cfg.presetGoals && cfg.presetGoals.length > 0) {
    console.log('Supervisor: 使用config中的presetGoals, 数量:', cfg.presetGoals.length);
    return cfg.presetGoals;
  }
  console.log('Supervisor: 使用DEFAULT_CONFIG中的presetGoals');
  return DEFAULT_CONFIG.presetGoals;
}

/**
 * 获取默认敏感度
 */
export function getDefaultSensitivity(): 'low' | 'medium' | 'high' {
  return loadConfig().defaultSensitivity;
}

/**
 * 获取最大空闲干预次数
 */
export function getMaxIdleSteers(): number {
  return loadConfig().maxIdleSteers;
}