import { error, type Diagnostic } from '../diagnostics';
import { usesSocketProxy } from '../runtime/docker';
import { HelperError, RuntimeError, type Runtime } from '../runtime/types';
import type { HostFacts } from './facts';

/**
 * Docker could not be reached. In the image, Mediaplane reaches it through the socket
 * proxy, so a stopped proxy is the likely cause: Docker itself must be running for
 * `docker exec` to work at all.
 */
export function dockerUnavailable(
  cause: RuntimeError,
  env: NodeJS.ProcessEnv,
): Diagnostic {
  return error('docker.unavailable', cause.message, {
    hint: usesSocketProxy(env)
      ? 'Mediaplane reaches Docker through the socket proxy: on the host, check that the socket-proxy container is running, with "docker compose -f deploy/mediaplane.compose.yaml ps", and read its log with "docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy"'
      : 'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)',
  });
}

/**
 * The error for a host helper or Docker call that failed, or undefined for anything else
 * (a bug, say), which is not Docker's to explain.
 */
export async function helperOrDockerFailure(
  cause: unknown,
  options: { runtime: Runtime; env: NodeJS.ProcessEnv },
): Promise<Diagnostic | undefined> {
  // A HelperError is a RuntimeError too, so it is told apart first.
  if (cause instanceof HelperError) {
    // The helper is a `docker run`. When Docker can't be reached either (a stopped socket
    // proxy, say), that is the error to explain, not the helper.
    const unreachable = await dockerUnreachable(options.runtime);
    return unreachable === undefined
      ? helperFailed(cause)
      : dockerUnavailable(unreachable, options.env);
  }
  if (cause instanceof RuntimeError) return dockerUnavailable(cause, options.env);
  return undefined;
}

/**
 * The host's facts, given or asked for, or the error to show when the host helper or
 * Docker failed to give them. Anything else that goes wrong is a bug and is thrown.
 */
export async function hostFactsOrFailure(
  host: HostFacts | (() => Promise<HostFacts>),
  options: { runtime: Runtime; env: NodeJS.ProcessEnv },
): Promise<{ ok: true; host: HostFacts } | { ok: false; diagnostic: Diagnostic }> {
  try {
    return { ok: true, host: typeof host === 'function' ? await host() : host };
  } catch (cause) {
    const failure = await helperOrDockerFailure(cause, options);
    if (failure === undefined) throw cause;
    return { ok: false, diagnostic: failure };
  }
}

/** Why Docker can't be reached, or undefined when it answers. */
async function dockerUnreachable(runtime: Runtime): Promise<RuntimeError | undefined> {
  try {
    await runtime.versions();
    return undefined;
  } catch (cause) {
    if (cause instanceof RuntimeError) return cause;
    throw cause;
  }
}

function helperFailed(cause: HelperError): Diagnostic {
  return error('host.helper-failed', cause.message, {
    hint:
      cause.hint ??
      'the host helper runs the image named by MEDIAPLANE_IMAGE: check that mediaplane.compose.yaml sets it, and that "docker image ls" lists that image',
  });
}
