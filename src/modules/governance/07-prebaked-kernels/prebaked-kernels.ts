/**
 * ════════════════════════════════════════════════════════════════════════════
 * PRODUCT MATURITY MILESTONE
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * This file previously contained ~1900 lines of string-defined kernel code.
 * It has been replaced by compiled kernel modules.
 * 
 * DATE: 2025-02-09
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT HAPPENED
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * There is no longer any string-defined governance anywhere in the system.
 * 
 * All kernels are now:
 * - Real TypeScript modules in src/thinking-space-web-player/kernels/domains/
 * - Loaded via SES-safe dynamic import()
 * - Executed as compiled code, not interpreted strings
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURAL RULES (ENFORCED)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * 1. Compiled kernels NEVER read kernel.json at runtime
 *    - Policy is encoded in code, not interpreted from config
 *    - Declarative fallback is explicitly second-class
 * 
 * 2. kernel.version !== world.version
 *    - Kernels are versioned independently
 *    - Enables hot-swappable policy
 *    - Enables auditable changes
 *    - Enables enterprise governance stories
 * 
 * 3. SES-safe execution
 *    - No eval()
 *    - No new Function()
 *    - Only module imports
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * FOR FUTURE CONTRIBUTORS
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * If you need to add a new domain kernel:
 * 
 * 1. Create src/thinking-space-web-player/kernels/domains/{domain}.ts
 * 2. Implement CompiledKernelModule interface
 * 3. Register in src/thinking-space-web-player/kernels/index.ts
 * 
 * DO NOT:
 * - Add string-defined kernels back to this file
 * - Use eval() or new Function() for kernel execution
 * - Read kernel.json at runtime in compiled kernels
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { SimulationDomain } from './domains';

/**
 * @deprecated - Kernels are now compiled modules.
 * See src/thinking-space-web-player/kernels/
 */
export const PREBAKED_KERNELS: Partial<Record<SimulationDomain, { code: string; version: string }>> = {};

/**
 * @deprecated - Use loadCompiledKernel from src/thinking-space-web-player/kernels/
 */
export function getPrebakedKernel(_domain: SimulationDomain): { code: string; version: string } | undefined {
  console.warn('[DEPRECATED] getPrebakedKernel is deprecated. Use loadCompiledKernel from kernels/index.ts');
  return undefined;
}

/**
 * @deprecated - Use hasCompiledKernel from src/thinking-space-web-player/kernels/
 */
export function hasPrebakedKernel(_domain: SimulationDomain): boolean {
  console.warn('[DEPRECATED] hasPrebakedKernel is deprecated. Use hasCompiledKernel from kernels/index.ts');
  return false;
}
