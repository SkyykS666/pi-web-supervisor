/**
 * supervisor-state.ts — Web版监督状态管理
 * 
 * 基于pi-supervisor的state.ts简化而来
 * 移除了对pi ExtensionContext的依赖，专注于状态管理
 */

import type { Sensitivity, SupervisorIntervention, SupervisorState } from "./types";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL_ID = "claude-haiku-4-5-20251001";
export const DEFAULT_SENSITIVITY: Sensitivity = "medium";

export class SupervisorStateManager {
  private state: SupervisorState | null = null;
  private listeners: ((state: SupervisorState | null) => void)[] = [];
  private lastAnalysisTime: number = 0;
  private turnCount: number = 0;

  /**
   * 启动监督
   */
  start(outcome: string, provider: string, modelId: string, sensitivity: Sensitivity): void {
    this.state = {
      active: true,
      outcome,
      provider,
      modelId,
      sensitivity,
      interventions: [],
      startedAt: Date.now(),
      turnCount: 0,
    };
    this.notifyListeners();
    this.persist();
  }

  /**
   * 停止监督
   */
  stop(): void {
    if (!this.state) return;
    this.state.active = false;
    this.notifyListeners();
    this.persist();
  }

  /**
   * 检查监督是否激活
   */
  isActive(): boolean {
    return this.state?.active === true;
  }

  /**
   * 获取当前状态
   */
  getState(): SupervisorState | null {
    return this.state;
  }

  /**
   * 添加干预记录
   */
  addIntervention(intervention: SupervisorIntervention): void {
    if (!this.state) return;
    this.state.interventions.push(intervention);
    this.notifyListeners();
    this.persist();
  }

  /**
   * 增加轮次计数
   */
  incrementTurnCount(): void {
    if (!this.state) return;
    this.state.turnCount++;
    this.notifyListeners();
  }

  /**
   * 设置模型
   */
  setModel(provider: string, modelId: string): void {
    if (!this.state) return;
    this.state.provider = provider;
    this.state.modelId = modelId;
    this.notifyListeners();
    this.persist();
  }

  /**
   * 设置敏感度
   */
  setSensitivity(sensitivity: Sensitivity): void {
    if (!this.state) return;
    this.state.sensitivity = sensitivity;
    this.notifyListeners();
    this.persist();
  }

  /**
   * 获取上次分析时间
   */
  getLastAnalysisTime(): number {
    return this.lastAnalysisTime;
  }

  /**
   * 更新上次分析时间
   */
  updateLastAnalysisTime(): void {
    this.lastAnalysisTime = Date.now();
  }

  /**
   * 获取轮次计数
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * 增加轮次计数
   */
  incrementTurnCount(): void {
    this.turnCount++;
    this.notifyListeners();
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: (state: SupervisorState | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * 持久化状态到localStorage
   */
  private persist(): void {
    if (!this.state) return;
    try {
      localStorage.setItem('supervisor-state', JSON.stringify(this.state));
    } catch (error) {
      console.error('Failed to persist supervisor state:', error);
    }
  }

  /**
   * 从localStorage恢复状态
   * 
   * 注意：不重置active状态，保持持久化时的原样
   * 如果用户刷新页面，监督引擎的 isSupervisionEnabled 也会从 localStorage 恢复
   * UI显示的状态应与实际引擎状态一致
   */
  loadFromStorage(): void {
    try {
      const saved = localStorage.getItem('supervisor-state');
      if (saved) {
        this.state = JSON.parse(saved);
        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to load supervisor state:', error);
      this.state = null;
    }
  }
}