/**
 * dsh-weixin-ui: WeChat bridge control RPC for the DSH web UI.
 * Reasonix-style settings panel: connection summary, enable switches,
 * tool-approval mode, model, access control (trusted list / pair), working
 * dir, credential management, delete bot. Config lives in
 * ~/.dsh/weixin-bridge-config.json; the standalone bridge.js reads the same
 * file (account + config), so the panel and the process stay in sync.
 *
 * @module dsh-weixin-ui/rpc
 */
import QRCode from 'qrcode';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const WEIXIN_LOGIN_CHANNEL = '/dsh-weixin-login';

const API = 'https://ilinkai.weixin.qq.com';
const APP_ID = 'bot';
const VERSION = String((2 << 16) | (2 << 8));
const HOME = process.env.USERPROFILE || homedir();
const ACCOUNT_FILE = join(HOME, '.dsh', 'weixin-bot-account.json');
const CONFIG_FILE = join(HOME, '.dsh', 'weixin-bridge-config.json');
const WEB_API = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
// 查询会话(模型目录用),首次创建后复用
let modelsSessionId: string | null = null;

/** 调 DSH web 会话 API(信封格式)。 */
async function apiCall<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const rpcId = 'wxrpc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const res = await fetch(WEB_API + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_API },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { result?: { ok?: boolean; value?: unknown; error?: { message?: string } } };
  if (!json.result || json.result.ok !== true) {
    throw new Error(json.result?.error?.message ?? `${method} failed: HTTP ${res.status}`);
  }
  return json.result.value as T;
}

async function ensureModelsSession(): Promise<string> {
  if (modelsSessionId) return modelsSessionId;
  const v = await apiCall<{ sessionId: string }>('session.create', { args: { agentPreset: 'standard' } });
  modelsSessionId = v.sessionId;
  return modelsSessionId;
}

interface BridgeConfig {
  enabled: boolean;
  gatewayEnabled: boolean;
  approvalMode: 'ask' | 'auto' | 'yolo';
  model: string;
  accessMode: 'trusted' | 'all' | 'pair';
  trustedUsers: string[];
  trustedGroups: string[];
  workingDir: string;
  /** 官方 agent 模式:standard=标准,ptc=PTC,minimal=极简,cordis=创造,custom=自定义 agent(选用户 preset)。 */
  mode: 'standard' | 'ptc' | 'minimal' | 'cordis' | 'custom';
  /** 自定义 agent 选中的用户 preset id(如 potato),仅 mode=custom 生效。 */
  customPreset: string;
  /** 模型 provider + 思考强度,空=用 DSH 默认。 */
  provider: string;
  reasoningEffort: string;
}

const DEFAULT_CONFIG: BridgeConfig = {
  enabled: true,
  gatewayEnabled: true,
  approvalMode: 'ask',
  model: '',
  accessMode: 'trusted',
  trustedUsers: [],
  trustedGroups: [],
  workingDir: '',
  mode: 'standard',
  customPreset: '',
  provider: 'deepseek-official',
  reasoningEffort: '',
};

interface RpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

type RpcHandler = (method: string, payload: Record<string, unknown>) => Promise<RpcResult> | RpcResult;

export interface RpcConnection {
  rpc: { handle(channel: string, handler: RpcHandler, options?: { authority?: string }): void };
}

function ok(value: unknown): RpcResult {
  return { ok: true, value };
}

function fail(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } };
}

function readConfig(): BridgeConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<BridgeConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: BridgeConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function accountState(): Record<string, unknown> {
  if (!existsSync(ACCOUNT_FILE)) return { loggedIn: false };
  try {
    const acc = JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8'));
    const okLogin = typeof acc.bot_token === 'string' && acc.bot_token !== '';
    return {
      loggedIn: okLogin,
      botId: String(acc.ilink_bot_id ?? ''),
      userId: String(acc.ilink_user_id ?? ''),
      savedAt: String(acc.saved_at ?? ''),
      tokenConfigured: okLogin,
    };
  } catch {
    return { loggedIn: false, error: '账号文件损坏' };
  }
}

async function apiGet(endpoint: string): Promise<Record<string, unknown>> {
  const r = await fetch(API + endpoint, {
    headers: { 'iLink-App-Id': APP_ID, 'iLink-App-ClientVersion': VERSION },
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (j.errcode && j.errcode !== 0 && String(j.ret) !== '0') {
    throw new Error(`${endpoint}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j;
}

function createHandler(): RpcHandler {
  return async (method, payload) => {
    try {
      switch (method) {
        case 'state':
          return ok({ ...accountState(), config: readConfig() });
        case 'getConfig':
          return ok(readConfig());
        case 'models': {
          const sid = await ensureModelsSession();
          const v = await apiCall<{ current?: { provider?: string; model?: string; reasoningEffort?: string }; groups?: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }> }>('session.models', { sessionId: sid });
          return ok({
            current: v.current ?? {},
            groups: (v.groups ?? []).map((g) => ({
              id: g.id,
              name: g.name,
              models: (g.models ?? []).map((m) => ({
                id: m.id,
                name: m.name,
                reasoning: m.reasoning
                  ? { efforts: m.reasoning.efforts.map((e) => ({ id: e.id, name: e.name })), defaultEffort: m.reasoning.defaultEffort }
                  : undefined,
              })),
            })),
          });
        }
        case 'listPresets': {          const dir = join(HOME, '.dsh', '.agent-presets');
          let presets: Array<{ id: string; name: string }> = [];
          try {
            if (existsSync(dir)) {
              for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue;
                const metaFile = join(dir, entry.name, 'preset.yml');
                let name = entry.name;
                try {
                  if (existsSync(metaFile)) {
                    const meta = JSON.parse('{' + readFileSync(metaFile, 'utf8').replace(/^name:\s*/m, '"__n":').split('\n').map((l) => l.includes(':') ? l.replace(/^(\w+):\s*/, '"$1":') : '"' + l.trim() + '"').join(',') + '}');
                    if (meta.__n) name = String(meta.__n);
                  }
                } catch { /* 元数据读不到就用目录名 */ }
                presets.push({ id: entry.name, name });
              }
            }
          } catch { /* 目录不存在返回空 */ }
          presets.sort((a, b) => a.id.localeCompare(b.id));
          return ok(presets);
        }
        case 'setConfig': {
          const patch = (payload?.config ?? {}) as Partial<BridgeConfig>;
          const next: BridgeConfig = { ...readConfig() };
          if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
          if (typeof patch.gatewayEnabled === 'boolean') next.gatewayEnabled = patch.gatewayEnabled;
          if (patch.approvalMode === 'ask' || patch.approvalMode === 'auto' || patch.approvalMode === 'yolo') next.approvalMode = patch.approvalMode;
          if (typeof patch.model === 'string') next.model = patch.model;
          if (patch.accessMode === 'trusted' || patch.accessMode === 'all' || patch.accessMode === 'pair') next.accessMode = patch.accessMode;
          if (Array.isArray(patch.trustedUsers)) next.trustedUsers = patch.trustedUsers.map(String).filter(Boolean);
          if (Array.isArray(patch.trustedGroups)) next.trustedGroups = patch.trustedGroups.map(String).filter(Boolean);
          if (typeof patch.workingDir === 'string') next.workingDir = patch.workingDir;
          if (patch.mode === 'standard' || patch.mode === 'ptc' || patch.mode === 'minimal' || patch.mode === 'cordis' || patch.mode === 'custom') next.mode = patch.mode;
          if (typeof patch.customPreset === 'string') next.customPreset = patch.customPreset;
          if (typeof patch.provider === 'string') next.provider = patch.provider;
          if (typeof patch.reasoningEffort === 'string') next.reasoningEffort = patch.reasoningEffort;
          writeConfig(next);
          return ok(next);
        }
        case 'clearToken': {
          if (existsSync(ACCOUNT_FILE)) {
            const acc = JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8'));
            delete acc.bot_token;
            writeFileSync(ACCOUNT_FILE, JSON.stringify(acc, null, 2));
          }
          return ok({ cleared: true });
        }
        case 'deleteBot': {
          if (existsSync(ACCOUNT_FILE)) rmSync(ACCOUNT_FILE, { force: true });
          if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE, { force: true });
          return ok({ deleted: true });
        }
        case 'qr': {
          const qr = await apiGet('/ilink/bot/get_bot_qrcode?bot_type=3');
          const key = String(qr.qrcode ?? '');
          const url = String(qr.qrcode_img_content ?? '');
          if (!key || !url) return fail('bad-request', '获取二维码失败');
          const png = await QRCode.toDataURL(url, { width: 480, margin: 1 });
          return ok({ qrcodeKey: key, qrcodeBase64: png, expiresInMs: 8 * 60 * 1000 });
        }
        case 'status': {
          const key = typeof payload.qrcodeKey === 'string' ? payload.qrcodeKey : '';
          if (!key) return fail('bad-request', 'qrcodeKey required');
          const st = await apiGet('/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(key));
          const status = String(st.status ?? 'wait');
          if (status === 'confirmed') {
            const account = {
              ilink_bot_id: String(st.ilink_bot_id ?? ''),
              bot_token: String(st.bot_token ?? ''),
              ilink_user_id: String(st.ilink_user_id ?? ''),
              baseurl: String(st.baseurl && st.baseurl !== '<nil>' ? st.baseurl : API),
              saved_at: new Date().toISOString(),
            };
            if (!account.bot_token) return fail('bad-request', 'confirmed 但缺少 bot_token');
            writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
            return ok({ status, ...account });
          }
          return ok({ status });
        }
        default:
          return fail('bad-request', `unknown method ${method}`);
      }
    } catch (error) {
      return fail('internal', error instanceof Error ? error.message : String(error));
    }
  };
}

export function registerRpc(connection: RpcConnection): void {
  connection.rpc.handle(WEIXIN_LOGIN_CHANNEL, createHandler(), { authority: 'trusted-host' });
}
