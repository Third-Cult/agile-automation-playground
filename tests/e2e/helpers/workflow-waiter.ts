import { GitHubClient } from './github-client';

const POLL_INTERVAL = 5000; // 5 seconds
const DEFAULT_TIMEOUT = 300000; // 5 minutes

export interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'neutral' | 'skipped' | 'timed_out' | 'action_required' | null;
  workflow_id: number;
  created_at: string;
  updated_at: string;
}

/**
 * Wait for GitHub Actions workflow to complete for a PR
 * This polls for workflow runs and waits until one completes
 */
export async function waitForWorkflow(
  github: GitHubClient,
  prNumber: number,
  timeout: number = DEFAULT_TIMEOUT
): Promise<WorkflowRun | null> {
  const startTime = Date.now();
  const initialRuns = await github.getWorkflowRuns(prNumber);
  const initialRunIds = new Set(initialRuns.map((r) => r.id));

  while (Date.now() - startTime < timeout) {
    try {
      // Get recent workflow runs
      const runs = await github.getWorkflowRuns(prNumber);
      
      // Find a new run that has completed (not in initial set)
      for (const run of runs) {
        if (!initialRunIds.has(run.id) && run.status === 'completed') {
          return {
            id: run.id,
            status: 'completed',
            conclusion: run.conclusion as any,
            workflow_id: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
      }

      // Check if any initial runs have completed
      for (const run of runs) {
        if (initialRunIds.has(run.id) && run.status === 'completed') {
          return {
            id: run.id,
            status: 'completed',
            conclusion: run.conclusion as any,
            workflow_id: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    } catch (error) {
      // Log error but continue polling
      console.warn('Error polling workflow status:', error);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  // Timeout - return null to indicate timeout
  return null;
}

/**
 * Wait for a specific amount of time (useful for allowing workflows to start)
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number = DEFAULT_TIMEOUT,
  interval: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await wait(interval);
  }

  return false;
}
