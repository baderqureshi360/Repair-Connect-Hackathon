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

export type PortalNavItem = { href: string; key: NavKey; icon: string };

export const pendingNavByRole: Partial<Record<Role, PortalNavItem[]>> = {
  supplier: [
    { href: '/app/supplier-application/status', key: 'applicationStatusTitle', icon: 'clipboard' }
  ],
  shop_admin: [
    { href: '/app/shop-application/status', key: 'applicationStatusTitle', icon: 'clipboard' }
  ]
};

export const navByRole: Record<Role, PortalNavItem[]> = {
  customer: [
    { href: '/app/customer', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/customer/shops', key: 'findRepairShops', icon: 'building' },
    { href: '/app/customer/new', key: 'submitRepairRequest', icon: 'clipboard' },
    { href: '/app/customer/repairs', key: 'myRepairs', icon: 'wrench' },
    { href: '/app/customer/appointments', key: 'myAppointments', icon: 'calendar' },
    { href: '/app/customer/receipts', key: 'myReceipts', icon: 'fileText' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/profile', key: 'profile', icon: 'user' }
  ],
  mechanic: [
    { href: '/app/mechanic', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/mechanic/jobs', key: 'repairs', icon: 'wrench' },
    { href: '/app/mechanic/reports', key: 'reports', icon: 'chart' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/profile', key: 'profile', icon: 'user' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette' }
  ],
  parts_coordinator: [
    { href: '/app/parts', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/parts/inventory', key: 'inventory', icon: 'package' },
    { href: '/app/parts/requests', key: 'partsRequests', icon: 'clipboard' },
    { href: '/app/admin/purchase-orders', key: 'purchaseOrders', icon: 'fileText' },
    { href: '/app/parts/suppliers', key: 'suppliers', icon: 'factory' },
    { href: '/app/parts/transfers', key: 'transfers', icon: 'truck' },
    { href: '/app/parts/reports', key: 'reports', icon: 'chart' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/profile', key: 'profile', icon: 'user' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette' }
  ],
  shop_admin: [
    { href: '/app/admin', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/admin/appointments', key: 'appointments', icon: 'calendar' },
    { href: '/app/admin/repairs', key: 'repairs', icon: 'wrench' },
    { href: '/app/admin/customers', key: 'customers', icon: 'users' },
    { href: '/app/parts/inventory', key: 'inventory', icon: 'package' },
    { href: '/app/admin/suppliers', key: 'supplierMarketplace', icon: 'factory' },
    { href: '/app/admin/rfqs', key: 'rfqs', icon: 'clipboard' },
    { href: '/app/admin/purchase-orders', key: 'purchaseOrders', icon: 'fileText' },
    { href: '/app/admin/supplier-finance', key: 'supplierFinance', icon: 'chart' },
    { href: '/app/admin/purchasing-analytics', key: 'purchasingAnalytics', icon: 'chart' },
    { href: '/app/admin/messages', key: 'messages', icon: 'bell' },
    { href: '/app/admin/shops', key: 'shopManagement', icon: 'building' },
    { href: '/app/admin/reports', key: 'reports', icon: 'chart' },
    { href: '/app/admin/documents', key: 'documents', icon: 'fileText' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/admin/staff', key: 'staff', icon: 'users' },
    { href: '/app/appearance', key: 'settings', icon: 'settings' }
  ],
  supplier: [
    { href: '/app/supplier', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/supplier/catalog', key: 'catalog', icon: 'package' },
    { href: '/app/supplier/rfqs', key: 'rfqs', icon: 'clipboard' },
    { href: '/app/supplier/purchase-orders', key: 'purchaseOrders', icon: 'fileText' },
    { href: '/app/supplier/performance', key: 'performance', icon: 'chart' },
    { href: '/app/supplier/messages', key: 'messages', icon: 'bell' },
    { href: '/app/supplier/profile', key: 'profile', icon: 'building' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette' }
  ],
  platform_operator: [
    { href: '/app/platform', key: 'dashboard', icon: 'layoutDashboard' },
    { href: '/app/platform/shop-applications', key: 'shopApplications', icon: 'clipboard' },
    { href: '/app/platform/supplier-applications', key: 'supplierApplications', icon: 'factory' },
    { href: '/app/platform/supplier-reviews', key: 'supplierReviews', icon: 'clipboard' },
    { href: '/app/platform/businesses', key: 'platformBusinesses', icon: 'building' },
    { href: '/app/platform/accounts', key: 'platformAccounts', icon: 'users' },
    { href: '/app/platform/audit', key: 'platformAudit', icon: 'fileText' },
    { href: '/app/platform/reports', key: 'platformReports', icon: 'chart' },
    { href: '/app/notifications', key: 'notifications', icon: 'bell' },
    { href: '/app/platform/settings', key: 'settings', icon: 'settings' },
    { href: '/app/profile', key: 'profile', icon: 'user' },
    { href: '/app/appearance', key: 'appearance', icon: 'palette' }
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
