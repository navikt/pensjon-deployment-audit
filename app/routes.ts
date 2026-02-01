import { index, layout, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  // Health check endpoints (outside layout)
  route('api/isalive', 'routes/api.isalive.ts'),
  route('api/isready', 'routes/api.isready.ts'),

  layout('routes/layout.tsx', [
    index('routes/home.tsx'),
    route('apps', 'routes/apps.tsx'),
    route('apps/discover', 'routes/apps.discover.tsx'),
    route('apps/:id', 'routes/apps.$id.tsx'),
    route('apps/:id/deployments', 'routes/apps.$id.deployments.tsx'),
    route('deployments', 'routes/deployments.tsx'),
    route('deployments/verify', 'routes/deployments.verify.tsx'),
    route('deployments/:id', 'routes/deployments.$id.tsx'),
    route('users/:username', 'routes/users.$username.tsx'),
    route('alerts', 'routes/alerts.tsx'),
    route('admin', 'routes/admin.tsx'),
    route('admin/users', 'routes/admin.users.tsx'),
    route('admin/users/export', 'routes/admin.users.export.ts'),
    route('admin/sync-jobs', 'routes/admin.sync-jobs.tsx'),
    route('admin/audit-reports', 'routes/admin.audit-reports.tsx'),
    route('admin/audit-reports/:id/pdf', 'routes/admin.audit-reports.$id.pdf.ts'),
    route('admin/audit-reports/:id/view', 'routes/admin.audit-reports.$id.view.ts'),
  ]),
] satisfies RouteConfig
