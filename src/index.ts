/**
 * dsh-weixin-ui: cordis plugin entry. Registers the weixin-login RPC channel
 * so the Settings → 微信桥 panel can fetch QR codes and poll login status.
 *
 * @module dsh-weixin-ui
 */
import { registerRpc } from './rpc.ts';

export const name = 'wechat-bot';
export const inject = ['connection'];

export function apply(ctx: any): void {
  ctx.inject(['connection'], (webContext: any) => {
    if (webContext?.connection === undefined) return;
    registerRpc(webContext.connection as never);
  });
}
