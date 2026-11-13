import type { Role } from '$lib/stores/auth';

export type NavKey =
  | 'dashboard'
  | 'repairs'
  | 'shops'
  | 'findRepairShops'
  | 'myRepairs'
  | 'myAppointments'
  | 'myReceipts'
  | 'shopManagement'
  | 'inventory'
  | 'partsRequests'
  | 'staff'
  | 'notifications'
  | 'appointments'
  | 'suppliers'
  | 'supplierMarketplace'
  | 'supplierApplications'
  | 'catalog'
  | 'messages'
  | 'rfqs'
  | 'purchaseOrders'
  | 'supplierFinance'
  | 'purchasingAnalytics'
  | 'transfers'
  | 'reports'
  | 'profile'
  | 'appearance'
  | 'documents'
  | 'customers'
  | 'settings'
  | 'applicationStatusTitle'
  | 'shopApplications'
  | 'performance'
  | 'supplierReviews'
  | 'submitRepairRequest'
  | 'platformBusinesses'
  | 'platformAccounts'
  | 'platformAudit'
  | 'platformReports';

export type PortalNavItem = {
  href: string;
  key: NavKey;
  icon: string;
  /** Visual section grouping in the sidebar (separator when section changes). */
  section?: string;
};

export const pendingNavByRole: Partial<Record<Role, PortalNavItem[]>> = {
  supplier: [
    { href: '/app/supplier-application/status', key: 'applicationStatusTitle', icon: 'clipboard', section: 'main' }
  ],
  shop_admin: [
    { href: '/app/shop-application/status', key: 'applicationStatusTitle', icon: 'clipboard', section: 'main' }
  ]
};

export const navByRole: Record<Role, PortalNavItem[]> = {
  customer: [
    { href: '/app/customer', key: 'dashboard', icon: 'layoutDashboard', section: 'main' },
    { href: '/app/customer/shops', key: 'findRepairShops', icon: 'building', section: 'main' },
    { href: '/app/customer/new', key: 'submitRepairRequest', icon: 'clipboard', section: 'main' },
    { href: '/app/customer/repairs', key: 'myRepairs', icon: 'wrench', section: 'activity' },
    { href: '/app/customer/appointments', key: 'myAppointments', icon: 'calendar', section: 'activity' },
    { href: '/app/customer/receipts', key: 'myReceipts', icon: 'fileText', section: 'activity' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'account' },
    { href: '/app/profile', key: 'profile', icon: 'user', section: 'account' }
  ],
  mechanic: [
    { href: '/app/mechanic', key: 'dashboard', icon: 'layoutDashboard', section: 'main' },
    { href: '/app/mechanic/jobs', key: 'repairs', icon: 'wrench', section: 'main' },
    { href: '/app/mechanic/reports', key: 'reports', icon: 'chart', section: 'main' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'account' },
    { href: '/app/profile', key: 'profile', icon: 'user', section: 'account' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette', section: 'account' }
  ],
  parts_coordinator: [
    { href: '/app/parts', key: 'dashboard', icon: 'layoutDashboard', section: 'main' },
    { href: '/app/parts/inventory', key: 'inventory', icon: 'package', section: 'stock' },
    { href: '/app/parts/requests', key: 'partsRequests', icon: 'clipboard', section: 'stock' },
    { href: '/app/admin/purchase-orders', key: 'purchaseOrders', icon: 'fileText', section: 'stock' },
    { href: '/app/parts/suppliers', key: 'suppliers', icon: 'factory', section: 'stock' },
    { href: '/app/parts/transfers', key: 'transfers', icon: 'truck', section: 'stock' },
    { href: '/app/parts/reports', key: 'reports', icon: 'chart', section: 'stock' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'account' },
    { href: '/app/profile', key: 'profile', icon: 'user', section: 'account' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette', section: 'account' }
  ],
  shop_admin: [
    { href: '/app/admin', key: 'dashboard', icon: 'layoutDashboard', section: 'ops' },
    { href: '/app/admin/appointments', key: 'appointments', icon: 'calendar', section: 'ops' },
    { href: '/app/admin/repairs', key: 'repairs', icon: 'wrench', section: 'ops' },
    { href: '/app/admin/customers', key: 'customers', icon: 'users', section: 'ops' },
    { href: '/app/parts/inventory', key: 'inventory', icon: 'package', section: 'purchasing' },
    { href: '/app/admin/suppliers', key: 'supplierMarketplace', icon: 'factory', section: 'purchasing' },
    { href: '/app/admin/rfqs', key: 'rfqs', icon: 'clipboard', section: 'purchasing' },
    { href: '/app/admin/purchase-orders', key: 'purchaseOrders', icon: 'fileText', section: 'purchasing' },
    { href: '/app/admin/supplier-finance', key: 'supplierFinance', icon: 'chart', section: 'purchasing' },
    { href: '/app/admin/purchasing-analytics', key: 'purchasingAnalytics', icon: 'chart', section: 'purchasing' },
    { href: '/app/admin/messages', key: 'messages', icon: 'bell', section: 'comms' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'comms' },
    { href: '/app/admin/shops', key: 'shopManagement', icon: 'building', section: 'admin' },
    { href: '/app/admin/reports', key: 'reports', icon: 'chart', section: 'admin' },
    { href: '/app/admin/documents', key: 'documents', icon: 'fileText', section: 'admin' },
    { href: '/app/admin/staff', key: 'staff', icon: 'users', section: 'admin' },
    { href: '/app/appearance', key: 'settings', icon: 'settings', section: 'admin' }
  ],
  supplier: [
    { href: '/app/supplier', key: 'dashboard', icon: 'layoutDashboard', section: 'main' },
    { href: '/app/supplier/catalog', key: 'catalog', icon: 'package', section: 'main' },
    { href: '/app/supplier/rfqs', key: 'rfqs', icon: 'clipboard', section: 'main' },
    { href: '/app/supplier/purchase-orders', key: 'purchaseOrders', icon: 'fileText', section: 'main' },
    { href: '/app/supplier/performance', key: 'performance', icon: 'chart', section: 'main' },
    { href: '/app/supplier/messages', key: 'messages', icon: 'bell', section: 'account' },
    { href: '/app/supplier/profile', key: 'profile', icon: 'building', section: 'account' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'account' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette', section: 'account' }
  ],
  platform_operator: [
    { href: '/app/platform', key: 'dashboard', icon: 'layoutDashboard', section: 'main' },
    { href: '/app/platform/shop-applications', key: 'shopApplications', icon: 'clipboard', section: 'onboarding' },
    { href: '/app/platform/supplier-applications', key: 'supplierApplications', icon: 'factory', section: 'onboarding' },
    { href: '/app/platform/supplier-reviews', key: 'supplierReviews', icon: 'clipboard', section: 'onboarding' },
    { href: '/app/platform/businesses', key: 'platformBusinesses', icon: 'building', section: 'directory' },
    { href: '/app/platform/accounts', key: 'platformAccounts', icon: 'users', section: 'directory' },
    { href: '/app/platform/audit', key: 'platformAudit', icon: 'fileText', section: 'directory' },
    { href: '/app/platform/reports', key: 'platformReports', icon: 'chart', section: 'directory' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell', section: 'account' },
    { href: '/app/platform/settings', key: 'settings', icon: 'settings', section: 'account' },
    { href: '/app/profile', key: 'profile', icon: 'user', section: 'account' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette', section: 'account' }
  ]
};

/** Semantic Alt+N destinations per role. Missing entries mean the shortcut is unavailable. */
export type SemanticNavSlot = 'dashboard' | 'repairs' | 'appointments' | 'inventory' | 'reports';

export const semanticNavByRole: Record<Role, Partial<Record<SemanticNavSlot, string>>> = {
  customer: {
    dashboard: '/app/customer',
    repairs: '/app/customer/repairs',
    appointments: '/app/customer/appointments',
    reports: '/app/customer/receipts'
  },
  mechanic: {
    dashboard: '/app/mechanic',
    repairs: '/app/mechanic/jobs',
    reports: '/app/mechanic/reports'
  },
  parts_coordinator: {
    dashboard: '/app/parts',
    repairs: '/app/parts/requests',
    inventory: '/app/parts/inventory',
    reports: '/app/parts/reports'
  },
  shop_admin: {
    dashboard: '/app/admin',
    repairs: '/app/admin/repairs',
    appointments: '/app/admin/appointments',
    inventory: '/app/parts/inventory',
    reports: '/app/admin/reports'
  },
  supplier: {
    dashboard: '/app/supplier',
    repairs: '/app/supplier/rfqs',
    inventory: '/app/supplier/catalog',
    reports: '/app/supplier/performance'
  },
  platform_operator: {
    dashboard: '/app/platform',
    repairs: '/app/platform/shop-applications',
    appointments: '/app/platform/supplier-applications',
    inventory: '/app/platform/businesses',
    reports: '/app/platform/reports'
  }
};

export function navForRole(role: Role, pendingOnboarding = false): PortalNavItem[] {
  if (pendingOnboarding) {
    return pendingNavByRole[role] || pendingNavByRole.shop_admin || [];
  }
  return navByRole[role] || [];
}
