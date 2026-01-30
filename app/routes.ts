import { index, layout, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  layout('routes/layout.tsx', [
    index('routes/home.tsx'),
    route('apps', 'routes/apps.tsx'),
    route('apps/:id', 'routes/apps.$id.tsx'),
    route('apps/discover', 'routes/apps.discover.tsx'),
    route('deployments', 'routes/deployments.tsx'),
    route('deployments/verify', 'routes/deployments.verify.tsx'),
    route('deployments/:id', 'routes/deployments.$id.tsx'),
    route('alerts', 'routes/alerts.tsx'),
    route('admin/users', 'routes/admin.users.tsx'),
  ]),
] satisfies RouteConfig;
