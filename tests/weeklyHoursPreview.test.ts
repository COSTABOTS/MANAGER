import { isWeeklyHoursPreview } from '../src/utils/weeklyHoursPreview.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const preview = {
  environment: 'preview',
  branch: 'feature/weekly-hours-availability',
  deploymentUrl: 'manager-newbuild123-costabots-projects.vercel.app',
  branchUrl: 'manager-git-feature-weekly-hours-availability-costabots-projects.vercel.app',
};

Deno.test('only this branch deployment and its stable branch URL show the weekly editor', () => {
  assert(isWeeklyHoursPreview({ ...preview, origin: `https://${preview.deploymentUrl}` }), 'deployment preview should be allowed');
  assert(isWeeklyHoursPreview({ ...preview, origin: `https://${preview.branchUrl}` }), 'branch preview should be allowed');
});

Deno.test('production, other branches and other deployments never show the weekly editor', () => {
  assert(!isWeeklyHoursPreview({ ...preview, origin: 'https://manager.costabots.com' }), 'production must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, environment: 'production', origin: `https://${preview.deploymentUrl}` }), 'production build must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, environment: 'development', origin: 'http://localhost:5173' }), 'local development must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, branch: 'main', origin: `https://${preview.deploymentUrl}` }), 'main must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, origin: 'https://manager-otherbuild-costabots-projects.vercel.app' }), 'other deployment must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, origin: 'https://another-project-costabots-projects.vercel.app' }), 'other project must be hidden');
  assert(!isWeeklyHoursPreview({ ...preview, deploymentUrl: 'another-project-costabots-projects.vercel.app', origin: 'https://another-project-costabots-projects.vercel.app' }), 'other project metadata must be rejected');
  assert(!isWeeklyHoursPreview({ ...preview, deploymentUrl: undefined, branchUrl: undefined, origin: `https://${preview.deploymentUrl}` }), 'missing Vercel metadata must fail closed');
});
