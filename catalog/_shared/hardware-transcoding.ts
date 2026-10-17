import type { ServiceExtras } from '@mediaplane/engine';
import { z } from 'zod';

/**
 * Where a host's GPU gives its render nodes. Intel Quick Sync and AMD both use it; NVIDIA
 * needs Docker's NVIDIA runtime instead, which this option doesn't cover.
 */
export const GPU_DEVICES = '/dev/dri';

/** `apps.<media server>.hardware_transcoding`: hand the media server the host's GPU. */
export const hardwareTranscoding = z
  .boolean()
  .default(false)
  .describe(
    "Give the media server this host's GPU (/dev/dri), for hardware transcoding with Intel Quick Sync or AMD. Turn it on in the app's transcoding settings too; Plex needs Plex Pass for it.",
  );

/** The devices the media server gets, given its hardware_transcoding option. */
export function gpuExtras(on: boolean): ServiceExtras {
  return on ? { devices: [`${GPU_DEVICES}:${GPU_DEVICES}`] } : {};
}
