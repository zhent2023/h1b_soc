import { spawn } from 'child_process';

export async function runCommand(
  command: string,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; tee?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options?.cwd,
      env: options?.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (options?.tee) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (options?.tee) {
        process.stderr.write(text);
      }
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): ${command}\n${stderr}`));
      }
    });
  });
}

export function spawnProcess(command: string, options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  return spawn(command, {
    shell: true,
    cwd: options?.cwd,
    env: options?.env,
    stdio: 'inherit',
  });
}

export async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server did not respond within ${timeoutMs}ms: ${url}`);
}

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      ...(options?.headers ?? {}),
      ...(options?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as T;
  return { data, headers: res.headers };
}
