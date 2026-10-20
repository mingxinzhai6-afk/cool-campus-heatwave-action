import { TOOLS, TOOL_ORDER, type ToolId } from '../data/tools';
import { budgetLeft, isUnlocked, type GameState } from '../lib/engine';

export function ToolGlyph({ toolId, size = 26 }: { toolId: ToolId; size?: number }) {
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 32 32' } as const;
  switch (toolId) {
    case 'tree':
      return <svg {...common}><rect x="15" y="18" width="3" height="9" rx="1.4" fill="#8a6a52" /><circle cx="16" cy="13" r="9" fill="#4f9e69" /><circle cx="11" cy="16" r="6" fill="#5fb078" /><circle cx="21" cy="15" r="6.4" fill="#57a872" /><circle cx="15" cy="9" r="4.6" fill="#6dbf85" /></svg>;
    case 'canopy':
      return <svg {...common}><path d="M16 5 L28 13 L16 21 L4 13 Z" fill="#8b7cf0" /><path d="M16 5 L28 13 L16 21 L4 13 Z" fill="#fff" opacity="0.16" /><rect x="7" y="13" width="2" height="11" fill="#6b5fc4" /><rect x="23" y="13" width="2" height="11" fill="#6b5fc4" /></svg>;
    case 'coolpave':
      return <svg {...common}><path d="M16 6 L28 14 L16 22 L4 14 Z" fill="#eef0fb" stroke="#c2c8e8" strokeWidth="1.4" /><path d="M16 10 L23 14 L16 18 L9 14 Z" fill="none" stroke="#c2c8e8" strokeWidth="1" /></svg>;
    case 'pavement':
      return <svg {...common}><path d="M16 6 L28 14 L16 22 L4 14 Z" fill="#9fc2d6" /><circle cx="13" cy="13" r="1.5" fill="#5d7f93" /><circle cx="19" cy="13" r="1.5" fill="#5d7f93" /><circle cx="16" cy="16.5" r="1.5" fill="#5d7f93" /></svg>;
    case 'mist':
      return <svg {...common}><circle cx="11" cy="12" r="6" fill="#9ddcf5" opacity="0.75" /><circle cx="21" cy="10" r="5" fill="#c6ecfa" /><circle cx="17" cy="17" r="4.5" fill="#d8f2fb" /><rect x="14" y="20" width="4" height="7" rx="1.4" fill="#5aa9c9" /></svg>;
    case 'water':
      return <svg {...common}><ellipse cx="16" cy="20" rx="11" ry="6" fill="#8fd0ea" /><ellipse cx="16" cy="20" rx="11" ry="6" fill="none" stroke="#fff" strokeWidth="1.4" /><path d="M16 4 C19 9 22 12 22 15 A6 6 0 0 1 10 15 C10 12 13 9 16 4 Z" fill="#4aa8c9" /></svg>;
    case 'station':
      return <svg {...common}><rect x="7" y="12" width="18" height="14" rx="2.4" fill="#5db6d6" /><path d="M16 15 C18 18 20 20 20 22 A4 4 0 0 1 12 22 C12 20 14 18 16 15 Z" fill="#fff" /><path d="M25 15 v9" stroke="#2f7f9e" strokeWidth="2.4" strokeLinecap="round" /></svg>;
    case 'greenroof':
      return <svg {...common}><path d="M16 6 L28 14 L16 22 L4 14 Z" fill="#7cc79a" stroke="#5aa877" strokeWidth="1.4" /><circle cx="12" cy="13" r="2.6" fill="#8fd6a6" /><circle cx="19" cy="13" r="2.6" fill="#5fb87e" /><circle cx="15.5" cy="16.5" r="2.4" fill="#8fd6a6" /></svg>;
    default:
      return null;
  }
}

type Props = {
  state: GameState;
  selected: ToolId | null;
  removeMode: boolean;
  onSelect: (t: ToolId | null) => void;
  onToggleRemove: () => void;
  onUndo: () => void;
  canUndo: boolean;
};

export default function Toolbar({ state, selected, removeMode, onSelect, onToggleRemove, onUndo, canUndo }: Props) {
  const budget = budgetLeft(state);

  return (
    <div className="dock">
      <button
        className={`dock-btn ghost-btn ${removeMode ? 'active' : ''}`}
        onClick={onToggleRemove}
        title="拆除模式：点击已改造的地块可拆除并退回预算"
      >
        <span className="dock-emoji">🧹</span>
        <span className="dock-name">拆除</span>
        <span className="dock-meta">点击地块</span>
      </button>

      <div className="dock-tools" role="toolbar" aria-label="改造工具箱">
        {TOOL_ORDER.map((id) => {
          const tool = TOOLS[id];
          const unlocked = isUnlocked(state, id);
          const affordable = budget >= tool.cost;
          const disabled = !unlocked || !affordable;
          const active = selected === id && !removeMode;
          return (
            <button
              key={id}
              className={`dock-btn tool-btn ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
              disabled={disabled}
              onClick={() => onSelect(active ? null : id)}
              title={`${tool.name}｜${tool.desc}\n造价 ${tool.cost} 万 · 半径 ${tool.radius} 格\n适合：${tool.forIssue}\n代价：${tool.caveat}`}
            >
              <span className="dock-glyph"><ToolGlyph toolId={id} /></span>
              <span className="dock-name">{tool.name}</span>
              <span className="dock-meta">{tool.cost} 万 · R{tool.radius}</span>
              {!unlocked && <span className="dock-lock">第 {tool.unlockAt} 关解锁</span>}
            </button>
          );
        })}
      </div>

      <button className="dock-btn ghost-btn" onClick={onUndo} disabled={!canUndo} title="撤销上一步">
        <span className="dock-emoji">↩</span>
        <span className="dock-name">撤销</span>
        <span className="dock-meta">上一步</span>
      </button>
    </div>
  );
}
