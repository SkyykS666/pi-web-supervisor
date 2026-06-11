/**
 * Core types for the pi-supervisor extension.
 */

export type Sensitivity = "low" | "medium" | "high";
export type SupervisorAction = "continue" | "steer" | "done";

/** A single intervention record */
export interface SupervisorIntervention {
  turnCount: number;
  message: string;
  reasoning: string;
  timestamp: number;
}

/** Full supervisor state — persisted to session */
export interface SupervisorState {
  active: boolean;
  outcome: string;
  provider: string;          // e.g. "anthropic"
  modelId: string;           // e.g. "claude-haiku-4-5-20251001"
  sensitivity: Sensitivity;
  interventions: SupervisorIntervention[];
  startedAt: number;
  turnCount: number;
}

/** Decision returned by the supervisor LLM */
export interface SteeringDecision {
  action: SupervisorAction;
  message?: string;
  reasoning: string;
  confidence: number;
}

/** 监督日志条目 */
export interface SupervisorLogEntry {
  id: string;
  timestamp: string;           // ISO格式时间
  type: string;                // 类型: tech_stack_switch | consecutive_failure | search_violation | file_protection | ...
  content: string;             // 监督内容
  result: string;              // 处理结果: intercepted | user_approved | user_rejected | reminded | info
  detail?: string;             // 补充信息
}

/** A simplified message for building the supervisor context */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}
