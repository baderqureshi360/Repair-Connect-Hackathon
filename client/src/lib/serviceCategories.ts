export const SERVICE_CATEGORIES = [
  { id: 'mobile_phones_tablets', label: 'Mobile Phones & Tablets' },
  { id: 'computers_laptops', label: 'Computers & Laptops' },
  { id: 'tvs_home_appliances', label: 'TVs & Home Appliances' },
  { id: 'gaming_consoles', label: 'Gaming Consoles' },
  { id: 'printers_office', label: 'Printers & Office Equipment' },
  { id: 'other_electronics', label: 'Other Electronics' }
] as const;

export type ServiceCategoryId = (typeof SERVICE_CATEGORIES)[number]['id'];

export function categoryLabel(id: string): string {
  return SERVICE_CATEGORIES.find((c) => c.id === id)?.label || id;
}
