import type { Context } from '@deepseek-ai/cordis';

/** 插件名。 */
export declare const name: 'privmask';

/** 运行时配置。 */
export interface Config {
  enabled?: boolean;
  redactPaths?: boolean;
  redactToolMeta?: boolean;
  persistMapping?: boolean;
  nonTextPolicy?: 'block' | 'strip' | 'allow';
  longTokens?: boolean;
  dropSessionId?: boolean;
  cnEntities?: boolean;
  strictId18?: boolean;
  restoreInbound?: boolean;
  redactCredentials?: boolean;
  redactAddress?: boolean;
  redactNames?: boolean;
  redactCompanies?: boolean;
  redactOrgs?: boolean;
  redactCaseNumbers?: boolean;
  redactDob?: boolean;
  failClosed?: boolean;
  strictUnknown?: boolean;
  logRedactions?: boolean;
}

export declare const Config: import('@deepseek-ai/schemastery').Schema<Config>;

export declare function apply(ctx: Context, config?: Config): void;
