/**
 * 外部二进制探测（跨平台）。
 *
 * POSIX 上 Ghostscript 的可执行名是 `gs`，Windows 上是 `gswin64c` / `gswin32c`；
 * 写死 `gs` 会让 Windows 上装了 ghostscript 的机器仍然误报「缺少 gs」。
 * 两个 PDF 工具共用这里的探测逻辑，避免各写一份。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Ghostscript 候选可执行名（按平台；platform 可传便于测试）。 */
export function gsCandidates(platform = process.platform) {
  return platform === 'win32' ? ['gswin64c', 'gswin32c', 'gs'] : ['gs']
}

/** 某个可执行名能否跑通探测参数。 */
export async function haveBin(name, probeArgs) {
  try {
    await execFileAsync(name, probeArgs)
    return true
  } catch {
    return false
  }
}

/** 返回第一个可用的候选名；都不可用返回 null。 */
export async function resolveBin(candidates, probeArgs) {
  for (const name of candidates) {
    if (await haveBin(name, probeArgs)) return name
  }
  return null
}

/** 缺依赖时的安装指引（按平台）。 */
export const INSTALL_HINT = process.platform === 'win32'
  ? 'Windows: choco install poppler ghostscript，或 scoop install poppler ghostscript'
  : 'macOS: brew install poppler ghostscript；Debian/Ubuntu: apt install poppler-utils ghostscript'
