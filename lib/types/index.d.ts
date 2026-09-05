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
  /** 显式承认风险后才允许非文本原样透传（默认 false） */
  allowRawMedia?: boolean;
  /** base64 文本预检（默认关）：可判定为 UTF-8 文本的 base64 载荷先本地脱敏再上云 */
  preflightBase64?: boolean;
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
  customTerms?: string[];
  preserveValues?: string[];
  failClosed?: boolean;
  strictUnknown?: boolean;
  /** 离境审计（默认 true）：每笔发往云端的 llm 请求写一行本地 JSONL（$DSH_HOME/privmask-egress.jsonl） */
  egressAudit?: boolean;
  /** 本地 OCR 兜底（默认 false）：图片附件在本地转文本后再进脱敏/上云管线（依赖 ~/.ocr-tool） */
  localOcr?: boolean;
  /** 高级/测试：自定义 OCR 命令 argv；空则使用默认 ~/.ocr-tool/ocr.py */
  localOcrCommand?: string[];
  logRedactions?: boolean;
}

export declare const Config: import('@deepseek-ai/schemastery').Schema<Config>;

export declare function apply(ctx: Context, config?: Config): void;
