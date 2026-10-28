import { streamStatus } from "./stream";

export * from "./queries";

/** Stream telemetry is best-effort: the dashboard must render even when the
 *  producer has never been started in this process. */
export async function streamStatusSafe() {
  try {
    return streamStatus();
  } catch {
    return null;
  }
}
