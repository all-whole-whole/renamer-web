import { Button, Card, IconButton, Badge } from '@ui/components';
import type { Rule, RuleType } from '../types';
import { describeRule } from '../lib/util';

export interface RulesPanelProps {
  rules: Rule[];
  types: RuleType[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function RulesPanel({
  rules,
  types,
  activeId,
  busy,
  onSelect,
  onNew,
  onEdit,
  onToggle,
  onMove,
  onDelete,
  onClear,
}: RulesPanelProps) {
  const activeIndex = rules.findIndex((rule) => rule.id === activeId);

  return (
    <Card padding="none" className="rn-rules">
      <div className="rn-panel-head">
        <div className="rn-panel-title">
          <span className="rn-eyebrow">RULES</span>
          <h2>
            规则工作台 <span className="rn-count">{rules.length || ''}</span>
          </h2>
        </div>
        <div className="rn-panel-tools">
          <IconButton
            label="上移规则"
            size="sm"
            disabled={busy || activeIndex <= 0}
            onClick={() => activeId && onMove(activeId, -1)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
          <IconButton
            label="下移规则"
            size="sm"
            disabled={busy || activeIndex < 0 || activeIndex >= rules.length - 1}
            onClick={() => activeId && onMove(activeId, 1)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
          <IconButton
            label="删除规则"
            size="sm"
            disabled={busy || !activeId}
            onClick={() => activeId && onDelete(activeId)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8h6.6l.7-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
          <IconButton label="清空规则" size="sm" disabled={busy || rules.length === 0} onClick={onClear}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>
      </div>

      <div className="rn-rules__toolbar">
        <Button variant="primary" block onClick={onNew} disabled={busy}>
          新建规则
        </Button>
      </div>

      <div className="rn-rules__scroll">
        {rules.length === 0 ? (
          <div className="rn-empty">
            <span className="rn-empty__icon" aria-hidden="true">
              ✦
            </span>
            <strong>规则栈还是空的</strong>
            <p>规则按从上到下的顺序依次作用，先从一条「替换」开始。</p>
            <Button size="sm" variant="ghost" onClick={onNew}>
              + 添加第一条规则
            </Button>
          </div>
        ) : (
          <ol className="rn-rule-list">
            {rules.map((rule, index) => {
              const meta = types.find((type) => type.type === rule.type);
              const active = rule.id === activeId;
              return (
                <li key={rule.id} className={`rn-rule${active ? ' is-active' : ''}${rule.enabled ? '' : ' is-off'}`}>
                  <button
                    type="button"
                    className="rn-rule__toggle"
                    aria-pressed={rule.enabled}
                    aria-label={rule.enabled ? '停用规则' : '启用规则'}
                    onClick={() => onToggle(rule.id)}
                  >
                    <span />
                  </button>
                  <span className="rn-rule__index">{index + 1}</span>
                  <button
                    type="button"
                    className="rn-rule__body"
                    onClick={() => onSelect(rule.id)}
                    onDoubleClick={() => onEdit(rule.id)}
                    title={rule.enabled ? '双击编辑' : '规则已停用'}
                  >
                    <span className="rn-rule__label">{describeRule(rule, types)}</span>
                    <span className="rn-rule__meta">
                      {meta?.summary ?? meta?.label ?? rule.type}
                    </span>
                  </button>
                  <span className="rn-rule__actions">
                    <IconButton label="编辑" size="sm" onClick={() => onEdit(rule.id)}>
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                        <path
                          d="M10.8 2.9 13 5.1 6.2 11.9 3 12.9l1-3.2z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </IconButton>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="rn-rules__foot">
        <Badge tone={rules.length ? 'accent' : 'neutral'}>
          {rules.filter((rule) => rule.enabled).length} 条启用
        </Badge>
        <span className="rn-muted">自上而下依次执行</span>
      </div>
    </Card>
  );
}
