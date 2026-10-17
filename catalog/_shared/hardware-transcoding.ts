import type { ServiceExtras } from '@mediaplane/engine';
import { z } from 'zod';

/**
 * Where a host's GPU gives its render nodes. Intel Quick Sync and AMD both use it; NVIDIA
 * needs Docker's NVIDIA runtime instead, which this option doesn't cover.
 */
export const GPU_DEVICES = '/dev/dri';

/**
 * `apps.<media server>.hardware_transcoding`: hand the media server the host's GPU. `also`
 * is what else the app needs for it, for the stack.yaml reference.
 */
export function hardwareTranscoding(app: string, also: string) {
  return z
    .boolean()
    .default(false)
    .describe(
      `Give ${app} this host's GPU (/dev/dri), for hardware transcoding with Intel Quick Sync or AMD. Turn it on in ${app}'s transcoding settings too${also}.`,
    );
}

/** The devices the media server gets, given its hardware_transcoding option. */
export function gpuExtras(on: boolean): ServiceExtras {
  return on ? { devices: [`${GPU_DEVICES}:${GPU_DEVICES}`] } : {};
}
