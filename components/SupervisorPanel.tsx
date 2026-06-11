"use client";

import { useState, useEffect, useCallback } from "react";
import { SupervisorStateManager, loadConfig, loadConfigAsync, getAvailableModels, getDefaultSensitivity, getPresetGoals, setApiConfig, loadApiConfig, getApiConfig, readSupervisorLogs, clearSupervisorLogs } from "@/lib/supervisor";
import { setSupervisionEnabled, writeSupervisorLog, loadSupervisionState } from "@/lib/supervisor/engine";
import type { SupervisorLogEntry } from "@/lib/supervisor/types";

interface Props {
  onStateChange?: (state: any) => void;
}

export function SupervisorPanel({ onStateChange }: Props) {
  const [stateManager] = useState(() => new SupervisorStateManager());
  const [state, setState] = useState<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [selectedModel, setSelectedModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showGoalPicker, setShowGoalPicker] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiConfigured, setApiConfigured] = useState(false);
  const [decisionLog, setDecisionLog] = useState<string[]>([]);
  const [models, setModels] = useState<Array<{ provider: string; modelId: string; name: string }>>([]);
  const [presetGoals, setPresetGoals] = useState<Array<{ name: string; goal: string; description?: string }>>([]);

  useEffect(() => {
    // 恢复监督开关状态（刷新后保持开启）
    try { loadSupervisionState(); } catch (e) { console.error('恢复监督状态失败:', e); }
    
    // 优先读取用户手动保存的目标（localStorage）
    try {
      const savedGoal = localStorage.getItem('supervisor-goal');
      if (savedGoal) setOutcome(savedGoal);
    } catch (e) { console.error('Failed to load saved goal:', e); }
    
    // 再读取 stateManager 的其他状态
    stateManager.loadFromStorage();
    const savedState = stateManager.getState();
    if (savedState) {
      if (savedState.provider && savedState.modelId) {
        setSelectedModel({ provider: savedState.provider, modelId: savedState.modelId });
      }
    }
    const unsubscribe = stateManager.subscribe((newState) => {
      setState(newState);
      onStateChange?.(newState);
    });
    const savedApiConfig = loadApiConfig();
    if (savedApiConfig.endpoint) setApiEndpoint(savedApiConfig.endpoint);
    if (savedApiConfig.key) setApiKey(savedApiConfig.key);
    setApiConfigured(!!savedApiConfig.key);
    const loadModels = async () => {
      const config = await loadConfigAsync();
      const loadedModels = config.models.map(m => ({
        provider: m.provider,
        modelId: m.modelId,
        name: m.name || `${m.provider}/${m.modelId}`,
      }));
      setModels(loadedModels);
      setPresetGoals(getPresetGoals());
      if (loadedModels.length > 0 && !selectedModel) {
        setSelectedModel({ provider: loadedModels[0].provider, modelId: loadedModels[0].modelId });
      }
    };
    loadModels();
    return unsubscribe;
  }, [stateManager, onStateChange]);

  const handleStart = useCallback(() => {
    if (!outcome.trim()) return;
    stateManager.start(outcome.trim(), selectedModel?.provider || '', selectedModel?.modelId || '', 'medium');
    setSupervisionEnabled(true);
    writeSupervisorLog({ type: 'system', content: `监督启动: "${outcome.trim()}"`, result: 'info' });
  }, [outcome, selectedModel, stateManager]);

  const handleStop = useCallback(() => {
    stateManager.stop();
    setSupervisionEnabled(false);
    writeSupervisorLog({ type: 'system', content: '监督停止', result: 'info' });
  }, [stateManager]);

  const addDecisionLog = useCallback((message: string) => {
    setDecisionLog(prev => [...prev, message]);
  }, []);

  const handleLoadFromFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,.markdown';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          if (content) { setOutcome(content.trim()); addDecisionLog(`已从文件加载: ${file.name}`); }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [addDecisionLog]);

  const handleSelectPreset = useCallback((goal: string) => {
    setOutcome(goal);
    setShowGoalPicker(false);
    writeSupervisorLog({ type: 'system', content: '已选择预设目标', result: 'info' });
  }, []);

  const handleSaveGoal = useCallback(() => {
    if (!outcome.trim()) return;
    try { localStorage.setItem('supervisor-goal', outcome.trim()); writeSupervisorLog({ type: 'system', content: '目标已保存', result: 'info' }); }
    catch (e) { console.error('Failed to save goal:', e); }
  }, [outcome]);

  const handleSaveApiConfig = useCallback(() => {
    setApiConfig(apiEndpoint, apiKey);
    setApiConfigured(true);
    setShowApiConfig(false);
    writeSupervisorLog({ type: 'system', content: 'API配置已保存', result: 'info' });
  }, [apiEndpoint, apiKey]);

  const isConfigValid = useCallback(() => {
    if (!selectedModel || !apiKey.trim()) return false;
    if (apiEndpoint.trim()) return true;
    const supportedProviders = ['openai', 'deepseek', 'moonshot'];
    return supportedProviders.includes(selectedModel.provider);
  }, [selectedModel, apiKey, apiEndpoint]);

  const isActive = state?.active === true;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setIsExpanded(!isExpanded)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: isActive ? "rgba(34, 197, 94, 0.1)" : "none", border: "1px solid var(--border)", borderRadius: 6, color: isActive ? "#22c55e" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 500, transition: "all 0.12s" }} title={isActive ? "监督已激活" : "监督未激活"}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        <span>{isActive ? "监督中" : "监督"}</span>
        {isActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />}
      </button>

      {isExpanded && (
        <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)", padding: 12, minWidth: 350, maxWidth: 400, maxHeight: 500, overflowY: "auto", zIndex: 100 }}>
          <div style={{ marginBottom: 12, position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>监督目标</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setShowGoalPicker(!showGoalPicker)} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>预设</button>
                <button onClick={handleLoadFromFile} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>加载</button>
                <button onClick={handleSaveGoal} style={{ fontSize: 11, color: "white", background: "#22c55e", border: "none", borderRadius: 4, cursor: "pointer", padding: "4px 10px", fontWeight: 500 }}>保存</button>
              </div>
            </div>
            <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="输入监督目标..." style={{ width: "100%", minHeight: 60, padding: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontSize: 12, resize: "vertical" }} />
            {showGoalPicker && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, padding: 8, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 200, minWidth: 200, maxHeight: 200, overflowY: "auto" }}>
                {presetGoals.map((g, i) => (
                  <div key={i} onClick={() => handleSelectPreset(g.goal)} style={{ padding: "6px 10px", cursor: "pointer", fontSize: 11, color: "var(--text-dim)", borderRadius: 6, marginBottom: 4, background: "var(--bg-secondary)", transition: "all 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; e.currentTarget.style.color = "var(--text-dim)"; }}>{g.name}</div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {!isActive ? (
              <button onClick={handleStart} disabled={!outcome.trim()} style={{ flex: 1, padding: "8px", background: outcome.trim() ? "#22c55e" : "var(--bg-secondary)", color: outcome.trim() ? "white" : "var(--text-muted)", border: "none", borderRadius: 4, cursor: outcome.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 500 }}>启动监督</button>
            ) : (
              <button onClick={handleStop} style={{ flex: 1, padding: "8px", background: "#ef4444", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>停止监督</button>
            )}
          </div>

          {!outcome.trim() && !isActive && (
            <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.3)", borderRadius: 4, fontSize: 11, color: "#f59e0b", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>⚠️ 未设置监督目标</div>
              <div>请输入监督目标后启动</div>
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>监督日志</span>
              <button onClick={() => { if (window.confirm('确定要清空所有监督日志吗？')) { clearSupervisorLogs(); setDecisionLog([]); } }} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>清空</button>
            </div>
            <LogList />
          </div>
        </div>
      )}
    </div>
  );
}

/** 可展开的日志列表（含筛选tab） */
function LogList() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<SupervisorLogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'intercepted' | 'reminded'>('all');

  useEffect(() => {
    const interval = setInterval(() => {
      setLogs(readSupervisorLogs());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (logs.length === 0) {
    return <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 8 }}>暂无日志</div>;
  }

  // 每个type对应一个关键图标（不重复）
  const typeIcon = (type: string) => {
    const icons: Record<string, string> = {
      file_protection: '⛔', consecutive_failure: '⛔', tech_stack_switch: '⚙️',
      search_guide: '📋', search_standard: '⏰', search_multi_dim: '🔍',
      image_handling: '🖼️', save_file_check: '💡', system: 'ℹ️',
    };
    return icons[type] || '💡';
  };

  // 去除内容开头的emoji（避免和typeIcon重复）
  const stripLeadingEmoji = (text: string) => text.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2000}-\u{206F}]\s*/u, '');

  // 统计
  const countIntercepted = logs.filter(l => l.result === 'intercepted').length;
  const countReminded = logs.filter(l => l.result === 'reminded').length;
  const countInfo = logs.filter(l => l.result === 'info').length;

  // 筛选
  const filtered = filter === 'all'
    ? [...logs].reverse()
    : [...logs.filter(l => l.result === filter)].reverse();

  const tabStyle = (tab: 'all' | 'intercepted' | 'reminded'): React.CSSProperties => ({
    padding: "4px 10px", border: "none", borderRadius: 4,
    background: filter === tab ? "var(--bg-hover)" : "transparent",
    color: filter === tab ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer", fontSize: 11, fontWeight: filter === tab ? 600 : 400,
  });

  return (
    <div>
      {/* 统计+筛选栏 */}
      <div style={{ display: "flex", gap: 4, marginBottom: 6, padding: "4px 6px", background: "var(--bg-secondary)", borderRadius: 4, fontSize: 11, alignItems: "center" }}>
        <button onClick={() => setFilter('intercepted')} style={tabStyle('intercepted')}>
          ⛔ 拦截 {countIntercepted}
        </button>
        <button onClick={() => setFilter('reminded')} style={tabStyle('reminded')}>
          💡 提醒 {countReminded}
        </button>
        <button onClick={() => setFilter('all')} style={tabStyle('all')}>
          ℹ️ 全部 {logs.length}
        </button>
      </div>

      {/* 日志列表 */}
      <div style={{ maxHeight: 180, overflowY: "auto", background: "var(--bg-secondary)", borderRadius: 4, padding: 8, fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
        {filtered.length === 0 ? (
          <span style={{ color: "var(--text-muted)", padding: 4 }}>无匹配日志</span>
        ) : filtered.map((log) => {
          const isExpanded = expandedId === log.id;
          const colorMap: Record<string, string> = {
            file_protection: '#ef4444', consecutive_failure: '#ef4444', tech_stack_switch: '#f59e0b',
            search_guide: '#22c55e', search_standard: '#f59e0b', search_multi_dim: '#f59e0b',
            image_handling: '#f59e0b', save_file_check: '#f59e0b', system: '#22c55e',
          };
          return (
            <div key={log.id} style={{ marginBottom: 4, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
              <div onClick={() => setExpandedId(isExpanded ? null : log.id)}
                   style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: colorMap[log.type] || 'var(--text-dim)' }}>
                <span style={{ flexShrink: 0 }}>{typeIcon(log.type)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stripLeadingEmoji(log.content)}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s", color: "var(--text-muted)", flexShrink: 0 }}>▼</span>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 6, padding: "6px 8px", background: "var(--bg)", borderRadius: 4, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.8 }}>
                  <div><strong>内容:</strong> {log.content}</div>
                  <div><strong>类型:</strong> {log.type}</div>
                  {log.detail && <div><strong>详情:</strong> {log.detail}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
