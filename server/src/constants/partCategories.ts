/** Canonical spare-part categories for supplier network discovery. */
export const PART_CATEGORIES = [
  { id: 'screens_displays', label: 'Screens & Displays' },
  { id: 'batteries', label: 'Batteries' },
  { id: 'charging_ports', label: 'Charging Ports & Connectors' },
  { id: 'cameras', label: 'Cameras' },
  { id: 'speakers_audio', label: 'Speakers & Audio' },
  { id: 'buttons_flex', label: 'Buttons & Flex Cables' },
  { id: 'housings_frames', label: 'Housings & Frames' },
  { id: 'motherboards_ics', label: 'Motherboards & ICs' },
  { id: 'cables_adapters', label: 'Cables & Adapters' },
  { id: 'tools_accessories', label: 'Tools & Accessories' },
  { id: 'other_parts', label: 'Other Parts' }
] as const;

export type PartCategoryId = (typeof PART_CATEGORIES)[number]['id'];

export const PART_CATEGORY_IDS = PART_CATEGORIES.map((c) => c.id) as PartCategoryId[];

export function isPartCategoryId(value: string): value is PartCategoryId {
  return (PART_CATEGORY_IDS as string[]).includes(value);
}
