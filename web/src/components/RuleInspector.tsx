import { useRef, useState } from 'react';
import { Badge, Button, Checkbox, Dialog, Input, Select, Textarea } from '@ui/components';
import type { MetaTag, Rule, RuleType } from '../types';

export interface RuleInspectorProps {
  open: boolean;
  mode: 'new' | 'edit';
  draft: Rule | null;
  types: RuleType[];
  metaTags: MetaTag[];
  onType: (type: string) => void;
  onField: (key: string, value: unknown) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: (() => void) | null;
}

export function RuleInspector({
  open,
  mode,
  draft,
  types,
  metaTags,
  onType,
  onField,
  onCancel,
  onSave,
  onDelete,
}: RuleInspectorProps) {
  const [tagTarget, setTagTarget] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());

  if (!open || !draft) return null;
  const meta = types.find((type) => type.type === draft.type);
  const fieldValue = (key: string) => draft[key];
  const activeTag = tagTarget ? meta?.fields.find((field) => field.key === tagTarget) : null;

  const insertTag = (token: string) => {
    if (!tagTarget) return;
    const element = inputs.current.get(tagTarget);
    const current = String(draft[tagTarget] ?? '');
    if (element && typeof element.selectionStart === 'number') {
      const start = element.selectionStart;
      const end = element.selectionEnd ?? start;
      onField(tagTarget, `${current.slice(0, start)}${token}${current.slice(end)}`);
    } else {
      onField(tagTarget, `${current}${token}`);
    }
    setTagTarget(null);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onCancel}
        size="lg"
        title={mode === 'new' ? '新建规则' : '编辑规则'}
        description={meta?.summary}
        footer={
          <>
            {onDelete ? (
              <Button variant="danger" onClick={onDelete} className="rn-inspector__danger">
                删除规则
              </Button>
            ) : null}
            <span className="rn-spacer" />
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
            <Button variant="primary" onClick={onSave} disabled={!meta}>
              应用并预览
            </Button>
          </>
        }
      >
        <div className="rn-inspector">
          <div className="rn-inspector__types" role="listbox" aria-label="规则类型">
            {types.map((type) => (
              <button
                key={type.type}
                type="button"
                role="option"
                aria-selected={type.type === draft.type}
                className={`rn-type${type.type === draft.type ? ' is-active' : ''}`}
                onClick={() => onType(type.type)}
                title={type.summary}
              >
                {type.label}
              </button>
            ))}
          </div>

          {meta ? (
            <>
              <div className="rn-inspector__fields">
                {meta.fields.map((field) => {
                  const value = fieldValue(field.key);
                  const id = `rn-field-${field.key}`;
                  if (field.kind === 'bool') {
                    return (
                      <div className="rn-inspector__row" key={field.key}>
                        <Checkbox
                          checked={Boolean(value)}
                          onChange={(checked) => onField(field.key, checked)}
                          label={field.label}
                        />
                        {field.hint ? <p className="rn-field-hint">{field.hint}</p> : null}
                      </div>
                    );
                  }
                  return (
                    <div className="rn-inspector__row" key={field.key}>
                      <div className="rn-field-head">
                        <label className="rn-field-label" htmlFor={id}>
                          {field.label}
                        </label>
                        {field.metaTags ? (
                          <button type="button" className="rn-tag-btn" onClick={() => setTagTarget(field.key)}>
                            🏷 插入元标签
                          </button>
                        ) : null}
                      </div>
                      {field.kind === 'select' ? (
                        <Select
                          id={id}
                          value={String(value ?? '')}
                          options={field.options ?? []}
                          onChange={(event) => onField(field.key, event.target.value)}
                        />
                      ) : field.kind === 'textarea' ? (
                        <Textarea
                          id={id}
                          rows={3}
                          value={String(value ?? '')}
                          spellCheck={false}
                          ref={(element) => {
                            if (element) inputs.current.set(field.key, element);
                            else inputs.current.delete(field.key);
                          }}
                          onChange={(event) => onField(field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          id={id}
                          type={field.kind === 'number' ? 'number' : 'text'}
                          value={String(value ?? '')}
                          spellCheck={false}
                          ref={(element) => {
                            if (element) inputs.current.set(field.key, element);
                            else inputs.current.delete(field.key);
                          }}
                          onChange={(event) =>
                            onField(field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value)
                          }
                        />
                      )}
                      {field.hint ? <p className="rn-field-hint">{field.hint}</p> : null}
                    </div>
                  );
                })}
              </div>

              <aside className="rn-inspector__help">
                <p className="rn-help-text">{meta.help}</p>
                {meta.examples?.length ? (
                  <div className="rn-examples">
                    <span className="rn-eyebrow">EXAMPLES</span>
                    {meta.examples.slice(0, 2).map((example, index) => (
                      <div className="rn-example" key={index}>
                        <code>{example.input}</code>
                        <span aria-hidden="true">→</span>
                        <code className="is-out">{example.output}</code>
                      </div>
                    ))}
                  </div>
                ) : null}
              </aside>
            </>
          ) : (
            <p className="rn-muted">先选一个规则类型。</p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(activeTag)}
        onClose={() => setTagTarget(null)}
        title="插入元标签"
        description="插入的是标签本身，预览时按每个文件实时展开。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagTarget(null)}>
              取消
            </Button>
          </>
        }
      >
        <div className="rn-tags">
          {metaTags.map((tag) => (
            <button key={tag.name} type="button" className="rn-tag" onClick={() => insertTag(tag.token)}>
              <span className="rn-tag__label">{tag.label}</span>
              <code>{tag.token}</code>
              <span className="rn-tag__desc">{tag.description}</span>
              <Badge tone="neutral">例 {tag.example}</Badge>
            </button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
