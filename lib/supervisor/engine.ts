/**
 * supervisor-engine.ts — Web版监督逻辑（纯规则版）
 * 
 * 核心思想：
 * 1. 全部纯规则检测，零token消耗
 * 2. 有规范的操作 → 检查
 * 3. 没规范的操作 → 直接放行
 */

import type { ConversationMessage, SteeringDecision, SupervisorState } from "./types";
import { callSupervisorModel } from "./model-client";

// ========== 纯规则监督开关 ==========

let isSupervisionEnabled = false;

export function setSupervisionEnabled(enabled: boolean): void {
  isSupervisionEnabled = enabled;
  console.log(`Supervisor: 纯规则监督已${enabled ? '开启' : '关闭'}`);
}

export function getSupervisionEnabled(): boolean {
  return isSupervisionEnabled;
}

// ========== 规范定义 ==========

interface RuleEntry {
  keywords: string[];      // 匹配关键词（多个）
  ruleName: string;        // 规范名称
  ruleContent: string;     // 规范内容
}

/**
 * 规范条目列表
 * 按工具名或工具类型匹配
 */
const RULE_ENTRIES: RuleEntry[] = [
  // 网络搜索相关
  {
    keywords: ['skill:tavily-search', 'tavily-search', '网络搜索'],
    ruleName: '网络搜索规范',
    ruleContent: '必须真实：不能编造信息，不能捏造数据；必须有来源：提供真实来源链接；最好最新：优先最新信息；必须包含时间信息'
  },
  {
    keywords: ['skill:tavily-extract', 'tavily-extract'],
    ruleName: '网络提取规范',
    ruleContent: '必须提取真实内容，不能编造或篡改网页内容；必须注明来源链接'
  },
  {
    keywords: ['skill:tavily-crawl', 'tavily-crawl'],
    ruleName: '网络爬取规范',
    ruleContent: '必须爬取真实内容，不能编造或篡改网页内容；必须注明来源链接'
  },
  
  // 命令执行相关（bash）
  {
    keywords: ['bash', 'command', 'shell', '命令执行'],
    ruleName: '命令执行规范',
    ruleContent: '执行前必须告知用户，不能偷偷执行；不能偷偷换方案，如果原方案有问题必须告知用户；按照原计划执行，不能私自改变方案'
  },
  
  // 文件写入
  {
    keywords: ['write', 'file_write', '写入文件'],
    ruleName: '文件写入规范',
    ruleContent: '写入文件前告知用户；删除文件前必须确认；重要文件操作需要用户确认'
  },
  
  // 文件编辑
  {
    keywords: ['edit', 'file_edit', '编辑文件'],
    ruleName: '文件编辑规范',
    ruleContent: '编辑重要文件前告知用户；绝对禁止删除核心文件（MEMORY.md、SCRATCHPAD.md、AGENTS.md等）'
  },
];

// ========== 技术栈跟踪器 ==========

// 技术栈关键词表（以后你觉得需要加啥就加）
const TECH_STACK_KEYWORDS: Record<string, string[]> = {
  python: ['python', 'pip', 'conda', '.py', 'python3', 'flask', 'django', 'pandas', 'jupyter'],
  node: ['node', 'npm', 'npx', 'yarn', '.js', '.ts', '.tsx', '.jsx', 'react', 'next'],
  go: ['go', 'go run', '.go', 'golang'],
  rust: ['rust', 'cargo', '.rs'],
  java: ['java', 'maven', 'gradle', '.java', 'spring', 'javac'],
};

// 当前会话的技术栈状态
let currentTechStack: string | null = null;
let lastCommandFailed = false;

// ========== 文件保护检测（纯规则，零token消耗。confidence > 0.95 表示红线，不给确认选项）==========

const PROTECTED_FILES = [
  'MEMORY.md', 'SCRATCHPAD.md', 'AGENTS.md', 'PPT经验.md',
  'time_awareness.py', 'auto_backup_fixed.py', '备份工具.bat',
];

/**
 * 检测是否涉及核心文件操作
 * 在analyzeToolCall中调用，纯字符串匹配，不消耗token
 */
function checkFileProtection(toolName: string, toolArgs: string): SteeringDecision | null {
  const lower = toolArgs.toLowerCase();
  
  // write/edit 操作：检查路径是否包含受保护文件
  if (toolName === 'write' || toolName === 'edit') {
    for (const file of PROTECTED_FILES) {
      if (lower.includes(file.toLowerCase())) {
        console.log(`Supervisor: [文件保护] 拦截: 涉及核心文件 ${file}`);
        return {
          action: 'steer',
          message: `⛔ 涉及核心文件 ${file}，此文件受保护不能随意修改。如果确实需要修改，请先告知用户并获得明确确认`,
          reasoning: `尝试操作核心文件 ${file}`,
          confidence: 0.96
        };
      }
    }
  }
  
  // bash 操作：检查 rm + 受保护文件
  if (toolName === 'bash') {
    if (lower.includes('rm ') || lower.includes('del ') || lower.includes('remove-item')) {
      for (const file of PROTECTED_FILES) {
        if (lower.includes(file.toLowerCase())) {
          console.log(`Supervisor: [文件保护] 拦截: 试图删除核心文件 ${file}`);
          return {
            action: 'steer',
            message: `⛔ 试图删除核心文件 ${file}，此操作已被禁止。请立即告知用户`,
            reasoning: `试图删除核心文件 ${file}`,
            confidence: 0.98
          };
        }
      }
    }
  }
  
  return null;
}

// ========== 搜索规范检测（纯规则，零token消耗）==========

// 搜索关键词表
const SEARCH_KEYWORDS = ['tvly search', 'tavily', '--json', '--depth', '--max-results'];
const TIME_RANGE_KEYWORDS = ['--time-range', 'time_range', 'timeRange', '-t '];

// 是否已发送过搜索规范指南（只发送一次）
let hasShownSearchGuide = false;

/**
 * 搜索规范指南内容
 */
const SEARCH_GUIDE_MESSAGE = `📋 搜索规范指南：
1. 每次搜索必须使用 --time-range 参数限定时间范围（如 --time-range week/month/year）
2. 涉及多品牌、多版本、多区域时，不要只搜一次，要分维度分别搜索对比
3. 涉及国内外版本时，优先推荐国内版，再说明国际版
4. 说明付费情况和网络环境要求（国内能否使用）`;

/**
 * 检测搜索操作是否规范
 * 纯规则匹配，不消耗token
 */
function checkSearchStandard(toolName: string, toolArgs: string): SteeringDecision | null {
  // 判断是否是搜索操作
  const lower = toolArgs.toLowerCase();
  const isSearch = toolName.includes('search') || 
    toolName === 'bash' && SEARCH_KEYWORDS.some(k => lower.includes(k));
  
  if (!isSearch) return null;
  
  // 第一次搜索时，发送完整的规范指南
  if (!hasShownSearchGuide) {
    hasShownSearchGuide = true;
    console.log(`Supervisor: [搜索规范] 首次搜索，发送规范指南`);
    return {
      action: 'steer',
      message: SEARCH_GUIDE_MESSAGE,
      reasoning: '首次搜索，发送规范指南',
      confidence: 0.5
    };
  }
  
  // 后续搜索：检测是否为多维度对比搜索
  const isMultiDimSearch = /对比|比较|vs|versus|和|与|品牌|版本|区域/.test(lower);
  if (isMultiDimSearch) {
    console.log(`Supervisor: [搜索规范] 提醒: 多维度搜索`);
    return {
      action: 'steer',
      message: `🔍 搜索涉及多维度对比，请注意：分维度分别搜索对比，不要只搜一次就下结论。优先推荐国内版，再说明国际版，并说明付费情况和网络环境`,
      reasoning: '多维度搜索提醒',
      confidence: 0.5
    };
  }
  
  // 后续搜索：检查是否带了时间范围参数
  const hasTimeRange = TIME_RANGE_KEYWORDS.some(k => lower.includes(k));
  if (!hasTimeRange) {
    console.log(`Supervisor: [搜索规范] 提醒: 搜索未限定时间范围`);
    return {
      action: 'steer',
      message: `⏰ 搜索未限定时间范围，信息可能有滞后性。请加上 --time-range 参数（如 --time-range week）重新搜索，确保信息时效性`,
      reasoning: '搜索未限定时间范围',
      confidence: 0.6
    };
  }
  
  return null;
}

// ========== 图片处理顺序检测（纯规则，零token消耗）==========

// 图片处理状态
let hasTriedReadForImage = false;
const OCR_PRIORITY = ['paddleocr', 'easyocr', 'tesseract'];
let ocrAttempts: string[] = [];

/**
 * 检测图片处理是否按规范执行
 */
function checkImageHandling(toolName: string, toolArgs: string): SteeringDecision | null {
  const lower = toolArgs.toLowerCase();
  
  // 检测read操作：判断是否为图片文件
  if (toolName === 'read' && /\.(png|jpg|jpeg|gif|webp|bmp)/.test(lower)) {
    hasTriedReadForImage = true;
    console.log(`Supervisor: [图片处理] 已尝试read图片`);
    return null;
  }
  
  // 检测OCR操作
  const isPaddle = lower.includes('paddleocr');
  const isEasy = lower.includes('easyocr');
  const isTesseract = lower.includes('tesseract');
  const isOCR = isPaddle || isEasy || isTesseract;
  
  if (!isOCR) return null;
  
  // 检查是否先read过了
  if (!hasTriedReadForImage) {
    console.log(`Supervisor: [图片处理] 提醒: 应先read图片`);
    return {
      action: 'steer',
      message: `🖼️ 处理图片应先使用 read 工具读取图片，read无法识别时再使用OCR`,
      reasoning: '未先尝试read',
      confidence: 0.5
    };
  }
  
  // 检查OCR优先级
  const currentOCR = isPaddle ? 'paddleocr' : isEasy ? 'easyocr' : 'tesseract';
  const currentIdx = OCR_PRIORITY.indexOf(currentOCR);
  
  // 检查是否跳过了前面的优先级
  for (let i = 0; i < currentIdx; i++) {
    if (!ocrAttempts.includes(OCR_PRIORITY[i])) {
      console.log(`Supervisor: [图片处理] 提醒: 跳过了${OCR_PRIORITY[i]}`);
      return {
        action: 'steer',
        message: `🖼️ OCR优先级顺序：先试 PaddleOCR，不行再试 EasyOCR，最后试 Tesseract。跳过了 ${OCR_PRIORITY[i]}`,
        reasoning: `跳过了${OCR_PRIORITY[i]}`,
        confidence: 0.5
      };
    }
  }
  
  // 记录已尝试的OCR
  if (!ocrAttempts.includes(currentOCR)) {
    ocrAttempts.push(currentOCR);
  }
  
  return null;
}

// ========== 保存文件前询问检测（纯规则，零token消耗）==========

// 用户是否已指定保存路径
let userHasSpecifiedPath = false;

/**
 * 由前端调用，标记用户已指定路径
 */
export function markUserSpecifiedPath(): void {
  userHasSpecifiedPath = true;
}

/**
 * 重置状态（新对话时调用）
 */
export function resetUserSpecifiedPath(): void {
  userHasSpecifiedPath = false;
}

/** 检查write操作前是否已询问用户 */
function checkSaveFileBeforeWrite(toolName: string, toolArgs: string): SteeringDecision | null {
  if (toolName !== 'write') return null;
  if (userHasSpecifiedPath) return null;
  
  console.log(`Supervisor: [保存文件] 提醒: 未确认路径`);
  return {
    action: 'steer',
    message: `💡 请先询问用户要保存到哪里后再执行写操作`,
    reasoning: '写文件前未确认用户指定的路径',
    confidence: 0.5
  };
}

// ========== PPT制作规范检测（纯规则，零token消耗）==========

// 是否已读过PPT经验文档
let hasReadPPTExperience = false;

/**
 * 由前端调用，检查PPT规范
 */
export function checkPPTStandard(): string | null {
  if (!hasReadPPTExperience) {
    return '📊 在做PPT之前，请先读取PPT经验文档：C:\\Users\\DELL\\.pi\\agent\\PPT经验.md';
  }
  return null;
}

/** 在analyzeToolCall中检测read操作是否读取了PPT经验文档 */
function checkPPTRead(toolName: string, toolArgs: string): void {
  if (toolName === 'read' && toolArgs.includes('PPT经验.md')) {
    hasReadPPTExperience = true;
    console.log('Supervisor: [PPT规范] 已读取PPT经验文档');
  }
}

// 连续失败检测
const techStackFailCount: Record<string, number> = {};
const MAX_CONSECUTIVE_FAILURES = 3; // 同一个技术栈连续失败3次就停下来

/**
 * 检测命令属于哪个技术栈
 */
function detectTechStack(commandOrArgs: string): string | null {
  const lower = commandOrArgs.toLowerCase();
  for (const [stack, keywords] of Object.entries(TECH_STACK_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return stack;
    }
  }
  return null;
}

/**
 * 在工具执行前检测技术栈切换
 * 返回 null = 没问题，返回 SteeringDecision = 需要提醒
 */
function checkTechStackSwitch(
  toolName: string,
  toolArgs: string
): SteeringDecision | null {
  // 只对 bash 和 write 操作检测技术栈
  if (toolName !== 'bash' && toolName !== 'write' && toolName !== 'edit') {
    return null;
  }

  const newStack = detectTechStack(toolArgs);
  if (!newStack) return null; // 识别不出技术栈，跳过

  // 第一次识别到技术栈，记下来
  if (currentTechStack === null) {
    currentTechStack = newStack;
    console.log(`Supervisor: [技术栈] 初始化为 ${newStack}`);
    return null;
  }

  // 技术栈变了
  if (newStack !== currentTechStack) {
    const oldStack = currentTechStack;
    currentTechStack = newStack; // 更新当前技术栈

    // 有失败记录 → 高置信度，确定是私自换方案
    if (lastCommandFailed) {
      lastCommandFailed = false; // 重置
      console.log(`Supervisor: [技术栈切换] ${oldStack} → ${newStack}（上次失败）`);
      return {
        action: 'steer',
        message: `⚠️ 检测到从 ${oldStack} 切换到了 ${newStack}，且上一个命令执行失败了。请先告知用户原因，经同意后再切换`,
        reasoning: `上次${oldStack}命令失败后，AI未告知用户就尝试${newStack}`,
        confidence: 0.85
      };
    }

    // 没有失败记录 → 低置信度提醒，可能只是正常切换
    console.log(`Supervisor: [技术栈切换] ${oldStack} → ${newStack}（无失败记录）`);
    return {
      action: 'steer',
      message: `💡 注意到从 ${oldStack} 切换到了 ${newStack}，如果是用户同意的请忽略，如果是AI擅自决定的请告知用户`,
      reasoning: `${oldStack}切换到${newStack}，但无失败记录，可能是正常切换也可能是私自换方案`,
      confidence: 0.4
    };
  }

  return null;
}

/**
 * 报告命令执行结果（前端在工具执行完后调用）
 */
export function reportCommandResult(toolName: string, exitCode?: number): void {
  if (toolName === 'bash') {
    lastCommandFailed = exitCode !== undefined && exitCode !== 0;
    
    if (lastCommandFailed && currentTechStack) {
      // 记录当前技术栈的连续失败
      techStackFailCount[currentTechStack] = (techStackFailCount[currentTechStack] || 0) + 1;
      const count = techStackFailCount[currentTechStack];
      console.log(`Supervisor: [技术栈] ${currentTechStack} 连续失败 ${count}/${MAX_CONSECUTIVE_FAILURES} 次`);
    } else if (!lastCommandFailed && currentTechStack) {
      // 命令成功了，清零该技术栈的失败计数
      if (techStackFailCount[currentTechStack]) {
        console.log(`Supervisor: [技术栈] ${currentTechStack} 执行成功，清零失败计数`);
        techStackFailCount[currentTechStack] = 0;
      }
    }
  }
}

/**
 * 检测技术栈连续失败
 * 在analyzeToolCall中调用
 */
function checkConsecutiveFailures(): SteeringDecision | null {
  if (!currentTechStack) return null;
  
  const failCount = techStackFailCount[currentTechStack] || 0;
  if (failCount >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`Supervisor: [技术栈] ${currentTechStack} 连续失败 ${failCount} 次，达到阈值`);
    // 清零避免重复触发
    techStackFailCount[currentTechStack] = 0;
    return {
      action: 'steer',
      message: `⛔ ${currentTechStack} 方案已连续失败 ${failCount} 次，该方案当前行不通。失败原因请查看上方执行记录，请告知用户具体情况，让用户决定下一步怎么做`,
      reasoning: `${currentTechStack}连续失败${failCount}次`,
      confidence: 0.95
    };
  }
  
  return null;
}

/**
 * 重置技术栈状态（新任务开始时调用）
 */
export function resetTechStack(): void {
  currentTechStack = null;
  lastCommandFailed = false;
  // 清零所有技术栈的失败计数
  for (const key of Object.keys(techStackFailCount)) {
    techStackFailCount[key] = 0;
  }
  console.log('Supervisor: [技术栈] 状态已重置');
}

// ========== 缓存系统 ==========

interface CacheEntry {
  decision: SteeringDecision;
  timestamp: number;
}

const decisionCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/**
 * 生成缓存key（简化版本，忽略随机参数）
 */
function getCacheKey(toolName: string, toolArgs: string): string {
  // 简化参数：去掉日期、随机ID等变化部分
  const simplified = toolArgs
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')        // 日期
    .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME')        // 时间
    .replace(/[a-f0-9]{8,}/gi, 'ID')              // UUID/哈希
    .replace(/\b\d{4,}\b/g, 'NUM')                // 长数字
    .trim()
    .substring(0, 100);                           // 只取前100字符
  
  return `${toolName}:${simplified}`;
}

/**
 * 从缓存获取结果
 */
function getCachedDecision(toolName: string, toolArgs: string): SteeringDecision | null {
  const key = getCacheKey(toolName, toolArgs);
  const cached = decisionCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Supervisor: [缓存命中] ${key}`);
    return cached.decision;
  }
  
  return null;
}

/**
 * 存入缓存
 */
function setCachedDecision(toolName: string, toolArgs: string, decision: SteeringDecision): void {
  const key = getCacheKey(toolName, toolArgs);
  decisionCache.set(key, { decision, timestamp: Date.now() });
  console.log(`Supervisor: [缓存存入] ${key}`);
}

// ========== 规则匹配 ==========

/**
 * 查找操作对应的规范
 * 返回 null = 没有规范，直接放行
 */
function findRuleForOperation(toolName: string, toolArgs: string): RuleEntry | null {
  const argsLower = toolArgs.toLowerCase();
  
  // 1. 精确匹配工具名
  for (const rule of RULE_ENTRIES) {
    if (rule.keywords.includes(toolName)) {
      console.log(`Supervisor: [精确匹配] ${toolName} → ${rule.ruleName}`);
      return rule;
    }
  }
  
  // 2. bash 命令：按内容匹配
  if (toolName === 'bash') {
    // 网络相关命令 → 网络搜索规范
    if (argsLower.includes('curl') || argsLower.includes('wget') || argsLower.includes('fetch')) {
      const networkRule = RULE_ENTRIES.find(r => r.ruleName === '网络搜索规范');
      if (networkRule) {
        console.log(`Supervisor: [bash网络] ${toolArgs.substring(0, 50)}... → ${networkRule.ruleName}`);
        return networkRule;
      }
    }
    
    // 其他 bash → 命令执行规范
    const cmdRule = RULE_ENTRIES.find(r => r.ruleName === '命令执行规范');
    if (cmdRule) {
      console.log(`Supervisor: [bash命令] ${toolArgs.substring(0, 50)}... → ${cmdRule.ruleName}`);
      return cmdRule;
    }
  }
  
  // 3. skill 调用：按前缀匹配
  if (toolName.startsWith('skill:')) {
    const skillName = toolName.replace('skill:', '');
    for (const rule of RULE_ENTRIES) {
      if (rule.keywords.some(k => skillName.includes(k) || k.includes(skillName))) {
        console.log(`Supervisor: [skill匹配] ${toolName} → ${rule.ruleName}`);
        return rule;
      }
    }
  }
  
  console.log(`Supervisor: [无规范] ${toolName} → 直接放行`);
  return null;
}

// ========== 提示词构建 ==========

/**
 * 构建精准的监督提示词
 */
function buildSupervisorPrompt(
  state: SupervisorState,
  rule: RuleEntry,
  toolName: string,
  toolArgs: string
): string {
  return `你是一个精准的AI操作监督员。

【监督目标】
${state.outcome}

【当前操作】
工具: ${toolName}
参数: ${toolArgs.substring(0, 300)}${toolArgs.length > 300 ? '...' : ''}

【要检查的规范】
${rule.ruleName}：${rule.ruleContent}

【你的任务】
只检查上面的规范，判断这次操作是否违反。

【响应格式】
{
  "action": "continue" | "steer",
  "message": "如果违规，1句话说明问题（具体指出违反了哪条）",
  "reasoning": "简要分析",
  "confidence": 0.0-1.0
}

【重要】
- 只关注"${rule.ruleName}"，不要检查其他无关规范
- 正常操作直接放行，不要过度敏感
- 只在真正违规时才提醒`;
}

// ========== 核心分析函数 ==========

/**
 * 分析工具调用
 * 有缓存用缓存，没缓存调LLM
 */
export async function analyzeToolCall(
  state: SupervisorState,
  toolName: string,
  toolArgs: string,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  console.log(`Supervisor: 分析工具调用 - ${toolName} - 参数: ${toolArgs.substring(0, 100)}`);
  
  // 0a0. 检测read操作是否读取了PPT经验文档（纯规则）
  checkPPTRead(toolName, toolArgs);
  
  // 0a. 先检测当前技术栈是否连续失败（纯规则，不花钱）
  const failCheck = checkConsecutiveFailures();
  if (failCheck) {
    console.log(`Supervisor: [连续失败] 拦截: ${failCheck.message}`);
    return failCheck;
  }
  
  // 0a1. 再检测文件保护（纯规则，零token消耗）
  const fileCheck = checkFileProtection(toolName, toolArgs);
  if (fileCheck) {
    console.log(`Supervisor: [文件保护] 拦截: ${fileCheck.message}`);
    return fileCheck;
  }
  
  // 0a2. 再检测搜索规范（纯规则，零token消耗）
  const searchCheck = checkSearchStandard(toolName, toolArgs);
  if (searchCheck) {
    console.log(`Supervisor: [搜索规范] 提醒: ${searchCheck.message}`);
    // 搜索规范是提醒级别，不拦截，只记录日志
    writeSupervisorLog({ type: 'search_standard', content: searchCheck.message, result: 'reminded' });
  }
  
  // 0a3. 再检测图片处理顺序（纯规则，零token消耗）
  const imageCheck = checkImageHandling(toolName, toolArgs);
  if (imageCheck) {
    console.log(`Supervisor: [图片处理] 拦截: ${imageCheck.message}`);
    return imageCheck;
  }
  
  // 0a4. 再检测保存文件前询问（纯规则，零token消耗）
  const saveCheck = checkSaveFileBeforeWrite(toolName, toolArgs);
  if (saveCheck) {
    console.log(`Supervisor: [保存文件] 提醒: ${saveCheck.message}`);
    return saveCheck;
  }
  
  // 0b. 再做技术栈切换检测（纯规则，不花钱）
  const switchCheck = checkTechStackSwitch(toolName, toolArgs);
  if (switchCheck) {
    console.log(`Supervisor: [技术栈] 拦截: ${switchCheck.message}`);
    return switchCheck;
  }
  
  // 纯规则检测全部通过，如果开启了纯规则监督模式，直接放行（不走LLM）
  if (isSupervisionEnabled) {
    console.log('Supervisor: 纯规则检测全部通过，放行');
    return { action: 'allow', message: '', reasoning: '纯规则检测通过', confidence: 1 };
  }
  
  // 1. 查找规范
  const rule = findRuleForOperation(toolName, toolArgs);
  
  // 2. 没规范 → 直接放行
  if (!rule) {
    return {
      action: 'continue',
      reasoning: '该操作无对应规范，直接放行',
      confidence: 1
    };
  }
  
  // 3. 检查缓存
  const cached = getCachedDecision(toolName, toolArgs);
  if (cached) {
    return cached;
  }
  
  // 4. 调用LLM分析
  const prompt = buildSupervisorPrompt(state, rule, toolName, toolArgs);
  
  console.log(`Supervisor: 调用LLM分析（${rule.ruleName}）...`);
  try {
    const decision = await callSupervisorModel(
      state.provider,
      state.modelId,
      '你是一个精准的AI操作监督员。',
      prompt,
      undefined,
      onDelta
    );
    
    console.log('Supervisor: 分析完成:', decision.action);
    
    // 5. 存入缓存
    setCachedDecision(toolName, toolArgs, decision);
    
    return decision;
  } catch (error) {
    console.error('Supervisor: LLM分析失败:', error);
    return {
      action: 'continue',
      reasoning: '分析失败，继续执行',
      confidence: 0
    };
  }
}

// ========== 兼容旧接口 ==========

export async function analyze(
  state: SupervisorState,
  messages: ConversationMessage[],
  agentIsIdle: boolean,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  if (agentIsIdle) {
    return { action: 'continue', reasoning: '代理空闲', confidence: 1 };
  }
  return { action: 'continue', reasoning: '继续执行', confidence: 1 };
}

export function shouldAnalyze(
  state: SupervisorState,
  agentIsIdle: boolean,
  lastAnalysisTime: number,
  toolName?: string
): boolean {
  // 简化：只要有活跃监督状态就检查（在useAgentSession里已判断）
  return true;
}

// ========== 监督日志存储 ==========

import type { SupervisorLogEntry } from "./types";

const LOG_STORAGE_KEY = 'supervisor-logs';

/**
 * 写入一条监督日志
 */
export function writeSupervisorLog(entry: Omit<SupervisorLogEntry, 'id' | 'timestamp'>): void {
  try {
    const logs = readSupervisorLogs();
    const newEntry: SupervisorLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(newEntry); // 最新在前
    // 最多保留200条
    if (logs.length > 200) logs.length = 200;
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error('Supervisor: 写入日志失败:', e);
  }
}

/**
 * 读取所有监督日志
 */
export function readSupervisorLogs(): SupervisorLogEntry[] {
  try {
    const data = localStorage.getItem(LOG_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Supervisor: 读取日志失败:', e);
    return [];
  }
}

/**
 * 清空监督日志
 */
export function clearSupervisorLogs(): void {
  try {
    localStorage.removeItem(LOG_STORAGE_KEY);
  } catch (e) {
    console.error('Supervisor: 清空日志失败:', e);
  }
}
