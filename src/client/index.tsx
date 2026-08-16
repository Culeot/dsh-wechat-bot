/**
 * dsh-weixin-ui web client: Settings → 微信桥 panel, Reasonix-style.
 * Connection summary + QR login, enable switches, tool-approval mode, model,
 * access control (trusted list / pair), working dir, credential management,
 * delete bot. Config auto-saves through the /dsh-weixin-login RPC channel.
 *
 * @module dsh-weixin-ui/client
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Schema from '@deepseek-ai/schemastery';

export const name = 'weixin-ui';
export const inject = ['slots'];
export const Config = Schema.object({});

const CH = '/dsh-weixin-login';

interface BridgeConfig {
  enabled: boolean;
  gatewayEnabled: boolean;
  approvalMode: 'ask' | 'auto' | 'yolo';
  model: string;
  accessMode: 'trusted' | 'all' | 'pair';
  trustedUsers: string[];
  trustedGroups: string[];
  workingDir: string;
  mode: 'standard' | 'ptc' | 'minimal' | 'cordis' | 'custom';
  customPreset: string;
  provider: string;
  reasoningEffort: string;
}

type RpcConnection = {
  rpc: {
    call(channel: string, method: string, payload?: Record<string, unknown>):
      Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string; details?: Record<string, unknown> } }>;
  };
};

const card: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-normal, #555)',
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 10,
  background: 'var(--dsw-alias-bg-layer-1, #1f1f1f)',
};
const cardTitle: React.CSSProperties = { fontWeight: 600, fontSize: 13, marginBottom: 8 };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 };
const label: React.CSSProperties = { fontSize: 13, minWidth: 90, color: 'var(--dsw-alias-text-secondary, #aaa)' };
const muted: React.CSSProperties = { color: 'var(--dsw-alias-text-secondary, #999)' };
const hint: React.CSSProperties = { ...muted, fontSize: 12, marginTop: 2 };
const inputStyle: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 6, fontSize: 13, color: 'inherit', flex: 1, minWidth: 160,
  border: '1px solid var(--dsw-alias-border-normal, #666)',
  background: 'var(--dsw-alias-bg-layer-1, #2a2a2a)',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit', whiteSpace: 'pre-wrap' };
const btn: React.CSSProperties = {
  padding: '5px 14px', borderRadius: 6, fontSize: 13, color: 'inherit', cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-normal, #666)',
  background: 'var(--dsw-alias-bg-layer-1, #2a2a2a)',
};
const dangerBtn: React.CSSProperties = { ...btn, color: '#e5484d', borderColor: '#e5484d80' };
const danger: React.CSSProperties = { color: '#e5484d' };
const okColor: React.CSSProperties = { color: '#30a46c' };
const radioLabel: React.CSSProperties = { fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' };

export function apply(ctx: { get(key: string): unknown; slots: { inject(slot: string, fn: () => unknown): void } }, _config: unknown): void {
  const connection = ctx.get('connection') as RpcConnection | undefined;
  if (!connection) return;
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'weixin',
    order: 26,
    label: () => '微信桥',
    inject: () => ({ connection }),
  }, WeixinPanel));
}

function Radio({ checked, onChange, labelText, hintText }: { checked: boolean; onChange: () => void; labelText: string; hintText?: string }) {
  return (
    <label style={radioLabel}>
      <input type="radio" checked={checked} onChange={onChange} />
      <span>
        {labelText}
        {hintText !== undefined && <span style={hint}> {hintText}</span>}
      </span>
    </label>
  );
}

function WeixinPanel({ connection }: { connection: RpcConnection }) {
  const [state, setState] = useState<{ loggedIn: boolean; botId?: string; userId?: string; tokenConfigured?: boolean } | null>(null);
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [qr, setQr] = useState<{ qrcodeKey: string; qrcodeBase64: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = useState<{ groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }> } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const call = async (method: string, payload: Record<string, unknown> = {}) => {
    const r = await connection.rpc.call(CH, method, payload);
    if (!r.ok) throw new Error(r.error?.message ?? method + ' failed');
    return r.value as Record<string, unknown>;
  };

  const loadState = useCallback(async () => {
    try {
      const s = await call('state');
      setState({ loggedIn: s.loggedIn === true, botId: String(s.botId ?? ''), userId: String(s.userId ?? ''), tokenConfigured: s.tokenConfigured === true });
      setConfig(s.config as BridgeConfig);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadState();
    call('listPresets').then((r) => {
      const list = Array.isArray(r) ? (r as Array<{ id: string; name: string }>) : [];
      setPresets(list);
    }).catch(() => {});
    call('models').then((r) => {
      const g = (r as { groups?: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }> }).groups;
      if (Array.isArray(g)) setModels({ groups: g });
    }).catch(() => {});
  }, [loadState]);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const patchConfig = (patch: Partial<BridgeConfig>) => {
    setConfig((prev) => {
      const next = { ...(prev as BridgeConfig), ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await call('setConfig', { config: next });
          setSaved('已保存');
          setTimeout(() => setSaved(''), 1500);
        } catch (e) {
          setError(String(e));
        }
      }, 400);
      return next;
    });
  };

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const startLogin = async () => {
    setBusy(true); setError(''); setStatus('');
    stopPoll();
    try {
      const q = await call('qr');
      setQr({ qrcodeKey: String(q.qrcodeKey), qrcodeBase64: String(q.qrcodeBase64) });
      setStatus('请用手机微信扫一扫');
      pollRef.current = setInterval(async () => {
        try {
          const s = await call('status', { qrcodeKey: String(q.qrcodeKey) });
          const st = String(s.status);
          if (st === 'confirmed') {
            stopPoll();
            setStatus('✅ 登录成功');
            setQr(null);
            await loadState();
          } else if (st === 'scaned') {
            setStatus('已扫码,请在微信里点击确认');
          } else if (st === 'expired') {
            stopPoll();
            setStatus('❌ 二维码已过期,点「重新扫码」');
            setQr(null);
          } else {
            setStatus('等待扫码…');
          }
        } catch (e) {
          stopPoll();
          setError(String(e));
        }
      }, 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearToken = async () => {
    if (!window.confirm('清除已保存的密钥?bridge 将无法收发消息,需要重新扫码。')) return;
    try {
      await call('clearToken');
      await loadState();
      setSaved('密钥已清除');
    } catch (e) { setError(String(e)); }
  };

  const deleteBot = async () => {
    if (!window.confirm('确认删除机器人?将移除账号与全部配置,不可恢复。')) return;
    try {
      await call('deleteBot');
      await loadState();
      setQr(null);
      setSaved('机器人已删除');
    } catch (e) { setError(String(e)); }
  };

  const ui = config ?? { enabled: true, gatewayEnabled: true, approvalMode: 'ask' as const, model: '', accessMode: 'trusted' as const, trustedUsers: [], trustedGroups: [], workingDir: '', mode: 'standard' as const, customPreset: '', provider: 'deepseek-official', reasoningEffort: '' };

  // 当前所选模型的思考强度选项(动态读取)
  const selectedModelReasoning = (() => {
    if (!models || !ui.model) return null;
    const g = models.groups.find((x) => x.id === (ui.provider || 'deepseek-official'));
    if (!g) return null;
    const m = g.models.find((x) => x.id === ui.model);
    return m?.reasoning ?? null;
  })();

  return (
    <div style={{ fontFamily: 'inherit', maxWidth: 620 }}>
      <div style={{ ...row, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>微信桥(dsh-weixin-ui)</span>
        <span style={{ ...muted, fontSize: 12 }}>iLink 官方通道 · 更改会自动保存</span>
        {saved !== '' && <span style={{ ...okColor, fontSize: 12 }}>{saved}</span>}
      </div>

      {/* 连接摘要 */}
      <div style={card}>
        <div style={cardTitle}>连接摘要</div>
        <div style={row}><span style={label}>渠道</span><span>微信</span></div>
        <div style={row}><span style={label}>远端 ID</span><span>{state?.botId || state?.userId || '—'}</span></div>
        <div style={row}><span style={label}>范围</span><span>全局</span></div>
        <div style={row}>
          <span style={label}>状态</span>
          {state?.loggedIn ? <span style={okColor}>已连接</span> : <span style={danger}>未连接</span>}
        </div>
        {!state?.loggedIn && (
          <div style={{ marginTop: 6 }}>
            {qr ? (
              <div style={{ textAlign: 'center' }}>
                <img src={qr.qrcodeBase64} alt="微信登录二维码" style={{ width: 200, height: 200, borderRadius: 8, background: '#fff' }} />
                <div style={{ ...muted, fontSize: 13, marginTop: 6 }}>{status}</div>
                <div style={{ marginTop: 8 }}>
                  <button style={btn} onClick={() => void startLogin()} disabled={busy}>重新扫码</button>
                </div>
              </div>
            ) : (
              <div>
                <button style={btn} onClick={() => void startLogin()} disabled={busy}>{busy ? '获取二维码…' : '扫码登录'}</button>
                {status !== '' && <span style={{ ...muted, fontSize: 13, marginLeft: 10 }}>{status}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 启用开关 */}
      <div style={card}>
        <div style={cardTitle}>启用</div>
        <div style={row}>
          <label style={radioLabel}>
            <input type="checkbox" checked={ui.enabled} onChange={(e) => patchConfig({ enabled: e.target.checked })} />
            启用机器人
          </label>
        </div>
        <div style={row}>
          <label style={radioLabel}>
            <input type="checkbox" checked={ui.gatewayEnabled} onChange={(e) => patchConfig({ gatewayEnabled: e.target.checked })} />
            启用网关
          </label>
        </div>
      </div>

      {/* Agent 模式 */}
      <div style={card}>
        <div style={cardTitle}>Agent 模式</div>
        <div style={hint}>选择微信机器人使用哪种官方 agent 模式执行任务。</div>
        <div style={{ ...row, marginTop: 6, gap: 12 }}>
          <Radio checked={ui.mode === 'standard'} onChange={() => patchConfig({ mode: 'standard' })} labelText="标准模式" hintText="完整编码 Agent" />
          <Radio checked={ui.mode === 'ptc'} onChange={() => patchConfig({ mode: 'ptc' })} labelText="PTC 模式" hintText="标准能力 + Code SDK" />
          <Radio checked={ui.mode === 'minimal'} onChange={() => patchConfig({ mode: 'minimal' })} labelText="极简模式" hintText="仅编码工具" />
          <Radio checked={ui.mode === 'cordis'} onChange={() => patchConfig({ mode: 'cordis' })} labelText="创造模式" hintText="可创作 preset" />
          <Radio checked={ui.mode === 'custom'} onChange={() => patchConfig({ mode: 'custom' })} labelText="自定义 agent" hintText="选你自己的 preset" />
        </div>
        {ui.mode === 'custom' && (
          <div style={{ ...row, marginTop: 8 }}>
            <span style={label}>自定义 preset</span>
            <select style={inputStyle} value={ui.customPreset} onChange={(e) => patchConfig({ customPreset: e.target.value })}>
              <option value="">选择 preset…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
            {presets.length === 0 && <span style={hint}>暂无用户 preset(~/.dsh/.agent-presets/ 下)</span>}
          </div>
        )}
      </div>

      {/* 模型 */}
      <div style={card}>
        <div style={cardTitle}>模型</div>
        <div style={hint}>这个机器人处理消息时使用的模型。留空 = 跟主 agent 同配置。</div>
        <div style={{ ...row, marginTop: 6 }}>
          <select style={inputStyle} value={ui.model ? `${ui.provider || 'deepseek-official'}:${ui.model}` : ''} onChange={(e) => {
            const v = e.target.value;
            if (!v) { patchConfig({ model: '', provider: 'deepseek-official' }); return; }
            const [prov, ...rest] = v.split(':');
            patchConfig({ model: rest.join(':'), provider: prov });
          }}>
            <option value="">跟主 agent 同配置</option>
            {(models?.groups ?? []).map((g) => (
              <optgroup key={g.id} label={g.name}>
                {(g.models ?? []).map((m) => (
                  <option key={g.id + ':' + m.id} value={g.id + ':' + m.id}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ ...row, marginTop: 6 }}>
          <span style={label}>思考强度</span>
          <select style={inputStyle} value={ui.reasoningEffort} onChange={(e) => patchConfig({ reasoningEffort: e.target.value })}>
            <option value="">跟主 agent 同配置</option>
            {(selectedModelReasoning?.efforts ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        {selectedModelReasoning && selectedModelReasoning.efforts.length === 0 && (
          <div style={hint}>该模型无思考强度选项。</div>
        )}
      </div>

      {/* 访问控制(固定:仅扫码用户) */}
      <div style={card}>
        <div style={cardTitle}>访问控制</div>
        <div style={hint}>仅允许扫码登录的用户(owner)连接机器人,他人消息自动忽略。如需开放,后续版本支持受信任名单。</div>
      </div>

      {/* 运行设置 */}
      <div style={card}>
        <div style={cardTitle}>运行设置</div>
        <div style={row}><span style={label}>工作目录</span>
          <input style={inputStyle} placeholder="留空时使用启动 Bot 时的工作目录,例如 /path/to/project" value={ui.workingDir} onChange={(e) => patchConfig({ workingDir: e.target.value })} />
        </div>
      </div>

      {/* 凭据 */}
      <div style={card}>
        <div style={cardTitle}>凭据</div>
        <div style={row}>
          <span style={label}>账号</span>
          <span>{state?.botId || '—'}</span>
        </div>
        <div style={row}>
          <span style={label}>已配置密钥</span>
          <span>{state?.tokenConfigured ? 'WEIXIN_BOT_TOKEN' : '未配置'}</span>
          {state?.tokenConfigured && <button style={dangerBtn} onClick={() => void clearToken()}>清除密钥</button>}
        </div>
      </div>

      {/* 危险操作 */}
      <div style={{ ...card, borderColor: '#e5484d60' }}>
        <div style={{ ...cardTitle, color: '#e5484d' }}>危险操作</div>
        <div style={hint}>从已连接 Bot 中移除这个机器人;不会自动清除已保存的密钥。</div>
        <div style={{ marginTop: 8 }}>
          <button style={dangerBtn} onClick={() => void deleteBot()}>删除机器人</button>
        </div>
      </div>

      {error !== '' && <div style={{ ...danger, fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
