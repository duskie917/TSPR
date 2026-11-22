export const TOPICS = [
  { slug: 'geopolitics', label: 'Geopolitics', blurb: 'Great-power competition, regional security and the balance between Moscow, Beijing, Washington and beyond.' },
  { slug: 'energy-security', label: 'Energy Security', blurb: 'Oil, gas, uranium, hydropower, critical minerals and the region’s energy transition.' },
  { slug: 'foreign-policy', label: 'Foreign Policy', blurb: 'Multi-vector diplomacy, regional institutions and how Central Asian states engage the world.' },
  { slug: 'economy', label: 'Economy', blurb: 'Trade corridors, investment, remittances, reform and regional integration.' },
] as const;

export const COUNTRIES = [
  { slug: 'kazakhstan', label: 'Kazakhstan' },
  { slug: 'kyrgyzstan', label: 'Kyrgyzstan' },
  { slug: 'tajikistan', label: 'Tajikistan' },
  { slug: 'turkmenistan', label: 'Turkmenistan' },
  { slug: 'uzbekistan', label: 'Uzbekistan' },
  { slug: 'regional', label: 'Regional' },
] as const;

export type TopicSlug = (typeof TOPICS)[number]['slug'];
export type CountrySlug = (typeof COUNTRIES)[number]['slug'];

export const topicSlugs = TOPICS.map((t) => t.slug) as [TopicSlug, ...TopicSlug[]];
export const countrySlugs = COUNTRIES.map((c) => c.slug) as [CountrySlug, ...CountrySlug[]];

export const topicLabel = (slug: string) => TOPICS.find((t) => t.slug === slug)?.label ?? slug;
export const countryLabel = (slug: string) => COUNTRIES.find((c) => c.slug === slug)?.label ?? slug;
