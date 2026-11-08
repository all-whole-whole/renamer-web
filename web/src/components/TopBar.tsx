import { Badge, Button, IconButton, Select } from '@ui/components';
import type { PresetSummary } from '../types';

export interface TopBarProps {
  presets: PresetSummary[];
  presetName: string;
  connected: boolean;
  status: string;
  busy: boolean;
  onPresetName: (name: string) => void;
  onLoad: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
}

export function TopBar({
  presets,
  presetName,
  connected,
  status,
  busy,
  onPresetName,
  onLoad,
  onSave,
  onSaveAs,
  onDelete,
}: TopBarProps) {
  return (
    <header className="rn-topbar">
      <div className="rn-brand">
        <span className="rn-brand__mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M2.5 6.5 8 3.5l5.5 3L8 9.5zM2.5 9.8 8 12.8l5.5-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="rn-brand__text">
          <strong>renamer<span>web</span></strong>
          <em>批量重命名工作台</em>
        </span>
      </div>

      <div className="rn-presets">
        <span className="rn-presets__label">预设</span>
        <Select
          aria-label="选择预设"
          value={presetName}
          onChange={(event) => onPresetName(event.target.value)}
          options={[
            { value: '', label: presets.length ? '选择预设…' : '还没有预设' },
            ...presets.map((preset) => ({
              value: preset.name,
              label: `${preset.name}（${preset.rules} 条规则）`,
            })),
          ]}
        />
        <Button size="sm" variant="secondary" disabled={!presetName || busy} onClick={onLoad}>
          载入
        </Button>
        <Button size="sm" variant="ghost" disabled={!presetName || busy} onClick={onSave}>
          保存
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onSaveAs}>
          另存为
        </Button>
        <IconButton label="删除当前预设" size="sm" disabled={!presetName || busy} onClick={onDelete}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8h6.6l.7-8M6.7 7v3.5M9.3 7v3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
      </div>

      <div className="rn-connection">
        <span className={`rn-connection__dot${connected ? ' is-on' : ' is-off'}`} aria-hidden="true" />
        <Badge tone={connected ? 'success' : 'danger'} dot>
          {status}
        </Badge>
      </div>
    </header>
  );
}
