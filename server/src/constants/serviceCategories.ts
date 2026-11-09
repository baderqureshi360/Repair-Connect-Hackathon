/** Canonical shop service categories used for customer discovery. */
export const SERVICE_CATEGORIES = [
  {
    id: 'mobile_phones_tablets',
    label: 'Mobile Phones & Tablets',
    deviceHints: ['phone', 'mobile', 'smartphone', 'tablet', 'ipad', 'android']
  },
  {
    id: 'computers_laptops',
    label: 'Computers & Laptops',
    deviceHints: ['laptop', 'computer', 'pc', 'notebook', 'macbook', 'desktop']
  },
  {
    id: 'tvs_home_appliances',
    label: 'TVs & Home Appliances',
    deviceHints: ['tv', 'television', 'appliance', 'microwave', 'washer', 'fridge']
  },
  {
    id: 'gaming_consoles',
    label: 'Gaming Consoles',
    deviceHints: ['console', 'playstation', 'xbox', 'nintendo', 'switch', 'gaming']
  },
  {
    id: 'printers_office',
    label: 'Printers & Office Equipment',
    deviceHints: ['printer', 'scanner', 'copier', 'office', 'fax']
  },
  {
    id: 'other_electronics',
    label: 'Other Electronics',
    deviceHints: ['electronics', 'camera', 'audio', 'drone', 'watch', 'other']
  }
] as const;

export type ServiceCategoryId = (typeof SERVICE_CATEGORIES)[number]['id'];

export const SERVICE_CATEGORY_IDS = SERVICE_CATEGORIES.map((c) => c.id) as ServiceCategoryId[];

export function isServiceCategoryId(value: string): value is ServiceCategoryId {
  return (SERVICE_CATEGORY_IDS as string[]).includes(value);
}
