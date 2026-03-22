/**
 * Templates Module
 * 
 * Exports all domain templates with pre-baked kernels.
 * KERNEL INVARIANT: Every Thinking Space ships with its own kernel.
 */

export * from './domains';
export { PREBAKED_KERNELS, getPrebakedKernel, hasPrebakedKernel } from './prebaked-kernels';
