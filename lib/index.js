/**
 * dsh-privmask — DeepSeek Harness 本地脱敏插件（Host-only 静态版）。
 *
 * 在 `llm/stream` 水瀑拦截每次发往云端大模型的请求：把密钥、PII、中文实体
 * （姓名/身份证/统一社会信用代码/手机/座机/银行卡/案号/车牌/证件/出生日期/
 * 公司/司法机关/地址
 *
 * 用户输入与工具结果在写入本地会话日志前遮罩为占位符；模型回复经入站还原
 * 以原值落盘与显示，还原值再次出站时重新脱敏。云端只看到 `[REDACTED_类别_N]`
 * 占位符（同一次请求内同类值映射同一占位符）。
 *
 * @module dsh-privmask
 */
import z from '@deepseek-ai/schemastery';
import { appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from './engine.js';
import { restoreChunkText, restoreJson, splitPlaceholderTail, countPlaceholderMisses, restoreBlocksForDisplay, restoreWireData, restoreRecord, restoreRecords } from './restore.js';

export const name = 'privmask';

/** 插件名（用于 cordis.yml 挂载行的 id，与 name 一致）。 */
/** 等待 llm 服务就绪后再 apply，否则 ctx.get('llm') 为空导致拦截钩子静默不注册。 */
export const inject = ['llm'];

/** 运行时配置 schema。 */
export const Config = z.object({
  /** 总开关 */
  enabled: z.boolean().default(true),
  /** 路径脱敏（会破坏文件类工具的路径回传，默认关） */
  redactPaths: z.boolean().default(false),
  /** 工具描述/参数 schema 中的敏感信息脱敏（默认开：schema 若含敏感值也会在上云前遮罩；
   *  若担心遮罩影响模型对工具用途的理解，可显式设为 false） */
  redactToolMeta: z.boolean().default(true),
  /** 同一会话内跨请求保持同一值映射同一占位符（利于模型跨轮关联实体） */
  persistMapping: z.boolean().default(true),
  /** 非文本内容（图片/文件块）策略：strip=移除后放行(默认), block=拒绝请求, allow=原样透传 */
  nonTextPolicy: z.union([z.const('block'), z.const('strip'), z.const('allow')]).default('strip'),
  /** 自定义敏感词表（不受角色上下文限制，边界匹配即脱敏）：如当事人姓名/别名/机构简称 */
  customTerms: z.array(z.string()).default([]),
  /** 白名单：这些值即使命中规则也原样保留（用于标记放行误报） */
  preserveValues: z.array(z.string()).default([]),
  /** 长 hex/base64 串脱敏 */
  longTokens: z.boolean().default(true),
  /** 移除 x-deepseek-harness-session-id 关联头 */
  dropSessionId: z.boolean().default(true),
  /** 中文实体识别 */
  cnEntities: z.boolean().default(true),
  /** 身份证 18 位严格校验（默认开）：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 */
  strictId18: z.boolean().default(true),
  /** 入站还原（默认开）：云端返回的占位符在本地还原为原值（响应显示/工具执行用），下次出站会重新脱敏 */
  restoreInbound: z.boolean().default(true),
  /** 凭据类脱敏（密钥/token/密码等，默认开）：模型永远不需要，脱敏零损失 */
  redactCredentials: z.boolean().default(true),
  /** 地址类脱敏（省市区乡/住址，默认开）：当事人隐私核心，起草文书靠入站还原写回真值 */
  redactAddress: z.boolean().default(true),
  /** 姓名脱敏（默认开）：姓名是对象唯一性信息 */
  redactNames: z.boolean().default(true),
  /** 公司名称脱敏（默认开）：法人唯一标识 */
  redactCompanies: z.boolean().default(true),
  /** 机关/单位名称脱敏（默认开）：单位唯一标识 */
  redactOrgs: z.boolean().default(true),
  /** 案号脱敏（默认关）：公开案件标识，不涉及个人隐私，管辖/关联判断需要真值 */
  redactCaseNumbers: z.boolean().default(false),
  /** 出生日期脱敏（默认关）：非唯一信息，年龄/时效计算需要真值 */
  redactDob: z.boolean().default(false),
  /** 严格模式：脱敏异常时拒绝请求（true），绝不把未脱敏数据发往云端 */
  failClosed: z.boolean().default(true),
  /** 严格模式：发现未检查的未知字段（非普通对象/函数等）时拒绝请求 */
  strictUnknown: z.boolean().default(true),
  /** 每次脱敏打印一行统计日志 */
  logRedactions: z.boolean().default(true),
});


// ─────────────────────────── 插件主体 ───────────────────────────

export function apply(ctx, config = {}) {
  // 统一走 schema 校验：程序化 apply() 与 cordis yml 加载行为一致，
  // 默认值单一来源，非法配置响亮失败（消除 schema/手写两份默认值漂移）
  let cfg;
  try {
    cfg = Config(config);
  } catch (error) {
    throw new Error('[privmask] 配置校验失败: ' + (error && error.message ? error.message : error));
  }

  // ── 诊断日志（文件 + 控制台）：定位真实环境入站还原问题 ──
  const DIAG_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'privmask-restore.log');
  function diag(line) {
    const msg = new Date().toISOString() + ' ' + line;
    appendFile(DIAG_FILE, msg + '\n').catch(() => {});
    if (cfg.logRedactions) console.log('[privmask] ' + line);
  }
  diag('启动 cfg: restoreInbound=' + cfg.restoreInbound + ' dropSessionId=' + cfg.dropSessionId + ' persistMapping=' + cfg.persistMapping + ' nonTextPolicy=' + cfg.nonTextPolicy + ' enabled=' + cfg.enabled);
  if (cfg.restoreInbound && !cfg.persistMapping) {
    console.warn('[privmask] restoreInbound=true 且 persistMapping=false：流内实时还原仍生效，但浏览器历史展示层无法把已落盘占位符还原为原文（展示层还原依赖会话持久映射）');
  }

  const llm = ctx.get('llm');
  if (llm === undefined) {
    // 理论上 inject: ['llm'] 已保证服务存在；这里仅作兜底并明确告警
    console.warn('[privmask] llm 服务不可用，脱敏拦截未注册（请确认 dsh-llm 已加载）');
    return;
  }

  let engine = createEngine(cfg);
  const SEEN = new WeakSet();
  const stats = { requests: 0, redacted: 0, fields: 0, blocked: 0, errors: 0, restoreMisses: 0, lastError: null };

  // ── 运行时设置（dsh-settings 命名空间）：用户在界面改开关后 live 生效 ──
  // 注册失败（settings 服务不可用/非 profile 环境）则保持配置模式，不影响主链路。
  let settingsScope = null;
  let settingsApplied = false;
  function installSettingsNamespace() {
    if (settingsApplied || typeof ctx.inject !== 'function') return;
    // 官方推荐访问方式：ctx.inject 软依赖，settings 服务可用时自动回调；
    // 服务缺失（如无 settings provider 的 profile）时保持配置文件模式，不影响主链路。
    ctx.inject(['settings'], (sctx) => {
      if (settingsApplied) return;
      try {
        settingsScope = sctx.settings.register('privmask', Config, {
          base: cfg,
          applies: 'live',
        });
        settingsScope.watch((next) => {
          // 用户覆盖优先的解析结果 → 重建引擎与配置（钩子经 let 绑定读到最新值）
          const resolved = Config(next);
          cfg = resolved;
          engine = createEngine(cfg);
          if (cfg.logRedactions) {
            console.log('[privmask] 设置已更新（live 生效）: enabled=' + cfg.enabled + ' redactNames=' + cfg.redactNames + ' redactCompanies=' + cfg.redactCompanies + ' redactOrgs=' + cfg.redactOrgs + ' redactAddress=' + cfg.redactAddress + ' redactCredentials=' + cfg.redactCredentials);
          }
          emitStats('settingsUpdated', { enabled: cfg.enabled, fields: Object.keys(resolved).length });
        });
        settingsApplied = true;
        if (cfg.logRedactions) {
          console.log('[privmask] 运行时设置已注册（dsh-settings 命名空间 privmask，live 生效）');
        }
      } catch (error) {
        if (cfg.logRedactions) {
          console.warn('[privmask] settings 命名空间注册失败，保持配置模式: ' + (error && error.message ? error.message : error));
        }
      }
    });
  }
  installSettingsNamespace();

  /** 结构化事件缝：供 UI/审计消费；消费方异常不影响主链路 */
  function emitStats(kind, detail) {
    if (typeof ctx.emit !== 'function') return;
    try {
      ctx.emit('privmask/stats', { kind, ...detail, ts: Date.now() });
    } catch { /* 事件消费方异常不影响主链路 */ }
  }

  function failClosedStream(error) {
    const message = 'privmask: 脱敏失败，请求已被拦截: ' + String(error && error.message ? error.message : error);
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PRIVMASK_REDACTION_FAILED' } } };
    })();
  }

  function blockedStream(reason) {
    const message = 'privmask: ' + reason + '（nonTextPolicy=block；如需发送图片/文件请配置为 strip 或 allow）';
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PRIVMASK_NON_TEXT_BLOCKED' } } };
    })();
  }

  // 入站还原：把云端返回流里的占位符按会话映射还原为原值（仅本地）。
  // 替换按占位符长度降序，避免 EMAIL_1 与 EMAIL_10 部分匹配；
  // text/reasoning 的 delta 尽力还原（含跨 delta 的尾部缓冲重组），block-end 为权威结果。
  // 排序在每条流只做一次；无占位符的 chunk 直接短路，避免大映射下的无谓开销。
  const MAX_PH_LEN = 48; // 占位符最长形态 [REDACTED_类别_N]
  /** 从还原后的文本尾部提取「可能是占位符前缀」的未完成片段（跨 delta 重组用） */
  function restoreStream(stream, rev, sessionId) {
    const entries = [...rev.entries()].sort((a, b) => b[0].length - a[0].length);
    let misses = 0;
    const missedSamples = new Set();
    const noteMisses = (text) => {
      const n = countPlaceholderMisses(text);
      if (n === 0) return;
      misses += n;
      for (const ph of text.match(/\[REDACTED_[A-Z0-9_]+_\d+\]/g) || []) {
        if (missedSamples.size < 3) missedSamples.add(ph);
      }
    };
    return (async function* () {
      let pending = '';
      let pendingType = null;
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
            const combined = pending + chunk.text;
            const restored = restoreChunkText(combined, entries);
            const { head, tail } = splitPlaceholderTail(restored);
            pending = tail;
            pendingType = tail === '' ? null : chunk.type;
            if (head !== '') yield { ...chunk, text: head };
          } else if (chunk.type === 'block-end') {
            pending = '';
            pendingType = null;
            const block = chunk.block;
            if (block.type === 'text' || block.type === 'reasoning') {
              const t = restoreChunkText(block.text, entries);
              noteMisses(t);
              yield { ...chunk, block: { ...block, text: t } };
            } else if (block.type === 'tool-call') {
              if (typeof block.arguments === 'string') {
                const a = restoreChunkText(block.arguments, entries);
                noteMisses(a);
                yield { ...chunk, block: { ...block, arguments: a } };
              } else {
                const a = restoreJson(block.arguments, entries);
                yield a === block.arguments ? chunk : { ...chunk, block: { ...block, arguments: a } };
              }
            } else {
              yield chunk;
            }
          } else {
            yield chunk;
          }
        }
      } finally {
        // 流在没有 block-end 的情况下结束且尾部残留疑似占位符前缀：
        // 原样冲刷，避免静默吞掉文本（不完整占位符不含原值，冲刷无泄漏风险）
        if (pending !== '') {
          noteMisses(pending);
          yield { type: pendingType || 'text-delta', text: pending };
        }
        if (misses > 0) {
          stats.restoreMisses += misses;
          emitStats('restoreMiss', { sessionId, count: misses, samples: [...missedSamples] });
          if (cfg.logRedactions) {
            const sample = [...missedSamples].join(' ');
            console.log('[privmask] 入站还原未命中占位符 ' + misses + ' 处 session=' + String(sessionId) + (sample ? ' 例: ' + sample : '') + '（映射被逐出或模型改写）');
          }
        }
      }
    })();
  }

  // 核心拦截：llm/stream 水瀑（dsh 唯一请求边界，在 agent-loop 不变式之后运行）。
  //
  // 架构约束（来自 dsh 源码）：
  // 1. agent-loop 构建的请求被 deepFreeze 冻结，且用 WeakSet 标记（isAgentLoopRequest），
  //    因此无法原地修改 options，也无法把脱敏副本塞回原水瀑（next() 只传原参数）。
  // 2. adapter 会按 options.sessionId 发送 x-deepseek-harness-session-id 头，
  //    所以脱敏副本必须删除 sessionId 才能真正去掉该头。
  // 3. 因此脱敏后只能「重入水瀑」：llm.stream(projected) 重新跑一遍水瀑，
  //    我们的 hook 通过 SEEN 放行，其余 hook 只看到脱敏副本；
  //    projected 未被打上 agent-loop 标记，不变式会跳过它，不会误触发校验失败。
  // 4. checkpoint 等前置 hook 在原水瀑中先于我们执行（带 sessionId），
  //    所以会话持久化仍正常；重入后的 checkpoint 因 sessionId 已删而跳过，不会重复。
  // 5. 只有 message.content 会上云（source 元数据不序列化）；reasoning 会上云
  //    （reasoning_content），compaction/session-title 等辅助调用也经过本水瀑——
  //    它们都会被脱敏（生成脱敏副本重入水瀑）；日志落盘遮罩由 agent/pre-step、
  //    tools/post-execute 与 ptc-dispatch-log 负责，模型回复经入站还原以真值落盘。
  ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled || SEEN.has(options)) return next();
    // 展示层还原惰性安装：web profile 中 sessionController 可能晚于插件加载
    if (cfg.restoreInbound) installDisplayRestore();
    // 入站还原包装：无论请求是否被脱敏，响应流都做占位符→原值还原
    // （原实现只在“请求被脱敏/删除 sessionId”分支包装，早退路径会漏掉还原）
    const wrapRestore = (stream, rctx) => {
      if (!cfg.restoreInbound) return stream;
      const rev = engine.reverseMap(rctx);
      if (rev.size === 0) {
        diag('还原跳过：会话映射为空 sessionId=' + String(options.sessionId) + ' messages=' + String(options.messages && options.messages.length) + ' keys=' + JSON.stringify(Object.keys(options)));
        return stream;
      }
      return restoreStream(stream, rev, options.sessionId);
    };
    try {
      const { result, rctx } = engine.sanitizeRequest(options);
      if (result !== null && typeof result === 'object' && result.blocked !== undefined) {
        stats.requests += 1;
        stats.blocked += 1;
        emitStats('blocked', { provider: options.provider, model: options.model, reason: result.blocked });
        if (cfg.logRedactions) {
          console.log('[privmask] 已拦截请求 provider=' + options.provider + ' model=' + options.model + ' 原因=' + result.blocked);
        }
        return blockedStream(result.blocked);
      }
      const projected = result;
      if (projected === options) {
        stats.requests += 1;
        return wrapRestore(next(), rctx);
      }
      SEEN.add(projected);
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += rctx.fields;
      emitStats('redacted', { provider: options.provider, model: options.model, fields: rctx.fields, counts: Object.fromEntries(rctx.counts) });
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏请求 provider=' + options.provider + ' model=' + options.model + ' 字段=' + rctx.fields + ' ' + JSON.stringify(Object.fromEntries(rctx.counts)));
      }
      // 用脱敏后的请求发起流式调用（内层水瀑由 SEEN 放行），并对返回流做本地还原
      const stream = llm.stream(projected);
      return wrapRestore(stream, rctx);
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      emitStats('error', { provider: options.provider, model: options.model, error: stats.lastError });
      console.error('[privmask] 脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      stats.requests += 1;
      if (cfg.failClosed) return failClosedStream(error);
      return next();
    }
  });

  // 日志脱敏（方案2）：用户输入与工具结果在写入会话日志前遮罩。
  // agent/pre-step 是 dsh 唯一能在消息落盘前改写内容的水瀑；改写后的消息
  // 同时进入会话日志与 llm/stream（llm/stream 兜底见上，幂等）。
  // 模型回复与工具调用参数仍由 llm/stream 入站还原为真值（方案2 取舍）。
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = agent && agent.session ? agent.session.id : undefined;
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const decision = await next();
      if (decision.kind !== 'enter') return decision;
      const result = engine.maskPreStep(sessionId, decision.messages);
      if (result.blocked !== null) {
        stats.requests += 1;
        stats.blocked += 1;
        emitStats('blocked', { sessionId, reason: result.blocked });
        if (cfg.logRedactions) {
          console.log('[privmask] 已拒绝用户消息 session=' + sessionId + ' 原因=' + result.blocked);
        }
        return { kind: 'reject' };
      }
      if (!result.changed) return decision;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += result.rctx.fields;
      emitStats('logRedacted', { sessionId, fields: result.rctx.fields, counts: Object.fromEntries(result.rctx.counts) });
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏用户消息 session=' + sessionId + ' 字段=' + result.rctx.fields + ' ' + JSON.stringify(Object.fromEntries(result.rctx.counts)));
      }
      return { ...decision, messages: result.messages };
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      emitStats('error', { sessionId, error: stats.lastError });
      console.error('[privmask] 用户消息脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return { kind: 'reject' };
      return next();
    }
  });

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : undefined;
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const decision = await next();
      if (decision.kind !== 'accept' || decision.content === undefined) return decision;
      const result = engine.maskToolResult(sessionId, decision.content);
      if (result.blocked !== null) {
        stats.requests += 1;
        stats.blocked += 1;
        emitStats('blocked', { sessionId, tool: exec.name, reason: result.blocked });
        if (cfg.logRedactions) {
          console.log('[privmask] 已拒绝工具结果 tool=' + exec.name + ' 原因=' + result.blocked);
        }
        return { kind: 'block', feedback: [{ type: 'text', text: 'privmask: ' + result.blocked + '（nonTextPolicy=block）' }] };
      }
      if (!result.changed) return decision;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += result.rctx.fields;
      emitStats('logRedacted', { sessionId, tool: exec.name, fields: result.rctx.fields, counts: Object.fromEntries(result.rctx.counts) });
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏工具结果 tool=' + exec.name + ' 字段=' + result.rctx.fields + ' ' + JSON.stringify(Object.fromEntries(result.rctx.counts)));
      }
      return { ...decision, content: result.content };
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      emitStats('error', { sessionId, tool: exec.name, error: stats.lastError });
      console.error('[privmask] 工具结果脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return { kind: 'block', feedback: [{ type: 'text', text: 'privmask: 工具结果脱敏失败，已拒绝（failClosed=true）' }] };
      return next();
    }
  });

  // run_code 子派发落盘遮罩（dsh >= 0.1.2 的 tools/ptc-dispatch-log 缝）：
  // PTC 模式下每个 run_code 子派发的 tool/code-dispatch 事件走此水瀑，
  // 与 tools/post-execute 相互独立，需单独遮罩，否则子派发结果以明文落盘
  // （该落盘副本后续会进入会话投影，回到模型上下文）。
  ctx.on('tools/ptc-dispatch-log', async (dispatch, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = (dispatch.agent && dispatch.agent.session
        ? dispatch.agent.session.id
        : dispatch.exec && dispatch.exec.agent && dispatch.exec.agent.session
          ? dispatch.exec.agent.session.id
          : undefined);
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const content = await next();
      const result = engine.maskToolResult(sessionId, content);
      if (result.blocked !== null) {
        // 日志专用缝没有拒绝决策：以安全标记替换落盘副本，程序已拿到原始值
        stats.requests += 1;
        stats.blocked += 1;
        emitStats('blocked', { sessionId, tool: dispatch.name, reason: result.blocked });
        if (cfg.logRedactions) {
          console.log('[privmask] 已拦截 run_code 子派发日志 tool=' + dispatch.name + ' 原因=' + result.blocked);
        }
        return [{ type: 'text', text: '[privmask: 非文本内容已拦截，未写入日志]' }];
      }
      if (!result.changed) return content;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += result.rctx.fields;
      emitStats('logRedacted', { sessionId, tool: dispatch.name, fields: result.rctx.fields, counts: Object.fromEntries(result.rctx.counts) });
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏 run_code 子派发日志 tool=' + dispatch.name + ' 字段=' + result.rctx.fields + ' ' + JSON.stringify(Object.fromEntries(result.rctx.counts)));
      }
      return result.content;
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      emitStats('error', { sessionId, tool: dispatch.name, error: stats.lastError });
      console.error('[privmask] run_code 子派发日志脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return [{ type: 'text', text: '[privmask: 子派发日志脱敏失败，已拦截（failClosed=true）]' }];
      return next();
    }
  });

  // ── 展示层还原：包装 sessionController.page/follow，在返回浏览器前把占位符
  // 还原为原值（仅本地内存映射）：用户消息的落盘副本保持占位符、界面显示原文；
  // 模型回复与工具调用参数经入站还原以真值显示并落盘。
  // dsh gateway 在每次 RPC 调用时用 Reflect.get(receiver, method) 解析方法，
  // 因此实例上的包装方法会生效；若服务不可用（非 web profile 或加载顺序问题）
  // 则静默跳过，不影响脱敏主链路。re-apply/HMR 时用符号保存的原始方法重建包装。
  const DISPLAY_WRAP = Symbol('privmask.displayWrap');
  const DISPLAY_ORIG = Symbol('privmask.displayOrig');
  let displayWarned = false;
  let loaderProbe = null;

  function displayEntries(sessionId) {
    return [...engine.sessionReverseMap(sessionId).entries()].sort((a, b) => b[0].length - a[0].length);
  }

  function sessionIdOfAddress(address) {
    if (!address || typeof address !== 'object') return undefined;
    if (address.kind === 'session') return address.sessionId;
    if (address.kind === 'subagent') return address.childSessionId;
    return undefined;
  }

  function installDisplayRestore() {
    if (!cfg.restoreInbound) return;
    // 多路径解析：不同 dsh 组合下服务可能挂在属性、严格 get、非严格 get 或根上下文
    const candidates = [];
    const probe = (label, fn) => {
      try {
        const v = fn();
        if (v && typeof v === 'object') candidates.push({ label, value: v });
      } catch { /* 探测失败不中断 */ }
    };
    probe('ctx.sessionController', () => ctx.sessionController);
    probe('ctx.get(strict)', () => ctx.get && ctx.get('sessionController'));
    probe('ctx.get(non-strict)', () => ctx.get && ctx.get('sessionController', false));
    const root = ctx.root;
    if (root && root !== ctx) {
      probe('root.sessionController', () => root.sessionController);
      probe('root.get(strict)', () => root.get && root.get('sessionController'));
    }
    // session-controller 可能注册在 web-app 内层 include：通过 loader 服务枚举 entry，
    // 从目标 entry 的 fiber 上下文里取服务（外层 profile 插件直接 ctx.get 不到）。
    // 注意：只做当前 loader 的线性枚举——递归下钻 include fiber 会在 apply 期触发
    // 未就绪 entry 的材料化，导致宿主启动死循环（0.2.32 实测 100% CPU 卡死）。
    try {
      const loaderOf = (c) => (c && typeof c.get === 'function' ? c.get('loader') : undefined) || (c && c.loader);
      const loader = loaderOf(ctx) || loaderOf(root);
      if (loader && typeof loader.entries === 'function') {
        loaderProbe = { present: true, entries: 0, sessionSeen: false, sessionFiber: null };
        let iter;
        try { iter = loader.entries(); } catch { return; }
        for (const entry of iter) {
          if (!entry) continue;
          loaderProbe.entries += 1;
          if (entry.id !== 'session-controller') continue;
          loaderProbe.sessionSeen = true;
          loaderProbe.sessionFiber = entry.fiber ? String(entry.fiber.state) : 'none';
          const fc = entry.fiber && entry.fiber.ctx;
          if (!fc || fc === ctx) continue;
          probe('loader:session-controller.ctx', () => fc.sessionController);
          probe('loader:session-controller.ctx.get', () => fc.get && fc.get('sessionController'));
        }
      }
    } catch { /* loader 树探测失败不影响主链路 */ }
    const sc = candidates[0] ? candidates[0].value : undefined;
    if (!sc || typeof sc.page !== 'function' || typeof sc.follow !== 'function') {
      if (!displayWarned && cfg.logRedactions) {
        displayWarned = true;
        const llmProbe = (() => { try { return String(typeof (ctx.get && ctx.get('llm'))); } catch { return 'unknown'; } })();
        console.warn('[privmask] 展示层还原未安装：sessionController 服务不可用（候选路径: ' + (candidates.map((c) => c.label).join(', ') || '无') + '；控制探针 llm=' + llmProbe + '；loader=' + JSON.stringify(loaderProbe) + '）');
      }
      return;
    }
    const orig = sc[DISPLAY_ORIG];
    const origPage = orig ? orig.page : sc.page;
    const origFollow = orig ? orig.follow : sc.follow;
    const origControl = orig ? orig.control : sc.control;
    if (typeof origControl !== 'function') {
      if (!displayWarned && cfg.logRedactions) {
        displayWarned = true;
        console.warn('[privmask] 展示层还原未安装：sessionController.control 不可用');
      }
      return;
    }
    sc[DISPLAY_ORIG] = { page: origPage, follow: origFollow, control: origControl };
    sc[DISPLAY_WRAP] = true;
    if (!displayWarned && cfg.logRedactions) {
      console.log('[privmask] 展示层还原已安装（' + candidates[0].label + '，sessionController.page/follow/control）');
    }

    sc.page = async (request, signal) => {
      const page = await origPage.call(sc, request, signal);
      if (!page || !Array.isArray(page.records)) return page;
      const entries = displayEntries(sessionIdOfAddress(request && request.address));
      const records = restoreRecords(page.records, entries);
      return records === page.records ? page : { ...page, records };
    };

    sc.follow = async function* (request, signal) {
      const frames = origFollow.call(sc, request, signal);
      const entries = displayEntries(sessionIdOfAddress(request && request.address));
      for await (const frame of frames) {
        if (frame && frame.type === 'snapshot' && Array.isArray(frame.records)) {
          const records = restoreRecords(frame.records, entries);
          if (records !== frame.records) yield { ...frame, records };
          else yield frame;
        } else if (frame && frame.type === 'event' && frame.event && typeof frame.event === 'object') {
          const data = restoreWireData(frame.event.data, entries);
          if (data !== frame.event.data) yield { ...frame, event: { ...frame.event, data } };
          else yield frame;
        } else {
          yield frame;
        }
      }
    };

    // control 流：host 级实时状态（queues 含用户消息、projections 为元数据投影），
    // 界面主视图订阅此流；按会话还原 queue 消息内容块
    sc.control = async function* (signal) {
      const frames = origControl.call(sc, signal);
      for await (const frame of frames) {
        if (frame && frame.type === 'baseline' && frame.value && frame.value.queues) {
          const queues = frame.value.queues;
          let changed = false;
          const out = {};
          for (const sid of Object.keys(queues)) {
            const items = queues[sid];
            const entries = displayEntries(sid);
            let itemsChanged = false;
            const newItems = Array.isArray(items)
              ? items.map((item) => {
                if (!item || !item.message || !Array.isArray(item.message.content)) return item;
                const c = restoreBlocksForDisplay(item.message.content, entries);
                if (c !== item.message.content) {
                  itemsChanged = true;
                  return { ...item, message: { ...item.message, content: c } };
                }
                return item;
              })
              : items;
            if (itemsChanged) { changed = true; out[sid] = newItems; }
            else out[sid] = items;
          }
          if (changed) yield { ...frame, value: { ...frame.value, queues: out } };
          else yield frame;
        } else if (frame && frame.type === 'queue' && Array.isArray(frame.items)) {
          const entries = displayEntries(frame.sessionId);
          let itemsChanged = false;
          const newItems = frame.items.map((item) => {
            if (!item || !item.message || !Array.isArray(item.message.content)) return item;
            const c = restoreBlocksForDisplay(item.message.content, entries);
            if (c !== item.message.content) {
              itemsChanged = true;
              return { ...item, message: { ...item.message, content: c } };
            }
            return item;
          });
          if (itemsChanged) yield { ...frame, items: newItems };
          else yield frame;
        } else {
          yield frame;
        }
      }
    };
  }

  installDisplayRestore();
}

export default { name, inject, Config, apply };
