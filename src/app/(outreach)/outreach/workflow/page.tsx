import { WorkflowClient } from "./WorkflowClient";

/**
 * Pure static visualization of the agent's pipeline architecture -- zero
 * backend/database dependency, so this server component just renders the
 * client component with no data fetching of its own.
 */
export default function OutreachWorkflowPage() {
  return <WorkflowClient />;
}
